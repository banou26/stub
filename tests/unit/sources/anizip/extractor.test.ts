// Frieren and Cowboy Bebop: The Movie as api.ani.zip answered stub's own mappings request on 2026-10-12.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/anizip/extractor'
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'
import FRIEREN from '../../../fixtures/anizip/frieren.json'
import COWBOY_BEBOP_MOVIE from '../../../fixtures/anizip/cowboy-bebop-the-movie.json'

const links = async (answer: { mappings: { mal_id: number } }) => {
  const context = { fetch: async () => ({ json: async () => answer }) }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `ag:(mal:${answer.mappings.mal_id})` } }, context).next()
  return (value.media.handles as { relation: string, node: { uri: string, url: string, scope: string } }[])
    .map(({ relation, node }) => `${relation} ${node.scope} ${node.uri} ${node.url}`)
}

// an enricher's ids are links that never weld two titles: PART_OF, which unions nothing
test('a series\' TMDB, TheTVDB and IMDb ids are links to the show', async () => {
  expect(await links(FRIEREN)).toEqual([
    'SAME_AS RUN mal:52991 https://myanimelist.net/anime/52991',
    'SAME_AS RUN anilist:154587 https://anilist.co/anime/154587',
    'PART_OF CONTAINER tmdb:209867 https://www.themoviedb.org/tv/209867',
    'PART_OF CONTAINER tvdb:424536 https://thetvdb.com/dereferrer/series/424536',
    'PART_OF CONTAINER imdb:tt22248376 https://www.imdb.com/title/tt22248376',
  ])
})

// its `themoviedb_id` 30991 is the series': /movie/30991 is a 1964 horror film, /tv/30991 Cowboy Bebop
test('a film gets no TMDB link, since AniZip often gives its series\' id', async () => {
  expect(await links(COWBOY_BEBOP_MOVIE)).toEqual([
    'SAME_AS RUN mal:5 https://myanimelist.net/anime/5',
    'SAME_AS RUN anilist:5 https://anilist.co/anime/5',
    'PART_OF CONTAINER tvdb:76885 https://thetvdb.com/dereferrer/series/76885',
    'PART_OF CONTAINER imdb:tt0275277 https://www.imdb.com/title/tt0275277',
  ])
})

test('an id AniZip does not have is no link', async () => {
  const mappings = { ...FRIEREN.mappings, themoviedb_id: null, thetvdb_id: null, imdb_id: null }
  expect(await links({ ...FRIEREN, mappings })).toEqual([
    'SAME_AS RUN mal:52991 https://myanimelist.net/anime/52991',
    'SAME_AS RUN anilist:154587 https://anilist.co/anime/154587',
  ])
})

test('every id AniZip links is one it publishes, not an echo of the address', async () => {
  const origins = (await links(FRIEREN)).map(line => line.split(' ')[2]!.split(':')[0]!)
  expect(origins.filter(origin => !NATIVE_ID_SPACES.anizip!.has(origin))).toEqual([])
})
