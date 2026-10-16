// The Crunchyroll tracker: the viewer's own Crunchyroll, read and written through the
// www.crunchyroll.com page the main thread keeps open with their session (tracking/site-sessions.ts):
// the episodes watched, the series' stars, and its Watchlist as Plan to watch.
//
// Its origin, `cr`, is also the Crunchyroll media source's. They never meet: a tracker is a server of
// its own, never ingested (AniList's tracker and media source share `anilist` the same way).

import { CRUNCHYROLL_BASE_URL, CRUNCHYROLL_ICON, CRUNCHYROLL_TRACKER_ID } from './session'
import { SCORE_SCALE, STATUSES, crunchyrollTrackerResolvers } from './tracker-resolvers'

export const origin = CRUNCHYROLL_TRACKER_ID
export const name = 'Crunchyroll'
export const originUrl = CRUNCHYROLL_BASE_URL
export const icon = CRUNCHYROLL_ICON
export const color = null
export const isApiOnly = true
export const scoreScale = SCORE_SCALE
export const statuses = STATUSES

export const resolvers = crunchyrollTrackerResolvers()
