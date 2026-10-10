// Which built-in sources the viewer turned off, kept in this browser: every source is on until turned
// off, and a value stub cannot read turns nothing off.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { DISABLED_SOURCES_KEY, readDisabledSources, setSourceEnabled, turnAllSourcesOn, watchDisabledSources } from '../../../src/sources/disabled-sources'

const stored = new Map<string, string>()
const memory = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
}
beforeEach(() => { stored.clear(); vi.stubGlobal('localStorage', memory) })
afterEach(() => { vi.unstubAllGlobals() })

test('nothing kept turns nothing off', () => {
  expect(readDisabledSources()).toEqual([])
})

test('a source turned off is kept, once, and turning it on again keeps nothing', () => {
  setSourceEnabled('simkl', false)
  setSourceEnabled('simkl', false)
  setSourceEnabled('tvdb', false)
  expect(readDisabledSources()).toEqual(['simkl', 'tvdb'])
  setSourceEnabled('simkl', true)
  setSourceEnabled('tvdb', true)
  expect(stored.has(DISABLED_SOURCES_KEY), 'all on leaves no key behind').toBe(false)
})

test('turning all on clears every source turned off', () => {
  setSourceEnabled('simkl', false)
  setSourceEnabled('omdb', false)
  turnAllSourcesOn()
  expect(readDisabledSources()).toEqual([])
})

test('a kept value stub cannot read turns nothing off, and an entry that is not an origin is dropped', () => {
  for (const kept of ['not json', '{"simkl":true}', '"simkl"', 'null']) {
    stored.set(DISABLED_SOURCES_KEY, kept)
    expect(readDisabledSources(), kept).toEqual([])
  }
  stored.set(DISABLED_SOURCES_KEY, JSON.stringify(['simkl', 3, null]))
  expect(readDisabledSources()).toEqual(['simkl'])
})

test('storage that throws turns nothing off and loses no listener call', () => {
  const listener = vi.fn()
  const stop = watchDisabledSources(listener)
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } })
  expect(readDisabledSources()).toEqual([])
  expect(() => setSourceEnabled('simkl', false)).not.toThrow()
  expect(() => turnAllSourcesOn()).not.toThrow()
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
})

test('a watcher hears this tab\'s changes and another tab\'s, and nothing once stopped', () => {
  // the window another tab's storage event arrives on, which node has none of
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  const otherTab = (key: string) => page.dispatchEvent(Object.assign(new Event('storage'), { key }))
  const listener = vi.fn()
  const stop = watchDisabledSources(listener)
  setSourceEnabled('simkl', false)
  otherTab(DISABLED_SOURCES_KEY)
  otherTab('some-other-key')
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
  setSourceEnabled('simkl', true)
  otherTab(DISABLED_SOURCES_KEY)
  expect(listener).toHaveBeenCalledTimes(2)
})
