// The Trakt tracker: the viewer's own Trakt history and lists, read and written through the
// app.trakt.tv page the main thread keeps open with their session (tracking/site-sessions.ts). No app
// of stub's own: the token Trakt issued to its own web client, used the way that client uses it.
//
// Its origin, `trakt`, is also the Trakt media source's. They never meet: a tracker is a server of its
// own, never ingested, and the media fan-out reads only ../index.ts's extractors.

import { TRAKT_ICON } from './api'
import { TRAKT_SCORE_SCALE, TRAKT_TRACKER_ID, TRAKT_URL } from './list-api'
import { traktTrackerResolvers } from './tracker-resolvers'

export const origin = TRAKT_TRACKER_ID
export const name = 'Trakt'
export const originUrl = TRAKT_URL
export const icon = TRAKT_ICON
export const color = null
export const isApiOnly = true
export const scoreScale = TRAKT_SCORE_SCALE

export const resolvers = traktTrackerResolvers()
