// The browse filters are answered by 3 of 25 sources. Every other source ignores them and its rows
// arrive at the page unfiltered, so this predicate is the whole distance between what the user asked
// for and what the page lists. Each leniency pinned below is a row the user filtered out being shown
// anyway, and each is the kind of change a reviewer makes on purpose, believing it kinder.
import { describe, expect, test } from 'vite-plus/test'

import { applyMediaFilters, inAnswerOrder, isListing, pageRows, siteMedia, type MediaPageFilters } from '../../../../src/worker/store/filter'

// an aggregated row as the page receives it, defaulting to the shape a source that says nothing
// produces: no type, no season, no labels
const media = (uri: string, fields: Record<string, unknown> = {}) =>
  ({ uri, categories: [], type: null, season: null, seasonYear: null, genres: [], tags: [], ...fields }) as any

const uris = (medias: { uri: string }[]) => medias.map(m => m.uri)

describe('applyMediaFilters', () => {
  test('an empty filter passes every row through, in the order it was given', () => {
    const page = [media('anilist:1'), media('kitsu:2'), media('tmdb:3')]
    expect(applyMediaFilters(page, {})).toEqual(page)
    expect(applyMediaFilters(page, {})[0], 'the rows themselves, not copies').toBe(page[0])
  })

  // the resolver hands through whatever graphql parsed, and an unset input field is null there
  test('a filter whose every field is null passes every row through', () => {
    const page = [media('anilist:1'), media('kitsu:2')]
    expect(applyMediaFilters(page, {
      categories: null, formats: null, season: null, seasonYear: null, genres: null, tags: null,
    })).toEqual(page)
  })

  test('categories are ANY-match: naming two lists rows in either', () => {
    const page = [
      media('anilist:1', { categories: ['ANIME', 'SERIES'] }),
      media('tmdb:2', { categories: ['MOVIE'] }),
      media('tvdb:3', { categories: ['SERIES'] }),
    ]
    expect(uris(applyMediaFilters(page, { categories: ['MOVIE'] }))).toEqual(['tmdb:2'])
    expect(uris(applyMediaFilters(page, { categories: ['MOVIE', 'ANIME'] }))).toEqual(['anilist:1', 'tmdb:2'])
  })

  test('formats are ANY-match: naming two lists rows of either', () => {
    const page = [
      media('anilist:1', { type: 'TV' }),
      media('tmdb:2', { type: 'MOVIE' }),
      media('kitsu:3', { type: 'TV_SHORT' }),
    ]
    expect(uris(applyMediaFilters(page, { formats: ['MOVIE'] }))).toEqual(['tmdb:2'])
    expect(uris(applyMediaFilters(page, { formats: ['TV', 'TV_SHORT' ] }))).toEqual(['anilist:1', 'kitsu:3'])
  })

  // ANY here and ALL below is not an inconsistency: a second format is another kind of thing to list,
  // a second genre is a narrowing of the same list, which is what every browse UI does with them
  test('genres are ALL-match: a second genre narrows the page rather than widening it', () => {
    const page = [
      media('anilist:1', { genres: ['Action', 'Comedy'] }),
      media('kitsu:2', { genres: ['Action'] }),
      media('tmdb:3', { genres: ['Comedy'] }),
    ]
    expect(uris(applyMediaFilters(page, { genres: ['Action'] }))).toEqual(['anilist:1', 'kitsu:2'])
    expect(uris(applyMediaFilters(page, { genres: ['Action', 'Comedy'] }))).toEqual(['anilist:1'])
  })

  test('tags are ALL-match too', () => {
    const page = [
      media('anilist:1', { tags: ['Time Skip', 'Male Protagonist'] }),
      media('kitsu:2', { tags: ['Time Skip'] }),
    ]
    expect(uris(applyMediaFilters(page, { tags: ['Time Skip'] }))).toEqual(['anilist:1', 'kitsu:2'])
    expect(uris(applyMediaFilters(page, { tags: ['Time Skip', 'Male Protagonist'] }))).toEqual(['anilist:1'])
  })

  // AniList publishes 'Sci-Fi', TMDB 'Science Fiction' and a share of the catalogues lower-case the
  // lot, so a case-sensitive compare drops a row for a spelling nobody chose
  test('genres and tags compare case-insensitively, whichever side carries which case', () => {
    const lower = media('kitsu:1', { genres: ['sci-fi'], tags: ['time skip'] })
    const upper = media('anilist:2', { genres: ['Sci-Fi'], tags: ['Time Skip'] })
    const page = [lower, upper]
    expect(uris(applyMediaFilters(page, { genres: ['Sci-Fi'] }))).toEqual(['kitsu:1', 'anilist:2'])
    expect(uris(applyMediaFilters(page, { genres: ['sci-fi'] }))).toEqual(['kitsu:1', 'anilist:2'])
    expect(uris(applyMediaFilters(page, { tags: ['TIME SKIP'] }))).toEqual(['kitsu:1', 'anilist:2'])
  })

  test('season and seasonYear filter independently, and together name one season', () => {
    const page = [
      media('anilist:1', { season: 'SUMMER', seasonYear: 2026 }),
      media('kitsu:2', { season: 'SUMMER', seasonYear: 2025 }),
      media('tmdb:3', { season: 'FALL', seasonYear: 2026 }),
    ]
    expect(uris(applyMediaFilters(page, { season: 'SUMMER' }))).toEqual(['anilist:1', 'kitsu:2'])
    expect(uris(applyMediaFilters(page, { seasonYear: 2026 }))).toEqual(['anilist:1', 'tmdb:3'])
    expect(uris(applyMediaFilters(page, { season: 'SUMMER', seasonYear: 2026 }))).toEqual(['anilist:1'])
  })
})

// The four tests below are one rule seen from four sides, and it is the rule most likely to be
// "fixed" into leniency by someone reading a thin page: an absent field does NOT match. Letting one
// pass means a Movies filter lists every row no source typed, which is most of the store, and the
// user reads a filter that visibly did nothing.
describe('applyMediaFilters is STRICT, so an absent field never passes a filter', () => {
  test('a row with no type is not listed under a format filter', () => {
    const page = [media('offline:1'), media('tmdb:2', { type: 'MOVIE' })]
    expect(uris(applyMediaFilters(page, { formats: ['MOVIE'] }))).toEqual(['tmdb:2'])
  })

  test('a row naming no season is not listed under a season or seasonYear filter', () => {
    const page = [media('offline:1'), media('anilist:2', { season: 'SUMMER', seasonYear: 2026 })]
    expect(uris(applyMediaFilters(page, { season: 'SUMMER' }))).toEqual(['anilist:2'])
    expect(uris(applyMediaFilters(page, { seasonYear: 2026 }))).toEqual(['anilist:2'])
  })

  test('a row carrying no genres is not listed under a genre filter', () => {
    const page = [media('offline:1'), media('anilist:2', { genres: ['Action'] })]
    expect(uris(applyMediaFilters(page, { genres: ['Action'] }))).toEqual(['anilist:2'])
  })

  test('a row carrying no tags is not listed under a tag filter', () => {
    const page = [media('offline:1'), media('anilist:2', { tags: ['Time Skip'] })]
    expect(uris(applyMediaFilters(page, { tags: ['Time Skip'] }))).toEqual(['anilist:2'])
  })
})

// Status is enforced here, and it could not be until the home page stopped sending RELEASING to mean
// "the current season". Every seasonal source read it that way, and a season legitimately holds runs
// that have not aired yet, so enforcing it while the front page still meant that would have hidden a
// third of the row. Without this the control is nearly inert on a season page: measured live before
// the change, Airing gave 213 cards and Not yet aired 216, out of a season of 216, because jikan,
// kitsu and the bundled catalogue answer the whole season and nothing narrowed them.
test('status is enforced, which is what makes the airing filter mean anything on a season page', () => {
  const page = [
    media('anilist:1', { status: 'RELEASING' }),
    media('anilist:2', { status: 'FINISHED' }),
  ]
  expect(uris(applyMediaFilters(page, { status: 'RELEASING' }))).toEqual(['anilist:1'])
})

// The cost of that strictness, stated rather than discovered. The bundled catalogue publishes no
// status on purpose, because its own dump decays (192 of 219 SUMMER 2026 rows read UPCOMING in a dump
// cut six weeks before they aired), so a status filter drops every row only it describes. That is the
// honest answer to "which of these is airing", and it is why status is a filter and not a default.
test('and a row no live source described cannot answer an airing question', () => {
  const page = [media('offline:1', { status: null })]
  expect(uris(applyMediaFilters(page, { status: 'RELEASING' }))).toEqual([])
  expect(uris(applyMediaFilters(page, {})), 'and is untouched when nothing asks').toEqual(['offline:1'])
})

// The site comes before every filter a caller sets, so a page on movie.fkn.app that asks for anime, or
// for nothing at all, still gets films only.
describe('the site a page is served on', () => {
  const page = [
    media('anilist:1', { categories: ['ANIME', 'SERIES'] }),
    media('anilist:2', { categories: ['ANIME', 'MOVIE'] }),
    media('tmdb:3', { categories: ['MOVIE'] }),
    media('tvmaze:4', { categories: ['SERIES'] }),
  ]

  test('keeps only what the site holds, before the caller\'s own filters', () => {
    expect(uris(applyMediaFilters(page, {}, 'anime'))).toEqual(['anilist:1', 'anilist:2'])
    expect(uris(applyMediaFilters(page, {}, 'movie'))).toEqual(['anilist:2', 'tmdb:3'])
    expect(uris(applyMediaFilters(page, {}, 'series'))).toEqual(['tvmaze:4'])
    expect(uris(applyMediaFilters(page, {}, 'stub'))).toEqual(['anilist:1', 'anilist:2', 'tmdb:3', 'tvmaze:4'])
    expect(uris(applyMediaFilters(page, { categories: ['ANIME'] }, 'series')), 'a category filter cannot widen it').toEqual([])
  })

  test('a title the site does not keep answers nothing, and a kept one is answered as it is', () => {
    const title = media('anilist:2', { categories: ['ANIME', 'MOVIE'] })
    expect(siteMedia(title, 'series')).toBeUndefined()
    expect(siteMedia(title, 'anime')).toBe(title)
    expect(siteMedia(title, 'movie')).toBe(title)
    expect(siteMedia(title, 'stub')).toBe(title)
  })
})

// A listing draws only what its sources answered, so it must know itself apart from a page that
// filters the store: a season, a search or any other filter makes it the latter.
describe('a listing', () => {
  test('is one category and nothing else', () => {
    expect(isListing({ categories: ['MOVIE'] })).toBe(true)
    expect(isListing({ categories: ['SERIES'], formats: [], genres: [], tags: [] })).toBe(true)
    expect(isListing({})).toBe(false)
    expect(isListing({ categories: ['MOVIE', 'SERIES'] })).toBe(false)
    expect(isListing({ categories: ['MOVIE'], search: 'dune' })).toBe(false)
    expect(isListing({ categories: ['ANIME'], season: 'FALL', seasonYear: 2026 })).toBe(false)
    expect(isListing({ categories: ['MOVIE'], status: 'RELEASING' })).toBe(false)
    expect(isListing({ categories: ['MOVIE'], formats: ['MOVIE'] })).toBe(false)
    expect(isListing({ categories: ['MOVIE'], genres: ['Drama'] })).toBe(false)
    expect(isListing({ categories: ['MOVIE'], tags: ['Heist'] })).toBe(false)
  })

  test('is drawn in the order its uris were answered, a merged row placed by the first of its members', () => {
    const merged = media('ag:(jw:3,tmdb:9)', { handles: [{ relation: 'SAME_AS', node: { uri: 'jw:3' } }, { relation: 'SAME_AS', node: { uri: 'tmdb:9' } }] })
    const rows = [media('jw:1'), merged, media('jw:2'), media('offline:7')]
    expect(uris(inAnswerOrder(rows, ['jw:3', 'jw:2', 'jw:1']))).toEqual(['ag:(jw:3,tmdb:9)', 'jw:2', 'jw:1', 'offline:7'])
    expect(uris(inAnswerOrder(rows, [])), 'nothing answered keeps the order given').toEqual(['jw:1', 'ag:(jw:3,tmdb:9)', 'jw:2', 'offline:7'])
  })

  test('places a season card where the show it stands in for was answered', () => {
    const season = media('ag:(tmdb:2-s1)', { handles: [{ relation: 'SAME_AS', node: { uri: 'tmdb:2-s1' } }, { relation: 'PART_OF', node: { uri: 'jw:ts2' } }] })
    const rows = [media('jw:ts1'), media('jw:ts3'), season]
    expect(uris(inAnswerOrder(rows, ['jw:ts1', 'jw:ts2', 'jw:ts3']))).toEqual(['jw:ts1', 'ag:(tmdb:2-s1)', 'jw:ts3'])
  })

  test('orders a listing\'s rows by the answer, and leaves any other page\'s as given', () => {
    const rows = [media('jw:1', { categories: ['MOVIE'] }), media('jw:2', { categories: ['MOVIE'] })]
    expect(uris(pageRows(rows, { categories: ['MOVIE'] }, ['jw:2', 'jw:1'], 'stub'))).toEqual(['jw:2', 'jw:1'])
    expect(uris(pageRows(rows, { categories: ['MOVIE'], search: 'dune' }, ['jw:2', 'jw:1'], 'stub'))).toEqual(['jw:1', 'jw:2'])
    expect(uris(pageRows(rows, { categories: ['MOVIE'] }, ['jw:2', 'jw:1'], 'series')), 'and still keeps the site\'s rows only').toEqual([])
  })
})
