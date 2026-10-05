// What the settings page's Accounts section is wired to: which window each Sign in opens, and which
// cookies each Sign out removes from FKN's jar.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, crunchyrollSignedIn } from '../../../src/sources/crunchyroll/session'

const calls = vi.hoisted(() => ({
  clearCloudCookies: vi.fn(async (_domains: string[]) => {}),
  signInThroughWindow: vi.fn(async (_options: unknown) => 'authed' as const),
  signOutOfSite: vi.fn(async (_site: string, _backend: string) => {}),
  signInToMal: vi.fn(async () => 'closed' as const),
}))
vi.mock('../../../src/sources/cloud-sign-out', () => ({ clearCloudCookies: calls.clearCloudCookies }))
vi.mock('../../../src/sources/login-window', () => ({ signInThroughWindow: calls.signInThroughWindow }))
vi.mock('../../../src/tracking/site-sessions', () => ({
  isSiteConnected: () => false,
  watchSite: () => () => {},
  trackerSignIns: { mal: calls.signInToMal },
  signOutOfSite: calls.signOutOfSite,
}))

const { crunchyroll, sites } = await import('../../../src/router/settings/wiring')

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
