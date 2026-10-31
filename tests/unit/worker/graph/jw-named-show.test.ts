// A show JustWatch lists under a title TMDB's season does not carry: The Traitors' UK run is The Traitors: UK there. Squid
// Game's recorded pages and answers, retitled the same way. The title pass cannot join these two, and what JustWatch's
// search adds from the address is a pointer the graph does not read, so the season joins through its own claim or not at all.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import { resolvers as tmdb } from '../../../../src/sources/tmdb/extractor'
import { resolvers as justwatch } from '../../../../src/sources/justwatch/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import JW_SEARCH from '../../../fixtures/justwatch/squid-game-search.json'
import JW_NODE from '../../../fixtures/justwatch/squid-game.json'
import { answer } from './plugins/fixtures'

const PAGE = 'ag:(tmdb:93405-s1)'

const tmdbPage = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')
const TMDB_PAGES: Record<string, string> = {
  '/tv/93405': tmdbPage('show-squid-game'),
  '/tv/93405/seasons': tmdbPage('seasons-squid-game'),
  '/tv/93405/season/1': tmdbPage('season-squid-game-1'),
}

const retitled = <T>(recorded: T): T => JSON.parse(JSON.stringify(recorded).replaceAll('"title":"Squid Game"', '"title":"Squid Game: UK"'))

const SEARCH = retitled(JW_SEARCH)
SEARCH.data.popularTitles.edges[0]!.node.content = { ...SEARCH.data.popularTitles.edges[0]!.node.content, tmdb: { tmdbId: '93405' } } as never
const NODE = retitled(JW_NODE)

const CLUSTER = { categories: ['SERIES'], titles: [{ title: 'Squid Game' }], startDate: '2021-09-17', episodeCount: 9, handles: [] }

const ask = async (resolvers: any, fetch: (url: string, init?: { body: string }) => Promise<unknown>) => {
  const context = { findAggregatedMedia: async () => CLUSTER, listenForMediaChanges: async function* () {}, fetch }
  const { value } = await resolvers.Subscription.media.subscribe(undefined, { input: { uri: PAGE, details: true } }, context).next()
  return value.media
}

let jw: { handles: { relation: string, provenance?: string, node: { uri: string } }[] }

beforeAll(async () => {
  await enableGraph(true)
  const season = await ask(tmdb, async url => {
    const body = TMDB_PAGES[url.replace('https://www.themoviedb.org', '').replace(/\?.*$/, '')] ?? ''
    return { ok: true, status: 200, text: async () => body }
  })
  jw = await ask(justwatch, async (_, init) => ({ json: async () => init?.body.includes('GetSearchTitles') ? SEARCH : NODE }))
  await ingestAnswers([await answer('media', season), await answer('media', jw)])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('on a show TMDB\'s id settled, the season is JustWatch\'s own claim, not the address read back', () => {
  expect(jw.handles.filter(({ node }) => node.uri === 'tmdb:93405-s1').map(({ relation, provenance }) => [relation, provenance]))
    .toEqual([['SAME_AS', undefined]])
})

test('so the season joins the page under a title of its own, and brings IMDb with it', async () => {
  const page = await resolveMedia(PAGE) as { uri: string, handles: { node: { origin: string, url?: string } }[] } | undefined
  expect(page?.uri).toBe('ag:(jw:220305-227597,tmdb:93405-s1)')
  expect(page?.handles.filter(handle => handle.node.origin === 'imdb').map(handle => handle.node.url)).toEqual(['https://www.imdb.com/title/tt10919420'])
})
