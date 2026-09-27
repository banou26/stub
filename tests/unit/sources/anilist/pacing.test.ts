// The AniList tracker's pacing over a fake clock, whose waits advance it rather than spend real time.
import { describe, expect, test } from 'vitest'

import type { Paced } from '../../../../src/sources/anilist/pacing'

import { LOW_BUDGET_WAIT_MS, TIMEOUT_AFTER_429_MS, createPacer } from '../../../../src/sources/anilist/pacing'

const clock = () => {
  let at = 1_790_000_000_000
  const waits: number[] = []
  return {
    now: () => at,
    wait: async (ms: number) => { waits.push(ms); at += ms },
    waits,
    advance: (ms: number) => { at += ms },
  }
}

const paced = (status: number, rateLimit: Partial<Paced['rateLimit']> = {}, body: Paced['body'] = null): Paced =>
  ({ status, body, rateLimit: { limit: 30, remaining: 20, reset: null, retryAfter: null, ...rateLimit } })

const identity = (result: Paced) => result

describe('the AniList pacer', () => {
  test('sends at once while the budget lasts', async () => {
    const time = clock()
    const pacer = createPacer(time)
    await pacer.run(async () => paced(200, { remaining: 3 }), identity)
    await pacer.run(async () => paced(200, { remaining: 3 }), identity)
    expect(time.waits).toEqual([])
    expect(pacer.pausedUntil()).toBeUndefined()
  })

  test('waits a minute before the next call once 2 or fewer are left', async () => {
    const time = clock()
    const pacer = createPacer(time)
    await pacer.run(async () => paced(200, { remaining: 2 }), identity)
    expect(pacer.pausedUntil()).toBe(time.now() + LOW_BUDGET_WAIT_MS)

    await pacer.run(async () => paced(200, { remaining: 29 }), identity)
    expect(time.waits).toEqual([LOW_BUDGET_WAIT_MS])
  })

  test("after a 429, sends nothing until AniList's X-RateLimit-Reset, and never sends the refused call again", async () => {
    const time = clock()
    const pacer = createPacer(time)
    const reset = Math.floor(time.now() / 1_000) + 45
    let sent = 0

    const refused = await pacer.run(async () => { sent++; return paced(429, { remaining: 0, reset, retryAfter: 60 }) }, identity)
    expect(refused.status, 'handed back, not retried').toBe(429)
    expect(sent).toBe(1)
    expect(pacer.pausedUntil()).toBe(reset * 1_000)

    await pacer.run(async () => { sent++; return paced(200) }, identity)
    expect(time.waits).toEqual([45_000])
    expect(sent).toBe(2)
  })

  test('after a 429 with no reset, honours Retry-After, else a minute', async () => {
    const time = clock()
    const pacer = createPacer(time)
    await pacer.run(async () => paced(429, { retryAfter: 30 }), identity)
    expect(pacer.pausedUntil()).toBe(time.now() + 30_000)

    time.advance(30_000)
    await pacer.run(async () => paced(429), identity)
    expect(pacer.pausedUntil()).toBe(time.now() + TIMEOUT_AFTER_429_MS)
  })

  test('pauses the same after a 429 reported only in the body, beside an HTTP 200', async () => {
    const time = clock()
    const pacer = createPacer(time)
    await pacer.run(async () => paced(200, {}, { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }), identity)
    expect(pacer.pausedUntil()).toBe(time.now() + TIMEOUT_AFTER_429_MS)

    await pacer.run(async () => paced(200), identity)
    expect(time.waits).toEqual([TIMEOUT_AFTER_429_MS])
  })

  test('sends one call at a time, in the order they were made', async () => {
    const time = clock()
    const pacer = createPacer(time)
    const order: string[] = []
    let release!: () => void
    const first = pacer.run(async () => { order.push('first starts'); await new Promise<void>(resolve => { release = resolve }); order.push('first ends'); return paced(200) }, identity)
    const second = pacer.run(async () => { order.push('second'); return paced(200) }, identity)
    await new Promise(resolve => setTimeout(resolve, 5))
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first starts', 'first ends', 'second'])
  })

  test('a call whose asker left during the wait is not sent', async () => {
    const time = clock()
    const pacer = createPacer(time)
    await pacer.run(async () => paced(200, { remaining: 1 }), identity)
    const gone = AbortSignal.abort()
    let sent = false
    await expect(pacer.run(async () => { sent = true; return paced(200) }, identity, gone)).rejects.toThrow()
    expect(sent).toBe(false)
  })
})
