import type { Frame, WindowFrame } from '@fkn/lib'

import { attachFrame, isTerminalError } from '@fkn/lib'

/**
 * How a sign-in through an FKN window ended.
 *
 * - `'authed'`: `isSignedIn` answered `true`, and the window has been closed with `close()`, which
 *   commits its cookies to the app's cloud jar first. An inline cloud frame loaded after this loads
 *   signed in. Nothing else closes the window, so a sign-in is never cut mid way.
 * - `'closed'`: the window ended first, closed by the viewer or lost. The viewer may still have
 *   finished signing in, since a read can be pending when they close it.
 * - `'blocked'`: the browser opened no window (popup blocker, or no user activation).
 * - `'unsupported'`: the lib refused window mode, on an extension backend or by the window's own
 *   refusal. Nothing else is opened, so the caller can fall back.
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
  /** Time between two reads, in milliseconds. 1000 by default. */
  pollMs?: number
  /** How long one read may take before it counts as unanswered, in milliseconds. 5000 by default. */
  readTimeoutMs?: number
}

const REFUSALS = new Set(['ExtensionOperationUnsupportedError', 'FrameWindowRefusedError'])

const answer = (read: () => Promise<boolean>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve().then(read).catch(() => undefined),
    new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), ms) }),
  ]).finally(() => clearTimeout(timer))
}

/**
 * Opens `url` in an FKN window and waits for the viewer to sign in there.
 *
 * Call it directly in the click or key handler: the window opens with that event's activation, so it
 * must be opened before anything is awaited. Rejects only on a failure the outcomes do not name.
 */
export const signInThroughWindow = async ({
  url,
  domains,
  isSignedIn,
  pollMs = 1000,
  readTimeoutMs = 5000,
}: WindowSignInOptions): Promise<WindowSignIn> => {
  // first statement on purpose: an await above it would open the window without the click's activation
  const opening = attachFrame({ window: {}, domains })
  let login: WindowFrame
  try {
    login = await opening
  } catch (err) {
    const name = (err as Error | null)?.name
    if (name === 'FrameWindowBlockedError') return 'blocked'
    if (name && REFUSALS.has(name)) {
      console.warn('[login-window] window mode was refused', err)
      return 'unsupported'
    }
    // the lib's terminal detach error: the window closed or went away before it connected
    if (isTerminalError(err)) return 'closed'
    throw err
  }

  // opened blank and sent at 'documentstart', never on the attach's own load wait: a viewer whose sign-in
  // session is still alive goes straight on to www's home page, whose 1.9 MB consent script held the load
  // past the 30 s deadline (measured 2026-09-27); a window gone meanwhile ends the loop below on `closed`
  try {
    await login.goto(url, { waitUntil: 'documentstart' })
  } catch (err) {
    if (!isTerminalError(err)) {
      await login.close().catch(() => {})
      throw err
    }
  }

  // a read issued across a redirect can block on the lib's own retry for tens of seconds, so every
  // read is bounded and the window closing ends the wait without waiting on one
  const closed = login.closed.then(() => 'closed' as const)
  for (;;) {
    const tick = await Promise.race([
      closed,
      new Promise(resolve => setTimeout(resolve, pollMs)).then(() => answer(() => isSignedIn(login), readTimeoutMs)),
    ])
    if (tick === 'closed') return 'closed'
    if (tick === true) {
      await login.close()
      return 'authed'
    }
  }
}
