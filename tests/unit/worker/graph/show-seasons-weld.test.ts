// TMDB names every season by the bare show title, so plugin:title tells two of its seasons apart by
// their dates alone. Two seasons premiering within 45 days, or in one calendar year with either on the
// 1st of a month (read as a month or a year, which silences the 45 day gate), weld into one run: the
// same gap TVmaze's own seasons already have.
// THE KNOWN GAP, pinned as the gap it is. Closing it belongs to plugin:title (a '-s<n>' id naming a
// different season of the same show is a disagreement), and if it goes red, something closed it.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, title } from './plugins/fixtures'

const run = (uri: string, name: string, startDate: string, episodeCount: number) =>
  media(uri, { categories: ['SERIES'], titles: [title('en', name)], startDate, episodeCount })

beforeAll(async () => {
  await enableGraph(true)
  const rows = [
    run('tvmaze:1-s1', 'First Of The Month', '2021-10-01', 9),
    run('tmdb:1-s1', 'First Of The Month', '2021-10-01', 9),
    run('tmdb:1-s2', 'First Of The Month', '2021-12-15', 7),
    run('tvmaze:2-s1', 'Middle Of The Month', '2021-09-17', 9),
    run('tmdb:2-s1', 'Middle Of The Month', '2021-09-17', 9),
    run('tmdb:2-s2', 'Middle Of The Month', '2021-12-15', 7),
  ]
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

const members = async (uri: string) => {
  const page = await resolveMedia(uri) as { handles: { relation: string, node: { uri: string } }[] } | undefined
  return page?.handles.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri).sort()
}

test('KNOWN GAP: two seasons in one year, one premiering on the 1st, weld into one run', async () => {
  expect(await members('tvmaze:1-s1')).toEqual(['tmdb:1-s1', 'tmdb:1-s2', 'tvmaze:1-s1'])
})

test('control: the same seasons premiering mid-month, months apart, stay apart', async () => {
  expect(await members('tvmaze:2-s1')).toEqual(['tmdb:2-s1', 'tvmaze:2-s1'])
})
