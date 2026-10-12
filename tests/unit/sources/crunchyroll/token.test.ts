import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

const TOKEN_URL = 'https://www.crunchyroll.com/auth/v1/token'
const NOW = Date.parse('2026-10-13T00:00:00Z')

const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`

type Answer = { access_token: string, expires_in: number }

// FKN's relay as stub sees it: one answer per exact request (url, options and body), never dropped here,
// so an entry keeps answering the way one held past its token's life does.
const relay = (mint: () => Answer) => {
  const cache = new Map<string, Answer>()
  const tokenRequests: string[] = []
  const bearers: string[] = []
  const ctx = {
    fetch: async (url: string, init: RequestInit) => {
      if (url.startsWith(TOKEN_URL)) {
        const key = JSON.stringify([url, init])
        tokenRequests.push(key)
        if (!cache.has(key)) cache.set(key, mint())
        const answer = cache.get(key)
        return { json: async () => answer }
      }
      bearers.push((init.headers as Record<string, string>).authorization!)
      return { json: async () => ({ data: [{ episode_metadata: { series_id: 'GSERIES', season_id: 'GSEASON' } }] }) }
    },
  } as never
  return { ctx, tokenRequests, bearers }
}

// a fresh module is a fresh viewer, since the token a viewer holds lives in the module
const viewer = async () => {
  vi.resetModules()
  return (await import('../../../../src/sources/crunchyroll/extractor')).resolveEpisodeToSeriesId
}

const at = (ms: number) => vi.setSystemTime(NOW + ms)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  at(0)
})
afterEach(() => { vi.useRealTimers() })

test('a cached token minted an hour ago lives until its own exp, then a request of its own replaces it', async () => {
  let minted = 0
  const { ctx, tokenRequests, bearers } = relay(() => minted++ === 0
    // what the cache holds 59 min 30 s after the mint: expires_in still reads 3600
    ? { access_token: jwt({ exp: (NOW + 30_000) / 1000, n: 'cached' }), expires_in: 3600 }
    : { access_token: jwt({ exp: Date.now() / 1000 + 3600, n: 'fresh' }), expires_in: 3600 })
  const lookup = await viewer()

  await lookup('GEPISODE1', ctx)
  at(29_000)
  await lookup('GEPISODE2', ctx)
  expect(tokenRequests).toHaveLength(1)

  at(31_000)
  await lookup('GEPISODE3', ctx)
  // the shared request is asked first, and only its stale answer sends the one that differs
  expect(tokenRequests).toHaveLength(3)
  expect(tokenRequests[1]).toBe(tokenRequests[0])
  expect(tokenRequests[2]).not.toBe(tokenRequests[0])
  expect(bearers[1]).toBe(bearers[0])
  expect(bearers[2]).not.toBe(bearers[0])
})

test('two viewers within the token\'s life send byte-identical requests, so the cache shares one token', async () => {
  let minted = 0
  const { ctx, tokenRequests, bearers } = relay(() => ({ access_token: jwt({ exp: Date.now() / 1000 + 3600, n: minted++ }), expires_in: 3600 }))

  await (await viewer())('GEPISODE1', ctx)
  at(20 * 60_000)
  await (await viewer())('GEPISODE2', ctx)

  expect(tokenRequests).toHaveLength(2)
  expect(tokenRequests[1]).toBe(tokenRequests[0])
  expect(minted).toBe(1)
  expect(bearers[1]).toBe(bearers[0])
})

test.each([
  ['an opaque token', 'opaque-token'],
  ['a JWT with no exp', jwt({ country: 'JP' })],
])('%s lives from receipt for its expires_in', async (_, access_token) => {
  const { ctx, tokenRequests } = relay(() => ({ access_token, expires_in: 3600 }))
  const lookup = await viewer()

  await lookup('GEPISODE1', ctx)
  at(3_599_000)
  await lookup('GEPISODE2', ctx)
  expect(tokenRequests).toHaveLength(1)

  at(3_601_000)
  await lookup('GEPISODE3', ctx)
  expect(tokenRequests).toHaveLength(2)
  expect(tokenRequests[1]).toBe(tokenRequests[0])
})
