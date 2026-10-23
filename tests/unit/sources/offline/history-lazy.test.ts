// The history's shard map (384 chunks) is imported on the first lookup of an older show, so it stays out of the
// worker every page starts, and a failure to import it leaves the offline source's answer as it was without it.
import { expect, test, vi } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/offline/extractor'

const state = vi.hoisted(() => ({ imported: false }))

vi.mock('../../../../src/generated/anime-index', () => ({
  default: { mal: [1], anilist: [1], kitsu: [1], anidb: [23], ann: [13] },
}))
vi.mock('../../../../src/generated/anime-seasons', () => ({ default: { tag: 'test', updated: '', seasons: {} } }))
// a chunk that fails to load, as a stale deploy's can
vi.mock('../../../../src/sources/offline/history-shards', () => {
  state.imported = true
  throw new Error('a chunk that fails to load')
})

const mediaOf = async (uri: string) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, { fetch: async () => new Response(null, { status: 404 }) } as never).next()
  return value.media
}

// Mutations: import the shard map with the extractor; let its failure reject the answer.
test('the shard map is imported on the first history lookup, and a failure answers the index row alone', async () => {
  expect(state.imported).toBe(false)
  const media = await mediaOf('mal:1')
  // control: the lookup did reach the import
  expect(state.imported).toBe(true)
  expect([media.titles, media.handles.map(({ node }: { node: { uri: string } }) => node.uri)]).toEqual([[], ['mal:1', 'anilist:1', 'kitsu:1', 'anidb:23', 'ann:13']])
})
