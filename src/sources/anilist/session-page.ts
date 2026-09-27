// Stub's code inside anilist.co's own page, where the viewer's session cookie rides along with every
// request the page makes. It is built into one self-contained function (scripts/page-script.ts) and
// installed with `frame.evaluate`, once per document, by the session frame (tracking/session-frames.ts).
// It imports nothing that needs the app: osra, the port protocol of tracking/session-frames.ts and the
// token reader of ./frontend.ts, neither of which imports anything at runtime.
//
// It asks the way the site's own client does, measured in anilist.co's bundle (main.1dc97617.js,
// 2026-09-27): `new GraphQLClient("/graphql", { credentials: "include" })` with the headers
// `{ schema: "default", "x-csrf-token": window.al_token }`, and on a lost token the site fetches "/"
// and reads `window.al_token = "..."` out of it again.

import { expose } from 'osra'

import { SESSION_PORT_MESSAGE, type ServeArg } from '../../tracking/session-frames'
import { extractAlToken, isGateRejection, type AnilistBody } from './frontend'

/**
 * AniList's rate headers, each null when the response did not carry it. `reset` is a unix time in
 * seconds and `retryAfter` a count of seconds, as AniList sends them.
 */
export type SessionRateLimit = { limit: number | null, remaining: number | null, reset: number | null, retryAfter: number | null }

export type SessionRequest = { query: string, variables?: Record<string, unknown> }

/** A GraphQL answer as the page received it: AniList reports errors in the body, often beside a 200. */
export type SessionResponse = { status: number, body: AnilistBody | null, rateLimit: SessionRateLimit }

/** What the page serves over its port. */
export type SessionPageApi = { graphql: (request: SessionRequest) => Promise<SessionResponse> }

/** What `run` takes: serve the session over the port the app posts next, or answer whether anyone is signed in. */
export type SessionPageArg = ServeArg | { kind: 'viewer' }

type PageFetch = (input: string, init?: RequestInit) => Promise<Response>

const headerNumber = (headers: Headers, name: string) => {
  const value = headers.get(name)
  const number = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(number) ? number : null
}

const rateLimitOf = (headers: Headers): SessionRateLimit => ({
  limit: headerNumber(headers, 'x-ratelimit-limit'),
  remaining: headerNumber(headers, 'x-ratelimit-remaining'),
  reset: headerNumber(headers, 'x-ratelimit-reset'),
  retryAfter: headerNumber(headers, 'retry-after'),
})

const parse = (text: string): AnilistBody | null => {
  try { return JSON.parse(text) as AnilistBody } catch { return null }
}

/**
 * The page's GraphQL over the site's own endpoint.
 *
 * Every request opens with a GraphQL comment carrying a fresh nonce, so no cache keyed on the body
 * (the FKN relay's is) can answer a read with an earlier one. A 403 from the CSRF gate is answered
 * once with a token read afresh from the site's home page, which is what the site does itself.
 */
export const createPageApi = (
  { fetch, pageToken, nonce }: { fetch: PageFetch, pageToken: () => string | undefined, nonce: () => string }
): SessionPageApi => {
  let token: Promise<string | undefined> | undefined

  // the home page renders the token for the session the cookie names; the nonce keeps a cache from
  // handing back one rendered for somebody else's
  const tokenFromHome = async () => {
    const response = await fetch(`/?_=${nonce()}`, { credentials: 'include', headers: { accept: 'text/html' } })
    return extractAlToken(await response.text())
  }

  const csrf = (fresh: boolean) => {
    if (fresh || !token) {
      const inPage = fresh ? undefined : pageToken()
      token = inPage ? Promise.resolve(inPage) : tokenFromHome()
      token.catch(() => { token = undefined })
    }
    return token
  }

  const graphql = async ({ query, variables }: SessionRequest): Promise<SessionResponse> => {
    for (let attempt = 0; ; attempt++) {
      const current = await csrf(attempt > 0)
      if (!current) throw new Error('anilist.co served no CSRF token to this page')
      const response = await fetch('/graphql', {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          schema: 'default',
          'x-csrf-token': current,
        },
        body: JSON.stringify({ query: `# stub ${nonce()}\n${query}`, variables: variables ?? {} }),
      })
      const body = parse(await response.text())
      if (attempt === 0 && isGateRejection(response.status, body ?? undefined)) continue
      return { status: response.status, body, rateLimit: rateLimitOf(response.headers) }
    }
  }

  return { graphql }
}

/** Whether the page's session has a viewer, asked of the site itself. */
export const hasViewer = async (api: SessionPageApi): Promise<boolean> => {
  const { body } = await api.graphql({ query: 'query { Viewer { id } }' })
  return Boolean((body?.data as { Viewer?: { id?: number } | null } | null | undefined)?.Viewer?.id)
}

type Installed = { appOrigin: string, key: string, api: SessionPageApi }

const STATE = Symbol.for('stub.anilist-session')

/**
 * Listens on `target` for the app's port and serves `api` over each one that arrives with this
 * install's key, from the app's origin.
 *
 * Installing again in the same document (the frame reports a document twice when the page returns
 * from the back/forward cache) swaps the key and adds no second listener, so a port sent for an
 * earlier install is never served.
 */
export const install = (
  { appOrigin, key }: { appOrigin: string, key: string },
  target: EventTarget & Record<symbol, unknown>,
  api: SessionPageApi,
): 'installed' | 'reinstalled' => {
  const installed = target[STATE] as Installed | undefined
  if (installed) {
    Object.assign(installed, { appOrigin, key })
    return 'reinstalled'
  }
  const state: Installed = { appOrigin, key, api }
  target[STATE] = state
  target.addEventListener('message', event => {
    const { data, origin, ports } = event as MessageEvent
    if (origin !== state.appOrigin || data?.type !== SESSION_PORT_MESSAGE || data.key !== state.key || !ports?.[0]) return
    void expose(state.api, { transport: ports[0] })
  })
  return 'installed'
}

const plausibleToken = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9]{20,}$/.test(value) ? value : undefined

const randomNonce = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`

/**
 * The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg.
 */
export const run = (arg: SessionPageArg): Promise<boolean> | 'installed' | 'reinstalled' => {
  const page = globalThis as typeof globalThis & { al_token?: unknown } & Record<symbol, unknown>
  const api = createPageApi({
    fetch: (input, init) => page.fetch(input, init),
    pageToken: () => plausibleToken(page.al_token),
    nonce: randomNonce,
  })
  return arg.kind === 'viewer' ? hasViewer(api) : install(arg, page, api)
}
