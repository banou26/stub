// Stub's code inside an app.trakt.tv page. Built into one self-contained function
// (scripts/page-script.ts) and installed with `frame.evaluate`, once per document, by the session frame
// (tracking/session-frames.ts). It imports nothing that needs the app: the shared install
// (tracking/page-install.ts) and ./api.ts's constants.
//
// It asks the way Trakt's own app does: the token Trakt issued to its web client, which the app keeps
// in an app.trakt.tv cookie and every document serves back in `/__data.json` (`oidcAuth.token`), sent
// as a bearer to apiz.trakt.tv beside the same client id, and read afresh once after a 401 on a read.
// Writes never auto-retry once sent so a network hiccup or 401 cannot duplicate history plays.

import type { ServeArg } from '../../tracking/session-frames'

import { installSessionServer, randomNonce } from '../../tracking/page-install'
import { TRAKT_API, TRAKT_HEADERS } from './api'

/**
 * One answer of Trakt's API as the page received it, its body parsed (null when it was not JSON).
 * `retryAfter` in seconds, `pageCount` from `X-Pagination-Page-Count`.
 *
 * `signed-out`: the session holds no token, so nothing was asked. `no-session`: `/__data.json` answered
 * with no session data stub could read, so nothing was asked either.
 */
export type TraktPageAnswer<T = unknown> =
  | { kind: 'answer', status: number, body: T | null, retryAfter: number | null, pageCount: number | null }
  | { kind: 'signed-out' }
  | { kind: 'no-session', status: number }

/** What the page serves over its port. */
export type TraktPageApi = {
  /** Whose the session is: `/users/settings`, of which only the username leaves the page. */
  whoami: (arg: Record<string, never>) => Promise<TraktPageAnswer<string>>
  /** A GET of Trakt's API with the session's token. `path` starts with `/`, on apiz.trakt.tv. */
  get: (arg: { path: string }) => Promise<TraktPageAnswer>
  /** A POST write to Trakt's API with the session's token. Sent once; never retried on error or 401. */
  post: (arg: { path: string, body: unknown }) => Promise<TraktPageAnswer>
}

/** What `run` takes: serve the session over the port the app posts next, or answer whether anyone is signed in. */
export type TraktPageArg = ServeArg | { kind: 'viewer' }

type PageFetch = (input: string, init?: RequestInit) => Promise<Response>

type Session = { kind: 'token', token: string } | { kind: 'signed-out' } | { kind: 'no-session', status: number }

const parsed = (text: string): unknown => {
  try { return JSON.parse(text) as unknown } catch { return null }
}

const headerNumber = (headers: Headers, name: string) => {
  const value = headers.get(name)
  const number = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * The token in a `/__data.json` answer, null when the session holds none. Undefined when the answer is
 * not one: SvelteKit flattens the data, so `nodes[0].data[0]` is the root layout's object, and each of
 * its values, `oidcAuth` and the token inside it alike, is an index into that same array.
 */
export const tokenOf = (body: unknown): string | null | undefined => {
  const data = (body as { nodes?: { data?: unknown }[] } | null)?.nodes?.[0]?.data
  if (!Array.isArray(data)) return undefined
  const at = (index: unknown) => typeof index === 'number' && Number.isInteger(index) && index >= 0 ? data[index] as unknown : undefined
  const auth = at((data[0] as { oidcAuth?: unknown } | null | undefined)?.oidcAuth)
  if (!auth || typeof auth !== 'object') return undefined
  const token = at((auth as { token?: unknown }).token)
  return typeof token === 'string' && token !== '' ? token : null
}

const usernameOf = (body: unknown): string | null => {
  const name = (body as { user?: { username?: unknown } } | null)?.user?.username
  return typeof name === 'string' && name !== '' ? name : null
}

const toAnswer = async (response: Response): Promise<TraktPageAnswer> => ({
  kind: 'answer',
  status: response.status,
  body: parsed(await response.text()),
  retryAfter: headerNumber(response.headers, 'retry-after'),
  pageCount: headerNumber(response.headers, 'x-pagination-page-count'),
})

/**
 * The page's side of the tracker. Reads end in `_=<nonce>`, so no cache keyed on the request answers
 * with an earlier one. The token is read from `/__data.json` once and kept, and read again once on
 * a 401 GET. Writes (`post`) never auto-retry once dispatched.
 */
export const createTraktPage = ({ fetch, nonce }: { fetch: PageFetch, nonce: () => string }): TraktPageApi => {
  let held: Promise<Session> | undefined

  const readSession = async (): Promise<Session> => {
    const response = await fetch(`/__data.json?_=${nonce()}`, { credentials: 'include', headers: { accept: 'application/json' } })
    const token = response.ok ? tokenOf(parsed(await response.text())) : undefined
    if (token === undefined) return { kind: 'no-session', status: response.status }
    return token ? { kind: 'token', token } : { kind: 'signed-out' }
  }

  const session = (fresh: boolean) => {
    if (fresh || !held) {
      const asked = readSession()
      held = asked
      // only a token is kept, so a page signed in after a signed-out read asks again
      const forget = () => { if (held === asked) held = undefined }
      asked.then(found => { if (found.kind !== 'token') forget() }, forget)
    }
    return held
  }

  const get: TraktPageApi['get'] = async ({ path }) => {
    if (!path.startsWith('/')) throw new Error(`stub asks Trakt's API by path, not ${path}`)
    for (let attempt = 0; ; attempt++) {
      const current = await session(attempt > 0)
      if (current.kind !== 'token') return current
      const response = await fetch(`${TRAKT_API}${path}${path.includes('?') ? '&' : '?'}_=${nonce()}`, {
        headers: { ...TRAKT_HEADERS, authorization: `Bearer ${current.token}` },
      })
      if (response.status === 401 && attempt === 0) continue
      return toAnswer(response)
    }
  }

  const post: TraktPageApi['post'] = async ({ path, body }) => {
    if (!path.startsWith('/')) throw new Error(`stub posts to Trakt's API by path, not ${path}`)
    const current = await session(false)
    if (current.kind !== 'token') return current
    const response = await fetch(`${TRAKT_API}${path}`, {
      method: 'POST',
      headers: { ...TRAKT_HEADERS, authorization: `Bearer ${current.token}` },
      body: JSON.stringify(body),
    })
    return toAnswer(response)
  }

  return {
    whoami: async () => {
      const answer = await get({ path: '/users/settings' })
      return answer.kind === 'answer' ? { ...answer, body: usernameOf(answer.body) } : answer
    },
    get,
    post,
  }
}

/** Whether the page's session belongs to someone Trakt knows, asked of Trakt itself. */
export const hasViewer = async (api: TraktPageApi): Promise<boolean> => {
  const answer = await api.whoami({})
  return answer.kind === 'answer' && answer.status === 200 && answer.body !== null
}

/** The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg. */
export const run = (arg: TraktPageArg): Promise<boolean> | 'installed' | 'reinstalled' => {
  const page = globalThis as typeof globalThis & Record<symbol, unknown>
  const api = createTraktPage({ fetch: (input, init) => page.fetch(input, init), nonce: randomNonce })
  return arg.kind === 'viewer' ? hasViewer(api) : installSessionServer(arg, page, api)
}
