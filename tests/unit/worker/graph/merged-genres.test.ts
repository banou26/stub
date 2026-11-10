// Cowboy Bebop's title page, 2026-11-10 (STUB-393): AniList's Sci-Fi and JustWatch's Science-Fiction both listed, because
// the graph merged genres by case alone while the old read path went by `genreKey` (STUB-305). The rows are made up, and
// a film's, since JustWatch's series row is the show an anime run is part of rather than one of its members.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, title } from './plugins/fixtures'

const JUSTWATCH = media('jw:9001', {
  score: 0.5,
  type: 'MOVIE',
  categories: ['ANIME', 'MOVIE'],
  titles: [title('en', 'Cowboy Bebop: The Movie', 0.5)],
  startDate: '2001-09-01',
  genres: ['Action & Adventure', 'Science-Fiction', 'Sport', 'Animation'],
})
const ANILIST = media('anilist:9001', {
  score: 0.9,
  type: 'MOVIE',
  categories: ['ANIME', 'MOVIE'],
  titles: [title('en', 'Cowboy Bebop: The Movie', 0.9)],
  startDate: '2001-09-01',
  genres: ['Action', 'Adventure', 'Sci-Fi', 'Sports'],
})

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers(await Promise.all([ANILIST, JUSTWATCH].map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

// Mutation: key genres by case alone in `dedupeLabels`, and the page lists Science-Fiction and Sport too.
test('a title AniList and JustWatch both name lists Sci-Fi and Sports once, in AniList\'s spelling', async () => {
  expect((await resolveMedia('anilist:9001'))?.genres).toEqual(['Action', 'Adventure', 'Sci-Fi', 'Sports', 'Action & Adventure', 'Animation'])
})
