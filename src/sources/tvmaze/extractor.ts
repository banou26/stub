import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, SimilarMediaInput } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, desc, img, waitForMedia } from '../utils'
import { seasonScopedId, splitSeasonScopedId } from '../season'
import { pickSimilarSeason, type SeasonCandidate } from '../similar'
import { decodeEntities } from '../entities'
import { percentScore } from '../average-score'

const SCORE = 0.3
const API = 'https://api.tvmaze.com'

export const icon = 'https://www.tvmaze.com/favicon.ico'
export const originUrl = 'https://www.tvmaze.com'
export const categories = ['SERIES'] as const
export const name = 'TVmaze'
export const origin = 'tvmaze'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['tvmaze']
export const color = '#3c948b'

const text = (html: string | null | undefined): string | undefined => {
  if (!html) return undefined
  return decodeEntities(html.replace(/<[^>]+>/g, '')).trim() || undefined
}

const api = <T>(path: string, ctx: ExtractorServerContext): Promise<T | undefined> =>
  ctx.fetch(`${API}${path}`).then(r => r.json() as Promise<T>).catch(() => undefined)

interface TvmazeImage { medium?: string, original?: string }
interface TvmazeShow {
  id: number
  url?: string
  name?: string
  premiered?: string | null
  rating?: { average?: number | null }
  externals?: { imdb?: string | null, thetvdb?: number | null }
  image?: TvmazeImage | null
  summary?: string | null
  _embedded?: { episodes?: TvmazeEpisode[] }
}
interface TvmazeEpisode {
  id: number
  name?: string
  season?: number
  number?: number
  airdate?: string | null
  airstamp?: string | null
  summary?: string | null
  image?: TvmazeImage | null
}

// TVmaze publishes both shapes and they are not interchangeable: `airdate` NAMES A DAY while
// `airstamp` names an INSTANT, and utils/release-date.ts renders a bare `YYYY-MM-DD` as that calendar
// day in UTC and a timestamped value where the viewer is. A day widened into an instant therefore
// shows a day early everywhere west of Greenwich, so the instant goes out only when TVmaze published
// one and the day goes out as a day.
const airedAt = (episode: TvmazeEpisode): string | undefined => {
  const instant = episode.airstamp ? new Date(episode.airstamp) : undefined
  return instant && !Number.isNaN(instant.getTime()) ? instant.toISOString() : episode.airdate || undefined
}

// The imdb id is the SHOW's, one for every season, so it is a CONTAINER whichever row carries it.
const buildHandles = (show: TvmazeShow): GQLMedia[] => {
  const imdb = show.externals?.imdb
  return imdb ? [makeMedia({ origin: 'imdb', id: imdb, url: `https://www.imdb.com/title/${imdb}`, scope: 'CONTAINER' })] : []
}

// TVmaze describes a SHOW while a stub media is one season, so a season-scoped media cannot carry the
// bare show id: every season would hand back the same one and clustering union-finds them into a
// single media. Same defect TMDB and JustWatch had, same '-s<n>' fix. The bare show id is still minted
// for SEARCH, and for a show with no season to pick, scoped CONTAINER so the store keeps it out of
// every run's identity space: the live site fuzzy merged 'tvmaze:52279' into Mushoku Tensei season 1
// and season 3 then asserted sameness through it.
const normalizeMedia = (
  show: TvmazeShow,
  seasonNumber?: number,
  handles: GQLMedia[] = [],
  seasonPremiere?: string
): GQLMedia =>
  makeMedia({
    origin,
    id: seasonNumber == null ? String(show.id) : seasonScopedId(show.id, seasonNumber),
    scope: seasonNumber == null ? 'CONTAINER' : 'RUN',
    url: show.url ?? `https://www.tvmaze.com/shows/${show.id}`,
    handles,
    categories: ['SERIES'],
    score: SCORE,
    titles: show.name ? [{ language: 'en', title: show.name, score: SCORE }] : [],
    ...desc(text(show.summary), SCORE),
    covers: img(show.image?.original ?? show.image?.medium, SCORE),
    // A SEASON-scoped media may never carry the SHOW's premiere, which is season 1's date.
    //
    // It is not merely inaccurate, it welds seasons together, and by a route that looks nothing like a
    // title problem: profileCluster derives its `years` set from every member's startDate, so a season 3
    // cluster holding this media carries BOTH 2019 and season 1's 2016, and fuzzyMergeMediaClusters
    // buckets by year, so it lands in season 1's bucket where a shared title is enough. Reproduced
    // against the store on Bungou Stray Dogs: with the show date the two seasons come back as one
    // component, with the season's own date they stay apart.
    //
    // The season's premiere is the earliest airdate among ITS episodes, taken by date rather than by
    // episode number because a recap or special routinely carries episode 0 or an out-of-order number.
    // Nothing is asserted when it is unknown: an absent date costs this source a year bucket, a wrong
    // one costs a permanent weld, and graph.link has no inverse.
    startDate: (seasonNumber == null ? show.premiered : seasonPremiere) || undefined,
    averageScore: percentScore(show.rating?.average, 10),
  })

const normalizeEpisode = (episode: TvmazeEpisode, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: String(episode.id),
    mediaUri,
    score: SCORE,
    titles: episode.name ? [{ language: 'en', title: episode.name, score: SCORE }] : [],
    ...desc(text(episode.summary), SCORE),
    thumbnails: img(episode.image?.original ?? episode.image?.medium, SCORE),
    seasonNumber: episode.season,
    episodeNumber: episode.number,
    releaseDate: airedAt(episode),
  })

/** The earliest airdate among one season's episodes, off the embedded list, no extra request. */
const seasonPremiere = (episodes: TvmazeEpisode[], seasonNumber?: number): string | undefined => {
  if (seasonNumber == null) return undefined
  let earliest: string | undefined
  for (const episode of episodes) {
    if (episode.season !== seasonNumber || !episode.airdate) continue
    if (!earliest || episode.airdate < earliest) earliest = episode.airdate
  }
  return earliest
}

/**
 * Every season of a show as `pickSimilarSeason` reads one, straight off the embedded episode list with
 * no extra request: its number, its size, its earliest airdate and its episode titles.
 */
const seasonCandidates = (episodes: TvmazeEpisode[]): SeasonCandidate<{ seasonNumber: number }>[] => {
  const counts = new Map<number, number>()
  for (const episode of episodes) {
    if (episode.season == null) continue
    counts.set(episode.season, (counts.get(episode.season) ?? 0) + 1)
  }
  return [...counts].map(([seasonNumber, episodeCount]) => ({
    season: { seasonNumber },
    seasonNumber,
    episodeCount,
    premiere: seasonPremiere(episodes, seasonNumber),
    episodeTitles: episodes.filter(episode => episode.season === seasonNumber).map(episode => episode.name ?? ''),
  }))
}

/** One season's run, or with no season the SHOW as a container carrying every episode, as before. */
const runMedia = (show: TvmazeShow, all: TvmazeEpisode[], seasonNumber: number | undefined): GQLMedia => {
  const media = normalizeMedia(show, seasonNumber, buildHandles(show), seasonPremiere(all, seasonNumber))
  const episodes = seasonNumber == null ? all : all.filter(episode => episode.season === seasonNumber)
  media.episodes = episodes.map(episode => normalizeEpisode(episode, media.uri))
  media.episodeCount = media.episodes.length
  return media
}

const getMedia = async (uri: string, id: string, pinned: number | undefined, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const show = await api<TvmazeShow>(`/shows/${id}?embed=episodes`, ctx)
  if (!show) return undefined
  const all = show._embedded?.episodes ?? []
  const candidates = seasonCandidates(all)

  // The probe stays SYNCHRONOUS: waitForMedia keeps the first result it finds truthy, and a promise
  // is always truthy, so an async one would succeed instantly with a value that resolves to nothing.
  // No lone-season shortcut: a lone season shorter than our run passes the picker on its own, and a
  // lone season LONGER than it is a fold the shortcut used to hand over.
  const seasonNumber = pinned ?? (candidates.length ? await waitForMedia(uri, ctx, (media: any) => pickSimilarSeason({
    titles: (media?.titles ?? []).map((title: { title: string }) => title.title),
    startDate: media?.startDate,
    episodeCount: media?.episodeCount ?? undefined,
  }, candidates)?.season.seasonNumber) : undefined)

  // a series whose season cannot be determined has no identity here: see normalizeMedia
  if (seasonNumber == null && candidates.length > 1) return undefined

  return runMedia(show, all, seasonNumber)
}

/** The one season of `showId` the caller's evidence establishes, as a run, or nothing. */
const seasonForShow = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const show = await api<TvmazeShow>(`/shows/${input.showId}?embed=episodes`, ctx)
  if (!show) return undefined
  const all = show._embedded?.episodes ?? []
  const verdict = pickSimilarSeason(input, seasonCandidates(all))
  return verdict ? runMedia(show, all, verdict.season.seasonNumber) : undefined
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const res = await api<{ show: TvmazeShow }[]>(`/search/shows?q=${encodeURIComponent(query)}`, ctx)
  return (res ?? []).map(result => normalizeMedia(result.show, undefined, buildHandles(result.show)))
}

export const resolvers: Resolvers = {
  Subscription: {
    similarMedia: {
      // always yield once: a generator that completes without yielding makes yoga respond 204 and the
      // caller waits out its timeout instead of reading the refusal
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        if (!input?.showId) return yield { similarMedia: null }
        yield { similarMedia: await seasonForShow(input, ctx) ?? null }
      }
    },
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const tvmazeUri = extractAggregatedUriOrigin(uri, origin)
        if (!tvmazeUri) return yield { media: null }
        // the uri may already pin the season, since that is now part of the id
        const { showId, seasonNumber } = splitSeasonScopedId(tvmazeUri.id)
        yield { media: (await getMedia(uri, showId, seasonNumber, ctx)) ?? null }
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
      // parent.id is '<show>-s<season>' now, so the show has to be split back out of it
      const { showId, seasonNumber } = splitSeasonScopedId(parent.id)
      const episodes = await api<TvmazeEpisode[]>(`/shows/${showId}/episodes`, ctx)
      const kept = seasonNumber == null ? (episodes ?? []) : (episodes ?? []).filter(episode => episode.season === seasonNumber)
      return kept.map(episode => normalizeEpisode(episode, parent.uri))
    }
  }
}
