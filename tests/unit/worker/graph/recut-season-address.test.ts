// Money Heist's first season at its own address, where only TMDB's season, JustWatch's show and Netflix's season 1 answer
// (recorded 2026-11-01 and 2026-11-02). JustWatch's show offers are checked against nothing, The Boys' lists another
// title's Roku Channel page, so the Netflix id its show names is no link.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import ANSWERS from '../../../fixtures/justwatch/money-heist-answers.json'
import { answer } from './plugins/fixtures'

const HEARD = ['tmdb:71446-s1', 'jw:56768', 'nf:80192098-1']

type Page = { handles: { relation: string, node: { uri: string, url?: string | null } }[] }

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers(await Promise.all(ANSWERS.filter(row => HEARD.includes(row.uri)).map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('with JustWatch\'s show the only one heard, the title links no Netflix, neither a season nor the show it names', async () => {
  const page = await resolveMedia('ag:(tmdb:71446-s1)') as unknown as Page
  expect(page.handles.map(({ relation, node }) => `${relation} ${node.uri} ${node.url ?? ''}`.trim())).toEqual([
    'SAME_AS tmdb:71446-s1 https://www.themoviedb.org/tv/71446',
    'PART_OF jw:56768 https://www.justwatch.com/us/tv-show/money-heist',
  ])
})
