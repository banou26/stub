// Squid Game season 1 from the address the site's search links: Watchmode's show row names two Netflix episodes as
// titles, and Netflix's season lands a pass later holding those two. Answers recorded on 2026-10-31, cut to what a row reads.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers, writeAskClaim } from '../../../../src/worker/graph/ingest'
import { episodesOf, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import ANSWERS from '../../../fixtures/watchmode/squid-game-answers.json'
import { answer } from './plugins/fixtures'

const PAGE = 'ag:(imdb:tt10919420,omdb:tt10919420,simkl:1360242,tmdb:93405,trakt:squid-game,tvdb:383275,tvmaze:43687,watchmode:03164600)'
const NETFLIX = ANSWERS.find(row => row.origin === 'nf')!
const BEFORE_NETFLIX = ANSWERS.filter(row => row !== NETFLIX)

const pass = async () => {
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers(await Promise.all(BEFORE_NETFLIX.map(row => answer('media', row))))
  await pass()
  await ingestAnswers([await answer('media', NETFLIX)])
  await writeAskClaim({
    fromUri: 'jw:220305-227597',
    toUri: NETFLIX.uri,
    kind: 'SAME_AS',
    claimer: 'nf',
    targetScope: NETFLIX.scope,
    node: { uri: NETFLIX.uri, origin: 'nf', id: NETFLIX.id, scope: NETFLIX.scope, titles: NETFLIX.titles },
  })
  await pass()
}, 300_000)

afterAll(async () => { await closeGraph() })

test('every row keeps its Netflix episode, those Watchmode named as titles included', async () => {
  const page = await resolveMedia(PAGE) as unknown as { _id: string, uri: string }
  expect(page.uri).toBe('ag:(jw:220305-227597,nf:81040344-1,tmdb:93405-s1,tvmaze:43687-s1)')
  const rows = await episodesOf(page._id) as unknown as { handles: { node: { uri: string, origin: string } }[] }[]
  expect(rows.map(row => row.handles.find(({ node }) => node.origin === 'nf')?.node.uri)).toEqual(NETFLIX.episodes.map(episode => episode.uri))
  expect(rows[0]!.handles.map(({ node }) => node.origin).sort()).toEqual(['jw', 'nf', 'tmdb', 'tvmaze'])
})
