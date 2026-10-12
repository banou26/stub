import type { RelayChoice } from '@fkn/lib'

import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

// Which relays list a Crunchyroll episode, asked before the player opens its frame. The answers are
// Crunchyroll's own for The Apothecary Diaries' GE00384327JAJP, recorded through Prague and Hong Kong with
// @fkn/lib 0.9.58 on 2026-10-13 and trimmed (the token left out): Prague's token says CZ and the episode
// is a 200, Hong Kong's says HK and the episode is a 404.

const PRAGUE = 'cz-prg-001'
const HONG_KONG = 'hk-hkg-001'
const EPISODE = 'https://www.crunchyroll.com/watch/GE00384327JAJP/locusts'

const recorded = (name: string) =>
  readFileSync(new URL(`../../../fixtures/crunchyroll/relay-check/${name}`, import.meta.url), 'utf8')
const ANSWERS = {
  [PRAGUE]: { token: recorded('token-through-prague.json'), episode: recorded('episode-through-prague.json'), status: 200 },
  [HONG_KONG]: { token: recorded('token-through-hong-kong.json'), episode: recorded('episode-through-hong-kong.json'), status: 404 },
} as Record<string, { token: string, episode: string, status: number }>

type Call = { url: string, init: RequestInit & { relay?: RelayChoice } }

// FKN's broker as an app sees it: a choice is resolved to the first relay left in the viewer's order, and
// one no relay is left for is refused by name before anything is sent
const broker = vi.hoisted(() => ({
  order: [] as string[],
  calls: [] as { url: string, init: RequestInit & { relay?: RelayChoice } }[],
  answer: undefined as undefined | ((relay: string, call: { url: string, init: RequestInit }) => Response | Promise<Response> | undefined),
  served: new WeakMap<Response, string>(),
  ignoresExclude: false,
  // an FKN page older than the relay choice names no relay
  names: true,
}))

vi.mock('@fkn/lib', () => ({
  relayOf: (response: Response) => broker.served.get(response),
  cloud: {
    fetch: async (url: string, init: Call['init']) => {
      // an answer a task later, as over the broker's channel
      await new Promise(resolve => setTimeout(resolve, 0))
      const choice = init.relay
      const relay = choice?.id ?? broker.order.find(id => broker.ignoresExclude || !choice?.exclude?.includes(id))
      if (!relay) throw Object.assign(new Error('cloud.fetch: no relay serves this choice'), { name: 'RelayUnavailableError' })
      broker.calls.push({ url, init })
      const response = await broker.answer?.(relay, { url, init }) ?? crunchyroll(relay, url, init)
      if (broker.names) broker.served.set(response, relay)
      return response
    },
  },
}))

// Crunchyroll as measured: the token's country is the minting relay's, and the episode follows the token
const tokens = new Map<string, string>()
const crunchyroll = (relay: string, url: string, init: RequestInit) => {
  if (url.endsWith('/auth/v1/token')) {
    const token = `token-${tokens.size + 1}`
    tokens.set(token, relay)
    return new Response(ANSWERS[relay]!.token.replace('<trimmed>', token), { status: 200 })
  }
  const minted = tokens.get((init.headers as Record<string, string>).authorization!.replace('Bearer ', ''))!
  return new Response(ANSWERS[minted]!.episode, { status: ANSWERS[minted]!.status })
}

const { unlistedRelays } = await import('../../../../src/sources/crunchyroll/relay-check')

const mints = () => broker.calls.filter(({ url }) => url.endsWith('/auth/v1/token'))
const episodes = () => broker.calls.filter(({ url }) => url.includes('/content/v2/cms/objects/'))

beforeEach(() => {
  broker.calls = []
  broker.answer = undefined
  broker.ignoresExclude = false
  broker.names = true
  tokens.clear()
})

afterEach(() => {
  vi.useRealTimers()
})

test('a default relay that lists the episode leaves the player where it is, asked once', async () => {
  broker.order = [PRAGUE, HONG_KONG]

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
  expect(mints()).toHaveLength(1)
  expect(episodes()).toHaveLength(1)
})

test('a default relay that does not list the episode is passed for the next one that does', async () => {
  broker.order = [HONG_KONG, PRAGUE]

  expect(await unlistedRelays(EPISODE, [])).toEqual([HONG_KONG])
  expect(mints().map(({ init }) => init.relay)).toEqual([{ exclude: [] }, { exclude: [HONG_KONG] }])
})

test('the relays the show was unavailable through are never asked', async () => {
  broker.order = [HONG_KONG, PRAGUE]

  expect(await unlistedRelays(EPISODE, [HONG_KONG])).toEqual([])
  expect(mints().map(({ init }) => init.relay)).toEqual([{ exclude: [HONG_KONG] }])
})

test('an episode no relay lists leaves the player where it is', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  broker.answer = (_, { url }) => url.includes('/objects/') ? new Response(ANSWERS[HONG_KONG]!.episode, { status: 404 }) : undefined

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
  expect(mints()).toHaveLength(2)
})

test('each check mints a token of its own and asks the episode with it, through the relay that minted it', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  await unlistedRelays(EPISODE, [])

  const bodies = mints().map(({ init }) => init.body as string)
  for (const body of bodies) expect(body).toMatch(/^grant_type=client_id&device_id=[0-9a-f-]{36}$/)
  expect(new Set(bodies).size).toBe(2)
  expect(episodes().map(({ url, init }) => [url, init.relay, (init.headers as Record<string, string>).authorization])).toEqual([
    ['https://www.crunchyroll.com/content/v2/cms/objects/GE00384327JAJP?ratings=true&locale=en-US', { id: HONG_KONG }, 'Bearer token-1'],
    ['https://www.crunchyroll.com/content/v2/cms/objects/GE00384327JAJP?ratings=true&locale=en-US', { id: PRAGUE }, 'Bearer token-2'],
  ])
})

test('a check that fails leaves the player where it is, even when a later relay would list the episode', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  broker.answer = (relay, { url }) => relay === HONG_KONG && url.includes('/objects/') ? new Response('', { status: 503 }) : undefined

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
})

test('a token answer that is not one leaves the player where it is', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  broker.answer = (_, { url }) => url.endsWith('/auth/v1/token') ? new Response('{"error":"invalid_client"}', { status: 401 }) : undefined

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
  expect(episodes()).toHaveLength(0)
})

test('an FKN page that cannot say which relay answered leaves the player where it is', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  broker.names = false

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
  expect(episodes()).toHaveLength(0)
})

test('a check that never answers leaves the player where it is after 5 s, and not before', async () => {
  vi.useFakeTimers()
  broker.order = [HONG_KONG, PRAGUE]
  broker.answer = () => new Promise(() => {})

  let answer: string[] | undefined
  void unlistedRelays(EPISODE, []).then(relays => { answer = relays })
  await vi.advanceTimersByTimeAsync(4_999)
  expect(answer).toBeUndefined()
  await vi.advanceTimersByTimeAsync(1)
  expect(answer).toEqual([])
})

test('a relay named again ends the walk', async () => {
  broker.order = [HONG_KONG, PRAGUE]
  broker.ignoresExclude = true

  expect(await unlistedRelays(EPISODE, [])).toEqual([])
  expect(mints()).toHaveLength(2)
})

test('a url that names no episode asks nothing', async () => {
  broker.order = [HONG_KONG, PRAGUE]

  expect(await unlistedRelays('https://www.crunchyroll.com/series/G3KHEVDJ7/the-apothecary-diaries', [])).toEqual([])
  expect(broker.calls).toEqual([])
})
