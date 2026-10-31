// movies.fkn.app and series.fkn.app link a JustWatch title by an address naming JustWatch alone, `ag:(jw:<id>)`.
// Reached from the home row, the graph already holds the row the listing answered. Opened cold, it holds nothing
// and nothing else in the address can answer: JustWatch waited 15 s for the cluster to name a format, then asked
// the show `ts1465819` for the film The End of Oak Street, got nothing, and the page stayed empty (2026-10-19).
// The id names two nodes: `tm224087` is a 1985 film and `ts224087` Ted Lasso.
import { expect, test, vi } from 'vite-plus/test'

import POPULAR_MOVIES from '../../../fixtures/justwatch/popular-movies.json'
import POPULAR_SHOWS from '../../../fixtures/justwatch/popular-shows.json'
import PENGUIN_HIGHWAY from '../../../fixtures/justwatch/penguin-highway.json'
import TED_LASSO from '../../../fixtures/justwatch/ted-lasso.json'
import THE_END_OF_OAK_STREET from '../../../fixtures/justwatch/the-end-of-oak-street.json'

const current = vi.hoisted(() => ({ site: 'stub' }))
vi.mock('../../../../src/site', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/site')>(),
  get site() { return current.site },
}))

const { resolvers } = await import('../../../../src/sources/justwatch/extractor')

const JW_API = 'https://apis.justwatch.com/graphql'
const NODES: Record<string, unknown> = { ...PENGUIN_HIGHWAY, ...TED_LASSO, ...THE_END_OF_OAK_STREET }

// what a page draws of a row
const drawn = (media?: { uri: string, scope?: string, categories: string[], titles: { title: string }[] } | null) =>
  ({ uri: media?.uri ?? null, scope: media ? media.scope ?? 'RUN' : null, categories: media?.categories ?? null, title: media?.titles[0]?.title ?? null })

// the row a home row answered for this id, which is what the graph holds once a link to it is followed
const listed = async (category: 'MOVIE' | 'SERIES', page: unknown, objectId: string) => {
  const context = { fetch: async () => ({ json: async () => page }) }
  const { value } = await (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input: { categories: [category] } }, context).next()
  return value.mediaPage.nodes.find((media: { id: string }) => media.id === objectId)
}

// JustWatch as the worker asks it: `cluster` is what the graph holds for the address, and `later` what it holds
// after the first change, if one ever comes
const askJustWatch = async (uri: string, cluster?: unknown, later?: unknown) => {
  const asked: string[] = []
  let listened = false
  let held = cluster
  const context = {
    findAggregatedMedia: async () => held,
    listenForMediaChanges: async function* (_: unknown, options?: { abortSignal?: AbortSignal }) {
      listened = true
      held = later ?? held
      yield
      await new Promise(resolve => options?.abortSignal?.addEventListener('abort', resolve))
    },
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== JW_API) throw new Error(`no recorded answer for ${url}`)
      const { nodeId } = JSON.parse(init?.body ?? '{}').variables
      asked.push(nodeId)
      return { json: async () => ({ data: { node: NODES[nodeId] ?? null } }) }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return { asked, listened, ...drawn(value.media) }
}

test('movies.fkn.app: a film opened cold gets what a link to it from the home row gets, at once', async () => {
  current.site = 'movie'
  const linked = await askJustWatch('ag:(jw:1465819)', await listed('MOVIE', POPULAR_MOVIES, '1465819'))
  expect(linked, 'the control: a link').toEqual({ asked: ['tm1465819'], listened: false, uri: 'jw:1465819', scope: 'RUN', categories: ['MOVIE'], title: 'The End of Oak Street' })
  expect(await askJustWatch('ag:(jw:1465819)')).toEqual(linked)
})

test('movies.fkn.app: a film opened cold whose id also names an unrelated show gets the film', async () => {
  current.site = 'movie'
  expect(await askJustWatch('ag:(jw:403680)')).toEqual({ asked: ['tm403680'], listened: false, uri: 'jw:403680', scope: 'RUN', categories: ['ANIME', 'MOVIE'], title: 'Penguin Highway' })
})

// reached by a link, the page draws the show its home row answered, and JustWatch answers no season of it
test('series.fkn.app: a show opened cold is the show its home row lists, at once', async () => {
  current.site = 'series'
  const listing = await listed('SERIES', POPULAR_SHOWS, '224087')
  expect(drawn(listing), 'the control: the home row').toEqual({ uri: 'jw:224087', scope: 'CONTAINER', categories: ['SERIES'], title: 'Ted Lasso' })
  expect(await askJustWatch('ag:(jw:224087)')).toEqual({ asked: ['ts224087'], listened: false, ...drawn(listing) })
})

test('series.fkn.app: a season its address names alone is that season, not the show', async () => {
  current.site = 'series'
  expect(await askJustWatch('ag:(jw:224087-274066)'))
    .toEqual({ asked: ['ts224087'], listened: false, uri: 'jw:224087-274066', scope: 'RUN', categories: ['SERIES'], title: 'Ted Lasso' })
})

const seasonsAt = async (uri: string, node: unknown = NODES.ts224087) => {
  const context = { fetch: async () => ({ json: async () => ({ data: { node } }) }) }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return value.media.seasons
}

// the links are what move a show's page onto a run: a card no other source knows the seasons of opened a page with no
// episodes and nothing to play (The Diplomat and MobLand, 2026-10-31)
test('series.fkn.app: a show links its seasons, from its own page and from each of them', async () => {
  current.site = 'series'
  const seasons = [[1, 233988], [2, 274066], [3, 281160], [4, 469982]].map(([number, id]) => ({ number, uri: `jw:224087-${id}` }))
  expect(await seasonsAt('ag:(jw:224087)')).toEqual(seasons)
  expect(await seasonsAt('ag:(jw:224087-274066)')).toEqual(seasons)
})

test('series.fkn.app: a season not out yet, or the specials, is not linked', async () => {
  current.site = 'series'
  const node = structuredClone(NODES.ts224087) as { seasons: { content: { seasonNumber: number, isReleased: boolean } }[] }
  node.seasons[0]!.content.seasonNumber = 0
  node.seasons[3]!.content.isReleased = false
  expect((await seasonsAt('ag:(jw:224087)', node)).map((season: { number: number }) => season.number)).toEqual([2, 3])
})

test('series.fkn.app: an anime links none, its runs being its cours', async () => {
  current.site = 'series'
  const node = structuredClone(NODES.ts224087) as { content: { genres: { shortName: string }[], productionCountries: string[] } }
  node.content.genres = [{ shortName: 'ani' }]
  node.content.productionCountries = ['JP']
  expect(await seasonsAt('ag:(jw:224087)', node)).toBeUndefined()
})

test('an address naming another source still waits for what that source answers', async () => {
  current.site = 'series'
  const secondSeason = { categories: ['SERIES'], titles: [{ title: 'Ted Lasso' }], startDate: '2021-07-23', episodeCount: 12 }
  expect(await askJustWatch('ag:(jw:224087,tvmaze:44458)', undefined, secondSeason))
    .toEqual({ asked: ['ts224087'], listened: true, uri: 'jw:224087-274066', scope: 'RUN', categories: ['SERIES'], title: 'Ted Lasso' })
})

test('a site that keeps films and shows still waits for the cluster to say which node the id names', async () => {
  current.site = 'stub'
  const film = { categories: ['ANIME', 'MOVIE'], titles: [{ title: 'Penguin Highway' }] }
  expect(await askJustWatch('ag:(jw:403680)', undefined, film))
    .toEqual({ asked: ['tm403680'], listened: true, uri: 'jw:403680', scope: 'RUN', categories: ['ANIME', 'MOVIE'], title: 'Penguin Highway' })
})
