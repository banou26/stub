import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, desc } from '../utils'

const SCORE = 0.3
const BASE = 'https://apiz.trakt.tv'
// app.trakt.tv's own client id, a public value in its bundle (chunk D5VL6z_E.js, read 2026-10-07).
// Metadata needs no sign-in with it; without it every read answers 403.
const CLIENT_ID = '201dc70c5ec6af530f12f079ea1922733f6e1085ad7b02f36d8e011b75bcea7d'

export const icon = 'https://walter.trakt.tv/hotlink-ok/public/favicon.ico'
export const originUrl = 'https://trakt.tv'
export const categories = ['SERIES'] as const
export const name = 'Trakt'
export const origin = 'trakt'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['trakt']
export const color = '#ed1c24'

type TraktIds = {
  trakt?: number
  slug?: string
  imdb?: string
  tmdb?: number
  tvdb?: number
}

type TraktShow = {
  title?: string
  year?: number
  overview?: string
  rating?: number
  first_aired?: string
  ids?: TraktIds
}

type TraktSearchResult = {
  type?: string
  score?: number
  show?: TraktShow
}

type TraktEpisode = {
  season?: number
  number?: number
  title?: string
  overview?: string
  rating?: number
  first_aired?: string
  ids?: TraktIds
}

type TraktSeason = {
  number?: number
  episodes?: TraktEpisode[]
}

const api = <T>(path: string, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx
    .fetch(`${BASE}${path}`, {
      headers: {
        'trakt-api-key': CLIENT_ID,
        'trakt-api-version': '2',
        'Content-Type': 'application/json',
      },
    })
    .then(r => r.json() as Promise<T>)
    .catch(() => undefined)

// `first_aired` is an INSTANT (`2008-01-21T02:00:00.000Z`), and an instant and a day are not
// interchangeable: utils/release-date.ts renders a bare `YYYY-MM-DD` as that calendar day in UTC and
// a timestamped value where the viewer is, so a day widened into an instant shows a day early
// everywhere west of Greenwich. A value already naming a day is therefore passed through untouched.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
const airedAt = (value?: string | null): string | undefined => {
  if (!value) return undefined
  if (DAY_ONLY.test(value)) return value
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

const mediaId = (ids?: TraktIds): string | undefined => ids?.slug ?? (ids?.trakt !== undefined ? String(ids.trakt) : undefined)

/**
 * The handles a trakt id block is worth minting.
 *
 * Everything this source mints is CONTAINER: it reads `/shows/` and `/search/show` only, so a row is
 * trakt's show slug and the ids on it are the show's, identical for every season. There is no movie
 * branch here to reason about separately.
 *
 * `tmdb` IS NOT MINTED, for the two reasons simkl and watchmode already refuse it.
 *
 * IT IS A SHOW LEVEL ID. `ids.tmdb` on a trakt show is one TMDB tv id covering every season, while
 * `tmdb/extractor.ts` mints season scoped `tmdb:<id>-s<n>` runs through `seasonScopedId`. A handle is
 * an identity claim, so a bare `tmdb:<id>` says every season of the show is one media and
 * `upsertMedia` unions them on it before any season mechanism is consulted. The CONTAINER stamp this
 * used to carry does not save it, because tmdb is not in the store's show level backstop
 * (`SHOW_LEVEL_ORIGINS` is imdb alone) and a claim minted under an origin that also mints honest
 * season ids has to stand on its own.
 *
 * THE NUMBER IS AMBIGUOUS ANYWAY. TMDB numbers films and shows in separate sequences that both start
 * at 1, measured 2026-09-04: `themoviedb.org/movie/550` is Fight Club and `themoviedb.org/tv/550` is
 * Till Death Us Do Part. Stub's uri is `tmdb:550` for both, carrying no kind, so a tv id minted here
 * can weld a show to an unrelated film that holds the same number.
 *
 * `tmdb` deliberately stays OUT of `SHOW_LEVEL_ORIGINS` for this: exempting the origin would demote
 * `tmdb/extractor.ts`'s correct `<id>-s<n>` runs to fix a bare id minted somewhere else. The refusal
 * belongs at the source that cannot build an honest id, which is this one.
 *
 * The cost is the TMDB link disappearing from a trakt sourced media, the same trade simkl records.
 * `imdb` stays: a `tt` id names the show, it has no season level equivalent, and CONTAINER says so at
 * the point the claim is made rather than leaving it to the backstop.
 */
const buildHandles = (ids?: TraktIds): GQLMedia[] => {
  const handles: GQLMedia[] = []
  if (ids?.imdb) handles.push(makeMedia({ origin: 'imdb', id: ids.imdb, url: `https://www.imdb.com/title/${ids.imdb}`, scope: 'CONTAINER' }))
  return handles
}

const normalizeMedia = (show: TraktShow): GQLMedia | undefined => {
  const id = mediaId(show.ids)
  if (!id) return undefined
  const rating = show.rating
  return makeMedia({
    origin,
    id,
    url: `https://trakt.tv/shows/${id}`,
    scope: 'CONTAINER',
    handles: buildHandles(show.ids),
    categories: ['SERIES'],
    score: SCORE,
    titles: show.title ? [{ language: 'en', title: show.title, score: SCORE }] : [],
    ...desc(show.overview, SCORE),
    startDate: show.first_aired ? new Date(show.first_aired).toISOString() : undefined,
    averageScore: rating !== undefined ? Math.round(rating * 10) : undefined,
  })
}

const normalizeEpisode = (episode: TraktEpisode, season: number, mediaId: string, mediaUri: string): GQLEpisode => {
  const number = episode.number
  return makeEpisode({
    origin,
    id: episode.ids?.trakt !== undefined ? String(episode.ids.trakt) : `${mediaId}-s${season}e${number ?? 0}`,
    mediaUri,
    score: SCORE,
    titles: episode.title ? [{ language: 'en', title: episode.title, score: SCORE }] : [],
    ...desc(episode.overview, SCORE),
    seasonNumber: season,
    episodeNumber: number,
    releaseDate: airedAt(episode.first_aired),
  })
}

const fetchEpisodes = async (id: string, mediaUri: string, ctx: ExtractorServerContext): Promise<GQLEpisode[]> => {
  const seasons = await api<TraktSeason[]>(`/shows/${encodeURIComponent(id)}/seasons?extended=episodes,full`, ctx)
  if (!seasons) return []
  return seasons
    .filter(season => (season.number ?? 0) > 0)
    .flatMap(season => (season.episodes ?? []).map(episode => normalizeEpisode(episode, season.number ?? 0, id, mediaUri)))
}

const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const show = await api<TraktShow>(`/shows/${encodeURIComponent(id)}?extended=full`, ctx)
  if (!show) return undefined
  const media = normalizeMedia(show)
  if (!media) return undefined
  // This media is SHOW level by construction: its id is trakt's show slug and `fetchEpisodes` flatMaps
  // EVERY season of it into one list. Every media in this store is one run, so `episodeNumber` is
  // within-season, and flattening several seasons collides them: `store/db.ts` hangs a HAS_EPISODE edge
  // off this uri for each, and `Media.episodes` groups the union by episodeNumber ALONE, so the row
  // count becomes the LONGEST season and whatever else the cluster holds shares rows with a season
  // nobody asked for. Measured live 2026-08-31 through the same mechanism: 24 rows on a 14 episode
  // season page. `crunchyroll/extractor.ts` carries this guard too.
  //
  // The media itself stays, because `mediaPage` mints exactly these ids for SEARCH. A show whose
  // episodes are all one season is unaffected, its list being honest.
  const episodes = await fetchEpisodes(id, media.uri, ctx)
  const seasons = new Set(episodes.map(episode => episode.seasonNumber ?? 0))
  if (seasons.size <= 1) {
    media.episodes = episodes
    media.episodeCount = episodes.length
  }
  return media
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const results = await api<TraktSearchResult[]>(`/search/show?query=${encodeURIComponent(query)}`, ctx)
  return (results ?? [])
    .map(result => (result.show ? normalizeMedia(result.show) : undefined))
    .filter((media): media is GQLMedia => !!media)
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const traktUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: traktUri ? (await getMedia(traktUri.id, ctx)) ?? null : null }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        yield { mediaPage: { nodes: await searchApi(search, ctx) } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      return fetchEpisodes(parent.id, parent.uri, ctx)
    }
  }
}
