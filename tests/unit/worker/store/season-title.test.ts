// The Apothecary Diaries season 3, Frieren season 2 and Berserk (2016) as api.ani.zip and AniList
// answered on 2026-10-13 (AniList's asked for only the fields read here), through both extractors, the
// store's write and both stores' merge.
import { beforeEach, expect, test } from 'vite-plus/test'

import { resolvers as anilist } from '../../../../src/sources/anilist/extractor'
import { resolvers as anizip } from '../../../../src/sources/anizip/extractor'
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'
import { aggregateMedia, recursivelyUnwrapMediaHandles } from '../../../../src/worker/store/aggregate'
import { findAggregatedMedia, resetStore, upsertMedia } from '../../../../src/worker/store/db'
import { normalizeToStoreMedia } from '../../../../src/worker/store/normalize'
import ANILIST_APOTHECARY from '../../../fixtures/anilist/apothecary-diaries-season-3.json'
import ANILIST_BERSERK from '../../../fixtures/anilist/berserk-2016.json'
import ANILIST_FRIEREN from '../../../fixtures/anilist/frieren-season-2.json'
import ANIZIP_APOTHECARY from '../../../fixtures/anizip/apothecary-diaries-season-3.json'
import ANIZIP_BERSERK from '../../../fixtures/anizip/berserk-2016.json'
import ANIZIP_FRIEREN from '../../../fixtures/anizip/frieren-season-2.json'

const answer = async (resolvers: typeof anizip, uri: string, body: unknown) => {
  const context = { fetch: async () => ({ status: 200, json: async () => body }) }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return value.media
}

// what `mediaInserter` in worker/extractor.ts does with the two answers, then each store's merge
const titles = async (
  anizipAnswer: { mappings: { mal_id: number } },
  anilistAnswer: { data: { Media: { id: number } } },
) => {
  const medias = [
    await answer(anizip, `ag:(mal:${anizipAnswer.mappings.mal_id})`, anizipAnswer),
    await answer(anilist, `anilist:${anilistAnswer.data.Media.id}`, anilistAnswer),
  ]
  const rows = medias.flatMap(recursivelyUnwrapMediaHandles)
  const pairs = rows.flatMap(row => (row.handles ?? []).map(handle => ({
    mediaUri: row.uri, handleUri: handle.node.uri, relation: handle.relation,
  })))
  await upsertMedia(rows.map(normalizeToStoreMedia) as any, pairs)

  const cluster = await findAggregatedMedia(`anilist:${anilistAnswer.data.Media.id}`)
  expect(cluster.map(row => row.origin), 'ani.zip and AniList describe one season').toEqual(expect.arrayContaining(['anilist', 'anizip']))
  const graph = aggregateFields({
    cluster: {
      id: 'cl:test', aggUri: 'ag:(test)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    members: cluster.map(row => ({
      uri: row.uri, origin: row.origin, id: row.id, owned: true, score: row.score ?? null, raw: row as any, fieldSeq: {},
    })),
    related: [],
    relations: [],
    locationOrigin: '',
  })
  return {
    legacy: aggregateMedia(cluster, '').titles.map(({ title }) => title),
    graph: (graph.titles as { title: string }[]).map(({ title }) => title),
  }
}

beforeEach(() => { resetStore() })

// ani.zip names the season "The Apothecary Diaries (2026)" at 0.9, over AniList's 0.8
test('a season is shown by its own name, not by its show\'s name and a year', async () => {
  const { legacy, graph } = await titles(ANIZIP_APOTHECARY, ANILIST_APOTHECARY)
  expect(legacy[0]).toBe('The Apothecary Diaries Season 3')
  expect(graph[0]).toBe('The Apothecary Diaries Season 3')
  expect(legacy, 'the year title is still one of its titles').toContain('The Apothecary Diaries (2026)')
})

test('Frieren\'s second season is shown as its second season', async () => {
  const { legacy, graph } = await titles(ANIZIP_FRIEREN, ANILIST_FRIEREN)
  expect(legacy[0]).toBe('Frieren: Beyond Journey’s End Season 2')
  expect(graph[0]).toBe('Frieren: Beyond Journey’s End Season 2')
})

// the control: nothing names a season, and the year is what tells this run from the 1997 Berserk
test('a remake known by its year keeps it when nothing names a season', async () => {
  const { legacy, graph } = await titles(ANIZIP_BERSERK, ANILIST_BERSERK)
  expect(legacy[0]).toBe('Berserk (2016)')
  expect(graph[0]).toBe('Berserk (2016)')
})
