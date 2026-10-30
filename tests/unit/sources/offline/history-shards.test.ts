// The shards `npm run data:build` generated, as the offline source loads them. Reads the real build's output, as
// season-window.test.ts reads the real season bundle, so the name the build writes and the one the loader asks
// for cannot drift apart.
import { expect, test, vi } from 'vite-plus/test'

import { loadShard } from '../../../../src/sources/offline/history-shards'

// a chunk that fails to load, as a stale deploy's can
vi.mock('../../../../src/generated/history/dump-005.ts', () => {
  throw new Error('a chunk that fails to load')
})

// Mutation: pad the shard number to two digits in `shardName`.
test('a generated shard loads under the name the history reader asks for, Cowboy Bebop in dump-001', async () => {
  const dump = await loadShard('dump', 1)
  expect(dump?.records['mal-1']).toEqual(['Cowboy Bebop', expect.stringContaining('19644')])
  expect(await loadShard('stub', 1)).toBeDefined()
})

// Mutation: drop the memo.
test('a shard is imported once and kept', () => {
  expect(loadShard('stub', 2)).toBe(loadShard('stub', 2))
})

// Mutations: answer an empty shard for one this build does not hold; let a failed load reject.
test('a shard this build does not hold, or one that fails to load, answers nothing', async () => {
  expect(await loadShard('dump', 999)).toBeUndefined()
  expect(await loadShard('dump', 5)).toBeUndefined()
  // control: the shard beside it loads
  expect(await loadShard('dump', 6)).toBeDefined()
})

// Mutation: write the `sources` field of another set into the dump's shards.
test('only the dump\'s shards carry the ODbL notice, and stub\'s credit what its merge took', async () => {
  const sources = async (set: 'dump' | 'stub') => ((await loadShard(set, 3)) as unknown as { sources: { name: string, license?: string }[] }).sources
  expect((await sources('dump')).map(source => source.license)).toEqual(['ODbL-1.0'])
  expect((await sources('stub')).map(source => source.name)).toEqual(expect.arrayContaining(['AniDB', 'Kitsu']))
  expect((await sources('stub')).map(source => source.license)).not.toContain('ODbL-1.0')
})
