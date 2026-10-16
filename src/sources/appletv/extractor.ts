import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, SimilarMediaInput } from '../../generated/schema/types.generated'

import { siteAllows } from '../../site'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img, getFirstTitle, buildHandlesFromUri, waitForMedia, declaredEpisodeCount, searchRelevance, SEARCH_RELEVANCE_THRESHOLD } from '../utils'
import { seasonScopedId, splitSeasonScopedId } from '../season'
import { pickGatedCandidate, searchQueries } from '../catalogue-gate'
import { pickSimilarSeason, type SeasonCandidate } from '../similar'

const SCORE = 0.2

export const icon = 'https://tv.apple.com/favicon.ico'
export const originUrl = 'https://tv.apple.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Apple TV+'
export const origin = 'appletv'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['appletv']
export const color = '#e8e8ed'

const ATV = 'https://uts-api.itunes.apple.com/uts/v3'
// The US storefront, so every url minted here is a /us/ one. Japan's is 143462; which of the two plays
// for a Japanese account is for a live check to settle.
const STOREFRONT = '143441'
const PARAMS = `caller=web&sf=${STOREFRONT}&v=58&pfm=web&locale=en-US&utsk=0`

const api = <T>(path: string, ctx: ExtractorServerContext, init?: RequestInit): Promise<T> =>
  ctx
    .fetch(`${ATV}${path}${path.includes('?') ? '&' : '?'}${PARAMS}`, init)
    .then(r => r.json() as Promise<T>)

const image = (img: AppleImage | undefined, w: number, h: number): string | undefined =>
  img?.url
    ?.replace('{w}', String(w))
    .replace('{h}', String(h))
    .replace('{c}', '')
    .replace('{f}', 'jpg')

interface AppleImage { url: string }
interface AppleImages {
  /**
   * 1680x3636, its crop in the template (`{w}x{h}tc.{f}`), so 600x900 is a 2:3 poster. None of 44 show
   * and film answers measured 2026-10-16 carries `coverArt`.
   */
  contentImageTall?: AppleImage
  /**
   * A show's or film's 4:3 key art with no lettering, its crop in the template (`{w}x{h}sr.{f}`), so
   * 1920x1080 is a 16:9 banner; `posterArt` is the same art with the title lettered on. On an episode it
   * is that episode's own 16:9 still. Measured 2026-10-16: none of 177 show and film answers carries
   * `coverArt16X9`, and none of 1470 episodes over 270 seasons `previewFrame`.
   */
  contentImage?: AppleImage
}
interface AppleItem {
  id: string
  type?: string
  title: string
  url?: string
  description?: string
  /** epoch MILLISECONDS, and at SHOW level this is season 1's: see ../catalogue-gate.ts */
  releaseDate?: number
  images?: AppleImages
}
interface AppleSeason {
  id: string
  seasonNumber?: number
  /** epoch milliseconds, THIS season's premiere, present on every season measured: ../catalogue-gate.ts */
  releaseDate?: number
}
interface AppleEpisode {
  id: string
  title: string
  description?: string
  seasonNumber?: number
  episodeNumber?: number
  url?: string
  releaseDate?: number
  images?: AppleImages
}

interface AppleSearchResponse { data?: { canvas?: { shelves?: { items?: AppleItem[] }[] } } }
interface AppleContentData { content?: AppleItem, seasons?: Record<string, AppleSeason> }
interface AppleContentResponse { data?: AppleContentData }
interface AppleEpisodesResponse { data?: { episodes?: AppleEpisode[] } }

/**
 * Apple TV describes a SHOW while a stub media is one season, so a season-scoped media may not carry
 * the bare `content.id`: every season hands back the same one, and because this source emits ITSELF as
 * the mediaUri with our uris as handles, that id reaches `graph.link` as an identity claim spanning
 * all of them. Same defect TMDB, TVmaze and JustWatch had, same '-s<n>' fix.
 *
 * A show-level id is still minted for SEARCH, and for a show whose season the media path could not
 * place, scoped CONTAINER both times: Apple TV genuinely is describing the show there, which is the
 * same fork tvmaze/extractor.ts draws.
 *
 * A MOVIE takes the bare id and keeps it, exactly as JustWatch's `showRequiresSeason` allows: it has
 * no seasons to be confused between, and its own release date IS the work's date.
 */
const normalizeMedia = (content: AppleItem, season?: AppleSeason): GQLMedia => {
  const cover = image(content.images?.contentImageTall, 600, 900)
  const banner = image(content.images?.contentImage, 1920, 1080)
  const scoped = season?.seasonNumber != null
  // A SEASON-scoped media may never carry the SHOW's date. It is not merely inaccurate, it welds
  // seasons together: profileCluster derives its `years` set from every member's startDate and
  // fuzzyMergeMediaClusters buckets by year, so a season 3 media stamped with the show's date drops
  // the whole cluster into season 1's bucket where a shared title is enough. That is the bug just
  // fixed in tvmaze and tmdb, and tests/unit/worker/store/season-separation.test.ts pins it.
  const releaseDate = scoped ? season!.releaseDate : content.releaseDate
  // The bare id of a Show is the id every season of it shares, so a row minted from it is the show,
  // and the store keeps a CONTAINER out of every run's identity space. A film and a season-scoped row
  // each name exactly one run.
  const scope = scoped || content.type === 'Movie' ? 'RUN' : 'CONTAINER'
  return makeMedia({
    origin,
    id: scoped ? seasonScopedId(content.id, season!.seasonNumber!) : content.id,
    scope,
    url: content.url,
    score: SCORE,
    type: content.type === 'Movie' ? 'MOVIE' : undefined,
    categories: content.type === 'Movie' ? ['MOVIE'] : ['SERIES'],
    titles: [{ language: 'en', title: content.title, score: SCORE }],
    ...desc(content.description, SCORE),
    covers: img(cover, SCORE),
    banners: img(banner, SCORE),
    // epoch milliseconds, not seconds: ../catalogue-gate.ts names the request that shows it
    startDate: releaseDate != null ? new Date(releaseDate).toISOString() : undefined,
  })
}

const normalizeEpisode = (episode: AppleEpisode, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: episode.id,
    mediaUri,
    url: episode.url,
    score: SCORE,
    titles: [{ language: 'en', title: episode.title, score: SCORE }],
    ...desc(episode.description, SCORE),
    thumbnails: img(image(episode.images?.contentImage, 1280, 720), SCORE),
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    // Epoch MILLISECONDS, converted here rather than at the reader: the units are established in
    // ../catalogue-gate.ts from real values, and a seconds-for-milliseconds mixup read downstream is
    // a silent 1970 rather than an error. Fetched on every episode and dropped until 2026-09-08.
    releaseDate: episode.releaseDate != null ? new Date(episode.releaseDate).toISOString() : undefined,
  })

/**
 * One season's episodes, and the filter is not a tidy-up.
 *
 * `selectedSeasonId` does not select a season, it positions a WINDOW in the show's flat episode list,
 * so a per-season request routinely answers with the tail of the previous season attached. Season 2 of
 * `Severance` answers with eleven episodes running 1x5 through 2x6:
 *
 *   curl -s 'https://uts-api.itunes.apple.com/uts/v3/shows/umc.cmc.1srk2goyh2q2zdxcx605w8vtx/episodes?selectedSeasonId=umc.cmc.uhm560ns0yg3a5fy454bb967&caller=web&sf=143441&v=58&pfm=web&locale=en-US&utsk=0'
 *
 * Measured 2026-08-29 over 150 seasons of 83 shows reachable from UTS search, one request per season:
 * 335 of the 1228 episodes returned (27.280%) belong to a season other than the one requested, and 67
 * of the 150 requests (44.667%) return at least one. So this source flattening every season's request
 * together, as it did, produced a list that was both duplicated and cross-season; the dedupe by id is
 * for the same reason, since a window can return an episode a neighbouring window already returned.
 *
 * There is no way to ask for the rest: `nextToken` is answered with `400 If nextToken is specified,
 * nextToken should be specified and non-negative` whatever value it is given, so a long season comes
 * back partial and that is the ceiling, not a bug to work around here.
 */
const fetchEpisodes = async (
  showId: string,
  seasons: Record<string, AppleSeason> | undefined,
  mediaUri: string,
  ctx: ExtractorServerContext,
  seasonNumber?: number
): Promise<GQLEpisode[]> => {
  const wanted = Object.values(seasons ?? {})
    .filter(season => seasonNumber == null || season.seasonNumber === seasonNumber)
    .map(season => season.id)
    .filter(Boolean)
  if (!wanted.length) return []
  const perSeason = await Promise.all(
    wanted.map(seasonId =>
      api<AppleEpisodesResponse>(`/shows/${showId}/episodes?selectedSeasonId=${seasonId}`, ctx)
        .then(res => res.data?.episodes ?? [])
        .catch(() => [])
    )
  )
  const byId = new Map<string, AppleEpisode>()
  for (const episode of perSeason.flat()) {
    if (seasonNumber != null && episode.seasonNumber !== seasonNumber) continue
    if (!byId.has(episode.id)) byId.set(episode.id, episode)
  }
  // `data.seasons` is a record keyed by season id, so Object.values is in whatever order the payload
  // happens to carry (Silo comes back 2, 1, 3), which the flatten used to publish as episode order
  return [...byId.values()]
    .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
    .map(episode => normalizeEpisode(episode, mediaUri))
}

/**
 * The show or movie behind an id.
 *
 * `/shows/<id>` answers `404 {"code":404,"title":"NotFound","message":"show not found"}` for a movie,
 * with no `data`, so every Apple TV movie resolved to nothing before this fallback existed: a movie
 * came back from search, and opening it produced an empty media. The second request is only ever
 * spent on an id `/shows` has already declined.
 */
const fetchContent = async (id: string, ctx: ExtractorServerContext): Promise<AppleContentData | undefined> => {
  const show = await api<AppleContentResponse>(`/shows/${id}`, ctx)
  if (show.data?.content) return show.data
  const movie = await api<AppleContentResponse>(`/movies/${id}`, ctx)
  return movie.data?.content ? movie.data : undefined
}

/**
 * A show's seasons as `pickSimilarSeason` reads them: a number and a premiere, and NOTHING else on
 * purpose. 27.280% of the episodes Apple answers for a season belong to another season (see
 * `fetchEpisodes`), so a count or a title list off that endpoint is not evidence, and a candidate
 * carrying none can only be picked by a day inside the window: a year needs a count on the season to
 * show it is not a fold, so here it only ever vetoes.
 */
const seasonCandidates = (data: AppleContentData): SeasonCandidate<AppleSeason>[] =>
  Object.values(data.seasons ?? {})
    .filter(season => season.seasonNumber != null)
    .map(season => ({ season, seasonNumber: season.seasonNumber, premiere: season.releaseDate }))

/**
 * Which season this uri names, or nothing.
 *
 * A pinned season is honoured as before. Otherwise the aggregated media is asked for what it knows
 * about its run and the shared picker decides; there is no lone-season shortcut, since one season
 * listed is not one season aired. The probe stays SYNCHRONOUS: waitForMedia keeps the first result
 * it finds truthy, and a promise is always truthy.
 */
const pickSeason = async (
  uri: string,
  candidates: SeasonCandidate<AppleSeason>[],
  pinned: number | undefined,
  ctx: ExtractorServerContext
): Promise<AppleSeason | undefined> => {
  if (pinned != null) return candidates.find(({ season }) => season.seasonNumber === pinned)?.season
  if (!candidates.length) return undefined
  return waitForMedia(uri, ctx, (media: any) => pickSimilarSeason({
    titles: (media?.titles ?? []).map((title: { title: string }) => title.title),
    startDate: media?.startDate,
    episodeCount: declaredEpisodeCount(media),
  }, candidates)?.season)
}

/**
 * The media for a show or a film. A film is one run under its bare id. A show with a season named is
 * that season's run; with none it is the SHOW, scoped CONTAINER with no episodes, the same shape
 * tvmaze and unogs answer, so a link to it survives as a container edge rather than vanishing.
 */
const buildMedia = async (
  data: AppleContentData,
  season: AppleSeason | undefined,
  ctx: ExtractorServerContext
): Promise<GQLMedia | undefined> => {
  const content = data.content
  if (!content) return undefined
  if (content.type === 'Movie') {
    const media = normalizeMedia(content)
    media.episodes = [makeMovieEpisode(media)]
    media.episodeCount = 1
    return media
  }
  if (season?.seasonNumber == null) return normalizeMedia(content)
  const media = normalizeMedia(content, season)
  media.episodes = await fetchEpisodes(content.id, data.seasons, media.uri, ctx, season.seasonNumber)
  media.episodeCount = media.episodes.length
  return media
}

/**
 * The one season of `showId` the caller's evidence establishes, as a run, or nothing. Apple offers
 * only dates (see `seasonCandidates`), so a caller with a year-only date, or with titles and a count
 * alone, is refused here however good its evidence would be elsewhere: only a day places a run.
 */
const seasonForShow = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const data = await fetchContent(input.showId, ctx)
  if (!data?.content || data.content.type === 'Movie') return undefined
  const verdict = pickSimilarSeason(input, seasonCandidates(data))
  return verdict ? buildMedia(data, verdict.season, ctx) : undefined
}

const getMedia = async (
  uri: string,
  id: string,
  pinned: number | undefined,
  ctx: ExtractorServerContext
): Promise<GQLMedia | undefined> => {
  const data = await fetchContent(id, ctx)
  if (!data?.content) return undefined
  // a movie carries no seasons, so this answers nothing for one and buildMedia keeps its bare id
  const season = await pickSeason(uri, seasonCandidates(data), pinned, ctx)
  return buildMedia(data, season, ctx)
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<AppleItem[]> => {
  const res = await api<AppleSearchResponse>(`/search?searchTerm=${encodeURIComponent(query)}`, ctx)
  const items = (res.data?.canvas?.shelves ?? [])
    .flatMap(shelf => shelf.items ?? [])
    .filter(item => item.type === 'Show' || item.type === 'Movie')
  // the shelves repeat the same entry: 22 items for 11 distinct shows on `searchTerm=Severance`. Left
  // in, the duplicates fill MAX_CATALOGUE_CANDIDATES with copies of one show and the runners-up the cap
  // exists to date-check are never reached
  const byId = new Map<string, AppleItem>()
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item)
  return [...byId.values()]
}

/**
 * How many results of one search are read in full, about the first screenful of cards. A common word
 * keeps almost every result ("the" keeps 54 of 56), and the relay meters a viewer at a burst of 40
 * requests, cached or not, shared with every other source the search asks.
 */
const SEARCH_READS = 12

/**
 * How long a search holds before its results are read, so the prefixes of a title being typed read
 * nothing. The page searches each prefix that holds 350 ms, and a pause at a space holds "the" about
 * 1.5 s. Measured 2026-10-17 typing "the morning show" on stub.fkn.app and series.fkn.app at 120 to
 * 700 ms a key: with one second a run sent up to 15 reads, with two seconds none of 123 runs sent one.
 */
const READ_AFTER_MS = 2_000

/**
 * The first results the page keeps, by the site and by its relevance cut, in Apple's order, whose card
 * no other source has given a poster. A search item carries only landscape art, so these are read in
 * full for their tall poster. Without the reads, measured 2026-10-16: over 52 searches for a specific
 * title 3 of 54 Apple TV cards had no poster, all three cards no other source joined, but for "the" 25
 * of 25 had none on series.fkn.app and 27 of 28 on movies.fkn.app.
 */
const drawnFirst = async (search: string, results: AppleItem[], ctx: ExtractorServerContext): Promise<AppleItem[]> => {
  const drawn = await Promise.all(results.map(async item =>
    siteAllows(normalizeMedia(item).categories ?? []) && await searchRelevance(search, [item.title]) >= SEARCH_RELEVANCE_THRESHOLD
  ))
  const first = results.filter((_, index) => drawn[index]).slice(0, SEARCH_READS)
  const blank = await Promise.all(first.map(async item => !(await ctx.findAggregatedMedia(normalizeMedia(item).uri))?.covers?.length))
  return first.filter((_, index) => blank[index])
}

const contents = new Map<string, AppleItem>()

/**
 * A result's own answer, read once a session, since the prefixes of a title keep the same results. The
 * read stops with the search that asked for it, and one that failed or stopped is asked again.
 */
const ownContent = async (item: AppleItem, ctx: ExtractorServerContext): Promise<AppleItem | undefined> => {
  const path = `/${item.type === 'Movie' ? 'movies' : 'shows'}/${item.id}`
  const content = contents.get(path)
    ?? await api<AppleContentResponse>(path, ctx, { signal: ctx.request.signal }).then(res => res.data?.content, () => undefined)
  if (content) contents.set(path, content)
  return content
}

/**
 * The seasons the gate's date axis reads for one candidate, one detail request each.
 *
 * A MOVIE is the entry with no seasons to read, and it is also the one with no show-vs-season gap to
 * fall into, so its own `releaseDate` stands in as its single season. It carries no `seasonNumber`,
 * which is exactly what makes `buildMedia` keep the bare id for it.
 */
const gateSeasons = (data: AppleContentData | undefined): AppleSeason[] => {
  if (!data?.content) return []
  if (data.content.type === 'Movie') return [{ id: data.content.id, releaseDate: data.content.releaseDate }]
  return Object.values(data.seasons ?? {})
}

/**
 * Linking a search hit asserts identity PERMANENTLY, so what this used to do is worth naming: it took
 * the FIRST result whose raw title cleared a bare 0.5 against our first title, which is three separate
 * mistakes. A weak early hit beat a strong later one; the season in our title was charged against a
 * catalogue that names the show once; and no date was consulted at all, so the 4.002% of wrong pairs
 * that are EXACTLY equal after season stripping had nothing to refuse them.
 *
 * The gate, the thresholds and what each axis measured are in ../catalogue-gate.ts.
 *
 * REQUEST COST, worst case, per media: 4 searches (down from 5, since the query list is now capped)
 * and at most 3 detail requests each, so at most 12 detail requests plus one episode request for the
 * winner. The old path had no such ceiling: it spent a detail request AND an episode request per season
 * on every result whose raw title cleared 0.5, and only stopped when one of them produced a media, so a
 * rung returning ten near-miss results paid for all ten.
 *
 * In practice this is far below its own ceiling: the title axis runs entirely on the search payload, so
 * a refused candidate costs nothing, an id is fetched at most once per call (the `details` map, which
 * `searchApi`'s dedupe does not replace, since two rungs return overlapping result sets), and the loop
 * returns on the first query that produces a link.
 */
const searchAndLinkMedia = async (aggregatedUri: string, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  const known = await waitForMedia(
    aggregatedUri,
    ctx,
    // BOTH, not just a title. This asked for a title alone and then refused two lines later when
    // startDate had not landed, so whenever the title arrived on an earlier tick than the date the
    // source gave up permanently and never linked. The gate needs the date, so the wait is what has
    // to be told that.
    media => (getFirstTitle(media) && media?.startDate ? media : undefined),
    30_000
  )
  if (!known) return null

  // anything missing is a refusal, never a guess
  const startDate: string | undefined = known.startDate ?? undefined
  if (!startDate) return null

  const knownTitles: string[] = (known.titles ?? []).map((title: { title: string }) => title.title).filter(Boolean)
  const primary = knownTitles[0]
  if (!primary) return null

  const details = new Map<string, Promise<AppleContentData | undefined>>()
  const detailsOf = (id: string) => {
    const cached = details.get(id)
    if (cached) return cached
    const request = fetchContent(id, ctx).catch(() => undefined)
    details.set(id, request)
    return request
  }

  for (const query of searchQueries(primary)) {
    const results = await searchApi(query, ctx)
    if (!results.length) continue

    const match = await pickGatedCandidate(
      { titles: knownTitles, startDate },
      results,
      item => item.title,
      async item => gateSeasons(await detailsOf(item.id)),
      season => season.releaseDate
    )
    if (!match) continue

    const data = await detailsOf(match.candidate.id)
    if (!data) continue
    const media = await buildMedia(data, match.season, ctx)
    if (!media) continue
    media.handles = buildHandlesFromUri(aggregatedUri, origin)
    return media
  }
  return null
}

const resolveMedia = async (uri: string, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  const atvUri = extractAggregatedUriOrigin(uri, origin)
  if (atvUri) {
    // the uri may already pin the season, since that is now part of the id
    const { showId, seasonNumber } = splitSeasonScopedId(atvUri.id)
    const media = await getMedia(uri, showId, seasonNumber, ctx)
    if (!media) return null
    if (isAggregatedUri(uri)) media.handles = buildHandlesFromUri(uri, origin)
    return media
  }
  if (!isAggregatedUri(uri)) return null
  // no `appletv:` in the uri, so no source ever supplied one. Search, under the gate above.
  return searchAndLinkMedia(uri, ctx)
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
        yield { media: await resolveMedia(uri, ctx) }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        const results = await searchApi(search, ctx)
        yield { mediaPage: { nodes: results.map(item => normalizeMedia(item)) } }
        await new Promise(resolve => setTimeout(resolve, READ_AFTER_MS))
        if (ctx.request.signal.aborted) return
        const read = await Promise.all((await drawnFirst(search, results, ctx)).map(item => ownContent(item, ctx)))
        const nodes = read.filter(content => content !== undefined).map(content => normalizeMedia(content))
        if (nodes.length) yield { mediaPage: { nodes } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      if (isMovie(parent)) return [makeMovieEpisode(parent)]
      // parent.id is '<show>-s<season>' now, so the show has to be split back out of it
      const { showId, seasonNumber } = splitSeasonScopedId(parent.id)
      const data = await fetchContent(showId, ctx)
      return fetchEpisodes(showId, data?.seasons, parent.uri, ctx, seasonNumber)
    }
  }
}
