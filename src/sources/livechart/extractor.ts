import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, MediaCategory } from '../../generated/schema/types.generated'

import { MediaType } from '../../generated/graphql'
import { makeMedia, desc, img } from '../utils'
import { decodeEntities } from '../entities'
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

/** One card of a season page. */
export type LiveChartAnime = {
  id: number
  type?: MediaType
  romaji_title?: string | null
  english_title?: string | null
  native_title?: string | null
  synopsis?: string | null
  premiere_date?: string | null
  premiere_date_precision?: number | null
  episode_count?: number | null
  avg_rating?: number | string | null
  poster_image_large?: string | null
  mal_url?: string | null
  anilist_url?: string | null
}

/**
 * The season page's tabs, which between them hold every card of its All tab, and the format each one names: a card
 * carries no type of its own. Measured 2026-11-09 on fall 2026 against the bundled catalogue's type for the same
 * MyAnimeList id: TV is a TV series for 81 of the 84 it places, Movies a film for 13 of 14. OVAs holds every other
 * format, ONAs beside OVAs and specials, the old list's types 3 to 5, whose mix put a film on the Series tab. So it
 * claims no type and no format and leaves both to the other members.
 */
const TABS: Record<string, MediaType | undefined> = {
  tv: MediaType.Tv,
  movies: MediaType.Movie,
  ovas: undefined,
}

const categoriesOf = (type: MediaType | undefined): MediaCategory[] =>
  type === undefined ? ['ANIME'] : type === MediaType.Movie ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES']

/**
 * The ONE handle a row mints: its MyAnimeList id, or its AniList id on a card with no MyAnimeList link, read off the
 * only shape LiveChart links (`myanimelist.net/anime/<id>`, `anilist.co/anime/<id>`, numeric, or nothing).
 *
 * Never both, nor its Kitsu or AniDB link as well, though it carries them. A row naming two catalogues
 * unions their runs for good, and on some entries LiveChart's own links disagree about which part they
 * name: on 2026-10-10 its `Girls und Panzer das Finale` Part 5 entry linked Part 5 on MyAnimeList and
 * Part 1 on Kitsu, Kitsu answered for that id with Part 1's MyAnimeList id, and the season walk welded
 * the two parts. One id cannot join two runs. Nothing is lost by it: AniList, Kitsu, AniZip and the
 * bundled index already link MyAnimeList ids to the other three.
 *
 * The AniList link stands in only where MyAnimeList's is missing, so `Sekiro: No Defeat` (winter 2027, AniList only)
 * joins AniList's row rather than showing as a second card. Measured 2026-11-10 on fall 2026 and winter 2027: of the
 * 160 kept rows, 10 link no MyAnimeList entry and 2 of those an AniList one; all 140 AniList links name their card's
 * work, and AniList's own MyAnimeList id matches LiveChart's on all 134 rows where both are known.
 */
const catalogueHandle = (anime: LiveChartAnime): GQLMedia[] => {
  const mal = /^https?:\/\/myanimelist\.net\/anime\/(\d+)$/.exec(anime.mal_url ?? '')?.[1]
  if (mal) return [makeMedia({ origin: 'mal', id: mal, url: `https://myanimelist.net/anime/${mal}` })]
  const anilist = /^https?:\/\/anilist\.co\/anime\/(\d+)$/.exec(anime.anilist_url ?? '')?.[1]
  return anilist ? [makeMedia({ origin: 'anilist', id: anilist, url: `https://anilist.co/anime/${anilist}` })] : []
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
 * A season page lists the runs still airing in it too, back to Sazae-san (1969): on 2026-11-09 fall 2026's held 45 of
 * 156 that print "Began <an earlier season>" where a new title prints its premiere, and those have no date here. The
 * cut is the season's first day in Japan, which also drops the September premieres it lists (12 that day, leaving 99):
 * read in UTC it would drop the shows that premiere just after midnight on that day.
 */
export const premieredInSeason = (anime: LiveChartAnime, { season, year }: { season: AnimeSeason, year: number }) =>
  Date.parse(anime.premiere_date ?? '') >= Date.UTC(year, ANIME_SEASONS.indexOf(season) * 3, 1) - JST_MS

export const normalizeAnime = (anime: LiveChartAnime, { season, year }: { season: AnimeSeason, year: number }): GQLMedia =>
  makeMedia({
    origin,
    id: String(anime.id),
    url: `https://www.livechart.me/anime/${anime.id}`,
    handles: catalogueHandle(anime),
    score: SCORE,
    categories: categoriesOf(anime.type),
    type: anime.type,
    titles: [
      ...anime.english_title ? [{ language: 'en', title: anime.english_title, score: SCORE }] : [],
      ...anime.romaji_title ? [{ language: 'jp-en', title: anime.romaji_title, score: SCORE }] : [],
      ...anime.native_title ? [{ language: 'jp', title: anime.native_title, score: SCORE }] : [],
    ],
    ...desc(anime.synopsis, SCORE),
    covers: img(anime.poster_image_large, SCORE),
    startDate: japanDay(anime),
    episodeCount: anime.episode_count ?? undefined,
    averageScore: percentScore(anime.avg_rating, 10),
    // a card carries no season of its own; the page is one, and the filter above keeps only the titles that began in it
    season: upperSeason(season),
    seasonYear: year,
  })

const attribute = (card: string, name: string) => {
  const value = new RegExp(` data-anime-item-${name}="([^"]*)"`).exec(card)?.[1]
  return value ? decodeEntities(value) : undefined
}

// An editor's note ("※ NOTE: Split 2 cour") is a `<div>` above the paragraphs, as is the line an entry with no
// synopsis prints, and the "[Source: ...]" credit is a `<p>` with a class.
const synopsisOf = (card: string) => {
  const body = /data-anime-item-target="synopsis">([\s\S]*?)<div class="lc-anime-details-card__footer/.exec(card)?.[1] ?? ''
  const paragraphs = [...body.replace(/<div\b[\s\S]*?<\/div>/g, '').matchAll(/<p>([\s\S]*?)<\/p>/g)].map(([, paragraph]) => decodeEntities(paragraph!.replace(/<[^>]*>/g, '')).trim())
  return paragraphs.filter(Boolean).join('\n\n') || undefined
}

/**
 * Every card of one season page tab, as `https://www.livechart.me/fall-2026/tv` answered on 2026-11-09.
 *
 * Read by pattern, as the other page sources are, and attribute values hold a raw `>` (`data-action="click->..."`, a
 * title with `<ITEM>` in it), so every pattern keys on an attribute name, never on a tag's end. A run carried over from
 * an earlier season prints "Began <season>" where a premiere goes, and its `data-anime-item-premiere-value` is then its
 * first episode of THIS season, so only a card that prints its premiere as a `<time>` keeps a date.
 */
export const parseSeasonPage = (html: string, type?: MediaType): LiveChartAnime[] =>
  html.split('<article ').slice(1).flatMap(part => {
    const card = part.split('</article>')[0]!
    const id = Number(attribute(card, 'id'))
    if (!Number.isSafeInteger(id) || id <= 0) return []
    const premiere = /class="lc-anime-details-card__premiere[^"]*"><time\b/.test(card) ? Number(attribute(card, 'premiere-value')) : NaN
    return [{
      id,
      type,
      romaji_title: attribute(card, 'romanized-native-title'),
      english_title: attribute(card, 'english-title'),
      native_title: attribute(card, 'native-title'),
      synopsis: synopsisOf(card),
      premiere_date: premiere > 0 ? new Date(premiere * 1000).toISOString() : undefined,
      premiere_date_precision: Number(attribute(card, 'premiere-precision')) || undefined,
      episode_count: Number(/>(\d+) eps?\b/.exec(card)?.[1]) || undefined,
      avg_rating: /title="([\d.]+) out of 10\b/.exec(card)?.[1],
      poster_image_large: /\s(https:\/\/u\.livechart\.me\/\S+\/large\.jpg) 2x"/.exec(card)?.[1],
      mal_url: /<a href="([^"]*)"[^>]*\bclass="mal logo\b/.exec(card)?.[1],
      anilist_url: /<a href="([^"]*)"[^>]*\bclass="anilist logo\b/.exec(card)?.[1],
    }]
  })

/**
 * One season, as the cards of its three tabs. LiveChart offers no public API, and its page answers with no
 * allow-origin, so it goes through the relay. robots.txt allows these paths when they carry no query string, and asks
 * for 5 seconds between requests, yet the three are asked at once, since spacing them would hold LiveChart's rows back
 * 10 seconds on every view, cached or not. The All tab (`/fall-2026/all`) holds the same cards in one request, but
 * nothing on it says which format a card is.
 */
const getSeason = async (ctx: ExtractorServerContext, asked = animeSeasonOf()): Promise<GQLMedia[]> => {
  const tabs = await Promise.all(Object.entries(TABS).map(async ([tab, type]) => {
    try {
      const response = await ctx.fetch(`https://www.livechart.me/${asked.season}-${asked.year}/${tab}`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return parseSeasonPage(await response.text(), type)
    } catch (error) {
      console.error(`LiveChart ${asked.season} ${asked.year} ${tab} failed`, error)
      return []
    }
  }))
  return tabs.flat().filter(anime => premieredInSeason(anime, asked)).map(anime => normalizeAnime(anime, asked))
}

// No `media` answer and no search: a LiveChart record exists only as a card of a season page.
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
