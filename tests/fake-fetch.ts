import type { FetchInit } from '../src/worker/backoff'

import { cloud } from '@fkn/lib'

import BEBOP from './fixtures/credits/anilist-bebop.json'
import FRIEREN_THEMES from './fixtures/themes/animethemes-frieren.json'

const FRIEREN_IDS = { themoviedb_id: '209867', thetvdb_id: 424536, imdb_id: 'tt22248376' }

const THEMES = structuredClone(FRIEREN_THEMES)
THEMES.data.findAnimeByExternalSite[0]!.animethemes[2]!.animethemeentries = []

// What tests/title-page.spec.ts builds the app with in place of src/utils/fetch.ts: AniList's public
// API answers every work with Cowboy Bebop's credits and nothing else, AniZip with 26 bare episodes and
// Frieren's TMDB, TheTVDB and IMDb ids, and AnimeThemes with Frieren's themes, bliss without its video,
// so no title, cover or date changes under the page; every other request goes where it always went.
export const fetch = async (input: RequestInfo | URL, init?: FetchInit) => {
  const malId = typeof input === 'string' ? input.match(/^https:\/\/api\.ani\.zip\/mappings\?mal_id=(\d+)/)?.[1] : undefined
  if (malId) {
    const episodes = Object.fromEntries(Array.from({ length: 26 }, (_, index) => [index + 1, { title: { en: `Session ${index + 1}` } }]))
    return Response.json({ titles: {}, episodes, episodeCount: 26, mappings: { anidb_id: Number(malId), mal_id: Number(malId), type: 'TV', ...FRIEREN_IDS } })
  }
  if (input === 'https://graphql.animethemes.moe/') return Response.json(THEMES)
  if (input !== 'https://graphql.anilist.co/' || typeof init?.body !== 'string') return cloud.fetch(input, init)
  const { query, variables } = JSON.parse(init.body) as { query: string, variables: { id?: number } }
  if (query.includes('Page(')) return Response.json({ data: { Page: { pageInfo: { lastPage: 1 }, media: [] } } })
  const { characters, staff, studios } = BEBOP
  return Response.json({ data: { Media: { id: variables.id, ...query.includes('characters(') ? { characters, staff, studios } : {} } } })
}
