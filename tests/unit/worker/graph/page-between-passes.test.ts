/**
 * A season page never lists one show twice, wherever its read lands.
 *
 * Shaped on the Summer 2026 search page as answered live on 2026-10-16. Offline's bundled row for
 * Steel Ball Run borrows `mal:61469`, and MyAnimeList's season page brings `mal:61469` itself. The
 * pass that row wakes gives it a cluster of its own in iteration 1 (`plugin:direct` has no profile in
 * its delta yet) and joins it to Offline's in iteration 2. A page read landing between the two drew
 * the show at #4 and #5, and up to 81 other shows twice, for one to three seconds (5 of 10 loads of a
 * local build, 2026-10-16).
 *
 * Every statement that writes the graph fires a page read here, so a read lands at every point of
 * every pass, which is what the page's debounced reads can do while the sources keep answering.
 */
import { beforeAll, expect, test } from 'vite-plus/test'

import type { AnswerRow } from '../../../../src/worker/graph/answers'
import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'

import { enableGraph } from '../../../../src/worker/graph'
import { inTurn, onGraphWrite } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { createPageReader } from '../../../../src/worker/graph/read'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import {
  DEFAULT_PLUGINS, passSettled, schedulerStats, startScheduler, stopScheduler,
} from '../../../../src/worker/graph/scheduler'
import { listen } from '../../../../src/worker/store/events'
import { answer, media, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

const SUMMER = { type: 'ONA', season: 'SUMMER', seasonYear: 2026, categories: ['ANIME', 'SERIES'] }

const offline = (): Promise<AnswerRow> => answer('media', media('offline:mal-61469', {
  ...SUMMER,
  popularity: 247344,
  titles: [title('en', 'Steel Ball Run: JoJo no Kimyou na Bouken', 0.2)],
  handles: [sameAs(media('mal:61469')), sameAs(media('anilist:190327'))],
}), 'MEDIA_PAGE')

const mal = (): Promise<AnswerRow> => answer('media', media('mal:61469', {
  ...SUMMER,
  popularity: 247343,
  titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.9), title('jp-en', 'Steel Ball Run: JoJo no Kimyou na Bouken', 0.4)],
}), 'MEDIA_PAGE')

/** The catalogue ids a card names, Offline's borrowed `offline:mal-N` read as the `mal:N` it is. */
const idsOf = (card: ClusterCard): string[] =>
  [...new Set(card.members.map(uri => uri.replace(/^offline:(mal|anilist|kitsu)-/, '$1:')))]

const drawnTwice = (cards: ClusterCard[]): string[] => {
  const ids = cards.flatMap(idsOf)
  return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))]
}

let onWrite: ((midPass: boolean) => void) | undefined
onGraphWrite(() => onWrite?.(schedulerStats().running))

const start = async (): Promise<void> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
}

/** Offline's batch, then MyAnimeList's, each settled, with `read` fired on every write the store makes. */
const load = async (read: (uris: string[]) => Promise<ClusterCard[]>): Promise<{ pages: ClusterCard[][], midPass: number }> => {
  await start()

  let uris: string[] = []
  let midPass = 0
  const reads: Promise<ClusterCard[]>[] = []
  onWrite = running => {
    if (running) midPass += 1
    reads.push(read(uris))
  }
  try {
    for (const batch of [[await offline()], [await mal()]]) {
      uris = [...uris, ...batch.map(row => row.uri)]
      await ingestAnswers(batch)
      await passSettled()
    }
  } finally {
    onWrite = undefined
    stopScheduler()
  }
  return { pages: await Promise.all(reads), midPass }
}

test('a page read landing anywhere in a pass never lists Steel Ball Run twice', async () => {
  const { pages, midPass } = await load(uris => createPageReader().read(uris))

  expect(midPass, 'the control: reads landed while a pass was writing').toBeGreaterThan(0)
  expect(pages.map(drawnTwice).filter(ids => ids.length)).toEqual([])
  expect(pages.at(-1)!.map(card => [...card.members].sort()), 'the control: the page settles on one card')
    .toEqual([['mal:61469', 'offline:mal-61469']])
})

/** The same for a page re-reading the clusters a `view:changed` named, here every cluster there is. */
test('and neither does a re-read of the clusters a pass named', async () => {
  const page = createPageReader()
  const { pages, midPass } = await load(async uris => {
    const { query } = await graphReady()
    const ids = (await query('MATCH (c:Cluster) RETURN c.id AS id')).map(row => String(row.id))
    return page.apply(ids, uris)
  })

  expect(midPass, 'the control: re-reads landed while a pass was writing').toBeGreaterThan(0)
  expect(pages.map(drawnTwice).filter(ids => ids.length)).toEqual([])
  expect(pages.at(-1)!.map(card => [...card.members].sort()), 'the control: the page settles on one card')
    .toEqual([['mal:61469', 'offline:mal-61469']])
})

/**
 * The names a re-read is handed are the ones the page collected before it waited, so they never name
 * what the pass it waits for moved: here that pass joins MyAnimeList's row into AniList's cluster.
 */
test('nor does a re-read whose names predate the pass it waits for', async () => {
  await start()
  const named = new Set<string>()
  const unlisten = listen('view:changed', detail => { for (const id of detail.clusters) named.add(id) })
  const take = (): string[] => {
    const ids = [...named].sort()
    named.clear()
    return ids
  }
  const anilist = (popularity: number) => answer('media', media('anilist:2', {
    ...SUMMER, popularity, titles: [title('en', 'Alpha Story', 1)],
  }), 'MEDIA_PAGE')
  const mal = (fields = {}) => answer('media', media('mal:1', {
    ...SUMMER, popularity: 10, titles: [title('en', 'Alpha Story', 1)], ...fields,
  }), 'MEDIA_PAGE')
  const uris = ['anilist:2', 'mal:1']
  try {
    await ingestAnswers([await anilist(5), await mal()])
    await passSettled()
    const page = createPageReader()
    expect((await page.read(uris)).map(card => card.members), 'the control: two cards to start with')
      .toEqual([['anilist:2'], ['mal:1']])
    take()

    await ingestAnswers([await anilist(6)])
    await passSettled()
    await ingestAnswers([await mal({ handles: [sameAs(media('anilist:2'))] })])
    expect(schedulerStats().running, 'the control: the re-read waits on the joining pass').toBe(true)
    const ids = take()
    expect(ids, 'the control: the names do not name the cluster that pass retires').toEqual(['cl:anilist:2'])
    expect(drawnTwice(await page.apply(ids, uris))).toEqual([])

    await passSettled()
    expect((await page.apply(take(), uris)).map(card => card.members), 'the control: the page settles on one card')
      .toEqual([['anilist:2', 'mal:1']])
  } finally {
    unlisten()
    stopScheduler()
  }
})

test('a re-read with nothing named answers without waiting for the pass in flight', async () => {
  let release = (): void => undefined
  const held = inTurn(() => new Promise<void>(resolve => { release = resolve }))
  const answered = await Promise.race([
    createPageReader().apply([], []).then(() => true),
    new Promise<boolean>(resolve => setTimeout(resolve, 200, false)),
  ])
  release()
  await held
  expect(answered).toBe(true)
})
