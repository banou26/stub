// How watch sources appear on the watch page, kept in this browser: cards until list is picked.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { readWatchSourceView, setWatchSourceView, WATCH_SOURCE_VIEW_KEY, watchWatchSourceView } from '../../../src/utils/watch-source-view'

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

test('cards until unified list is picked, and returning to cards removes the key', () => {
  expect(readWatchSourceView()).toBe('cards')
  stored.set(WATCH_SOURCE_VIEW_KEY, 'unexpected')
  expect(readWatchSourceView()).toBe('cards')

  setWatchSourceView('list')
  expect(readWatchSourceView()).toBe('list')
  expect(stored.get(WATCH_SOURCE_VIEW_KEY)).toBe('list')

  setWatchSourceView('cards')
  expect(readWatchSourceView()).toBe('cards')
  expect(stored.has(WATCH_SOURCE_VIEW_KEY)).toBe(false)
})

test('notifies watchers when changed', () => {
  const listener = vi.fn()
  const stop = watchWatchSourceView(listener)
  setWatchSourceView('list')
  setWatchSourceView('cards')
  expect(listener).toHaveBeenCalledTimes(2)
  stop()
})

test('storage that throws reads as cards, and a write to it throws nothing', () => {
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
  expect(readWatchSourceView()).toBe('cards')
  expect(() => setWatchSourceView('list')).not.toThrow()
})
