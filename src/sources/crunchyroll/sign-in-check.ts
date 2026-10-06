// Whether the viewer is signed in to Crunchyroll, asked of crunchyroll.com without loading any of its
// pages. Import free apart from types and ./session.ts, so a test drives it over a fake frame.

import type { AttachFrameOptions, Frame } from '@fkn/lib'
import type { SiteState } from '../../tracking/site-status'
import type { FknBackend } from '../../utils/fkn-backend'

import { CRUNCHYROLL_BASE_URL, CRUNCHYROLL_SSO_CLIENT_ID } from './session'

/**
 * The first call crunchyroll.com's own app makes for a signed-in session: the `etp_rt_cookie` grant,
 * which carries the HttpOnly `etp_rt` cookie the sign-in set. Signed out it answers 400 naming that
 * cookie as missing (measured 2026-10-07). The signed-in answer, a 200 with a token, is unmeasured.
 */
export const TOKEN_URL = `${CRUNCHYROLL_BASE_URL}/auth/v1/token`

export type TokenRequest = { url: string, authorization: string, deviceType: string }

/** What the token call answered, with any token taken out: it never leaves the page that asked. */
export type TokenAnswer = { status: number, body: unknown }

export const TOKEN_REQUEST: TokenRequest = {
  url: TOKEN_URL,
  authorization: `Basic ${btoa(`${CRUNCHYROLL_SSO_CLIENT_ID}:`)}`,
  deviceType: 'stub on FKN',
}

type PageFetch = (input: string, init: RequestInit) => Promise<Pick<Response, 'status' | 'ok' | 'json'>>

/**
 * Self-contained, since `evaluate` runs it in a page at www.crunchyroll.com on that page's `fetch`. It
 * reuses the device id the site keeps in a cookie when the page can read one, so a check is no new device.
 */
export const askForToken = async ({ url, authorization, deviceType }: TokenRequest, send: PageFetch = fetch): Promise<TokenAnswer> => {
  const deviceId = /(?:^|;\s*)device_id=([^;]+)/.exec(globalThis.document?.cookie ?? '')?.[1] ?? crypto.randomUUID()
  const response = await send(url, {
    method: 'POST',
    credentials: 'include',
    headers: { authorization, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'etp_rt_cookie', device_id: deviceId, device_type: deviceType }).toString(),
  })
  const body: unknown = await response.json().catch(() => null)
  return { status: response.status, body: response.ok ? null : body }
}

const missesRefreshCookie = (body: unknown) =>
  ((body as { context?: { code?: unknown, field?: unknown }[] } | null)?.context ?? [])
    .some(entry => entry.field === 'etp_rt' && entry.code === 'auth.obtain_access_token.missing_required_field')

/** A 200 is a session, the measured 400 is none, and anything else is no answer. */
export const crunchyrollSignInState = ({ status, body }: TokenAnswer): SiteState => {
  if (status === 200) return 'signed-in'
  if (status === 400 && missesRefreshCookie(body)) return 'signed-out'
  throw new Error(`Crunchyroll answered ${status}`)
}

type Attach = (options: Pick<AttachFrameOptions, 'iframe' | 'blank' | 'cookies' | 'permissions'>) => Promise<Pick<Frame, 'evaluate'>>

export type CheckDeps = {
  attach: Attach
  mount: () => { iframe: HTMLIFrameElement, remove: () => void }
  /** @fkn/lib's `fetch`, which with `credentials: 'include'` rides the browser's own session on the extension. */
  fetch: PageFetch
  /** Held after a granted token, which may set a new `etp_rt`, so the jar commits it before the frame goes. */
  settle?: () => Promise<void>
}

export const EVALUATION_REASON = 'Ask crunchyroll.com whether you are signed in, without loading any of its pages'

/**
 * Asks Crunchyroll whether the backend's session for it is signed in. On the cloud the call runs in an
 * empty page FKN presents at www.crunchyroll.com, on the cloud jar; with the extension it goes out on the
 * browser's own session. Rejects when the answer says neither.
 */
export const checkCrunchyroll = async (
  backend: FknBackend,
  { attach, mount, fetch, settle = () => new Promise(resolve => setTimeout(resolve, 2_000)) }: CheckDeps,
): Promise<SiteState> => {
  if (backend === 'extension') return crunchyrollSignInState(await askForToken(TOKEN_REQUEST, fetch))
  const { iframe, remove } = mount()
  try {
    const frame = await attach({
      iframe,
      blank: { url: `${CRUNCHYROLL_BASE_URL}/` },
      cookies: 'persistent',
      permissions: [{ category: 'evaluation', reason: EVALUATION_REASON }],
    })
    const answer = await frame.evaluate(askForToken, TOKEN_REQUEST)
    if (answer.status === 200) await settle()
    return crunchyrollSignInState(answer)
  } finally {
    remove()
  }
}
