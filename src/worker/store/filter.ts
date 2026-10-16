// The `mediaPage` filters and sorts that can be decided from an aggregated row, kept out of
// ../resolvers/media/index.ts so they can be tested. That module reaches urql and dies under vitest
// with a CommonJS `require('react')`, which is the same reason `sameAsHandleUris` lives in
// ./aggregate.ts and `normalizeToStoreMedia` in ./normalize.ts. A filter nothing can pin is a filter
// nobody can prove empties a page, and a sort nothing can pin spent a year pointing the wrong way.

import type { Media as GQLMedia } from '../../generated/schema/types.generated'

import { site, siteAllows, type Site } from '../../site'

/**
 * The subset of `MediaPageInput` decided here, as plain data.
 *
 * `search` is absent on purpose: it is scored with a wasm-backed similarity pass and is therefore
 * async, and folding it in would make every caller await a predicate that is otherwise pure.
 *
 * `status` is absent for a different and more important reason. See `applyMediaFilters`.
 */
export type MediaPageFilters = {
  categories?: readonly string[] | null
  formats?: readonly string[] | null
  status?: string | null
  season?: string | null
  seasonYear?: number | null
  genres?: readonly string[] | null
  tags?: readonly string[] | null
}

const labelSet = (labels: readonly string[] | null | undefined): Set<string> =>
  new Set((labels ?? []).map(label => label.toLowerCase()))

/**
 * The medias an aggregated page should keep, given the filters the caller set.
 *
 * STRICT: a filter names values, and a row that cannot show it carries one of them does not match. A
 * media with no `type` fails a format filter, a media with no genres fails a genre filter. The
 * alternative, letting an absent field pass, means a "Movies" filter lists every row no source typed,
 * which is the failure a user reads as broken.
 *
 * Genres and tags are ALL-match, case-insensitively: adding a second genre narrows, which is what
 * every browse UI does and what a user adding one expects. Formats and categories are ANY-match,
 * because they are alternatives rather than refinements.
 *
 * `status` IS filtered here, and it could only become filterable once the home page stopped using it
 * to mean something else. That page asked for RELEASING to mean "the current season", every seasonal
 * source read it that way, and a listing of a season legitimately holds runs that have not aired yet,
 * so enforcing it would have emptied a third of the front page. The home page now names its season
 * (router/home/index.tsx), which leaves this free to mean what it says.
 *
 * It is strict like the rest, and that has a real cost worth knowing: the bundled offline catalogue
 * publishes no status at all, on purpose, because its dump's own value decays within weeks (192 of 219
 * SUMMER 2026 rows read UPCOMING in a dump cut six weeks before they aired). So a status filter drops
 * every row only that catalogue describes. That is the honest answer to "which of these is airing" and
 * it is why status is a filter rather than a default.
 *
 * The SITE comes first (src/site.ts), and it is a parameter rather than a field of `filters` because a
 * field is something any caller could widen: no page and no address can ask this past it.
 */
export const applyMediaFilters = <T extends Pick<GQLMedia, 'categories' | 'type' | 'status' | 'season' | 'seasonYear' | 'genres' | 'tags'>>(
  medias: readonly T[],
  filters: MediaPageFilters,
  current: Site = site
): T[] => {
  const categories = filters.categories ?? []
  const formats = filters.formats ?? []
  const genres = labelSet(filters.genres)
  const tags = labelSet(filters.tags)
  const { status, season, seasonYear } = filters

  return medias.filter(media => {
    if (!siteAllows(media.categories ?? [], current)) return false
    if (categories.length && !(media.categories ?? []).some(category => categories.includes(category))) return false
    if (formats.length && !(media.type && formats.includes(media.type))) return false
    if (status && media.status !== status) return false
    if (season && media.season !== season) return false
    if (seasonYear && media.seasonYear !== seasonYear) return false
    if (genres.size) {
      const carried = labelSet(media.genres)
      for (const genre of genres) if (!carried.has(genre)) return false
    }
    if (tags.size) {
      const carried = labelSet(media.tags)
      for (const tag of tags) if (!carried.has(tag)) return false
    }
    return true
  })
}

/** A title as this site answers it: nothing for a title the site does not keep. */
export const siteMedia = <T extends Pick<GQLMedia, 'categories'>>(media: T, current: Site = site): T | undefined =>
  siteAllows(media.categories ?? [], current) ? media : undefined

/**
 * A page that names one category and nothing else is a source's own list: the movie and series home
 * rows, which only JustWatch answers, with its most popular titles. Such a page draws what the
 * sources answered and never the rest of the store, which would list under "Popular" every title of
 * that category a viewer happened to open.
 */
export const isListing = ({ search, categories, formats, status, season, seasonYear, genres, tags }: MediaPageFilters & { search?: string | null }) =>
  categories?.length === 1 && !search && !status && !season && !seasonYear && !formats?.length && !genres?.length && !tags?.length

/**
 * Rows in the order the sources answered them, each placed by the first of its uris answered: its own, a member's
 * (SAME_AS), or the show a season card stands in for (PART_OF), since a listed show the store holds a season of is
 * drawn as that season.
 */
export const inAnswerOrder = <T extends { uri: string, handles?: { relation: string, node: { uri: string } }[] | null }>(
  rows: readonly T[],
  answered: readonly string[]
): T[] => {
  const rank = new Map(answered.map((uri, index) => [uri, index]))
  const place = (row: T) => Math.min(
    rank.get(row.uri) ?? Infinity,
    ...(row.handles ?? [])
      .filter(handle => handle.relation === 'SAME_AS' || handle.relation === 'PART_OF')
      .map(handle => rank.get(handle.node.uri) ?? Infinity)
  )
  return [...rows].sort((a, b) => place(a) - place(b))
}

type Hit = Pick<GQLMedia, 'seasonYear' | 'startDate' | 'covers' | 'banners' | 'handles'>

const isThin = (media: Hit): boolean =>
  !media.seasonYear && !media.startDate && !media.covers.length && !media.banners.length &&
  new Set(media.handles.map(handle => handle.node.origin)).size < 2

/**
 * Search hits in the order given, those with no year, no picture and no handle naming a second source moved after
 * every other, never dropped, as one can be the title sought.
 */
export const thinLast = <T extends Hit>(medias: readonly T[]): T[] =>
  [...medias.filter(media => !isThin(media)), ...medias.filter(isThin)]

/** The rows a page keeps, a listing's in the order its sources answered them. */
export const pageRows = <T extends Pick<GQLMedia, 'uri' | 'handles' | 'categories' | 'type' | 'status' | 'season' | 'seasonYear' | 'genres' | 'tags'>>(
  rows: readonly T[],
  input: MediaPageFilters & { search?: string | null },
  answered: readonly string[],
  current: Site = site
): T[] => applyMediaFilters(isListing(input) ? inAnswerOrder(rows, answered) : rows, input, current)

// Nulls are decided BEFORE the direction, so reversing the order does not reverse where an unranked
// row lands. A media with no popularity is unranked rather than unpopular, so it sorts last either
// way, the same call `relation-labels.ts` makes for a relation the list does not name.
const comparePopularity = (a: number | null | undefined, b: number | null | undefined, direction: 1 | -1) => {
  if (a == null) return b == null ? 0 : 1
  if (b == null) return -1
  return (a - b) * direction
}

/**
 * The page in the order `sorts` names, applied left to right so the last member decides.
 *
 * `POPULARITY` is ASCENDING and `POPULARITY_DESC` DESCENDING, which is what the `X` / `X_DESC` pair
 * means everywhere it appears, AniList's own `MediaSort` included: this enum holds two of its members
 * and `sources/anilist/extractor.ts` sends `POPULARITY_DESC` upstream to get the most popular first.
 *
 * A media with no popularity sorts LAST in both directions.
 *
 * Returns a new array. The input is left alone so a caller can keep the unsorted page.
 */
export const applyMediaSorts = <T extends Pick<GQLMedia, 'popularity'>>(
  medias: readonly T[],
  sorts: readonly string[] | null | undefined
): T[] => {
  const sorted = [...medias]
  for (const sort of sorts ?? []) {
    if (sort === 'POPULARITY') sorted.sort((a, b) => comparePopularity(a.popularity, b.popularity, 1))
    else if (sort === 'POPULARITY_DESC') sorted.sort((a, b) => comparePopularity(a.popularity, b.popularity, -1))
  }
  return sorted
}
