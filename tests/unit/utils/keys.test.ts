// The viewer's API keys: kept in this browser, with a copy in the worker that the sources are asked with.
// Clearing them has to clear both, or a source keeps answering with a key the viewer cleared.
import { beforeEach, expect, test, vi } from 'vitest'

import { API_KEYS_KEY } from '../../../src/sources/key-configs'

const worker = vi.hoisted(() => ({ setUserKeys: vi.fn(async (_keys: Record<string, string>) => {}) }))
vi.mock('../../../src/worker', () => worker)

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

const { clearKeys, loadKeys, saveKeys } = await import('../../../src/utils/keys')

beforeEach(() => {
  stored.clear()
  worker.setUserKeys.mockClear()
})

test('saving drops the blank fields, and hands the worker the same keys', async () => {
  await saveKeys({ omdb: 'a-key', tvdb: '' })
  expect(JSON.parse(stored.get(API_KEYS_KEY)!)).toEqual({ omdb: 'a-key' })
  expect(worker.setUserKeys).toHaveBeenLastCalledWith({ omdb: 'a-key' })
})

test('clearing removes the keys from this browser and from the worker, and nothing else', async () => {
  stored.set(API_KEYS_KEY, JSON.stringify({ omdb: 'a-key' }))
  stored.set('stub-search-display-mode', 'list')
  await clearKeys()
  expect(stored.has(API_KEYS_KEY)).toBe(false)
  expect(stored.get('stub-search-display-mode')).toBe('list')
  expect(loadKeys()).toEqual({})
  expect(worker.setUserKeys).toHaveBeenCalledTimes(1)
  expect(worker.setUserKeys).toHaveBeenCalledWith({})
})

test('clearing on a browser that blocks site data still empties the worker', async () => {
  vi.stubGlobal('localStorage', { removeItem: () => { throw new Error('SecurityError') }, getItem: () => null })
  try {
    await clearKeys()
    expect(worker.setUserKeys).toHaveBeenCalledWith({})
  } finally {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
  }
})
