// Frieren and Cowboy Bebop: The Movie as api.ani.zip answered stub's own mappings request on 2026-10-12,
// BanG Dream! It's MyGO!!!!! on 2026-10-13.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/anizip/extractor'
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'
import FRIEREN from '../../../fixtures/anizip/frieren.json'
import COWBOY_BEBOP_MOVIE from '../../../fixtures/anizip/cowboy-bebop-the-movie.json'
import MYGO from '../../../fixtures/anizip/bang-dream-its-mygo.json'

const normalized = async (answer: { mappings: { mal_id: number } }) => {
  const context = { fetch: async () => ({ json: async () => answer }) }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `ag:(mal:${answer.mappings.mal_id})` } }, context).next()
  return value.media
}

const links = async (answer: { mappings: { mal_id: number } }) =>
  ((await normalized(answer)).handles as { relation: string, node: { uri: string, url: string, scope: string } }[])
    .map(({ relation, node }) => `${relation} ${node.scope} ${node.uri} ${node.url}`)

type Texts = { titles: { title: string }[], descriptions: { description: string }[], shortDescriptions: { shortDescription: string }[] }

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

// 27 of Frieren's episode summaries end "\nSource: Crunchyroll" or "\nSource: crunchyroll"
test('an episode\'s summary arrives without the credit ending it', async () => {
  const texts = ((await normalized(FRIEREN)).episodes as Texts[])
    .flatMap(episode => [...episode.descriptions.map(({ description }) => description), ...episode.shortDescriptions.map(({ shortDescription }) => shortDescription)])

  expect(texts.length).toBeGreaterThan(0)
  expect(texts.filter(text => /Source:/i.test(text))).toEqual([])
})

test('a title or synopsis shows an apostrophe where AniDB writes a backtick', async () => {
  const [frieren, mygo] = await Promise.all([normalized(FRIEREN), normalized(MYGO)])
  const texts = [frieren, mygo]
    .flatMap(media => [media, ...media.episodes] as Texts[])
    .flatMap(({ titles, shortDescriptions }) => [...titles.map(({ title }) => title), ...shortDescriptions.map(({ shortDescription }) => shortDescription)])

  expect(frieren.titles[0].title).toBe('Frieren: Beyond Journey\'s End')
  expect(mygo.titles.map(({ title }: { title: string }) => title)).toContain('BanG Dream! It\'s MyGO!!!!!')
  expect(texts).toContain('It Didn\'t Have to Be Magic...')
  expect(texts.filter(text => text.includes('`'))).toEqual([])
})

// One Piece 1181 to 1184 as api.ani.zip answered on 2026-10-15: no `airDateUtc`, `airDate: null`, `airdate: ''`
test('an episode AniZip has not dated yet has no date', async () => {
  const undated = { ...FRIEREN.episodes['28'], airDateUtc: undefined, airDate: null, airdate: '' }
  const answer = { ...FRIEREN, episodes: { ...FRIEREN.episodes, 28: undated } }
  const media = await normalized(answer)
  const dates = Object.fromEntries((media.episodes as { episodeNumber: number, releaseDate?: string }[])
    .map(({ episodeNumber, releaseDate }) => [episodeNumber, releaseDate]))

  expect(dates[27]).toBe('2024-03-15T14:00:00Z')
  expect(dates[28]).toBeUndefined()
})

// So What's Wrong with Getting Reborn as a Goblin? 3 aired Oct 12 13:30 UTC by Syoboi Calendar, and api.ani.zip
// answered as `goblin` on 2026-10-18
test('an episode TheTVDB times 2 or more days from AniDB\'s day goes by that day', async () => {
  const goblin = { ...FRIEREN.episodes['28'], airDateUtc: '2026-10-19T13:00:00Z', airDate: '2026-10-19', airdate: '2026-10-12' }
  const near = { ...FRIEREN.episodes['27'], airDateUtc: '2026-10-13T12:00:00Z', airDate: '2026-10-13', airdate: '2026-10-12' }
  const answer = { ...FRIEREN, episodes: { ...FRIEREN.episodes, 27: near, 28: goblin } }
  const media = await normalized(answer)
  const dates = Object.fromEntries((media.episodes as { episodeNumber: number, releaseDate?: string }[])
    .map(({ episodeNumber, releaseDate }) => [episodeNumber, releaseDate]))

  expect(dates[27], 'a day and a half apart').toBe('2026-10-13T12:00:00Z')
  expect(dates[28]).toBe('2026-10-12')
})

test('a work\'s banner is its 16:9 TheTVDB fanart, never the thin TheTVDB banner strip', async () => {
  expect((await normalized(FRIEREN)).banners).toEqual([
    { url: 'https://artworks.thetvdb.com/banners/v4/series/424536/backgrounds/64e6cbe29d9c0.jpg', score: 0.9 },
  ])
})
