// "tokyo revengers", "ghost in the shell", "blade runner" and "gintama" as JustWatch, IMDb, Watchmode and Simkl
// answered their searches through the relay on 2026-10-15, and "star wars" as Simkl answered it then and TVmaze
// directly on 2026-10-16, each cut to the rows of exactly the titles tested. Stub reads a Simkl anime series as
// ANIME and SERIES with no date, and an anime film as a film. IMDb and Watchmode date a film by its year alone,
// so a dated anime series would meet any film of its title and year.
import { afterAll, beforeAll, describe, expect, test, vi } from 'vite-plus/test'

import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'

import { siteAllows } from '../../../../src/site'
import * as justwatch from '../../../../src/sources/justwatch/extractor'
import * as omdb from '../../../../src/sources/omdb/extractor'
import * as simkl from '../../../../src/sources/simkl/extractor'
import * as tvmaze from '../../../../src/sources/tvmaze/extractor'
import * as watchmode from '../../../../src/sources/watchmode/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { pageClusters } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import JUSTWATCH_BLADE_RUNNER from '../../../fixtures/justwatch/blade-runner-search.json'
import JUSTWATCH_GHOST from '../../../fixtures/justwatch/ghost-in-the-shell-search.json'
import JUSTWATCH_GINTAMA from '../../../fixtures/justwatch/gintama-search.json'
import JUSTWATCH_TOKYO from '../../../fixtures/justwatch/tokyo-revengers-search.json'
import OMDB_BLADE_RUNNER from '../../../fixtures/omdb/search-blade-runner.json'
import OMDB_GHOST from '../../../fixtures/omdb/search-ghost-in-the-shell.json'
import OMDB_GINTAMA from '../../../fixtures/omdb/search-gintama.json'
import OMDB_TOKYO from '../../../fixtures/omdb/search-tokyo-revengers.json'
import SIMKL_BLADE_RUNNER from '../../../fixtures/simkl/search-blade-runner.json'
import SIMKL_GHOST from '../../../fixtures/simkl/search-ghost-in-the-shell.json'
import SIMKL_GINTAMA from '../../../fixtures/simkl/search-gintama.json'
import SIMKL_VISIONS from '../../../fixtures/simkl/search-star-wars-visions.json'
import SIMKL_TOKYO from '../../../fixtures/simkl/search-tokyo-revengers.json'
import TVMAZE_VISIONS from '../../../fixtures/tvmaze/search-star-wars-visions.json'
import WATCHMODE_BLADE_RUNNER from '../../../fixtures/watchmode/search-blade-runner.json'
import WATCHMODE_GHOST from '../../../fixtures/watchmode/search-ghost-in-the-shell.json'
import WATCHMODE_GINTAMA from '../../../fixtures/watchmode/search-gintama.json'
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
  const context = { request: new Request('http://d/graphql'), findAggregatedMedia: async () => null, listenForMediaChanges: async function* () {}, fetch }
  // Simkl waits for a search to hold before it asks
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  const answer = (source.resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: query } }, context).next()
  await vi.advanceTimersByTimeAsync(2_000)
  vi.useRealTimers()
  return (await answer).value.mediaPage.nodes as Row[]
}

const searches = async (source: { resolvers: unknown }, answers: Record<string, (url: string, init?: { body?: string }) => unknown>) => {
  const rows: Row[] = []
  for (const [query, fetch] of Object.entries(answers)) rows.push(...await search(source, fetch, query))
  return rows
}

const recorded = (body: unknown) => async () => respond(body)

const SOURCES = {
  justwatch: () => searches(justwatch, {
    'tokyo revengers': recorded(JUSTWATCH_TOKYO),
    'ghost in the shell': recorded(JUSTWATCH_GHOST),
    'blade runner': recorded(JUSTWATCH_BLADE_RUNNER),
    gintama: recorded(JUSTWATCH_GINTAMA),
  }),
  omdb: () => searches(omdb, {
    'tokyo revengers': recorded(OMDB_TOKYO),
    'ghost in the shell': recorded(OMDB_GHOST),
    'blade runner': recorded(OMDB_BLADE_RUNNER),
    gintama: recorded(OMDB_GINTAMA),
  }),
  watchmode: () => searches(watchmode, {
    'tokyo revengers': recorded(WATCHMODE_TOKYO),
    'ghost in the shell': recorded(WATCHMODE_GHOST),
    'blade runner': recorded(WATCHMODE_BLADE_RUNNER),
    gintama: recorded(WATCHMODE_GINTAMA),
  }),
  simkl: () => searches(simkl, {
    'tokyo revengers': simklAnswers(SIMKL_TOKYO),
    'ghost in the shell': simklAnswers(SIMKL_GHOST),
    'blade runner': simklAnswers(SIMKL_BLADE_RUNNER),
    gintama: simklAnswers(SIMKL_GINTAMA),
    'star wars': simklAnswers(SIMKL_VISIONS),
  }),
  tvmaze: () => searches(tvmaze, { 'star wars': recorded(TVMAZE_VISIONS) }),
}

const ingest = async (rows: Row[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row as never, 'MEDIA_PAGE'))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => { await enableGraph(true) })

describe.each([
  ['together', [['justwatch', 'omdb', 'watchmode', 'simkl', 'tvmaze']]],
  ['JustWatch last', [['simkl', 'omdb', 'watchmode', 'tvmaze'], ['justwatch']]],
  ['Simkl last', [['justwatch', 'omdb', 'watchmode', 'tvmaze'], ['simkl']]],
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

  test('a Simkl anime short TMDB files as a film joins the film of its title and day, on the movie site', () => {
    expect(card('simkl:718483')?.members.sort())
      .toEqual(['anilist:100168', 'jw:351204', 'kitsu:13811', 'mal:36308', 'simkl:718483', 'watchmode:01673741'])
    expect(card('simkl:718483')!.categories).toEqual(['ANIME', 'MOVIE'])
  })

  test('the feature film of the same year keeps its own card, and so does a film Watchmode lists with no year or other id', () => {
    expect(card('jw:239091')?.members.sort()).toEqual(['jw:239091', 'omdb:tt1856101', 'simkl:489468', 'watchmode:0153801'])
    expect(card('jw:997728')?.members).toEqual(['jw:997728'])
    expect(card('watchmode:011106824')?.members).toEqual(['watchmode:011106824'])
  })

  // JustWatch lists the live-action Gintama (2017) as Japanese animation, under the animated film's IMDb id
  test('a live-action film Simkl files outside anime is not anime, though JustWatch calls it animation', () => {
    expect(card('simkl:1634342')?.members.sort()).toEqual(['jw:309774', 'simkl:1634342', 'watchmode:01147918'])
    expect(card('simkl:1634342')!.categories).toEqual(['MOVIE'])
  })

  test('the anime films of its title stay anime and apart from it, one JustWatch alone calls animation too', () => {
    expect(card('simkl:1053503')?.members.sort())
      .toEqual(['anilist:114129', 'jw:922663', 'kitsu:43683', 'mal:39486', 'omdb:tt10766468', 'simkl:1053503', 'watchmode:01621194'])
    expect(card('simkl:1053503')!.categories).toEqual(['ANIME', 'MOVIE'])
    expect(card('jw:93161')?.members.sort()).toEqual(['jw:93161', 'omdb:tt1636780', 'watchmode:01147921'])
    expect(card('jw:93161')!.categories).toEqual(['ANIME', 'MOVIE'])
  })

  test('a series Simkl files under tv stays anime when another source tags it anime', () => {
    expect(card('simkl:2726684')?.members.sort()).toEqual(['imdb:tt13622982', 'simkl:2726684', 'tvmaze:52340'])
    expect(card('simkl:2726684')!.categories).toEqual(['ANIME', 'SERIES'])
  })
})
