/**
 * G3, as a test: the same evidence builds the same graph whatever order it arrives in.
 *
 * The design states this four times and never checks it (`representation.md` G3 at :60, "arrival
 * order decides nothing" at :109, "arrival order cannot decide anything because every pass
 * recomputes from the same evidence" at :725, and, about guard 5 specifically, "neither wins by
 * arrival order" at :2273). The old store had `tests/unit/worker/store/arrival-order.test.ts` and
 * section 9's rewrite table lists it as a file the graph store owes; this is that file.
 *
 * WHAT IS COVERED, stated because the header above claims G3 in general and one file cannot hold it.
 * These cases pin the shape where two claimants share one target AND the shape where they share two,
 * which used to build three graphs out of six orderings: guard 5 cut one target at a time, so a second
 * shared row held the claimants together under either cut and neither was ever contested
 * (`sharedCut`, 2026-09-14).
 *
 * WHAT IS NOT, and it is a deliberate limit rather than an oversight. A contradiction answered in a
 * SINGLE batch is weighed entirely against the pre-batch snapshot, so nothing disagrees yet,
 * everything is accepted, and guard 4 then refuses to retract a standing weld ON PURPOSE: "refusing
 * every link of a component whose ids disagree empties the component, which passes the same guard on
 * the next iteration and welds it back", which is a cycle (5.2, guard 4). 5.2 says the standing
 * disagreement is reported by 5.5 instead, and the last case here checks that it actually is, so the
 * shape that arrival order can still decide is never a SILENT one.
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

  // THE LITERAL SHAPE, not a length. Every assertion below compares one ordering against another, so
  // a `shapeOf` that silently stopped reporting `status` and `reason` would make all six agree and
  // leave this whole file green while saying nothing. Pinning the first arm is what gives the
  // comparisons their content.
  const first = built[0]!
  expect(first.shape, 'the control: what the orderings must all agree ON').toEqual([
    'cluster anilist:1 anizip:7 mal:100',
    'cluster kitsu:9',
    'cluster mal:200',
    'link anilist:1 -> kitsu:9 PART_OF active contested',
    'link anilist:1 -> kitsu:9 SAME_AS refused contested',
    'link anizip:7 -> mal:100 SAME_AS active asserted',
    'link mal:100 -> anilist:1 SAME_AS active asserted',
    'link mal:200 -> kitsu:9 PART_OF active contested',
    'link mal:200 -> kitsu:9 SAME_AS refused contested',
  ])
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
 * TWO claimants sharing TWO targets, which is the shape that defeats cutting one row at a time.
 *
 * Guard 5 asks whether two claimants of a target disagree, and it answers over their components with
 * the target cut out, because otherwise the claims it is weighing are what joined them. With a SECOND
 * row both claimants also claim, cutting one leaves them joined through the other, the guard reads
 * them as agreeing, and the contest is invisible again. Measured 2026-09-14: six orderings of these
 * four answers built THREE different graphs, one of which welded `mal:100` and `mal:200` into one
 * cluster with nothing refused at all.
 *
 * `sharedCut` is the fix: every row the two claimants both claim comes out, not just the one in hand.
 *
 * Mutation: return the single target from `sharedCut` and this case reports three graphs again.
 */
const SHARED: Record<string, () => Promise<AnswerRow>> = {
  claimant: () => answer('media', named('anilist:1', [sameAs(media('kitsu:9')), sameAs(media('kitsu:10'))])),
  rival: () => answer('media', named('mal:200', [sameAs(media('kitsu:9')), sameAs(media('kitsu:10'))])),
  chain: () => answer('media', named('mal:100', [sameAs(media('anilist:1'))])),
  tail: () => answer('media', named('anizip:7', [sameAs(media('mal:100'))])),
}

test('two claimants that share TWO targets still build one graph', async () => {
  const orders = [
    [['claimant', 'rival'], ['chain'], ['tail']],
    [['tail'], ['chain'], ['claimant', 'rival']],
    [['claimant'], ['chain'], ['tail'], ['rival']],
    [['claimant'], ['rival'], ['chain'], ['tail']],
    [['claimant', 'rival', 'chain', 'tail']],
    [['rival'], ['claimant'], ['chain'], ['tail']],
  ]
  const built: string[][] = []
  for (const plan of orders) {
    built.push(await build(await Promise.all(plan.map(keys => Promise.all(keys.map(key => SHARED[key]!()))))))
  }

  // the literal shape, for the same reason the first case pins one: six arms agreeing on nothing is
  // also six arms agreeing
  expect(built[0]!.filter(line => line.startsWith('cluster'))).toEqual([
    'cluster anilist:1 anizip:7 mal:100',
    'cluster kitsu:10',
    'cluster kitsu:9',
    'cluster mal:200',
  ])
  for (const [index, shape] of built.entries()) {
    expect(shape, `ordering ${index + 1} against the first`).toEqual(built[0]!)
  }
})

/**
 * A row that AGREES with everything must not switch a guard off.
 *
 * The shape an adversarial review found on 2026-09-14, against the first version of this fix. Guard 4
 * refuses a proposal that would put two disagreeing ids in one component, and it is allowed to ignore
 * a row two DISAGREEING claimants both claim, because guard 5 is about to take that row apart. The
 * question is what counts as such a row, and "two claimants that are not already joined without it"
 * is the answer that looks right and is not: it marks every ordinary cross catalogue hub. Measured on
 * the 249 case corpus that day, 269 targets were marked and exactly one ever carried a real
 * disagreement, so guard 4 was switched off at 268 rows for nothing.
 *
 * Here `anidb:7` is that harmless row. It claims the hub, agrees with everyone, and disagrees with
 * nothing, and its only effect must be to join. `mal:100` and `mal:200` are two different runs
 * (`mal` ids are per run, 5.4) and cannot both be this show, so the claim that would put them
 * together is the one that has to be refused, with or without `anidb:7` in the graph.
 *
 * Mutation: define the cut as "the target is the only thing holding its claimants together" rather
 * than asking what THIS proposal would make true, and both orderings below weld the two runs into one
 * cluster with nothing refused at all.
 *
 * ONE ORDERING IS DELIBERATELY NOT HERE. Answering all four in a SINGLE batch welds `mal:100` and
 * `mal:200` at every commit measured, `79328e1` included, which is before any of this file existed,
 * and 5.2 declines to retract a standing weld on purpose. The case below it checks what that ordering
 * DOES promise: the contradiction is reported rather than silent.
 */
const HUB = 'kitsu:9'

const AGREEING: Record<string, () => Promise<AnswerRow>> = {
  claimant: () => answer('media', named('anilist:1', [sameAs(media(HUB))])),
  agreeing: () => answer('media', named('anidb:7', [sameAs(media(HUB))])),
  chain: () => answer('media', named('mal:100', [sameAs(media('anilist:1'))])),
  weld: () => answer('media', named(HUB, [sameAs(media('mal:200'))])),
}

const agreeingBatches = (plan: string[][]): Promise<AnswerRow[][]> =>
  Promise.all(plan.map(keys => Promise.all(keys.map(key => AGREEING[key]!()))))

test('a claimant that agrees with everything does not license a weld', async () => {
  const orders = [
    [['claimant'], ['agreeing'], ['chain'], ['weld']],
    [['chain'], ['claimant'], ['agreeing'], ['weld']],
  ]
  for (const plan of orders) {
    const shape = await build(await agreeingBatches(plan))
    expect(
      shape.filter(line => line.includes('mal:200')),
      `two different mal runs must not weld, in ${JSON.stringify(plan)}`
    ).not.toContain('link kitsu:9 -> mal:200 SAME_AS active asserted')
    expect(
      shape.some(line => line.startsWith('cluster') && line.includes('mal:100') && line.includes('mal:200')),
      `mal:100 and mal:200 in one cluster, in ${JSON.stringify(plan)}`
    ).toBe(false)
  }
})

/**
 * Where arrival order can still decide the graph, it can never decide it SILENTLY.
 *
 * This is the honest half of G3 and the reason it is a test rather than a paragraph. Answering the
 * whole contradiction in one batch weighs every proposal against the same pre-batch snapshot, so
 * nothing disagrees yet, all four are accepted, and `mal:100` and `mal:200` end up in one component.
 * Guard 4 will not retract that, deliberately (5.2: emptying the component welds it back on the next
 * iteration, which is a cycle), and guard 5 cannot reach `mal:200`, which has one claimant.
 *
 * So the store cannot promise one graph for this shape. What it does promise is that every ordering
 * REPORTS the contradiction, which is 5.5's job ("the standing disagreement is reported by 5.5
 * instead"). A weld nobody can see is the failure that matters; a weld named in `Cluster.anomalies`
 * is a row the trace panel prints and the corpus counts.
 *
 * Mutation: drop the `disagreeing-ids` rule from `plugins/anomalies.ts` and the one-batch ordering
 * below goes quiet while still welding two different runs, which is exactly the state this forbids.
 */
test('every ordering REPORTS the contradiction, even where it cannot refuse it', async () => {
  const orders = [
    [['claimant'], ['agreeing'], ['chain'], ['weld']],
    [['chain'], ['claimant'], ['agreeing'], ['weld']],
    [['claimant', 'agreeing', 'chain', 'weld']],
    [['weld'], ['claimant'], ['agreeing'], ['chain']],
  ]
  for (const plan of orders) {
    await build(await agreeingBatches(plan))
    const rows = await rowsOf('MATCH (c:Cluster) RETURN c.anomalies AS anomalies ORDER BY c.id')
    const reported = rows.flatMap(row => {
      const parsed = typeof row.anomalies === 'string' ? JSON.parse(row.anomalies) : row.anomalies
      return Array.isArray(parsed) ? (parsed as { rule: string, detail: string }[]) : []
    })
    expect(
      reported.some(anomaly => anomaly.rule === 'disagreeing-ids' && anomaly.detail.includes('mal:100') && anomaly.detail.includes('mal:200')),
      `the two runs are named as disagreeing, in ${JSON.stringify(plan)}`
    ).toBe(true)
  }
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
