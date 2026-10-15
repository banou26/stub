// A cluster that welded two titles, then split when a later answer contested the row joining them.
// Title A's rows keep the cluster id, so Title A's card keeps the whole old address, which names more
// of Title B's rows than of its own.
import { afterAll, beforeAll, beforeEach, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { clearReadCache, pageClusters, resolveMedia, setReadStore } from '../../../../src/worker/graph/read'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, episode, media, rowsOf, sameAs, title } from './plugins/fixtures'

const A = { type: 'TV', episodeCount: 12, titles: [title('en', 'Title A')] }
const B = { type: 'TV', episodeCount: 24, titles: [title('en', 'Title B')] }

const settle = async (rows: Record<string, unknown>[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' })
  await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' })
}

const clusterIdOf = async (uri: string) =>
  String((await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri }))[0]?.id)

let welded = ''

beforeAll(async () => {
  setReadStore('graph')
  await enableGraph(true)
  resetPassState()
  await settle([
    media('anilist:1', { ...A, handles: [sameAs(media('mal:4'))] }),
    media('anidb:11', { ...A, handles: [sameAs(media('anilist:1'))] }),
    media('mal:4', { ...B, episodes: Array.from({ length: 24 }, (_, index) => episode(`mal:4-${index + 1}`, 'mal:4', { episodeNumber: index + 1 })) }),
    media('kitsu:3', { ...B, handles: [sameAs(media('mal:4'))] }),
    media('livechart:5', { ...B, handles: [sameAs(media('mal:4')), sameAs(media('kitsu:3'))] }),
    media('offline:mal-4', { ...B, handles: [sameAs(media('mal:4')), sameAs(media('kitsu:3'))] }),
    media('ann:13', { ...B, handles: [sameAs(media('kitsu:3'))] }),
  ])
  welded = await clusterIdOf('anilist:1')
  await settle([media('kitsu:12', { ...A, handles: [sameAs(media('anilist:1'))] })])
}, 120_000)

beforeEach(() => { clearReadCache() })

afterAll(async () => {
  setReadStore('legacy')
  await closeGraph()
})

test('the fixture splits Title A off with the old id and Title B into a cluster of its own', async () => {
  expect(await clusterIdOf('anilist:1')).toBe(welded)
  expect(await clusterIdOf('ann:13')).not.toBe(welded)
  expect(await clusterIdOf('ann:13')).toBe(await clusterIdOf('kitsu:3'))
})

test('every card opens its own title, the one that kept the old address included', async () => {
  const cards = await pageClusters(undefined)
  expect(cards.map(card => card._id)).toEqual(expect.arrayContaining([welded, await clusterIdOf('ann:13')]))
  for (const card of cards) {
    clearReadCache()
    expect((await resolveMedia(card.uri))?._id, card.uri).toBe(card._id)
  }
})
