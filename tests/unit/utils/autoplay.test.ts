// Whether an episode's end opens the next one by itself, kept in this browser: on until turned off.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { AUTOPLAY_KEY, readAutoplay, setAutoplay } from '../../../src/utils/autoplay'

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

test('on until turned off, and turning it on again keeps nothing', () => {
  expect(readAutoplay()).toBe(true)
  setAutoplay(false)
  expect(readAutoplay()).toBe(false)
  expect(stored.get(AUTOPLAY_KEY)).toBe('off')
  setAutoplay(true)
  expect(readAutoplay()).toBe(true)
  expect(stored.has(AUTOPLAY_KEY)).toBe(false)
})

test('storage that throws reads as on, and a write to it throws nothing', () => {
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
  expect(readAutoplay()).toBe(true)
  expect(() => setAutoplay(false)).not.toThrow()
})
