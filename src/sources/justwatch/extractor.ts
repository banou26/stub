import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode , MediaHandle as GQLMediaHandle, MediaCategory, MediaPageInput, MediaRating, MediaStreamingLink as GQLMediaStreamingLink, SimilarMediaInput } from '../../generated/schema/types.generated'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri, originsOfUri, toUri } from '../../utils/uri'
import { site, type Site } from '../../site'
import { resolveEpisodeToSeriesId } from '../crunchyroll/extractor'
import { crunchyrollId } from '../crunchyroll/season-id'
import { PACKAGE_ORIGIN_MAP, WATCHABLE, extractContentId, extractRealUrl, jwId, providerContentId, showRequiresSeason, splitJwId } from './id'
import { JUSTWATCH_GENRES, genreKey } from './genres'
import { policyFor, UNKNOWN_POLICY, type RequestPolicy } from '../../worker/request-context'
import { isOnlySeasonLabel, parseSeasonNumber } from '../season'
import { languageTags, qualityLabels } from '../stream-facts'
import { hasEvidence, pickSimilarSeason, type SeasonCandidate } from '../similar'
import { rankByTitle, searchQueries, yearAppearsInShow } from '../catalogue-gate'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img, getFirstTitle, mergeHandles, waitForMedia, partOf, sameAs, declaredEpisodeCount, tmdbLink } from '../utils'
import { charactersByName, type SourceCredits } from '../credits'
import { viewerCountry } from '../country'
import { isViewersPrime } from '../amazon/session'

const SCORE = 0.2
// below every other source's banner but AniList's 1900x400 strip (0.05), so a backdrop only fills a gap
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
// titles, posters and dates are read in the US for every viewer, so they do not move with the country
const COUNTRY = 'US'
const LANGUAGE = 'en'

// every country JustWatch keeps a catalogue for (content/locales/state, 2026-10-16); asked any other,
// Vietnam or Puerto Rico, it answers no offers and no error, so those viewers are asked the US's
const JUSTWATCH_COUNTRIES = new Set((
  'AD AE AG AL AO AR AT AU AZ BA BB BE BF BG BH BM BO BR BS BY BZ CA CD CH CI CL CM CO CR CU CV CY CZ DE '
  + 'DK DO DZ EC EE EG ES FI FJ FR GB GF GG GH GI GQ GR GT GY HK HN HR HU ID IE IL IN IQ IS IT JM JO JP KE '
  + 'KR KW LB LC LI LT LU LV LY MA MC MD ME MG MK ML MT MU MW MX MY MZ NE NG NI NL NO NZ OM PA PE PF PG PH '
  + 'PK PL PS PT PY QA RO RS RU SA SC SE SG SI SK SM SN SV TC TD TH TN TR TT TW TZ UA UG US UY VA VE XK YE '
  + 'ZA ZM ZW'
).split(' '))

// A JustWatch offer is scoped to ONE country, so a single country is a single catalogue. Anime is
// licensed per region and the Japanese catalogue is the one that carries it: measured 2026-09-09,
// The Elusive Samurai is `cra itu cru amz` in US and `nfx amp dnp nfa aam dan pva amz hlu fuj` in JP,
// and Mushoku Tensei has no US Netflix offer at all while JP names `nf:80987039`. So the viewer's
// country is asked with Japan beside it, and a viewer in Japan gets the US beside theirs.
//
// The viewer's offers come first and the first offer per service wins, so the other country only ever
// adds. A JP-only service mints nothing: `extractContentId` switches on the deep link's HOST and returns
// undefined for one it does not know, so happyon.jp or abema.tv contribute no handle. Netflix is safe to
// take from either because its host and title id are the same worldwide. Prime Video is not: its ids
// differ by country (Saltburn is d6674b8e in the US, Canada and the UK, ed457f7e in Germany and France)
// and an account plays its own country's catalogue alone, so a Prime offer off the viewer's own site is
// dropped.
const offerCountries = () => {
  const viewer = viewerCountry()
  const offerCountry = JUSTWATCH_COUNTRIES.has(viewer) ? viewer : 'US'
  return { offerCountry, extraCountry: offerCountry === 'JP' ? 'US' : 'JP' }
}

/** The offer country, which also decides the country asked beside it. */
export const region = () => offerCountries().offerCountry

const offersOf = ({ offers, extraOffers }: { offers?: JWOffer[], extraOffers?: JWOffer[] }) =>
  [...offers ?? [], ...extraOffers ?? []].filter(offer =>
    PACKAGE_ORIGIN_MAP[offer.package.shortName] !== 'amazon' || isViewersPrime(offer.deeplinkURL ?? offer.standardWebURL ?? ''))

// Prime Video, Disney+ and Max, whose `deeplinkURL` plays the film or episode itself where
// `standardWebURL` opens the title's page: /watch?gti=, /play/<id> and /video/watch/<id>
const PLAYBACK_ORIGINS = ['amazon', 'disney', 'hbo']
const PLAYBACK_PACKAGES = Object.keys(PACKAGE_ORIGIN_MAP).filter(name => PLAYBACK_ORIGINS.includes(PACKAGE_ORIGIN_MAP[name]!))

// What an offer says about its stream, which a playback row carries to the watch page's card
const OFFER_FACTS = `
                presentationType
                videoTechnology
                audioTechnology
                audioLanguages
                subtitleLanguages`
// `videoTechnology` answers [''] for none (2026-10-25); a value with no label here is left off
const VIDEO_LABELS: Record<string, string> = {
  SD: 'SD', HD: 'HD', _4K: '4K', _8K: '8K', DOLBY_VISION: 'Dolby Vision', HDR: 'HDR', HDR10: 'HDR10', IMAX: 'IMAX',
}
const AUDIO_LABELS: Record<string, string> = { _5_POINT_1: '5.1', _7_POINT_1: '7.1', DOLBY_ATMOS: 'Dolby Atmos' }

const offerFacts = (offer: JWOffer) => ({
  videoQualities: qualityLabels([offer.presentationType, ...offer.videoTechnology ?? []], VIDEO_LABELS),
  audioQualities: qualityLabels(offer.audioTechnology, AUDIO_LABELS),
  audioLanguages: languageTags(offer.audioLanguages),
  subtitleLanguages: languageTags(offer.subtitleLanguages),
})

const OFFER = `
            monetizationType
            presentationType
            standardWebURL
            deeplinkURL(platform: WEB)
            package {
              id
              packageId
              clearName
              technicalName
              shortName
              icon(profile: S100)
            }`

const episodeOffers = (country: string) => `
                country: ${country}, platform: WEB,
                filter: { monetizationTypes: [FLATRATE_AND_BUY, FLATRATE, ADS, FREE], bestOnly: true, packages: ${JSON.stringify(PLAYBACK_PACKAGES)} }
              ) {
                monetizationType
                deeplinkURL(platform: WEB)${OFFER_FACTS}
                package {
                  shortName
                }
              }`

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

// one catalogue's most popular titles under `field`, every one read in the US
const titlesIn = (field: string, country: string, extra: string) => `
    ${field}(country: ${country}, filter: $searchTitlesFilter, first: $first, sortBy: POPULAR, sortRandomSeed: 0) {
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
              translation(language: $language)
            }
            productionCountries${extra}
          }
          offers(country: $offerCountry, platform: WEB, filter: { bestOnly: true }) {${OFFER}
          }
          extraOffers: offers(country: $extraCountry, platform: WEB, filter: { bestOnly: true }) {${OFFER}
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
    }`

const titlesQuery = (catalogues: string) => `
  query GetSearchTitles($searchTitlesFilter: TitleFilter!, $country: Country!, $offerCountry: Country!, $extraCountry: Country!, $language: Language!, $first: Int!) {${catalogues}
  }
`

const SEARCH_QUERY = titlesQuery(titlesIn('popularTitles', '$country', ''))
// A title the US catalogue does not carry is searched in the offer country's too, in the same request: Even the
// Student Council Has Its Holes! is none of the US search's ten and first of Japan's (2026-10-29). A US viewer's two
// would be one, so they ask SEARCH_QUERY.
const VIEWER_SEARCH_QUERY = titlesQuery(titlesIn('popularTitles', '$country', '') + titlesIn('viewerTitles: popularTitles', '$offerCountry', ''))
// the home hero's wide image and trailer, which nothing reading a search draws. On the 40 most popular US shows and
// films, 7 to 10 KB of backdrops and 4 to 5 KB of clips on a 177 to 204 KB answer, and a clip on 79 of the 80 (2026-10-26)
const POPULAR_QUERY = titlesQuery(titlesIn('popularTitles', '$country', `
            backdrops(profile: S1920, format: JPG) {
              backdropUrl
            }
            clips(providers: [YOUTUBE]) {
              externalId
            }`))

const nodeQuery = (details: string) => `
  query GetTitleNode($nodeId: ID!, $language: Language!, $country: Country!, $offerCountry: Country!, $extraCountry: Country!) {
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
            translation(language: $language)
          }
          productionCountries${details}
        }
        offers(country: $offerCountry, platform: WEB, filter: { bestOnly: true }) {${OFFER}${OFFER_FACTS}
        }
        extraOffers: offers(country: $extraCountry, platform: WEB, filter: { bestOnly: true }) {${OFFER}${OFFER_FACTS}
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
              offers(${episodeOffers('$offerCountry')}
              extraOffers: offers(${episodeOffers('$extraCountry')}
            }
          }
        }
      }
    }
  }
`

// The relay caches on the whole body, so the modal's leaves out what only the title page's `details`
// reads
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
          }
          externalIds {
            tmdbId
          }
          credits {
            role
            name
            characterName
            personId
          }`)

const _inflight = new Map<string, Promise<unknown>>()

const deduplicatedFetch = async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
  const existing = _inflight.get(key)
  if (existing) return existing as Promise<T>
  const promise = fn()
  _inflight.set(key, promise)
  const clear = () => _inflight.delete(key)
  promise.then(clear, clear)
  return promise
}

/** What a search finds in the US catalogue, then what only the offer country's names. */
const searchTitles = async (query: string, ctx: ExtractorServerContext): Promise<JWSearchNode[]> => {
  const countries = offerCountries()
  const { data } = await deduplicatedFetch(`search:${query}`, () =>
    jwFetch<JWSearchResponse>(countries.offerCountry === COUNTRY ? SEARCH_QUERY : VIEWER_SEARCH_QUERY, {
      first: 10, searchTitlesFilter: { searchQuery: query }, language: LANGUAGE, country: COUNTRY, ...countries
    }, ctx)
  )
  const nodes = [...data?.popularTitles?.edges ?? [], ...data?.viewerTitles?.edges ?? []].map(edge => edge.node)
  return nodes.filter((node, index) => nodes.findIndex(other => other.id === node.id) === index)
}

const POPULAR_FIRST = 40

type PopularFilter = { objectTypes: ('MOVIE' | 'SHOW')[], genres?: string[] }

const popularTitles = (filter: PopularFilter, ctx: ExtractorServerContext) =>
  deduplicatedFetch(`popular:${JSON.stringify(filter)}`, () =>
    jwFetch<JWSearchResponse>(POPULAR_QUERY, {
      first: POPULAR_FIRST, searchTitlesFilter: filter, language: LANGUAGE, country: COUNTRY, ...offerCountries()
    }, ctx)
  )

const KINDS: Partial<Record<MediaCategory, PopularFilter['objectTypes']>> = { MOVIE: ['MOVIE'], SERIES: ['SHOW'] }

// the kinds a site lists a genre by: its own, or on stub.fkn.app the category named, none meaning every kind;
// anime.fkn.app lists by AniList's genres
const genreKinds = (named: PopularFilter['objectTypes'] | undefined) =>
  site === 'movie' ? KINDS.MOVIE : site === 'series' ? KINDS.SERIES : site === 'stub' ? named ?? [] : undefined

const genreCode = (label: string) =>
  Object.entries(JUSTWATCH_GENRES).find(([name]) => genreKey(name) === genreKey(label))?.[1]

// What JustWatch's most popular titles answer and no other source does: a home row, one category named, and a genre on
// the sites that list by its genres. Never with a search, or a season, status or tag, which its titles never carry, nor
// with formats that leave out a film's, the only one they carry. Its filter keeps a title carrying any genre asked where
// the page keeps one carrying every genre picked, so it is asked the first.
const popularFilter = ({ categories, formats, season, seasonYear, status, tags, genres }: MediaPageInput): PopularFilter | undefined => {
  if (season || seasonYear || status || tags?.length || (formats?.length && !formats.includes('MOVIE'))) return undefined
  const named = categories?.length === 1 ? KINDS[categories[0]!] : undefined
  if (!genres?.length) return named && { objectTypes: named }
  const objectTypes = genreKinds(named)
  const codes = genres.map(genreCode)
  return objectTypes && codes.every(Boolean) ? { objectTypes, genres: [codes[0]!] } : undefined
}

const getNodeDetails = (nodeId: string, ctx: ExtractorServerContext, details?: boolean | null) =>
  deduplicatedFetch(`node:${nodeId}:${Boolean(details)}`, () =>
    jwFetch<JWNodeResponse>(details ? NODE_DETAILS_QUERY : NODE_QUERY, {
      nodeId, language: LANGUAGE, country: COUNTRY, ...offerCountries()
    }, ctx)
  )

interface JWOffer {
  monetizationType: string
  /** absent on an episode's offer, which asks only for the deep link */
  standardWebURL?: string | null
  deeplinkURL?: string | null
  /** `clearName` and `icon`, a path ending `.{format}`, absent on an episode's offer */
  package: { shortName: string, clearName?: string, icon?: string | null }
  /** `OFFER_FACTS`, which the search query does not ask for */
  presentationType?: string | null
  videoTechnology?: string[] | null
  audioTechnology?: string[] | null
  audioLanguages?: string[] | null
  subtitleLanguages?: string[] | null
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
    genres?: { shortName: string, translation?: string | null }[] | null
    productionCountries?: string[] | null
    externalIds?: { imdbId?: string | null, tmdbId?: string | null } | null
    /** these four and `externalIds.tmdbId` only on NODE_DETAILS_QUERY's answer, `backdrops` on POPULAR_QUERY's too */
    runtime?: number | null
    backdrops?: { backdropUrl: string }[] | null
    /** YouTube's videos for the title, only on POPULAR_QUERY's answer */
    clips?: { externalId: string }[] | null
    scoring?: { imdbScore: number | null, tmdbScore: number | null, tomatoMeter: number | null, jwRating: number | null } | null
    credits?: JWCredit[] | null
  }
  offers: JWOffer[]
  /** the same offers read on the second country; see `offerCountries` */
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
  /** this episode's offers on PLAYBACK_ORIGINS alone, in the title's two countries */
  offers?: JWOffer[]
  extraOffers?: JWOffer[]
}

interface JWCredit { role: string, name: string, characterName: string | null, personId: number }
interface JWShowNode extends JWSearchNode { seasons: JWSeason[] }
interface JWSearchResponse {
  data: {
    popularTitles: { edges: { node: JWSearchNode }[] }
    /** the offer country's catalogue, which only VIEWER_SEARCH_QUERY asks */
    viewerTitles?: { edges: { node: JWSearchNode }[] }
  }
}
interface JWNodeResponse { data: { node: JWShowNode } }

/** JustWatch's credits as `mergeCredits` reads them: each actor under their part, every other role as staff. */
export const parseCredits = (credits: JWCredit[]): SourceCredits => ({
  characters: charactersByName(credits.flatMap(({ role, name, characterName, personId }) =>
    role === 'ACTOR' && characterName ? [{ name: characterName, language: null, person: { id: `${origin}:${personId}`, name } }] : [])),
  staff: credits.flatMap(({ role, name, personId }) =>
    role === 'ACTOR' ? [] : [{ person: { id: `${origin}:${personId}`, name }, roles: [role.charAt(0) + role.slice(1).toLowerCase()] }]),
})

const resolveImageUrl = (url: string | null | undefined) =>
  url ? (url.startsWith('http') ? url : `${JW_IMAGE_BASE}${url}`) : undefined

const bannersOf = ({ content }: JWSearchNode) =>
  (content.backdrops ?? []).flatMap(({ backdropUrl }) => img(resolveImageUrl(backdropUrl), BACKDROP_SCORE))

// the first clip only: the ones after it are often a trailer in another language, or not this title's at all (South
// Park's second is a video game's). The first was in another language on 2 of 79 titles and unnamed on 8, and a
// clip's `language` only echoes the one asked (2026-10-26)
const trailersOf = ({ content }: JWSearchNode) =>
  (content.clips ?? []).slice(0, 1).map(({ externalId: id }) => ({ uri: `yt:${id}`, origin: 'yt', id, url: `https://www.youtube.com/watch?v=${id}` }))

const ratingsOf = (scoring: JWSearchNode['content']['scoring']): MediaRating[] =>
  [
    { source: 'IMDb', value: scoring?.imdbScore, scale: 10 },
    { source: 'TMDB', value: scoring?.tmdbScore, scale: 10 },
    { source: 'Rotten Tomatoes', value: scoring?.tomatoMeter, scale: 100 },
    { source: 'JustWatch', value: scoring?.jwRating == null ? null : Math.round(scoring.jwRating * 100), scale: 100 },
  ].filter((rating): rating is MediaRating => rating.value != null)

// `ani` is any animation, so the production countries say anime, and only when ALL of them are in the
// set: US shows animated in Korea (Avatar: The Last Airbender, KR, MY, SG, US) and Golden Axe (JP, US)
// are not anime. Co-produced anime such as Lazarus (JP, US) is lost here and kept by TVmaze and AniList.
const ANIME_COUNTRIES = ['JP', 'CN', 'KR']

const isAnime = ({ content }: JWSearchNode) =>
  Boolean(content.genres?.some(genre => genre.shortName === 'ani')
    && content.productionCountries?.length
    && content.productionCountries.every(country => ANIME_COUNTRIES.includes(country)))

const categoriesOf = (node: JWSearchNode): MediaCategory[] => {
  const format = node.objectType === 'MOVIE' ? 'MOVIE' : 'SERIES'
  return isAnime(node) ? ['ANIME', format] : [format]
}

// `eur`, Made in Europe, is a region and not a genre
const genresOf = (node: JWSearchNode) =>
  (node.content.genres ?? []).flatMap(genre => genre.shortName === 'eur' ? [] : genre.translation ?? [])

/**
 * A start date at the best precision this node has for THIS media: the day when JustWatch names one,
 * else the year as `YYYY`, else nothing.
 *
 * `YYYY` parses to January 1, which the store reads as no day at all: a parsed date whose UTC
 * day-of-month is 1 is `month-or-year`, so `startDay` is dropped and only the year survives to bucket
 * on (5.4 P0). Every JustWatch row was that shape until 2026-09-12,
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
  day ?? (year ? String(year) : undefined)

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
    if (!WATCHABLE.includes(offer.monetizationType)) continue
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
 * The offer country's offers that name no handle, as plain links: a platform stub has no source for (Anime Times
 * Amazon Channel), or an address whose id `extractContentId` does not read (Hulu on hulu.jp, where it reads
 * hulu.com's). The country beside, which is asked for what plays through stub, adds none.
 */
const streamingLinksOf = (offers: JWOffer[] = []): GQLMediaStreamingLink[] => {
  const links = new Map<string, GQLMediaStreamingLink>()
  for (const { monetizationType, standardWebURL, package: { shortName, clearName, icon } } of offers) {
    const url = standardWebURL && (extractRealUrl(standardWebURL) ?? standardWebURL)
    if (!url || !clearName || links.has(shortName) || !WATCHABLE.includes(monetizationType)) continue
    if (PACKAGE_ORIGIN_MAP[shortName] && extractContentId(url)) continue
    links.set(shortName, { site: clearName, url, icon: resolveImageUrl(icon?.replace('{format}', 'webp')), country: region() })
  }
  return [...links.values()]
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
  policy: RequestPolicy = UNKNOWN_POLICY,
  listed = false
): Promise<GQLMedia | null> => {
  // A LISTED SHOW CARRIES NO OFFERS. A show's provider id is stored as a placeholder run, so the claim
  // is downgraded to a contested PART_OF and the listing hides the show behind a row that draws no card
  // (`onlyContested`, graph/plugins/containment.ts): measured 2026-10-12, every show of the home row.
  const handles = listed ? [] : await buildOffersAsHandles(
    offersOf(node),
    { showContainer: true },
    ctx,
    policy
  )
  // a container carrying no provider id is noise: it names a show the cluster already reaches through
  // its other containers and adds nothing a reader could act on. A listing's show is the card itself.
  if (!handles.length && !listed) return null

  return makeMedia({
    origin,
    id: String(node.objectId),
    url: `https://www.justwatch.com${node.content.fullPath}`,
    scope: 'CONTAINER',
    categories: categoriesOf(node),
    genres: genresOf(node),
    score: SCORE,
    handles,
    titles: [{ language: 'en', title: node.content.title, score: SCORE }],
    ...desc(node.content.shortDescription ?? undefined, SCORE),
    covers: img(resolveImageUrl(node.content.posterUrl), SCORE),
    banners: bannersOf(node),
    trailers: trailersOf(node),
    // the SHOW's own day, which is the right subject here and only here: this media IS the show
    startDate: dayOrYear(node.content.originalReleaseDate, node.content.originalReleaseYear)
  })
}

// JustWatch's own names for a season that say only where it sits in its show, past the "Season 2" any catalogue
// uses: over 1,849 popular US shows (2026-10-25), 758 of 8,331 seasons were one of "Series 2", "Miniseries",
// "Season 1984", "S2", "Limited Series", "Volume 2", "Season-2", "season_1.0" (Mr. Robot), "(jp) season 12",
// "The Complete First Season" or "Book 2". Taken as its title, the season is refused by every source naming the
// show and drawn alone under it.
const PLACE_NAME = /^(?:\(\w+\)\s*)?(?:(?:season|series|volume|book|s)[\s_-]*\d+(?:\.\d+)?|the complete \w+ season|miniseries|limited series)$/i

const namesOnlyAPlace = (title: string) => isOnlySeasonLabel(title) || PLACE_NAME.test(title.trim())

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
  const title = season?.content.title && !namesOnlyAPlace(season.content.title) ? season.content.title : node.content.title

  const filteredSeasons = opts.seasonNumber != null
    ? (opts.seasons ?? []).filter(s => s.content.seasonNumber === opts.seasonNumber)
    : opts.seasons ?? []

  const released = filteredSeasons.flatMap(season => (season.episodes ?? []).filter(ep => ep.content.isReleased))
  const episodes = released.flatMap(ep => episodesOf(ep, toUri({ origin, id })))

  const offers = offersOf(node)
  const handles = await buildOffersAsHandles(
    offers,
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
      categories: categoriesOf(node),
      titles: [{ language: 'en', title: node.content.title, score: SCORE }],
      startDate: dayOrYear(node.content.originalReleaseDate, node.content.originalReleaseYear)
    })))
  }
  const tmdbId = node.content.externalIds?.tmdbId
  if (tmdbId) handles.push(tmdbLink(tmdbId, node.objectType === 'MOVIE'))

  const media = makeMedia({
    origin,
    id,
    // the type is what tells the graph's guards this is a film, which a category alone does not
    type: node.objectType === 'MOVIE' ? 'MOVIE' : undefined,
    categories: categoriesOf(node),
    genres: genresOf(node),
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
    ...desc(shortDescription, SCORE),
    covers: img(resolveImageUrl(node.content.posterUrl), SCORE),
    // the search query carries totalEpisodeCount but not the episodes themselves, so an expanded
    // season still reports how long it is - which is also what season matching elsewhere keys on
    episodeCount: released.length || filteredSeasons.reduce((total, season) => total + (season.totalEpisodeCount ?? 0), 0) || undefined,
    // the SEASON's own date, and its own year when it names no day. Only the YEAR falls back to the
    // show's: a season media publishing the show's DATE publishes the franchise's FIRST season's as
    // its own start date, which every date comparison downstream then reads as this season's - the
    // same show-vs-season confusion the uri scoping in ./id.ts exists to prevent, in the date field.
    startDate: dayOrYear(seasonDay, seasonYear),
    // a show's runtime is an episode's, which the episodes already carry
    duration: node.objectType === 'MOVIE' ? node.content.runtime ?? undefined : undefined,
    banners: bannersOf(node),
    trailers: trailersOf(node),
    ratings: ratingsOf(node.content.scoring),
    streamingLinks: streamingLinksOf(node.offers),
    ...node.content.credits ? { credits: parseCredits(node.content.credits) } : {},
  })

  // a film's episode is the film, so `makeMovieEpisode` copies the media's title, description and poster
  if (isMovie(media)) {
    media.episodes = [
      makeMovieEpisode(media, { score: SCORE }),
      ...playbackLinks(offers).map(link => makeMovieEpisode(media, { ...link, score: SCORE })),
    ]
    media.episodeCount = 1
  }

  return media
}

// what JustWatch writes for an episode it has no synopsis for (2026-10-16)
const PLACEHOLDER_SYNOPSIS = /^Watch the (new )?episode now\.$/

const normalizeEpisode = (ep: JWEpisode, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: String(ep.objectId),
    mediaUri,
    score: SCORE,
    titles: [{ language: 'en', title: ep.content.title, score: SCORE }],
    ...desc(PLACEHOLDER_SYNOPSIS.test(ep.content.shortDescription?.trim() ?? '') ? undefined : ep.content.shortDescription, SCORE),
    // the day this episode aired, which is what `plugin:range` pairs a folded packaging's rows on.
    // JustWatch carries it on the episode list this query already fetches: 155 of the 180 episodes
    // behind the recorded season carry one (2026-09-12), and none of them reached us before today.
    releaseDate: ep.content.originalReleaseDate ?? undefined,
    seasonNumber: ep.content.seasonNumber,
    episodeNumber: ep.content.episodeNumber,
    runtime: ep.content.runtime ?? undefined
  })

/**
 * Where each service in PLAYBACK_ORIGINS plays this film or episode: the first offer per service wins,
 * so `offersOf` decides whose catalogue. The id is the one the deep link names, which on Max is not the
 * title's (a film plays /video/watch/<id> from a /show/<other id> page), so it goes on an episode and
 * never on a media handle.
 */
const playbackLinks = (offers: JWOffer[]) => {
  const links = new Map<string, { origin: string, id: string, url: string } & ReturnType<typeof offerFacts>>()
  for (const offer of offers) {
    const { deeplinkURL, package: { shortName } } = offer
    const service = PACKAGE_ORIGIN_MAP[shortName]
    const id = deeplinkURL ? extractContentId(deeplinkURL) : undefined
    if (!service || !id || links.has(service) || !PLAYBACK_ORIGINS.includes(service)) continue
    links.set(service, { origin: service, id, url: deeplinkURL!, ...offerFacts(offer) })
  }
  return [...links.values()]
}

/**
 * JustWatch's episode, and beside it one episode per service that plays it, hung on the same media so
 * the graph files them under one slot. Not as a handle on JustWatch's episode: a handle's target hangs
 * on no media, so the graph refuses that claim `foreign-episode` and the link never reaches the row.
 */
const episodesOf = (ep: JWEpisode, mediaUri: string): GQLEpisode[] => [
  normalizeEpisode(ep, mediaUri),
  ...playbackLinks(offersOf(ep)).map(link => makeEpisode({
    ...link,
    mediaUri,
    score: SCORE,
    seasonNumber: ep.content.seasonNumber,
    episodeNumber: ep.content.episodeNumber,
  })),
]

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
    const results = await searchTitles(query, ctx)
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

// movies.fkn.app keeps films alone and series.fkn.app shows alone, so there a bare id is the node of that kind.
// Opened cold, `ag:(jw:<id>)` has nothing else to name a format: the cluster's wait ran its 15 s, and the film
// The End of Oak Street was asked as the show `ts1465819`, which does not exist (2026-10-19).
const SITE_NODES: Partial<Record<Site, 'tm' | 'ts'>> = { movie: 'tm', series: 'ts' }

// `ts<id>` and `tm<id>` are two unrelated titles behind one bare id, and the cluster's format only says
// which to ask first: a film can read as a series (a source stamping SERIES on every row, or MAL's ONA
// where JustWatch files a film), so the other is asked when the first is not titled like the cluster.
// Penguin Highway's `ts403680` is The Numbers, measured 2026-10-19.
const bareNode = async (uri: string, objectId: string, ctx: ExtractorServerContext, details?: boolean | null) => {
  const kept = SITE_NODES[site]
  if (kept) return (await getNodeDetails(`${kept}${objectId}`, ctx, details)).data?.node
  const cluster = await waitForMedia(uri, ctx, media => ['MOVIE', 'SERIES'].some(category => media?.categories?.includes(category)) ? media : undefined)
  const titles: string[] = (cluster?.titles ?? []).map((title: { title: string }) => title.title)
  const titled = async (node?: JWShowNode | null) => Boolean(node && (await rankByTitle(titles, [node], node => node.content?.title)).length)
  const [first, second] = cluster?.categories?.includes('MOVIE') ? ['tm', 'ts'] : ['ts', 'tm']
  const guess = (await getNodeDetails(`${first}${objectId}`, ctx, details)).data?.node
  if (!titles.length || await titled(guess)) return guess
  const other = (await getNodeDetails(`${second}${objectId}`, ctx, details)).data?.node
  return await titled(other) ? other : guess
}

const resolveMedia = async (uri: string, ctx: ExtractorServerContext, details?: boolean | null): Promise<GQLMedia | null> => {
  const jwUri = extractAggregatedUriOrigin(uri, origin)
  if (jwUri) {
    const { objectId, seasonObjectId } = splitJwId(jwUri.id)
    const node = seasonObjectId == null && isAggregatedUri(uri)
      ? await bareNode(uri, objectId, ctx, details)
      : (await getNodeDetails(`ts${objectId}`, ctx, details)).data?.node
    if (!node) return null
    // a show its address names alone has no run to pick, so it is the show, as the home row answers it; only on
    // series.fkn.app, since elsewhere the node is the cluster's guess at which of two titles the id names
    if (site === 'series' && seasonObjectId == null && originsOfUri(uri).every(member => member === origin)) {
      return showAsContainer(node, ctx, UNKNOWN_POLICY, true)
    }
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
        const policy = policyFor(input)
        const popular = search ? undefined : popularFilter(input)
        if (popular) {
          const edges = (await popularTitles(popular, ctx)).data?.popularTitles?.edges ?? []
          // films as runs, and shows as the CONTAINER a show is until a season of it is picked
          const nodes = await Promise.all(edges.map(({ node }) =>
            node.objectType === 'MOVIE' ? normalizeMedia(node, {}, ctx, policy) : showAsContainer(node, ctx, policy, true)))
          return yield { mediaPage: { nodes: nodes.filter((media): media is GQLMedia => media !== null) } }
        }
        if (!search) return yield { mediaPage: { nodes: [] } }
        // the search query does not fetch seasons, so normalizeMedia declines every series result and only movies come through
        const nodes = await Promise.all((await searchTitles(search, ctx)).map(node => normalizeMedia(node, {}, ctx, policy)))
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
        (s.episodes ?? []).filter(ep => ep.content.isReleased).flatMap(ep => episodesOf(ep, parent.uri))
      )
    }
  }
}
