// The two 2019 "The Morning Show" as series.fkn.app's search answered them on 2026-10-17, cut to the
// rows that carry the title. Apple TV's row names no outside id, so only its title and year reach
// either show: IMDb tt7203552 (Apple's, known to seven catalogues) and tt10323334 (OMDb alone).
import { beforeAll, expect, test } from 'vite-plus/test'

import type { AnswerRow } from '../../../../src/worker/graph/answers'
import type { TitleDecision } from '../../../../src/worker/graph/plugins/title'

import { enableGraph } from '../../../../src/worker/graph'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { refusedJoins } from '../../../../src/worker/graph/plugins/title'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import { DEFAULT_PLUGINS, passSettled, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { answer, media, rowsOf, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

const APPLE = 'appletv:umc.cmc.25tn3v8ku4b39tr6ccgb8nl6m'

const show = (uri: string, score: number, startDate: string | undefined, handles: string[] = []) =>
  answer('media', media(uri, {
    scope: 'CONTAINER',
    categories: ['SERIES'],
    titles: [title('en', 'The Morning Show', score)],
    ...startDate ? { startDate } : {},
    handles: handles.map(handle => sameAs(media(handle, { scope: 'CONTAINER' }))),
  }), 'MEDIA_PAGE')

const SOURCES: Record<string, () => Promise<AnswerRow>[]> = {
  apple: () => [show(APPLE, 0.2, '2019-11-01T00:00:00.000Z')],
  omdbApple: () => [show('omdb:tt7203552', 0.3, '2019-01-01', ['imdb:tt7203552'])],
  omdbOther: () => [show('omdb:tt10323334', 0.3, '2019-01-01', ['imdb:tt10323334'])],
  tvdb: () => [show('tvdb:361563', 0.3, '2019-11-01', ['imdb:tt7203552'])],
  trakt: () => [show('trakt:the-morning-show', 0.3, '2019-11-02T01:00:00.000Z', ['imdb:tt7203552'])],
  tvmaze: () => [show('tvmaze:41524', 0.3, '2019-11-01', ['imdb:tt7203552'])],
  simkl: () => [show('simkl:1065134', 0.3, undefined, ['imdb:tt7203552'])],
  tmdb: () => [show('tmdb:90282', 0.3, '2019-01-01')],
  watchmode: () => [show('watchmode:03163161', 0.25, '2019-01-01', ['imdb:tt7203552', 'tmdb:90282'])],
}

const OMDB = ['omdbApple', 'omdbOther']
const CATALOGUES = ['tvdb', 'trakt', 'tvmaze', 'simkl', 'tmdb', 'watchmode']

/**
 * Splits of the same answers. OMDb answers both IMDb ids in one search, so tt10323334 lands with
 * OMDb's tt7203552 row. In the last, Apple's row sits beside `tmdb:90282` by title before Watchmode
 * ties that row to tt7203552.
 */
const ORDERS: { name: string, plan: string[][] }[] = [
  { name: 'all in one batch', plan: [['apple', ...OMDB, ...CATALOGUES]] },
  { name: 'Apple first', plan: [['apple'], OMDB, CATALOGUES] },
  { name: 'tt10323334 first, in OMDb\'s answer', plan: [OMDB, ['apple'], CATALOGUES] },
  { name: 'tt7203552 first', plan: [CATALOGUES, ['apple'], OMDB] },
  { name: 'tt7203552 first, Watchmode last', plan: [['tvdb', 'trakt', 'tvmaze', 'simkl'], ['apple'], OMDB, ['tmdb'], ['watchmode']] },
]

const clustersAfter = async (plan: string[][]): Promise<string[][]> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
  for (const batch of plan) {
    await ingestAnswers(await Promise.all(batch.flatMap(source => SOURCES[source]!())))
    await passSettled()
  }
  await passSettled()
  stopScheduler()
  const rows = await rowsOf('MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY c.id, m.uri')
  const clusters = new Map<string, string[]>()
  for (const row of rows) clusters.set(String(row.id), [...clusters.get(String(row.id)) ?? [], String(row.uri)])
  return [...clusters.values()].map(members => [...members].sort()).sort((a, b) => a[0]!.localeCompare(b[0]!))
}

const APART = [
  [
    APPLE, 'imdb:tt7203552', 'omdb:tt7203552', 'simkl:1065134', 'tmdb:90282', 'trakt:the-morning-show',
    'tvdb:361563', 'tvmaze:41524', 'watchmode:03163161',
  ],
  ['imdb:tt10323334', 'omdb:tt10323334'],
]

test('Apple TV\'s row joins Apple\'s show and the other 2019 show stays apart, in every order', async () => {
  const built: Record<string, string[][]> = {}
  for (const order of ORDERS) built[order.name] = await clustersAfter(order.plan)
  expect(built).toEqual(Object.fromEntries(ORDERS.map(order => [order.name, APART])))
}, 300_000)

// THE KNOWN GAP: the tie-break weighs the clusters as they stand, and the sticky rule keeps a title
// link it let through. OMDb's one answer split in two, its tt10323334 row and Apple's landing before any
// row of tt7203552, leaves Apple's row one candidate, and it stays with it. If this goes red, something
// closed the gap.
test('KNOWN GAP: Apple TV\'s row stays with tt10323334 when that show lands alone first', async () => {
  expect(await clustersAfter([['omdbOther'], ['apple'], ['omdbApple', ...CATALOGUES]])).toEqual([
    [APPLE, 'imdb:tt10323334', 'omdb:tt10323334'],
    [
      'imdb:tt7203552', 'omdb:tt7203552', 'simkl:1065134', 'tmdb:90282', 'trakt:the-morning-show', 'tvdb:361563',
      'tvmaze:41524', 'watchmode:03163161',
    ],
  ])
}, 60_000)

const decided = (refusedBy: TitleDecision['refusedBy'] = null): TitleDecision => ({
  gates: { format: 'passed', season: 'silent', date: refusedBy === 'date' ? 'refused' : 'silent', companion: 'silent' },
  refusedBy,
  match: { titleA: 'the morning show', titleB: 'the morning show', similarity: 1, exact: true },
  year: 2019,
  daysDelta: null,
})

const refused = (pairs: [string, string, TitleDecision?][], members: Record<string, string[]>, scope = 'CONTAINER') =>
  Object.fromEntries(refusedJoins(
    new Map(pairs.map(([a, b, decision = decided()]) => [`${a} ${b}`, { a, b, decision }])),
    () => scope,
    cluster => members[cluster] ?? []
  ))

test('a show joins the candidate known to every catalogue of the other and to more, else neither', () => {
  const hub = [APPLE]
  const a = ['imdb:tt7203552', 'tvdb:361563', 'tvmaze:41524']
  const b = ['imdb:tt10323334']
  const both: [string, string][] = [['hub', 'a'], ['hub', 'b']]

  expect(refused(both, { hub, a, b })).toEqual({ 'hub b': 'ambiguous' })
  expect(refused([...both, ['a', 'b']], { hub, a, b })).toEqual({ 'a b': 'disagreeing-ids', 'hub b': 'ambiguous' })
  expect(refused(both, { hub, a, b: [...b, 'omdb:tt10323334'] }), 'more catalogues, but not OMDb')
    .toEqual({ 'hub a': 'ambiguous', 'hub b': 'ambiguous' })
  expect(refused([['show', 'x'], ['show', 'y']], {
    show: ['imdb:tt10385760', 'tvdb:285068', 'tvmaze:8705'], x: ['tmdb:109458'], y: ['tmdb:219538'],
  }), 'two TMDB rows of one title and year, neither with an IMDb id').toEqual({ 'show x': 'ambiguous', 'show y': 'ambiguous' })
  expect(refused([['hub', 'a'], ['hub', 'b', decided('date')]], { hub, a, b }), 'a match a gate refused is no candidate')
    .toEqual({})
  expect(refused([...both, ['a', 'b']], { hub, a, b }, 'RUN'), 'runs are left to the guards').toEqual({})
})
