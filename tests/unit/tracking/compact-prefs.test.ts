import { describe, expect, test } from 'vite-plus/test'

import { COMPACT_PREFS_KEY, DEFAULT_COMPACT_PREFS, createCompactPrefs } from '../../../src/tracking/compact-prefs'

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, values }
}

describe('the compact row prefs', () => {
  test('start with every tracker written to', () => {
    expect(createCompactPrefs(memory()).read()).toEqual({ targets: {} })
  })

  test('read back what was written, under one key', () => {
    const storage = memory()
    const prefs = { targets: { mal: false } }
    createCompactPrefs(storage).write(prefs)
    expect(JSON.parse(storage.values.get(COMPACT_PREFS_KEY)!)).toEqual(prefs)
    expect(createCompactPrefs(storage).read()).toEqual(prefs)
  })

  test('malformed JSON, or a malformed field, reads as the defaults', () => {
    const storage = memory()
    storage.setItem(COMPACT_PREFS_KEY, '{nope')
    expect(createCompactPrefs(storage).read()).toEqual(DEFAULT_COMPACT_PREFS)
    storage.setItem(COMPACT_PREFS_KEY, JSON.stringify({ advanced: true, targets: { mal: 'no', stub: false }, noticed: 'anilist' }))
    expect(createCompactPrefs(storage).read()).toEqual({ targets: { stub: false } })
  })

  test('a storage that throws on read gives the defaults', () => {
    const storage = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
    expect(createCompactPrefs(storage).read()).toEqual(DEFAULT_COMPACT_PREFS)
  })

  test('a storage that throws on write keeps the choice for this page', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('blocked') } }
    const prefs = createCompactPrefs(storage)
    prefs.write({ targets: { mal: false } })
    expect(prefs.read().targets).toEqual({ mal: false })
  })
})
