/**
 * A JustWatch season as the graph files it, from the row the real extractor answers for The Boys
 * season 1 (`tests/fixtures/justwatch/the-boys.json`, a viewer in the US).
 *
 * The Prime Video episode JustWatch hangs beside its own has to share JustWatch's slot, or the episode
 * row never carries the link that plays it, and it must not count as one more episode of the season,
 * or the season reads as sixteen long to every count gate.
 */
import { afterAll, beforeAll, expect, test, vi } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { episodesOf } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { resolvers } from '../../../../src/sources/justwatch/extractor'
import THE_BOYS from '../../../fixtures/justwatch/the-boys.json'
import { answer, rowsOf } from './plugins/fixtures'

const SEASON = 'jw:78125-104253'

beforeAll(async () => {
  vi.stubEnv('TZ', 'America/New_York')
  const context = { fetch: async () => ({ json: async () => THE_BOYS }) }
  const subscribe = (resolvers.Subscription as never as { media: { subscribe: Function } }).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: SEASON } }, context).next()

  await enableGraph(true)
  await ingestAnswers([await answer('media', JSON.parse(JSON.stringify(value.media)))])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => {
  vi.unstubAllEnvs()
  await closeGraph()
})

test('an episode row carries the Prime Video episode that plays it', async () => {
  const [cluster] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri: SEASON })
  const episodes = await episodesOf(String(cluster!.id))
  expect(episodes).toHaveLength(8)
  expect(Object.fromEntries(episodes[1]!.handles.map(({ node }) => [node.uri, node.url ?? null]))).toEqual({
    'amazon:amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9': 'https://watch.amazon.com/watch?gti=amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9',
    'jw:1801675': null,
  })
})

test('the season counts JustWatch\'s own episodes, not the services\' beside them', async () => {
  const [profile] = await rowsOf(
    'MATCH (p:MediaProfile)-[:PROFILE_OF]->(m:Media {uri: $uri}) RETURN p.countStated AS stated, p.countDistinct AS listed',
    { uri: SEASON }
  )
  expect([profile!.stated, profile!.listed]).toEqual([8, 8])
})
