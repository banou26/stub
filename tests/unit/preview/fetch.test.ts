// The link preview's fetch (src/preview/fetch.ts) has to send the relay the bytes a page's cloud.fetch sends
// (fkn-client web/src/api/proxy/proxy-fetch.ts:22-116 at ab2bd1eb): the relay keys its cache on the method, the url
// those headers name, the packed headers and the body, so any other shape would miss every entry pages made.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

type Sent = { url: string, method: string, headers: Record<string, string>, body: unknown }

const PRAGUE = { id: 'cz-prg-001', region: 'eu', proxyOrigin: 'https://cz-prg-001.fkn.app/v0/', healthy: true, draining: false }
const HONG_KONG = { id: 'hk-hkg-001', region: 'asia', proxyOrigin: 'https://hk-hkg-001.fkn.app/v0/', healthy: true, draining: false }

let preview: typeof import('../../../src/preview/fetch')
let sent: Sent[]
let directoryReads: number
let relays: object[] | Error
let relay: (sent: Sent) => Response | Promise<Response>

beforeEach(async () => {
  vi.resetModules()
  preview = await import('../../../src/preview/fetch')
  sent = []
  directoryReads = 0
  relays = [HONG_KONG, PRAGUE]
  relay = () => new Response('{"ok":true}', { headers: { 'fkn-proxy-status': '200', 'fkn-proxy-headers': btoa(JSON.stringify({ 'content-type': 'application/json' })) } })
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    if (input === 'https://fkn.app/v1/relays') {
      directoryReads++
      if (relays instanceof Error) throw relays
      return Response.json({ relays })
    }
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => { headers[name] = value })
    const request = { url: input, method: init?.method ?? 'GET', headers, body: init?.body ?? null }
    sent.push(request)
    return relay(request)
  })
  return () => vi.unstubAllGlobals()
})

test('a request reaches the relay as cloud.fetch sends it', async () => {
  await preview.fetch('https://graphql.anilist.co/?x=1', {
    method: 'post',
    headers: { 'Content-Type': 'application/json', accept: 'application/json', 'x-title': 'café' },
    body: '{"query":"{Media(id:1){id}}"}',
  })
  await preview.fetch(new URL('https://kitsu.io/api/edge/anime/50024'))
  expect(sent).toEqual([
    {
      url: 'https://cz-prg-001.fkn.app/v0',
      method: 'POST',
      headers: {
        'cache-control': 'no-cache',
        'fkn-proxy-headers': btoa('{"accept":"application/json","content-type":"application/json","x-title":"café"}'),
        'fkn-proxy-hostname': 'graphql.anilist.co',
        'fkn-proxy-pathname': '/',
        'fkn-proxy-protocol': 'https',
        'fkn-proxy-search': '?x=1',
      },
      body: '{"query":"{Media(id:1){id}}"}',
    },
    {
      url: 'https://cz-prg-001.fkn.app/v0',
      method: 'GET',
      headers: {
        'cache-control': 'no-cache',
        'fkn-proxy-hostname': 'kitsu.io',
        'fkn-proxy-pathname': '/api/edge/anime/50024',
        'fkn-proxy-protocol': 'https',
        'fkn-proxy-search': '',
      },
      body: null,
    },
  ])
})

test('Netflix goes through the relay too, never from the edge itself', async () => {
  await preview.fetch('https://www.netflix.com/graphql', { method: 'POST', body: '{}', credentials: 'omit' })
  expect(sent.map(({ url, headers }) => [url, headers['fkn-proxy-hostname']])).toEqual([['https://cz-prg-001.fkn.app/v0', 'www.netflix.com']])
})

test('the answer is the upstream\'s, its status and headers unpacked, with the relay that served it named', async () => {
  relay = () => new Response('missing', { status: 200, headers: { 'fkn-proxy-status': '404', 'fkn-proxy-headers': btoa(JSON.stringify({ 'content-type': 'text/plain', 'fkn-relay': 'an-upstream' })) } })
  const missing = await preview.fetch('https://api.tvmaze.com/shows/0')
  expect(missing.status).toBe(404)
  expect(await missing.text()).toBe('missing')
  expect(Object.fromEntries(missing.headers)).toEqual({ 'content-type': 'text/plain', 'fkn-relay': 'cz-prg-001' })

  relay = () => new Response('ignored', { headers: { 'fkn-proxy-status': '204' } })
  const empty = await preview.fetch('https://example.com/')
  expect(empty.status).toBe(204)
  expect(empty.body).toBeNull()

  relay = () => new Response('the relay failed before the upstream', { status: 502 })
  expect((await preview.fetch('https://example.com/')).status).toBe(502)
})

test.each([
  { listed: [HONG_KONG, PRAGUE], asked: ['cz-prg-001', 'hk-hkg-001'] },
  { listed: [HONG_KONG, { ...PRAGUE, draining: true }], asked: ['hk-hkg-001'] },
  { listed: [HONG_KONG, { ...PRAGUE, healthy: false }], asked: ['hk-hkg-001'] },
  { listed: [HONG_KONG, { ...PRAGUE, proxyOrigin: undefined }], asked: ['hk-hkg-001'] },
])('the relays asked, Prague first, are the directory\'s healthy ones that serve a proxy: $asked', async ({ listed, asked }) => {
  relays = listed
  relay = () => { throw new TypeError('unreachable') }
  await expect(preview.fetch('https://example.com/')).rejects.toThrow('unreachable')
  expect(sent.map(({ url }) => new URL(url).hostname.split('.')[0])).toEqual(asked)
})

test('a relay that cannot be reached is asked of the next relay once, unless the caller gave up', async () => {
  relay = ({ url }) => {
    if (url.includes('cz-prg-001')) throw new TypeError('unreachable')
    return new Response('from Hong Kong', { headers: { 'fkn-proxy-status': '200' } })
  }
  const answered = await preview.fetch('https://example.com/')
  expect(await answered.text()).toBe('from Hong Kong')
  expect(answered.headers.get('fkn-relay')).toBe('hk-hkg-001')

  sent = []
  const controller = new AbortController()
  relay = () => {
    controller.abort()
    throw new DOMException('aborted', 'AbortError')
  }
  await expect(preview.fetch('https://example.com/', { signal: controller.signal })).rejects.toThrow('aborted')
  expect(sent).toHaveLength(1)
})

test('a spread request turns through the relays', async () => {
  for (let i = 0; i < 3; i++) await preview.fetch('https://graphql.anilist.co/', { spread: true })
  await preview.fetch('https://graphql.anilist.co/')
  expect(sent.map(({ url }) => new URL(url).hostname.split('.')[0])).toEqual(['cz-prg-001', 'hk-hkg-001', 'cz-prg-001', 'cz-prg-001'])
})

test('the directory is read once per copy, and read again after it failed', async () => {
  relays = new Error('directory unreachable')
  await expect(preview.fetch('https://example.com/')).rejects.toThrow('directory unreachable')
  relays = [PRAGUE]
  await preview.fetch('https://example.com/')
  await preview.fetch('https://example.com/')
  expect(directoryReads).toBe(2)
  expect(sent).toHaveLength(2)
})
