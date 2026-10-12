import type { ExtractorServerContext } from '../../worker/extractor'
import type { Media, Resolvers } from '../../generated/schema/types.generated'
import { MediaStatus, MediaType } from '../../generated/graphql'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri } from '../../utils/uri'
import { desc, makeMedia, sameAs } from '../utils'
import { MAL_TYPE, isContinuing, parseMalSeason, type MalSeasonEntry } from './season-scrape'
import { airedDates, parseMalAnime, type MalAnime } from './anime-page'
import { parseMalCredits } from './credits-page'
import { malLargeImage } from '../mal-image'
import { animeSeasonOf, lowerSeason, upperSeason, type AnimeSeason } from '../season'
import { percentScore } from '../average-score'

export const icon = 'https://cdn.myanimelist.net/images/favicon.ico'
export const originUrl = 'https://myanimelist.net'
export const origin = 'mal'
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'MyAnimeList'
export const official = true
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['mal']

// Every request reads myanimelist.net's own pages: Jikan, the API this source used to ask, shut down on
// 2026-10-01 (jikan-me/jikan-rest#613), and MyAnimeList's own API needs a client id.

const SCORE = 0.9
const DESCRIPTION_SCORE = 0.9
// below AniList's credits (0.8), as the first source read sets each shared character's name, face and
// url and each language's whole cast, and this page lists staff by job, producers first; above Anime
// News Network's (0.2), which have no faces, roles or ids
const CREDITS_SCORE = 0.7

/**
 * The AniDB id a MyAnimeList external link carries, or undefined when it carries none.
 *
 * MyAnimeList publishes two url shapes and only one of them puts the id in the path:
 *
 *   https://anidb.net/perl-bin/animedb.pl?show=anime&aid=23   the common one, id in `aid`
 *   https://anidb.net/anime/23                                the modern one, id in the path
 *
 * Both halves have to be SHAPE TESTED, and neither was. Reading `pathname.split('/')[2]` as a fallback
 * takes index 2 of `/perl-bin/animedb.pl`, which is the literal string `animedb.pl`, so any record on
 * the common shape whose `aid` went missing minted `anidb:animedb.pl` rather than nothing. An id that
 * is not an id in the provider's own space clusters with nothing at best; here it is worse, because
 * every record that produced it produced the SAME one and `upsertMedia` welds them all into one media.
 *
 * The numeric test is the same rule from the other end: an AniDB id is a number, so `?aid=` carrying
 * anything else is a link we cannot read, not a link to something called that.
 */
export const anidbIdFromUrl = (url: string | undefined | null): string | undefined => {
  if (!url) return undefined
  try {
    const { searchParams, pathname } = new URL(url)
    const id = searchParams.get('aid') ?? /^\/anime\/([^/?#]+)/.exec(pathname)?.[1]
    return id && /^\d+$/.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

// MAL's type as its pages print it, or as `MAL_TYPE` names a season card's, in upper case
const TYPES: Record<string, MediaType> = {
  TV: MediaType.Tv,
  MOVIE: MediaType.Movie,
  OVA: MediaType.Ova,
  ONA: MediaType.Ona,
  SPECIAL: MediaType.Special,
  'TV SPECIAL': MediaType.Special,
}

const STATUSES: Record<string, MediaStatus> = {
  'Not yet aired': MediaStatus.NotYetReleased,
  'Currently Airing': MediaStatus.Releasing,
  'Finished Airing': MediaStatus.Finished,
}

const malMedia = (id: string, kind: string | undefined, fields: Omit<Parameters<typeof makeMedia>[0], 'origin' | 'id'>) => {
  const type = kind ? TYPES[kind.toUpperCase()] : undefined
  return makeMedia({
    origin,
    id,
    url: `https://myanimelist.net/anime/${id}`,
    categories: type === MediaType.Movie ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES'],
    type,
    score: SCORE,
    ...fields,
  })
}

const pageMedia = (id: string, page: MalAnime) => {
  const aniDBId = anidbIdFromUrl(page.anidb)
  const season = page.season ? lowerSeason(page.season) : undefined
  return malMedia(id, page.type, {
    // both are SAME_AS: AniDB models one entry per RUN for anime, and anizip is keyed on the anidb id,
    // so neither names a container
    handles: aniDBId ? [
      sameAs({ _id: crypto.randomUUID(), uri: `anidb:${aniDBId}`, origin: 'anidb', id: aniDBId, url: page.anidb } as Media),
      sameAs({ _id: crypto.randomUUID(), uri: `anizip:${aniDBId}`, origin: 'anizip', id: aniDBId, url: `https://api.ani.zip/mappings?anidb_id=${aniDBId}` } as Media),
    ] : [],
    averageScore: percentScore(page.score, 10),
    ...desc(page.synopsis, DESCRIPTION_SCORE),
    titles: [
      ...page.englishTitle ? [{ language: 'en', title: page.englishTitle, score: SCORE }] : [],
      { language: 'jp-en', title: page.title, score: SCORE },
      ...page.japaneseTitle ? [{ language: 'jp', title: page.japaneseTitle, score: SCORE }] : [],
    ],
    covers: page.cover ? [{ language: 'en', url: page.cover, score: SCORE }] : [],
    episodeCount: page.episodes,
    popularity: page.members,
    genres: page.genres,
    status: page.status ? STATUSES[page.status] : undefined,
    season: season ? upperSeason(season) : undefined,
    seasonYear: page.year,
    startDate: page.startDate,
    endDate: page.endDate,
    trailers: page.trailer ? [{
      uri: `yt:${page.trailer}`,
      origin: 'yt',
      id: page.trailer,
      url: `https://www.youtube.com/watch?v=${page.trailer}`,
      language: 'en',
    }] : [],
  })
}

// 1 MB for mal:1 and 10 MB for One Piece's 1481 characters, so only the title page asks it. Any slug
// serves it, and without one the site answers the title page instead.
const fetchCredits = (id: number, context: ExtractorServerContext) =>
  context
    .fetch(`https://myanimelist.net/anime/${id}/_/characters`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    .then(html => ({ ...parseMalCredits(html), score: CREDITS_SCORE }))
    .catch(error => {
      console.error(`MyAnimeList credits ${id} failed`, error)
      return undefined
    })

const fetchMedia = async ({ id }: { id: number }, context: ExtractorServerContext) => {
  const response = await context.fetch(`https://myanimelist.net/anime/${id}`)
  const page = parseMalAnime(await response.text())
  return page && pageMedia(String(id), page)
}

// The page carries no season per card because the page IS one season, so the season asked for is
// stamped on every row; unstamped, each one fails the store's season filter.
const seasonMedia = (entry: MalSeasonEntry, { season, year }: { season: AnimeSeason, year: number }) =>
  malMedia(entry.id, MAL_TYPE[entry.typeId as keyof typeof MAL_TYPE], {
    titles: [
      ...entry.englishTitle ? [{ language: 'en', title: entry.englishTitle, score: SCORE }] : [],
      { language: 'jp-en', title: entry.title, score: SCORE },
    ],
    covers: entry.cover ? [{ language: 'en', url: entry.cover, score: SCORE }] : [],
    // MAL prints one flat genre list on a card, its genres, themes and demographics, the same three
    // rows a title page lists
    genres: entry.genres ?? [],
    ...desc(entry.synopsis, DESCRIPTION_SCORE),
    episodeCount: entry.episodes,
    popularity: entry.members,
    averageScore: percentScore(entry.score, 10),
    startDate: entry.startDate,
    season: upperSeason(season),
    seasonYear: year,
  })

/**
 * A season off myanimelist.net's own page for it: 165 cards for FALL 2026, measured 2026-10-13.
 *
 * MAL's carried-over block and its R18+ cards are left out, which is what Jikan answered for the same
 * season (it was asked with `sfw` and without `continuing`): see MAL_CONTINUING_SECTION for why the
 * long-runners have to go. A page that fails or parses to nothing is an empty season and never an
 * error, so an outage costs this source's rows and leaves the bundled catalogue and AniList answering.
 */
const getSeason = async ({ season, year }: { season: AnimeSeason, year: number }, context: ExtractorServerContext): Promise<Media[]> => {
  try {
    const response = await context.fetch(`https://myanimelist.net/anime/season/${year}/${season}`)
    const html = await response.text()
    const entries = parseMalSeason(html)
    if (!entries.length) {
      console.error(`MyAnimeList ${season} ${year} parsed no entries from ${html.length} bytes`)
      return []
    }
    if (!entries.some(entry => entry.section)) {
      console.error('MyAnimeList season page has no section headings, so carried-over shows cannot be told apart')
    }
    return entries
      .filter(entry => !isContinuing(entry) && !entry.adult)
      .map(entry => seasonMedia(entry, { season, year }))
  } catch (error) {
    console.error(`MyAnimeList ${season} ${year} failed`, error)
    return []
  }
}

type SearchItem = {
  id: number
  name: string
  image_url?: string
  payload?: { media_type?: string, aired?: string, score?: string, status?: string }
}

// One answer of the search box's own endpoint, which carries no English title, synopsis, episode
// count, member count or genres. A title with no picture answers MAL's question mark placeholder,
// `/images/qm_50.gif`, which at 0.9 would outrank another source's real cover.
const searchMedia = (item: SearchItem) =>
  malMedia(String(item.id), item.payload?.media_type, {
    titles: [{ language: 'jp-en', title: item.name, score: SCORE }],
    covers: item.image_url?.includes('/images/anime/') ? [{ language: 'en', url: malLargeImage(item.image_url), score: SCORE }] : [],
    averageScore: percentScore(item.payload?.score, 10),
    status: item.payload?.status ? STATUSES[item.payload.status] : undefined,
    ...airedDates(item.payload?.aired),
  })

const fetchSearchAnime = ({ search }: { search: string }, context: ExtractorServerContext) =>
  context
    // the search box takes arbitrary text, and an unescaped `&` or `#` there ends the query parameter
    .fetch(`https://myanimelist.net/search/prefix.json?type=anime&keyword=${encodeURIComponent(search)}`)
    .then(response => response.json() as Promise<{ categories?: { items?: SearchItem[] }[] }>)
    .then(json => (json.categories?.[0]?.items ?? []).map(searchMedia))
    .catch(error => {
      console.error('MyAnimeList search failed', error)
      return []
    })

export const resolvers: Resolvers = {
  Query: {},
  Mutation: {},
  Subscription: {
    media: {
      /**
       * AN AGGREGATED URI IS THE NORMAL SHAPE HERE: a media page asks its sources with the CLUSTER's
       * address, `ag:(anilist:189046,...,mal:61316,...)`, and a source finds itself in it with
       * `extractAggregatedUriOrigin`. Refused, `mal:61316` stays a placeholder that other sources named
       * and nobody described: its badge still links through the url a claimer gave it (anilist, anizip,
       * kitsu, offline, simkl and livechart all claim `mal:` with one, which `readClaimedUrls` reads),
       * but only this resolver gives the row data of its own.
       */
      subscribe: async function*(_, { input: { uri: asked, details } }, ctx: ExtractorServerContext) {
        if (!asked || !(isUri(asked) || isAggregatedUri(asked))) return yield { media: null }
        const uri = extractAggregatedUriOrigin(asked, origin)
        if (!uri) return yield { media: null }
        const id = Number(uri.id)
        const credits = details ? fetchCredits(id, ctx) : undefined
        const media = await fetchMedia({ id }, ctx)
        // the row first, and again with its credits, whose page takes seconds longer
        yield { media }
        const found = await credits
        // a later answer replaces these credits, so a page that parses to none (an error page) adds none
        if (media && (found?.characters.length || found?.staff.length)) yield { media: { ...media, credits: found } }
      }
    },
    mediaPage: {
      subscribe: async function*(_, { input: { search, status, season, seasonYear } }, ctx: ExtractorServerContext) {
        // A named season answers whatever the status says, since a season is a listing and not a
        // moment. Half of one (a season with no year, or a year with no season) names no page this
        // source can read, and answering the current season instead would read as a result set
        // while being the wrong year.
        const seasonName = season ? lowerSeason(season) : undefined
        if (seasonName && seasonYear) {
          return yield { mediaPage: { nodes: await getSeason({ season: seasonName, year: seasonYear }, ctx) } }
        }
        // Half a pair names no season, so it is not answered AS a season, and the current season is
        // not offered in its place. It must not end the resolver either: the search page can carry a
        // term alongside a lone Season or Year.
        if (season || seasonYear) {
          if (!search) return yield { mediaPage: { nodes: [] } }
        } else if (status === 'RELEASING') {
          return yield { mediaPage: { nodes: await getSeason(animeSeasonOf(), ctx) } }
        }
        if (search) {
          return yield { mediaPage: { nodes: await fetchSearchAnime({ search }, ctx) } }
        }
        yield { mediaPage: { nodes: [] } }
      }
    },
  }
}
