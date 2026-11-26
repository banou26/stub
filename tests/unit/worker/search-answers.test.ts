// An answer the store already holds changes nothing and so fires no store event, which leaves a page drawing what
// was answered with nothing to wake it, as the row a replaced prefix read a moment ago does to the next search. The
// same answer must not move a page still on the whole store, which holds it already. Both are driven through the
// app's own resolver against a fake fan-out.
import { expect, onTestFinished, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

const fanout = vi.hoisted(() => ({ empty: false, answer: (_uris: string[]) => {}, settle: () => {} }))

vi.mock('../../../src/worker/extractor', () => ({
  implementsSimilarMedia: () => true,
  similarOutcomeFrom: () => () => undefined,
  proxyRequestToExtractors: (_ctx: unknown, _operation: unknown, extractUris: (result: unknown) => string[], settling?: { ask: () => () => void }) => {
    const insertedUris = new Set<string>()
    const pending = fanout.empty ? undefined : settling?.ask()
    fanout.answer = uris => {
      for (const uri of extractUris({ data: { mediaPage: { nodes: uris.map(uri => ({ uri })) } } })) insertedUris.add(uri)
    }
    fanout.settle = () => { pending?.() }
    return { subscriptions: [], insertedUris, close: () => { pending?.() } }
  },
}))
const STORE = vi.hoisted(() => ['tvmaze:83119', 'tmdb:93405', 'imdb:tt7203552'])
const row = (uri: string) => ({
  uri,
  titles: [{ language: 'en', title: 'The Morning Show', score: 1 }],
  covers: [],
  banners: [],
  handles: [],
  categories: ['SERIES'],
  season: 'FALL',
  seasonYear: 2026,
  genres: ['Drama'],
})
vi.mock('../../../src/worker/store/db', async original => ({
  ...await original<object>(),
  findAllAggregatedMedia: async (uris: string[] = STORE) => uris.map(uri => [row(uri)]),
  hideAttachedContainers: (clusters: unknown[]) => clusters,
}))
vi.mock('../../../src/worker/store/fuzzy-merge', async original => ({
  ...await original<object>(),
  fuzzyMergeMediaClusters: async () => false,
}))
vi.mock('../../../src/worker/store/aggregate', async original => ({
  ...await original<object>(),
  aggregateMedia: (cluster: unknown[]) => cluster[0],
}))
vi.stubGlobal('location', new URL('http://localhost/'))

const { resolvers } = await import('../../../src/worker/resolvers/media/index')
const { emit } = await import('../../../src/worker/store/events')

const open = (input: object) => {
  const stop = new AbortController()
  const page = (resolvers.Subscription.mediaPage.subscribe as any)(undefined, { input }, { request: { signal: stop.signal } })
  onTestFinished(() => stop.abort())
  return page as AsyncGenerator<{ uri: string }[]>
}

const drawn = async (page: AsyncGenerator<{ uri: string }[]>) => {
  const next = await Promise.race([page.next(), new Promise<undefined>(resolve => setTimeout(resolve, 300))])
  return next?.value?.map(media => media.uri)
}

test('a page on the whole store keeps its cards as its sources repeat what the store holds', async () => {
  const page = open({ search: 'the morning show' })
  expect(await drawn(page)).toEqual(['imdb:tt7203552', 'tmdb:93405', 'tvmaze:83119'])

  fanout.answer(['tvmaze:83119'])

  expect(await drawn(page), 'the store did not move, so the page does not').toBeUndefined()
})

test('a page drawing its answers draws one the store already holds, which fires no store event', async () => {
  const page = open({ search: 'the morning show' })
  await drawn(page)
  fanout.answer(['tvmaze:83119'])
  emit('media:changed', {})
  expect(await drawn(page)).toEqual(['tvmaze:83119'])

  fanout.answer(['tmdb:93405'])

  expect(await drawn(page)).toEqual(['tmdb:93405', 'tvmaze:83119'])
})

test('a listing draws an answer the store already holds, having never drawn the store', async () => {
  const page = open({ categories: ['SERIES'] })
  expect(await drawn(page)).toEqual([])

  fanout.answer(['tvmaze:83119'])

  expect(await drawn(page)).toEqual(['tvmaze:83119'])
})

test('a repeated warm-store search stays whole on partial answers, narrows once settled, and keeps warm cards on empty settle', async () => {
  const page = open({ search: 'the morning show' })
  expect(await drawn(page)).toEqual(['imdb:tt7203552', 'tmdb:93405', 'tvmaze:83119'])

  let arrived = false
  const pending = page.next().then(result => { arrived = true; return result })
  fanout.answer(['tvmaze:83119'])
  await new Promise(resolve => setTimeout(resolve, 200))
  expect(arrived, 'still whole before every source settles').toBe(false)

  fanout.settle()
  const narrowed = await pending
  expect(narrowed.value?.map(media => media.uri), 'narrows to what sources answered once settled').toEqual(['tvmaze:83119'])

  const failed = open({ search: 'the morning show' })
  expect(await drawn(failed)).toEqual(['imdb:tt7203552', 'tmdb:93405', 'tvmaze:83119'])
  fanout.settle()
  expect(await drawn(failed), 'empty settle keeps the warm store instead of wiping to empty').toBeUndefined()
})

test('a browse page waits for its sources rather than leaking the warm store, wakes on known answers, and falls back only on empty settle', async () => {
  const seasonPage = open({ season: 'FALL', seasonYear: 2026, sorts: ['POPULARITY_DESC'] })
  expect(await drawn(seasonPage)).toEqual([])

  fanout.answer(['tvmaze:83119'])
  expect(await drawn(seasonPage), 'wakes on an answer the store already holds').toEqual(['tvmaze:83119'])

  fanout.answer(['tmdb:93405'])
  expect(await drawn(seasonPage), 'accumulates later source answers').toEqual(['tvmaze:83119', 'tmdb:93405'])

  const sameTick = open({ season: 'FALL', seasonYear: 2026, sorts: ['POPULARITY_DESC'] })
  expect(await drawn(sameTick)).toEqual([])
  fanout.answer(['tvmaze:83119'])
  fanout.settle()
  expect(await drawn(sameTick), 'same-tick answer beats empty fallback').toEqual(['tvmaze:83119'])

  const emptyBrowse = open({ genres: ['Drama'] })
  expect(await drawn(emptyBrowse)).toEqual([])
  fanout.settle()
  expect(await drawn(emptyBrowse), 'falls back to the filtered warm store when every source settles empty')
    .toEqual(['tvmaze:83119', 'tmdb:93405', 'imdb:tt7203552'])

  fanout.answer(['tvmaze:83119'])
  expect(await drawn(emptyBrowse), 'a late source answer after fallback still narrows the browse page')
    .toEqual(['tvmaze:83119'])

  fanout.empty = true
  try {
    const noSources = open({ genres: ['Drama'] })
    expect(await drawn(noSources), 'zero askable sources immediately falls back to the filtered store')
      .toEqual(['tvmaze:83119', 'tmdb:93405', 'imdb:tt7203552'])
  } finally {
    fanout.empty = false
  }

  const emptyListing = open({ categories: ['SERIES'] })
  expect(await drawn(emptyListing)).toEqual([])
  fanout.settle()
  expect(await drawn(emptyListing), 'listings never fall back to the warm store').toBeUndefined()
})
