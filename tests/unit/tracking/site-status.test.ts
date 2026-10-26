import { expect, test, vi } from 'vite-plus/test'

import type { SiteState, StatusSite } from '../../../src/tracking/site-status'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { createRefresh, createSiteStatuses, FRESH_MS, recordTrackerAnswers, rememberSignIn, SITE_STATUS_KEY } from '../../../src/tracking/site-status'

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

// HOR-1033: Play asks a viewer who signed in here before to sign in again, rather than opening a free source
test('a sign out keeps that the viewer was signed in before, through every sign out after, until the next sign in, and sign outs alone keep none', () => {
  const storage = memory()
  const statuses = createSiteStatuses(() => storage)
  statuses.record('crunchyroll', 'signed-in', 1_000)
  statuses.record('crunchyroll', 'signed-out', 2_000)

  expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-out', checkedAt: 2_000, signedInBefore: true })
  expect(JSON.parse(storage.values.get(SITE_STATUS_KEY)!).crunchyroll).toEqual({ state: 'signed-out', checkedAt: 2_000, signedInBefore: true })
  statuses.record('crunchyroll', 'signed-out', 3_000)
  expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-out', checkedAt: 3_000, signedInBefore: true })
  statuses.record('crunchyroll', 'signed-in', 4_000)
  expect(JSON.parse(storage.values.get(SITE_STATUS_KEY)!).crunchyroll).toEqual({ state: 'signed-in', checkedAt: 4_000 })
  statuses.record('prime', 'signed-out', 5_000)
  statuses.record('prime', 'signed-out', 6_000)
  expect(statuses.read('prime'), 'never signed in').toEqual({ state: 'signed-out', checkedAt: 6_000 })
})

test('on a browser that blocks site data, keeps that the viewer was signed in before for this page', () => {
  const statuses = createSiteStatuses(() => { throw new Error('SecurityError') })
  statuses.record('prime', 'signed-in', 1_000)
  statuses.record('prime', 'signed-out', 2_000)

  expect(statuses.read('prime')).toEqual({ state: 'signed-out', checkedAt: 2_000, signedInBefore: true })
})

test('reads a signed in before only as true, and only beside a signed out', () => {
  for (const [stored, read] of [
    ['{"crunchyroll":{"state":"signed-out","checkedAt":1,"signedInBefore":true}}', { state: 'signed-out', checkedAt: 1, signedInBefore: true }],
    ['{"crunchyroll":{"state":"signed-out","checkedAt":1,"signedInBefore":"yes"}}', { state: 'signed-out', checkedAt: 1 }],
    ['{"crunchyroll":{"state":"signed-in","checkedAt":1,"signedInBefore":true}}', { state: 'signed-in', checkedAt: 1 }],
  ] as const) {
    expect(createSiteStatuses(() => memory({ [SITE_STATUS_KEY]: stored })).read('crunchyroll'), stored).toEqual(read)
  }
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

test('a state another document of this browser stores tells the watchers of the sites it changed here, and only them', async () => {
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.resetModules()
  const { siteStatuses } = await import('../../../src/tracking/site-status')
  vi.unstubAllGlobals()
  const heard = { anilist: vi.fn(), mal: vi.fn(), crunchyroll: vi.fn() }
  for (const [site, listener] of Object.entries(heard)) siteStatuses.watch(site as StatusSite, listener)
  const stored = (key: string, oldValue: object | null, newValue: object | null) => page.dispatchEvent(Object.assign(new Event('storage'), {
    key, oldValue: oldValue && JSON.stringify(oldValue), newValue: newValue && JSON.stringify(newValue),
  }))
  const mal = { state: 'signed-in', checkedAt: 1_000 }

  stored(SITE_STATUS_KEY, { anilist: { state: 'signed-out', checkedAt: 1_000 }, mal }, { anilist: { state: 'signed-in', checkedAt: 2_000 }, mal })
  stored('not-stub', { mal }, { mal: { ...mal, checkedAt: 2_000 } })
  expect(heard.anilist).toHaveBeenCalledTimes(1)
  expect(heard.mal).not.toHaveBeenCalled()

  stored(SITE_STATUS_KEY, null, { crunchyroll: mal })
  expect(heard.crunchyroll).toHaveBeenCalledTimes(1)
  expect(heard.anilist).toHaveBeenCalledTimes(1)
  expect(heard.mal).not.toHaveBeenCalled()
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

const refreshing = (answer: () => Promise<SiteState>) => {
  let clock = 1_790_000_000_000
  const storage = memory()
  const statuses = createSiteStatuses(() => storage)
  const ask = vi.fn((_site: StatusSite, _backend: FknBackend) => answer())
  return { statuses, ask, refresh: createRefresh(statuses, ask, () => clock), now: () => clock, tick: (ms: number) => { clock += ms } }
}

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

test('a refresh asks a site stub knows nothing of or learned FRESH_MS ago, on the backend given, and remembers the answer', async () => {
  const { statuses, ask, refresh, now } = refreshing(async () => 'signed-out')
  statuses.record('crunchyroll', 'signed-in', now() - FRESH_MS)
  statuses.record('mal', 'signed-in', now() - FRESH_MS + 1)
  refresh('anilist', 'cloud')
  refresh('crunchyroll', 'extension')
  refresh('mal', 'cloud')
  await settled()

  expect(ask.mock.calls).toEqual([['anilist', 'cloud'], ['crunchyroll', 'extension']])
  expect(statuses.read('anilist')).toEqual({ state: 'signed-out', checkedAt: now() })
  expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-out', checkedAt: now(), signedInBefore: true })
  expect(statuses.read('mal'), 'learned under FRESH_MS ago').toEqual({ state: 'signed-in', checkedAt: now() - FRESH_MS + 1 })
})

test('a site is asked once at a time, and not again within FRESH_MS of an ask that failed, which remembers nothing', async () => {
  const answers: { resolve: (state: SiteState) => void, reject: (error: Error) => void }[] = []
  const { statuses, ask, refresh, tick } = refreshing(() => new Promise((resolve, reject) => { answers.push({ resolve, reject }) }))
  refresh('mal', 'cloud')
  tick(10 * FRESH_MS)
  refresh('mal', 'cloud')
  expect(ask, 'still being asked').toHaveBeenCalledTimes(1)

  answers[0]!.reject(new Error('MyAnimeList asked stub to wait'))
  await settled()
  expect(statuses.read('mal')).toBeUndefined()
  tick(FRESH_MS - 1)
  refresh('mal', 'cloud')
  expect(ask, 'asked under FRESH_MS ago').toHaveBeenCalledTimes(1)

  tick(1)
  refresh('mal', 'cloud')
  expect(ask).toHaveBeenCalledTimes(2)
  answers[1]!.resolve('signed-in')
  await settled()
  expect(statuses.read('mal')?.state).toBe('signed-in')
})

test('an answer to an ask that a sign out landed during is dropped, and the sign out stays', async () => {
  let answer!: (state: SiteState) => void
  const { statuses, refresh, now, tick } = refreshing(() => new Promise(resolve => { answer = resolve }))
  statuses.record('crunchyroll', 'signed-in', now() - 2 * FRESH_MS)
  refresh('crunchyroll', 'cloud')
  tick(1_000)
  statuses.record('crunchyroll', 'signed-out', now())
  answer('signed-in')
  await settled()

  expect(statuses.read('crunchyroll')).toEqual({ state: 'signed-out', checkedAt: now(), signedInBefore: true })
})
