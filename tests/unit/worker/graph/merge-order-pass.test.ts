// A merge order handed to the worker re-merges every cluster in a pass of its own, which ends in the `view:changed`
// that redraws what is on screen; the clustering and the length vote do not move with it.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph, setMergeOrder } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { passSettled, schedulePass, schedulerStats, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { listen } from '../../../../src/worker/store/events'
import { answer, media, rowsOf, sameAs, title } from './plugins/fixtures'

const cluster = async () => {
  const [row] = await rowsOf(`MATCH (m:Media {uri: 'mal:1030'})-[:MEMBER_OF]->(c:Cluster)
    RETURN c.id AS id, c.media AS media, c.card AS card, c.runLength AS runLength, c.runLengthTier AS tier, c.aggUri AS aggUri`)
  const parse = (value: unknown) => JSON.parse(String(value)) as { titles: { title: string }[] }
  return {
    id: row?.id,
    facts: [row?.aggUri, row?.runLength, row?.tier],
    titles: parse(row?.media).titles.map(entry => entry.title),
    cardTitles: parse(row?.card).titles.map(entry => entry.title),
  }
}

beforeAll(async () => {
  await enableGraph(true)
  startScheduler({ audit: true })
  await ingestAnswers([
    await answer('media', media('mal:1030', { score: 0.9, episodeCount: 12, titles: [title('en', 'Merge Show MyAnimeList', 0.9)] })),
    await answer('media', media('anilist:1030', {
      score: 0.8, episodeCount: 12, titles: [title('en', 'Merge Show AniList', 0.8)], handles: [sameAs(media('mal:1030'))],
    })),
  ])
  await schedulePass('boot')
}, 300_000)

afterAll(async () => {
  await passSettled()
  stopScheduler()
  await closeGraph()
})

// Mutations: drop `order` from the plugin's aggregateFields call, or the pass from `setMergeOrder`, and the titles stay
// MyAnimeList's; hold the order without comparing it and a repeat runs a pass.
test('a new order re-merges in a pass that wakes the cluster\'s readers, and the same order again runs none', async () => {
  const before = await cluster()
  expect([before.titles[0], before.cardTitles[0]]).toEqual(['Merge Show MyAnimeList', 'Merge Show MyAnimeList'])

  const woken: string[][] = []
  const stop = listen('view:changed', ({ clusters }) => { woken.push(clusters) })
  const passes = schedulerStats().passes
  await setMergeOrder(['anilist'])
  const after = await cluster()
  expect([after.titles[0], after.cardTitles[0]]).toEqual(['Merge Show AniList', 'Merge Show AniList'])
  expect(woken.flat()).toContain(before.id)
  expect([after.id, after.facts], 'the clustering and the length vote stay').toEqual([before.id, before.facts])
  expect(schedulerStats().passes).toBe(passes + 1)

  await setMergeOrder(['anilist', 'nyaa'])
  expect(schedulerStats().passes, 'the order followed is the same').toBe(passes + 1)

  await setMergeOrder([])
  expect((await cluster()).titles[0]).toBe('Merge Show MyAnimeList')
  stop()
}, 120_000)
