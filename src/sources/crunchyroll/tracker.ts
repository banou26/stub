// The Crunchyroll tracker: how far the viewer got on Crunchyroll, read off Crunchyroll's own history
// through the www.crunchyroll.com page the main thread keeps open with their session
// (tracking/site-sessions.ts). Read only: its progress shows beside the others and changes none of them.
//
// Its origin, `cr`, is also the Crunchyroll media source's. They never meet: a tracker is a server of
// its own, never ingested (AniList's tracker and media source share `anilist` the same way).

import { CRUNCHYROLL_BASE_URL, CRUNCHYROLL_ICON, CRUNCHYROLL_TRACKER_ID } from './session'
import { crunchyrollTrackerResolvers } from './tracker-resolvers'

export const origin = CRUNCHYROLL_TRACKER_ID
export const name = 'Crunchyroll'
export const originUrl = CRUNCHYROLL_BASE_URL
export const icon = CRUNCHYROLL_ICON
export const color = null
export const isApiOnly = true
export const scoreScale = 'POINT_100'
export const readOnly = true

export const resolvers = crunchyrollTrackerResolvers()
