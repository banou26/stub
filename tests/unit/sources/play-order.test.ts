// The order Play tries sources in, a setting that follows the FKN account: stub's players first until the
// viewer moves one, added sources after them, and a value stub cannot read keeps nothing.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import { DEFAULT_PLAY_ORDER, moved, PLAY_ORDER_KEY, playOrder, readPlayOrder, watchPlayOrder, writePlayOrder } from '../../../src/sources/play-order'

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

test('sources the viewer never moved go after the ones they did, stub\'s players before added sources', () => {
  expect(DEFAULT_PLAY_ORDER).toEqual(['cr', 'amazon', 'nf'])
  expect(playOrder([], ['nyaa'])).toEqual(['cr', 'amazon', 'nf', 'nyaa'])
  expect(playOrder(['nyaa', 'nf'], ['nyaa', 'other'])).toEqual(['nyaa', 'nf', 'cr', 'amazon', 'other'])
})

test('a move swaps a source with its neighbour, and does nothing past either end', () => {
  expect(moved(['cr', 'amazon', 'nf'], 'nf', -1)).toEqual(['cr', 'nf', 'amazon'])
  expect(moved(['cr', 'amazon', 'nf'], 'cr', 1)).toEqual(['amazon', 'cr', 'nf'])
  expect(moved(['cr', 'amazon', 'nf'], 'cr', -1)).toEqual(['cr', 'amazon', 'nf'])
  expect(moved(['cr', 'amazon', 'nf'], 'nf', 1)).toEqual(['cr', 'amazon', 'nf'])
})

// a source turned off, or a package still connecting, keeps its place for when it is back
test('a move past a source the list does not show keeps how every other source ranks against it', () => {
  expect(moved(['nyaa', 'cr', 'amazon', 'nf'], 'amazon', -1, ['cr', 'amazon', 'nf'])).toEqual(['nyaa', 'amazon', 'cr', 'nf'])
  expect(moved(['cr', 'amazon', 'nf'], 'nf', -1, ['cr', 'nf'])).toEqual(['nf', 'cr', 'amazon'])
  expect(moved(['cr', 'amazon', 'nf'], 'cr', 1, ['cr', 'nf'])).toEqual(['amazon', 'nf', 'cr'])
  expect(moved(['nyaa', 'cr', 'amazon'], 'cr', -1, ['cr', 'amazon'])).toEqual(['nyaa', 'cr', 'amazon'])
})

// a card dropped onto another card's place
test('a move of several places lands just past that source, keeps a source the list does not show where it was, and a drop on its own place moves nothing', () => {
  const order = ['a', 'b', 'hidden', 'c', 'd', 'e']
  const shown = ['a', 'b', 'c', 'd', 'e']
  expect(moved(order, 'a', 3, shown)).toEqual(['b', 'hidden', 'c', 'd', 'a', 'e'])
  expect(moved(order, 'd', -2, shown)).toEqual(['a', 'd', 'b', 'hidden', 'c', 'e'])
  expect(moved(order, 'e', -4, shown)).toEqual(['e', 'a', 'b', 'hidden', 'c', 'd'])
  expect(moved(order, 'b', 4, shown), 'past the end').toEqual(order)
  expect(moved(order, 'c', 0, shown)).toEqual(order)
  expect(moved(order, 'e', 0, shown)).toEqual(order)
})

test('an order written is read back, and a kept value stub cannot read keeps nothing', () => {
  expect(readPlayOrder()).toEqual([])
  writePlayOrder(['nyaa', 'cr'])
  expect(stored.get(PLAY_ORDER_KEY)).toBe('["nyaa","cr"]')
  expect(readPlayOrder()).toEqual(['nyaa', 'cr'])
  for (const kept of ['not json', '{"cr":0}', 'null', '[1,"cr"]']) {
    stored.set(PLAY_ORDER_KEY, kept)
    expect(readPlayOrder(), kept).toEqual(kept === '[1,"cr"]' ? ['cr'] : [])
  }
})

test('with the FKN account\'s settings in use, the order is the account\'s, and a write changes the account\'s copy', () => {
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [PLAY_ORDER_KEY]: '["nf"]' }))
  stored.set(PLAY_ORDER_KEY, '["cr"]')
  expect(readPlayOrder()).toEqual(['nf'])
  writePlayOrder(['amazon', 'nf'])
  expect(JSON.parse(stored.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [PLAY_ORDER_KEY]: '["amazon","nf"]' })
  expect(stored.get(PLAY_ORDER_KEY), 'this browser\'s own untouched').toBe('["cr"]')
})

test('a watcher hears this tab\'s changes, another tab\'s and the account\'s, and nothing once stopped', () => {
  // the window another tab's storage event arrives on, which node has none of
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  const otherTab = (key: string | null) => page.dispatchEvent(Object.assign(new Event('storage'), { key }))
  const listener = vi.fn()
  const stop = watchPlayOrder(listener)
  writePlayOrder(['nf'])
  otherTab(PLAY_ORDER_KEY)
  otherTab(null)
  otherTab(ACCOUNT_SETTINGS_KEY)
  otherTab('some-other-key')
  expect(listener).toHaveBeenCalledTimes(4)
  stop()
  writePlayOrder(['cr'])
  otherTab(PLAY_ORDER_KEY)
  expect(listener).toHaveBeenCalledTimes(4)
})
