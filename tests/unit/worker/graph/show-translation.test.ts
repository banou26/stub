// Labyrinth of Peace (Frieden) opened from a search, 2026-11-10: TheTVDB knows only the show, so its title and overview
// in the viewer's language reached the search card, while the page, which follows the show to TMDB's first season,
// stayed English. TheTVDB's rows are its extractor's own over the recorded searches (tests/unit/sources/tvdb), and the
// two seasons are TMDB's as it names them, each with the show's title; the second is made up, two years on, and so is
// Breaking Bad's run with a name of its own.
import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { resolvers as tvdb } from '../../../../src/sources/tvdb/extractor'
import { synopsesIn, translationFirst } from '../../../../src/sources/translations'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, sameAs, title, type Row } from './plugins/fixtures'

const OWN = 'The run\'s own synopsis.'

const tvdbRow = async (language: string, id = '391612'): Promise<Row> => {
  const search = JSON.parse(readFileSync(new URL(`../../sources/tvdb/__fixtures__/series-${id}.json`, import.meta.url), 'utf8'))
  const context = { language, fetch: async () => ({ json: async () => search }) }
  const { value } = await (tvdb.Subscription as any).media.subscribe(undefined, { input: { uri: `tvdb:${id}` } }, context).next()
  return JSON.parse(JSON.stringify(value.media))
}

const runRow = (uri: string, name: string, startDate: string, imdb: string) => media(uri, {
  score: 0.3,
  categories: ['SERIES'],
  startDate,
  titles: [title('en', name, 0.3)],
  descriptions: [{ language: 'en', description: OWN, score: 0.3 }],
  shortDescriptions: [{ language: 'en', shortDescription: OWN, score: 0.3 }],
  handles: [sameAs(media(`imdb:${imdb}`, { scope: 'CONTAINER' }))],
})

const season = (number: number, startDate: string) => runRow(`tmdb:112370-s${number}`, 'Labyrinth of Peace', startDate, 'tt10639680')

const pass = async (rows: Row[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

/** The page `uri` opens, as the title resolvers answer a viewer reading `language`. */
const shown = async (uri: string, language: string) => {
  const page = (await resolveMedia(uri))!
  return {
    page: page.uri,
    titles: translationFirst(page.titles as { language: string, title: string }[], language).map(({ title }) => title),
    synopses: synopsesIn(page.descriptions as { language: string, description: string }[], language).map(({ description }) => description),
  }
}

beforeAll(async () => {
  await enableGraph(true)
  await pass([season(1, '2020-11-08'), season(2, '2022-11-06'), await tvdbRow('en-US')])
}, 300_000)

afterAll(async () => { await closeGraph() })

// Mutation: hand the first season the show's every title and synopsis, and the page carries TheTVDB's "Frieden" and its
// longer English overview.
test('an English viewer\'s first season reads as before', async () => {
  expect(await shown('tvdb:391612', 'en-US')).toEqual({ page: 'ag:(tmdb:112370-s1)', titles: ['Labyrinth of Peace'], synopses: [OWN] })
})

// Runs after the English one, as a viewer switching to French: TheTVDB's French answer replaces its English one.
// Mutation: hand `aggregateFields` no `show`, and the page reads English.
test('a French viewer\'s first season reads TheTVDB\'s French title and overview of the show', async () => {
  await pass([await tvdbRow('fr-FR')])
  const page = await shown('tvdb:391612', 'fr-FR')
  expect(page.page).toBe('ag:(tmdb:112370-s1)')
  expect(page.titles).toEqual(['Le prix de la paix', 'Labyrinth of Peace'])
  expect(page.synopses).toEqual([expect.stringMatching(/^Printemps 1945 - enfin la paix en Europe\./)])
})

// Mutation: hand the show to every run attached to it rather than its `preferredRun`, and the second season reads French.
test('a later season reads none of the show\'s translation', async () => {
  expect(await shown('tmdb:112370-s2', 'fr-FR')).toEqual({ page: 'ag:(tmdb:112370-s2)', titles: ['Labyrinth of Peace'], synopses: [OWN] })
})

// Mutation: drop the name check from `translationsOf` (plugins/fields.ts), and the run reads TheTVDB's French overview.
test('a first run with a name of its own reads none of the show\'s translation', async () => {
  await pass([runRow('tmdb:1396-s1', 'Breaking Bad: Original Minisodes', '2009-02-17', 'tt0903747'), await tvdbRow('fr-FR', '81189')])
  expect(await shown('tvdb:81189', 'fr-FR')).toEqual({ page: 'ag:(tmdb:1396-s1)', titles: ['Breaking Bad: Original Minisodes'], synopses: [OWN] })
})
