// How the MyAnimeList tracker spaces its calls, on a clock the test moves.
import { describe, expect, test } from 'vitest'

import { BLOCKED_PAUSE_MS, WRITE_GAP_MS, createMalPacer, createSaveQueue, malPauseAfter, type MalPaced } from '../../../../src/sources/mal/pacing'

const clock = ({ hold = false } = {}) => {
  let at = 1_790_000_000_000
  const waits: number[] = []
  const held: (() => void)[] = []
  return {
    now: () => at,
    wait: async (ms: number) => {
      waits.push(ms)
      if (hold) await new Promise<void>(resolve => held.push(resolve))
      at += ms
    },
    waits,
    release: () => held.shift()?.(),
  }
}

const OK: MalPaced = { blocked: false, retryAfter: null }
const paced = (result: MalPaced) => result

describe('the MyAnimeList pacer', () => {
  test("a refusal holds every call after it for its Retry-After, else BLOCKED_PAUSE_MS, and is not sent again", async () => {
    const time = clock()
    const pacer = createMalPacer(time)
    let sent = 0
    const call = (result: MalPaced) => async () => { sent++; return result }

    await pacer.run(call({ blocked: true, retryAfter: 90 }), paced)
    expect(pacer.pausedUntil()).toBe(time.now() + 90_000)
    await pacer.run(call({ blocked: true, retryAfter: null }), paced)
    await pacer.run(call(OK), paced)

    expect(time.waits).toEqual([90_000, BLOCKED_PAUSE_MS])
    expect(sent, 'each call sent once').toBe(3)
    expect(pacer.pausedUntil()).toBeUndefined()
  })

  test('the pause rule', () => {
    expect(malPauseAfter({ blocked: true, retryAfter: 30 }, 1_000)).toBe(31_000)
    expect(malPauseAfter({ blocked: true, retryAfter: 0 }, 1_000)).toBe(1_000 + BLOCKED_PAUSE_MS)
    expect(malPauseAfter(OK, 1_000)).toBe(0)
  })

  test('list pages go back to back, one at a time, in order', async () => {
    const time = clock()
    const pacer = createMalPacer(time)
    const order: string[] = []
    const page = (name: string) => async () => {
      order.push(`start ${name}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push(`end ${name}`)
      return OK
    }
    await Promise.all([pacer.run(page('a'), paced), pacer.run(page('b'), paced)])
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
    expect(time.waits).toEqual([])
  })

  test('a call whose asker left during the pause is not sent', async () => {
    const time = clock({ hold: true })
    const pacer = createMalPacer(time)
    await pacer.run(async () => ({ blocked: true, retryAfter: 60 }), paced)
    const controller = new AbortController()
    let sent = false
    const left = pacer.run(async () => { sent = true; return OK }, paced, controller.signal)
    await new Promise(resolve => setTimeout(resolve))
    controller.abort()
    time.release()
    await expect(left).rejects.toThrow()
    expect(sent).toBe(false)
  })
})

describe('the saves', () => {
  test('a second save waits WRITE_GAP_MS after the last write of the first, and one waits for the other', async () => {
    const time = clock()
    const saves = createSaveQueue(time)
    const order: string[] = []
    const first = saves.run(async turn => {
      await turn.ready()
      order.push('first writes')
      await new Promise(resolve => setTimeout(resolve, 5))
      turn.wrote()
      order.push('first done')
    })
    const second = saves.run(async turn => {
      order.push('second planned')
      await turn.ready()
      order.push('second writes')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first writes', 'first done', 'second planned', 'second writes'])
    expect(time.waits).toEqual([WRITE_GAP_MS])
  })

  test('a read does not wait behind a save waiting out the gap', async () => {
    const time = clock({ hold: true })
    const saves = createSaveQueue(time)
    const pacer = createMalPacer(time)
    await saves.run(async turn => { await turn.ready(); turn.wrote() })

    const waiting = saves.run(async turn => { await turn.ready(); return 'saved' })
    await new Promise(resolve => setTimeout(resolve))
    expect(time.waits, 'the second save is waiting out the gap').toEqual([WRITE_GAP_MS])
    expect(await pacer.run(async () => OK, paced), 'a read meanwhile').toBe(OK)

    time.release()
    expect(await waiting).toBe('saved')
  })

  test('a save that failed does not stop the next one', async () => {
    const saves = createSaveQueue(clock())
    await expect(saves.run(async () => { throw new Error('refused') })).rejects.toThrow('refused')
    expect(await saves.run(async () => 'next')).toBe('next')
  })
})
