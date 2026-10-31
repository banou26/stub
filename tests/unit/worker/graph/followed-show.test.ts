// The Witcher opened from a search on 2026-10-31, in the order the answers landed: TVmaze's season attaches to the show,
// then JustWatch's show joins it on its title and date alone, so the page, drawn as the season, never names JustWatch.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { followedShowAddress, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, sameAs, title, type Row } from './plugins/fixtures'

const PAGE = 'ag:(imdb:tt5180504,simkl:1076658)'
const SEASON = 'tvmaze:28276-s1'

const facts = (score: number) => ({
  scope: 'CONTAINER',
  score,
  categories: ['SERIES'],
  startDate: '2019-12-20',
  titles: [title('en', 'The Witcher', score)],
})
const imdb = sameAs(media('imdb:tt5180504', { scope: 'CONTAINER' }))

const pass = async (rows: Row[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => { await enableGraph(true) }, 300_000)
afterAll(async () => { await closeGraph() })

// Mutation: answer the run's address instead of the show's and no read names JustWatch.
test('a show followed to its season keeps naming what joined the show after that', async () => {
  await pass([
    media('omdb:tt5180504', { ...facts(0.3), handles: [imdb] }),
    media('simkl:1076658', { ...facts(0.3), startDate: '2019-12-20T08:00:00Z', episodeCount: 32, handles: [imdb] }),
  ])
  expect(await followedShowAddress(PAGE), 'a show with no run is the page itself').toBe('')

  await pass([media(SEASON, { ...facts(0.3), scope: 'RUN', episodeCount: 8, handles: [imdb] })])
  await pass([media('jw:57327', { ...facts(0.2), handles: [sameAs(media('nf:80189685'))] })])

  expect((await resolveMedia(PAGE))?.uri, 'the page names the season alone').toBe(`ag:(${SEASON})`)
  expect(await followedShowAddress(PAGE)).toContain('jw:57327')
  expect(await followedShowAddress(`ag:(${SEASON})`), 'a season opened by its own address followed nothing').toBe('')
}, 60_000)
