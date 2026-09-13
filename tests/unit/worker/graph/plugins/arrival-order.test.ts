/**
 * G3, as a test: the same evidence builds the same graph whatever order it arrives in.
 *
 * The design states this four times and never checks it (`representation.md` G3 at :60, "arrival
 * order decides nothing" at :109, "arrival order cannot decide anything because every pass
 * recomputes from the same evidence" at :725, and, about guard 5 specifically, "neither wins by
 * arrival order" at :2273). The old store had `tests/unit/worker/store/arrival-order.test.ts` and
 * section 9's rewrite table lists it as a file the graph store owes; this is that file.
 *
 * THE CASES ARE SPLITS OF ONE ANSWER SET, not different answers. Every ordering below ingests the
 * same four rows and the same four claims; only the batch boundaries move, and a batch boundary is a
 * pass boundary because the scheduler wakes on a commit. So any difference in the graph they build is
 * arrival order deciding something, which is the thing G3 forbids.
 */
import { beforeAll, expect, test } from 'vitest'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'

import { enableGraph } from '../../../../../src/worker/graph'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../../src/worker/graph/plugins/runner'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../../src/worker/graph/schema'
import {
  DEFAULT_PLUGINS, passSettled, startScheduler, stopScheduler,
} from '../../../../../src/worker/graph/scheduler'
import { answer, media, rowsOf, sameAs, title } from './fixtures'

beforeAll(async () => { await enableGraph(true) })

const truncate = async (): Promise<void> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
}

/**
 * The graph as something two runs can be compared on: memberships and links, both sorted.
 *
 * CLUSTER IDS ARE NOT IN IT. Two runs mint them in different orders and a stable id is a property of
 * one graph over time rather than of two graphs against each other, which is the same rule
 * `delta.test.ts` states for its own export.
 */
const shapeOf = async (): Promise<string[]> => {
  const members = await rowsOf(
    'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY c.id, m.uri'
  )
  const byCluster = new Map<string, string[]>()
  for (const row of members) {
    byCluster.set(String(row.id), [...byCluster.get(String(row.id)) ?? [], String(row.uri)])
  }
  const links = await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     RETURN a.uri AS f, b.uri AS t, l.kind AS k, l.status AS s, l.reason AS r
     ORDER BY f, t, k, r`
  )
  return [
    ...[...byCluster.values()].map(list => `cluster ${[...list].sort().join(' ')}`).sort(),
    ...links.map(row => `link ${row.f} -> ${row.t} ${row.k} ${row.s} ${row.r}`).sort(),
  ]
}

/** One arm: an emptied graph, then each batch ingested and allowed to settle before the next. */
const build = async (batches: AnswerRow[][]): Promise<string[]> => {
  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
  for (const batch of batches) {
    await ingestAnswers(batch)
    await passSettled()
  }
  await passSettled()
  stopScheduler()
  return shapeOf()
}

/**
 * Four rows and four `SAME_AS` claims that cannot all be true, and the contradiction is not local.
 *
 * `anilist:1` and `mal:200` each claim to BE `kitsu:9`, which makes them two claimants into one
 * target, guard 5's shape. Separately `mal:100` claims `anilist:1`, a chain that carries a second
 * `mal:` id onto the first claimant's side. `mal` ids are per run for about 99.7% of ids (5.4, and
 * the `mal:51535` Attack on Titan case the guards were written for), so `mal:100` and `mal:200` name
 * two different runs and cannot both be this one.
 *
 * THE ORIGIN MATTERS AND IS NOT INTERCHANGEABLE. `mal` is id-unique per run, so two unrelated mal ids
 * in one component is a real contradiction. `offline` is NOT: an anime-offline-database row is
 * addressed by whichever foreign id reached it, so `offline:anilist-1` and `offline:mal-200` are
 * routinely one row under two addresses and disagree about nothing. A fixture built on `offline`
 * looks identical and tests the opposite thing.
 *
 * NO SINGLE CLAIM IS WRONG ON ITS OWN, which is the point: the contradiction only exists once all
 * four are read together, so which one a pass refuses is decided by what it had already accepted.
 */
const TARGET = 'kitsu:9'

const named = (uri: string, handles: Record<string, unknown>[]): Record<string, unknown> =>
  media(uri, { titles: [title('en', 'A Show')], handles })

const ROWS: Record<string, () => Promise<AnswerRow>> = {
  claimant: () => answer('media', named('anilist:1', [sameAs(media(TARGET))])),
  rival: () => answer('media', named('mal:200', [sameAs(media(TARGET))])),
  chain: () => answer('media', named('mal:100', [sameAs(media('anilist:1'))])),
  tail: () => answer('media', named('anizip:7', [sameAs(media('mal:100'))])),
}

const batchesFor = (plan: string[][]): Promise<AnswerRow[][]> =>
  Promise.all(plan.map(keys => Promise.all(keys.map(key => ROWS[key]!()))))

/**
 * Six splits of those four answers. They are not arbitrary: each puts a different event first, and
 * between them they cover every order in which the contradiction can become visible.
 */
const ORDERS: { name: string, plan: string[][] }[] = [
  { name: 'both claims, then the chain', plan: [['claimant', 'rival'], ['chain'], ['tail']] },
  { name: 'the chain, then both claims', plan: [['tail'], ['chain'], ['claimant', 'rival']] },
  { name: 'one claim, the chain, the other claim', plan: [['claimant'], ['chain'], ['tail'], ['rival']] },
  { name: 'both claims, then the chain backwards', plan: [['claimant'], ['rival'], ['chain'], ['tail']] },
  { name: 'all four in one batch', plan: [['claimant', 'rival', 'chain', 'tail']] },
  { name: 'the rival first', plan: [['rival'], ['claimant'], ['chain'], ['tail']] },
]

test('four claims that cannot all be true build one graph, in every arrival order', async () => {
  const built: { name: string, shape: string[] }[] = []
  for (const order of ORDERS) {
    built.push({ name: order.name, shape: await build(await batchesFor(order.plan)) })
  }

  const first = built[0]!
  expect(first.shape.length, 'the control: the orderings built something').toBeGreaterThan(4)
  for (const entry of built.slice(1)) {
    expect(entry.shape, `"${entry.name}" against "${first.name}"`).toEqual(first.shape)
  }
})

/**
 * And the graph they agree on is the one the rule names, not merely a consistent one.
 *
 * Two consistent answers exist here and only one is the designed one. A pass can keep the union
 * whole by refusing the chain's last link (`disagreeing-ids`, guard 4: this proposal would ADD a
 * disagreement), or it can refuse both claims into the contested target (`contested`, guard 5: two
 * claimants into one row disagree). 5.2 and section 8 make guard 5 the rule for this shape, so an
 * equivalence test alone would pass on the wrong answer.
 */
test('and the graph is the contested one, not whichever one the first pass reached', async () => {
  const shape = await build(await batchesFor(ORDERS[0]!.plan))

  expect(shape).toContain('link anilist:1 -> kitsu:9 SAME_AS refused contested')
  expect(shape).toContain('link mal:200 -> kitsu:9 SAME_AS refused contested')
  // the downgrade, which is what keeps a refused pair reachable as a container rather than gone
  expect(shape).toContain('link anilist:1 -> kitsu:9 PART_OF active contested')
  expect(shape).toContain('link mal:200 -> kitsu:9 PART_OF active contested')
})

/**
 * THE CONTROL. Both cases above assert a SAMENESS, and a comparison that cannot see a difference
 * passes unconditionally. This proves `shapeOf` and `build` report one: the same four rows with the
 * rival's claim dropped is a different graph, and if this case ever goes green the two above have
 * stopped meaning anything.
 */
test('the control: a different answer set builds a different graph', async () => {
  const withRival = await build(await batchesFor([['claimant', 'rival', 'chain', 'tail']]))
  const withoutRival = await build(await batchesFor([['claimant', 'chain', 'tail']]))

  expect(withoutRival).not.toEqual(withRival)
})
