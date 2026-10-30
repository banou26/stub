// Squid Game season 1 opened at its TMDB address, as the show's own page and a season link open it, with TVmaze's
// season not joined: TMDB answers the season and JustWatch the run its search links, both as recorded on 2026-10-31.
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
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'
import JW_SEARCH from '../../../fixtures/justwatch/squid-game-search.json'
import JW_NODE from '../../../fixtures/justwatch/squid-game.json'
import DUNE from '../../../fixtures/justwatch/dune-part-two.json'
import { answer } from './plugins/fixtures'

const PAGE = 'ag:(tmdb:93405-s1)'

const tmdbPage = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')
const TMDB_PAGES: Record<string, string> = {
  '/tv/93405': tmdbPage('show-squid-game'),
  '/tv/93405/seasons': tmdbPage('seasons-squid-game'),
  '/tv/93405/season/1': tmdbPage('season-squid-game-1'),
}

// the page's cluster once TMDB's season has landed, which is what JustWatch's search is gated on
const CLUSTER = { categories: ['SERIES'], titles: [{ title: 'Squid Game' }], startDate: '2021-09-17', episodeCount: 9 }

const ask = async (resolvers: any, uri: string, fetch: (url: string, init?: { body: string }) => Promise<unknown>) => {
  const context = { findAggregatedMedia: async () => CLUSTER, listenForMediaChanges: async function* () {}, fetch }
  const { value } = await resolvers.Subscription.media.subscribe(undefined, { input: { uri, details: true } }, context).next()
  return value.media
}

const tmdbFetch = async (url: string) => {
  const body = TMDB_PAGES[url.replace('https://www.themoviedb.org', '').replace(/\?.*$/, '')] ?? ''
  return { ok: true, status: 200, text: async () => body }
}

const justwatchFetch = (node: unknown) => async (_: string, init?: { body: string }) =>
  ({ json: async () => init?.body.includes('GetSearchTitles') ? JW_SEARCH : node })

const imdbLinks = (media: { handles: { relation: string, node: { origin: string, uri: string, url?: string, scope?: string } }[] }) =>
  media.handles.filter(({ node }) => node.origin === 'imdb').map(({ relation, node }) => `${relation} ${node.scope} ${node.uri} ${node.url}`)

let jw: any

beforeAll(async () => {
  await enableGraph(true)
  const season = await ask(tmdb, PAGE, tmdbFetch)
  jw = await ask(justwatch, PAGE, justwatchFetch(JW_NODE))
  expect(season.uri).toBe('tmdb:93405-s1')
  expect(jw.uri).toBe('jw:220305-227597')
  await ingestAnswers([await answer('media', season), await answer('media', jw)])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('JustWatch\'s season links the show\'s IMDb id, which names the show and so joins nothing', () => {
  expect(imdbLinks(jw)).toEqual(['PART_OF CONTAINER imdb:tt10919420 https://www.imdb.com/title/tt10919420'])
  expect(NATIVE_ID_SPACES.jw!.has('imdb'), 'an IMDb id is JustWatch\'s own, not an echo of the address').toBe(true)
})

test('the season\'s page carries IMDb beside TMDB and JustWatch with no TVmaze in it', async () => {
  const page = await resolveMedia(PAGE) as { uri: string, handles: { node: { origin: string, url?: string } }[] } | undefined
  expect(page?.uri, 'the link names the show, so it is no member of the season\'s address').toBe('ag:(jw:220305-227597,tmdb:93405-s1)')
  expect(page?.handles.filter(handle => handle.node.origin === 'imdb').map(handle => handle.node.url)).toEqual(['https://www.imdb.com/title/tt10919420'])
})

test('a film\'s answer links no IMDb id', async () => {
  const film = await ask(justwatch, 'jw:1133934', justwatchFetch(DUNE))
  expect(DUNE.data.node.content.externalIds.imdbId, 'the answer carries one').toBeTruthy()
  expect(imdbLinks(film)).toEqual([])
})
