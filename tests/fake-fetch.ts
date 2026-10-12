import type { FetchInit } from '../src/worker/backoff'

import { cloud } from '@fkn/lib'

import BEBOP from './fixtures/credits/anilist-bebop.json'
import BREAKING_BAD from './fixtures/credits/imdb-breaking-bad.json'
import FRIEREN_THEMES from './fixtures/themes/animethemes-frieren.json'
import FRIEREN_SEASONS from './fixtures/tmdb/seasons-frieren.html?raw'
import SQUID_GAME_SEASONS from './fixtures/tmdb/seasons-squid-game.html?raw'
import FRIEREN_SHOW from './fixtures/tmdb/show-frieren.html?raw'
import SQUID_GAME_SHOW from './fixtures/tmdb/show-squid-game.html?raw'

const THEMES = structuredClone(FRIEREN_THEMES)
THEMES.data.findAnimeByExternalSite[0]!.animethemes[2]!.animethemeentries = []

const TMDB: Record<string, string> = {
  '/tv/93405': SQUID_GAME_SHOW,
  '/tv/93405/seasons': SQUID_GAME_SEASONS,
  '/tv/209867': FRIEREN_SHOW,
  '/tv/209867/seasons': FRIEREN_SEASONS,
}

// What tests/title-page.spec.ts builds the app with in place of src/utils/fetch.ts: AniList's public
// API answers every work with Cowboy Bebop's credits and nothing else, AniZip with 26 dated episodes,
// AnimeThemes with Frieren's themes, bliss without its video, so no title, cover or date changes under
// the page, IMDb with Breaking Bad for tt0903747 alone, and TMDB with Squid Game's three seasons and
// Frieren's one, each season's own page empty; every other request goes where it always went.
export const fetch = async (input: RequestInfo | URL, init?: FetchInit) => {
  const malId = typeof input === 'string' ? input.match(/^https:\/\/api\.ani\.zip\/mappings\?mal_id=(\d+)/)?.[1] : undefined
  if (malId) {
    const episodes = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [index + 1, { title: { en: `Session ${index + 1}: Misunderstandings` }, airdate: '2023-09-29' }]))
    return Response.json({ titles: {}, episodes, episodeCount: 26, mappings: { anidb_id: Number(malId), mal_id: Number(malId) } })
  }
  if (input === 'https://graphql.animethemes.moe/') return Response.json(THEMES)
  if (typeof input === 'string' && input.startsWith('https://www.themoviedb.org/')) return new Response(TMDB[new URL(input).pathname] ?? '')
  if (input === 'https://caching.graphql.imdb.com/' && typeof init?.body === 'string' && JSON.parse(init.body).variables?.id === 'tt0903747') {
    return Response.json(BREAKING_BAD)
  }
  if (input !== 'https://graphql.anilist.co/' || typeof init?.body !== 'string') return cloud.fetch(input, init)
  const { query, variables } = JSON.parse(init.body) as { query: string, variables: { id?: number } }
  if (query.includes('Page(')) return Response.json({ data: { Page: { pageInfo: { lastPage: 1 }, media: [] } } })
  const { characters, staff, studios } = BEBOP
  return Response.json({ data: { Media: { id: variables.id, ...query.includes('characters(') ? { characters, staff, studios } : {} } } })
}
