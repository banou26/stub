import type { FetchInit } from '../src/worker/backoff'

import { cloud } from '@fkn/lib'

import BEBOP from './fixtures/credits/anilist-bebop.json'
import BREAKING_BAD from './fixtures/credits/imdb-breaking-bad.json'
import BEBOP_MAL_CREDITS from './fixtures/credits/mal-bebop.html?raw'
import FRIEREN_THEMES from './fixtures/themes/animethemes-frieren.json'
import POPULAR_MOVIES from './fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from './fixtures/justwatch/popular-shows.json'
import PRIME_COUNTRIES from './fixtures/justwatch/prime-countries.json'
import FRIEREN_SEASONS from './fixtures/tmdb/seasons-frieren.html?raw'
import SQUID_GAME_SEASONS from './fixtures/tmdb/seasons-squid-game.html?raw'
import FRIEREN_SHOW from './fixtures/tmdb/show-frieren.html?raw'
import SQUID_GAME_SHOW from './fixtures/tmdb/show-squid-game.html?raw'
import BEBOP_MAL from './unit/sources/jikan/__fixtures__/mal-anime-1.html?raw'

const FRIEREN_IDS = { themoviedb_id: '209867', thetvdb_id: 424536, imdb_id: 'tt22248376' }

const SEQUEL = { id: 900001, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Sequel' }, description: 'The journey goes on. '.repeat(60) }
const THIRD = { id: 900002, type: 'ANIME', format: 'TV', status: 'FINISHED', title: { english: 'Spec Third' }, description: 'And on again. '.repeat(80) }

const many = <T>(count: number, make: (number: number) => T) => Array.from({ length: count }, (_, index) => make(index + 1))
const SEQUEL_CREDITS = {
  characters: { edges: many(14, number => ({ role: 'SUPPORTING', node: { id: 900100 + number, name: { full: `Sequel Character ${number}` } }, voiceActors: [] })) },
  staff: { edges: many(14, number => ({ role: 'Key Animation', node: { id: 900200 + number, name: { full: `Sequel Animator ${number}` } } })) },
  studios: { nodes: [] },
}
const SEQUEL_RELATIONS = [
  { relationType: 'SEQUEL', node: THIRD },
  ...many(3, number => ({ relationType: 'SIDE_STORY', node: { id: 900002 + number, type: 'ANIME', format: 'OVA', status: 'FINISHED', title: { english: `Spec Side Story ${number}` } } })),
]
const SEQUEL_THEMES = {
  data: {
    findAnimeByExternalSite: [{
      id: SEQUEL.id,
      slug: 'spec_sequel',
      animethemes: many(14, number => ({
        type: 'OP',
        sequence: number,
        song: { title: { romaji: `Sequel Song ${number}`, native: null }, performances: [{ artist: { name: { main: 'Spec Band' } } }] },
        animethemeentries: [{ videos: { nodes: [{ link: `https://v.animethemes.moe/SpecSequel-OP${number}.webm` }] } }],
      })),
    }],
  },
}

const THEMES = structuredClone(FRIEREN_THEMES)
THEMES.data.findAnimeByExternalSite[0]!.animethemes[2]!.animethemeentries = []

const TMDB: Record<string, string> = {
  '/tv/93405': SQUID_GAME_SHOW,
  '/tv/93405/seasons': SQUID_GAME_SEASONS,
  '/tv/93405/season/1': '<div class="card" data-episode-number="1"><h3><a href="#">Red Light, Green Light</a></h3><span class="date">September 17, 2021</span></div>',
  '/tv/93405/season/2': '<div class="card" data-episode-number="1"><h3><a href="#">Bread and Lottery</a></h3><span class="date">December 26, 2024</span></div>',
  '/tv/209867': FRIEREN_SHOW,
  '/tv/209867/seasons': FRIEREN_SEASONS,
}

// What tests/title-page.spec.ts builds the app with in place of src/utils/fetch.ts: AniList's public
// API answers every work with Cowboy Bebop's credits and one sequel, Spec Sequel (anilist:900001), whose
// own characters, staff, relations and songs each run past a page, AniZip with 26 dated episodes (1,100
// for mal:21) and Frieren's TMDB, TheTVDB and IMDb ids, AnimeThemes with Frieren's themes, bliss without
// its video, so no title, cover or date changes under the page, IMDb with Breaking Bad for tt0903747
// alone, and TMDB with Squid Game's three seasons and Frieren's one, each season's own page empty but
// Squid Game's first two, which list one episode each, JustWatch with its four most popular films or shows
// when asked for either and with The Boys as it answered the countries asked (prime-countries.json), and
// MyAnimeList with Cowboy Bebop's title and credits pages for mal:1; every other request goes where it
// always went.
export const fetch = async (input: RequestInfo | URL, init?: FetchInit) => {
  const malId = typeof input === 'string' ? input.match(/^https:\/\/api\.ani\.zip\/mappings\?mal_id=(\d+)/)?.[1] : undefined
  if (malId) {
    const count = malId === '21' ? 1100 : 26
    const episodes = Object.fromEntries(Array.from({ length: count }, (_, index) => [index + 1, { title: { en: `Session ${index + 1}: Misunderstandings` }, airdate: '2023-09-29' }]))
    return Response.json({ titles: {}, episodes, episodeCount: count, mappings: { anidb_id: Number(malId), mal_id: Number(malId), type: 'TV', ...FRIEREN_IDS } })
  }
  if (input === 'https://graphql.animethemes.moe/') return Response.json(typeof init?.body === 'string' && JSON.parse(init.body).variables?.id === SEQUEL.id ? SEQUEL_THEMES : THEMES)
  if (input === 'https://myanimelist.net/anime/1') return new Response(BEBOP_MAL)
  if (input === 'https://myanimelist.net/anime/1/_/characters') return new Response(BEBOP_MAL_CREDITS)
  if (input === 'https://apis.justwatch.com/graphql' && typeof init?.body === 'string') {
    const { variables } = JSON.parse(init.body)
    const [objectType] = variables?.searchTitlesFilter?.objectTypes ?? []
    if (objectType === 'MOVIE') return Response.json(POPULAR_MOVIES)
    if (objectType === 'SHOW') return Response.json(POPULAR_SHOWS)
    const theBoys = PRIME_COUNTRIES['the-boys'] as Record<string, unknown>
    if (variables?.nodeId === 'ts78125') return Response.json(theBoys[`${variables.offerCountry},${variables.extraCountry}`] ?? { data: { node: null } })
  }
  if (typeof input === 'string' && input.startsWith('https://www.themoviedb.org/')) return new Response(TMDB[new URL(input).pathname] ?? '')
  if (input === 'https://caching.graphql.imdb.com/' && typeof init?.body === 'string' && JSON.parse(init.body).variables?.id === 'tt0903747') {
    return Response.json(BREAKING_BAD)
  }
  if (input !== 'https://graphql.anilist.co/' || typeof init?.body !== 'string') return cloud.fetch(input, init)
  const { query, variables } = JSON.parse(init.body) as { query: string, variables: { id?: number } }
  if (query.includes('Page(')) return Response.json({ data: { Page: { pageInfo: { lastPage: 1 }, media: [] } } })
  const { characters, staff, studios } = BEBOP
  const credits = query.includes('characters(') ? { characters, staff, studios } : {}
  if (variables.id === SEQUEL.id) return Response.json({ data: { Media: { ...SEQUEL, ...query.includes('characters(') ? SEQUEL_CREDITS : {}, relations: { edges: SEQUEL_RELATIONS } } } })
  if (variables.id === THIRD.id) return Response.json({ data: { Media: { ...THIRD, ...credits } } })
  const relations = { edges: [{ relationType: 'SEQUEL', node: SEQUEL }] }
  return Response.json({ data: { Media: { id: variables.id, relations, ...credits } } })
}
