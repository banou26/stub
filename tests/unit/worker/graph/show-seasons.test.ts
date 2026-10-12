// A live-action show's card is a CONTAINER: TMDB answers it as the show with its season list, and each
// season as its own run. The answers go through the real ingest and one real pass.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import { resolvers } from '../../../../src/sources/tmdb/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { pageClusters, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, title } from './plugins/fixtures'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')

// the card TMDB's search answers, which is the show
const CARD = media('tmdb:93405', { scope: 'CONTAINER', categories: ['SERIES'], titles: [title('en', 'Squid Game')] })

/** What TMDB answers for `uri` once the show's card is in the store. */
const ask = async (uri: string) => {
  const context = {
    findAggregatedMedia: async () => CARD,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string) => ({
      text: async () =>
        url.startsWith('https://www.themoviedb.org/tv/93405/seasons?') ? fixture('seasons-squid-game')
        : url.startsWith('https://www.themoviedb.org/tv/93405?') ? fixture('show-squid-game')
        : '',
    }),
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri } }, context).next()
  return value.media
}

beforeAll(async () => {
  await enableGraph(true)
  const rows = [CARD, await ask('tmdb:93405'), await ask('tmdb:93405-s2'), await ask('tmdb:93405-s3')]
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('the show still lists once two of its seasons are stored', async () => {
  const ids = async (uris?: string[]) => (await pageClusters(uris)).map(card => card._id)
  expect(await ids(['tmdb:93405'])).toEqual(['cl:tmdb:93405'])
  expect(await ids()).toContain('cl:tmdb:93405')
})

test('the show\'s page carries every season', async () => {
  const page = await resolveMedia('tmdb:93405') as { seasons?: { uri: string }[] } | undefined
  expect(page?.seasons?.map(season => season.uri)).toEqual(['tmdb:93405-s1', 'tmdb:93405-s2', 'tmdb:93405-s3'])
})
