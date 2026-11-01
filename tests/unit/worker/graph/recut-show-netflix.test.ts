// Money Heist's first season as the series site's search opens it. Its catalogues cut the show differently (TMDB's and
// TVmaze's season 1 has 15 episodes, Netflix's 13), so no Netflix season pairs with the run, while JustWatch's show is
// Netflix's. Answers recorded on 2026-11-01 on a local production build, cut to what the page's handles read.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers, writeAskClaim } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import ANSWERS from '../../../fixtures/justwatch/money-heist-answers.json'
import { answer } from './plugins/fixtures'

const RUN = 'tmdb:71446-s1'
const PAGE = `ag:(${RUN})`
const NETFLIX_SEASON = ANSWERS.find(row => row.uri === 'nf:80192098-1')!

type Page = { uri: string, handles: { relation: string, node: { uri: string, origin: string, url?: string | null } }[] }

const pass = async () => {
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

const handlesOf = async () => {
  const page = await resolveMedia(PAGE) as unknown as Page
  return page.handles.map(({ relation, node }) => `${relation} ${node.uri} ${node.url ?? ''}`.trim())
}

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers(await Promise.all(ANSWERS.map(row => answer('media', row))))
  await pass()
}, 300_000)

afterAll(async () => { await closeGraph() })

test('with no Netflix season paired, the title links Netflix\'s show, and only the streaming service', async () => {
  expect(await handlesOf()).toEqual([
    `SAME_AS ${RUN} https://www.themoviedb.org/tv/71446`,
    'PART_OF imdb:tt6468322 https://www.imdb.com/title/tt6468322',
    'PART_OF nf:80192098 https://www.netflix.com/title/80192098',
  ])
})

test('a run whose Netflix season paired keeps that season alone, with no second Netflix link', async () => {
  await writeAskClaim({
    fromUri: RUN,
    toUri: NETFLIX_SEASON.uri,
    kind: 'SAME_AS',
    claimer: 'nf',
    targetScope: NETFLIX_SEASON.scope,
    node: { uri: NETFLIX_SEASON.uri, origin: 'nf', id: NETFLIX_SEASON.id, scope: NETFLIX_SEASON.scope, titles: NETFLIX_SEASON.titles },
  })
  await pass()
  const handles = await handlesOf()
  expect(handles.filter(handle => handle.includes(' nf:'))).toEqual([`SAME_AS ${NETFLIX_SEASON.uri} https://www.netflix.com/title/80192098`])
})
