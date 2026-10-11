import { expect, test } from 'vite-plus/test'

import { changes, rereads, RETRY_MAX_MS, RETRY_MS } from '../../../src/tracking/collect'

const wakeable = () => {
  let listener: (() => void) | undefined
  const controller = new AbortController()
  const wakes = changes(added => { listener = added; return () => { listener = undefined } }, { signal: controller.signal })
  return { wakes, wake: () => listener?.(), end: () => controller.abort() }
}

test('a failed read is made again after RETRY_MS, twice as long for each failure in a row up to RETRY_MAX_MS, and a good read starts over', async () => {
  const waits: number[] = []
  const { wakes, wake } = wakeable()
  const next = rereads(wakes, async ms => { waits.push(ms) })

  for (let failure = 0; failure < 7; failure++) expect(await next(true)).toBe(true)
  expect(waits).toEqual([RETRY_MS, 2 * RETRY_MS, 4 * RETRY_MS, 8 * RETRY_MS, 16 * RETRY_MS, RETRY_MAX_MS, RETRY_MAX_MS])

  const settled = next(false)
  wake()
  expect(await settled).toBe(true)
  expect(waits, 'a good read waits for a wake alone').toHaveLength(7)
  await next(true)
  expect(waits.at(-1)).toBe(RETRY_MS)
})

test('a wake cuts the retry wait short, and the end of the wakes ends the loop', async () => {
  const { wakes, wake, end } = wakeable()
  const next = rereads(wakes, () => new Promise(() => {}))

  const early = next(true)
  wake()
  expect(await early).toBe(true)

  const ended = next(true)
  end()
  expect(await ended).toBe(false)
})
