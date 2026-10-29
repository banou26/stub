import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { Tracker } from '../../../src/generated/schema/types.generated'

import { changes, failedReadAnswer, rereads, RETRY_MAX_MS, RETRY_MS } from '../../../src/tracking/collect'

afterEach(() => { vi.restoreAllMocks() })

const ANILIST: Tracker = { id: 'anilist', name: 'AniList', signedIn: true, account: 'someone', canWrite: true, scoreScale: 'POINT_10' }

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

test('a read that got no answer says so on the chip, and its error goes to the console with the tracker name alone', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const error = new TypeError('NetworkError when attempting to fetch resource.')

  expect(failedReadAnswer('ag:(anilist:1)', ANILIST, error)).toMatchObject({ state: 'ERROR', error: 'Could not reach AniList, retrying' })
  expect(warn).toHaveBeenCalledExactlyOnceWith('tracking: AniList read got no answer', error)
})

test('the control: any other throw keeps its words on the chip and logs nothing', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

  expect(failedReadAnswer('ag:(anilist:1)', ANILIST, new Error('https://anilist.co did not answer within 30 s'))).toMatchObject({ error: 'https://anilist.co did not answer within 30 s' })
  expect(warn).not.toHaveBeenCalled()
})
