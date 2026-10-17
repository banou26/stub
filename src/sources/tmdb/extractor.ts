import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode } from '../../generated/schema/types.generated'

import { extractAggregatedUriOrigin, isAggregatedUri, isUri, originsOfUri, toUri } from '../../utils/uri'
import { makeMedia, makeEpisode, desc, img, getFirstTitle, waitForMedia, declaredEpisodeCount } from '../utils'
import { parseSeasonNumber, pickSeasonByEpisodeCount, seasonScopedId, splitSeasonScopedId } from '../season'
import { percentScore } from '../average-score'
import { decodeEntities as decode } from '../entities'
import { charactersByName, type SourceCredits } from '../credits'

// TMDB (themoviedb.org) - the public API needs a licensed key, so instead we read TMDB's own server-rendered frontend pages through the FKN proxy, whose curl-impersonate gets past their WAF, same approach as the CR/NF sources.

const SCORE = 0.3
const BASE = 'https://www.themoviedb.org'

export const icon = 'https://www.themoviedb.org/favicon.ico'
export const originUrl = 'https://www.themoviedb.org'
export const categories = ['SERIES'] as const
export const name = 'TMDB'
export const origin = 'tmdb'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['tmdb']
export const color = '#01b4e4'

const fetchHtml = (path: string, ctx: ExtractorServerContext): Promise<string | undefined> =>
  ctx.fetch(`${BASE}${path}`).then(r => r.text()).catch(() => undefined)

const meta = (html: string, property: string): string | undefined =>
  html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1]

type TmdbSeason = { seasonNumber: number, episodeCount: number }
type TmdbMedia = { id: string, title: string, overview?: string, poster?: string, banner?: string, score?: number, year?: number, anime?: boolean, seasons?: TmdbSeason[] }
/** `releaseDate` is `YYYY-MM-DD`, the day the card named, or absent when the card named none. */
type TmdbEpisode = { number: number, title?: string, overview?: string, still?: string, releaseDate?: string }

// The month names TMDB writes, ENGLISH, and English only because every page this source fetches
// carries `language=en-US`. Asked in another language the same span comes back as "10 juillet 2023"
// and this table refuses it, which is the intended answer: the parse is coupled to the query
// parameter above, so the two must be changed together.
const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
]

/**
 * The day an episode card names, as `YYYY-MM-DD`, or undefined when it names none this can read.
 *
 * TMDB dates a card in a LOCALIZED LONG FORM and SPACE PADS the day to two columns, so the season
 * page carries both `July 10, 2023` and `August  7, 2023` with two spaces (measured 2026-09-12 on
 * /tv/94664/season/2: 24 cards, all dated, 8 of them padded). Any separating whitespace is therefore
 * accepted, and nothing else is.
 *
 * IT REFUSES RATHER THAN GUESSES, which is why `new Date(text)` is not used even though V8 happens to
 * parse this shape: that reads the string in the RUNTIME's zone, so the day it returns is not the day
 * the page named anywhere west of Greenwich, and it accepts enough near-misses (a day of 31 in a 30
 * day month, a month name it half-recognises) to turn an unreadable card into a confident wrong date.
 * A day is emitted as a DAY, never widened to an instant, for the reason ../../utils/release-date.ts
 * records.
 */
const parseCardDate = (text: string | undefined): string | undefined => {
  const match = text ? /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(text.trim()) : undefined
  if (!match) return undefined
  const month = MONTHS.indexOf(match[1]!.toLowerCase())
  if (month < 0) return undefined
  const day = Number(match[2])
  const year = Number(match[3])
  // a real calendar day, so `February 30, 2023` is refused rather than emitted as `2023-02-30`
  const at = new Date(Date.UTC(year, month, day))
  if (at.getUTCMonth() !== month || at.getUTCDate() !== day) return undefined
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const parseSearchYear = (html: string, id: string): number | undefined => {
  const span = html.match(new RegExp(`href="/tv/${id}(?![0-9])[^"]*"><h2[\\s\\S]{0,400}?class="release_date[^"]*">([^<]*)<`))?.[1]
  const year = span?.match(/\b(?:19|20)\d{2}\b/)?.[0]
  return year ? Number(year) : undefined
}

const parseSearch = (html: string): TmdbMedia[] => {
  const out: TmdbMedia[] = []
  const seen = new Set<string>()
  const re = /data-media-type="tv"[\s\S]{0,200}?href="\/tv\/(\d+)[^"]*"[\s\S]{0,400}?<img\s+alt="([^"]*)"(?:[\s\S]{0,300}?(?:src|data-src)="(https:\/\/[^"]+)")?/g
  for (const m of html.matchAll(re)) {
    const id = m[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, title: decode(m[2] ?? ''), poster: m[3], year: parseSearchYear(html, id) })
  }
  return out
}

// the language is named in English for the same reason the MONTHS are
const isAnime = (html: string) =>
  html.includes('/keyword/210024-anime/')
  || (html.includes('/genre/16-animation/') && /Original Language<\/bdi><\/strong> (?:Japanese|Chinese|Korean)</.test(html))

// The show page links only its latest season, so the list is read off `/tv/<id>/seasons`. A show with
// an English title links under a slug (`/tv/1396-breaking-bad/season/5`), and season 0 is the specials.
// Each card names its episode count after its season's link (`2021 • 9 Episodes` on /tv/93405/seasons,
// 2026-10-12), which places a run by its count without fetching every season's page. A card naming
// none counts 0, which no run's count matches.
const parseSeasons = (html: string, id: string): TmdbSeason[] => {
  const counts = new Map<number, number>()
  for (const [, number, card] of html.matchAll(new RegExp(`/tv/${id}(?:-[^/"]*)?/season/(\\d+)((?:(?!/tv/${id})[\\s\\S])*)`, 'g'))) {
    const count = Number(card!.match(/(\d+) Episodes?\b/)?.[1] ?? 0)
    counts.set(Number(number), Math.max(count, counts.get(Number(number)) ?? 0))
  }
  return [...counts]
    .filter(([seasonNumber]) => seasonNumber > 0)
    .sort(([a], [b]) => a - b)
    .map(([seasonNumber, episodeCount]) => ({ seasonNumber, episodeCount }))
}

const fetchSeasons = (id: string, ctx: ExtractorServerContext): Promise<TmdbSeason[]> =>
  fetchHtml(`/tv/${id}/seasons?language=en-US`, ctx).then(html => html ? parseSeasons(html, id) : [])

const parseShow = (html: string, id: string): TmdbMedia => {
  const backdrop = html.match(/\/t\/p\/w1920[^"']+\.(?:jpg|png)/)?.[0]
  const percent = html.match(/class="user_score_chart"[^>]*data-percent="([\d.]+)"/)?.[1]
  return {
    id,
    title: decode(meta(html, 'og:title') ?? ''),
    overview: decode(meta(html, 'og:description') ?? '') || undefined,
    poster: meta(html, 'og:image'),
    banner: backdrop ? `https://media.themoviedb.org${backdrop}` : undefined,
    score: percent ? Math.round(Number(percent)) / 10 : undefined,
    anime: isAnime(html),
  }
}

const parseSeason = (html: string): TmdbEpisode[] => {
  const out: TmdbEpisode[] = []
  for (const card of html.split('<div class="card')) {
    const num = card.match(/data-episode-number="(\d+)"/)?.[1]
    if (!num) continue
    const title = card.match(/<h3><a[^>]*>([^<]+)<\/a><\/h3>/)?.[1] ?? card.match(/<img[^>]*\balt="([^"]*)"/)?.[1]
    const overview = card.match(/class="overview"[^>]*>\s*<p>([\s\S]*?)<\/p>/)?.[1]
    out.push({
      number: Number(num),
      title: title ? decode(title) : undefined,
      overview: overview ? decode(overview.replace(/<[^>]+>/g, '')).trim() : undefined,
      still: card.match(/src="(https:\/\/media\.themoviedb\.org\/t\/p\/[^"]+)"/)?.[1],
      // the air date, which sits in the card this already downloaded and was skipped until 2026-09-12
      releaseDate: parseCardDate(card.match(/<span class="date">([^<]*)<\/span>/)?.[1]),
    })
  }
  return out
}

/**
 * The cast page as `mergeCredits` reads it: the first 25 actors (Breaking Bad's page lists 348), each
 * under the first part named. The crew is not read: it lists every one-off director, A to Z, and
 * IMDb's credits already carry the principal ones.
 */
export const parseCredits = (html: string): SourceCredits => {
  const cast = html.split(/<h[34]>/).find(section => section.startsWith('Series Cast')) ?? ''
  return {
    characters: charactersByName(cast.split('<li').slice(1, 26).flatMap(item => {
      const [, id, slug, name] = item.match(/<p><a href="\/person\/(\d+)([^"?]*)[^"]*">([^<]+)<\/a><\/p>/) ?? []
      const part = item.match(/<p class="character">\s*<a[^>]*>([^<]+)<\/a>/)?.[1]
      if (!id || !name || !part) return []
      const image = item.match(/(https:\/\/media\.themoviedb\.org\/t\/p\/w132_and_h132_face\/\S+) 2x/)?.[1]
      return [{ name: decode(part), language: null, person: { id: `${origin}:${id}`, name: decode(name), image, url: `${BASE}/person/${id}${slug}` } }]
    })),
    staff: [],
  }
}

// TMDB describes a SHOW - '94664' is Mushoku Tensei with three seasons hanging off it - while a stub
// media is one season. So a season-scoped media cannot be identified by the show id alone: every
// season handing back `tmdb:94664` union-finds them into a single media, which is what merged all
// three seasons of Mushoku Tensei even after JustWatch stopped doing the same thing.
//
// '-s<n>' is the suffix TMDB's own episode ids already use ('94664-s3e1'), so the two stay one id
// space. The bare show id is still minted for SEARCH results, and for a show page with no season to
// pick, scoped CONTAINER so the store keeps it out of every run's identity space. The season list is
// left off anime, whose runs are split by cour where TMDB folds them into one season.
const normalizeMedia = (m: TmdbMedia, seasonNumber?: number): GQLMedia =>
  makeMedia({
    origin,
    id: seasonNumber == null ? m.id : seasonScopedId(m.id, seasonNumber),
    scope: seasonNumber == null ? 'CONTAINER' : 'RUN',
    url: `${BASE}/tv/${m.id}`,
    seasons: m.anime ? undefined : m.seasons?.map(({ seasonNumber: number }) => ({ number, uri: toUri({ origin, id: seasonScopedId(m.id, number) }) })),
    categories: m.anime ? ['ANIME', 'SERIES'] : ['SERIES'],
    score: SCORE,
    titles: [{ language: 'en', title: m.title, score: SCORE }],
    ...desc(m.overview, SCORE),
    covers: img(m.poster, SCORE),
    banners: img(m.banner, SCORE),
    averageScore: percentScore(m.score, 10),
    // Only the SHOW-level media may carry the show's year. A season-scoped one must not: TMDB's search
    // page yields one year for the whole series, so stamping it on season 3 puts season 1's year into
    // that cluster's `years` set, and fuzzyMergeMediaClusters buckets by year, so the two seasons meet
    // in one bucket where a shared title welds them. Same defect as tvmaze/extractor.ts. A season is
    // dated by its own first episode instead, in getMedia.
    startDate: seasonNumber == null && m.year ? String(m.year) : undefined,
  })

const normalizeEpisode = (episode: TmdbEpisode, season: number, tvId: string, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: `${tvId}-s${season}e${episode.number}`,
    mediaUri,
    score: SCORE,
    titles: episode.title ? [{ language: 'en', title: episode.title, score: SCORE }] : [],
    ...desc(episode.overview, SCORE),
    thumbnails: img(episode.still, SCORE),
    seasonNumber: season,
    episodeNumber: episode.number,
    // The day the card named, and the reason it is worth more here than the position it sits at: TMDB
    // packages anime the way Netflix and JustWatch do, folding two cours into one season (season 2 of
    // 94664 is 24 episodes, 1 to 12 across July to September 2023 and 13 to 24 across April to July
    // 2024), so a stub run that IS the second cour numbers its episodes 1 to 12 against TMDB's 13 to
    // 24. The date is what pairs those rows through `plugin:range`; the number cannot.
    releaseDate: episode.releaseDate,
  })

/**
 * Which season of this show the caller is asking about, or `'show'` when the caller is the show's own
 * card: an address naming TMDB alone, or a show no other source has split into runs.
 *
 * The title first, then the run's episode count against the counts the season list names.
 */
const resolveSeasonNumber = async (uri: string, seasons: TmdbSeason[], ctx: ExtractorServerContext): Promise<number | 'show' | undefined> => {
  if (seasons.length === 1) return seasons[0]!.seasonNumber
  if (!seasons.length) return undefined
  if (originsOfUri(uri).every(other => other === origin)) return 'show'
  // A show's card from search is a CONTAINER until another source answers its first run, and the page
  // then follows to that run: answering the show there leaves the run with no TMDB season in it, so a
  // container is waited past, and answered as the show only when the last view is still one.
  let container = false
  // The probe has to stay SYNCHRONOUS. waitForMedia keeps the first result it finds truthy, and a
  // promise is always truthy - an async probe would make the very first look succeed with a promise
  // that then resolves to undefined, and the waiting this exists for would never happen. So the wait
  // collects the hints.
  const hint = await waitForMedia(uri, ctx, (media: any): { season?: number, count?: number } | undefined => {
    container = media?.scope === 'CONTAINER'
    if (container) return undefined
    const title = getFirstTitle(media)
    const season = title ? parseSeasonNumber(title) : undefined
    const count = declaredEpisodeCount(media)
    return season != null || count ? { season, count } : undefined
  })
  if (!hint) return container ? 'show' : undefined
  if (hint.season != null) return hint.season
  if (!hint.count) return undefined
  return pickSeasonByEpisodeCount(seasons, hint.count)
}

const fetchEpisodes = (id: string, season: number, mediaUri: string, ctx: ExtractorServerContext): Promise<GQLEpisode[]> =>
  fetchHtml(`/tv/${id}/season/${season}?language=en-US`, ctx)
    .then(html => html ? parseSeason(html).map(episode => normalizeEpisode(episode, season, id, mediaUri)) : [])

const getMedia = async (uri: string, id: string, pinned: number | undefined, ctx: ExtractorServerContext, details?: boolean | null): Promise<GQLMedia | undefined> => {
  const [html, seasons] = await Promise.all([fetchHtml(`/tv/${id}?language=en-US`, ctx), fetchSeasons(id, ctx)])
  if (!html) return undefined
  const show = { ...parseShow(html, id), seasons }
  if (!show.title) return undefined

  const seasonNumber = pinned ?? await resolveSeasonNumber(uri, show.seasons, ctx)
  // A series whose season cannot be determined has no identity here: the show id is shared by every
  // season of it, and emitting it is what merges them. See normalizeMedia.
  if (seasonNumber == null && show.seasons.length > 1) return undefined

  // the title page's alone, and not an anime's: its cast names no language, so mergeCredits leaves it out
  const cast = details && !show.anime ? fetchHtml(`/tv/${id}/cast?language=en-US`, ctx) : undefined
  // a later answer replaces TMDB's credits, so a page that parses to no cast (an error page) adds none
  const withCredits = async (media: GQLMedia) => {
    const page = await cast
    const credits = page ? parseCredits(page) : undefined
    return credits?.characters.length ? Object.assign(media, { credits }) : media
  }

  // The show's own card is answered as the show, with its season list and no episodes. A season must
  // not name the show PART_OF instead: with two seasons stored, the store hides the show everywhere.
  if (seasonNumber === 'show') return withCredits(normalizeMedia(show))

  const media = normalizeMedia(show, seasonNumber)
  media.episodes = seasonNumber == null ? [] : await fetchEpisodes(id, seasonNumber, media.uri, ctx)
  media.episodeCount = media.episodes.length
  // Undated, a season meets no other catalogue's run of it in plugin:title and stays a cluster of its
  // own, so a show's page never carried its seasons. Anime stays undated: TMDB folds its cours into one
  // season, so a season's first day is not a run's. The trade is the gap TVmaze's seasons already have:
  // two seasons within 45 days, or in one year with a premiere on the 1st, weld
  // (tests/unit/worker/graph/show-seasons-weld.test.ts).
  if (seasonNumber != null && !show.anime) media.startDate = media.episodes[0]?.releaseDate
  return withCredits(media)
}

const searchApi = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const html = await fetchHtml(`/search/tv?query=${encodeURIComponent(query)}&language=en-US`, ctx)
  // spelled out so map's index never lands in seasonNumber: it minted the first row as '<id>-s0'
  return html ? parseSearch(html).map(m => normalizeMedia(m)) : []
}

export const resolvers: Resolvers = {
  Subscription: {
    media: {
      subscribe: async function* (_, { input: { uri, details } }, ctx: ExtractorServerContext) {
        if (!uri || !(isUri(uri) || isAggregatedUri(uri))) return yield { media: null }
        const tmdbUri = extractAggregatedUriOrigin(uri, origin)
        if (!tmdbUri) return yield { media: null }
        // the uri may already pin the season, since that is now part of the id
        const { showId, seasonNumber } = splitSeasonScopedId(tmdbUri.id)
        // a film's link (`tmdbLink`): this source reads shows only, and alone in an address the id
        // would be fetched as a show's card
        if (showId.startsWith('movie-')) return yield { media: null }
        yield { media: (await getMedia(uri, showId, seasonNumber, ctx, details)) ?? null }
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
      // parent.id is '<show>-s<season>' now, so the show has to be split back out of it. The bare show
      // id gets none: every season of it is its own run.
      const { showId, seasonNumber } = splitSeasonScopedId(parent.id)
      return seasonNumber == null ? [] : fetchEpisodes(showId, seasonNumber, parent.uri, ctx)
    }
  }
}
