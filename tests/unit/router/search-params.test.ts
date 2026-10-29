import { describe, expect, test } from 'vite-plus/test'

import { MediaCategory, MediaSeason, MediaStatus, MediaType } from '../../../src/generated/graphql'
import {
  EMPTY_SEARCH_FILTERS, SITE_GENRES, YEAR_MIN,
  formatLabel, hasSearchFilters, legacySearchTerm, namesAQuery, parseSearchFilters, sceneOf, scenePath,
  searchFiltersQuery, searchHeading, searchPath, seasonLabel, seasonValue, statusLabel, yearMax,
} from '../../../src/router/search/params'
import type { SearchFilters } from '../../../src/router/search/params'
import { writePluginUris } from '../../../src/utils/plugin-links'

// The url IS the search page's state: the controls render from it, the header's box rewrites one key
// of it, and the home page links into it. A key silently dropped here is a filter that looks applied
// and is not, which is the one failure a user cannot tell from a broken source.

const AT = new Date('2026-09-06T00:00:00Z')

describe('parseSearchFilters', () => {
  test('an empty query string names nothing', () => {
    expect(parseSearchFilters('')).toEqual(EMPTY_SEARCH_FILTERS)
  })

  test('every axis round-trips through the query string', () => {
    const filters = {
      query: 'mushoku tensei',
      category: MediaCategory.Anime,
      status: MediaStatus.Releasing,
      season: MediaSeason.Summer,
      year: 2026,
      formats: [MediaType.Tv, MediaType.TvShort],
      genres: ['Action', 'Slice of Life'],
      tags: ['Isekai'],
    }
    expect(parseSearchFilters(searchFiltersQuery(filters), AT)).toEqual(filters)
  })

  test('a value carrying a separator survives, which is why the multi-valued keys repeat', () => {
    const filters = parseSearchFilters(searchFiltersQuery({ tags: ['Rock & Roll', 'Male, Female'], query: 'a=b&c' }), AT)
    expect(filters.tags).toEqual(['Rock & Roll', 'Male, Female'])
    expect(filters.query).toBe('a=b&c')
  })

  test('an enum value this build does not know is dropped rather than sent to the sources', () => {
    const filters = parseSearchFilters('season=AUTUMN&status=PENDING&category=BOOK&format=MANGA&format=TV', AT)
    expect(filters.season).toBeNull()
    expect(filters.status).toBeNull()
    expect(filters.category).toBeNull()
    expect(filters.formats).toEqual(['TV'])
  })

  test('a year outside the range a run could carry is dropped', () => {
    expect(parseSearchFilters('year=2026', AT).year).toBe(2026)
    expect(parseSearchFilters(`year=${YEAR_MIN}`, AT).year).toBe(YEAR_MIN)
    expect(parseSearchFilters(`year=${YEAR_MIN - 1}`, AT).year).toBeNull()
    expect(parseSearchFilters(`year=${yearMax(AT) + 1}`, AT).year).toBeNull()
    expect(parseSearchFilters('year=twenty', AT).year).toBeNull()
    expect(parseSearchFilters('year=99', AT).year).toBeNull()
  })

  test('a repeated label is kept once, so a chip cannot need two clicks to clear', () => {
    expect(parseSearchFilters('genre=Action&genre=action&tag=Isekai&tag=ISEKAI', AT))
      .toMatchObject({ genres: ['Action'], tags: ['Isekai'] })
  })

  test('a blank or whitespace value is absence, not a filter matching nothing', () => {
    expect(parseSearchFilters('q=%20%20&genre=&tag=%20', AT)).toEqual(EMPTY_SEARCH_FILTERS)
  })
})

// wouter's useSearch is NOT location.search.slice(1): it is decodeURI(stripQm(...)), so one extra
// decode happens between what is written to the address bar and what the page parses back. Everything
// the codec writes survives it except a literal percent followed by two hex digits, which that decode
// consumes. Pinned rather than fixed: making the writer double-encode would produce a query string
// that is only correct after wouter's decode, which is a worse trap than a mangled "%41".
const throughAddressBar = (query: string) => decodeURI(query)

describe('the round trip through wouter, which decodes once more than URLSearchParams', () => {
  test('ordinary text, separators and non-ASCII all survive', () => {
    for (const query of ['naruto', 'a=b&c', 're:zero', '100%', 'リゼロ', 'a b + c', 'Fate/Zero']) {
      const parsed = parseSearchFilters(throughAddressBar(searchFiltersQuery({ query })), AT)
      expect(parsed.query, query).toBe(query)
    }
  })

  test('a literal percent followed by two hex digits is the one thing that does not', () => {
    const parsed = parseSearchFilters(throughAddressBar(searchFiltersQuery({ query: '%41' })), AT)
    expect(parsed.query).toBe('A')
  })
})

describe('searchPath', () => {
  test('nothing set is the bare route, so a cleared page has a clean address', () => {
    expect(searchPath()).toBe('/search')
    expect(searchPath(EMPTY_SEARCH_FILTERS)).toBe('/search')
  })

  test('the home page link names one season', () => {
    expect(searchPath({ season: seasonValue('SUMMER'), year: 2026 })).toBe('/search?season=SUMMER&year=2026')
  })

  test('the plugin rewrite that runs on EVERY navigation leaves every filter intact', () => {
    // src/plugin-url.ts patches history.pushState, so this runs on the way to the search page whether
    // the navigation came from a <Link>, the header box or a filter control.
    const path = searchPath({
      query: 're zero', season: seasonValue('WINTER'), year: 2024,
      formats: [MediaType.Tv, MediaType.Movie], genres: ['Sci-Fi'], tags: ['Time Manipulation'], status: MediaStatus.Finished,
    })
    const written = writePluginUris(path, ['npm:@banou/stub-plugin'], 'https://stub.moe/')
    expect(parseSearchFilters(new URL(written).search.slice(1), AT)).toEqual({
      query: 're zero',
      category: null,
      status: 'FINISHED',
      season: 'WINTER',
      year: 2024,
      formats: ['TV', 'MOVIE'],
      genres: ['Sci-Fi'],
      tags: ['Time Manipulation'],
    })
  })
})

describe('hasSearchFilters', () => {
  test('nothing set asks no question, so the page subscribes to nothing', () => {
    expect(hasSearchFilters(EMPTY_SEARCH_FILTERS)).toBe(false)
  })

  test('any single axis a source can answer is enough to browse, not just the text', () => {
    for (const filters of [
      { query: 'a' }, { status: MediaStatus.Releasing }, { season: MediaSeason.Summer },
      { year: 2026 }, { formats: [MediaType.Tv] }, { genres: ['Action'] }, { tags: ['Isekai'] },
    ] satisfies Partial<SearchFilters>[]) {
      expect(hasSearchFilters({ ...EMPTY_SEARCH_FILTERS, ...filters })).toBe(true)
    }
  })

  test('a category counts, so clearing the last other chip does not empty the page under it', () => {
    expect(hasSearchFilters({ ...EMPTY_SEARCH_FILTERS, category: MediaCategory.Anime })).toBe(true)
  })
})

describe('namesAQuery', () => {
  test('a category on its own asks nobody anything: no source reads it', () => {
    // The split exists so the page can tell "this filter found nothing" from "this filter never sent
    // a request". Category is applied locally over what the other axes fetched, so alone it fetches
    // nothing, and reporting "No results found" would blame it for a query that was never made.
    expect(namesAQuery({ ...EMPTY_SEARCH_FILTERS, category: MediaCategory.Anime })).toBe(false)
    expect(namesAQuery({ ...EMPTY_SEARCH_FILTERS, category: MediaCategory.Anime, year: 2026 })).toBe(true)
    expect(namesAQuery(EMPTY_SEARCH_FILTERS)).toBe(false)
  })

  test('every other axis is a question a source can be asked', () => {
    for (const filters of [
      { query: 'a' }, { status: MediaStatus.Releasing }, { season: MediaSeason.Summer },
      { year: 2026 }, { formats: [MediaType.Tv] }, { genres: ['Action'] }, { tags: ['Isekai'] },
    ] satisfies Partial<SearchFilters>[]) {
      expect(namesAQuery({ ...EMPTY_SEARCH_FILTERS, ...filters })).toBe(true)
    }
  })
})

describe('SITE_GENRES', () => {
  test('each site offers the genres its sources list by: AniList\'s on anime, JustWatch\'s on movies and series, both on stub', () => {
    expect(SITE_GENRES.anime).toContain('Mecha')
    expect(SITE_GENRES.anime).not.toContain('Science-Fiction')
    expect(SITE_GENRES.anime).not.toContain('Isekai')
    for (const site of ['movie', 'series'] as const) {
      expect(SITE_GENRES[site]).toEqual(expect.arrayContaining(['Science-Fiction', 'Kids & Family']))
      expect(SITE_GENRES[site]).not.toContain('Mecha')
      expect(SITE_GENRES[site]).not.toContain('Made in Europe')
    }
    expect(SITE_GENRES.stub).toEqual(expect.arrayContaining(['Mecha', 'Science-Fiction']))
  })
})

describe('seasonValue', () => {
  test('bridges the two spellings of the four seasons without inventing a third', () => {
    expect(seasonValue('SUMMER')).toBe('SUMMER')
    expect(seasonValue('summer')).toBeNull()
    expect(seasonValue('AUTUMN')).toBeNull()
    expect(seasonValue(null)).toBeNull()
  })
})

describe('searchHeading', () => {
  const of = (filters: Partial<SearchFilters>) => searchHeading({ ...EMPTY_SEARCH_FILTERS, ...filters })

  test('names the browse, so the page does not read Search above a control labelled Search', () => {
    expect(of({})).toBe('Search')
    expect(of({ season: MediaSeason.Summer, year: 2026 })).toBe('Summer 2026')
    expect(of({ year: 2026 })).toBe('2026')
    expect(of({ season: MediaSeason.Summer })).toBe('Summer seasons')
    expect(of({ season: MediaSeason.Winter })).toBe('Winter seasons')
    expect(of({ genres: ['Action'] })).toBe('Browsing')
    expect(of({ season: MediaSeason.Fall, year: 2026, genres: ['Action'] })).toBe('Fall 2026')
  })

  test('free text wins, because it is what the reader typed', () => {
    expect(of({ query: 'frieren', season: MediaSeason.Summer, year: 2026 })).toBe('Results for \u201Cfrieren\u201D')
  })
})

describe('legacySearchTerm', () => {
  test('an ordinary term decodes', () => {
    expect(legacySearchTerm('mushoku%20tensei')).toBe('mushoku tensei')
    expect(legacySearchTerm(undefined)).toBe('')
  })

  test('a term wouter already decoded does not crash the app', () => {
    // /search/100%25 reaches useParams as '100%', and decodeURIComponent throws URIError on that. The
    // router has no error boundary, so an old bookmark rendered a blank page rather than a search.
    for (const raw of ['100%', '%', 'a%zz', '%E0%A4%A']) {
      expect(() => legacySearchTerm(raw), raw).not.toThrow()
      expect(legacySearchTerm(raw), raw).toBe(raw)
    }
  })
})

// The card and list modes render a format, a status and a broadcast window as words. They read the
// same option lists the pickers do, so a label can only ever be written once.
describe('formatLabel, statusLabel and seasonLabel', () => {
  test('an enum value becomes the label its own picker shows', () => {
    expect(formatLabel(MediaType.Tv)).toBe('TV Show')
    expect(formatLabel(MediaType.Ova)).toBe('OVA')
    expect(statusLabel(MediaStatus.Releasing)).toBe('Airing')
    expect(statusLabel(MediaStatus.NotYetReleased)).toBe('Not yet aired')
  })

  test('a media no source typed answers nothing rather than a placeholder', () => {
    expect(formatLabel(null)).toBeUndefined()
    expect(formatLabel(undefined)).toBeUndefined()
    expect(statusLabel(null)).toBeUndefined()
  })

  // HOR-1026 (stub in the viewer's language): each label's English, pinned before the labels move into messages
  test('every format, status and season reads as its picker has always written it', () => {
    expect([MediaType.Tv, MediaType.Movie, MediaType.TvShort, MediaType.Special, MediaType.Ova, MediaType.Ona].map(formatLabel))
      .toEqual(['TV Show', 'Movie', 'TV Short', 'Special', 'OVA', 'ONA'])
    expect([MediaStatus.Releasing, MediaStatus.Finished, MediaStatus.NotYetReleased, MediaStatus.Cancelled, MediaStatus.Hiatus].map(statusLabel))
      .toEqual(['Airing', 'Finished', 'Not yet aired', 'Cancelled', 'Hiatus'])
    expect([MediaSeason.Winter, MediaSeason.Spring, MediaSeason.Summer, MediaSeason.Fall].map(season => seasonLabel(season, 2026)))
      .toEqual(['Winter 2026', 'Spring 2026', 'Summer 2026', 'Fall 2026'])
    expect(formatLabel(MediaType.LiveAction), 'a format the picker does not offer').toBeUndefined()
  })

  test('a season needs its year, a year does not need its season', () => {
    expect(seasonLabel(MediaSeason.Fall, 2026)).toBe('Fall 2026')
    expect(seasonLabel(null, 2026)).toBe('2026')
    // "Fall" alone names a window in every year at once, which says less than nothing.
    expect(seasonLabel(MediaSeason.Fall, null)).toBeUndefined()
    expect(seasonLabel(null, null)).toBeUndefined()
  })
})

// a scene search's address holds the picture's color code alone, so Back, a reload and a party all reopen it
describe('the scene address', () => {
  test('round-trips a color code, and reads nothing else as one', () => {
    const code = 'gwebWzth7oPe2UIubOJmozi1NDFp'
    expect(scenePath(code)).toBe(`/search?scene=${code}`)
    expect(sceneOf(scenePath(code).slice('/search?'.length))).toBe(code)
    expect(sceneOf('q=mushoku')).toBeUndefined()
    expect(sceneOf('scene=too-short')).toBeUndefined()
  })

  test('is not a filter, so a filter change leaves the scene search', () => {
    expect(parseSearchFilters('scene=gwebWzth7oPe2UIubOJmozi1NDFp')).toEqual(EMPTY_SEARCH_FILTERS)
  })
})
