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
import { TRAKT_API, TRAKT_CLIENT_ID, TRAKT_HEADERS } from './api'

/** LocalStorage key inside `app.trakt.tv` holding the last non-expired OIDC access token read from `/__data.json`. */
export const TRAKT_SESSION_CACHE_KEY = 'stub.trakt-session'

const CACHE_FALLBACK_TTL_MS = 24 * 60 * 60_000
const TRAKT_OIDC_KEYS = [
  `oidc.user:https://auth.trakt.tv:${TRAKT_CLIENT_ID}`,
  `oidc.user:https://trakt.tv:${TRAKT_CLIENT_ID}`,
]

export type TraktSessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * One answer of Trakt's API as the page received it, its body parsed (null when it was not JSON).
 * `retryAfter` in seconds, `pageCount` from `X-Pagination-Page-Count`.
 *
 * `signed-out`: the session holds no token, so nothing was asked. `no-session`: `/__data.json` answered
 * with no session data stub could read, so nothing was asked either. `challenge`: `/__data.json` hit an
 * anti-bot browser check (Cloudflare 403/503 challenge) with no cached or OIDC session token to fall back to.
 */
export type TraktPageAnswer<T = unknown> =
  | { kind: 'answer', status: number, body: T | null, retryAfter: number | null, pageCount: number | null }
  | { kind: 'signed-out' }
  | { kind: 'no-session', status: number }
  | { kind: 'challenge', status: number }

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

type Session =
  | { kind: 'token', token: string }
  | { kind: 'signed-out' }
  | { kind: 'no-session', status: number }
  | { kind: 'challenge', status: number }

const parsed = (text: string): unknown => {
  try { return JSON.parse(text) as unknown } catch { return null }
}

const headerNumber = (headers: Headers, name: string) => {
  const value = headers.get(name)
  const number = value == null || value === '' ? NaN : Number(value)
  return Number.isFinite(number) ? number : null
}

const toEpochMs = (value: number): number => value < 1e12 ? value * 1000 : value

/** Whether a response from `app.trakt.tv` is a Cloudflare browser check challenge page. */
export const isChallengeResponse = (response: Pick<Response, 'status' | 'headers'>, text: string): boolean =>
  (response.status === 403 || response.status === 503) && (
    response.headers.get('cf-mitigated')?.toLowerCase() === 'challenge'
    || /<title>\s*(?:Just a moment|Attention Required!\s*\|\s*Cloudflare)\b|cf-turnstile|\/cdn-cgi\/challenge-platform\b/i.test(text)
  )

/**
 * The token and expiry in a `/__data.json` answer, null token when the session holds none. Undefined when
 * the answer is not one: SvelteKit flattens the data, so `nodes[0].data[0]` is the root layout's object,
 * and each of its values, `oidcAuth` and the fields inside it alike, is an index into that same array.
 */
export const sessionDataOf = (body: unknown): { token: string | null, expiresAt: number | null } | undefined => {
  const data = (body as { nodes?: { data?: unknown }[] } | null)?.nodes?.[0]?.data
  if (!Array.isArray(data)) return undefined
  const at = (index: unknown) => typeof index === 'number' && Number.isInteger(index) && index >= 0 ? data[index] as unknown : undefined
  const auth = at((data[0] as { oidcAuth?: unknown } | null | undefined)?.oidcAuth)
  if (!auth || typeof auth !== 'object') return undefined
  const token = at((auth as { token?: unknown }).token)
  const rawExpiresAt = at((auth as { expiresAt?: unknown }).expiresAt)
  return {
    token: typeof token === 'string' && token !== '' ? token : null,
    expiresAt: typeof rawExpiresAt === 'number' && Number.isFinite(rawExpiresAt) ? toEpochMs(rawExpiresAt) : null,
  }
}

export const tokenOf = (body: unknown): string | null | undefined => sessionDataOf(body)?.token

const safeGet = (storage: TraktSessionStorage | null | undefined, key: string): string | null => {
  try { return storage?.getItem(key) ?? null } catch { return null }
}

const dropCachedSession = (storage: TraktSessionStorage | null | undefined) => {
  try { storage?.removeItem(TRAKT_SESSION_CACHE_KEY) } catch {}
}

const writeCachedSession = (
  storage: TraktSessionStorage | null | undefined,
  entry: { token: string, expiresAt: number | null, savedAt: number },
) => {
  try { storage?.setItem(TRAKT_SESSION_CACHE_KEY, JSON.stringify(entry)) } catch {}
}

const readFallbackToken = (
  storage: TraktSessionStorage | null | undefined,
  nowMs: number,
  rejectedToken?: string,
): string | null => {
  if (!storage) return null
  for (const key of TRAKT_OIDC_KEYS) {
    const raw = safeGet(storage, key)
    if (!raw) continue
    const data = parsed(raw) as { access_token?: unknown, expires_at?: unknown } | null
    const token = typeof data?.access_token === 'string' && data.access_token !== '' ? data.access_token : null
    if (!token || token === rejectedToken) continue
    const expiresAt = data?.expires_at
    if (expiresAt == null || (typeof expiresAt === 'number' && Number.isFinite(expiresAt) && toEpochMs(expiresAt) > nowMs)) {
      return token
    }
  }
  const rawCache = safeGet(storage, TRAKT_SESSION_CACHE_KEY)
  if (!rawCache) return null
  const cache = parsed(rawCache) as { token?: unknown, expiresAt?: unknown, savedAt?: unknown } | null
  const token = typeof cache?.token === 'string' && cache.token !== '' ? cache.token : null
  if (!token || token === rejectedToken) return null
  const expiresAt = cache?.expiresAt
  if (expiresAt != null) return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && toEpochMs(expiresAt) > nowMs ? token : null
  return typeof cache?.savedAt === 'number' && Number.isFinite(cache.savedAt) && nowMs - cache.savedAt < CACHE_FALLBACK_TTL_MS ? token : null
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
 * a 401 GET. When `/__data.json` is met with a Cloudflare 403/503 challenge, an unexpired cached token or
 * Trakt's own OIDC user entry in `localStorage` serves `apiz.trakt.tv` reads directly. Writes (`post`)
 * never auto-retry once dispatched.
 */
export const createTraktPage = ({
  fetch,
  nonce,
  storage = null,
  now = Date.now,
  persist = false,
  clearOnStart = false,
}: {
  fetch: PageFetch
  nonce: () => string
  storage?: TraktSessionStorage | null
  now?: () => number
  persist?: boolean
  clearOnStart?: boolean
}): TraktPageApi => {
  if (clearOnStart) dropCachedSession(storage)
  let skipFallback = clearOnStart
  let held: Promise<Session> | undefined

  const readSession = async (rejectedToken?: string): Promise<Session> => {
    const response = await fetch(`/__data.json?_=${nonce()}`, { credentials: 'include', headers: { accept: 'application/json' } })
    const text = await response.text()
    const sessionData = response.ok ? sessionDataOf(parsed(text)) : undefined
    if (sessionData !== undefined) {
      if (sessionData.token) {
        skipFallback = false
        if (persist) writeCachedSession(storage, { token: sessionData.token, expiresAt: sessionData.expiresAt, savedAt: now() })
        return { kind: 'token', token: sessionData.token }
      }
      if (persist) dropCachedSession(storage)
      return { kind: 'signed-out' }
    }
    if (isChallengeResponse(response, text)) {
      const fallback = skipFallback ? null : readFallbackToken(storage, now(), rejectedToken)
      if (fallback) return { kind: 'token', token: fallback }
      return { kind: 'challenge', status: response.status }
    }
    return { kind: 'no-session', status: response.status }
  }

  const session = (fresh: boolean, rejectedToken?: string) => {
    if (fresh || !held) {
      const asked = readSession(rejectedToken)
      held = asked
      // only a token is kept, so a page signed in after a signed-out read asks again
      const forget = () => { if (held === asked) held = undefined }
      asked.then(found => { if (found.kind !== 'token') forget() }, forget)
    }
    return held
  }

  const get: TraktPageApi['get'] = async ({ path }) => {
    if (!path.startsWith('/')) throw new Error(`stub asks Trakt's API by path, not ${path}`)
    let rejectedToken: string | undefined
    for (let attempt = 0; ; attempt++) {
      const current = await session(attempt > 0, rejectedToken)
      if (current.kind !== 'token') return current
      const response = await fetch(`${TRAKT_API}${path}${path.includes('?') ? '&' : '?'}_=${nonce()}`, {
        headers: { ...TRAKT_HEADERS, authorization: `Bearer ${current.token}` },
      })
      if (response.status === 401) {
        dropCachedSession(storage)
        if (attempt === 0) {
          rejectedToken = current.token
          continue
        }
        held = undefined
      }
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
    if (response.status === 401) {
      dropCachedSession(storage)
      held = undefined
    }
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

const readStorage = (page: typeof globalThis): TraktSessionStorage | null => {
  try {
    const storage = (page as { localStorage?: TraktSessionStorage }).localStorage
    return storage && typeof storage.getItem === 'function' ? storage : null
  } catch {
    return null
  }
}

/** The page script's entry: what `frame.evaluate` calls, in the site's own realm, with its arg. */
export const run = (arg: TraktPageArg): Promise<boolean> | 'installed' | 'reinstalled' => {
  const page = globalThis as typeof globalThis & Record<symbol, unknown>
  const api = createTraktPage({
    fetch: (input, init) => page.fetch(input, init),
    nonce: randomNonce,
    storage: arg.kind === 'serve' ? readStorage(page) : null,
    persist: arg.kind === 'serve',
    clearOnStart: arg.kind === 'serve' && arg.freshOnly === true,
  })
  return arg.kind === 'viewer' ? hasViewer(api) : installSessionServer(arg, page, api)
}
