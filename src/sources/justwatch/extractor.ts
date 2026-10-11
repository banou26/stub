import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode , MediaHandle as GQLMediaHandle, MediaRating, SimilarMediaInput } from '../../generated/schema/types.generated'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri, toUri } from '../../utils/uri'
import { resolveEpisodeToSeriesId, crunchyrollId } from '../crunchyroll/extractor'
import { PACKAGE_ORIGIN_MAP, extractContentId, jwId, providerContentId, showRequiresSeason, splitJwId } from './id'
import { policyFor, UNKNOWN_POLICY, type RequestPolicy } from '../../worker/request-context'
import { isOnlySeasonLabel, parseSeasonNumber } from '../season'
import { hasEvidence, pickSimilarSeason, type SeasonCandidate } from '../similar'
import { rankByTitle, searchQueries, yearAppearsInShow } from '../catalogue-gate'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img, getFirstTitle, mergeHandles, waitForMedia, partOf, sameAs, declaredEpisodeCount } from '../utils'

const SCORE = 0.2
// below every other source's banner (the lowest is 0.2), so a backdrop only fills a gap
const BACKDROP_SCORE = 0.1

export const icon = 'https://www.justwatch.com/appasset/img/favicon/favicon-32x32.png'
export const originUrl = 'https://www.justwatch.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'JustWatch'
export const origin = 'jw'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['jw']

const JW_API = 'https://apis.justwatch.com/graphql'
const JW_IMAGE_BASE = 'https://images.justwatch.com'
const COUNTRY = 'US'
const LANGUAGE = 'en'

// A JustWatch offer is scoped to ONE country, so a single country is a single catalogue. Anime is
// licensed per region and the Japanese catalogue is the one that carries it: measured 2026-09-09,
// The Elusive Samurai is `cra itu cru amz` in US and `nfx amp dnp nfa aam dan pva amz hlu fuj` in JP,
// and Mushoku Tensei has no US Netflix offer at all while JP names `nf:80987039`. Asking US alone is
// therefore blind to Netflix for most of this catalogue.
//
// Offers from both countries are concatenated and `buildOffersAsHandles` dedupes by package
// shortName, so US wins for any service in both and JP only ever adds. A JP-only service mints
// nothing: `extractContentId` switches on the deep link's HOST and returns undefined for one it does
// not know, so happyon.jp or abema.tv contribute no handle. Netflix is safe to take from either
// because its host and title id are the same worldwide.
const OFFER_COUNTRIES = { primary: COUNTRY, extra: 'JP' } as const

const extractRealUrl = (affiliateUrl: string): string | undefined => {
  try {
    const url = new URL(affiliateUrl)
    return url.searchParams.get('u') ?? url.searchParams.get('r') ?? undefined
  } catch {}
  return undefined
}

const extractCrunchyrollEpisodeId = (url: string): string | undefined => {
  try {
    const { hostname, pathname } = new URL(url)
    if (hostname.replace('www.', '') !== 'crunchyroll.com') return undefined
    const parts = pathname.split('/').filter(Boolean)
    return parts[0] === 'watch' ? parts[1] : undefined
  } catch {}
  return undefined
}

const jwFetch = async <T>(query: string, variables: Record<string, unknown>, ctx: ExtractorServerContext): Promise<T> => {
  const res = await ctx.fetch(JW_API, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: '*/*'
    },
    body: JSON.stringify({ query, variables })
  })
  return res.json() as T
}

const SEARCH_QUERY = `
  query GetSearchTitles($searchTitlesFilter: TitleFilter!, $country: Country!, $extraCountry: Country!, $language: Language!, $first: Int!) {
    popularTitles(country: $country, filter: $searchTitlesFilter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
      edges {
        node {
          id
          objectId
          objectType
          content(country: $country, language: $language) {
            title
            fullPath
            originalReleaseYear
            originalReleaseDate
            shortDescription
            posterUrl(profile: S718, format: JPG)
            externalIds {
              imdbId
            }
            genres {
              shortName
            }
          }
          offers(country: $country, platform: WEB, filter: { bestOnly: true }) {
            monetizationType
            presentationType
            standardWebURL
            package {
              id
              packageId
              clearName
              technicalName
              shortName
              icon(profile: S100)
            }
          }
          extraOffers: offers(country: $extraCountry, platform: WEB, filter: { bestOnly: true }) {
            monetizationType
            presentationType
            standardWebURL
            package {
              id
              packageId
              clearName
              technicalName
              shortName
              icon(profile: S100)
            }
          }
          ... on Show {
            seasons(sortDirection: ASC) {
              objectId
              totalEpisodeCount
              content(country: $country, language: $language) {
                seasonNumber
                isReleased
              }
            }
          }
        }
      }
    }
  }
`

const nodeQuery = (details: string) => `
  query GetTitleNode($nodeId: ID!, $language: Language!, $country: Country!, $extraCountry: Country!) {
    node(id: $nodeId) {
      ... on MovieOrShow {
        id
        objectId
        objectType
        content(country: $country, language: $language) {
          title
          fullPath
          originalReleaseYear
          originalReleaseDate
          shortDescription
          posterUrl(profile: S718, format: JPG)
          externalIds {
            imdbId
          }
          genres {
            shortName
          }${details}
        }
        offers(country: $country, platform: WEB, filter: { bestOnly: true }) {
          monetizationType
          presentationType
          standardWebURL
          package {
            id
            packageId
            clearName
            technicalName
            shortName
            icon(profile: S100)
          }
        }
        extraOffers: offers(country: $extraCountry, platform: WEB, filter: { bestOnly: true }) {
          monetizationType
          presentationType
          standardWebURL
          package {
            id
            packageId
            clearName
            technicalName
            shortName
            icon(profile: S100)
          }
        }
        ... on Show {
          totalSeasonCount
          seasons(sortDirection: ASC) {
            id
            objectId
            totalEpisodeCount
            content(country: $country, language: $language) {
              title
              seasonNumber
              fullPath
              posterUrl
              originalReleaseYear
              originalReleaseDate
              isReleased
            }
            episodes(limit: 50) {
              id
              objectId
              content(country: $country, language: $language) {
                title
                episodeNumber
                seasonNumber
                isReleased
                shortDescription
                originalReleaseDate
                runtime
              }
              flatrate: offers(
                country: $country, platform: WEB,
                filter: { monetizationTypes: [FLATRATE_AND_BUY, FLATRATE, ADS, FREE], bestOnly: true }
              ) {
                package {
                  clearName
                  packageId
                  shortName
                }
              }
            }
          }
        }
      }
    }
  }
`

// The relay caches on the whole body, so the modal's stays byte for byte what it was and only the
// title page's `details` asks for more
const NODE_QUERY = nodeQuery('')
const NODE_DETAILS_QUERY = nodeQuery(`
          runtime
          backdrops(profile: S1920, format: JPG) {
            backdropUrl
          }
          scoring {
            imdbScore
            tmdbScore
            tomatoMeter
            jwRating
          }`)

const _inflight = new Map<string, Promise<unknown>>()

const deduplicatedFetch = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const existing = _inflight.get(key)
  if (existing) return existing as Promise<T>
  const promise = fn()
  _inflight.set(key, promise)
  promise.finally(() => _inflight.delete(key))
  return promise
}

const searchTitles = (query: string, ctx: ExtractorServerContext) =>
  deduplicatedFetch(`search:${query}`, () =>
    jwFetch<JWSearchResponse>(SEARCH_QUERY, {
      first: 10, searchTitlesFilter: { searchQuery: query }, language: LANGUAGE,
      country: OFFER_COUNTRIES.primary, extraCountry: OFFER_COUNTRIES.extra
    }, ctx)
  )

const getNodeDetails = (nodeId: string, ctx: ExtractorServerContext, details?: boolean | null) =>
  deduplicatedFetch(`node:${nodeId}:${Boolean(details)}`, () =>
    jwFetch<JWNodeResponse>(details ? NODE_DETAILS_QUERY : NODE_QUERY, {
      nodeId, language: LANGUAGE, country: OFFER_COUNTRIES.primary, extraCountry: OFFER_COUNTRIES.extra
    }, ctx)
  )

interface JWOffer {
  monetizationType: string
  standardWebURL: string | null
  package: { clearName: string, shortName: string }
}

interface JWSearchNode {
  id: string
  objectId: number
  objectType?: string
  content: {
    title: string
    fullPath: string
    posterUrl: string | null
    shortDescription: string | null
    originalReleaseYear?: number | null
    /** the day this WORK premiered, which on a Show is its first season's day; see `dayOrYear` */
    originalReleaseDate?: string | null
    /** these three only on NODE_DETAILS_QUERY's answer */
    runtime?: number | null
    backdrops?: { backdropUrl: string }[] | null
    scoring?: { imdbScore: number | null, tmdbScore: number | null, tomatoMeter: number | null, jwRating: number | null } | null
  }
  offers: JWOffer[]
  /** the same offers read on the second licensing region; see OFFER_COUNTRIES */
  extraOffers?: JWOffer[]
  /** present on a Show; the search query asks for it so a result can be expanded per season */
  seasons?: JWSeason[]
}

interface JWSeason {
  /** JustWatch's own id for the season, which is what a media uri is scoped by */
  objectId: number
  totalEpisodeCount: number
  content: {
    /** JustWatch's own title for the season, which NODE_QUERY asks for; often the bare label "Season 3" */
    title?: string | null
    seasonNumber: number
    isReleased: boolean
    /**
     * The year THIS season premiered, which is the only date JustWatch exposes at season level and the
     * one the search gate's date axis reads. NODE_QUERY has always asked for it; the field was simply
     * dropped on the way into this type, so the gate had nothing but the show-level
     * `content.originalReleaseYear` to compare against and could not tell season 1 from season 4.
     *
     * Optional because SEARCH_QUERY's seasons block asks only for seasonNumber and isReleased, so a
     * season that came off a search payload genuinely does not carry it.
     */
    originalReleaseYear?: number | null
    /**
     * The DAY this season premiered, `YYYY-MM-DD`, which NODE_QUERY now asks for beside the year.
     *
     * Measured 2026-09-12 over the 24 season-scoped JustWatch rows of the recorded season: 22 carry
     * one. It is the season's own day and never the show's, which is why the two that do not fall
     * back to the year rather than to `node.content.originalReleaseDate` (Mushoku's season row is
     * 2026-07-04 while its show row is 2021-01-11).
     *
     * Optional for the same reason the year is: SEARCH_QUERY's seasons block does not ask for it.
     */
    originalReleaseDate?: string | null
  }
  episodes: JWEpisode[]
}

interface JWEpisode {
  objectId: number
  content: {
    title: string
    episodeNumber: number
    seasonNumber: number
    isReleased: boolean
    shortDescription: string | null
    /** the day this episode aired, `YYYY-MM-DD`; 155 of 180 episodes carried one (2026-09-12) */
    originalReleaseDate?: string | null
    runtime: number | null
  }
}

interface JWShowNode extends JWSearchNode { seasons: JWSeason[] }
interface JWSearchResponse { data: { popularTitles: { edges: { node: JWSearchNode }[] } } }
interface JWNodeResponse { data: { node: JWShowNode } }

const resolveImageUrl = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${JW_IMAGE_BASE}${url}`) : undefined

const ratingsOf = (scoring: JWSearchNode['content']['scoring']): MediaRating[] =>
  [
    { source: 'IMDb', value: scoring?.imdbScore, scale: 10 },
    { source: 'TMDB', value: scoring?.tmdbScore, scale: 10 },
    { source: 'Rotten Tomatoes', value: scoring?.tomatoMeter, scale: 100 },
    { source: 'JustWatch', value: scoring?.jwRating == null ? null : Math.round(scoring.jwRating * 100), scale: 100 },
  ].filter((rating): rating is MediaRating => rating.value != null)

/**
 * A start date at the best precision this node has for THIS media: the day when JustWatch names one,
 * else the year as `YYYY-01-01`, else nothing.
 *
 * `${year}-01-01` is honest year precision and is also the exact spelling the store reads as no day
 * at all: a parsed date whose UTC day-of-month is 1 is `month-or-year`, so `startDay` is dropped and
 * only the year survives to bucket on (5.4 P0). Every JustWatch row was that shape until 2026-09-12,
 * because nothing asked for the day, so this source could never clear the 45 day window and its date
 * gate was permanently silent. The day is asked for now and 22 of 24 recorded seasons carry one.
 *
 * The year fallback stays YEAR PRECISION AWAITING `startDatePrecision` (4.6, and 11.3 decision 4):
 * until this source declares the field, a caller cannot tell our January 1 from a real New Year
 * premiere, and the store's first-of-month reading is what keeps that safe.
 *
 * The day and the year must come from THE SAME SUBJECT. Pass a season's day beside a season's year,
 * never a show's day beside a season's year: the show's day is its FIRST season's premiere, which is
 * the show-vs-season confusion the uri scoping in ./id.ts exists to prevent, in the date field.
 */
const dayOrYear = (day: string | null | undefined, year: number | null | undefined): string | undefined =>
  day ?? (year ? `${year}-01-01` : undefined)

/**
 * JustWatch's seasons as the shared picker reads them: a count, a year and the episode titles the node
 * carries. The YEAR and not the day, deliberately: `season.content.originalReleaseDate` is fetched now
 * and 22 of 24 recorded seasons carry one, but `premiere` would move this source off the year rule and
 * onto the picker's 45 day window, and the year rule plus the year veto are the axis
 * ../catalogue-gate.ts calibrated for it. That swap is a measurement, not an edit. A `totalEpisodeCount`
 * of 0 is a season JustWatch has not listed yet, offered as no count rather than as a season shorter
 * than every run.
 */
const jwCandidates = (seasons: JWSeason[]): SeasonCandidate<JWSeason>[] =>
  seasons.map(season => ({
    season,
    seasonNumber: season.content.seasonNumber,
    episodeCount: season.totalEpisodeCount || undefined,
    year: season.content.originalReleaseYear,
    episodeTitles: (season.episodes ?? []).map(episode => episode.content.title)
  }))

// `meta` is what the offer loop DECIDES on, and nothing else. A title, a description and a poster
// used to ride along here for offer handles that never read one, which is the same stale intent as
// the media's missing titles: a handle this mints is a BARE node in another source's id space, and
// writing our reading onto a row we never saw is what `buildHandlesFromUri` refuses too.
const buildOffersAsHandles = async (
  offers: JWOffer[],
  meta: { seasonNumber?: number, showContainer?: boolean },
  ctx: ExtractorServerContext,
  policy: RequestPolicy = UNKNOWN_POLICY
): Promise<GQLMediaHandle[]> => {
  const seen = new Set<string>()
  const handles: GQLMediaHandle[] = []

  for (const offer of offers) {
    if (!['FLATRATE', 'FLATRATE_AND_BUY', 'FREE', 'ADS'].includes(offer.monetizationType)) continue
    const shortName = offer.package.shortName

    const mappedOrigin = PACKAGE_ORIGIN_MAP[shortName]
    if (!mappedOrigin) continue

    // Keyed on the ORIGIN, not the package, because a package is a TIER and one service sells
    // several: Netflix lists `nfx` beside `nfa`, Paramount+ splits into `ppp` and `ppe`. Within a
    // single region every tier of a service links to the same url, so keying on the package only ever
    // dropped a duplicate of the same uri. Across regions it does not: the primary region's `nfx` and
    // the second's `nfa` are two different deep links carrying two different title ids, and minting
    // both would hang two Netflix titles on one media. `graph.link` is a union with no inverse, so
    // that weld would last the session.
    if (seen.has(mappedOrigin)) continue
    seen.add(mappedOrigin)

    const realUrl = offer.standardWebURL ? extractRealUrl(offer.standardWebURL) : undefined
    const url = realUrl ?? offer.standardWebURL ?? undefined

    let contentId: string | undefined
    // SAME_AS only for an id that names exactly this media: a film's own id, or the season a film's
    // Crunchyroll episode resolves to. Everything read off a SHOW is PART_OF.
    let relation: 'SAME_AS' | 'PART_OF' = 'SAME_AS'
    const rawContentId = url ? extractContentId(url) : undefined

    // A Crunchyroll offer is a /watch/<episodeId> url, so the id has to come back through Crunchyroll
    // itself. That answers with the season THAT episode is in, which is one specific season of the
    // show, and JustWatch has no season-level node: this offer belongs to the SHOW and every season
    // media built from the node is handed the same one. So a pinned season would take an id nothing
    // established was its own, and two runs of one show would take the SAME id and weld.
    //
    // A movie is the case that stays, and it is the only one: `showRequiresSeason` has already refused
    // a series with no season by the time this runs, so a null seasonNumber here means a film, whose
    // episode resolves to its own season and identifies it.
    // THE ONE CROSS-SOURCE CALL ON THIS PATH, and the reason the request context exists. Turning a
    // /watch/<episodeId> url into a series id costs a Crunchyroll token plus a CMS request, PER FILM
    // RESULT, and `mediaPage` runs this for every hit in a search. Nothing on a results page reads
    // that id: it identifies the run, which is a detail-view question. So on a listing the offer keeps
    // its url and loses only the identity claim, and the detail view spends the request as before.
    // `meta.showContainer` excludes this branch deliberately. It resolves a /watch/ url to the SEASON
    // that episode is in, which is a RUN, and the media being built here is the SHOW: claiming the two
    // are the same is a cross-scope weld, and `graph.link` has no inverse. The offer is dropped rather
    // than demoted because crunchyroll already reaches this cluster under its own series container.
    if (!rawContentId && mappedOrigin === 'cr' && url && meta.seasonNumber == null && !meta.showContainer && policy.crossSource) {
      const episodeId = extractCrunchyrollEpisodeId(url)
      if (episodeId) {
        const resolved = await resolveEpisodeToSeriesId(episodeId, ctx)
        if (resolved) contentId = crunchyrollId(resolved.seriesId, resolved.seasonId)
      }
    } else if (rawContentId) {
      contentId = providerContentId(mappedOrigin, rawContentId)
      if (contentId) {
        // A show-level offer is the provider's TITLE, and this run is one part of it. The season suffix
        // that used to scope it (`nf:80123-2`) wrote JustWatch's numbering into a space where unogs and
        // the appletv source write the provider's own, and the two collide (see ./id.ts). The precise
        // run is `similarMedia`'s to name, asked of the provider's source on the run's page.
        if (meta.seasonNumber != null) relation = 'PART_OF'
      } else if (mappedOrigin === 'cr') {
        // `providerContentId` refuses crunchyroll outright, because `extractContentId` reads a cr id
        // from /series/ urls and nothing else. That refusal was a DROP; it is a demotion, which keeps
        // the link on the page without claiming this run is the whole series.
        contentId = rawContentId
        relation = 'PART_OF'
      }
    }

    if (!contentId) continue

    // `partOf` is also the CONTAINER stamp, which is what keeps a show-level id out of every run's
    // identity space. A film's own id, or the season its episode resolved to, stays a RUN.
    const node = makeMedia({ origin: mappedOrigin, id: contentId, url })
    handles.push(relation === 'PART_OF' ? partOf(node) : sameAs(node))
  }

  return handles
}

/**
 * The SHOW itself, as a CONTAINER, for a series whose season could not be established.
 *
 * JustWatch FOLDS anime cours exactly as Netflix does, so a run that is one cour matches none of its
 * seasons and `normalizeMedia` refuses the whole node. Measured 2026-09-10 on Mushoku Tensei: JustWatch
 * publishes seasons of 23, 24 and 14 against our cours of 11/12/12/12/14, the title and date gates both
 * pass, and `pickSimilarSeason` then returns undefined. Only the cour whose length happens to equal a
 * JustWatch season (season 3, 14 against 14) survived, which is why Netflix appeared on the last season
 * of the show and on none of the others.
 *
 * Refusing the SEASON is still right: the bare node id is shared by every season and asserting it as a
 * run's identity is what welded Mushoku's seasons together before. What was wrong is throwing the whole
 * node away with it, because the OFFERS hang off the show rather than off any season, and they are what
 * carries `nf:<title id>`. So the show comes back as a container instead.
 *
 * NOTHING HERE CLAIMS TO BE THE RUN. The caller must not `mergeHandles` this media: that mints a
 * `sameAs` for every origin in the asking uri, which is precisely the weld above. The container reaches
 * the run through the container space instead, where `fuzzy-merge` unions it with the crunchyroll and
 * tvmaze containers the cluster already hangs under, and `findPartOfMedia` expands a PART_OF target to
 * its whole SAME_AS component. A provider id read off a show is a container too, so `sameAs` between
 * this node and `nf:<id>` is a claim about two SHOWS and unions in the container space.
 */
export const showAsContainer = async (
  node: JWSearchNode,
  ctx: ExtractorServerContext,
  policy: RequestPolicy = UNKNOWN_POLICY
): Promise<GQLMedia | null> => {
  const handles = await buildOffersAsHandles(
    [...node.offers ?? [], ...node.extraOffers ?? []],
    { showContainer: true },
    ctx,
    policy
  )
  // a container carrying no provider id is noise: it names a show the cluster already reaches through
  // its other containers and adds nothing a reader could act on
  if (!handles.length) return null

  return makeMedia({
    origin,
    id: String(node.objectId),
    url: `https://www.justwatch.com${node.content.fullPath}`,
    scope: 'CONTAINER',
    categories: [node.objectType === 'MOVIE' ? 'MOVIE' : 'SERIES'],
    score: SCORE,
    handles,
    titles: [{ language: 'en', title: node.content.title, score: SCORE }],
    ...desc(node.content.shortDescription ?? undefined, SCORE),
    covers: img(resolveImageUrl(node.content.posterUrl), SCORE),
    // the SHOW's own day, which is the right subject here and only here: this media IS the show
    startDate: dayOrYear(node.content.originalReleaseDate, node.content.originalReleaseYear)
  })
}

const normalizeMedia = async (
  node: JWSearchNode,
  opts: { seasons?: JWSeason[], seasonNumber?: number },
  ctx: ExtractorServerContext,
  policy: RequestPolicy = UNKNOWN_POLICY
): Promise<GQLMedia | null> => {
  // refusing to build the media is the point: the bare node id is shared by every season of the show and merges them
  if (opts.seasonNumber == null && showRequiresSeason(node.objectType)) return null
  // the uri is scoped by the season's OWN id; the number is what the episode lists are keyed on
  const season = (opts.seasons ?? []).find(entry => entry.content.seasonNumber === opts.seasonNumber)
  if (opts.seasonNumber != null && season?.objectId == null) return null
  const id = opts.seasonNumber == null ? String(node.objectId) : jwId(node.objectId, season!.objectId)
  const { shortDescription } = node.content
  const seasonYear = season?.content?.originalReleaseYear ?? node.content.originalReleaseYear
  // the SEASON's day when a season is pinned, and no fallback to the show's: the show's day is its
  // first season's premiere, so a later season taking it would publish another run's date as its own
  const seasonDay = season ? season.content.originalReleaseDate : node.content.originalReleaseDate

  // the season's own title when JustWatch gives it one naming more than a position, else the show's.
  // "<show> Season <n>" used to be synthesized here, and its ordinal is the number this source no
  // longer trusts as an identity
  const title = season?.content.title && !isOnlySeasonLabel(season.content.title) ? season.content.title : node.content.title

  const filteredSeasons = opts.seasonNumber != null
    ? (opts.seasons ?? []).filter(s => s.content.seasonNumber === opts.seasonNumber)
    : opts.seasons ?? []

  const episodes: GQLEpisode[] = filteredSeasons.flatMap(season =>
    (season.episodes ?? [])
      .filter(ep => ep.content.isReleased)
      .map(ep => normalizeEpisode(ep, toUri({ origin, id })))
  )

  const handles = await buildOffersAsHandles(
    [...node.offers ?? [], ...node.extraOffers ?? []],
    { seasonNumber: opts.seasonNumber },
    ctx,
    policy
  )
  // The show node itself, as the CONTAINER every season of it is part of. The worker asks
  // `similarMedia` of container origins only, so this is what makes JustWatch askable, and it lets
  // the container space union `jw:<objectId>` with `cr:<series>` and `tvmaze:<show>` on a title, so a
  // run PART_OF any one of them reaches JustWatch's offers. The same shape tvmaze, tmdb and
  // crunchyroll already mint for a show.
  if (opts.seasonNumber != null) {
    handles.push(partOf(makeMedia({
      origin,
      id: String(node.objectId),
      url: `https://www.justwatch.com${node.content.fullPath}`,
      categories: [node.objectType === 'MOVIE' ? 'MOVIE' : 'SERIES'],
      titles: [{ language: 'en', title: node.content.title, score: SCORE }],
      startDate: dayOrYear(node.content.originalReleaseDate, node.content.originalReleaseYear)
    })))
  }

  const media = makeMedia({
    origin,
    id,
    // the type is what tells the graph's guards this is a film, which a category alone does not
    type: node.objectType === 'MOVIE' ? 'MOVIE' : undefined,
    categories: [node.objectType === 'MOVIE' ? 'MOVIE' : 'SERIES'],
    url: `https://www.justwatch.com${node.content.fullPath}`,
    score: SCORE,
    handles,
    episodes,
    // THE TITLE THIS MEDIA IS FOUND BY, and until 2026-09-12 it was computed above and then dropped.
    // A row with no title cannot be matched by `plugin:title`, and since an address handle asserts
    // nothing (3.3, the `provenance: 'address'` refusal), the echo of the asked uri is no longer a
    // route into a cluster either, so a titleless row can never join one: 132 of the 138 recorded
    // JustWatch rows carried none, and with them go the offers, which are the whole value of this
    // source. The show's own title lives on the show CONTAINER handle below as well, because it is
    // true of that node too and that is the node `similarMedia` is asked of.
    titles: title ? [{ language: 'en', title, score: SCORE }] : [],
    // the search query carries totalEpisodeCount but not the episodes themselves, so an expanded
    // season still reports how long it is - which is also what season matching elsewhere keys on
    episodeCount: episodes.length || filteredSeasons.reduce((total, season) => total + (season.totalEpisodeCount ?? 0), 0) || undefined,
    // the SEASON's own date, and its own year when it names no day. Only the YEAR falls back to the
    // show's: a season media publishing the show's DATE publishes the franchise's FIRST season's as
    // its own start date, which every date comparison downstream then reads as this season's - the
    // same show-vs-season confusion the uri scoping in ./id.ts exists to prevent, in the date field.
    startDate: dayOrYear(seasonDay, seasonYear),
    // a show's runtime is an episode's, which the episodes already carry
    duration: node.objectType === 'MOVIE' ? node.content.runtime ?? undefined : undefined,
    banners: (node.content.backdrops ?? []).flatMap(({ backdropUrl }) => img(resolveImageUrl(backdropUrl), BACKDROP_SCORE)),
    ratings: ratingsOf(node.content.scoring),
  })

  // A film's episode is the film, so it takes the media's own title and description: `makeMovieEpisode`
  // copies `media.titles`, which is now where the title is.
  if (isMovie(media)) {
    media.episodes = [makeMovieEpisode(media, { score: SCORE, ...desc(shortDescription, SCORE) })]
    media.episodeCount = 1
  }

  return media
}

const normalizeEpisode = (ep: JWEpisode, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: String(ep.objectId),
    mediaUri,
    score: SCORE,
    titles: [{ language: 'en', title: ep.content.title, score: SCORE }],
    ...desc(ep.content.shortDescription, SCORE),
    // the day this episode aired, which is what `plugin:range` pairs a folded packaging's rows on.
    // JustWatch carries it on the episode list this query already fetches: 155 of the 180 episodes
    // behind the recorded season carry one (2026-09-12), and none of them reached us before today.
    releaseDate: ep.content.originalReleaseDate ?? undefined,
    seasonNumber: ep.content.seasonNumber,
    episodeNumber: ep.content.episodeNumber,
    runtime: ep.content.runtime ?? undefined
  })

// Which of the node's seasons the aggregated media is, through the shared picker, re-asked as the
// cluster's evidence lands. The lone-season shortcut, the bare title ordinal and the unique count that
// used to sit here were each a guess minting a precise uri; a lone season now passes the picker like
// any other, and a cluster the picker refuses gets no season, which `normalizeMedia` turns into no media.
const resolveSeasonNumber = async (uri: string, node: JWShowNode, ctx: ExtractorServerContext) => {
  if (!node.seasons?.length) return undefined
  const candidates = jwCandidates(node.seasons)
  return waitForMedia(uri, ctx, m => {
    const evidence = {
      titles: (m?.titles ?? []).map((title: { title: string }) => title.title),
      episodeCount: declaredEpisodeCount(m),
      startDate: m?.startDate
    }
    return hasEvidence(evidence) ? pickSimilarSeason(evidence, candidates)?.season.content.seasonNumber : undefined
  })
}

/**
 * The one season of node `showId` that the caller's evidence establishes as its run, as the
 * season-scoped media this source already builds, or undefined. A film has no seasons to pick between,
 * and a refusal by the picker is undefined too, never the show.
 */
const similarSeason = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  if (!input?.showId) return undefined
  const detailRes = await getNodeDetails(`ts${input.showId}`, ctx)
  const node = detailRes.data?.node
  if (!node?.seasons?.length || !showRequiresSeason(node.objectType)) return undefined
  const verdict = pickSimilarSeason(input, jwCandidates(node.seasons))
  if (!verdict) return undefined
  const media = await normalizeMedia(node, { seasons: node.seasons, seasonNumber: verdict.season.content.seasonNumber }, ctx, policyFor(input))
  return media ?? undefined
}

/**
 * Whether this catalogue entry is dated like the media we are looking at. The full measurement, the
 * floor it removes and the show-level reading it must not be is in ../catalogue-gate.ts.
 *
 * JustWatch exposes a year and nothing finer, and it exposes it at two levels. Only the SEASON level
 * is usable: `node.content.originalReleaseYear` is the show's, which is the first season's, so
 * comparing our start date against it refuses 83% of the season-to-parent links this gate exists to
 * recover. The per-season years come back in the same NODE_QUERY response the gate already holds, so
 * reading them at season level costs no extra request at all.
 *
 * A movie is the one entry with no seasons to read, and it also has no show-vs-season gap to fall
 * into: its own release year IS the work's year, so the show-level field is the right one there and
 * only there. A SERIES with no season years is a refusal, never a fallback to the show's year.
 */
const datedLikeThisMedia = (startDate: string | null | undefined, node: JWShowNode): boolean => {
  const seasonYears = (node.seasons ?? []).map(season => season.content?.originalReleaseYear)
  if (seasonYears.length) return yearAppearsInShow(startDate, seasonYears)
  return !showRequiresSeason(node.objectType) && yearAppearsInShow(startDate, [node.content.originalReleaseYear])
}

/**
 * Linking a search hit asserts identity PERMANENTLY, so this gate is deliberately stricter than the
 * shared one: see ../catalogue-gate.ts for the two axes, the thresholds and what each one measured.
 *
 * What changed here, and it is three separate mistakes rather than one. The gate used to score the
 * SEARCH QUERY against the candidate, so the simplifyTitle rung that found the entry was also what
 * judged it, which measured WORSE than not simplifying at all (margin 0.0765 against 0.0971). It
 * scored only our FIRST title, so a catalogue listing the show under its other name was refused
 * (whole list 0.3916 against primary only 0.0647 on the same pairs). And it fetched details for
 * `results[0]` alone, so results[1..9] were never even looked at, while the search payload has
 * carried `content.title` for all ten the whole time.
 *
 * REQUEST COST, worst case, per media: 4 searches (down from 5, since the query list is now capped)
 * plus at most 3 node detail requests per query where there used to be exactly 1, so at most 12 detail
 * requests against the old 5. In practice it is far below that: a node id is fetched at most once per
 * call (see the `details` map, and read its comment before assuming `deduplicatedFetch` covers this),
 * the loop returns on the first query that produces a linkable candidate, and the title axis runs
 * entirely on the search payload, so a candidate the title refuses costs zero requests.
 */
const searchAndLinkMedia = async (aggregatedUri: string, ctx: ExtractorServerContext, detailed?: boolean | null): Promise<GQLMedia | null> => {
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

  // anything missing is a refusal, never a guess: with no start date there is no date axis, and a gate
  // running on one axis is the 4.002% floor of permanent wrong links with nothing to catch it
  const startDate: string | undefined = known.startDate ?? undefined
  if (!startDate) return null

  const knownTitles: string[] = (known.titles ?? []).map((title: { title: string }) => title.title).filter(Boolean)
  const primary = knownTitles[0]
  if (!primary) return null

  // A node id is fetched at most once per call, and this map is what makes that true. `deduplicatedFetch`
  // above CANNOT do it: it deletes its key in `.finally`, so it coalesces requests that are in flight at
  // the same moment and caches nothing, while this loop awaits each candidate in turn, so the key is
  // always gone before the next rung asks. Measured before this map existed: 4 rungs over 3 distinct
  // node ids issued 12 requests rather than 3, and the rungs re-scoring the same entry is the COMMON
  // case, since a shorter query returns a superset of what the longer one returned.
  const details = new Map<string, Promise<JWNodeResponse>>()
  const nodeDetails = (nodeId: string) => {
    const cached = details.get(nodeId)
    if (cached) return cached
    const request = getNodeDetails(nodeId, ctx, detailed)
    details.set(nodeId, request)
    return request
  }

  // The show container, held rather than returned. A season media is strictly better than it, so the
  // search has to run to the end before settling for one: a franchise is routinely split across
  // several catalogue entries, and returning the first candidate whose season folds would beat a
  // later entry that matches a season exactly. First one wins, matching the rest of this loop, where
  // candidates are already ordered by title score.
  let container: GQLMedia | null = null

  for (const query of searchQueries(primary)) {
    const searchRes = await searchTitles(query, ctx)
    const results = (searchRes.data?.popularTitles?.edges ?? []).map(edge => edge.node)
    if (!results.length) continue

    // gate on title BEFORE spending a detail request: the search payload already carries everything
    // this axis reads, and a refused candidate must cost nothing
    const scored = await rankByTitle(knownTitles, results, node => node.content?.title)
    if (!scored.length) continue

    // the runners-up are date-checked too, because a franchise is routinely split across several
    // catalogue entries, and the first survivor wins because `scored` is ordered by title score:
    // JustWatch's date axis is a year MEMBERSHIP and so answers yes or no, with no distance to rank on
    // the way Apple TV's window has
    for (const { candidate } of scored) {
      const detailRes = await nodeDetails(candidate.id)
      const node = detailRes.data?.node
      if (!node?.content?.title) continue
      if (!datedLikeThisMedia(startDate, node)) continue

      // the season is the shared picker's to name, on the cluster's titles, count and date as they
      // stand; a show with no season the evidence establishes is refused by `normalizeMedia` below
      const seasonNumber = node.seasons?.length
        ? pickSimilarSeason(
            { titles: knownTitles, episodeCount: declaredEpisodeCount(known), startDate },
            jwCandidates(node.seasons)
          )?.season.content.seasonNumber
        : undefined

      const media = await normalizeMedia(node, { seasons: node.seasons, seasonNumber }, ctx)
      if (media) {
        mergeHandles(media, aggregatedUri)
        return media
      }
      // No season established, which for anime is usually the FOLD rather than a bad match: JustWatch
      // packs two cours into one season, so a cour matches none of them. The show still comes back, as
      // a container, because the offers hang off it and they carry the provider ids. Deliberately NOT
      // `mergeHandles`d: see `showAsContainer`.
      if (!container) container = await showAsContainer(node, ctx)
    }
  }
  return container
}

const resolveMedia = async (uri: string, ctx: ExtractorServerContext, details?: boolean | null): Promise<GQLMedia | null> => {
  const jwUri = extractAggregatedUriOrigin(uri, origin)
  if (jwUri) {
    const { objectId, seasonObjectId } = splitJwId(jwUri.id)
    // `ts<id>` and `tm<id>` are two unrelated titles, and a bare id is a film's only when the cluster is
    // a film: anything else stays a show, which is what a show container's bare id is
    const format = seasonObjectId == null && isAggregatedUri(uri)
      ? await waitForMedia(uri, ctx, media => ['MOVIE', 'SERIES'].find(category => media?.categories?.includes(category)))
      : undefined
    const detailRes = await getNodeDetails(`${format === 'MOVIE' ? 'tm' : 'ts'}${objectId}`, ctx, details)
    const node = detailRes.data?.node
    if (!node) return null
    // the uri pins a season by ITS id, so the number the episode lists use is looked up, not assumed
    const pinned = seasonObjectId != null
      ? node.seasons?.find(season => season.objectId === seasonObjectId)?.content.seasonNumber
      : undefined
    const seasonNumber = pinned ?? (isAggregatedUri(uri) ? await resolveSeasonNumber(uri, node, ctx) : undefined)
    const media = await normalizeMedia(node, { seasons: node.seasons, seasonNumber }, ctx)
    if (!media) return null
    if (isAggregatedUri(uri)) mergeHandles(media, uri)
    return media
  }
  if (!isAggregatedUri(uri)) return null
  // no `jw:` in the uri, so no source ever supplied one. Search, under the gate above.
  return searchAndLinkMedia(uri, ctx, details)
}

export const resolvers: Resolvers = {
  Subscription: {
    similarMedia: {
      // always yield once: a generator that completes without yielding makes yoga respond 204 and the
      // caller waits out its timeout instead of reading the refusal
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        yield { similarMedia: await similarSeason(input, ctx) ?? null }
      }
    },
    media: {
      subscribe: async function* (_, { input: { uri: _uri, details } }, ctx: ExtractorServerContext) {
        if (!_uri || !(isUri(_uri) || isAggregatedUri(_uri))) return yield { media: null }
        yield { media: await resolveMedia(_uri, ctx, details) }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        const { search } = input
        if (!search) return yield { mediaPage: { nodes: [] } }
        const policy = policyFor(input)
        const searchRes = await searchTitles(search, ctx)
        // the search query does not fetch seasons, so normalizeMedia declines every series result and only movies come through
        const nodes = await Promise.all(
          (searchRes.data?.popularTitles?.edges ?? []).map(e => normalizeMedia(e.node, {}, ctx, policy))
        )
        yield { mediaPage: { nodes: nodes.filter((media): media is GQLMedia => media !== null) } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      if (isMovie(parent)) return [makeMovieEpisode(parent, { score: SCORE })]
      const { objectId, seasonObjectId } = splitJwId(parent.id)
      const detailRes = await getNodeDetails(`ts${objectId}`, ctx)
      const node = detailRes.data?.node
      if (!node?.seasons) return []
      const pinned = seasonObjectId != null
        ? node.seasons.find(season => season.objectId === seasonObjectId)?.content.seasonNumber
        : undefined
      const seasonNumber = pinned ?? (parent.titles?.[0]?.title ? parseSeasonNumber(parent.titles[0].title) : undefined)
      const seasons = seasonNumber != null
        ? node.seasons.filter(s => s.content.seasonNumber === seasonNumber)
        : node.seasons
      return seasons.flatMap(s =>
        (s.episodes ?? []).filter(ep => ep.content.isReleased).map(ep => normalizeEpisode(ep, parent.uri))
      )
    }
  }
}
