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
import { answer, episode, media, rowsOf, sameAs, title } from './plugins/fixtures'

const RUN = 'tmdb:71446-s1'
const PAGE = `ag:(${RUN})`
const NETFLIX_SEASON = ANSWERS.find(row => row.uri === 'nf:80192098-1')!

type Page = { uri: string, handles: { relation: string, node: { uri: string, origin: string, url?: string | null } }[] }

const pass = async () => {
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

const handlesOf = async (page = PAGE) => {
  const view = await resolveMedia(page) as unknown as Page
  return view.handles.map(({ relation, node }) => `${relation} ${node.uri} ${node.url ?? ''}`.trim())
}

// A catalogue season that folds a cour: Crunchyroll's 23 rows hold the cour's 11, which HIDIVE also lists as a season
const FOLD = 'cr:G24H1N3MP-G609CX3J4'
const COUR = 'anilist:108465'
const COUR_DAYS = Array.from({ length: 11 }, (_, index) => new Date(Date.UTC(2021, 0, 10 + index * 7)).toISOString().slice(0, 10))
const foldAnswers = () => Promise.all([
  media(COUR, {
    type: 'TV', episodeCount: 11, startDate: COUR_DAYS[0], titles: [title('en', 'Mushoku Tensei')],
    handles: [
      sameAs(media('anizip:14758')),
      sameAs(media('hidive:mushoku-tensei')),
      { relation: 'PART_OF', node: media(FOLD) },
    ],
  }),
  media('anizip:14758', {
    type: 'TV', episodeCount: 11, titles: [title('en', 'Mushoku Tensei')],
    episodes: COUR_DAYS.map((day, index) => episode(`anizip:14758-${index + 1}`, 'anizip:14758', { episodeNumber: index + 1, releaseDate: day })),
  }),
  media('hidive:mushoku-tensei', { type: 'TV', episodeCount: 11, titles: [title('en', 'Mushoku Tensei')] }),
  media(FOLD, {
    type: 'TV', episodeCount: 23, titles: [title('en', 'Mushoku Tensei Season 1')],
    episodes: Array.from({ length: 23 }, (_, index) =>
      episode(`cr:G609CX3J4-${index + 1}`, FOLD, { episodeNumber: index + 1, releaseDate: COUR_DAYS[index] })),
  }),
].map(row => answer('media', row)))

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([...await Promise.all(ANSWERS.map(row => answer('media', row))), ...await foldAnswers()])
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

test('a season that includes a run links no streaming service of that run, which is a part of it and not its show', async () => {
  const includes = await rowsOf(
    `MATCH (:Media {uri: $from})-[l:LINK {kind: 'INCLUDES', status: 'active'}]->(:Media {uri: $to}) RETURN l.reason AS reason`,
    { from: FOLD, to: COUR }
  )
  expect(includes).toHaveLength(1)
  expect((await handlesOf(`ag:(${COUR})`)).filter(handle => handle.includes(' hidive:'))).toEqual(['SAME_AS hidive:mushoku-tensei'])
  expect(await handlesOf(`ag:(${FOLD})`)).toEqual([`SAME_AS ${FOLD}`, `INCLUDES ${COUR}`])
})
