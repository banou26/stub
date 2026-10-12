import type { SearchFilters } from './params'

import { css } from '@emotion/react'
import { useSubscription } from 'urql'
import { useLocation, useSearch } from 'wouter'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { Search as SearchIcon, X } from 'lucide-react'

import { gql } from '../../generated'
import { MediaSort } from '../../generated/graphql'
import { getRoutePath, Route } from '../path'
import {
  CATEGORY_OPTIONS, FORMAT_OPTIONS, KNOWN_GENRES, SEASON_OPTIONS, STATUS_OPTIONS,
  YEAR_MIN, hasSearchFilters, isKnownGenre, namesAQuery, parseSearchFilters, searchFiltersQuery, searchHeading, searchPath,
  yearMax,
} from './params'
import MediaTitle from '../../components/media-title'
import MediaCard from '../../components/media-card'
import MediaRow from '../../components/media-row'
import DisplayModeToggle from '../../components/display-mode-toggle'
import FilterSelect, { FilterField } from '../../components/filter-select'
import { readDisplayMode, writeDisplayMode, type DisplayMode } from './display'
import { site } from '../../site'

const LIVE_ACTION_SITE = site === 'movie' || site === 'series'

const SEARCH_MEDIA_PAGE = gql(`
  subscription SearchMediaPage($input: MediaPageInput!, $shortDescriptionInput: MediaShortDescriptionInput!) {
    mediaPage(input: $input) {
      nodes {
        ...MediaFragment
        score
        episodeCount
        titles {
          language
          title
          score
        }
        shortDescriptions(input: $shortDescriptionInput) {
          language
          shortDescription
        }
        covers {
          language
          url
          color
        }
        banners {
          language
          url
        }
        trailers {
          uri
          origin
          id
          url
          thumbnail
        }
        popularity
        genres
        tags
        averageScore
        status
        type
        season
        seasonYear
        nextAiringEpisode {
          episodeNumber
          airingAt
        }
      }
    }
  }
`)

const style = css`
  padding: calc(var(--stub-header-height) + 3rem) 3rem 4rem;
  min-height: 100vh;

  .heading-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.6rem;
    margin-bottom: 2rem;
  }

  .heading {
    font-size: 2.4rem;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.85);
  }

  /* one track per control, wrapping to as many rows as the viewport needs */
  .filters {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
    gap: 1.4rem 1.6rem;
    margin-bottom: 1.6rem;
  }

  .text-field {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    height: 4.2rem;
    padding: 0 1.2rem;
    border-radius: 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.4);
    transition: border-color 0.15s;
  }

  .text-field:focus-within { border-color: rgba(255, 255, 255, 0.5); }

  .text-field input {
    flex: 1;
    min-width: 0;
    border: none;
    outline: none;
    background: transparent;
    color: #fff;
    font-size: 1.5rem;
    font-family: inherit;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 2.5rem;
    min-height: 3rem;
  }

  .chip {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0.6rem 0.4rem 1.1rem;
    border-radius: 2rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: rgba(255, 255, 255, 0.85);
    font-size: 1.4rem;
    font-family: inherit;
    cursor: pointer;
  }

  .chip:hover { border-color: rgba(255, 255, 255, 0.4); color: #fff; }

  .chip-clear {
    padding: 0.4rem 1.1rem;
    border-radius: 2rem;
    border: 1px solid transparent;
    background: transparent;
    color: rgba(255, 255, 255, 0.5);
    font-size: 1.4rem;
    font-family: inherit;
    cursor: pointer;
  }

  .chip-clear:hover { color: #fff; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(25rem, 1fr));
    gap: 2rem;
    justify-items: center;
  }

  /* 42rem is the narrowest a card stays readable at: below it the description loses its last line
     before the cover gives up any width. */
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(42rem, 1fr));
    gap: 1.6rem;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }

  .status {
    font-size: 1.8rem;
    color: rgba(255, 255, 255, 0.5);
  }

  @media (max-width: 768px) {
    padding: calc(var(--stub-header-height) + 1rem) 1.5rem 3rem;

    .heading {
      font-size: 2rem;
    }

    .filters {
      grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    }

    .grid {
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 1.2rem;
    }

    .cards {
      grid-template-columns: 1fr;
      gap: 1.2rem;
    }
  }
`

// Newest first, built once: the list is ~115 entries and rebuilding it per render would rebuild it on
// every keystroke in the picker's own filter box.
const YEAR_OPTIONS = (() => {
  const options: { value: string, label: string }[] = []
  for (let year = yearMax(); year >= YEAR_MIN; year--) options.push({ value: String(year), label: String(year) })
  return options
})()

/**
 * The variables for a filter set.
 *
 * `sorts` is sent only when there is no free text. The resolver applies `sorts` AFTER its relevance
 * pass, so asking for a popularity sort alongside a search would throw the relevance ranking away and
 * answer the most popular media that matched at all.
 */
const variablesFor = (filters: SearchFilters) => ({
  ...filters.query ? { search: filters.query } : { sorts: [MediaSort.PopularityDesc] },
  ...filters.category ? { categories: [filters.category] } : {},
  ...filters.status ? { status: filters.status } : {},
  ...filters.season ? { season: filters.season } : {},
  ...filters.year ? { seasonYear: filters.year } : {},
  ...filters.formats.length ? { formats: filters.formats } : {},
  ...filters.genres.length ? { genres: filters.genres } : {},
  ...filters.tags.length ? { tags: filters.tags } : {},
})

const Search = () => {
  const search = useSearch()
  const [, navigate] = useLocation()
  const filters = useMemo(() => parseSearchFilters(search), [search])
  const asked = namesAQuery(filters)

  // The url is the state, so a control writes to it and re-renders from it. `replace` keeps the back
  // button pointing at wherever the user came from rather than at every intermediate filter set.
  const setFilters = (next: Partial<SearchFilters>) => navigate(searchPath({ ...filters, ...next }), { replace: true })

  // The url writes the field back only when it changed from somewhere else (the header's box, a chip,
  // a link, Back), and never while the field has focus, so a keystroke is not overwritten mid-word.
  const [term, setTerm] = useState(filters.query)
  const termRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement === termRef.current) return
    setTerm(current => current.trim() === filters.query ? current : filters.query)
  }, [filters.query])

  // The url follows every keystroke, the fetch only the query that has held for 350 ms, so a half-typed
  // word never starts a subscription. A link, a reload or Back fetches at once; arriving from the
  // header's first keystroke (its box still focused) does not fetch that one letter.
  const [fetchedQuery, setFetchedQuery] = useState(() => document.activeElement?.matches('header input') ? '' : filters.query)
  useEffect(() => {
    const timer = setTimeout(() => setFetchedQuery(filters.query), 350)
    return () => clearTimeout(timer)
  }, [filters.query])
  const pending = fetchedQuery !== filters.query

  // Keyed and paused on what is fetched rather than on the url, so typing a letter and deleting it
  // again neither restarts the subscription nor loses the results it already holds.
  const fetched = { ...filters, query: fetchedQuery }
  const input = useMemo(() => variablesFor(fetched), [searchFiltersQuery(fetched)])
  const [{ data }] = useSubscription({
    query: SEARCH_MEDIA_PAGE,
    variables: { input, shortDescriptionInput: { count: 1 } },
    pause: !namesAQuery(fetched),
  })

  // Read from storage once rather than kept in the url: see ./display.ts for why a layout is not part
  // of what was searched for.
  const [displayMode, setDisplayMode] = useState<DisplayMode>(readDisplayMode)
  const pickDisplayMode = (mode: DisplayMode) => {
    setDisplayMode(mode)
    writeDisplayMode(mode)
  }

  const [graceElapsed, setGraceElapsed] = useState(false)
  useEffect(() => {
    setGraceElapsed(false)
    const timer = setTimeout(() => setGraceElapsed(true), 5_000)
    return () => clearTimeout(timer)
  }, [search, input])

  // Only the rows this filter set actually asked for.
  //
  // urql preserves the previous result across a change of variables, deliberately, and a paused
  // subscription keeps its last one too, so the page can hold the cards of the filters the reader just
  // left under a heading and a chip row describing different ones.
  //
  // MEASURED, because it was first reported as lasting tens of seconds and does not: instrumenting the
  // render showed the old page surviving exactly THREE renders after a season pick, holding its 215
  // nodes while the url already read WINTER, before urql emits the new subscription's first result.
  // So this is a brief flash of the wrong season, not a stuck page. It is guarded because the guard is
  // free, and NOT covered by scripts/check-search-filters.mjs, which cannot sample a window that
  // short: a check there passed identically with the guard deleted, which makes it decoration.
  //
  // `result.operation` is NOT the test it looks like. It becomes the new operation the moment the
  // subscription restarts, while `data` is still the old page, so comparing it passes in exactly the
  // window the cards are stale. What identifies the data is the input that was current when `data`
  // last CHANGED, which is what these refs hold. `input` is memoized on the fetched filters, so
  // identity is the comparison, and `pending` covers the window where the url is already ahead of it.
  const shownData = useRef(data)
  const shownInput = useRef(input)
  if (data !== shownData.current) {
    shownData.current = data
    shownInput.current = input
  }
  const nodes = asked && !pending && shownInput.current === input ? data?.mediaPage?.nodes ?? [] : []

  /**
   * The two label vocabularies the picker offers, and which url key each one writes to.
   *
   * Genres start from AniList's fixed list, because the control has to be usable before anything is
   * loaded. They cannot END there: jikan's genres also carry its themes and demographics, so
   * "Isekai" and "Shounen" arrive on media as GENRES. Offering those only as tags would write
   * `tag=Isekai`, and the store matches tags against AniList's tag vocabulary, where the label is
   * not, so the filter would return nothing at all.
   *
   * Tags are a pure facet: there are hundreds, they change, and the honest offer is the ones the
   * current results carry. Both keep whatever the url already names, so a picked label never vanishes
   * from its own picker while the page reloads under it.
   */
  const { genreOptions, tagOptions, genreKeys } = useMemo(() => {
    const genres = new Map<string, string>(KNOWN_GENRES.map(genre => [genre.toLowerCase(), genre]))
    const tags = new Map<string, string>()
    for (const genre of filters.genres) genres.set(genre.toLowerCase(), genre)
    for (const tag of filters.tags) tags.set(tag.toLowerCase(), tag)
    for (const node of nodes) {
      for (const genre of node.genres ?? []) if (!genres.has(genre.toLowerCase())) genres.set(genre.toLowerCase(), genre)
      for (const tag of node.tags ?? []) if (!genres.has(tag.toLowerCase()) && !tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), tag)
    }
    const byLabel = (a: string, b: string) => a.localeCompare(b)
    return {
      genreKeys: new Set(genres.keys()),
      genreOptions: [...genres.values()].sort(byLabel).map(genre => ({ value: genre, label: genre })),
      tagOptions: [...tags.values()].sort(byLabel).map(tag => ({ value: tag, label: tag })),
    }
  }, [nodes, filters.genres, filters.tags])

  const labels = [...filters.genres, ...filters.tags]
  // A label the page has seen as a genre goes to `genre=`, whatever this build's fixed list says. The
  // pure `isKnownGenre` is the fallback for a label typed into an empty page, where nothing is loaded
  // to have seen it.
  const isGenre = (label: string) => genreKeys.has(label.toLowerCase()) || isKnownGenre(label)
  const setLabels = (next: string[]) => setFilters({
    genres: next.filter(isGenre),
    tags: next.filter(label => !isGenre(label)),
  })

  // The container and the item, together: they have to agree, and a mode is told apart in the DOM by
  // its container's class, which is what scripts/check-display-modes.mjs asserts against.
  const layout = {
    grid: {
      className: 'grid',
      item: (node: typeof nodes[number]) =>
        <MediaTitle key={node._id} media={node} to={getRoutePath(Route.MEDIA, { uri: node.uri })} ellipsis={false}/>,
    },
    card: {
      className: 'cards',
      item: (node: typeof nodes[number]) =>
        <MediaCard key={node._id} media={node} to={getRoutePath(Route.MEDIA, { uri: node.uri })}/>,
    },
    list: {
      className: 'rows',
      item: (node: typeof nodes[number]) =>
        <MediaRow key={node._id} media={node} to={getRoutePath(Route.MEDIA, { uri: node.uri })}/>,
    },
  }[displayMode]

  const chips: { key: string, label: string, clear: Partial<SearchFilters> }[] = [
    ...filters.year ? [{ key: 'year', label: String(filters.year), clear: { year: null } }] : [],
    ...filters.season ? [{ key: 'season', label: SEASON_OPTIONS.find(option => option.value === filters.season)!.label, clear: { season: null } }] : [],
    ...filters.status ? [{ key: 'status', label: STATUS_OPTIONS.find(option => option.value === filters.status)!.label, clear: { status: null } }] : [],
    ...filters.category ? [{ key: 'category', label: CATEGORY_OPTIONS.find(option => option.value === filters.category)!.label, clear: { category: null } }] : [],
    ...filters.formats.map(format => ({
      key: `format:${format}`,
      label: FORMAT_OPTIONS.find(option => option.value === format)!.label,
      clear: { formats: filters.formats.filter(entry => entry !== format) },
    })),
    ...filters.genres.map(genre => ({ key: `genre:${genre}`, label: genre, clear: { genres: filters.genres.filter(entry => entry !== genre) } })),
    ...filters.tags.map(tag => ({ key: `tag:${tag}`, label: tag, clear: { tags: filters.tags.filter(entry => entry !== tag) } })),
  ]

  return (
    <div css={style}>
      <div className="heading-row">
        <div className="heading">{searchHeading(filters)}</div>
        <DisplayModeToggle mode={displayMode} onChange={pickDisplayMode}/>
      </div>

      <div className="filters">
        <FilterField label="Search">
          <div className="text-field">
            <SearchIcon size={17}/>
            <input
              ref={termRef}
              type="text"
              value={term}
              placeholder="Any title"
              aria-label="Search by title"
              onInput={event => {
                const value = event.currentTarget.value
                setTerm(value)
                setFilters({ query: value })
              }}
            />
          </div>
        </FilterField>
        <FilterSelect
          label="Genres & Tags"
          options={[...genreOptions, ...tagOptions]}
          selected={labels}
          onChange={setLabels}
          multiple
          searchable
          allowCustom
        />
        <FilterSelect
          label="Year"
          options={YEAR_OPTIONS}
          selected={filters.year ? [String(filters.year)] : []}
          onChange={picked => setFilters({ year: picked.length ? Number(picked[0]) : null })}
          searchable
        />
        {LIVE_ACTION_SITE ? undefined : (
          <>
            <FilterSelect
              label="Season"
              options={SEASON_OPTIONS}
              selected={filters.season ? [filters.season] : []}
              onChange={picked => setFilters({ season: (picked[0] as SearchFilters['season']) ?? null })}
            />
            <FilterSelect
              label="Format"
              options={FORMAT_OPTIONS}
              selected={filters.formats}
              onChange={picked => setFilters({ formats: picked as SearchFilters['formats'] })}
              multiple
            />
            <FilterSelect
              label="Airing Status"
              options={STATUS_OPTIONS}
              selected={filters.status ? [filters.status] : []}
              onChange={picked => setFilters({ status: (picked[0] as SearchFilters['status']) ?? null })}
            />
          </>
        )}
        {site === 'stub' ? (
          <FilterSelect
            label="Category"
            options={CATEGORY_OPTIONS}
            selected={filters.category ? [filters.category] : []}
            onChange={picked => setFilters({ category: (picked[0] as SearchFilters['category']) ?? null })}
          />
        ) : undefined}
      </div>

      <div className="chips">
        {chips.map(chip => (
          <button key={chip.key} type="button" className="chip" aria-label={`Remove ${chip.label}`} onClick={() => setFilters(chip.clear)}>
            {chip.label}
            <X size={14}/>
          </button>
        ))}
        {chips.length > 1 && (
          <button
            type="button"
            className="chip-clear"
            onClick={() => setFilters({ category: null, status: null, season: null, year: null, formats: [], genres: [], tags: [] })}
          >
            Clear filters
          </button>
        )}
      </div>

      {
        nodes.length
          ? <div className={layout.className}>{nodes.map(layout.item)}</div>
          : asked
            ? <div className="status">{graceElapsed ? 'No results found.' : 'Searching\u2026'}</div>
            : <div className="status">{hasSearchFilters(filters) ? 'Add a title or another filter.' : 'Search by title, or pick a filter.'}</div>
      }
    </div>
  )
}

export default Search
