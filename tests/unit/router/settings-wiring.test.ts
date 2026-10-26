// What the settings page's source cards are wired to: which window each Sign in opens, which
// cookies each Sign out removes from FKN's jar, and what each of them and the automatic check remembers.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { PRIME_DOMAINS, primeSignedIn } from '../../../src/sources/amazon/session'
import { viewerIn } from '../sources/justwatch/viewer'

const calls = vi.hoisted(() => ({
  clearCloudCookies: vi.fn(async (_domains: string[]) => {}),
  signInThroughWindow: vi.fn(async (_options: unknown) => 'authed' as const),
  signOutOfSite: vi.fn(async (_site: string, _backend: string) => {}),
  signOutOfCrunchyroll: vi.fn(async () => {}),
  signInToCrunchyroll: vi.fn(async () => 'authed' as const),
  signInToMal: vi.fn(async () => 'closed' as const),
  checkCrunchyroll: vi.fn(async (_backend: string, _deps: Record<string, unknown>) => 'signed-in' as const),
  record: vi.fn((_site: string, _state: string, _now?: number) => {}),
  recordSignOut: vi.fn((_site: string) => {}),
}))
vi.mock('../../../src/sources/crunchyroll/sign-in-check', () => ({ checkCrunchyroll: calls.checkCrunchyroll }))
vi.mock('../../../src/tracking/site-status', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/tracking/site-status')>(),
  siteStatuses: { read: () => undefined, watch: () => () => {}, record: calls.record, recordSignOut: calls.recordSignOut },
}))
vi.mock('../../../src/sources/cloud-sign-out', () => ({ clearCloudCookies: calls.clearCloudCookies }))
vi.mock('../../../src/sources/login-window', () => ({ signInThroughWindow: calls.signInThroughWindow }))
vi.mock('../../../src/tracking/site-sessions', () => ({
  isSiteConnected: () => false,
  watchSite: () => () => {},
  trackerSignIns: { mal: calls.signInToMal },
  signOutOfSite: calls.signOutOfSite,
  signOutOfCrunchyroll: calls.signOutOfCrunchyroll,
  signInToCrunchyroll: calls.signInToCrunchyroll,
}))

const { attachFrame, fetch } = await import('@fkn/lib')
const { crunchyroll, prime, sites, status } = await import('../../../src/router/settings/wiring')

beforeEach(() => { for (const call of Object.values(calls)) call.mockClear() })

// its cookies and what it remembers are tests/unit/tracking/site-sessions.test.ts's
test("Crunchyroll's Sign out is the one that also stops its tracker reaching it", async () => {
  await crunchyroll.signOut()
  expect(calls.signOutOfCrunchyroll).toHaveBeenCalledTimes(1)
})

// its window, the tracking it turns on and what it remembers are tests/unit/tracking/site-sessions.test.ts's
test("Crunchyroll's Sign in is the Log in of its tracker's chip, so it turns its tracking on too", async () => {
  expect(await crunchyroll.signIn()).toBe('authed')
  expect(calls.signInToCrunchyroll).toHaveBeenCalledTimes(1)
  expect(calls.signInThroughWindow).not.toHaveBeenCalled()
})

test("Prime Video's Sign out removes the cookies of every host its player reads from FKN's jar, and remembers it as the viewer's own sign out", async () => {
  await prime.signOut()
  expect(calls.clearCloudCookies.mock.calls).toEqual([[PRIME_DOMAINS]])
  expect(PRIME_DOMAINS).toEqual(expect.arrayContaining(['www.amazon.co.jp', 'amazon.com', 'a2z.com', 'www.primevideo.com', 'www.amazon.co.uk', 'www.amazon.de']))
  expect(calls.recordSignOut.mock.calls).toEqual([['prime']])
  expect(calls.record).not.toHaveBeenCalled()
})

test("Prime Video's Sign in opens the viewer's country's own Sign in on the player's hosts, and remembers an authed one", async () => {
  viewerIn('Asia/Tokyo')
  expect(await prime.signIn()).toBe('authed')
  expect(calls.signInThroughWindow).toHaveBeenCalledWith({ url: expect.stringMatching(/^https:\/\/www\.amazon\.co\.jp\/ap\/signin\?/), domains: PRIME_DOMAINS, isSignedIn: primeSignedIn })
  const [{ url }] = calls.signInThroughWindow.mock.calls[0]! as [{ url: string }]
  expect(new URL(url).searchParams.get('openid.return_to'), 'back on the storefront, the address signed in through').toBe('https://www.amazon.co.jp/gp/video/storefront')
  expect(calls.record.mock.calls).toEqual([['prime', 'signed-in']])
})

test("a viewer in Canada signs in to Prime Video on primevideo.com, and one who picked the UK on amazon.co.uk", async () => {
  viewerIn('America/Toronto')
  await prime.signIn()
  expect(calls.signInThroughWindow).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://www.primevideo.com/auth-redirect?signin=1&returnUrl=%2Fstorefront' }))
  vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'stub.country' ? 'GB' : null })
  await prime.signIn()
  expect(calls.signInThroughWindow).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://www.amazon.co.uk/gp/video/auth-redirect?signin=1&returnUrl=%2Fgp%2Fvideo%2Fstorefront' }))
})

afterEach(() => { vi.unstubAllGlobals() })

test("a tracking site's Sign in and Sign out are that site's", async () => {
  expect(await sites.signIn('mal')).toBe('closed')
  expect(calls.signInToMal).toHaveBeenCalledTimes(1)
  await sites.signOut('anilist', 'cloud')
  expect(calls.signOutOfSite).toHaveBeenCalledWith('anilist', 'cloud')
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

