// An answer the store already holds changes nothing and so fires no store event, which leaves a page drawing what
// was answered with nothing to wake it, as the row a replaced prefix read a moment ago does to the next search. The
// same answer must not move a page still on the whole store, which holds it already. Both are driven through the
// app's own resolver against a fake fan-out.
import { expect, onTestFinished, test, vi } from 'vite-plus/test'

// see tests/unit/worker/graph/read.test.ts: urql's CommonJS build cannot load here, and nothing below calls it
vi.mock('urql', () => ({ Client: class {}, fetchExchange: {}, mapExchange: () => ({}), getOperationName: () => undefined }))

const fanout = vi.hoisted(() => ({ answer: (_uris: string[]) => {} }))

vi.mock('../../../src/worker/extractor', () => ({
  implementsSimilarMedia: () => true,
  similarOutcomeFrom: () => () => undefined,
  proxyRequestToExtractors: (_ctx: unknown, _operation: unknown, extractUris: (result: unknown) => string[]) => {
    const insertedUris = new Set<string>()
    fanout.answer = uris => {
      for (const uri of extractUris({ data: { mediaPage: { nodes: uris.map(uri => ({ uri })) } } })) insertedUris.add(uri)
    }
    return { subscriptions: [], insertedUris, close: () => {} }
  },
}))
const STORE = vi.hoisted(() => ['tvmaze:83119', 'tmdb:93405', 'imdb:tt7203552'])
const row = (uri: string) => ({ uri, titles: [{ language: 'en', title: 'The Morning Show', score: 1 }], covers: [], banners: [], handles: [], categories: ['SERIES'] })
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
  expect(await drawn(page)).toEqual(STORE)

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

  expect(await drawn(page)).toEqual(['tvmaze:83119', 'tmdb:93405'])
})

test('a listing draws an answer the store already holds, having never drawn the store', async () => {
  const page = open({ categories: ['SERIES'] })
  expect(await drawn(page)).toEqual([])

  fanout.answer(['tvmaze:83119'])

  expect(await drawn(page)).toEqual(['tvmaze:83119'])
})
