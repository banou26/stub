// Stands in for src/worker/fetch.ts in the link preview's build (vite.preview.config.ts). Every request goes through the
// FKN relay over plain HTTP, sent as a page's cloud.fetch sends it (fkn-client web/src/api/proxy/proxy-fetch.ts), so a
// preview and a page asking the same thing share the relay's cache entry. The hosts a page asks from the viewer's browser
// (src/worker/direct-fetch.ts) are relayed here too, so only another preview's entry serves those: a preview has no
// viewer to ask from, and the edge is no place to (AniList refused every request from it, 2026-10-23).
import type { FetchInit } from '../worker/backoff'

import { RELAY_HEADER } from '@fkn/lib/contract'

import { withBackoff } from '../worker/backoff'

type Relay = { id: string, region: string, proxyOrigin?: string, healthy?: boolean, draining?: boolean }

const DIRECTORY = 'https://fkn.app/v1/relays'
// the nodes as the directory listed them on 2026-10-24, for when it cannot be read: fkn.app is this Function's own
// zone, and without `global_fetch_strictly_public` Cloudflare sends such a fetch to the zone's origin, ignoring the
// Workers mapped to it (Workers "Compatibility flags")
const NODES: Relay[] = [
  { id: 'cz-prg-001', region: 'eu', proxyOrigin: 'https://cz-prg-001.fkn.app/v0/' },
  { id: 'hk-hkg-001', region: 'asia', proxyOrigin: 'https://hk-hkg-001.fkn.app/v0/' },
]
// Prague: the crawlers run in the US and Europe (inferred), and from Tokyo, 256 ms from Prague, every cold run of the
// verifier's still had its title by the deadline (8 of 8, 2026-10-23)
const FIRST_REGION = 'eu'
const NULL_BODY_STATUSES = new Set([204, 205, 304])

const stopping = new AbortController()

// read once per preview, since each preview evaluates this module anew
let directory: Promise<Relay[]> | undefined
const relays = () => directory ??= globalThis.fetch(DIRECTORY, { signal: stopping.signal })
  .then(response => response.json() as Promise<{ relays: Relay[] }>)
  .then(({ relays }) => relays.filter(relay => relay.proxyOrigin && relay.healthy !== false && !relay.draining))
  .catch(() => NODES)

let turn = 0
const order = async (spread?: boolean) => {
  const all = await relays()
  const near = [...all.filter(relay => relay.region === FIRST_REGION), ...all.filter(relay => relay.region !== FIRST_REGION)]
  if (!spread || near.length < 2) return near
  const start = turn++ % near.length
  return [...near.slice(start), ...near.slice(0, start)]
}

const relayFetch = async (input: RequestInfo | URL, init?: FetchInit): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const headers = new Headers({
    'fkn-proxy-protocol': url.protocol.replace(/:$/, ''),
    'fkn-proxy-hostname': url.host,
    'fkn-proxy-pathname': url.pathname,
    'fkn-proxy-search': url.search,
    'cache-control': 'no-cache',
  })
  const forwarded: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, name) => { forwarded[name] = value })
  if (Object.keys(forwarded).length) headers.set('fkn-proxy-headers', btoa(JSON.stringify(forwarded)))
  const ask = (relay: Relay) =>
    globalThis.fetch(relay.proxyOrigin!.replace(/\/$/, ''), { method: init?.method?.toUpperCase() ?? 'GET', headers, body: init?.body ?? null, signal: init?.signal ?? null })
  const [first, second] = await order(init?.spread)
  if (!first) throw new Error('preview: no relay is available')
  let served = first
  let response: Response
  try {
    response = await ask(first)
  } catch (error) {
    if (!second || init?.signal?.aborted) throw error
    served = second
    response = await ask(second)
  }
  const packed = response.headers.get('fkn-proxy-headers')
  const upstreamHeaders = new Headers(packed ? JSON.parse(atob(packed)) : [])
  upstreamHeaders.set(RELAY_HEADER, served.id)
  const upstream = Number(response.headers.get('fkn-proxy-status'))
  const status = Number.isInteger(upstream) && upstream >= 200 && upstream <= 599 ? upstream : response.status
  const nullBody = NULL_BODY_STATUSES.has(status)
  if (nullBody) void response.body?.cancel().catch(() => {})
  return new Response(nullBody ? null : response.body, { status, headers: upstreamHeaders })
}

/**
 * Ends every relay call of this copy at once, in flight or yet to come, so each source still asking settles while
 * the request lives. A source left waiting on a call its request outlived never settles, and its answer's stream
 * then keeps the whole copy in the isolate's memory.
 */
export const stop = () => stopping.abort()

const stoppable = (init?: FetchInit): FetchInit => ({ ...init, signal: init?.signal ? AbortSignal.any([init.signal, stopping.signal]) : stopping.signal })

const backoff = withBackoff(relayFetch)

export const fetch = (input: RequestInfo | URL, init?: FetchInit) => relayFetch(input, stoppable(init))

export const fetchWithBackoff = (input: RequestInfo | URL, init?: FetchInit) => backoff(input, stoppable(init))
