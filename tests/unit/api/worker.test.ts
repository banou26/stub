import type { Env } from '../../../api/src/index'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import worker from '../../../api/src/index'

// stub's offline data as the build bundles it: Cowboy Bebop with a title, MyAnimeList's cover, and Kitsu's banner and
// synopsis; its film with a title and no picture
vi.mock('../../../src/generated/anime-index', () => ({ default: { mal: [1], anilist: [0], kitsu: [1], anidb: [23], ann: [13] } }))
vi.mock('../../../src/generated/anime-seasons', () => ({ default: { tag: 'test', updated: '', seasons: {} } }))
vi.mock('../../../src/sources/offline/history-shards', () => {
  const sets: Record<string, Record<number, Record<string, unknown>>> = {
    dump: { 1: { 'mal-1': ['Cowboy Bebop', '4/19644.jpg'] }, 5: { 'mal-5': ['Cowboy Bebop: Tengoku no Tobira', ''] } },
    kitsu: { 1: { 'mal-1': { b: 'cover_images/1/original.jpg', d: 'In the year 2071, humanity has colonized several of the planets.' } } },
  }
  return { loadShard: async (set: string, shard: number) => sets[set]?.[shard] && { records: sets[set]![shard] } }
})
// what running stub's sources boots, which the route must never reach
const booted = vi.hoisted(() => [] as string[])
vi.mock('../../../src/worker/resolvers', () => {
  booted.push('resolvers')
  throw new Error('the public route ran a source')
})
vi.mock('../../../src/worker/graph', () => {
  booted.push('graph')
  throw new Error('the public route ran a source')
})

const BEBOP = {
  uri: 'ag:(anidb:23,ann:13,kitsu:1,mal:1,offline:mal-1)',
  title: 'Cowboy Bebop',
  description: 'In the year 2071, humanity has colonized several of the planets.',
  cover: 'https://cdn.myanimelist.net/images/anime/4/19644l.webp',
  banner: 'https://media.kitsu.app/anime/cover_images/1/original.jpg',
}
const FRIEREN = { uri: 'ag:(anilist:195604,mal:61967)', title: 'Frieren: Beyond Journey\'s End Season 2', cover: 'https://s4.anilist.co/frieren.jpg' }

const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const toBase36 = (text: string) => {
  let value = 0n
  for (const byte of new TextEncoder().encode(text)) value = value * 256n + BigInt(byte)
  let out = ''
  for (; value > 0n; value /= 36n) out = BASE36[Number(value % 36n)] + out
  return out
}
const STUB_APP = '173elff365hgaijng4mufbd4zo6lypfskb3zdd5jkpgd4hj4ovjjq'
const versionLabel = (length: number) => `0${toBase36(`npm:@banou/stub@0.0.${'1'.repeat(length)}`)}`

let reads: string[][]
let stored: Record<string, unknown>
let limited: string[]
let allow: boolean
let fetched: ReturnType<typeof vi.fn>

const env = (): Env => ({
  STORE: {
    get: async keys => {
      reads.push(keys)
      return new Map(keys.map(key => [key, stored[key] ?? null]))
    },
  },
  LIMIT: {
    limit: async ({ key }) => {
      limited.push(key)
      return { success: allow }
    },
  },
})

const call = (path: string, headers: Record<string, string> = { origin: 'https://anime.fkn.app' }, method = 'GET') =>
  worker.fetch(new Request(`https://api.stub.banou.dev${path}`, { method, headers }), env())

beforeEach(() => {
  reads = []
  stored = {}
  limited = []
  allow = true
  fetched = vi.fn(async () => { throw new Error('nothing is fetched here') })
  vi.stubGlobal('fetch', fetched)
})

// every test: an engine module is imported once per file, so only a check after each one sees the first to reach it
afterEach(() => {
  expect(booted).toEqual([])
  expect(fetched).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

describe('access', () => {
  test('the label fkn.app gives stub is base36 of its package address', () => {
    // measured on https://fkn.app/app/npm:@banou/stub, 2026-10-24
    expect(`0${toBase36('npm:@banou/stub')}`).toBe('0x3lk9k4779agjbj1og4i6hu')
  })

  test('the longest version label is the longest a DNS label can be, and one more byte goes past it', () => {
    expect(versionLabel(20)).toHaveLength(63)
    expect(versionLabel(21)).toHaveLength(65)
  })

  test.each([
    'https://stub.fkn.app',
    'https://anime.fkn.app',
    'https://movies.fkn.app',
    'https://series.fkn.app',
    'https://0x3lk9k4779agjbj1og4i6hu.sdbx.app',
    `https://0${toBase36('npm:@banou/stub@0.0.59')}.sdbx.app`,
    `https://${versionLabel(20)}.sdbx.app`,
    `https://00a${STUB_APP}.sdbx.app`,
    `https://b0a${STUB_APP}.sdbx.app`,
  ])('%s is answered, with its origin echoed', async origin => {
    const response = await call('/v1/media/ag:(mal:1)?site=anime', { origin })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('vary')).toBe('origin')
    expect(response.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  test('a stub page\'s Referer stands in when there is no Origin', async () => {
    const response = await call('/v1/media/ag:(mal:1)?site=anime', { referer: 'https://anime.fkn.app/title/ag:(mal:1)' })
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://anime.fkn.app')
  })

  test.each([
    ['another package\'s label', { origin: `https://0${toBase36('npm:@banou/ripple')}.sdbx.app` }],
    ['a package whose name starts with stub\'s', { origin: `https://0${toBase36('npm:@banou/stub-extra')}.sdbx.app` }],
    ['a version holding a path', { origin: `https://0${toBase36('npm:@banou/stub@1/../../@evil/pkg')}.sdbx.app` }],
    ['a version holding another address', { origin: `https://0${toBase36('npm:@banou/stub@npm:@evil/pkg')}.sdbx.app` }],
    ['stub\'s version label past one DNS label', { origin: `https://${versionLabel(21)}.sdbx.app` }],
    ['another app\'s signed label', { origin: `https://00a1${'b'.repeat(52)}.sdbx.app` }],
    ['another sdbx.app host', { origin: 'https://proxy.sdbx.app' }],
    ['a site mirage shows', { origin: 'https://s-x3lk9k4779agjbj1og4i6hu.sdbx.app' }],
    ['a host under stub\'s label', { origin: 'https://a.0x3lk9k4779agjbj1og4i6hu.sdbx.app' }],
    ['stub\'s label under another domain', { origin: 'https://0x3lk9k4779agjbj1og4i6hu.sdbx.app.example.com' }],
    ['stub\'s label over http', { origin: 'http://0x3lk9k4779agjbj1og4i6hu.sdbx.app' }],
    ['stub\'s label on another port', { origin: 'https://0x3lk9k4779agjbj1og4i6hu.sdbx.app:8443' }],
    ['a stub site over http', { origin: 'http://stub.fkn.app' }],
    ['a host ending in a stub site', { origin: 'https://stub.fkn.app.example.com' }],
    ['a foreign site', { origin: 'https://example.com' }],
    // not on the allow-list until the owner says the previews belong on it
    ['a Pages preview', { origin: 'https://stub-ben.pages.dev' }],
    ['a branch\'s Pages preview', { origin: 'https://feat-x.stub-ben.pages.dev' }],
    ['an opaque origin', { origin: 'null' }],
    ['a foreign Origin with a stub Referer', { origin: 'https://example.com', referer: 'https://stub.fkn.app/' }],
    ['a foreign Referer', { referer: 'https://example.com/' }],
    ['no Origin and no Referer', {}],
  ])('%s is refused with no CORS header', async (_, headers) => {
    const response = await call('/v1/media/ag:(mal:1)?site=anime', headers)
    expect(response.status).toBe(403)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(reads).toEqual([])
  })
})

describe('the media route', () => {
  test('a show the history holds with a title and a cover is answered from it, with no store read', async () => {
    const response = await call('/v1/media/ag:(kitsu:1)?site=anime')
    expect(await response.json()).toEqual({ ...BEBOP, from: 'history' })
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(reads).toEqual([])
  })

  test('a bare or percent-encoded address is read as the page reads it', async () => {
    expect(await (await call('/v1/media/mal:1')).json()).toEqual({ ...BEBOP, from: 'history' })
    expect(await (await call('/v1/media/ag%3A(mal%3A1)')).json()).toEqual({ ...BEBOP, from: 'history' })
  })

  test('a show the history lacks is read from the store, under every id of its address, in one read', async () => {
    stored['anime/mal:61967'] = { ...FRIEREN, status: 'RELEASING', at: 1 }
    const response = await call('/v1/media/ag:(anilist:195604,mal:61967)?site=anime')
    expect(await response.json()).toEqual({ ...FRIEREN, from: 'store' })
    expect(reads).toEqual([['anime/anilist:195604', 'anime/mal:61967']])
  })

  test.each([
    ['a show it holds with a title and no cover', '/v1/media/ag:(mal:5)?site=anime', [['anime/mal:5']]],
    ['a show it holds, on movies, which never asks it', '/v1/media/ag:(mal:1)?site=movie', [['movie/mal:1']]],
    ['a show it holds, on series, which never asks it', '/v1/media/ag:(mal:1)?site=series', [['series/mal:1']]],
  ])('%s is not answered from the history', async (_, path, keys) => {
    expect((await call(path)).status).toBe(404)
    expect(reads).toEqual(keys)
  })

  test('a long address asks the store within KV\'s limits: 100 keys a read, 512 bytes a key', async () => {
    const ids = [`aa:${'x'.repeat(600)}`, ...Array.from({ length: 150 }, (_, index) => `anilist:${1000 + index}`)]
    expect((await call(`/v1/media/ag:(${ids.join(',')})?site=anime`)).status).toBe(404)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toHaveLength(100)
    expect(reads[0]![0]).toBe('anime/anilist:1000')
  })

  test('the store keeps a site\'s answer apart from another site\'s', async () => {
    stored['movie/jw:985864'] = { uri: 'ag:(jw:985864)', title: 'A Film' }
    expect((await call('/v1/media/ag:(jw:985864)?site=series')).status).toBe(404)
    expect((await call('/v1/media/ag:(jw:985864)?site=movie')).status).toBe(200)
  })

  test('a show neither holds is not found, and no source is run for it', async () => {
    const missed = await call('/v1/media/ag:(anilist:195604)?site=anime')
    expect(missed.status).toBe(404)
    expect(missed.headers.get('access-control-allow-origin')).toBe('https://anime.fkn.app')
    expect((await call('/v1/media/ag:(mal:999)?site=stub')).status).toBe(404)
    expect(reads).toEqual([['anime/anilist:195604'], ['stub/mal:999']])
  })

  test.each([
    ['not an address', '/v1/media/hello'],
    ['an empty address', '/v1/media/ag:()'],
    ['an id holding a comma', '/v1/media/anilist:1,2'],
    ['an unknown site', '/v1/media/ag:(mal:1)?site=games'],
  ])('%s is not found, with nothing read', async (_, path) => {
    expect((await call(path)).status).toBe(404)
    expect(reads).toEqual([])
  })

  test.each([
    ['another path', '/v1/media', 'GET'],
    ['a path under an address', '/v1/media/ag:(mal:1)/episodes', 'GET'],
    ['a POST', '/v1/media/ag:(mal:1)', 'POST'],
  ])('%s is not found', async (_, path, method) => {
    const response = await call(path, { origin: 'https://anime.fkn.app' }, method)
    expect(response.status).toBe(404)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('/health answers ok', async () => {
    const response = await call('/health', {})
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })
})

describe('the rate limit', () => {
  test('is keyed by the route alone, never by anything about the caller', async () => {
    await call('/v1/media/ag:(mal:1)', { origin: 'https://stub.fkn.app', 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0' })
    await call('/v1/media/ag:(mal:2)', { origin: 'https://0x3lk9k4779agjbj1og4i6hu.sdbx.app', 'cf-connecting-ip': '198.51.100.4' })
    expect(limited).toEqual(['media', 'media'])
  })

  test('past it, the route answers 429 and reads nothing', async () => {
    allow = false
    const response = await call('/v1/media/ag:(anilist:195604)?site=anime')
    expect(response.status).toBe(429)
    expect(response.headers.get('access-control-allow-origin')).toBe('https://anime.fkn.app')
    expect(response.headers.get('cache-control')).toBeNull()
    expect(reads).toEqual([])
  })

  test('a refused origin does not count against it', async () => {
    await call('/v1/media/ag:(mal:1)', { origin: 'https://example.com' })
    expect(limited).toEqual([])
  })
})
