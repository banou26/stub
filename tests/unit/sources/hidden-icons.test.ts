// Which sources' icons the viewer hid, kept in this browser: every icon shows until hidden, and a value
// stub cannot read hides nothing.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { HIDDEN_ICONS_KEY, readHiddenIcons, setIconShown, watchHiddenIcons } from '../../../src/sources/hidden-icons'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

test('an icon hidden is kept, once, and showing it again keeps nothing', () => {
  expect(readHiddenIcons()).toEqual([])
  setIconShown('tvdb', false)
  setIconShown('tvdb', false)
  setIconShown('ann', false)
  expect(readHiddenIcons()).toEqual(['tvdb', 'ann'])
  setIconShown('tvdb', true)
  setIconShown('ann', true)
  expect(stored.has(HIDDEN_ICONS_KEY)).toBe(false)
})

test('a kept value stub cannot read hides nothing', () => {
  for (const kept of ['not json', '{"tvdb":true}', 'null']) {
    stored.set(HIDDEN_ICONS_KEY, kept)
    expect(readHiddenIcons(), kept).toEqual([])
  }
})

test('a watcher hears this tab\'s changes and another tab\'s, and nothing once stopped', () => {
  // the window another tab's storage event arrives on, which node has none of
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  const otherTab = (key: string) => page.dispatchEvent(Object.assign(new Event('storage'), { key }))
  const listener = vi.fn()
  const stop = watchHiddenIcons(listener)
  setIconShown('tvdb', false)
  otherTab(HIDDEN_ICONS_KEY)
  otherTab('some-other-key')
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
  setIconShown('tvdb', true)
  otherTab(HIDDEN_ICONS_KEY)
  expect(listener).toHaveBeenCalledTimes(2)
})
