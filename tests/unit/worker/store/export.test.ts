// The export must see only what a source ASSERTED through a handle, never what the fuzzy pass guessed,
// and never anything a plugin said.
// Rows are built the way worker/extractor.ts builds them, through the real `recursivelyUnwrapMediaHandles`
// and `normalizeToStoreMedia`.
import { beforeEach, expect, test } from 'vite-plus/test'

import { makeMedia, partOf, sameAs } from '../../../../src/sources/utils'
import { recursivelyUnwrapMediaHandles } from '../../../../src/worker/store/aggregate'
import { findAggregatedMedia, linkSameMediaPairs, resetStore, upsertEpisodes, upsertMedia } from '../../../../src/worker/store/db'
import { exportStore } from '../../../../src/worker/store/export'
import { normalizeToStoreMedia } from '../../../../src/worker/store/normalize'

const described = (uri: string, scope: 'RUN' | 'CONTAINER' = 'RUN', title = uri) =>
  makeMedia({
    origin: uri.slice(0, uri.indexOf(':')),
    id: uri.slice(uri.indexOf(':') + 1),
    scope,
    url: `https://example.test/${uri}`,
    titles: [{ language: 'en', title, score: 0.5 }],
  })

/** a handle node the way a bare source mints one: identity, scope and url only */
const handleNode = (uri: string) =>
  makeMedia({ origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), url: `https://example.test/${uri}` })

const episode = (uri: string, mediaUri: string) => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  mediaUri,
  titles: [{ language: 'en', title: uri, score: 1 }],
  episodeNumber: 1,
}) as any

const insert = async (...medias: ReturnType<typeof makeMedia>[]) => {
  const rows = medias.flatMap(recursivelyUnwrapMediaHandles)
  const pairs = rows.flatMap(row => (row.handles ?? []).map(handle => ({
    mediaUri: row.uri, handleUri: handle.node.uri, relation: handle.relation,
  })))
  await upsertMedia(rows.map(normalizeToStoreMedia) as any, pairs)
}

const memberUris = (cluster: { members: { uri: string }[] }) => cluster.members.map(m => m.uri).sort()
const clustersOf = async (excludeOrigins: string[] = []) =>
  (await exportStore({ excludeOrigins })).clusters.map(memberUris).sort()

beforeEach(() => { resetStore() })

test('a handle-asserted union is one exported cluster', async () => {
  const anilist = described('anilist:1')
  anilist.handles = [sameAs(described('kitsu:2'))]
  await insert(anilist)
  expect(await clustersOf()).toEqual([['anilist:1', 'kitsu:2']])
})

test('a union the fuzzy pass made is two exported clusters', async () => {
  await insert(described('anilist:1'), described('kitsu:2'))
  linkSameMediaPairs([['anilist:1', 'kitsu:2']])
  expect((await findAggregatedMedia('anilist:1')).map(m => m.uri).sort(), 'the store itself holds one cluster').toEqual(['anilist:1', 'kitsu:2'])
  expect(await clustersOf(), 'the export does not').toEqual([['anilist:1'], ['kitsu:2']])
})

test('an excluded origin is dropped and never walked through', async () => {
  const plugin = described('p:1')
  plugin.handles = [sameAs(described('anilist:1')), sameAs(described('mal:2'))]
  await insert(plugin)
  expect(await clustersOf(), 'control: with nothing excluded the plugin bridges one cluster of three').toEqual([['anilist:1', 'mal:2', 'p:1']])
  expect(await clustersOf(['p']), 'the bridge is gone with it').toEqual([['anilist:1'], ['mal:2']])
})

test('a container with no run is not a cluster, a run exports its asserted PART_OF target', async () => {
  await insert(described('cr:SHOW', 'CONTAINER'))
  expect(await clustersOf()).toEqual([])

  const run = described('anilist:1')
  run.handles = [partOf(described('cr:SERIES', 'CONTAINER'))]
  await insert(run)
  const { clusters } = await exportStore({ excludeOrigins: [] })
  expect(clusters.map(memberUris)).toEqual([['anilist:1']])
  expect(clusters[0]!.partOf.map(m => [m.uri, m.scope])).toEqual([['cr:SERIES', 'CONTAINER']])
})

test('episodes of a member ride along, episodes of an excluded origin do not', async () => {
  const anilist = described('anilist:1')
  anilist.handles = [sameAs(described('p:1'))]
  await insert(anilist)
  await upsertEpisodes([episode('anilist:1-1', 'anilist:1'), episode('p:1-1', 'p:1')], [])

  const all = await exportStore({ excludeOrigins: [] })
  expect(all.clusters[0]!.episodes.map(e => e.uri)).toEqual(['anilist:1-1', 'p:1-1'])
  const withoutPlugin = await exportStore({ excludeOrigins: ['p'] })
  expect(withoutPlugin.clusters[0]!.episodes.map(e => e.uri)).toEqual(['anilist:1-1'])
})

test('the envelope is well formed', async () => {
  const out = await exportStore({ excludeOrigins: ['zeta', 'alpha'] })
  expect(Number.isFinite(Date.parse(out.exportedAt))).toBe(true)
  expect(out.excludedOrigins).toEqual(['alpha', 'zeta'])
})

test('a claim that waited for its row is recorded as asserted when it lands', async () => {
  const run = described('anilist:1')
  run.handles = [sameAs(handleNode('kitsu:2'))]
  await insert(run)
  expect(await clustersOf(), 'a handle node carrying a url is a description, so it is asserted at once').toEqual([['anilist:1', 'kitsu:2']])

  const late = described('mal:3')
  late.handles = [sameAs(makeMedia({ origin: 'jw', id: 'ts9' }))]
  await insert(late)
  expect(await clustersOf(), 'a bare placeholder is not stored and its claim waits').toEqual([['anilist:1', 'kitsu:2'], ['mal:3']])

  await insert(described('jw:ts9'))
  expect(await clustersOf(), 'the replayed claim counts').toEqual([['anilist:1', 'kitsu:2'], ['jw:ts9', 'mal:3']])
})
