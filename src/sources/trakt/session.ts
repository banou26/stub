// Where stub keeps the viewer's app.trakt.tv session open, and how it tells that someone signed in
// there. Import free apart from types, so tracking/site-sessions.ts wires these and a test pins them.

import type { Frame } from '@fkn/lib'

export const TRAKT_ORIGIN = 'https://app.trakt.tv'

/**
 * `attachFrame`'s domains, the one host stub reads. The sign-in itself crosses auth.trakt.tv and
 * whichever account provider the viewer picks, where a read is refused, which the sign-in poll counts
 * as not signed in yet.
 */
export const TRAKT_DOMAINS = ['app.trakt.tv']

/** What a sign out clears: the app's session and Trakt's own sign-in on auth.trakt.tv. */
export const TRAKT_SIGN_OUT_DOMAINS = ['app.trakt.tv', 'auth.trakt.tv']

/**
 * The app's home, where its header offers Sign in. trakt.tv redirects here (302, measured 2026-10-11),
 * and the sign-in has to start from the app, which keeps the PKCE verifier its callback needs.
 */
export const TRAKT_LOGIN_URL = 'https://app.trakt.tv/'

/**
 * The page the hidden session frame holds: `/robots.txt` (`200 text/plain`, no script, checked live
 * after `/cdn-cgi/rum` stopped returning 404 HTML). Every HTML route boots Trakt's SvelteKit app,
 * which clears the cookie token via `/api/store-token` when its storage is absent; `/robots.txt` stays
 * lightweight while sharing the `app.trakt.tv` origin for same-origin `/__data.json` reads.
 */
export const TRAKT_SESSION_URL = 'https://app.trakt.tv/robots.txt'

/** The header's Sign in button, drawn for a guest (server rendered on app.trakt.tv signed out). */
export const GUEST_MARKER = '.trakt-login-button'
/** The header's profile trigger, drawn once signed in on app.trakt.tv. */
export const SIGNED_IN_MARKER = 'trakt-profile-button, .trakt-profile-link-username'

const cspBlockedFrames = new WeakSet<Frame>()

const isCspError = (error: unknown): boolean =>
  error instanceof Error
  && error.name === 'LocatorDeniedError'
  && /content security policy/i.test(error.message)

/**
 * Whether the page in the sign-in window is signed in.
 *
 * The guest marker is a free read, so the poll costs nothing while the header offers Sign in. Once it
 * is gone, the page script asks Trakt who the session's token belongs to, which is also false on a
 * page that is not app.trakt.tv's and on a token Trakt no longer takes. If the window's CSP blocks
 * evaluating on app.trakt.tv itself, fall back to the header's signed-in marker and skip retrying
 * evaluation on subsequent polls of that frame.
 */
export const traktSignedIn = async (login: Frame, pageScript: string): Promise<boolean> => {
  if (await login.locator(GUEST_MARKER).exists()) return false
  if (cspBlockedFrames.has(login)) return await login.locator(SIGNED_IN_MARKER).exists()
  try {
    return await login.evaluate(pageScript, { kind: 'viewer' }) === true
  } catch (error) {
    if (isCspError(error)) {
      cspBlockedFrames.add(login)
      return await login.locator(SIGNED_IN_MARKER).exists()
    }
    throw error
  }
}
