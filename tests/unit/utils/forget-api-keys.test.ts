import { expect, test } from 'vite-plus/test'

import { forgetApiKeys, LEGACY_API_KEYS_KEY } from '../../../src/utils/forget-api-keys'

const memory = (initial: Record<string, string>) => {
  const values = new Map(Object.entries(initial))
  return { removeItem: (key: string) => { values.delete(key) }, values }
}

test('removes the keys a viewer pasted before, and nothing else', () => {
  const local = memory({ [LEGACY_API_KEYS_KEY]: JSON.stringify({ omdb: 'a-key' }), 'stub.sessions': '["anilist"]' })
  forgetApiKeys(() => local)

  expect(Object.fromEntries(local.values)).toEqual({ 'stub.sessions': '["anilist"]' })
})

test('is the key stub kept them under', () => {
  expect(LEGACY_API_KEYS_KEY).toBe('stub.apikeys')
})

test('throws nothing on a browser that blocks site data', () => {
  expect(() => forgetApiKeys(() => { throw new Error('SecurityError') })).not.toThrow()
})
