// "Smoking Behind the Supermarket with You" as the Summer 2026 recording answered it, cut to the three
// rows that decide its card. JustWatch's season names Netflix's season SAME_AS and carries a year but no
// title, Netflix's carries the title but no date, and they list 12 and 11 episodes. So the two stay
// apart, and neither reaches AniList's run by title alone, whichever lands first: JustWatch's season
// must not weld Netflix's while that row is still only the handle it named.
import { beforeAll, expect, test } from 'vite-plus/test'

import type { AnswerRow } from '../../../../src/worker/graph/answers'

import { enableGraph } from '../../../../src/worker/graph'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import { DEFAULT_PLUGINS, passSettled, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { answer, episode, media, rowsOf, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

const TITLE = 'Smoking Behind the Supermarket with You'
const JUSTWATCH = 'jw:488719-515179'
const NETFLIX = 'nf:82757039-1'

const episodes = (uri: string, count: number) =>
  Array.from({ length: count }, (_, index) => episode(`${uri}-e${index + 1}`, uri, { seasonNumber: 1, episodeNumber: index + 1 }))

const ROWS: Record<string, () => Promise<AnswerRow>> = {
  anilist: () => answer('media', media('anilist:196187', {
    type: 'TV', categories: ['ANIME', 'SERIES'], titles: [title('en', TITLE, 0.8)], startDate: '2026-07-09',
    episodeCount: 12, status: 'RELEASING',
  })),
  justwatch: () => answer('media', media(JUSTWATCH, {
    categories: ['SERIES'], startDate: '2026-01-01', episodeCount: 12, episodes: episodes(JUSTWATCH, 12),
    handles: [sameAs(media(NETFLIX))],
  })),
  netflix: () => answer('media', media(NETFLIX, {
    categories: ['SERIES'], titles: [title('en', TITLE, 0.2)], episodeCount: 11, episodes: episodes(NETFLIX, 11),
  })),
}

const ORDERS: { name: string, plan: string[][] }[] = [
  { name: 'all in one batch', plan: [['anilist', 'justwatch', 'netflix']] },
  { name: 'Netflix after JustWatch named it', plan: [['anilist', 'justwatch'], ['netflix']] },
  { name: 'one row at a time', plan: [['anilist'], ['justwatch'], ['netflix']] },
  { name: 'AniList last', plan: [['justwatch'], ['netflix'], ['anilist']] },
  { name: 'JustWatch first, the rest together', plan: [['justwatch'], ['anilist', 'netflix']] },
  { name: 'JustWatch and Netflix together after AniList', plan: [['anilist'], ['justwatch', 'netflix']] },
  { name: 'JustWatch last', plan: [['anilist', 'netflix'], ['justwatch']] },
  { name: 'Netflix first', plan: [['netflix'], ['justwatch'], ['anilist']] },
]

const graphAfter = async (plan: string[][]): Promise<string[]> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
  for (const batch of plan) {
    await ingestAnswers(await Promise.all(batch.map(source => ROWS[source]!())))
    await passSettled()
  }
  await passSettled()
  stopScheduler()
  const members = await rowsOf('MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY c.id, m.uri')
  const clusters = new Map<string, string[]>()
  for (const row of members) clusters.set(String(row.id), [...clusters.get(String(row.id)) ?? [], String(row.uri)])
  const links = await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media) RETURN a.uri AS f, b.uri AS t, l.kind AS k, l.status AS s, l.reason AS r
     ORDER BY f, t, k, r`
  )
  return [
    ...[...clusters.values()].map(list => `cluster ${[...list].sort().join(' ')}`).sort(),
    ...links.map(row => `link ${String(row.f)} -> ${String(row.t)} ${String(row.k)} ${String(row.s)} ${String(row.r)}`),
  ]
}

const APART = [
  'cluster anilist:196187',
  `cluster ${JUSTWATCH}`,
  `cluster ${NETFLIX}`,
  `link ${JUSTWATCH} -> ${NETFLIX} INCLUDES refused no-dates`,
  `link ${JUSTWATCH} -> ${NETFLIX} SAME_AS refused count-mismatch`,
  `link ${NETFLIX} -> ${JUSTWATCH} INCLUDES refused retranslates`,
  `link ${NETFLIX} -> ${JUSTWATCH} PART_OF active count-mismatch`,
]

test('a JustWatch season and the Netflix season it names build one graph in every arrival order', async () => {
  const built: Record<string, string[]> = {}
  for (const order of ORDERS) built[order.name] = await graphAfter(order.plan)
  expect(built).toEqual(Object.fromEntries(ORDERS.map(order => [order.name, APART])))
}, 300_000)
