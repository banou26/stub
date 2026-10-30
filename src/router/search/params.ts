// The search page's whole state, as a url and back. Pure so it can be tested: the page itself reaches
// wouter, and a codec nobody can pin is a codec that silently drops a filter the day a param is renamed.

import type { MessageDescriptor } from 'react-intl'

import { defineMessage, defineMessages } from 'react-intl'

import { MediaCategory, MediaSeason, MediaStatus, MediaType } from '../../generated/graphql'
import { intl } from '../../i18n'
import { JUSTWATCH_GENRES, genreKey } from '../../sources/justwatch/genres'
import { site, type Site } from '../../site'

import { isSceneCode } from '../../scene/search'

/**
 * Every axis the search page filters on.
 *
 * One type rather than a bag of props, because three places have to agree on it: the page that renders
 * the controls, the header search box that must not wipe the rest while rewriting `query`, and the
 * home page linking in with a season prefilled.
 *
 * Absent is spelled `null` for the single-valued axes and `[]` for the multi-valued ones, never
 * `undefined`, so a parsed url and a hand-built filter set compare equal.
 */
export type SearchFilters = {
  query: string
  category: MediaCategory | null
  status: MediaStatus | null
  season: MediaSeason | null
  year: number | null
  formats: MediaType[]
  genres: string[]
  tags: string[]
}

/**
 * The param names, in the order they are written.
 *
 * Repeated keys carry the multi-valued axes (`format=TV&format=MOVIE`) rather than a joined string:
 * a genre may contain a comma and a tag certainly can, so any separator would need escaping that
 * `URLSearchParams` already does for free.
 */
export const SEARCH_PARAMS = {
  query: 'q',
  category: 'category',
  status: 'status',
  season: 'season',
  year: 'year',
  format: 'format',
  genre: 'genre',
  tag: 'tag',
} as const

export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  query: '',
  category: null,
  status: null,
  season: null,
  year: null,
  formats: [],
  genres: [],
  tags: [],
}

/** One choice of a picker: its value in the url, and its label as a message, shown in the page's language. */
export type FilterChoice<T extends string> = { value: T, label: MessageDescriptor }

/** The formats the page offers, in the order the picker lists them. */
export const FORMAT_OPTIONS: readonly FilterChoice<MediaType>[] = [
  { value: MediaType.Tv, label: defineMessage({ id: 'TV Show', defaultMessage: 'TV Show' }) },
  { value: MediaType.Movie, label: defineMessage({ id: 'Movie', defaultMessage: 'Movie' }) },
  { value: MediaType.TvShort, label: defineMessage({ id: 'TV Short', defaultMessage: 'TV Short' }) },
  { value: MediaType.Special, label: defineMessage({ id: 'Special', defaultMessage: 'Special' }) },
  { value: MediaType.Ova, label: defineMessage({ id: 'OVA', defaultMessage: 'OVA' }) },
  { value: MediaType.Ona, label: defineMessage({ id: 'ONA', defaultMessage: 'ONA' }) },
]

/**
 * The statuses the page offers.
 *
 * All five, because all five can now be answered: AniList's mapping covered only NOT_YET_RELEASED,
 * RELEASING and FINISHED until CANCELLED and HIATUS were added alongside this page, so a picker
 * offering either would have matched nothing.
 */
export const STATUS_OPTIONS: readonly FilterChoice<MediaStatus>[] = [
  { value: MediaStatus.Releasing, label: defineMessage({ id: 'Airing#airing status', defaultMessage: 'Airing', description: 'airing status' }) },
  { value: MediaStatus.Finished, label: defineMessage({ id: 'Finished#airing status', defaultMessage: 'Finished', description: 'airing status' }) },
  { value: MediaStatus.NotYetReleased, label: defineMessage({ id: 'Not yet aired#airing status', defaultMessage: 'Not yet aired', description: 'airing status' }) },
  { value: MediaStatus.Cancelled, label: defineMessage({ id: 'Cancelled#airing status', defaultMessage: 'Cancelled', description: 'airing status' }) },
  { value: MediaStatus.Hiatus, label: defineMessage({ id: 'Hiatus#airing status', defaultMessage: 'Hiatus', description: 'airing status' }) },
]

/**
 * The seasons, each with the two headings it takes as a whole message (`Fall 2026`, `Fall seasons`), so a language
 * orders and inflects them its own way (`2026年秋`, `Herbstsaisons`).
 */
export const SEASON_OPTIONS: readonly (FilterChoice<MediaSeason> & { inYear: MessageDescriptor, everyYear: MessageDescriptor })[] = [
  {
    value: MediaSeason.Winter,
    label: defineMessage({ id: 'Winter#season of the year', defaultMessage: 'Winter', description: 'season of the year' }),
    inYear: defineMessage({ id: 'Winter {year}', defaultMessage: 'Winter {year}' }),
    everyYear: defineMessage({ id: 'Winter seasons', defaultMessage: 'Winter seasons' }),
  },
  {
    value: MediaSeason.Spring,
    label: defineMessage({ id: 'Spring#season of the year', defaultMessage: 'Spring', description: 'season of the year' }),
    inYear: defineMessage({ id: 'Spring {year}', defaultMessage: 'Spring {year}' }),
    everyYear: defineMessage({ id: 'Spring seasons', defaultMessage: 'Spring seasons' }),
  },
  {
    value: MediaSeason.Summer,
    label: defineMessage({ id: 'Summer#season of the year', defaultMessage: 'Summer', description: 'season of the year' }),
    inYear: defineMessage({ id: 'Summer {year}', defaultMessage: 'Summer {year}' }),
    everyYear: defineMessage({ id: 'Summer seasons', defaultMessage: 'Summer seasons' }),
  },
  {
    value: MediaSeason.Fall,
    label: defineMessage({ id: 'Fall#season of the year', defaultMessage: 'Fall', description: 'season of the year' }),
    inYear: defineMessage({ id: 'Fall {year}', defaultMessage: 'Fall {year}' }),
    everyYear: defineMessage({ id: 'Fall seasons', defaultMessage: 'Fall seasons' }),
  },
]

/** The categories stub.fkn.app filters by, in the words of home's category tabs and the header's sites. */
export const CATEGORY_OPTIONS: readonly FilterChoice<MediaCategory>[] = [
  { value: MediaCategory.Anime, label: defineMessage({ id: 'Anime#category', defaultMessage: 'Anime', description: 'category' }) },
  { value: MediaCategory.Series, label: defineMessage({ id: 'Series#category', defaultMessage: 'Series', description: 'category' }) },
  { value: MediaCategory.Movie, label: defineMessage({ id: 'Movies#category', defaultMessage: 'Movies', description: 'category' }) },
]

/**
 * AniList's genres, the ones it lists by.
 *
 * A fixed list rather than a facet over the current results, because the control has to be usable
 * BEFORE anything is loaded: on an empty search page the results are empty, and a facet would offer
 * nothing to filter by. It is short and stable (AniList has published these since the v2 API), where
 * tags number in the hundreds and change, which is why tags are offered as a facet instead.
 *
 * ONE genre is deliberately missing. AniList's list also carries "Hentai", and its own browse hides it
 * behind an adult toggle. stub has an `isAdult` column that NO source fills and NO view reads, so there
 * is nothing here to gate it with, and offering it would be offering a filter with no control beside it.
 */
const ANILIST_GENRES = [
  'Action', 'Adventure', 'Comedy', 'Drama', 'Ecchi', 'Fantasy', 'Horror', 'Mahou Shoujo', 'Mecha',
  'Music', 'Mystery', 'Psychological', 'Romance', 'Sci-Fi', 'Slice of Life', 'Sports', 'Supernatural',
  'Thriller',
]

const BOTH_GENRES = [...ANILIST_GENRES, ...Object.keys(JUSTWATCH_GENRES)]

/**
 * The genres each site offers, those a source it asks lists by: AniList's on anime.fkn.app, JustWatch's on
 * movies.fkn.app and series.fkn.app, which never ask AniList, and both on stub.fkn.app, a genre the two spell two ways
 * (`genreKey`) once by AniList's name. Any other genre a title carries, such as Jikan's "Award Winning", lists titles
 * only inside a season, where the search page offers it from the results.
 */
export const SITE_GENRES: Record<Site, readonly string[]> = {
  anime: ANILIST_GENRES,
  movie: Object.keys(JUSTWATCH_GENRES),
  series: Object.keys(JUSTWATCH_GENRES),
  stub: BOTH_GENRES.filter((genre, index) => BOTH_GENRES.findIndex(other => genreKey(other) === genreKey(genre)) === index),
}

// each genre of SITE_GENRES by its name in the url and in its sources' answers
const GENRE_LABELS: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  Action: { id: 'Action#genre', defaultMessage: 'Action', description: 'genre' },
  'Action & Adventure': { id: 'Action & Adventure#genre', defaultMessage: 'Action & Adventure', description: 'genre' },
  Adventure: { id: 'Adventure#genre', defaultMessage: 'Adventure', description: 'genre' },
  Animation: { id: 'Animation#genre', defaultMessage: 'Animation', description: 'genre' },
  Comedy: { id: 'Comedy#genre', defaultMessage: 'Comedy', description: 'genre' },
  Crime: { id: 'Crime#genre', defaultMessage: 'Crime', description: 'genre' },
  Documentary: { id: 'Documentary#genre', defaultMessage: 'Documentary', description: 'genre' },
  Drama: { id: 'Drama#genre', defaultMessage: 'Drama', description: 'genre' },
  Ecchi: { id: 'Ecchi#genre', defaultMessage: 'Ecchi', description: 'genre' },
  Fantasy: { id: 'Fantasy#genre', defaultMessage: 'Fantasy', description: 'genre' },
  History: { id: 'History#genre', defaultMessage: 'History', description: 'genre' },
  Horror: { id: 'Horror#genre', defaultMessage: 'Horror', description: 'genre' },
  'Kids & Family': { id: 'Kids & Family#genre', defaultMessage: 'Kids & Family', description: 'genre' },
  'Mahou Shoujo': { id: 'Mahou Shoujo#genre', defaultMessage: 'Mahou Shoujo', description: 'genre' },
  Mecha: { id: 'Mecha#genre', defaultMessage: 'Mecha', description: 'genre' },
  Music: { id: 'Music#genre', defaultMessage: 'Music', description: 'genre' },
  'Music & Musical': { id: 'Music & Musical#genre', defaultMessage: 'Music & Musical', description: 'genre' },
  Mystery: { id: 'Mystery#genre', defaultMessage: 'Mystery', description: 'genre' },
  'Mystery & Thriller': { id: 'Mystery & Thriller#genre', defaultMessage: 'Mystery & Thriller', description: 'genre' },
  Psychological: { id: 'Psychological#genre', defaultMessage: 'Psychological', description: 'genre' },
  'Reality TV': { id: 'Reality TV#genre', defaultMessage: 'Reality TV', description: 'genre' },
  Romance: { id: 'Romance#genre', defaultMessage: 'Romance', description: 'genre' },
  'Sci-Fi': { id: 'Sci-Fi#genre', defaultMessage: 'Sci-Fi', description: 'genre' },
  'Science-Fiction': { id: 'Science-Fiction#genre', defaultMessage: 'Science-Fiction', description: 'genre' },
  'Slice of Life': { id: 'Slice of Life#genre', defaultMessage: 'Slice of Life', description: 'genre' },
  Sport: { id: 'Sport#genre', defaultMessage: 'Sport', description: 'genre' },
  Sports: { id: 'Sports#genre', defaultMessage: 'Sports', description: 'genre' },
  Supernatural: { id: 'Supernatural#genre', defaultMessage: 'Supernatural', description: 'genre' },
  Thriller: { id: 'Thriller#genre', defaultMessage: 'Thriller', description: 'genre' },
  'War & Military': { id: 'War & Military#genre', defaultMessage: 'War & Military', description: 'genre' },
  Western: { id: 'Western#genre', defaultMessage: 'Western', description: 'genre' },
})

/** A genre in the page's language when a site offers it, else as its source writes it ("Award Winning"). */
export const genreLabel = (genre: string): string =>
  Object.hasOwn(GENRE_LABELS, genre) ? intl.formatMessage(GENRE_LABELS[genre]!) : genre

const memberOf = <T extends string>(values: readonly T[], raw: string | null): T | null =>
  values.find(value => value === raw) ?? null

const membersOf = <T extends string>(values: readonly T[], raw: string[]): T[] =>
  raw.map(entry => memberOf(values, entry)).filter((value): value is T => value !== null)

/**
 * A season name as the schema's enum, or nothing.
 *
 * The bridge between `MEDIA_SEASONS` in sources/season.ts, which is a plain string union the worker
 * and the extractors share, and the generated enum the GraphQL variables are typed against. Both
 * spell the four seasons identically; TypeScript simply does not consider a string literal a member
 * of a string enum, and this is the one place that gap is crossed.
 */
export const seasonValue = (name: string | null | undefined): MediaSeason | null =>
  SEASON_OPTIONS.map(option => option.value).find(value => value === name) ?? null

const FORMAT_VALUES = FORMAT_OPTIONS.map(option => option.value)
const STATUS_VALUES = STATUS_OPTIONS.map(option => option.value)
const SEASON_VALUES = SEASON_OPTIONS.map(option => option.value)
const CATEGORY_VALUES = CATEGORY_OPTIONS.map(option => option.value)

/**
 * A year a run could plausibly carry, or nothing.
 *
 * Bounded rather than merely numeric so a hand-edited url cannot put an unusable value into the
 * GraphQL variables, where it would fan out to every source. The lower bound is the first commercial
 * anime broadcast; the upper is generous enough for a work announced years ahead.
 */
export const YEAR_MIN = 1917
export const yearMax = (now = new Date()) => now.getFullYear() + 5

const parseYear = (raw: string | null, now = new Date()): number | null => {
  if (!raw || !/^\d{4}$/.test(raw)) return null
  const year = Number(raw)
  return year >= YEAR_MIN && year <= yearMax(now) ? year : null
}

/**
 * The filters a query string names, with everything unrecognised dropped.
 *
 * Takes the string WITHOUT its leading `?`, which is what wouter's `useSearch` returns. That is not
 * `location.search.slice(1)`: wouter applies `decodeURI` on the way out, so one extra decode happens
 * between what this module writes and what it reads back. Everything survives it except a literal
 * percent followed by two hex digits, which that decode consumes, so a search for `%41` reads back as
 * `A`. Left alone deliberately: double-encoding on the way out would make the written query string
 * correct only after wouter's decode, which is a worse trap than one mangled term. Pinned in
 * tests/unit/router/search-params.test.ts.
 *
 * Never throws:
 * a url is user input and a malformed one has to render an empty search page rather than a blank
 * screen, so an unknown enum value, a non-numeric year and a repeated single-valued key all resolve to
 * the same thing as absence.
 */
export const parseSearchFilters = (search: string, now = new Date(), current: Site = site): SearchFilters => {
  const params = new URLSearchParams(search)
  // a genre as the site spells it, so an old stub.fkn.app link's `genre=Sport` reads as its Sports
  const siteGenre = (genre: string) => SITE_GENRES[current].find(own => genreKey(own) === genreKey(genre.trim())) ?? genre
  return {
    query: (params.get(SEARCH_PARAMS.query) ?? '').trim(),
    category: memberOf(CATEGORY_VALUES, params.get(SEARCH_PARAMS.category)),
    status: memberOf(STATUS_VALUES, params.get(SEARCH_PARAMS.status)),
    season: memberOf(SEASON_VALUES, params.get(SEARCH_PARAMS.season)),
    year: parseYear(params.get(SEARCH_PARAMS.year), now),
    formats: membersOf(FORMAT_VALUES, params.getAll(SEARCH_PARAMS.format)),
    genres: dedupeLabels(params.getAll(SEARCH_PARAMS.genre).map(siteGenre)),
    tags: dedupeLabels(params.getAll(SEARCH_PARAMS.tag)),
  }
}

// A url can repeat a label, and the page renders one chip per entry, so a duplicate would render twice
// and take two clicks to clear. Case-insensitive to match how the store compares them.
const dedupeLabels = (labels: string[]): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    const label = raw.trim()
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/** The query string for a filter set, without its leading `?`. Empty when nothing is filtered. */
export const searchFiltersQuery = (filters: Partial<SearchFilters>): string => {
  const params = new URLSearchParams()
  const query = filters.query?.trim()
  if (query) params.set(SEARCH_PARAMS.query, query)
  if (filters.category) params.set(SEARCH_PARAMS.category, filters.category)
  if (filters.status) params.set(SEARCH_PARAMS.status, filters.status)
  if (filters.season) params.set(SEARCH_PARAMS.season, filters.season)
  if (filters.year) params.set(SEARCH_PARAMS.year, String(filters.year))
  for (const format of filters.formats ?? []) params.append(SEARCH_PARAMS.format, format)
  for (const genre of filters.genres ?? []) params.append(SEARCH_PARAMS.genre, genre)
  for (const tag of filters.tags ?? []) params.append(SEARCH_PARAMS.tag, tag)
  return params.toString()
}

/**
 * A search term out of the OLD `/search/<term>` path segment.
 *
 * wouter has already run the path through `decodeURI` by the time it reaches `useParams`, so a term
 * the previous build encoded can arrive as a bare `%`, and `decodeURIComponent` throws `URIError` on
 * that. Nothing in the router tree is an error boundary, so an old bookmark rendered a blank app. It
 * lives here rather than beside the route because router/index.tsx reaches preact and cannot be
 * imported under vitest, and a redirect that can crash the app is not something to leave unpinned.
 */
export const legacySearchTerm = (query: string | undefined): string => {
  if (!query) return ''
  try { return decodeURIComponent(query) } catch { return query }
}

/**
 * The href for a filter set.
 *
 * Lives here rather than in ../path.ts on purpose: that module is imported by the WORKER (through
 * store/aggregate.ts, which builds a media's canonical url) and is deliberately dependency-free, while
 * this one reaches the generated enums.
 */
export const searchPath = (filters: Partial<SearchFilters> = {}): string => {
  const query = searchFiltersQuery(filters)
  return query ? `/search?${query}` : '/search'
}

// the url key of a scene search: the picture's color code (src/scene/code.ts), never the picture
const SCENE_PARAM = 'scene'

/** The href of a scene search for a color code. */
export const scenePath = (code: string): string => `/search?${SCENE_PARAM}=${code}`

/** The color code a query string asks a scene search for, or nothing. Takes it without its `?`. */
export const sceneOf = (search: string): string | undefined => {
  const code = new URLSearchParams(search).get(SCENE_PARAM)
  return isSceneCode(code) ? code : undefined
}

/**
 * What the page is showing, as a heading.
 *
 * Not merely decoration: the first control is itself labelled "Search", so a page headed "Search" says
 * the same word twice and names nothing. A season browse arrives here from the home page with no text
 * at all, and what the reader wants to see confirmed is the season.
 */
export const searchHeading = (filters: SearchFilters): string => {
  if (filters.query) return intl.formatMessage({ id: 'Results for “{query}”', defaultMessage: 'Results for “{query}”' }, { query: filters.query })
  const season = SEASON_OPTIONS.find(option => option.value === filters.season)
  if (season && filters.year) return intl.formatMessage(season.inYear, { year: filters.year })
  if (season) return intl.formatMessage(season.everyYear)
  if (filters.year) return String(filters.year)
  return hasSearchFilters(filters)
    ? intl.formatMessage({ id: 'Browsing', defaultMessage: 'Browsing' })
    : intl.formatMessage({ id: 'Search', defaultMessage: 'Search' })
}

/** The label of a picker's choice `value`, in the page's language, or nothing when it offers no such choice. */
export const choiceLabel = <T extends string>(options: readonly FilterChoice<T>[], value: T | null | undefined): string | undefined => {
  const label = options.find(option => option.value === value)?.label
  return label && intl.formatMessage(label)
}

/** A format as the picker labels it ("TV Show"), or nothing for a media whose format no source named. */
export const formatLabel = (type: MediaType | null | undefined): string | undefined => choiceLabel(FORMAT_OPTIONS, type)

/** A release status as the picker labels it ("Airing"). */
export const statusLabel = (status: MediaStatus | null | undefined): string | undefined => choiceLabel(STATUS_OPTIONS, status)

/**
 * A broadcast window as one label ("Fall 2026"), from whichever half is known.
 *
 * A year with no season is still worth showing, and a season with no year is not: "Fall" alone names
 * a window in every year at once, which is worse than saying nothing.
 */
export const seasonLabel = (season: MediaSeason | null | undefined, year: number | null | undefined): string | undefined => {
  const option = SEASON_OPTIONS.find(entry => entry.value === season)
  if (option && year) return intl.formatMessage(option.inYear, { year })
  return year ? String(year) : undefined
}

/** Whether anything is filtered at all. Nothing set means the page asks nothing and shows a prompt. */
export const hasSearchFilters = (filters: SearchFilters): boolean =>
  Boolean(
    filters.query || filters.category || filters.status || filters.season || filters.year
    || filters.formats.length || filters.genres.length || filters.tags.length
  )

/**
 * Whether anything here is a QUESTION a source can answer, as opposed to a refinement of one.
 *
 * `category` is the only axis that is purely a refinement: no source reads it, and the worker applies
 * it locally over whatever the other axes fetched. A page holding nothing else has therefore asked
 * nobody anything, and settling on "No results found" would blame the filter for a request that was
 * never made. The page says "pick something to browse" instead.
 *
 * It still counts as a filter for `hasSearchFilters`, so its chip renders and clearing the last other
 * filter does not make the whole page vanish underneath it.
 */
export const namesAQuery = (filters: SearchFilters): boolean =>
  Boolean(
    filters.query || filters.status || filters.season || filters.year
    || filters.formats.length || filters.genres.length || filters.tags.length
  )
