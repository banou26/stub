// The main thread's session frames, one per site a tracker reaches with the viewer's own session
// (anilist.co and myanimelist.net), the sign in that connects a site on this device and the sign out
// that disconnects it. src/worker.ts exposes `sessionResolvers` to the worker on the `sessions` osra key.

import type { SessionPageApi } from '../sources/anilist/session-page'
import type { WindowSignIn } from '../sources/login-window'
import type { MalPageApi } from '../sources/mal/session-page'
import type { PageApi } from './site-session'

import { attachFrame } from '@fkn/lib'
import { expose } from 'osra'

import anilistPageScript from '../sources/anilist/session-page.ts?page-script'
import { ANILIST_DOMAINS, ANILIST_LOGIN_URL, ANILIST_ORIGIN, ANILIST_SESSION_URL, anilistSignedIn } from '../sources/anilist/session'
import { clearCloudCookies } from '../sources/cloud-sign-out'
import { signInThroughWindow } from '../sources/login-window'
import malPageScript from '../sources/mal/session-page.ts?page-script'
import { MAL_DOMAINS, MAL_LOGIN_URL, MAL_ORIGIN, MAL_SESSION_URL, MAL_WINDOW_WIDTH, malSignedIn } from '../sources/mal/session'
import { attachCookies, detectBackend, type FknBackend } from '../utils/fkn-backend'
import { mountHiddenFrame } from '../utils/hidden-frame'
import { createConnections, disconnectAndReload, signInAndConnect, siteSessionResolvers } from './connections'
import { createSessionFrames } from './session-frames'
import { ANILIST_VIEWER_QUERY, anilistSignInState, malSignInState } from './site-checks'
import { rememberSignIn, siteStatuses, type SiteState } from './site-status'

const ANILIST_REASON = 'Read and update your AniList list with your own anilist.co session'
const MAL_REASON = 'Read and update your MyAnimeList list with your own myanimelist.net session'

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
    // the backend the sign-in picks too, so the frame reads the session the sign-in reached
    attach: async options => attachFrame({ ...options, cookies: attachCookies(await detectBackend()) }),
    mount: () => mountHiddenFrame('Session'),
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
  ).then(rememberSignIn(siteStatuses, 'anilist'))

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
  ).then(rememberSignIn(siteStatuses, 'mal'))

/** The sign in each tracker offers, by tracker id, for a tracker that answers SIGNED_OUT. */
export const trackerSignIns: Record<string, () => Promise<WindowSignIn>> = {
  anilist: signInToAniList,
  mal: signInToMyAnimeList,
}

/** The sites a tracker reaches with the viewer's own session, by stub's name for them. */
export type TrackerSite = 'anilist' | 'mal'

const SITE_DOMAINS: Record<TrackerSite, string[]> = { anilist: ANILIST_DOMAINS, mal: MAL_DOMAINS }

/** Whether the viewer signed in to the site through stub on this device. */
export const isSiteConnected = (site: TrackerSite): boolean => connections.isConnected(site)

/** Called after every sign in to the site and every sign out of it. */
export const watchSite = (site: TrackerSite, listener: () => void): (() => void) => frames.watch(site, listener)

/**
 * Stops stub reaching the site with the viewer's session on this device, at once, and on the cloud then
 * removes the site's cookies from FKN's jar (`clearCloudCookies`) and remembers the site as signed out.
 * Rejects when that removal failed; the site is disconnected here either way. With the extension the
 * session is the browser's own and stays.
 */
export const signOutOfSite = async (site: TrackerSite, backend: FknBackend): Promise<void> => {
  disconnectAndReload(site, { frames, connections })
  if (backend !== 'cloud') return
  await clearCloudCookies(SITE_DOMAINS[site])
  siteStatuses.record(site, 'signed-out')
}

/**
 * Asks the site through its session frame whether anyone is signed in there: AniList for its Viewer,
 * MyAnimeList for a fresh about.php. Rejects when the answer says neither. For a connected site only,
 * since the frame is what attaches.
 */
export const checkTrackerSite = async (site: TrackerSite): Promise<SiteState> =>
  site === 'anilist'
    ? anilistSignInState(await frames.use(site, api => (api as unknown as SessionPageApi).graphql({ query: ANILIST_VIEWER_QUERY })))
    : malSignInState(await frames.use(site, api => (api as unknown as MalPageApi).whoami({})))
