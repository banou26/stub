// Re:ZERO Season 4, shaped on what the Spring 2026 page and the show's own page answered on
// 2026-10-15, cut to five rows. Kitsu's Break Time short names AniList's Season 4 id as its own, so
// `anilist:189046` has two claimants that disagree and is refused to both. AniList's row here claims
// no MyAnimeList id, so nothing settles the contest and the row stays a cluster of its own; its
// PART_OF to the show is what the show's page adds.
import { afterAll, beforeAll, beforeEach, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { clearReadCache, episodesOf, pageClusters, resolveMedia, setReadStore } from '../../../../src/worker/graph/read'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { traceGraph } from '../../../../src/worker/graph/trace'
import { answer, episode, media, partOf, rowsOf, sameAs, title } from './plugins/fixtures'

const SEASON = { type: 'TV', episodeCount: 19, startDate: '2026-04-08', season: 'SPRING', seasonYear: 2026, titles: [title('en', 'Re:ZERO Season 4')] }
const BREAK_TIME = { type: 'ONA', episodeCount: 19, startDate: '2026-04-15', season: 'SPRING', seasonYear: 2026, titles: [title('en', 'Re:ZERO Break Time Season 4')] }
const ADDRESS = 'ag:(anilist:189046,kitsu:49746,mal:61316)'

const episodes = (uri: string, count: number) =>
  Array.from({ length: count }, (_, index) =>
    episode(`${uri}-e${index + 1}`, uri, { episodeNumber: index + 1, titles: [title('en', `Episode ${index + 1}`)] }))

beforeAll(async () => {
  setReadStore('graph')
  await enableGraph(true)
  await ingestAnswers(await Promise.all([
    media('anilist:189046', { ...SEASON, handles: [partOf(media('jw:41257', { titles: [title('en', 'Re:ZERO')] }))] }),
    media('mal:61316', { ...SEASON, episodes: episodes('mal:61316', 19) }),
    media('kitsu:49746', { ...SEASON, handles: [sameAs(media('anilist:189046')), sameAs(media('mal:61316'))] }),
    media('kitsu:50665', { ...BREAK_TIME, handles: [sameAs(media('anilist:189046')), sameAs(media('mal:63830'))] }),
    media('mal:63830', BREAK_TIME),
  ].map(row => answer('media', row))))
  resetPassState()
  await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' })
  await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' })
}, 120_000)

beforeEach(() => { clearReadCache() })

afterAll(async () => {
  setReadStore('legacy')
  await closeGraph()
})

const clusterIdOf = async (uri: string) =>
  String((await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri }))[0]?.id)

test('the fixture keeps AniList\'s row apart from the season holding the episodes', async () => {
  expect(await clusterIdOf('anilist:189046')).not.toBe(await clusterIdOf('mal:61316'))
  expect(await clusterIdOf('kitsu:49746')).toBe(await clusterIdOf('mal:61316'))
  expect((await episodesOf(await clusterIdOf('mal:61316'))).length).toBe(19)
})

test('a contested row stays off the listing when its only other link is its own PART_OF to the show', async () => {
  const cards = (await pageClusters(undefined)).map(card => card._id)
  expect(cards).toContain(await clusterIdOf('mal:61316'))
  expect(cards).not.toContain(await clusterIdOf('anilist:189046'))
})

test('an address split across two clusters opens the visible one, episodes and all', async () => {
  const view = await resolveMedia(ADDRESS)
  expect(view?._id).toBe(await clusterIdOf('mal:61316'))
  expect((await episodesOf(String(view?._id))).length).toBe(19)
  expect((await traceGraph(ADDRESS)).resolved?.clusterId, 'the trace names the cluster the modal opens').toBe(view?._id)
})

test('the control: a lone uri still opens its own cluster', async () => {
  expect((await resolveMedia('anilist:189046'))?._id).toBe(await clusterIdOf('anilist:189046'))
  expect((await traceGraph('anilist:189046')).resolved?.clusterId).toBe(await clusterIdOf('anilist:189046'))
})
