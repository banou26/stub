/**
 * A live-action show's search lists the show alone, after its page was opened as before.
 *
 * Shaped on Breaking Bad as series.fkn.app answered it on 2026-11-10. Opening the show stores its Season 1, a visible
 * run of its own. Searching again reads the whole store until a source answers something new, and that read listed
 * Season 1 beside the show until a reload. The seeded read reached it too. Watchmode's page answer names
 * two Netflix titles as shows it is part of, one of which is JustWatch's show, so Watchmode's search row leaves the
 * show for a container of its own. JustWatch's Season 1 names that row as well, so the container hides behind
 * Season 1, and the search, which Watchmode answers, drew Season 1 in its place.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import type { AnswerRow } from '../../../../src/worker/graph/answers'
import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'
import type { Media } from '../../../../src/generated/schema/types.generated'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { createPageReader, pageClusters } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { sortPage } from '../../../../src/worker/store/filter'
import { answer, media, partOf, rowsOf, sameAs, title } from './plugins/fixtures'

const SHOW = { scope: 'CONTAINER', categories: ['SERIES'] }
const IMDB = media('imdb:tt0903747', { scope: 'CONTAINER' })
const NETFLIX = media('nf:70143836', { scope: 'CONTAINER' })
const named = (score: number) => ({ score, titles: [title('en', 'Breaking Bad', score)] })
const address = (uri: string) => ({ ...sameAs(media(uri)), provenance: 'address' })

// what the search asks: the show as Watchmode, TMDB and Simkl answer it
const search = () => Promise.all([
  answer('media', media('watchmode:03173903', {
    ...SHOW, ...named(0.25), startDate: '2008', handles: [sameAs(IMDB), sameAs(media('tmdb:1396', { scope: 'CONTAINER' }))],
  }), 'MEDIA_PAGE'),
  answer('media', media('tmdb:1396', { ...SHOW, ...named(0.3), startDate: '2008' }), 'MEDIA_PAGE'),
  answer('media', media('simkl:11121', { ...SHOW, ...named(0.3), handles: [sameAs(IMDB)] }), 'MEDIA_PAGE'),
])

// what opening the show adds, in the order it arrived
const opened = async (): Promise<AnswerRow[]> => [
  await answer('media', media('watchmode:03173903', { ...SHOW, score: 0.25, handles: [partOf(media('nf:70196252')), partOf(NETFLIX)] })),
  await answer('media', media('jw:4', { ...SHOW, ...named(0.2), startDate: '2008-01-20', handles: [sameAs(media('nf:70143836'))] })),
  await answer('media', media('simkl:11121', { ...SHOW, ...named(0.3), startDate: '2008-01-21T02:00:00Z', episodeCount: 62, handles: [sameAs(IMDB)] })),
  await answer('media', media('jw:4-26', {
    categories: ['SERIES'],
    ...named(0.2),
    startDate: '2008-01-20',
    episodeCount: 7,
    handles: [
      partOf(NETFLIX),
      partOf(media('jw:4', { categories: ['SERIES'], titles: [title('en', 'Breaking Bad', 0.2)], startDate: '2008-01-20' })),
      partOf(IMDB),
      ...['imdb:tt0903747', 'nf:70143836', 'simkl:11121', 'tmdb:1396', 'watchmode:03173903'].map(address),
    ],
  })),
]

const pass = async () => {
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

const clusterOf = async (uri: string) =>
  (await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, c.hidden AS hidden, c.hiddenBy AS hiddenBy', { uri }))[0]!

let URIS: string[] = []
let SHOW_ID = ''
let SEASON_ID = ''
let fresh: ClusterCard[] = []
let seededAfter: ClusterCard[] = []
let wholeAfter: ClusterCard[] = []

const ids = (cards: readonly { _id: string }[]) => cards.map(card => card._id)

/** The cards the series site's search page keeps of a read. */
const listed = async (cards: readonly ClusterCard[]) =>
  ids(await sortPage(cards as unknown as (Media & ClusterCard)[], { search: 'breaking bad' }, URIS, 'series'))

beforeAll(async () => {
  await enableGraph(true)
  const asked = await search()
  URIS = asked.map(row => row.uri)
  for (const row of asked) {
    await ingestAnswers([row])
    await pass()
  }
  fresh = await pageClusters(URIS)
  // two search pages left open while the show is opened, one on what the search answered, one on the whole store
  const seeded = createPageReader()
  const whole = createPageReader()
  await seeded.read(URIS)
  await whole.read([])
  for (const row of await opened()) {
    await ingestAnswers([row])
    await pass()
  }
  SHOW_ID = String((await clusterOf('tmdb:1396')).id)
  SEASON_ID = String((await clusterOf('jw:4-26')).id)
  const moved = (await rowsOf('MATCH (c:Cluster) RETURN c.id AS id')).map(row => String(row.id))
  seededAfter = await seeded.apply(moved, URIS)
  wholeAfter = await whole.apply(moved, [])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('the search lists the show alone before it is opened', async () => {
  expect(await listed(fresh)).toEqual([SHOW_ID])
})

test('opening the show stores its Season 1 as a visible run, and Watchmode\'s row hidden behind it', async () => {
  expect(SEASON_ID).not.toBe(SHOW_ID)
  expect((await clusterOf('jw:4-26')).hidden).toBe(false)
  const watchmode = await clusterOf('watchmode:03173903')
  expect(watchmode.id).not.toBe(SHOW_ID)
  expect(watchmode.hidden).toBe(true)
  expect(watchmode.hiddenBy).toEqual([SEASON_ID])
})

test('searching again over the whole store lists the show and not its season', async () => {
  const cards = await pageClusters()
  expect(ids(cards), 'the read holds the season').toContain(SEASON_ID)
  expect(await listed(cards)).toContain(SHOW_ID)
  expect(await listed(cards)).not.toContain(SEASON_ID)
  expect(await listed(await createPageReader().read([]))).toEqual(await listed(cards))
})

test('and on what the search answered it lists the show alone', async () => {
  const cards = await pageClusters(URIS)
  expect(ids(cards), 'the read reaches the season behind Watchmode\'s row').toContain(SEASON_ID)
  expect(await listed(cards)).toEqual([SHOW_ID])
  expect(await listed(await pageClusters([...URIS, 'jw:4-26'])), 'and when a source answers the season itself').toEqual([SHOW_ID])
})

test('so do search pages left open while the show was opened', async () => {
  expect(ids(seededAfter)).toContain(SEASON_ID)
  expect(await listed(seededAfter)).toEqual([SHOW_ID])
  expect(ids(wholeAfter)).toContain(SEASON_ID)
  expect(await listed(wholeAfter)).toContain(SHOW_ID)
  expect(await listed(wholeAfter)).not.toContain(SEASON_ID)
})

test('and a page that re-reads the season alone, as when only its card moved', async () => {
  const page = createPageReader()
  await page.read([])
  const cards = await page.apply([SEASON_ID], [])
  expect(ids(cards)).toContain(SEASON_ID)
  expect(await listed(cards)).not.toContain(SEASON_ID)
})

// Netflix answers the show's season alone, with no handle, and until a claim joins it to Season 1 nothing attaches it
test('and a season a source answered alone, by its id', async () => {
  await ingestAnswers([await answer('media', media('nf:70143836-1', { categories: ['SERIES'], scope: 'RUN', ...named(0.3), episodeCount: 7 }))])
  await pass()
  const alone = String((await clusterOf('nf:70143836-1')).id)
  const cards = await pageClusters()
  expect(ids(cards), 'a card of its own').toContain(alone)
  expect(await listed(cards)).toContain(SHOW_ID)
  expect(await listed(cards)).not.toContain(alone)
})
