// The main thread's session frames, one per site a tracker reaches with the viewer's own session, and
// the sign in that connects a site on this device. src/worker.ts exposes `sessionResolvers` to the
// worker on the `sessions` osra key.

import type { WindowSignIn } from '../sources/login-window'
import type { PageApi } from './site-session'

import { attachFrame } from '@fkn/lib'
import { expose } from 'osra'

import anilistPageScript from '../sources/anilist/session-page.ts?page-script'
import { ANILIST_DOMAINS, ANILIST_LOGIN_URL, ANILIST_ORIGIN, ANILIST_SESSION_URL, anilistSignedIn } from '../sources/anilist/session'
import { signInThroughWindow } from '../sources/login-window'
import { createConnections, signInAndConnect, siteSessionResolvers } from './connections'
import { createSessionFrames } from './session-frames'

const ANILIST_REASON = 'Read and update your AniList list with your own anilist.co session'

// clipped rather than `display: none`, the way FKN hides its own broker frame, so the page in it runs
// laid out like any other
const mountHidden = () => {
  const iframe = document.createElement('iframe')
  iframe.title = 'Session'
  iframe.tabIndex = -1
  iframe.setAttribute('aria-hidden', 'true')
  iframe.referrerPolicy = 'no-referrer'
  iframe.style.cssText = 'position: fixed; top: 0; left: 0; width: 400px; height: 300px; border: 0; clip-path: inset(100%); pointer-events: none;'
  document.body.appendChild(iframe)
  return { iframe, remove: () => iframe.remove() }
}

const frames = createSessionFrames<PageApi>(
  [{
    id: 'anilist',
    url: ANILIST_SESSION_URL,
    origin: ANILIST_ORIGIN,
    domains: ANILIST_DOMAINS,
    reason: ANILIST_REASON,
    pageScript: anilistPageScript,
  }],
  {
    attach: options => attachFrame(options),
    mount: mountHidden,
    connect: port => expose<PageApi>({}, { transport: port }),
    appOrigin: location.origin,
    key: () => crypto.randomUUID(),
  },
)

const connections = createConnections(() => localStorage)

export const sessionResolvers = siteSessionResolvers(frames, connections)

/** Opens anilist.co's sign-in page in an FKN window. Call it directly in the click handler. */
export const signInToAniList = (): Promise<WindowSignIn> =>
  signInAndConnect(
    'anilist',
    () => signInThroughWindow({
      url: ANILIST_LOGIN_URL,
      domains: ANILIST_DOMAINS,
      permissions: [{ category: 'evaluation', reason: ANILIST_REASON }],
      isSignedIn: login => anilistSignedIn(login, anilistPageScript),
    }),
    { frames, connections },
  )

/** The sign in each tracker offers, by tracker id, for a tracker that answers SIGNED_OUT. */
export const trackerSignIns: Record<string, () => Promise<WindowSignIn>> = {
  anilist: signInToAniList,
}
