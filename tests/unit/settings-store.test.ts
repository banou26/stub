// The settings that follow the FKN account, as the page reads and writes them: this browser's own values
// while no account's settings are in use here, the account's copy while they are.
import { afterEach, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_SETTINGS_KEY, createSettings } from '../../src/settings-store'

const OFF = 'stub.sources.disabled'
const AUTOPLAY = 'stub.player.autoplay'
const COUNTRY = 'stub.country'

const memory = () => {
  const items = new Map<string, string>()
  return {
    items,
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
      removeItem: (key: string) => { items.delete(key) },
    },
  }
}

afterEach(() => { vi.unstubAllGlobals() })

test('with no account\'s settings in use, a setting reads and writes this browser\'s own key', () => {
  const { items, storage } = memory()
  const settings = createSettings(() => storage)
  expect(settings.getItem(OFF)).toBe(null)
  settings.setItem(OFF, '["simkl"]')
  expect(items.get(OFF)).toBe('["simkl"]')
  expect(settings.getItem(OFF)).toBe('["simkl"]')
  settings.removeItem(OFF)
  expect(items.has(OFF)).toBe(false)
})

test('with the account\'s settings in use, the account\'s value wins, a key it lacks is this browser\'s own, and a write changes the account\'s copy', () => {
  const { items, storage } = memory()
  items.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [OFF]: '["trakt"]', [AUTOPLAY]: null }))
  items.set(OFF, '["simkl"]')
  items.set(AUTOPLAY, 'off')
  items.set(COUNTRY, 'JP')
  const settings = createSettings(() => storage)
  expect(settings.getItem(OFF)).toBe('["trakt"]')
  expect(settings.getItem(AUTOPLAY), 'set back to its default on the account, over this browser\'s own').toBe(null)
  expect(settings.getItem(COUNTRY)).toBe('JP')

  settings.setItem(COUNTRY, 'GB')
  expect(JSON.parse(items.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [OFF]: '["trakt"]', [AUTOPLAY]: null, [COUNTRY]: 'GB' })
  expect(items.get(COUNTRY)).toBe('JP')
  expect(settings.internal.edits.get(COUNTRY), 'kept for the account until written').toBe('GB')
})

test('a write this browser refuses throws after its watchers heard it, and a read never throws', () => {
  const blocked = () => { throw new Error('blocked') }
  const settings = createSettings(() => ({ getItem: blocked, setItem: blocked, removeItem: blocked }))
  const heard = vi.fn()
  settings.watch(OFF, heard)
  expect(settings.getItem(OFF)).toBe(null)
  expect(() => settings.setItem(OFF, '["simkl"]')).toThrow('blocked')
  expect(heard).toHaveBeenCalledTimes(1)
  expect(createSettings(() => undefined as unknown as Storage).getItem(OFF), 'no storage at all, as in the worker').toBe(null)
})

test('a watcher hears this tab, another tab\'s change to its key, to the account\'s copy or to all of them, and nothing once stopped', () => {
  const page = new EventTarget()
  vi.stubGlobal('addEventListener', page.addEventListener.bind(page))
  vi.stubGlobal('removeEventListener', page.removeEventListener.bind(page))
  const otherTab = (key: string | null) => page.dispatchEvent(Object.assign(new Event('storage'), { key }))
  const settings = createSettings(() => memory().storage)
  const heard = vi.fn()
  const stop = settings.watch(OFF, heard)
  settings.setItem(OFF, '[]')
  otherTab(OFF)
  otherTab(ACCOUNT_SETTINGS_KEY)
  otherTab(AUTOPLAY)
  settings.setItem(AUTOPLAY, 'off')
  expect(heard).toHaveBeenCalledTimes(3)
  otherTab(null)
  expect(heard, 'another tab cleared the storage').toHaveBeenCalledTimes(4)
  stop()
  settings.setItem(OFF, '[]')
  otherTab(OFF)
  expect(heard).toHaveBeenCalledTimes(4)
})
