// The main thread's session frames, one per site a tracker reaches with the viewer's own session
// (anilist.co, myanimelist.net and www.crunchyroll.com), the sign in that connects a site on this device
// and the sign out that disconnects it. src/worker.ts exposes `sessionResolvers` to the worker on the
// `sessions` osra key.

import type { WindowSignIn } from '../sources/login-window'
import type { PageApi } from './site-session'

import { attachFrame } from '@fkn/lib'
import { expose } from 'osra'

import anilistPageScript from '../sources/anilist/session-page.ts?page-script'
import { ANILIST_DOMAINS, ANILIST_LOGIN_URL, ANILIST_ORIGIN, ANILIST_SESSION_URL, anilistSignedIn } from '../sources/anilist/session'
import { clearCloudCookies } from '../sources/cloud-sign-out'
import crunchyrollPageScript from '../sources/crunchyroll/session-page.ts?page-script'
import {
  CRUNCHYROLL_BASE_URL, CRUNCHYROLL_DOMAINS, CRUNCHYROLL_LOGIN_URL, CRUNCHYROLL_SESSION_URL, CRUNCHYROLL_TRACKER_ID, crunchyrollSignedIn,
} from '../sources/crunchyroll/session'
import { signInThroughWindow } from '../sources/login-window'
import malPageScript from '../sources/mal/session-page.ts?page-script'
import { MAL_DOMAINS, MAL_LOGIN_URL, MAL_ORIGIN, MAL_SESSION_URL, MAL_WINDOW_WIDTH, malSignedIn } from '../sources/mal/session'
import { attachCookies, detectBackend, type FknBackend } from '../utils/fkn-backend'
import { mountHiddenFrame } from '../utils/hidden-frame'
import { CONNECTED_KEY, connectedSites, createConnections, disconnectAndReload, signInAndConnect, siteSessionResolvers } from './connections'
import { createSessionFrames } from './session-frames'
import { rememberSignIn, siteStatuses } from './site-status'

const ANILIST_REASON = 'Read and update your AniList list with your own anilist.co session'
const MAL_REASON = 'Read and update your MyAnimeList list with your own myanimelist.net session'
const CRUNCHYROLL_REASON = 'Read and update your Crunchyroll history, ratings and Watchlist with your crunchyroll.com session'

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
  }, {
    id: CRUNCHYROLL_TRACKER_ID,
    url: CRUNCHYROLL_SESSION_URL,
    origin: CRUNCHYROLL_BASE_URL,
    domains: CRUNCHYROLL_DOMAINS,
    reason: CRUNCHYROLL_REASON,
    pageScript: crunchyrollPageScript,
  }],
  {
    // the backend the sign-in picks too, so the frame reads the session the sign-in reached. On the
    // cloud an empty page presented at the url: a goto there adds a history entry, so the browser's Back
    // lands in the hidden frame and leaves it with no page. Only the render proxy can present one.
    attach: async ({ url, ...options }) => {
      const backend = await detectBackend()
      return attachFrame({ ...options, cookies: attachCookies(backend), ...backend === 'cloud' ? { blank: { url } } : {} })
    },
    mount: () => mountHiddenFrame('Session'),
    connect: port => expose<PageApi>({}, { transport: port }),
    appOrigin: location.origin,
    key: () => crypto.randomUUID(),
  },
)

const connections = createConnections(() => localStorage)

export const sessionResolvers = siteSessionResolvers(frames, connections)

// a site connected or disconnected in another document of this browser is read again here: the player
// runs in the embed's own document, and its sign in connects Crunchyroll from there
globalThis.addEventListener?.('storage', ({ key, oldValue, newValue }) => {
  if (key !== CONNECTED_KEY) return
  const before = connectedSites(oldValue)
  const after = connectedSites(newValue)
  for (const site of [...before, ...after]) if (before.includes(site) !== after.includes(site)) frames.reload(site)
})

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

/** Opens Crunchyroll's sign-in page in an FKN window. Call it directly in the click handler. */
export const signInToCrunchyroll = (): Promise<WindowSignIn> =>
  signInAndConnect(
    CRUNCHYROLL_TRACKER_ID,
    () => signInThroughWindow({
      url: CRUNCHYROLL_LOGIN_URL,
      domains: CRUNCHYROLL_DOMAINS,
      permissions: [{ category: 'evaluation', reason: CRUNCHYROLL_REASON }],
      isSignedIn: crunchyrollSignedIn,
    }),
    { frames, connections },
  ).then(rememberSignIn(siteStatuses, 'crunchyroll'))

/** The sign in each tracker offers, by tracker id, for a tracker that answers SIGNED_OUT. */
export const trackerSignIns: Record<string, () => Promise<WindowSignIn>> = {
  anilist: signInToAniList,
  mal: signInToMyAnimeList,
  [CRUNCHYROLL_TRACKER_ID]: signInToCrunchyroll,
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
 * Crunchyroll's sign out on the cloud: as `signOutOfSite`, the tracker stops reaching it at once, then
 * its cookies leave FKN's jar and it is remembered as signed out. Rejects when that removal failed.
 */
export const signOutOfCrunchyroll = async (): Promise<void> => {
  disconnectAndReload(CRUNCHYROLL_TRACKER_ID, { frames, connections })
  await clearCloudCookies(CRUNCHYROLL_DOMAINS)
  siteStatuses.record('crunchyroll', 'signed-out')
}
