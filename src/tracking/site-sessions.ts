// The main thread's session frames, one per site a tracker reaches with the viewer's own session
// (anilist.co, myanimelist.net, app.trakt.tv and www.crunchyroll.com), the sign in that connects a
// site on this device and the sign out that disconnects it. src/worker.ts exposes `sessionResolvers`
// to the worker on the `sessions` osra key.

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
import traktPageScript from '../sources/trakt/session-page.ts?page-script'
import {
  TRAKT_DOMAINS,
  TRAKT_LOGIN_URL,
  TRAKT_ORIGIN,
  TRAKT_SESSION_GEN_KEY,
  TRAKT_SESSION_URL,
  TRAKT_SIGN_OUT_DOMAINS,
  traktSignedIn,
} from '../sources/trakt/session'
import { attachCookies, detectBackend, type FknBackend } from '../utils/fkn-backend'
import { mountHiddenFrame } from '../utils/hidden-frame'
import { CONNECTED_CHANNEL, CONNECTED_KEY, connectedSites, createConnections, disconnectAndReload, signInAndConnect, siteSessionResolvers } from './connections'
import { evaluationPermissionBatch } from './permission-batch'
import { createSessionFrames } from './session-frames'
import { rememberSignIn, siteStatuses } from './site-status'

const ANILIST_REASON = 'Read and update your AniList list with your own anilist.co session'
const MAL_REASON = 'Read and update your MyAnimeList list with your own myanimelist.net session'
const TRAKT_REASON = 'Read and update your Trakt history, watchlist and ratings with your own app.trakt.tv session'
const CRUNCHYROLL_REASON = 'Read and update your Crunchyroll history, ratings and Watchlist with your crunchyroll.com session'

const SESSION_SITE_IDS = ['anilist', 'mal', 'trakt', CRUNCHYROLL_TRACKER_ID] as const

const readTraktSessionGen = (): string | undefined => {
  try { return localStorage.getItem(TRAKT_SESSION_GEN_KEY) ?? undefined } catch { return undefined }
}

const rotateTraktSessionGen = (): void => {
  try { localStorage.setItem(TRAKT_SESSION_GEN_KEY, crypto.randomUUID()) } catch {}
}

const channel = new BroadcastChannel(CONNECTED_CHANNEL)
const connections = createConnections(() => localStorage, channel)

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
    id: 'trakt',
    url: TRAKT_SESSION_URL,
    origin: TRAKT_ORIGIN,
    domains: TRAKT_DOMAINS,
    reason: TRAKT_REASON,
    pageScript: traktPageScript,
    sessionGen: readTraktSessionGen,
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
      const connectedCount = SESSION_SITE_IDS.filter(id => connections.isConnected(id)).length
      if (connectedCount >= 2 || evaluationPermissionBatch.isHeld()) {
        const reason = options.permissions[0]?.reason ?? ''
        const granted = await evaluationPermissionBatch.ask({ hosts: options.domains, reason, backend })
        if (granted === false) {
          throw Object.assign(new Error('frame.evaluate: the user did not grant evaluation here'), { name: 'LocatorDeniedError' })
        }
      }
      return attachFrame({ ...options, cookies: attachCookies(backend), ...backend === 'cloud' ? { blank: { url } } : {} })
    },
    mount: () => mountHiddenFrame('Session'),
    connect: port => expose<PageApi>({}, { transport: port }),
    appOrigin: location.origin,
    key: () => crypto.randomUUID(),
  },
)

export const sessionResolvers = siteSessionResolvers(frames, connections)

// a site signed in to or out of in another document of this browser is read again here: the player runs
// in the embed's own document, and its sign in connects Crunchyroll from there
globalThis.addEventListener?.('storage', ({ key, oldValue, newValue }) => {
  if (key !== CONNECTED_KEY) return
  const before = connectedSites(oldValue)
  const after = connectedSites(newValue)
  for (const site of [...before, ...after]) {
    if (before.includes(site) !== after.includes(site)) {
      frames.reload(site)
    }
  }
})
channel.onmessage = ({ data }: MessageEvent<string>) => {
  frames.reload(data)
}

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

/** Opens app.trakt.tv in an FKN window, whose Sign in starts Trakt's own. Call it directly in the click handler. */
export const signInToTrakt = (): Promise<WindowSignIn> => {
  rotateTraktSessionGen()
  return signInAndConnect(
    'trakt',
    () => signInThroughWindow({
      url: TRAKT_LOGIN_URL,
      domains: TRAKT_DOMAINS,
      permissions: [{ category: 'evaluation', reason: TRAKT_REASON }],
      isSignedIn: login => traktSignedIn(login, traktPageScript),
      // above the extension's 5 s evaluate bridge-ready timeout so a CSP refusal reaches traktSignedIn's fallback
      readTimeoutMs: 8_000,
    }),
    { frames, connections },
  ).then(rememberSignIn(siteStatuses, 'trakt'))
}

/** The sign in each tracker offers, by tracker id, for a tracker that answers SIGNED_OUT. */
export const trackerSignIns: Record<string, () => Promise<WindowSignIn>> = {
  anilist: signInToAniList,
  mal: signInToMyAnimeList,
  trakt: signInToTrakt,
  [CRUNCHYROLL_TRACKER_ID]: signInToCrunchyroll,
}

/** The sites a tracker reaches with the viewer's own session, by stub's name for them. */
export type TrackerSite = 'anilist' | 'mal' | 'trakt'

const SITE_DOMAINS: Record<TrackerSite, string[]> = { anilist: ANILIST_DOMAINS, mal: MAL_DOMAINS, trakt: TRAKT_SIGN_OUT_DOMAINS }

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
  if (site === 'trakt') rotateTraktSessionGen()
  await frames.ifAttached(site, async api => {
    await (api as { clearSession?: () => Promise<void> }).clearSession?.()
  })
  disconnectAndReload(site, { frames, connections })
  if (backend !== 'cloud') return
  await clearCloudCookies(SITE_DOMAINS[site])
  siteStatuses.recordSignOut(site)
}

/**
 * Crunchyroll's sign out on the cloud: as `signOutOfSite`, the tracker stops reaching it at once, then
 * its cookies leave FKN's jar and it is remembered as signed out. Rejects when that removal failed.
 */
export const signOutOfCrunchyroll = async (): Promise<void> => {
  disconnectAndReload(CRUNCHYROLL_TRACKER_ID, { frames, connections })
  await clearCloudCookies(CRUNCHYROLL_DOMAINS)
  siteStatuses.recordSignOut('crunchyroll')
}
