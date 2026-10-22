// A genre picked on the search page, with no search: movies.fkn.app and series.fkn.app ask no AniList, so JustWatch
// is the only source that can list one. The fake answers as JustWatch does, from the home rows' four films and four
// shows (2026-10-12): the titles of the kinds asked carrying ANY of the genres asked.
import { expect, test, vi } from 'vite-plus/test'

import type { Site } from '../../../../src/site'
import { applyMediaFilters } from '../../../../src/worker/store/filter'
import POPULAR_MOVIES from '../../../fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from '../../../fixtures/justwatch/popular-shows.json'

const current = vi.hoisted(() => ({ site: 'stub' }))
vi.mock('../../../../src/site', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/site')>(),
  get site() { return current.site },
}))

const { resolvers } = await import('../../../../src/sources/justwatch/extractor')

type Filter = { objectTypes?: string[], genres?: string[] }

const answer = ({ objectTypes = [], genres = [] }: Filter) => ({
  data: {
    popularTitles: {
      edges: [...POPULAR_MOVIES.data.popularTitles.edges, ...POPULAR_SHOWS.data.popularTitles.edges].filter(({ node }) =>
        (!objectTypes.length || objectTypes.includes(node.objectType))
        && (!genres.length || node.content.genres.some(genre => genres.includes(genre.shortName)))),
    },
  },
})

const browse = async (site: Site, input: Record<string, unknown>) => {
  current.site = site
  const asked: Filter[] = []
  const context = {
    findAggregatedMedia: async () => null,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      const { searchTitlesFilter } = JSON.parse(init.body).variables
      asked.push(searchTitlesFilter)
      return { json: async () => answer(searchTitlesFilter) }
    },
  }
  const { value } = await (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input }, context).next()
  const page = applyMediaFilters(value.mediaPage.nodes, input, site)
  return { asked, titles: page.map((media: any) => media.titles[0].title), scopes: page.map((media: any) => media.scope ?? 'RUN') }
}

test('movies.fkn.app lists a genre by JustWatch\'s most popular films of it', async () => {
  expect(await browse('movie', { genres: ['Comedy'] })).toEqual({
    asked: [{ objectTypes: ['MOVIE'], genres: ['cmy'] }],
    titles: ['Practical Magic'],
    scopes: ['RUN'],
  })
})

test('series.fkn.app lists a genre by JustWatch\'s most popular shows of it, each a show', async () => {
  expect(await browse('series', { genres: ['sport'] })).toEqual({
    asked: [{ objectTypes: ['SHOW'], genres: ['spt'] }],
    titles: ['Ted Lasso'],
    scopes: ['CONTAINER'],
  })
})

test('stub.fkn.app lists a genre by JustWatch\'s films and shows alike, or by the kind of the category named', async () => {
  expect((await browse('stub', { genres: ['Comedy'] })).titles).toEqual(['Practical Magic', 'Ted Lasso'])
  expect(await browse('stub', { categories: ['MOVIE'], genres: ['Comedy'] })).toMatchObject({
    asked: [{ objectTypes: ['MOVIE'], genres: ['cmy'] }],
    titles: ['Practical Magic'],
  })
  expect(await browse('stub', { categories: ['SERIES'], genres: ['Comedy'] })).toMatchObject({
    asked: [{ objectTypes: ['SHOW'], genres: ['cmy'] }],
    titles: ['Ted Lasso'],
  })
})

test('formats naming a film\'s still ask JustWatch, its films being typed films', async () => {
  expect(await browse('stub', { genres: ['Comedy'], formats: ['MOVIE'] })).toMatchObject({ titles: ['Practical Magic'] })
  expect(await browse('movie', { genres: ['Comedy'], formats: ['ONA', 'MOVIE'] })).toMatchObject({ titles: ['Practical Magic'] })
})

// JustWatch's filter keeps a title carrying any genre asked, and the page one carrying every genre picked
test('two genres ask JustWatch for the first, and the page keeps the titles carrying both', async () => {
  expect(await browse('movie', { genres: ['Horror', 'Mystery & Thriller'] })).toEqual({
    asked: [{ objectTypes: ['MOVIE'], genres: ['hrr'] }],
    titles: ['Backrooms', 'Obsession'],
    scopes: ['RUN', 'RUN'],
  })
})

test('JustWatch is not asked for a genre it has no name for, a filter none of its titles carry, or on anime.fkn.app', async () => {
  for (const [site, input] of [
    ['movie', { genres: ['Mecha'] }],
    ['movie', { genres: ['Drama', 'Mecha'] }],
    ['stub', { genres: ['Drama'], tags: ['Isekai'] }],
    ['stub', { genres: ['Drama'], season: 'FALL', seasonYear: 2026 }],
    ['stub', { genres: ['Drama'], status: 'RELEASING' }],
    ['stub', { genres: ['Comedy'], formats: ['TV'] }],
    ['movie', { genres: ['Comedy'], formats: ['TV', 'ONA'] }],
    ['stub', { categories: ['SERIES'], formats: ['TV'] }],
    ['anime', { genres: ['Fantasy'] }],
  ] as const) {
    expect(await browse(site, input), JSON.stringify([site, input])).toEqual({ asked: [], titles: [], scopes: [] })
  }
})
