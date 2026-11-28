import type { CategoryRequest, Frame } from '@fkn/lib'
import type { CloudCookies } from '@banou/fkn-3p-auth'

import { openAuthWindow } from '@banou/fkn-3p-auth'
import { attachFrame, isExtensionExposed, isLocatorInvalid, isLocatorUnsupported, isPermissionDenied, isTerminalError } from '@fkn/lib'

import { attachCookies } from '../utils/fkn-backend'

/**
 * How a sign-in through an FKN window ended.
 *
 * - `'authed'`: `isSignedIn` answered `true`, and the window has been closed with `close()`, which
 *   commits its cookies to the app's cloud jar first. An inline cloud frame loaded after this loads
 *   signed in. Nothing else closes the window, so a sign-in is never cut mid way.
 * - `'closed'`: the window ended first, closed by the viewer or lost. The viewer may still have
 *   finished signing in, since a read can be pending when they close it.
 * - `'blocked'`: the browser opened no window (popup blocker, or no user activation).
 * - `'unsupported'`: the lib refused window mode, on an extension backend (a window on the
 *   browser's own cookies) or by the window's own refusal. Nothing else is opened, so the caller
 *   can fall back.
 */
export type WindowSignIn = 'authed' | 'closed' | 'blocked' | 'unsupported'

export type WindowSignInOptions = {
  /** Where the window opens, usually the site's sign-in page. */
  url: string
  /** The hosts the sign-in crosses, as `attachFrame`'s `domains`. */
  domains: string[]
  /**
   * Whether the window's page shows the signed-in state. Use a severity-0 read (`exists`, `count`,
   * `isVisible`) so the poll never prompts. A rejection or a read past `readTimeoutMs` counts as not
   * signed in yet: a read also rejects while the site replaces its own document, and on a host
   * outside `domains`, so neither says the sign-in is done.
   */
  isSignedIn: (login: Frame) => Promise<boolean>
  /**
   * Categories to ask for as soon as the window connects, on a card drawn in the window. For an
   * `isSignedIn` that has to run code in the page: asked for up front, the card never lands in the
   * middle of a read the poll then gives up on.
   */
  permissions?: CategoryRequest[]
  /**
   * The jar the window runs on. Left out: the browser's own cookies with the FKN extension, stub's cloud jar without it.
   * 'persistent' is always stub's cloud jar, the one stub's plugins read, so a check a plugin needs passed lands there
   * even with the extension installed.
   */
  cookies?: 'persistent'
  /** Cloud jar to fall back to in the same click if native window attach is unsupported by the extension. */
  fallbackCookies?: CloudCookies
  /** The window's inner width and height in CSS pixels, FKN's 500 by 700 when left out. The browser may clamp them. */
  width?: number
  height?: number
  /** Time between two reads, in milliseconds. 1000 by default. */
  pollMs?: number
  /** How long one read may take before it counts as unanswered, in milliseconds. 5000 by default. */
  readTimeoutMs?: number
}

/**
 * Opens `url` in an FKN window and waits for the viewer to sign in there.
 *
 * Call it directly in the click or key handler: the window opens with that event's activation, so it
 * must be opened before anything is awaited. Rejects only on a failure the outcomes do not name.
 */
export const signInThroughWindow = ({
  url,
  domains,
  isSignedIn,
  permissions,
  cookies,
  fallbackCookies,
  width,
  height,
  pollMs = 1000,
  readTimeoutMs = 5000,
}: WindowSignInOptions): Promise<WindowSignIn> => {
  let opened = false
  // first statement on purpose: an await above it would open the window without the click's activation
  return openAuthWindow(
    {
      id: 'stub-login-window',
      entryUrl: url,
      domains,
      // with the extension, the browser's own cookies, on which the lib serves no window: that refusal is
      // `unsupported` below, and the caller's frames then run on the browser's own session for the site
      cookies: cookies ?? attachCookies(isExtensionExposed() ? 'extension' : 'cloud'),
      ...fallbackCookies ? { fallbackCookies } : {},
      ...(width === undefined && height === undefined
        ? {}
        : { window: { ...width === undefined ? {} : { width }, ...height === undefined ? {} : { height } } }),
      ...permissions ? { permissions } : {},
      pollMs,
      readTimeoutMs,
      isSignedIn: frame => isSignedIn(frame),
    },
    {
      client: { attachFrame, isLocatorInvalid, isLocatorUnsupported, isPermissionDenied },
      onOpen: () => { opened = true },
    },
  ).then(outcome => {
    if (outcome.status === 'authed') return 'authed'
    if (outcome.status === 'closed') return 'closed'
    if (outcome.status === 'blocked') return 'blocked'
    if (outcome.status === 'unsupported') {
      console.warn('[login-window] window mode was refused', outcome.error)
      return 'unsupported'
    }
    if (outcome.status === 'not-ready') return 'unsupported'
    if (!opened && isTerminalError(outcome.error)) return 'closed'
    throw outcome.error
  })
}
