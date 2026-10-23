import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, MediaHandle as GQLMediaHandle } from '../../generated/schema/types.generated'

import { MediaStatus, MediaType } from '../../generated/graphql'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, desc, img, partOf, sameAs } from '../utils'
import { animeSeasonOf, lowerSeason, upperSeason, type AnimeSeason } from '../season'
import { seasonPageNumbers, seasonQuery } from './season-paging'
import { mintableAsFilmHandle, streamPointers, type StreamPointer } from './stream-id'
import { percentScore } from '../average-score'

const SCORE = 0.3
const API = 'https://kitsu.io/api/edge'

export const icon = 'https://kitsu.io/favicon.ico'
export const originUrl = 'https://kitsu.io'
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'Kitsu'
export const origin = 'kitsu'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['kitsu']
export const color = '#f75239'

interface KitsuImage { medium?: string, large?: string, original?: string }
interface KitsuAnime {
  synopsis?: string | null
  titles?: Record<string, string>
  canonicalTitle?: string | null
  averageRating?: string | null
  startDate?: string | null
  endDate?: string | null
  subtype?: string | null
  status?: string | null
  episodeCount?: number | null
  userCount?: number | null
  youtubeVideoId?: string | null
  posterImage?: KitsuImage | null
  coverImage?: KitsuImage | null
}
interface KitsuEpisodeAttr {
  canonicalTitle?: string | null
  synopsis?: string | null
  seasonNumber?: number | null
  number?: number | null
  thumbnail?: KitsuImage | null
}
interface KitsuMapping { externalSite?: string, externalId?: string }
interface KitsuStream { url?: string }

interface KitsuResource<T> {
  id: string
  attributes: T
  relationships?: { mappings?: { data?: { id: string }[] } }
}
interface KitsuResponse<T> {
  data?: KitsuResource<T> | KitsuResource<T>[]
  included?: KitsuResource<KitsuMapping>[]
}

const api = <T>(path: string, ctx: ExtractorServerContext): Promise<KitsuResponse<T> | undefined> =>
  ctx.fetch(`${API}${path}`).then(r => r.json() as Promise<KitsuResponse<T>>).catch(() => undefined)

const mappingHandles = (mappings: KitsuMapping[]): GQLMedia[] => {
  const handles: GQLMedia[] = []
  for (const m of mappings) {
    const id = m.externalId
    if (!id) continue
    if (m.externalSite === 'anilist/anime') handles.push(makeMedia({ origin: 'anilist', id, url: `https://anilist.co/anime/${id}` }))
    else if (m.externalSite === 'myanimelist/anime') handles.push(makeMedia({ origin: 'mal', id, url: `https://myanimelist.net/anime/${id}` }))
  }
  return handles
}

/**
 * Kitsu's streaming links, spent two ways depending on what the id can honestly claim.
 *
 * MINTED DIRECTLY when the record is a film AND the link is one of the few (origin, path segment)
 * pairs measured to carry a per-title id. Netflix is the whole of that list today: it gives every
 * title its own `/title/<id>`, so a film's Netflix link names the film.
 *
 * CARRIED AS PART_OF for everything else, because the show id is true as containment and false as
 * identity. Kitsu publishes the same `crunchyroll.com/series/G24H1N3MP/...` on kitsu:45950,
 * kitsu:47694 and kitsu:49002, three different runs of Mushoku Tensei, so minting it welds all three
 * permanently; a film published under a series page is part of that series too. The precise run is
 * not asked for here: the WORKER asks the owning origin on the run's page, once per run and container,
 * with the whole cluster's evidence (the best day-precise date, every title, the highest-scored count,
 * the episode titles), which is more than this record knows at handle time and is spent on no listing.
 *
 * DROPPED never. An id this source cannot read is not a pointer at all (see `streamPointers`), and
 * every pointer is at least a link to the show the run is part of.
 */
const streamHandles = (streams: KitsuStream[], attr: KitsuAnime): GQLMediaHandle[] => {
  const pointers = streamPointers(streams.map(stream => stream.url))
  const container = ({ origin, id, url }: StreamPointer) => partOf(makeMedia({ origin, id, url }))

  // both halves of this are load bearing and neither implies the other: the subtype says a refusal
  // here has nowhere else to go, and the pointer says whether the id names this film. See ./stream-id.ts
  if (attr.subtype === 'movie') {
    return pointers.map(pointer =>
      mintableAsFilmHandle(pointer)
        ? sameAs(makeMedia({ origin: pointer.origin, id: pointer.id, url: pointer.url }))
        : container(pointer)
    )
  }
  return pointers.map(container)
}

const includedMappings = (response: KitsuResponse<unknown>): Map<string, KitsuMapping> =>
  new Map((response.included ?? []).map(inc => [inc.id, inc.attributes]))

const resourceMappings = (resource: KitsuResource<unknown>, map: Map<string, KitsuMapping>): KitsuMapping[] =>
  (resource.relationships?.mappings?.data ?? []).map(ref => map.get(ref.id)).filter((m): m is KitsuMapping => !!m)

const buildTitles = (attr: KitsuAnime) => {
  const t = attr.titles ?? {}
  const entries: [string | undefined, string][] = [[t.en, 'en'], [attr.canonicalTitle ?? undefined, 'en'], [t.ja_jp, 'ja']]
  const titles: { language: string, title: string, score: number }[] = []
  const seen = new Set<string>()
  for (const [title, language] of entries) {
    if (title && !seen.has(title)) { seen.add(title); titles.push({ language, title, score: SCORE }) }
  }
  return titles
}

// GENRES ARE LEFT OUT ON PURPOSE, not forgotten. Kitsu publishes them as `categories`, a separate
// JSON:API relationship, so every request in this file would have to carry `include=mappings,categories`
// and grow its response, to buy a field AniList and jikan already answer for the same titles.
export const normalizeMedia = (resource: KitsuResource<KitsuAnime>, handles: (GQLMedia | GQLMediaHandle)[] = []): GQLMedia => {
  const attr = resource.attributes
  return makeMedia({
    origin,
    id: resource.id,
    url: `https://kitsu.io/anime/${resource.id}`,
    handles,
    score: SCORE,
    categories: attr.subtype === 'movie' ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES'],
    type:
      attr.subtype === 'TV' ? MediaType.Tv
      : attr.subtype === 'movie' ? MediaType.Movie
      : attr.subtype === 'special' ? MediaType.Special
      : attr.subtype === 'OVA' ? MediaType.Ova
      : attr.subtype === 'ONA' ? MediaType.Ona
      : undefined,
    titles: buildTitles(attr),
    ...desc(attr.synopsis ?? undefined, SCORE),
    covers: img(attr.posterImage?.original ?? attr.posterImage?.large ?? attr.posterImage?.medium, SCORE),
    banners: img(attr.coverImage?.original ?? attr.coverImage?.large, SCORE),
    startDate: attr.startDate || undefined,
    endDate: attr.endDate || undefined,
    episodeCount: attr.episodeCount ?? undefined,
    // the homepage sorts on this, so a season list without it renders in arbitrary order
    popularity: attr.userCount ?? undefined,
    status:
      attr.status === 'current' ? MediaStatus.Releasing
      : attr.status === 'upcoming' ? MediaStatus.NotYetReleased
      : attr.status === 'finished' ? MediaStatus.Finished
      : undefined,
    trailers:
      attr.youtubeVideoId
        ? [{
          uri: `yt:${attr.youtubeVideoId}`,
          origin: 'yt',
          id: attr.youtubeVideoId,
          url: `https://www.youtube.com/watch?v=${attr.youtubeVideoId}`,
          language: 'en'
        }]
        : [],
    averageScore: percentScore(attr.averageRating, 100),
  })
}

const normalizeEpisode = (resource: KitsuResource<KitsuEpisodeAttr>, mediaUri: string): GQLEpisode => {
  const attr = resource.attributes
  return makeEpisode({
    origin,
    id: resource.id,
    mediaUri,
    score: SCORE,
    titles: attr.canonicalTitle ? [{ language: 'en', title: attr.canonicalTitle, score: SCORE }] : [],
    ...desc(attr.synopsis ?? undefined, SCORE),
    thumbnails: img(attr.thumbnail?.original ?? attr.thumbnail?.large ?? attr.thumbnail?.medium, SCORE),
    seasonNumber: attr.seasonNumber ?? undefined,
    episodeNumber: attr.number ?? undefined,
  })
}

const fetchEpisodes = async (id: string, mediaUri: string, ctx: ExtractorServerContext): Promise<GQLEpisode[]> => {
  const all: GQLEpisode[] = []
  for (let offset = 0; offset < 2_000; offset += 20) {
    const page = await api<KitsuEpisodeAttr>(`/anime/${id}/episodes?page%5Blimit%5D=20&page%5Boffset%5D=${offset}&sort=number`, ctx)
    const data = Array.isArray(page?.data) ? page.data : []
    all.push(...data.map(episode => normalizeEpisode(episode, mediaUri)))
    if (data.length < 20) break
  }
  return all
}

const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const [show, streams] = await Promise.all([
    api<KitsuAnime>(`/anime/${id}?include=mappings`, ctx),
    api<KitsuStream>(`/anime/${id}/streaming-links`, ctx),
  ])
  const data = show?.data
  const resource = Array.isArray(data) ? data[0] : data
  if (!resource) return undefined
  const streamList = Array.isArray(streams?.data) ? streams.data : []
  const handles = [
    ...mappingHandles(resourceMappings(resource, includedMappings(show ?? {}))),
    ...streamHandles(streamList.map(stream => stream.attributes), resource.attributes),
  ]
  const media = normalizeMedia(resource, handles)
  media.episodes = await fetchEpisodes(id, media.uri, ctx)
  media.episodeCount = media.episodes.length
  return media
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const res = await api<KitsuAnime>(`/anime?filter%5Btext%5D=${encodeURIComponent(query)}&include=mappings&page%5Blimit%5D=10`, ctx)
  const list = Array.isArray(res?.data) ? res.data : []
  const map = includedMappings(res ?? {})
  return list.map(resource => normalizeMedia(resource, mappingHandles(resourceMappings(resource, map))))
}

const seasonPage = async (
  { season, year, page }: { season: AnimeSeason, year: number, page: number },
  ctx: ExtractorServerContext
): Promise<GQLMedia[]> => {
  try {
    const res = await api<KitsuAnime>(seasonQuery({ season, year, page }), ctx)
    const list = Array.isArray(res?.data) ? res.data : []
    const map = includedMappings(res ?? {})
    // Kitsu's anime attributes carry no season, but the REQUEST filtered on one, so every row that
    // came back is in it. Stamped here and nowhere else: nothing on the search path establishes one.
    return list.map(resource => ({
      ...normalizeMedia(resource, mappingHandles(resourceMappings(resource, map))),
      season: upperSeason(season),
      seasonYear: year,
    }))
  } catch (error) {
    console.error(`Kitsu season page ${page} failed`, error)
    return []
  }
}

/**
 * One season's listing. Defaults to the clock's season, which is what the homepage asks every source
 * for; a caller naming a season gets that one instead.
 *
 * Kitsu earns this because one keyless request carries the season AND `include=mappings`, whose
 * myanimelist and anilist ids are what let the union-find store merge these records with every
 * other source's rather than showing the season twice.
 *
 * Every page is fired at once and stands on its own: asking for `meta.count` first would make the
 * whole listing hinge on one request succeeding, which is the exact shape that left the homepage
 * empty when its only two sources were AniList and Jikan.
 *
 * What this does NOT cover, measured rather than assumed: Kitsu's summer 2026 listing is 117 titles
 * against 219 in an independent census (manami-project's offline database), and R18 titles are
 * dropped entirely on a keyless request. So this is a solid SFW slice of the season, not the whole
 * of it, which is an argument for more sources rather than against this one.
 */
const getSeason = async (
  ctx: ExtractorServerContext,
  { season, year }: { season: AnimeSeason, year: number } = animeSeasonOf()
): Promise<GQLMedia[]> => {
  const pages = await Promise.all(
    seasonPageNumbers().map(page => seasonPage({ season, year, page }, ctx))
  )
  // Deduplicated by uri rather than trusting the paging: Kitsu's documented page[offset] form
  // repeats a page outright on this filter, so a walk that assumes distinct pages is not safe to
  // assume here. If the working form ever drifts the same way, the page loses titles rather than
  // showing one twice.
  const byUri = new Map<string, GQLMedia>()
  for (const media of pages.flat()) if (!byUri.has(media.uri)) byUri.set(media.uri, media)
  return [...byUri.values()]
}

/**
 * The season an input names, in Kitsu's spelling, or nothing when it does not name one outright.
 *
 * Both halves are required: `filter[season]` on its own names every WINTER there has ever been, and
 * `seasonQuery` builds the pair or nothing.
 */
const askedSeason = (
  { season, seasonYear }: { season?: string | null, seasonYear?: number | null }
): { season: AnimeSeason, year: number } | undefined => {
  const spelling = season ? lowerSeason(season) : undefined
  return spelling && seasonYear ? { season: spelling, year: seasonYear } : undefined
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const kitsuUri = extractAggregatedUriOrigin(uri, origin)
        yield { media: kitsuUri ? (await getMedia(kitsuUri.id, ctx)) ?? null : null }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        const { search, status, season, seasonYear } = input
        const asked = askedSeason(input)
        if (asked) return yield { mediaPage: { nodes: await getSeason(ctx, asked) } }
        // Naming EITHER half of the pair is load bearing: an input that names a season or a year the
        // pair cannot be completed from is answered by the search below or by nothing, never by the
        // clock's season. Answering the wrong season costs a walk of 8 upstream requests, and leaks
        // on every axis the store's filter cannot see.
        if (status === 'RELEASING' && !season && !seasonYear) return yield { mediaPage: { nodes: await getSeason(ctx) } }
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
