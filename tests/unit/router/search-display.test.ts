// The layout is the one piece of search page state that is NOT in the url: it says how a reader likes
// to look at results rather than what they asked for, so it has to survive the next search and must
// not travel with a shared link. That makes storage the codec, and a codec nobody pins is one that
// silently resets everyone's choice the day a value is renamed.
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_DISPLAY_MODE, DISPLAY_MODES, DISPLAY_MODE_KEY,
  parseDisplayMode, readDisplayMode, writeDisplayMode,
} from '../../../src/router/search/display'

const memoryStorage = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial))
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
  }
}

describe('parseDisplayMode', () => {
  test('every mode the toggle offers round-trips', () => {
    for (const mode of DISPLAY_MODES) expect(parseDisplayMode(mode)).toBe(mode)
  })

  test('a stale or hand-edited value falls back rather than rendering nothing', () => {
    expect(parseDisplayMode('table')).toBe(DEFAULT_DISPLAY_MODE)
    expect(parseDisplayMode('')).toBe(DEFAULT_DISPLAY_MODE)
    expect(parseDisplayMode(null)).toBe(DEFAULT_DISPLAY_MODE)
    expect(parseDisplayMode(undefined)).toBe(DEFAULT_DISPLAY_MODE)
  })
})

describe('readDisplayMode and writeDisplayMode', () => {
  test('a written mode reads back', () => {
    const storage = memoryStorage()
    writeDisplayMode('list', storage)
    expect(storage.store.get(DISPLAY_MODE_KEY)).toBe('list')
    expect(readDisplayMode(storage)).toBe('list')
  })

  test('an empty store is the default', () => {
    expect(readDisplayMode(memoryStorage())).toBe(DEFAULT_DISPLAY_MODE)
  })

  // A browser set to block site data THROWS on the accessor rather than answering null, and this runs
  // on the first render of a page that has to show results either way.
  test('a store that throws still renders a layout', () => {
    const hostile = {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    }
    expect(readDisplayMode(hostile)).toBe(DEFAULT_DISPLAY_MODE)
    expect(() => writeDisplayMode('card', hostile)).not.toThrow()
  })

  test('no store at all is not a crash', () => {
    expect(readDisplayMode(undefined)).toBe(DEFAULT_DISPLAY_MODE)
    expect(() => writeDisplayMode('card', undefined)).not.toThrow()
  })
})
