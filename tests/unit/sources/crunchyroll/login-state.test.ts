import type { Frame } from '@fkn/lib'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { checkIsLoggedIn } from '../../../../src/sources/crunchyroll/login-state'

// [ms after `goto(url, { waitUntil: 'documentstart' })` resolved, the markers on the page from then on].
// Both traced through the relay on 2026-09-26, /watch/GE00374453JAJP, polling every 200 ms
type Timeline = [number, string[]][]

const ANONYMOUS = '#user-menu-anonymous'
const AUTHENTICATED = '#user-menu-authenticated'
const SHELL = '.shell-header'

// a reload signed in, which 0.0.34 answered with the sign-in prompt over a page that played
const SIGNED_IN: Timeline = [
  [3661, []],
  // what 0.0.34 read at +3707 (no shell, then the anonymous menu) and decided signed out on
  [3700, [ANONYMOUS]],
  [3866, [ANONYMOUS, SHELL]],
  [5396, [SHELL]],
  [5599, [AUTHENTICATED]],
  [6662, [AUTHENTICATED, 'video']],
]

// a fresh signed-out profile
const SIGNED_OUT: Timeline = [
  [3068, []],
  [3279, [ANONYMOUS, SHELL]],
  [5166, [ANONYMOUS]],
]

const replay = (timeline: Timeline) => {
  const start = Date.now()
  const now = () => timeline.findLast(([at]) => Date.now() - start >= at)?.[1] ?? []
  return { locator: (selector: string) => ({ exists: async () => now().includes(selector) }) } as unknown as Frame
}

const decide = async (timeline: Timeline, runFor = 40_000) => {
  const start = Date.now()
  let decidedAt: number | undefined
  const result = checkIsLoggedIn(replay(timeline), () => false).finally(() => { decidedAt = Date.now() - start })
  result.catch(() => {})
  await vi.advanceTimersByTimeAsync(runFor)
  return { result, decidedAt }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

test('a signed-in reload waits out the streamed anonymous menu and decides on the signed-in one', async () => {
  const { result, decidedAt } = await decide(SIGNED_IN)
  await expect(result).resolves.toMatchObject({ isLoggedIn: true })
  expect(decidedAt).toBeGreaterThanOrEqual(5599)
  expect(decidedAt).toBeLessThan(5800)
})

test('a signed-out page decides once the shell has come and gone, well before the deadline', async () => {
  const { result, decidedAt } = await decide(SIGNED_OUT)
  await expect(result).resolves.toMatchObject({ isLoggedIn: false, isLoggedOut: true })
  expect(decidedAt).toBeGreaterThanOrEqual(5166)
  expect(decidedAt).toBeLessThan(5400)
})

test('an anonymous menu whose shell was never seen decides signed out only at the deadline', async () => {
  const { result, decidedAt } = await decide([[3000, [ANONYMOUS]]])
  await expect(result).resolves.toMatchObject({ isLoggedIn: false })
  expect(decidedAt).toBeGreaterThanOrEqual(30_000)
})

test('a page still in its streamed state at the deadline times out rather than asking to sign in', async () => {
  const { result, decidedAt } = await decide([[3000, [ANONYMOUS, SHELL]]])
  await expect(result).rejects.toThrow('Login state check timed out')
  expect(decidedAt).toBeGreaterThanOrEqual(30_000)
})

// Cloudflare's 'Just a moment...' page, which a HeadlessChrome user agent was served, carries neither menu
test('a page with neither menu by the deadline times out', async () => {
  const { result, decidedAt } = await decide([[2000, []]])
  await expect(result).rejects.toThrow('Login state check timed out')
  expect(decidedAt).toBeGreaterThanOrEqual(30_000)
})
