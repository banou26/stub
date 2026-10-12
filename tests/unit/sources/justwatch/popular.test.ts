// JustWatch's popularTitles with no search, the US films and shows, cut to the first four each on
// 2026-10-12: the home row of movies.fkn.app and of series.fkn.app.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import { applyMediaFilters } from '../../../../src/worker/store/filter'
import POPULAR_MOVIES from '../../../fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from '../../../fixtures/justwatch/popular-shows.json'

const listing = async (input: Record<string, unknown>, answer: unknown) => {
  const asked: { searchTitlesFilter: unknown }[] = []
  const context = {
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      asked.push(JSON.parse(init.body).variables)
      return { json: async () => answer }
    },
  }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input }, context).next()
  return { nodes: value.mediaPage.nodes, asked: asked.map(variables => variables.searchTitlesFilter) }
}

test('the movie site\'s home row is JustWatch\'s most popular films, each a film run', async () => {
  const { nodes, asked } = await listing({ categories: ['MOVIE'] }, POPULAR_MOVIES)
  expect(asked).toEqual([{ objectTypes: ['MOVIE'] }])
  const row = applyMediaFilters(nodes, {}, 'movie')
  expect(row.map((media: any) => media.titles[0].title)).toEqual(['Backrooms', 'Obsession', 'The End of Oak Street', 'Practical Magic'])
  expect(row.map((media: any) => [media.type, media.categories, media.scope ?? 'RUN'])).toEqual(Array(4).fill(['MOVIE', ['MOVIE'], 'RUN']))
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
