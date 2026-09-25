import type { Frame, WindowFrame } from '@fkn/lib'

import { attachFrame, isTerminalError } from '@fkn/lib'

/**
 * How a sign-in through an FKN window ended.
 *
 * - `'authed'`: `isSignedIn` saw the signed-in page, or the window left the sign-in page that
 *   `onSignInPage` names (it answered that the page is gone, or could no longer be read at all), and
 *   the window has been closed with `close()`, which commits its cookies to the app's cloud jar
 *   first. An inline cloud frame loaded after this loads signed in.
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
   * signed in yet.
   */
  isSignedIn: (login: Frame) => Promise<boolean>
  /**
   * Whether the window's page is still the site's sign-in page, as a severity-0 read. Once a read has
   * seen it, two answers in a row saying it is gone count as signed in, since the site only moves the
   * window off it once the credentials were accepted. A form that stays after a failed sign-in keeps
   * the window open. A read past `readTimeoutMs` answers neither way.
   *
   * A read that REJECTS counts as the page being gone, once it has been seen. On the cloud backend a
   * page that leaves for another host through a redirect, a link or a form lands on another origin of
   * the render proxy, where every read rejects at once and for good (measured on fkn.app with
   * `@fkn/lib` 0.9.36, 2026-09-26), so a sign-in that ends on the site's own host never answers
   * `false`. A read that only retries runs into `readTimeoutMs` instead.
   */
  onSignInPage?: (login: Frame) => Promise<boolean>
  /** Time between two reads, in milliseconds. 1000 by default. */
  pollMs?: number
  /** How long one read may take before it counts as unanswered, in milliseconds. 5000 by default. */
  readTimeoutMs?: number
}

const REFUSALS = new Set(['ExtensionOperationUnsupportedError', 'FrameWindowRefusedError'])

// one answer can come from a re-render mid submit, where the form is briefly out of the document
const LEFT_READS = 2

// the lib retries a read it may still answer until its own deadline, so one that rejects inside `ms`
// was refused for good; undefined when it outlasted `ms`, which proves nothing either way
const UNREADABLE = 'unreadable'
const answer = (read: () => Promise<boolean>, ms: number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve().then(read).catch(() => UNREADABLE),
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
  onSignInPage,
  pollMs = 1000,
  readTimeoutMs = 5000,
}: WindowSignInOptions): Promise<WindowSignIn> => {
  // first statement on purpose: an await above it would open the window without the click's activation
  const opening = attachFrame({ window: { url }, domains })
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

  // a read issued across a redirect can block on the lib's own retry for tens of seconds, so every
  // read is bounded and the window closing ends the wait without waiting on one. A window that ends
  // rejects the reads in flight too, and `closed` settles first, so that never counts as leaving
  const closed = login.closed.then(() => 'closed' as const)
  let seen = false
  let away = 0
  for (;;) {
    const tick = await Promise.race([
      closed,
      new Promise(resolve => setTimeout(resolve, pollMs)).then(() => Promise.all([
        answer(() => isSignedIn(login), readTimeoutMs),
        onSignInPage && answer(() => onSignInPage(login), readTimeoutMs),
      ])),
    ])
    if (tick === 'closed') return 'closed'
    const [signedIn, onPage] = tick
    if (onPage === true) {
      seen = true
      away = 0
    } else if ((onPage === false || onPage === UNREADABLE) && seen) {
      away += 1
    }
    if (signedIn === true || away >= LEFT_READS) {
      await login.close()
      return 'authed'
    }
  }
}
