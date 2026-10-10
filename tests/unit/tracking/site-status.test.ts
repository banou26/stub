import { expect, test, vi } from 'vite-plus/test'

import { createSiteStatuses, recordTrackerAnswers, rememberSignIn, SITE_STATUS_KEY } from '../../../src/tracking/site-status'

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, values }
}

test('records a state with its time, per site, and reads it back', () => {
  const storage = memory()
  const statuses = createSiteStatuses(() => storage)
  statuses.record('crunchyroll', 'signed-in', 1_000)
  statuses.record('mal', 'signed-out', 2_000)

  expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-in', checkedAt: 1_000 })
  expect(statuses.read('mal')).toEqual({ state: 'signed-out', checkedAt: 2_000 })
  expect(statuses.read('anilist')).toBeUndefined()
  expect(JSON.parse(storage.values.get(SITE_STATUS_KEY)!)).toEqual({
    crunchyroll: { state: 'signed-in', checkedAt: 1_000 },
    mal: { state: 'signed-out', checkedAt: 2_000 },
  })
})

test('keeps the state and the time only, never anything the site said about the viewer', () => {
  const storage = memory()
  createSiteStatuses(() => storage).record('anilist', 'signed-in', 1_000)

  expect(Object.keys(JSON.parse(storage.values.get(SITE_STATUS_KEY)!).anilist).sort()).toEqual(['checkedAt', 'state'])
})

test('reads storage on every call, so a state removed from storage is gone here too', () => {
  const storage = memory()
  const statuses = createSiteStatuses(() => storage)
  statuses.record('crunchyroll', 'signed-in', 1_000)
  storage.values.delete(SITE_STATUS_KEY)

  expect(statuses.read('crunchyroll')).toBeUndefined()
})

test('tells the watchers of that site, and only them', () => {
  const statuses = createSiteStatuses(() => memory())
  const crunchyroll = vi.fn()
  const mal = vi.fn()
  statuses.watch('crunchyroll', crunchyroll)
  const stop = statuses.watch('mal', mal)
  stop()
  statuses.record('crunchyroll', 'signed-out')
  statuses.record('mal', 'signed-out')

  expect(crunchyroll).toHaveBeenCalledTimes(1)
  expect(mal).not.toHaveBeenCalled()
})

test('on a browser that blocks site data, keeps the state for this page and throws nothing', () => {
  const statuses = createSiteStatuses(() => { throw new Error('SecurityError') })
  expect(() => statuses.record('anilist', 'signed-in', 1_000)).not.toThrow()

  expect(statuses.read('anilist')).toEqual({ state: 'signed-in', checkedAt: 1_000 })
})

test('reads anything else stored there as nothing remembered', () => {
  for (const stored of ['not json', '[]', '{"crunchyroll":{"state":"maybe","checkedAt":1}}', '{"crunchyroll":{"state":"signed-in"}}']) {
    expect(createSiteStatuses(() => memory({ [SITE_STATUS_KEY]: stored })).read('crunchyroll'), stored).toBeUndefined()
  }
})

test('a sign-in through a window is remembered as signed in only when it says authed', () => {
  const record = vi.fn()
  const remember = rememberSignIn({ record }, 'crunchyroll')

  expect(['closed', 'blocked', 'unsupported', 'authed'].map(remember)).toEqual(['closed', 'blocked', 'unsupported', 'authed'])
  expect(record.mock.calls).toEqual([['crunchyroll', 'signed-in']])
})

const answer = (tracker: string, state: string) => ({ state, tracker: { id: tracker } })

test('a tracker\'s list read says its site is signed in, and SIGNED_OUT that it is not', () => {
  const record = vi.fn()
  recordTrackerAnswers([answer('anilist', 'LISTED'), answer('mal', 'SIGNED_OUT')], { record }, () => true)

  expect(record.mock.calls).toEqual([['anilist', 'signed-in'], ['mal', 'signed-out']])
})

test('a site not connected here, an answer that asked nothing, and stub\'s own tracker say nothing', () => {
  const record = vi.fn()
  recordTrackerAnswers(
    [answer('anilist', 'SIGNED_OUT'), answer('mal', 'NO_ID'), answer('mal', 'ERROR'), answer('mal', 'PAUSED'), answer('stub', 'LISTED')],
    { record },
    site => site === 'mal',
  )

  expect(record).not.toHaveBeenCalled()
})
