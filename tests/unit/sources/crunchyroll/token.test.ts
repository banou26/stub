import type { RelayChoice } from '@fkn/lib'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

const TOKEN_URL = 'https://www.crunchyroll.com/auth/v1/token'
const NOW = Date.parse('2026-10-13T00:00:00Z')
const PRAGUE = 'cz-prg-001'
const HONG_KONG = 'hk-hkg-001'
const COUNTRY: Record<string, string> = { [PRAGUE]: 'CZ', [HONG_KONG]: 'HK' }

const jwt = (claims: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
const claimsOf = (bearer: string) => JSON.parse(Buffer.from(bearer.split('.')[1]!, 'base64url').toString())

type Answer = { access_token: string, expires_in: number }
type Init = RequestInit & { relay?: RelayChoice }
type TokenRequest = { key: string, url: string, relay?: string, pinned?: string }

let minted = 0
const fresh = (relay: string | undefined) =>
  ({ access_token: jwt({ exp: Date.now() / 1000 + 3600, country: relay && COUNTRY[relay], n: minted++ }), expires_in: 3600 })

// FKN's relays as stub sees them: ONE cache shared by every relay, answering a request (url, options and body,
// never the relay it went through) with whatever the first relay to send it minted, never dropped here, so an
// entry keeps answering the way one held past its token's life does. A request goes through the relay its
// choice names, else the viewer's default, and the answer names the relay in `fkn-relay`; with no default,
// no answer names one. Crunchyroll mints a token of the minting relay's country, as measured through Prague
// (CZ) and Hong Kong (HK) on 2026-10-13.
const network = (mint: (relay: string | undefined) => Answer = fresh) => {
  const state = { default: PRAGUE as string | undefined, afterToken: undefined as undefined | ((request: TokenRequest) => void) }
  const cache = new Map<string, Answer>()
  const tokenRequests: TokenRequest[] = []
  const bearers: string[] = []
  const ctx = {
    fetch: async (url: string, { relay: choice, ...init }: Init) => {
      const relay = choice?.id ?? state.default
      const headers = relay ? { 'fkn-relay': relay } : undefined
      if (url.startsWith(TOKEN_URL)) {
        const request = { key: JSON.stringify([url, init]), url, relay, pinned: choice?.id }
        tokenRequests.push(request)
        if (!cache.has(request.key)) cache.set(request.key, mint(relay))
        const answer = cache.get(request.key)
        state.afterToken?.(request)
        return new Response(JSON.stringify(answer), { headers })
      }
      bearers.push((init.headers as Record<string, string>).authorization!)
      return new Response(JSON.stringify({ data: [{ episode_metadata: { series_id: 'GSERIES', season_id: 'GSEASON' } }] }), { headers })
    },
  }
  const countries = () => bearers.map(bearer => claimsOf(bearer).country)
  return { ctx: ctx as never, fetch: ctx.fetch, state, tokenRequests, bearers, countries }
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
  minted = 0
})
afterEach(() => { vi.useRealTimers() })

test('a viewer on Hong Kong gets a Hong Kong token, though Prague minted the shared request seconds before', async () => {
  const net = network()

  await (await viewer())('GEPISODE1', net.ctx)
  at(3_000)
  net.state.default = HONG_KONG
  await (await viewer())('GEPISODE1', net.ctx)

  expect(net.countries()).toEqual(['CZ', 'HK'])
})

test('the token request differs per relay, and each relay\'s viewers share theirs', async () => {
  const net = network()
  const ask = async (relay: string) => {
    net.state.default = relay
    const from = net.tokenRequests.length
    await (await viewer())('GEPISODE1', net.ctx)
    return net.tokenRequests.slice(from).at(-1)!
  }
  const prague = await ask(PRAGUE)
  const hongKong = await ask(HONG_KONG)
  at(20 * 60_000)
  const pragueAgain = await ask(PRAGUE)

  expect(hongKong.key).not.toBe(prague.key)
  expect(prague.url).toContain(`fkn_relay=${PRAGUE}`)
  expect(hongKong.url).toContain(`fkn_relay=${HONG_KONG}`)
  expect(pragueAgain.key).toBe(prague.key)
  expect(net.bearers[2]).toBe(net.bearers[0])
  expect(net.bearers[1]).not.toBe(net.bearers[0])
})

test('a request naming a relay goes through that relay alone, so its entry never holds another relay\'s token', async () => {
  const net = network()
  // the viewer's default moves to Hong Kong between the shared request and the one naming Prague
  net.state.afterToken = ({ url }) => { if (url === TOKEN_URL) net.state.default = HONG_KONG }

  await (await viewer())('GEPISODE1', net.ctx)
  net.state.afterToken = undefined
  net.state.default = PRAGUE
  await (await viewer())('GEPISODE1', net.ctx)

  expect(net.tokenRequests.filter(({ url }) => url !== TOKEN_URL).map(({ relay, pinned }) => [relay, pinned]))
    .toEqual([[PRAGUE, PRAGUE], [PRAGUE, PRAGUE]])
  expect(net.countries()).toEqual(['CZ', 'CZ'])
})

test('when the viewer\'s relay changes mid-visit, the next call gets a token of the new relay', async () => {
  const net = network()
  const lookup = await viewer()

  await lookup('GEPISODE1', net.ctx)
  net.state.default = HONG_KONG
  // answered with the Prague token, through Hong Kong
  await lookup('GEPISODE2', net.ctx)
  await lookup('GEPISODE3', net.ctx)
  await lookup('GEPISODE4', net.ctx)

  expect(net.countries()).toEqual(['CZ', 'CZ', 'HK', 'HK'])
})

test('an answer that arrives late with the old relay\'s token keeps the new relay\'s token', async () => {
  const net = network()
  const lookup = await viewer()
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  const ctx = {
    fetch: async (url: string, init: Init) => {
      const response = await net.fetch(url, init)
      if (url.includes('GEPISODE3')) await held
      return response
    }
  } as never

  await lookup('GEPISODE1', ctx)
  net.state.default = HONG_KONG
  const late = lookup('GEPISODE3', ctx)
  await lookup('GEPISODE2', ctx)
  await lookup('GEPISODE4', ctx)
  release()
  await late
  const asked = net.tokenRequests.length
  await lookup('GEPISODE5', ctx)

  expect(net.tokenRequests).toHaveLength(asked)
  expect(net.countries()).toEqual(['CZ', 'CZ', 'CZ', 'HK', 'HK'])
})

test('with no relay naming its answers, the plain request is the only one and every viewer shares it', async () => {
  const net = network()
  net.state.default = undefined

  await (await viewer())('GEPISODE1', net.ctx)
  at(20 * 60_000)
  await (await viewer())('GEPISODE2', net.ctx)

  expect(net.tokenRequests.map(({ url }) => url)).toEqual([TOKEN_URL, TOKEN_URL])
  expect(minted).toBe(1)
  expect(net.bearers[1]).toBe(net.bearers[0])
})

// `cached` lists the mints, counted from 0, that come from a cache entry an hour old. Through a relay only the
// one naming it does, while the shared answer is fresh, so the expiry read is the kept token's own.
test.each([
  ['through a relay', PRAGUE, `${TOKEN_URL}?fkn_relay=${PRAGUE}`, [1]],
  ['with no relay', undefined, TOKEN_URL, [0]],
])('a cached token minted an hour ago lives until its own exp, then a request of its own replaces it (%s)', async (_, relay, named, cached) => {
  let calls = 0
  // what the cache holds 59 min 30 s after the mint: expires_in still reads 3600
  const net = network(relay => cached.includes(calls++)
    ? { access_token: jwt({ exp: (NOW + 30_000) / 1000, country: relay && COUNTRY[relay], n: 'cached' }), expires_in: 3600 }
    : fresh(relay))
  net.state.default = relay
  const lookup = await viewer()

  await lookup('GEPISODE1', net.ctx)
  const first = net.tokenRequests.length
  at(29_000)
  await lookup('GEPISODE2', net.ctx)
  expect(net.tokenRequests).toHaveLength(first)

  at(31_000)
  await lookup('GEPISODE3', net.ctx)
  const [stale, own] = net.tokenRequests.slice(-2)
  // only the stale answer to the request whose token is kept sends the one that differs
  expect(stale!.url).toBe(named)
  expect(own!.url.startsWith(`${named}${relay ? '&' : '?'}_=`)).toBe(true)
  expect(own!.pinned).toBe(relay)
  expect(net.bearers[1]).toBe(net.bearers[0])
  expect(net.bearers[2]).not.toBe(net.bearers[0])
  expect(claimsOf(net.bearers[2]!).exp * 1000).toBeGreaterThan(Date.now())
})

test.each([
  ['an opaque token', 'opaque-token'],
  ['a JWT with no exp', jwt({ country: 'JP' })],
])('%s lives from receipt for its expires_in', async (_, access_token) => {
  const net = network(() => ({ access_token, expires_in: 3600 }))
  const lookup = await viewer()

  await lookup('GEPISODE1', net.ctx)
  const first = net.tokenRequests.length
  at(3_599_000)
  await lookup('GEPISODE2', net.ctx)
  expect(net.tokenRequests).toHaveLength(first)

  at(3_601_000)
  await lookup('GEPISODE3', net.ctx)
  expect(net.tokenRequests).toHaveLength(2 * first)
  expect(net.tokenRequests.slice(first).map(({ key }) => key)).toEqual(net.tokenRequests.slice(0, first).map(({ key }) => key))
})
