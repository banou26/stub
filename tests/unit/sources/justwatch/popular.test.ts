// JustWatch's popularTitles with no search, the US films and shows, cut to the first four each on
// 2026-10-12, with the backdrops and YouTube clips it answered for the same titles on 2026-10-26: the
// home row of movies.fkn.app and of series.fkn.app.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import { applyMediaFilters } from '../../../../src/worker/store/filter'
import { theaterCandidates } from '../../../../src/utils/theater'
import POPULAR_MOVIES from '../../../fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from '../../../fixtures/justwatch/popular-shows.json'
import STAR_WARS from '../../../fixtures/justwatch/star-wars-search.json'

const listing = async (input: Record<string, unknown>, answer: unknown) => {
  const asked: { query: string, variables: { searchTitlesFilter: unknown } }[] = []
  const context = {
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      asked.push(JSON.parse(init.body))
      return { json: async () => answer }
    },
  }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input }, context).next()
  return { nodes: value.mediaPage.nodes, asked: asked.map(body => body.variables.searchTitlesFilter), queries: asked.map(body => body.query) }
}

test('the movie site\'s home row is JustWatch\'s most popular films, each a film run', async () => {
  const { nodes, asked } = await listing({ categories: ['MOVIE'] }, POPULAR_MOVIES)
  expect(asked).toEqual([{ objectTypes: ['MOVIE'] }])
  const row = applyMediaFilters(nodes, {}, 'movie')
  expect(row.map((media: any) => media.titles[0].title)).toEqual(['Backrooms', 'Obsession', 'The End of Oak Street', 'Practical Magic'])
  expect(row.map((media: any) => [media.type, media.categories, media.scope ?? 'RUN'])).toEqual(Array(4).fill(['MOVIE', ['MOVIE'], 'RUN']))
})

// the hero takes a title and a short description, and draws the poster when there is no trailer or banner
test('each film of the movie site\'s home row carries its poster and synopsis, so the row and the hero draw', async () => {
  const { nodes } = await listing({ categories: ['MOVIE'] }, POPULAR_MOVIES)
  expect(nodes.map((media: any) => media.covers.map(({ url }: { url: string }) => url))).toEqual([
    ['https://images.justwatch.com/poster/347350367/s718/backrooms.jpg'],
    ['https://images.justwatch.com/poster/346817191/s718/obsession-2026.jpg'],
    ['https://images.justwatch.com/poster/347475607/s718/flowervale-street.jpg'],
    ['https://images.justwatch.com/poster/11005490/s718/practical-magic.jpg'],
  ])
  expect(theaterCandidates(nodes).map((media: any) => media.shortDescriptions[0].shortDescription.slice(0, 24))).toEqual([
    'A strange doorway appear',
    'After breaking the myste',
    'After a mysterious cosmi',
    'Sally and Gillian Owens,',
  ])
})

// STAR_WARS is JustWatch's answer to the search "star wars" on 2026-10-13, cut to the four films whose
// cards on movies.fkn.app drew no poster: JustWatch alone answered for them
test('a film found by search carries the poster JustWatch answered, on the film and on its one episode', async () => {
  const { nodes: films } = await listing({ search: 'star wars' }, STAR_WARS)
  expect(films.map((media: any) => [media.titles[0].title, media.covers])).toEqual([
    ['Star Wars', [{ url: 'https://images.justwatch.com/poster/45534539/s718/star-wars-episode-iv-a-new-hope.jpg', score: 0.2 }]],
    ['Star Wars: The Force Awakens', [{ url: 'https://images.justwatch.com/poster/177028682/s718/star-wars-the-force-awakens.jpg', score: 0.2 }]],
    ['Star Wars: The Last Jedi', [{ url: 'https://images.justwatch.com/poster/45957177/s718/star-wars-the-last-jedi.jpg', score: 0.2 }]],
    ['Star Wars: The Rise of Skywalker', [{ url: 'https://images.justwatch.com/poster/178536888/s718/star-wars-episode-ix.jpg', score: 0.2 }]],
  ])
  expect(films.map((media: any) => media.episodes[0].thumbnails[0].url)).toEqual(films.map((media: any) => media.covers[0].url))
})

test('a film found by search carries its synopsis, on the film and on its one episode', async () => {
  const { nodes: [starWars] } = await listing({ search: 'star wars' }, STAR_WARS)
  expect(starWars.shortDescriptions[0].shortDescription).toMatch(/^Princess Leia is captured/)
  expect(starWars.episodes[0].descriptions).toEqual(starWars.descriptions)
})

// with its offers a show is hidden behind its provider ids' placeholder rows, which draw no card
test('the series site\'s home row is JustWatch\'s most popular shows, each a CONTAINER carrying no offers', async () => {
  const { nodes, asked } = await listing({ categories: ['SERIES'] }, POPULAR_SHOWS)
  expect(asked).toEqual([{ objectTypes: ['SHOW'] }])
  const row = applyMediaFilters(nodes, {}, 'series')
  expect(row.map((media: any) => media.titles[0].title)).toEqual(['Lanterns', 'Ted Lasso', 'Slow Horses', 'Lioness'])
  expect(row.map((media: any) => [media.scope, media.categories, media.handles])).toEqual(Array(4).fill(['CONTAINER', ['SERIES'], []]))
})

test('a season, a search or two categories is not a home row, so it asks nothing popular', async () => {
  for (const input of [
    { categories: ['MOVIE'], season: 'FALL', seasonYear: 2026 },
    { categories: ['MOVIE', 'SERIES'] },
    { categories: ['ANIME'] },
    {},
  ]) {
    const { nodes, asked } = await listing(input, POPULAR_MOVIES)
    expect([nodes, asked], JSON.stringify(input)).toEqual([[], []])
  }
})

// the hero drew the 718x1024 poster across the whole screen and played nothing, since the row asked for neither
test('the home row asks each title\'s backdrops and YouTube clips, and a search asks neither', async () => {
  for (const categories of [['MOVIE'], ['SERIES']]) {
    const { queries: [query] } = await listing({ categories }, categories[0] === 'MOVIE' ? POPULAR_MOVIES : POPULAR_SHOWS)
    expect(query, categories[0]).toMatch(/backdrops\(profile: S1920, format: JPG\) \{\s+backdropUrl\s+\}/)
    expect(query, categories[0]).toMatch(/clips\(providers: \[YOUTUBE\]\) \{\s+externalId\s+\}/)
  }
  const { queries: [search] } = await listing({ search: 'star wars' }, STAR_WARS)
  expect(search).not.toMatch(/backdrops|clips/)
})

test('each film and show of the home row carries its backdrops as banners and its clips as YouTube trailers', async () => {
  const { nodes: films } = await listing({ categories: ['MOVIE'] }, POPULAR_MOVIES)
  const { nodes: shows } = await listing({ categories: ['SERIES'] }, POPULAR_SHOWS)
  const [backrooms] = films
  expect(backrooms.banners).toEqual([{ url: 'https://images.justwatch.com/backdrop/344090471/s1920/backrooms.jpg', score: 0.1 }])
  expect(backrooms.trailers[0]).toEqual({ uri: 'yt:0HjdiohVOik', origin: 'yt', id: '0HjdiohVOik', url: 'https://www.youtube.com/watch?v=0HjdiohVOik' })
  expect(shows.map((media: any) => [media.titles[0].title, media.banners.length, media.trailers.map(({ uri }: { uri: string }) => uri)])).toEqual([
    ['Lanterns', 2, ['yt:XmcIjxwLJcY', 'yt:7UIBOsuUwc4', 'yt:Z1jcPlGXnMo', 'yt:HF_WsM_4mzI']],
    ['Ted Lasso', 5, ['yt:BwPcMIDFVKw', 'yt:zQusW5WJhfw', 'yt:WZXgJQRoCaI', 'yt:3u7EIiohs6U']],
    ['Slow Horses', 5, ['yt:O9ZJChzPn0U', 'yt:UUPWCmPiYj0', 'yt:HcQ6P4aHhWs', 'yt:ieLStl_Ccts']],
    ['Lioness', 5, ['yt:uEjcXhW7CXo', 'yt:IljG0a1YEck', 'yt:_NTTf-Ih2Qk', 'yt:c5X7wVy9QWs']],
  ])
  // the hero picks among titles carrying a trailer, and draws a banner before a poster
  expect(theaterCandidates([...films, ...shows]).map((media: any) => media.trailers.length > 0)).toEqual(Array(8).fill(true))
  expect([...films, ...shows].every((media: any) => /^https:\/\/images\.justwatch\.com\/backdrop\/\d+\/s1920\//.test(media.banners[0].url))).toBe(true)
})
