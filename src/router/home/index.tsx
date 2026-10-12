import { css } from '@emotion/react'
import { useSubscription } from 'urql'
import { useState, useMemo, useRef } from 'preact/hooks'

import { gql } from '../../generated'
import { MediaCategory, MediaSort, type MediaPageInput } from '../../generated/graphql'
import HomeTheater from './theater'
import MediaSection from './media-section'
import { useRoute } from 'wouter'
import { getRouterRoutePath, Route } from '../path'
import MediaModal from './media-modal'
import CategoryTabs from '../../components/category-tabs'
import { orderKeys, settledOrder } from '../../utils/settled-order'
import { searchPath, seasonValue } from '../search/params'
import { mediaSeasonNow } from '../../sources/season'
import { layer } from '../../layers'
import { site, type Site } from '../../site'

const GET_RELEASING_MEDIA_PAGE = gql(`
  subscription GetReleasingMediaPage($input: MediaPageInput!, $shortDescriptionInput: MediaShortDescriptionInput!) {
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
      }
    }
  }
`)

const style = css`
  .category-bar {
    position: relative;
    z-index: ${layer.categoryBar};
    padding: 1.5rem 3rem 0.5rem;
  }
`

// The heading links into the search page with this season prefilled, so the row and the page it opens
// describe the same window. Read at module load rather than per render: a tab open across a quarter
// boundary would relabel the link under the user, and the listing itself does not move either.
const now = mediaSeasonNow()
const CURRENT_SEASON = { season: seasonValue(now.season)!, year: now.year }
const CURRENT_SEASON_SEARCH = searchPath(CURRENT_SEASON)

const POPULAR_MOVIES = { categories: [MediaCategory.Movie] }
const POPULAR_SHOWS = { categories: [MediaCategory.Series] }

type Row = 'season' | 'movies' | 'shows'

const ROWS: Record<Site, Row[]> = {
  anime: ['season'],
  movie: ['movies'],
  series: ['shows'],
  stub: ['season', 'movies', 'shows'],
}
const rows = ROWS[site]

/** One row's listing, asked only on a site that shows the row. */
const useRow = (input: MediaPageInput, row: Row) => {
  const [{ data }] = useSubscription({
    query: GET_RELEASING_MEDIA_PAGE,
    variables: {
      input,
      shortDescriptionInput: {
        count: 1
      }
    },
    pause: !rows.includes(row)
  })

  // The season row's placement is held still once a card is on screen: the resolver re-sorts it on
  // popularity on every store change, so a show the bundle has no count for jumps the moment a live
  // source supplies one. Measured 2026-09-06: the top ten reordered at 9.0 s, well after it looked
  // settled at 2.0 s. The Popular rows keep the order JustWatch answered, which never moves, and
  // holding a partial first draw still would put the cards that arrive later at the end.
  const resolved = data?.mediaPage?.nodes
  const placed = useRef<string[]>([])
  return useMemo(() => {
    if (!resolved?.length || row !== 'season') return resolved || []
    const ordered = settledOrder(resolved, placed.current)
    placed.current = orderKeys(ordered)
    return ordered
  }, [resolved])
}

const Index = () => {
  const [matchMediaRoute] = useRoute(getRouterRoutePath(Route.MEDIA))
  const [category, setCategory] = useState<MediaCategory | null>(null)
  const nodes = {
    season: useRow({
      // THE SEASON, NAMED. This asked `status: RELEASING` until the search page arrived, and every
      // seasonal source read that as "the season the clock is in" rather than as a status, which is
      // what the row has always meant and what its heading says. Saying so directly frees `status`
      // to be a real filter the store can enforce, and it costs nothing here: with the pair set,
      // AniList, jikan, kitsu and the bundled catalogue each answer the same season they answered
      // for RELEASING, and a season listing keeps the runs that have not aired yet.
      season: CURRENT_SEASON.season,
      seasonYear: CURRENT_SEASON.year,
      sorts: [MediaSort.PopularityDesc],
      ...(category ? { categories: [category] } : {})
    }, 'season'),
    // no sort: JustWatch answers most popular first and carries no popularity of its own to sort by
    movies: useRow(POPULAR_MOVIES, 'movies'),
    shows: useRow(POPULAR_SHOWS, 'shows'),
  }

  return (
    <div css={style}>
      <HomeTheater mediaNodes={nodes[rows[0]!]} />
      {
        site === 'stub'
          ? (
            <div className="category-bar">
              <CategoryTabs value={category} onChange={setCategory} />
            </div>
          )
          : undefined
      }
      {rows.includes('season') && <MediaSection title="Current season" titleTo={CURRENT_SEASON_SEARCH} mediaNodes={nodes.season}/>}
      {rows.includes('movies') && (!category || category === MediaCategory.Movie) && <MediaSection title="Popular movies" mediaNodes={nodes.movies}/>}
      {rows.includes('shows') && (!category || category === MediaCategory.Series) && <MediaSection title="Popular shows" mediaNodes={nodes.shows}/>}
      {matchMediaRoute && <MediaModal mediaNodes={[...nodes.season, ...nodes.movies, ...nodes.shows]} />}
    </div>
  )
}

export default Index
