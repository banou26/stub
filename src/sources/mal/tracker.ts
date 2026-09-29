// The MyAnimeList tracker: the viewer's own MyAnimeList list, read and written through the
// myanimelist.net page the main thread keeps open with their session (tracking/site-sessions.ts). No
// OAuth app: the site's own endpoints, with the site's own cookies, the way the site's own list page
// asks them.
//
// Its origin, `mal`, is also the jikan media source's. They never meet: a tracker is a server of its
// own, never ingested, and the media fan-out reads only ./index.ts's extractors (AniList's tracker and
// media source already share `anilist` the same way).

import { MAL_ICON, MAL_TRACKER_ID, MAL_URL, MAL_WRITE_NOTICE } from './list-api'
import { malTrackerResolvers } from './tracker-resolvers'

export const origin = MAL_TRACKER_ID
export const name = 'MyAnimeList'
export const originUrl = MAL_URL
export const icon = MAL_ICON
export const color = null
export const isApiOnly = true
export const scoreScale = 'POINT_10'
export const writeNotice = MAL_WRITE_NOTICE

export const resolvers = malTrackerResolvers()
