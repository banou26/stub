// The main thread's session frames, one per site a tracker reaches with the viewer's own session
// (anilist.co and myanimelist.net), and the sign in that connects a site on this device. src/worker.ts
// exposes `sessionResolvers` to the worker on the `sessions` osra key.

import type { WindowSignIn } from '../sources/login-window'
import type { PageApi } from './site-session'

import { attachFrame } from '@fkn/lib'
import { expose } from 'osra'

import anilistPageScript from '../sources/anilist/session-page.ts?page-script'
import { ANILIST_DOMAINS, ANILIST_LOGIN_URL, ANILIST_ORIGIN, ANILIST_SESSION_URL, anilistSignedIn } from '../sources/anilist/session'
import { signInThroughWindow } from '../sources/login-window'
import malPageScript from '../sources/mal/session-page.ts?page-script'
import { MAL_DOMAINS, MAL_LOGIN_URL, MAL_ORIGIN, MAL_SESSION_URL, MAL_WINDOW_WIDTH, malSignedIn } from '../sources/mal/session'
import { createConnections, signInAndConnect, siteSessionResolvers } from './connections'
import { createSessionFrames } from './session-frames'

const ANILIST_REASON = 'Read and update your AniList list with your own anilist.co session'
const MAL_REASON = 'Read and update your MyAnimeList list with your own myanimelist.net session'

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
  }, {
    // the tracker's id and the site's are both `mal`
    id: 'mal',
    url: MAL_SESSION_URL,
    origin: MAL_ORIGIN,
    domains: MAL_DOMAINS,
    reason: MAL_REASON,
    pageScript: malPageScript,
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

/** Opens myanimelist.net's sign-in page in an FKN window. Call it directly in the click handler. */
export const signInToMyAnimeList = (): Promise<WindowSignIn> =>
  signInAndConnect(
    'mal',
    () => signInThroughWindow({
      url: MAL_LOGIN_URL,
      domains: MAL_DOMAINS,
      permissions: [{ category: 'evaluation', reason: MAL_REASON }],
      width: MAL_WINDOW_WIDTH,
      isSignedIn: login => malSignedIn(login, malPageScript),
    }),
    { frames, connections },
  )

/** The sign in each tracker offers, by tracker id, for a tracker that answers SIGNED_OUT. */
export const trackerSignIns: Record<string, () => Promise<WindowSignIn>> = {
  anilist: signInToAniList,
  mal: signInToMyAnimeList,
}
