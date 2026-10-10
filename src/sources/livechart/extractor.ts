import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, MediaCategory } from '../../generated/schema/types.generated'

import { MediaType } from '../../generated/graphql'
import { makeMedia, desc, img } from '../utils'
import { ANIME_SEASONS, animeSeasonOf, lowerSeason, upperSeason, type AnimeSeason } from '../season'
import { percentScore } from '../average-score'

export const originUrl = 'https://www.livechart.me'
export const categories = ['ANIME', 'SERIES', 'MOVIE'] as const
export const name = 'LiveChart'
export const origin = 'livechart'
export const official = false
export const metadataOnly = true
export const isApiOnly = true
export const supportedUris = ['livechart']

// Below AniList (0.8), MyAnimeList and AniZip (0.9), so it never takes a field from them; above Kitsu
// (0.3) and the offline database (0.2).
const SCORE = 0.6

export type LiveChartAnime = {
  id: number
  romaji_title?: string | null
  english_title?: string | null
  native_title?: string | null
  synopsis?: string | null
  premiere_date?: string | null
  premiere_date_precision?: number | null
  episode_count?: number | null
  anime_type?: number | null
  avg_rating?: number | null
  poster_image_large?: string | null
  mal_url?: string | null
}

/**
 * `anime_type` is an undocumented number. Measured 2026-10-10 over the fall and summer 2026 lists
 * against the bundled catalogue's type for the same MyAnimeList id: 1 is TV (156 of 162), 2 a movie
 * (19 of 20) and 4 an ONA (14 of 16). 5 is mixed (three MOVIE and one SPECIAL of the four the
 * catalogue places) and 3 is one title a season (Patlabor EZY, a MOVIE there), so those two, like any
 * value outside the table, claim no type and no format and leave both to the other members.
 */
const TYPES: Record<number, MediaType> = {
  1: MediaType.Tv,
  2: MediaType.Movie,
  4: MediaType.Ona,
}

const categoriesOf = (type: MediaType | undefined): MediaCategory[] =>
  type === undefined ? ['ANIME'] : type === MediaType.Movie ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES']

/**
 * The ONE handle a row mints: its MyAnimeList id, read off the only shape LiveChart published
 * (`myanimelist.net/anime/<id>`, numeric, or nothing).
 *
 * Not its AniList, Kitsu or AniDB link as well, though it carries them. A row naming two catalogues
 * unions their runs for good, and on some entries LiveChart's own links disagree about which part they
 * name: on 2026-10-10 its `Girls und Panzer das Finale` Part 5 entry linked Part 5 on MyAnimeList and
 * Part 1 on Kitsu, Kitsu answered for that id with Part 1's MyAnimeList id, and the season walk welded
 * the two parts. One id cannot join two runs. Nothing is lost by it: AniList, Kitsu, AniZip and the
 * bundled index already link MyAnimeList ids to the other three, and 175 of the 176 kept fall and
 * summer 2026 rows that carry any id carry a MyAnimeList one.
 */
const malHandle = (anime: LiveChartAnime): GQLMedia[] => {
  const id = /^https?:\/\/myanimelist\.net\/anime\/(\d+)$/.exec(anime.mal_url ?? '')?.[1]
  return id ? [makeMedia({ origin: 'mal', id, url: `https://myanimelist.net/anime/${id}` })] : []
}

const JST_MS = 9 * 60 * 60 * 1000

/**
 * The day a dated premiere falls on in Japan, which is the calendar the seasons and AniList's dates
 * are kept in. Precision 3 is a day, mostly stamped as Japanese midnight (`2026-10-08T15:00:00Z` is
 * October 9), and 4 a broadcast time; 2 is a month (`2026-11-01T00:00:00Z`) and goes out as no date
 * rather than a first of the month that reads as exact.
 */
const japanDay = (anime: LiveChartAnime): string | undefined => {
  const at = Date.parse(anime.premiere_date ?? '')
  if (!Number.isFinite(at) || (anime.premiere_date_precision ?? 0) < 3) return undefined
  return new Date(at + JST_MS).toISOString().slice(0, 10)
}

/**
 * Whether a title premiered in the season it was listed under rather than before it.
 *
 * LiveChart's season list carries every show still airing in it, back to 1969: on 2026-10-10 the fall
 * list held 148 titles of which 55 premiered before October, and summer 160 with 65 before July. No
 * field says which, and stamping those with the asked season would put Detective Conan on the season
 * row. The cut is the season's first day in Japan: read in UTC it drops the shows that premiere just
 * after midnight on that day, two of fall 2026's. Measured against the bundled catalogue, this keeps
 * 67 of fall's titles it files under fall and 1 it files elsewhere, and 84 of summer's against none,
 * at the cost of 10 late-September and late-June premieres the other sources list anyway. A week of
 * grace would win 7 of those back and add 3 films the catalogue files under the season before.
 */
export const premieredInSeason = (anime: LiveChartAnime, { season, year }: { season: AnimeSeason, year: number }) =>
  Date.parse(anime.premiere_date ?? '') >= Date.UTC(year, ANIME_SEASONS.indexOf(season) * 3, 1) - JST_MS

export const normalizeAnime = (anime: LiveChartAnime, { season, year }: { season: AnimeSeason, year: number }): GQLMedia => {
  const type = anime.anime_type == null ? undefined : TYPES[anime.anime_type]
  return makeMedia({
    origin,
    id: String(anime.id),
    url: `https://www.livechart.me/anime/${anime.id}`,
    handles: malHandle(anime),
    score: SCORE,
    categories: categoriesOf(type),
    type,
    titles: [
      ...anime.english_title ? [{ language: 'en', title: anime.english_title, score: SCORE }] : [],
      ...anime.romaji_title ? [{ language: 'jp-en', title: anime.romaji_title, score: SCORE }] : [],
      ...anime.native_title ? [{ language: 'jp', title: anime.native_title, score: SCORE }] : [],
    ],
    ...desc(anime.synopsis, SCORE),
    covers: img(anime.poster_image_large, SCORE),
    startDate: japanDay(anime),
    episodeCount: anime.episode_count ?? undefined,
    // a title nobody has rated is a literal 0, on 99 of fall 2026's 148
    averageScore: percentScore(anime.avg_rating, 10),
    // the list carries no season per title; the request asked for one and the filter above keeps
    // only the titles that began in it
    season: upperSeason(season),
    seasonYear: year,
  })
}

/**
 * One season, in ONE request. `limit=200` covers it (148 for fall 2026, 160 for summer) and paging is
 * no way round a longer one: `page=2` answered 2 items with `has_more` still true (2026-08-16). The
 * site's robots.txt asks for 5 seconds between requests. The relay caches each answer for an hour per
 * node, which holds one season to about one request an hour, but nothing paces requests ACROSS seasons:
 * a viewer stepping through years on the search page asks once per year, and the relay has no pacing
 * entry for www.livechart.me (its default is 50 a second).
 */
const getSeason = async (ctx: ExtractorServerContext, asked = animeSeasonOf()): Promise<GQLMedia[]> => {
  try {
    const response = await ctx.fetch(`https://www.livechart.me/api/v1/anime?season=${asked.season}&year=${asked.year}&limit=200`)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const { items, has_more } = await response.json() as { items?: LiveChartAnime[], has_more?: boolean }
    if (has_more) console.warn(`LiveChart ${asked.season} ${asked.year} has more than one request holds; the rest is left out`)
    return (items ?? []).filter(anime => premieredInSeason(anime, asked)).map(anime => normalizeAnime(anime, asked))
  } catch (error) {
    console.error(`LiveChart ${asked.season} ${asked.year} failed`, error)
    return []
  }
}

// No `media` answer: `/api/v1/anime/<id>` answered 204 with no body (2026-10-10), so a LiveChart
// record exists only as a row of a season list. No search either, though `?q=` works: this is a
// season source.
export const resolvers: Resolvers = {
  Subscription: {
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { status, season, seasonYear } }, ctx: ExtractorServerContext) {
        // both halves or nothing, and the clock's season only when neither is named, as kitsu does
        const spelling = season ? lowerSeason(season) : undefined
        if (spelling && seasonYear) return yield { mediaPage: { nodes: await getSeason(ctx, { season: spelling, year: seasonYear }) } }
        if (status === 'RELEASING' && !season && !seasonYear) return yield { mediaPage: { nodes: await getSeason(ctx) } }
        yield { mediaPage: { nodes: [] } }
      }
    }
  }
}
