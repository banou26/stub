// The AniList tracker: the viewer's own AniList list, read and written through the anilist.co page
// the main thread keeps open with their session (tracking/site-sessions.ts). No OAuth app: the site's
// own endpoint, with the site's own cookies, the way the site's own client asks it.

import { ANILIST_ICON, ANILIST_TRACKER_ID, ANILIST_WRITE_NOTICE } from './list-api'
import { anilistTrackerResolvers } from './tracker-resolvers'

export const origin = ANILIST_TRACKER_ID
export const name = 'AniList'
export const originUrl = 'https://anilist.co'
export const icon = ANILIST_ICON
export const color = null
export const isApiOnly = true
export const scoreScale = 'POINT_100'
export const writeNotice = ANILIST_WRITE_NOTICE

export const resolvers = anilistTrackerResolvers()
