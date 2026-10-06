// What the settings page's Accounts section is wired to: which window each Sign in opens, which
// cookies each Sign out removes from FKN's jar, and what each of them and each Check now remembers.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, crunchyrollSignedIn } from '../../../src/sources/crunchyroll/session'

const calls = vi.hoisted(() => ({
  clearCloudCookies: vi.fn(async (_domains: string[]) => {}),
  signInThroughWindow: vi.fn(async (_options: unknown) => 'authed' as const),
  signOutOfSite: vi.fn(async (_site: string, _backend: string) => {}),
  signInToMal: vi.fn(async () => 'closed' as const),
  checkCrunchyroll: vi.fn(async (_backend: string, _deps: Record<string, unknown>) => 'signed-in' as const),
  checkTrackerSite: vi.fn(async (_site: string): Promise<'signed-in' | 'signed-out'> => 'signed-out'),
  record: vi.fn((_site: string, _state: string) => {}),
}))
vi.mock('../../../src/sources/crunchyroll/sign-in-check', () => ({ checkCrunchyroll: calls.checkCrunchyroll }))
vi.mock('../../../src/tracking/site-status', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/tracking/site-status')>(),
  siteStatuses: { read: () => undefined, watch: () => () => {}, record: calls.record },
}))
vi.mock('../../../src/sources/cloud-sign-out', () => ({ clearCloudCookies: calls.clearCloudCookies }))
vi.mock('../../../src/sources/login-window', () => ({ signInThroughWindow: calls.signInThroughWindow }))
vi.mock('../../../src/tracking/site-sessions', () => ({
  isSiteConnected: () => false,
  watchSite: () => () => {},
  trackerSignIns: { mal: calls.signInToMal },
  signOutOfSite: calls.signOutOfSite,
  checkTrackerSite: calls.checkTrackerSite,
}))

const { attachFrame, fetch } = await import('@fkn/lib')
const { crunchyroll, sites, status } = await import('../../../src/router/settings/wiring')

beforeEach(() => { for (const call of Object.values(calls)) call.mockClear() })

test("Crunchyroll's Sign out removes Crunchyroll's own cookies from FKN's jar", async () => {
  await crunchyroll.signOut()
  expect(calls.clearCloudCookies).toHaveBeenCalledTimes(1)
  expect(calls.clearCloudCookies).toHaveBeenCalledWith(CRUNCHYROLL_DOMAINS)
  expect(CRUNCHYROLL_DOMAINS).toContain('crunchyroll.com')
})

test("Crunchyroll's Sign in opens Crunchyroll's sign-in page on the same hosts", async () => {
  expect(await crunchyroll.signIn()).toBe('authed')
  expect(calls.signInThroughWindow).toHaveBeenCalledWith({ url: CRUNCHYROLL_LOGIN_URL, domains: CRUNCHYROLL_DOMAINS, isSignedIn: crunchyrollSignedIn })
})

test("a tracking site's Sign in and Sign out are that site's", async () => {
  expect(await sites.signIn('mal')).toBe('closed')
  expect(calls.signInToMal).toHaveBeenCalledTimes(1)
  await sites.signOut('anilist', 'cloud')
  expect(calls.signOutOfSite).toHaveBeenCalledWith('anilist', 'cloud')
})

test('a Crunchyroll sign-in is remembered as signed in once it says authed, and not before', async () => {
  await crunchyroll.signIn()
  expect(calls.record.mock.calls).toEqual([['crunchyroll', 'signed-in']])

  calls.record.mockClear()
  calls.signInThroughWindow.mockResolvedValueOnce('closed' as never)
  await crunchyroll.signIn()
  expect(calls.record).not.toHaveBeenCalled()
})

test('a Crunchyroll sign out is remembered as signed out once the cookies are gone, and not when FKN refused', async () => {
  await crunchyroll.signOut()
  expect(calls.record.mock.calls).toEqual([['crunchyroll', 'signed-out']])

  calls.record.mockClear()
  calls.clearCloudCookies.mockRejectedValueOnce(new Error('refused'))
  await expect(crunchyroll.signOut()).rejects.toThrow('refused')
  expect(calls.record).not.toHaveBeenCalled()
})

test("Crunchyroll's Check now asks on the backend the page runs on, through FKN, and remembers the answer", async () => {
  expect(await status.check('crunchyroll', 'extension')).toBe('signed-in')
  const [backend, deps] = calls.checkCrunchyroll.mock.calls[0]!
  expect(backend).toBe('extension')
  expect(deps.attach).toBe(attachFrame)
  expect(deps.fetch).toBe(fetch)
  expect(calls.record.mock.calls).toEqual([['crunchyroll', 'signed-in']])
})

test("a tracking site's Check now asks through its session frame, and remembers the answer", async () => {
  expect(await status.check('mal', 'cloud')).toBe('signed-out')
  expect(calls.checkTrackerSite).toHaveBeenCalledWith('mal')
  expect(calls.record.mock.calls).toEqual([['mal', 'signed-out']])
})

test('a check that got no answer remembers nothing', async () => {
  calls.checkTrackerSite.mockRejectedValueOnce(new Error('MyAnimeList asked stub to wait'))
  await expect(status.check('mal', 'cloud')).rejects.toThrow('asked stub to wait')
  expect(calls.record).not.toHaveBeenCalled()
})
