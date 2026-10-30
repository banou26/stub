// A search draws what its own sources answered, and an answer the store already holds changes nothing and
// so fires no store event: the row a replaced prefix read a moment ago leaves the next search's answer with
// nothing to wake the page. It is driven through the app's own resolver against a fake fan-out.
import { expect, test, vi } from 'vite-plus/test'

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
const row = (uri: string) => ({ uri, titles: [{ language: 'en', title: 'The Morning Show', score: 1 }], covers: [], banners: [], handles: [], categories: ['SERIES'] })
vi.mock('../../../src/worker/store/db', async original => ({
  ...await original<object>(),
  findAllAggregatedMedia: async (uris: string[] = []) => uris.map(uri => [row(uri)]),
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

test('a search draws an answer the store already holds, which fires no store event', async () => {
  const stop = new AbortController()
  const page = (resolvers.Subscription.mediaPage.subscribe as any)(undefined, { input: { search: 'the morning show' } }, { request: { signal: stop.signal } })
  await page.next()

  fanout.answer(['tvmaze:83119'])
  const drawn = await Promise.race([page.next(), new Promise(resolve => setTimeout(resolve, 1_000))]) as { value: { uri: string }[] } | undefined
  stop.abort()

  expect(drawn?.value.map(media => media.uri)).toEqual(['tvmaze:83119'])
})
