import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, MediaCategory, MediaScope } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img } from '../utils'
import { percentScore } from '../average-score'
import { decodeEntities } from '../entities'
import { parseSeasonNumber } from '../season'

const SCORE = 0.3
const API = 'https://api.simkl.com'
const SITE = 'https://simkl.com'
const IMG = 'https://simkl.in'

export const icon = 'https://simkl.com/favicon.ico'
export const originUrl = 'https://simkl.com'
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'Simkl'
export const origin = 'simkl'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['simkl']
export const color = '#0b0f10'

type SimklType = 'tv' | 'anime' | 'movies'

interface SimklIds {
  simkl?: number
  slug?: string
  imdb?: string
  tmdb?: string
  mal?: string
  anilist?: string
  kitsu?: string
}
interface SimklRatings {
  simkl?: { rating?: number }
  imdb?: { rating?: number }
  mal?: { rating?: number }
}
/**
 * A row of simkl.com's own search, keyed `i<id>` in its answer. `titles.m` is the main title, `a7` the
 * English one. `year` is the record's start year, alone or opening a span (`2016`, `2023 - 2024`,
 * `1999 - Now`), and `''` when simkl has none.
 */
interface SimklSiteHit {
  id?: string
  url?: string
  poster?: string
  year?: string
  titles?: Record<string, string>
}
interface SimklDetail {
  title?: string
  en_title?: string | null
  year?: number
  ids?: SimklIds
  poster?: string
  fanart?: string
  overview?: string
  first_aired?: string
  ratings?: SimklRatings
}
interface SimklEpisode {
  title?: string
  description?: string | null
  season?: number
  episode?: number
  type?: string
  img?: string
  date?: string
}

// A detail or an episode list needs no client id. A detail asked under the wrong type answers 412
// `client_id_failed`, which is how getMedia's walk over the three types reads a miss.
const api = <T>(path: string, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx.fetch(`${API}${path}`).then(r => r.json() as Promise<T>).catch(() => undefined)

// The api's /search is the one read that needs a client id, so search goes through the form simkl.com's
// own search page posts (search.min.js, read 2026-10-07), sent as its jQuery sends it. The site answers
// it only with its own origin and referer, and answers `[]` for no hits.
const siteSearch = (query: string, type: SimklType, ctx: ExtractorServerContext): Promise<SimklSiteHit[]> =>
  ctx
    .fetch(`${SITE}/ajax/full/search.php`, {
      method: 'POST',
      headers: {
        origin: SITE,
        referer: `${SITE}/search/`,
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: new URLSearchParams({ s: query, type, more: '', sort: '' }).toString(),
    })
    .then(r => r.json() as Promise<Record<string, SimklSiteHit> | SimklSiteHit[] | null>)
    .then(answer => (answer && typeof answer === 'object' ? Object.values(answer) : []))
    .catch(() => [])

const poster = (path?: string): string | undefined => (path ? `${IMG}/posters/${path}_m.jpg` : undefined)
const fanart = (path?: string): string | undefined => (path ? `${IMG}/fanart/${path}_w.jpg` : undefined)
const still = (path?: string): string | undefined => (path ? `${IMG}/episodes/${path}_w.jpg` : undefined)

const detailPath = (type: SimklType): string => (type === 'tv' ? '/tv' : type === 'anime' ? '/anime' : '/movies')
const episodesPath = (type: SimklType): string => (type === 'tv' ? '/tv/episodes' : '/anime/episodes')
const typeOfUrl = (url?: string): SimklType | undefined => url?.match(/^\/(tv|anime|movies)\//)?.[1] as SimklType | undefined
const categoriesForType = (type: SimklType): MediaCategory[] => (type === 'movies' ? ['MOVIE'] : type === 'anime' ? ['ANIME', 'SERIES'] : ['SERIES'])

// A tv record is one show with every season under it (its episodes carry a season field), so it is a
// CONTAINER. An anime record is one run, the reason this source is worth reading: Mushoku Tensei is
// five records here, each with its own mal, anilist and kitsu id. A movie is a run.
const scopeForType = (type: SimklType): MediaScope => (type === 'tv' ? 'CONTAINER' : 'RUN')

// The imdb id on a tv or anime record is the SHOW's, identical across every run (all five Mushoku
// Tensei records carry tt13303712), so it is CONTAINER unless the record is a film, whose imdb id
// names the film itself. mal, anilist and kitsu number per run and stay RUN.
const imdbScopeForType = (type: SimklType): MediaScope => (type === 'movies' ? 'RUN' : 'CONTAINER')

/**
 * The handles a simkl id block is worth minting.
 *
 * `tmdb` is NOT among them, in either direction, and the two reasons are different.
 *
 * ON A TV OR ANIME RECORD it is a TMDB **tv** id, which names the SHOW. Simkl keeps a separate record
 * per run of an anime, and puts the show's one tmdb id on every one of them: measured live, all five
 * Mushoku Tensei runs carry `tmdb:94664`. A handle is an identity claim, so minting it says those five
 * runs are one media and `upsertMedia` unions them before any season mechanism is consulted. Simkl's
 * own `season` field cannot rescue it either, being null on first runs and repeating `2` across three.
 *
 * ON A MOVIE RECORD it is a TMDB **movie** id, and TMDB numbers movies and tv shows in SEPARATE
 * sequences that both start at 1. Measured 2026-09-04: `themoviedb.org/movie/550` is Fight Club and
 * `themoviedb.org/tv/550` is Till Death Us Do Part. Stub's uri is `tmdb:550` for both, so minting a
 * movie id here would weld a film to whatever unrelated series holds that number. `tmdb/extractor.ts`
 * is `categories = ['SERIES']` and reads `/tv/` pages only, so it could not resolve the movie id
 * anyway: the handle would be an orphan that can still collide.
 *
 * `tmdb` deliberately does NOT go in `SHOW_LEVEL_ORIGINS` for this. Unlike imdb, tmdb CAN be scoped,
 * and `tmdb/extractor.ts` mints a real `<id>-s<n>` through `seasonScopedId`. Exempting the origin
 * would throw away those correct handles to fix a bare id minted somewhere else. The refusal belongs
 * at the source that cannot make an honest id, which is this one.
 *
 * The cost is the TMDB link disappearing from a simkl-sourced media, which is the same trade `db.ts`
 * already recorded for imdb and the smaller loss.
 */
const buildHandles = (ids: SimklIds | undefined, type: SimklType): GQLMedia[] => {
  if (!ids) return []
  const handles: GQLMedia[] = []
  if (ids.imdb) handles.push(makeMedia({ origin: 'imdb', id: ids.imdb, url: `https://www.imdb.com/title/${ids.imdb}`, scope: imdbScopeForType(type) }))
  if (ids.mal) handles.push(makeMedia({ origin: 'mal', id: ids.mal, url: `https://myanimelist.net/anime/${ids.mal}` }))
  if (ids.anilist) handles.push(makeMedia({ origin: 'anilist', id: ids.anilist, url: `https://anilist.co/anime/${ids.anilist}` }))
  if (ids.kitsu) handles.push(makeMedia({ origin: 'kitsu', id: ids.kitsu, url: `https://kitsu.io/anime/${ids.kitsu}` }))
  return handles
}

// An episode's `date` arrives in either shape, and they are not interchangeable: utils/release-date.ts
// renders a bare `YYYY-MM-DD` as that calendar day in UTC and a timestamped value where the viewer is,
// so a day widened into an instant shows a day early everywhere west of Greenwich. A value naming a
// day is therefore passed through untouched and only a real timestamp is normalised.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/
const airedAt = (value?: string | null): string | undefined => {
  if (!value) return undefined
  if (DAY_ONLY.test(value)) return value
  const at = new Date(value)
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString()
}

const rating = (ratings?: SimklRatings): number | undefined =>
  ratings?.simkl?.rating ?? ratings?.imdb?.rating ?? ratings?.mal?.rating

const buildTitles = (title?: string, enTitle?: string | null) => {
  const titles: { language: string, title: string, score: number }[] = []
  const seen = new Set<string>()
  for (const raw of [title, enTitle ?? undefined]) {
    const t = raw && decodeEntities(raw)
    if (t && !seen.has(t)) { seen.add(t); titles.push({ language: 'en', title: t, score: SCORE }) }
  }
  return titles
}

// A hit with no start date joins no year bucket in fuzzy-merge.ts, so it was never compared with the
// run it names. The year is the record's own on every scope: an anime record is one run (Frieren's are
// 2023, 2026 and 2027), a tv record the show, a movie the film.
const startOfYear = (year?: string): string | undefined => {
  const start = year?.match(/^\d{4}\b/)?.[0]
  return start ? `${start}-01-01` : undefined
}

// The main title is often the franchise's, on every run (all three Frieren runs are `Sousou no
// Frieren`), and a year cannot tell two runs of one year apart: Mushoku Tensei's Part 2 welded into
// season 1 on it, both 2021. So where the English title names a season or part and the main title
// names none, the main title is left out.
const searchTitles = ({ m, a7 }: Record<string, string> = {}) =>
  a7 && parseSeasonNumber(a7) !== undefined && parseSeasonNumber(m ?? '') === undefined ? buildTitles(a7) : buildTitles(m, a7)

// A site hit carries no catalogue ids, so it mints no handle; the detail read supplies them.
const normalizeSearch = (hit: SimklSiteHit): GQLMedia | undefined => {
  const type = typeOfUrl(hit.url)
  if (!hit.id || !type) return undefined
  return makeMedia({
    origin,
    id: hit.id,
    url: `https://simkl.com/${type}/${hit.id}`,
    scope: scopeForType(type),
    categories: categoriesForType(type),
    score: SCORE,
    titles: searchTitles(hit.titles),
    covers: img(poster(hit.poster), SCORE),
    startDate: startOfYear(hit.year),
  })
}

const normalizeDetail = (detail: SimklDetail, id: string, type: SimklType): GQLMedia | undefined => {
  if (!detail.title) return undefined
  return makeMedia({
    origin,
    id,
    url: `https://simkl.com/${type}/${id}`,
    scope: scopeForType(type),
    handles: buildHandles(detail.ids, type),
    categories: categoriesForType(type),
    score: SCORE,
    titles: buildTitles(detail.title, detail.en_title),
    ...desc(detail.overview, SCORE),
    covers: img(poster(detail.poster), SCORE),
    banners: img(fanart(detail.fanart), SCORE),
    startDate: detail.first_aired || undefined,
    averageScore: percentScore(rating(detail.ratings), 10),
  })
}

const normalizeEpisode = (episode: SimklEpisode, mediaId: string, mediaUri: string, index: number): GQLEpisode => {
  const season = episode.season ?? 1
  // an anime record numbers its specials from 1 again, so a special's number is no episode of the run
  const number = episode.type === 'special' ? undefined : episode.episode
  return makeEpisode({
    origin,
    id: number !== undefined ? `${mediaId}-s${season}e${number}` : `${mediaId}-i${index}`,
    mediaUri,
    score: SCORE,
    titles: episode.title ? [{ language: 'en', title: episode.title, score: SCORE }] : [],
    ...desc(episode.description ?? undefined, SCORE),
    thumbnails: img(still(episode.img), SCORE),
    seasonNumber: episode.season ?? undefined,
    episodeNumber: number ?? undefined,
    releaseDate: airedAt(episode.date),
  })
}

const fetchEpisodes = async (id: string, type: SimklType, mediaUri: string, ctx: ExtractorServerContext): Promise<GQLEpisode[]> => {
  // Movies get their single synthetic episode in getMedia, which has the media to derive it from.
  if (type === 'movies') return []
  const list = await api<SimklEpisode[]>(`${episodesPath(type)}/${id}?extended=full`, ctx)
  return (Array.isArray(list) ? list : [])
    .filter(episode => episode.type !== 'special' || !!episode.title)
    .map((episode, index) => normalizeEpisode(episode, id, mediaUri, index))
}

const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  for (const type of ['tv', 'anime', 'movies'] as const) {
    const detail = await api<SimklDetail>(`${detailPath(type)}/${id}?extended=full`, ctx)
    const media = detail ? normalizeDetail(detail, id, type) : undefined
    if (!media) continue
    if (isMovie(media)) {
      media.episodes = [makeMovieEpisode(media)]
      media.episodeCount = 1
      return media
    }
    media.episodes = await fetchEpisodes(id, type, media.uri, ctx)
    media.episodeCount = media.episodes.filter(episode => episode.episodeNumber != null).length
    return media
  }
  return undefined
}

const searchType = async (query: string, type: SimklType, ctx: ExtractorServerContext): Promise<GQLMedia[]> =>
  (await siteSearch(query, type, ctx))
    .map(normalizeSearch)
    .filter((media): media is GQLMedia => !!media)

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const perType = await Promise.all((['tv', 'anime', 'movies'] as const).map(type => searchType(query, type, ctx)))
  const out: GQLMedia[] = []
  const seen = new Set<string>()
  for (const media of perType.flat()) {
    if (seen.has(media.id)) continue
    seen.add(media.id)
    out.push(media)
  }
  return out
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const simklUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: simklUri ? (await getMedia(simklUri.id, ctx)) ?? null : null }
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
      if (isMovie(parent)) return [makeMovieEpisode(parent)]
      const media = await getMedia(parent.id, ctx)
      return media?.episodes ?? []
    }
  }
}
