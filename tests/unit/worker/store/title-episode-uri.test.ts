// A Prime Video film plays under its title's gti, and a Prime season's first episode under the season's,
// so JustWatch hands the legacy store one uri as a media AND as an episode. The store keeps media and
// episodes in one graph, where a node with both labels throws, and that throw used to drop every
// episode after it in the batch.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { resolvers } from '../../../../src/sources/justwatch/extractor'
import { recursivelyUnwrapMediaHandles } from '../../../../src/worker/store/aggregate'
import { findAggregatedMedia, findPartOfMedia, graph, resetStore, upsertEpisodes, upsertMedia } from '../../../../src/worker/store/db'
import { normalizeToStoreMedia } from '../../../../src/worker/store/normalize'
import THE_BOYS from '../../../fixtures/justwatch/the-boys.json'
import SALTBURN from '../../../fixtures/justwatch/saltburn.json'

beforeEach(() => {
  resetStore()
  vi.stubEnv('TZ', 'America/New_York')
  return () => { vi.unstubAllEnvs() }
})

const open = async (answer: unknown, uri: string): Promise<GQLMedia> => {
  const context = { fetch: async () => ({ json: async () => answer }) }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return value.media
}

const ingestMedia = (media: GQLMedia) => {
  const rows = recursivelyUnwrapMediaHandles(media)
  const claims = rows.flatMap(row => row.handles.map(({ relation, node }) => ({ mediaUri: row.uri, handleUri: node.uri, relation })))
  return upsertMedia(rows.map(normalizeToStoreMedia), claims)
}

const ingestEpisodes = (media: GQLMedia) => upsertEpisodes(media.episodes as any, [])

const stored = (origin: string) => [...graph.labeled('episode')].filter(uri => uri.startsWith(`${origin}:`))

test('every JustWatch episode lands when a title and its first episode share a uri', async () => {
  const boys = await open(THE_BOYS, 'jw:78125-104253')
  await ingestMedia(boys)
  await ingestEpisodes(boys)
  expect(stored('jw')).toHaveLength(8)

  const saltburn = await open(SALTBURN, 'jw:1349029')
  await ingestMedia(saltburn)
  await ingestEpisodes(saltburn)
  expect(stored('hbo')).toEqual(['hbo:7c9a9a6d-2383-483a-b59a-603b1eab3d20'])
})

test('and a title still lands when its uri was stored as an episode first', async () => {
  const boys = await open(THE_BOYS, 'jw:78125-104253')
  await ingestEpisodes(boys)
  await ingestMedia(boys)
  expect(stored('jw')).toHaveLength(8)
  const season = await findAggregatedMedia('jw:78125-104253')
  expect(season.map(media => media.uri)).toContain('jw:78125-104253')
  expect(findPartOfMedia(season).filter(media => graph.labeled('episode').has(media.uri)), 'an episode is no title').toEqual([])
})
