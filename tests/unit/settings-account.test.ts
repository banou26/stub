// The page's settings and resume points over its own @fkn/lib realm: a check brings the account's
// settings to every setting's module, a change made through one reaches the account without a check, and
// the page checks both again as it does for the added sources.
import { expect, test, vi } from 'vite-plus/test'

import { POSITIONS_PATH, SETTINGS_PATH } from '../../src/settings-sync'

// FKN's storage faked at @fkn/lib's surface, signed in to an account that turned Simkl off elsewhere
const account = await vi.hoisted(async () => {
  const { fknWorld } = await import('./tracking/fkn-fake')
  const { fknTrackerCloud } = await import('../../src/tracking/fkn-cloud')
  const world = fknWorld()
  const browser = world.browser({ account: 'alice' })
  return { world, browser, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }) }
})
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: account.cloud, onTrackerAccountChange: account.browser.onChange }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

const { checkPositions, checkSettings, watchAccountFiles } = await import('../../src/settings-account')
const { readDisabledSources, setSourceEnabled } = await import('../../src/sources/disabled-sources')
const { REFRESH_MS } = await import('../../src/tracking/account-link')

const fileOf = () => JSON.parse(account.world.storageOf('alice').get(SETTINGS_PATH)?.text ?? 'null') as unknown
const reads = (file = SETTINGS_PATH) => account.browser.state.reads.filter(path => path === file).length

const events = () => {
  const listeners = new Map<string, (() => void)[]>()
  return {
    addEventListener: (type: string, listener: () => void) => { listeners.set(type, [...listeners.get(type) ?? [], listener]) },
    fire: (type: string) => { for (const listener of listeners.get(type) ?? []) listener() },
  }
}

test('a check brings the account\'s settings to the page, and a switch turned off reaches the account by itself', async () => {
  account.world.storageOf('alice').set(SETTINGS_PATH, { text: JSON.stringify({ 'stub.sources.disabled': '["simkl"]' }), updatedAt: new Date(0).toISOString() })
  expect(readDisabledSources(), 'the control: nothing before the check').toEqual([])
  await checkSettings()
  expect(readDisabledSources()).toEqual(['simkl'])

  setSourceEnabled('trakt', false)
  await vi.waitFor(() => expect(fileOf()).toEqual({ 'stub.sources.disabled': '["simkl","trakt"]' }))
})

test('the page checks the account\'s settings and resume points with its added sources at start, back in view and every REFRESH_MS in view', async () => {
  await Promise.all([checkSettings(), checkPositions()])
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const sources = vi.fn(async () => {})
  const page = events()
  const before = reads()
  const positionsBefore = reads(POSITIONS_PATH)
  const stop = watchAccountFiles(sources, { page, document: Object.assign(events(), { visibilityState: 'visible' }) })
  await vi.waitFor(() => expect(reads()).toBe(before + 1))
  page.fire('focus')
  await vi.waitFor(() => expect(reads()).toBe(before + 2))
  vi.advanceTimersByTime(REFRESH_MS)
  await vi.waitFor(() => expect(reads()).toBe(before + 3))
  expect(sources).toHaveBeenCalledTimes(3)
  await vi.waitFor(() => expect(reads(POSITIONS_PATH)).toBe(positionsBefore + 3))
  stop()
  vi.useRealTimers()
})

test('a check runs under the site\'s Web Lock, so its tabs take turns', async () => {
  await Promise.all([checkSettings(), checkPositions()])
  const request = vi.fn((_name: string, work: () => Promise<unknown>) => work())
  vi.stubGlobal('navigator', { locks: { request } })
  await Promise.all([checkSettings(), checkPositions()])
  expect(request).toHaveBeenCalledWith('stub:settings', expect.any(Function))
  expect(request).toHaveBeenCalledWith('stub:positions', expect.any(Function))
  vi.unstubAllGlobals()
})

test('a resume point on its way to the account holds an update reload until it lands', async () => {
  await checkPositions()
  const { savePosition, positions } = await import('../../src/utils/watch-positions')
  const { createUpdateGate } = await import('../../src/update/gate')
  const { parseHTML } = await import('linkedom')
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const location = { pathname: '/', reload: vi.fn() }
  const session = new Map<string, string>()
  vi.stubGlobal('document', parseHTML('<!doctype html><html><head></head><body></body></html>').document)
  vi.stubGlobal('location', location)
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => { session.set(key, value) } })
  const party = { getState: () => ({ status: 'idle' }) as const }

  const check = checkPositions()
  createUpdateGate({ party }).due()
  expect(location.reload, 'the control: a check with nothing to save holds nothing').toHaveBeenCalledOnce()
  await check
  location.reload.mockClear()

  const gate = createUpdateGate({ party })
  const written = account.browser.state.writes.length

  // what leaving /watch does: the player's last point, then a flush
  savePosition('cr:S-A-E1', { time: 600, duration: 1440 })
  positions.flush()
  gate.due()
  expect(location.reload, 'held while the point is on its way').not.toHaveBeenCalled()
  await vi.waitFor(() => expect(account.browser.state.writes.slice(written).map(({ path }) => path)).toContain(POSITIONS_PATH))
  await vi.waitFor(() => {
    vi.advanceTimersByTime(1_000)
    expect(location.reload).toHaveBeenCalledOnce()
  })
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
