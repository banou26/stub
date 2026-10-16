// "tokyo revengers" and "ghost in the shell" as JustWatch, IMDb, Watchmode and Simkl answered their searches
// through the relay on 2026-10-15, each cut to the rows of exactly that title. Stub reads a Simkl anime series
// as ANIME and SERIES with no date, and an anime film as a film. IMDb and Watchmode date a film by its year
// alone, so a dated anime series would meet any film of its title and year.
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'

import { siteAllows } from '../../../../src/site'
import * as justwatch from '../../../../src/sources/justwatch/extractor'
import * as omdb from '../../../../src/sources/omdb/extractor'
import * as simkl from '../../../../src/sources/simkl/extractor'
import * as watchmode from '../../../../src/sources/watchmode/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { pageClusters } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import JUSTWATCH_GHOST from '../../../fixtures/justwatch/ghost-in-the-shell-search.json'
import JUSTWATCH_TOKYO from '../../../fixtures/justwatch/tokyo-revengers-search.json'
import OMDB_GHOST from '../../../fixtures/omdb/search-ghost-in-the-shell.json'
import OMDB_TOKYO from '../../../fixtures/omdb/search-tokyo-revengers.json'
import SIMKL_GHOST from '../../../fixtures/simkl/search-ghost-in-the-shell.json'
import SIMKL_TOKYO from '../../../fixtures/simkl/search-tokyo-revengers.json'
import WATCHMODE_GHOST from '../../../fixtures/watchmode/search-ghost-in-the-shell.json'
import WATCHMODE_TOKYO from '../../../fixtures/watchmode/search-tokyo-revengers.json'
import { answer } from './plugins/fixtures'

type Recorded = { search: Record<string, unknown>, detail: Record<string, unknown> }
type Row = { uri: string }

const respond = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) })

const simklAnswers = (recorded: Recorded) => async (url: string, init?: { body?: string }) => {
  const { origin, pathname } = new URL(url)
  if (origin === 'https://simkl.com') return respond(recorded.search[new URLSearchParams(init?.body).get('type')!])
  const detail = recorded.detail[pathname]
  if (!detail) throw new Error(`no recorded answer for ${url}`)
  return respond(detail)
}

const search = async (source: { resolvers: unknown }, fetch: unknown, query: string) => {
  const context = { findAggregatedMedia: async () => null, listenForMediaChanges: async function* () {}, fetch }
  const { value } = await (source.resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: query } }, context).next()
  return value.mediaPage.nodes as Row[]
}

const both = async (source: { resolvers: unknown }, tokyo: (url: string, init?: { body?: string }) => unknown, ghost: typeof tokyo) => [
  ...await search(source, tokyo, 'tokyo revengers'),
  ...await search(source, ghost, 'ghost in the shell'),
]

const SOURCES = {
  justwatch: () => both(justwatch, async () => respond(JUSTWATCH_TOKYO), async () => respond(JUSTWATCH_GHOST)),
  omdb: () => both(omdb, async () => respond(OMDB_TOKYO), async () => respond(OMDB_GHOST)),
  watchmode: () => both(watchmode, async () => respond(WATCHMODE_TOKYO), async () => respond(WATCHMODE_GHOST)),
  simkl: () => both(simkl, simklAnswers(SIMKL_TOKYO), simklAnswers(SIMKL_GHOST)),
}

const ingest = async (rows: Row[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row as never, 'MEDIA_PAGE'))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => { await enableGraph(true) })

describe.each([
  ['together', [['justwatch', 'omdb', 'watchmode', 'simkl']]],
  ['JustWatch last', [['simkl', 'omdb', 'watchmode'], ['justwatch']]],
] as [string, (keyof typeof SOURCES)[][]][])('%s', (_, passes) => {
  let cards: ClusterCard[] = []

  beforeAll(async () => {
    const uris: string[] = []
    for (const pass of passes) {
      const rows = (await Promise.all(pass.map(source => SOURCES[source]()))).flat()
      uris.push(...rows.map(row => row.uri))
      await ingest(rows)
    }
    cards = await pageClusters(uris)
  }, 300_000)

  afterAll(async () => { await closeGraph() })

  const card = (uri: string) => cards.find(card => card.members.includes(uri))

  test('an anime series stays apart from the live-action film of its title and year, and the film is one card', () => {
    expect(card('omdb:tt11923304')?.members.sort()).toEqual(['jw:888805', 'omdb:tt11923304', 'watchmode:01610273'])
  })

  test('an anime film keeps its card on the movie site', () => {
    expect(siteAllows(card('jw:9668')!.categories, 'movie')).toBe(true)
  })

  test('a Simkl anime film joins the film of its title and day, on the movie site', () => {
    expect(card('simkl:37585')?.members.sort())
      .toEqual(['anilist:43', 'jw:9668', 'kitsu:25', 'mal:43', 'simkl:37585', 'watchmode:01147215'])
    expect(siteAllows(card('simkl:37585')!.categories, 'movie')).toBe(true)
  })

  test('a Simkl anime film leads with its English title, which tells Ghost in the Shell 2.0 from the 1995 film', () => {
    expect(card('simkl:39956')!.titles[0]).toMatchObject({ title: 'Ghost in the Shell 2.0' })
  })

  test('a Simkl film joins the film of its title and release day', () => {
    expect(card('jw:196674')?.members.sort()).toEqual(['jw:196674', 'omdb:tt1219827', 'simkl:457116', 'watchmode:01147214'])
  })
})
