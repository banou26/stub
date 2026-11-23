// Trakt's API as stub asks it: the host, the client id and the shapes it answers. Imports nothing at
// runtime, so the media source, the tracker and the page script inside app.trakt.tv share it.

import type { ExtractorServerContext } from '../../worker/extractor'

/** The host app.trakt.tv's own client asks (`production_private` in its bundle); api.trakt.tv answers the same reads. */
export const TRAKT_API = 'https://apiz.trakt.tv'

/**
 * app.trakt.tv's own client id, a public value in its bundle (chunk D5VL6z_E.js, read 2026-10-07).
 * Metadata needs no sign-in with it; without it every read answers 403. Signed in, the site sends it
 * beside the viewer's token, and so does the tracker's page script.
 */
export const TRAKT_CLIENT_ID = '201dc70c5ec6af530f12f079ea1922733f6e1085ad7b02f36d8e011b75bcea7d'

export const TRAKT_HEADERS = {
  'trakt-api-key': TRAKT_CLIENT_ID,
  'trakt-api-version': '2',
  'Content-Type': 'application/json',
}

export const TRAKT_ICON = 'https://app.trakt.tv/favicon.svg'

export type TraktIds = {
  trakt?: number
  slug?: string
  imdb?: string
  tmdb?: number
  tvdb?: number
}

export type TraktShow = {
  title?: string
  year?: number
  overview?: string
  rating?: number
  first_aired?: string
  ids?: TraktIds
  genres?: string[]
  country?: string
  /** the languages `/translations` has the show in, which `extended=full` names */
  available_translations?: string[]
}

export type TraktMovie = {
  title?: string
  year?: number
  overview?: string
  rating?: number
  released?: string
  ids?: TraktIds
}

export type TraktTranslation = {
  title?: string | null
  overview?: string | null
  language?: string
  country?: string
}

export type TraktSearchResult = {
  type?: string
  score?: number
  show?: TraktShow
  movie?: TraktMovie
}

export type TraktEpisode = {
  season?: number
  number?: number
  title?: string
  overview?: string
  rating?: number
  first_aired?: string
  ids?: TraktIds
}

export type TraktSeason = {
  number?: number
  episodes?: TraktEpisode[]
}

/** A public read of Trakt's API, with no session. Undefined when it failed, answered non-2xx, or did not answer JSON. */
export const traktApi = <T>(path: string, ctx: Pick<ExtractorServerContext, 'fetch'>): Promise<T | undefined> =>
  ctx
    .fetch(`${TRAKT_API}${path}`, { headers: TRAKT_HEADERS })
    .then(r => r.ok === false ? undefined : r.json() as Promise<T>)
    .catch(() => undefined)
