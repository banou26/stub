// What the settings page's Accounts section is wired to: which window each Sign in opens, which
// cookies each Sign out removes from FKN's jar, and what each of them and the automatic check remembers.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { PRIME_DOMAINS, PRIME_SIGN_IN_URL, primeSignedIn } from '../../../src/sources/amazon/session'
import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, crunchyrollSignedIn } from '../../../src/sources/crunchyroll/session'

const calls = vi.hoisted(() => ({
  clearCloudCookies: vi.fn(async (_domains: string[]) => {}),
  signInThroughWindow: vi.fn(async (_options: unknown) => 'authed' as const),
  signOutOfSite: vi.fn(async (_site: string, _backend: string) => {}),
  signInToMal: vi.fn(async () => 'closed' as const),
  checkCrunchyroll: vi.fn(async (_backend: string, _deps: Record<string, unknown>) => 'signed-in' as const),
  record: vi.fn((_site: string, _state: string, _now?: number) => {}),
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
}))

const { attachFrame, fetch } = await import('@fkn/lib')
const { crunchyroll, prime, sites, status } = await import('../../../src/router/settings/wiring')

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

test("Prime Video's Sign out removes the cookies of every host its player reads from FKN's jar, and remembers it", async () => {
  await prime.signOut()
  expect(calls.clearCloudCookies.mock.calls).toEqual([[PRIME_DOMAINS]])
  expect(PRIME_DOMAINS).toEqual(expect.arrayContaining(['www.amazon.co.jp', 'amazon.com', 'a2z.com']))
  expect(calls.record.mock.calls).toEqual([['prime', 'signed-out']])
})

test("Prime Video's Sign in opens amazon.co.jp's sign-in on the player's hosts, and remembers an authed one", async () => {
  expect(await prime.signIn()).toBe('authed')
  expect(calls.signInThroughWindow).toHaveBeenCalledWith({ url: PRIME_SIGN_IN_URL, domains: PRIME_DOMAINS, isSignedIn: primeSignedIn })
  expect(calls.record.mock.calls).toEqual([['prime', 'signed-in']])
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

const settled = () => new Promise(resolve => setTimeout(resolve, 0))

test("Crunchyroll's check asks on the backend the page runs on, through FKN, and remembers the answer", async () => {
  status.refresh('crunchyroll', 'cloud')
  await settled()
  const [backend, deps] = calls.checkCrunchyroll.mock.calls[0]!
  expect(backend).toBe('cloud')
  expect(deps.attach).toBe(attachFrame)
  expect(deps.fetch).toBe(fetch)
  expect(calls.record.mock.calls).toEqual([['crunchyroll', 'signed-in', expect.any(Number)]])
})

