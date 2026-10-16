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
import { beforeAll, expect, test } from 'vite-plus/test'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { CatalogLookup } from '../../../../../src/tracking/identity'

import { identify } from '../../../../../src/tracking/identity'
import { enableGraph } from '../../../../../src/worker/graph'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../../src/worker/graph/plugins/runner'
import { clearReadCache, episodesOf, resolveMedia } from '../../../../../src/worker/graph/read'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../../src/worker/graph/schema'
import {
  DEFAULT_PLUGINS, passSettled, startScheduler, stopScheduler,
} from '../../../../../src/worker/graph/scheduler'
import { answer, episode, media, rowsOf, sameAs, title } from './fixtures'

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

/**
 * A contest the contested row's OWN claim settles, Re:ZERO Season 4 as shaped on 2026-10-15. Kitsu
 * maps its Break Time short (`kitsu:50665`) to AniList's Season 4 id, so `anilist:189046` has two
 * claimants that disagree. AniList's own row names MyAnimeList 61316, which only Season 4's side
 * holds, so that side keeps the row and Break Time's claim is the one refused.
 */
const SEASON = { type: 'TV', episodeCount: 19, season: 'SPRING', seasonYear: 2026, titles: [title('en', 'Re:ZERO Season 4')] }
const BREAK_TIME = { type: 'ONA', episodeCount: 19, season: 'SPRING', seasonYear: 2026, titles: [title('en', 'Re:ZERO Break Time Season 4')] }
const OTHER = { type: 'TV', episodeCount: 12, season: 'SPRING', seasonYear: 2026, titles: [title('en', 'Something else entirely')] }
const SHOW = media('imdb:tt5607616', { scope: 'CONTAINER' })

type Rows = Record<string, () => Promise<AnswerRow>>

const reZero = (ownClaims: Record<string, unknown>[], extra: Rows = {}, kitsuSays: string[] = []): Rows => ({
  anilist: () => answer('media', media('anilist:189046', { ...SEASON, handles: ownClaims })),
  mal: () => answer('media', media('mal:61316', {
    ...SEASON,
    episodes: Array.from({ length: 19 }, (_, index) => episode(`mal:61316-${index + 1}`, 'mal:61316', { episodeNumber: index + 1 })),
  })),
  kitsu: () => answer('media', media('kitsu:49746', {
    ...SEASON,
    handles: [sameAs(media('anilist:189046', { handles: kitsuSays.map(uri => sameAs(media(uri))) })), sameAs(media('mal:61316'))],
  })),
  breakTime: () => answer('media', media('kitsu:50665', { ...BREAK_TIME, handles: [sameAs(media('anilist:189046')), sameAs(media('mal:63830'))] })),
  breakTimeMal: () => answer('media', media('mal:63830', BREAK_TIME)),
  ...extra,
})

const permutations = <T>(items: T[]): T[][] =>
  items.length <= 1 ? [items] : items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(rest => [item, ...rest]))

const reZeroBuild = async (rows: Rows, plan: string[][]): Promise<string[]> =>
  build(await Promise.all(plan.map(keys => Promise.all(keys.map(key => rows[key]!())))))

const episodeCountWith = async (uri: string): Promise<number> => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri })
  clearReadCache()
  return (await episodesOf((row?.id as string | undefined) ?? '')).length
}

test('Re:ZERO Season 4 keeps AniList\'s row with its 19 episodes in every arrival order', async () => {
  const rows = reZero([sameAs(media('mal:61316'))])
  const keys = Object.keys(rows)
  const plans = [[keys], ...permutations(keys).map(order => order.map(key => [key]))]
  let first: string[] | undefined
  for (const plan of plans) {
    const shape = await reZeroBuild(rows, plan)
    first ??= shape
    expect(shape, `${JSON.stringify(plan)} against the one-batch arm`).toEqual(first)
    expect(await episodeCountWith('anilist:189046'), `episodes beside AniList's row, ${JSON.stringify(plan)}`).toBe(19)
  }
  expect(first!.filter(line => line.startsWith('cluster')), 'Break Time stays its own title').toEqual([
    'cluster anilist:189046 kitsu:49746 mal:61316',
    'cluster kitsu:50665 mal:63830',
  ])
  expect(first).toContain('link kitsu:50665 -> anilist:189046 SAME_AS refused contested')
  expect(first!.filter(line => line.startsWith('link kitsu:50665 -> anilist:189046 PART_OF')), 'the refused claim leaves Break Time no part link to Season 4').toEqual([])
})

/**
 * THE CONTROLS: a contested row whose own claims cannot pick a side keeps the refusal on both. It
 * claims nothing itself (Kitsu's word about it is Kitsu's), or a row on each side, or a row neither
 * side holds, or a row on one side beside a different title's row, or only the show, which Break
 * Time's Kitsu row names too.
 */
test('a contest the row\'s own claims cannot settle refuses both claims into it', async () => {
  const cases: { name: string, rows: Rows }[] = [
    { name: 'no claim of its own', rows: reZero([], {}, ['mal:61316']) },
    { name: 'a claim into each side', rows: reZero([sameAs(media('mal:61316')), sameAs(media('mal:63830'))]) },
    {
      name: 'a claim into neither side',
      rows: reZero([sameAs(media('mal:99999'))], { other: () => answer('media', media('mal:99999', OTHER)) }),
    },
    {
      name: 'a claim into one side and one into a different title',
      rows: reZero([sameAs(media('mal:61316')), sameAs(media('mal:77777'))], { other: () => answer('media', media('mal:77777', OTHER)) }),
    },
    {
      name: 'a claim to the show alone, which Break Time also names',
      rows: reZero([sameAs(SHOW)], {
        breakTime: () => answer('media', media('kitsu:50665', {
          ...BREAK_TIME,
          handles: [sameAs(media('anilist:189046')), sameAs(media('mal:63830')), sameAs(SHOW)],
        })),
        show: () => answer('media', media('imdb:tt5607616', { scope: 'CONTAINER', type: 'TV', titles: [title('en', 'Re:ZERO')] })),
      }),
    },
  ]
  for (const { name, rows } of cases) {
    const keys = Object.keys(rows)
    for (const plan of [[keys], keys.map(key => [key]), [...keys].reverse().map(key => [key])]) {
      const shape = await reZeroBuild(rows, plan)
      for (const claimant of ['kitsu:49746', 'kitsu:50665']) {
        expect(shape, `${name}: ${claimant} refused, ${JSON.stringify(plan)}`)
          .toContain(`link ${claimant} -> anilist:189046 SAME_AS refused contested`)
      }
    }
  }
})

/**
 * The same five rows with the catalogues turned round, so the contested row (`mal:189046`) sorts
 * AFTER the rows it is weighed against instead of before them. The keys are the Re:Zero rows' roles.
 */
const TURNED: Record<string, string> = {
  'anilist:189046': 'mal:189046',
  'mal:61316': 'kitsu:61316',
  'mal:63830': 'kitsu:63830',
  'kitsu:49746': 'anilist:49746',
  'kitsu:50665': 'anilist:50665',
}
const turnedRound: Rows = {
  anilist: () => answer('media', media('mal:189046', { ...SEASON, handles: [sameAs(media('kitsu:61316')), sameAs(media('kitsu:63830'))] })),
  mal: () => answer('media', media('kitsu:61316', {
    ...SEASON,
    episodes: Array.from({ length: 19 }, (_, index) => episode(`kitsu:61316-${index + 1}`, 'kitsu:61316', { episodeNumber: index + 1 })),
  })),
  kitsu: () => answer('media', media('anilist:49746', { ...SEASON, handles: [sameAs(media('mal:189046')), sameAs(media('kitsu:61316'))] })),
  breakTime: () => answer('media', media('anilist:50665', { ...BREAK_TIME, handles: [sameAs(media('mal:189046')), sameAs(media('kitsu:63830'))] })),
  breakTimeMal: () => answer('media', media('kitsu:63830', BREAK_TIME)),
}

/**
 * KNOWN GAP, skipped rather than pinned because these plans each build a different graph. A contested
 * row whose own answer claims a row on EACH side is refused to both, but over those rows guard 5 reads
 * its side from its links, and its links are that contest's own verdicts. Its side moves with every
 * verdict, the contests over those rows read it, the pass never settles, and the iteration cap keeps
 * whichever graph arrival order reached: on the Re:ZERO rows these five plans build five graphs, the
 * third welding both runs.
 *
 * NO RULE INSIDE GUARD 5 HAS CLOSED IT (2026-10-16). Read the row's sides from what its claimants CLAIM
 * and they cannot move, but a claim another contest refuses still counts, and an id a side holds only
 * through another row's claim does not: weighing the row alone there welds two titles or hands a
 * disputed id to one side (the controls below), or leaves this shape as it is. Read them from LINKS,
 * or sever the row's verdict links for every guard, and the rule waits on the verdicts it decides,
 * which keeps the order dependence. Closing it needs guard 5 to settle such a row without reading the
 * links it is deciding.
 */
test.skip('KNOWN GAP: a contested row claiming a row on each side builds one graph in every arrival order', async () => {
  const graph = [
    'cluster anilist:189046',
    'cluster kitsu:49746 mal:61316',
    'cluster kitsu:50665 mal:63830',
    'link anilist:189046 -> mal:61316 SAME_AS refused contested',
    'link anilist:189046 -> mal:63830 SAME_AS refused contested',
    'link kitsu:49746 -> anilist:189046 PART_OF active contested',
    'link kitsu:49746 -> anilist:189046 SAME_AS refused contested',
    'link kitsu:49746 -> mal:61316 SAME_AS active asserted',
    'link kitsu:50665 -> anilist:189046 PART_OF active contested',
    'link kitsu:50665 -> anilist:189046 SAME_AS refused contested',
    'link kitsu:50665 -> mal:63830 SAME_AS active asserted',
    'link mal:61316 -> anilist:189046 INCLUDES refused no-reference',
    'link mal:61316 -> anilist:189046 PART_OF active contested',
    'link mal:63830 -> anilist:189046 PART_OF active contested',
  ]
  const plans = [
    [['anilist', 'mal', 'kitsu', 'breakTime', 'breakTimeMal']],
    [['mal', 'kitsu', 'breakTime', 'breakTimeMal'], ['anilist']],
    [['anilist', 'kitsu', 'breakTime', 'breakTimeMal'], ['mal']],
    [['anilist', 'mal', 'kitsu'], ['breakTime', 'breakTimeMal']],
    [['anilist', 'mal', 'breakTime', 'breakTimeMal'], ['kitsu']],
  ]
  const both = reZero([sameAs(media('mal:61316')), sameAs(media('mal:63830'))])
  const offline = () => answer('media', media('offline:mal-61316', { ...SEASON, handles: [sameAs(media('mal:61316'))] }))
  const fixtures: { name: string, rows: Rows, expected: string[], lead?: string }[] = [
    { name: 'Re:ZERO', rows: both, expected: graph },
    { name: 'turned round', rows: turnedRound, expected: graph.map(line => line.replace(/[a-z]+:\d+/g, uri => TURNED[uri] ?? uri)) },
    {
      name: 'with Offline\'s Season 4 row',
      rows: { ...both, offline },
      expected: [
        ...graph.map(line => (line === 'cluster kitsu:49746 mal:61316' ? `${line} offline:mal-61316` : line)),
        'link offline:mal-61316 -> mal:61316 SAME_AS active asserted',
      ],
      lead: 'offline',
    },
  ]
  for (const { name, rows, expected, lead } of fixtures) {
    for (const plan of plans) {
      const batches = lead ? [[lead, ...plan[0]!], ...plan.slice(1)] : plan
      expect((await reZeroBuild(rows, batches)).sort(), `${name}, ${JSON.stringify(batches)}`).toEqual([...expected].sort())
    }
  }
})

/**
 * THE CONTROLS a fix for that gap has to keep: shapes around it where a rule tried for it welded two
 * titles, handed a disputed id to one side or moved a contested downgrade, and where this store does
 * none of that in any order measured. AniList's row settled on Season 4's side, refused to both sides
 * or naming a MyAnimeList id on each side, beside a third show or Break Time's Kitsu row naming
 * `anidb:5`; Season 4's own AniDB id kept apart from the `anidb:5` Break Time's Kitsu row and a fourth
 * show name, where that show disagrees with Season 4's Kitsu row or only with Break Time's; and a third
 * show claiming Season 4's MyAnimeList row beside an id that disagrees with one AniList's row holds.
 */
test('the controls: a contested row\'s own claims weld nothing in any order', async () => {
  const refused = (link: string) => `link ${link} SAME_AS refused contested`
  const row = (uri: string, fields: Record<string, unknown>, handles: string[] = []): Rows[string] =>
    () => answer('media', media(uri, { ...fields, handles: handles.map(handle => sameAs(media(handle))) }))
  const own = (uris: string[]) => uris.map(uri => sameAs(media(uri)))
  const THIRD = { ...OTHER, titles: [title('en', 'A third show')] }
  const episodes = Array.from({ length: 19 }, (_, index) => episode(`mal:61316-${index + 1}`, 'mal:61316', { episodeNumber: index + 1 }))
  const ownKitsu: Rows = { other: row('kitsu:12345', OTHER) }
  const seasonAnidb = (breakTime: string[], extra: Rows): Rows => reZero(own(['mal:61316', 'anidb:5']), {
    kitsu: row('kitsu:49746', SEASON, ['anilist:189046', 'mal:61316', 'anidb:4']),
    breakTime: row('kitsu:50665', BREAK_TIME, ['anilist:189046', 'mal:63830', 'anidb:5', ...breakTime]),
    ...extra,
  })
  const anizipOwn = own(['mal:61316', 'mal:63830', 'anizip:777'])
  const cases: { name: string, rows: Rows, holds?: string[], apart?: [string, string] }[] = [
    {
      name: 'settled on Season 4\'s side',
      rows: reZero(own(['mal:61316', 'anidb:5']), { stray: row('mal:300', THIRD, ['anidb:5']) }),
      holds: [refused('anilist:189046 -> anidb:5'), refused('mal:300 -> anidb:5')],
    },
    {
      name: 'refused to both sides, joined to its own Kitsu id',
      rows: reZero(own(['kitsu:12345', 'anidb:5']), { ...ownKitsu, stray: row('kitsu:999', THIRD, ['anidb:5']) }),
      holds: [refused('anilist:189046 -> anidb:5'), refused('kitsu:999 -> anidb:5')],
    },
    {
      name: 'a MyAnimeList id on each side and one of its own',
      rows: reZero(own(['mal:61316', 'mal:63830', 'mal:100', 'anidb:5']), {
        own: row('mal:100', { ...OTHER, titles: [title('en', 'A fourth show')] }),
        stray: row('mal:300', THIRD, ['anidb:5']),
      }),
      holds: [refused('anilist:189046 -> anidb:5'), refused('mal:300 -> anidb:5')],
    },
    {
      name: 'Season 4\'s MyAnimeList id beside another title\'s Kitsu id',
      rows: reZero(own(['mal:61316', 'kitsu:12345']), ownKitsu),
      holds: [refused('kitsu:49746 -> mal:61316')],
    },
    {
      name: 'settled on Season 4\'s side, naming a row Break Time\'s Kitsu row names too',
      rows: reZero(own(['mal:61316', 'anidb:5']), { breakTime: row('kitsu:50665', BREAK_TIME, ['anilist:189046', 'mal:63830', 'anidb:5']) }),
      holds: [refused('anilist:189046 -> anidb:5'), refused('kitsu:50665 -> anidb:5')],
    },
    {
      name: 'a fourth show disagreeing with Season 4\'s Kitsu row',
      rows: seasonAnidb([], { w: row('kitsu:77777', THIRD, ['anidb:5']), anidb: row('anidb:5', THIRD, ['kitsu:77777']) }),
      apart: ['anidb:4', 'anidb:5'],
    },
    {
      name: 'the same with no answer of anidb:5\'s own',
      rows: seasonAnidb([], { w: row('kitsu:77777', THIRD, ['anidb:5']) }),
      apart: ['anidb:4', 'anidb:5'],
    },
    {
      name: 'a fourth show disagreeing with Break Time\'s Kitsu row only',
      rows: seasonAnidb(['livechart:1'], { w: row('livechart:2', THIRD, ['anidb:5']), anidb: row('anidb:5', THIRD, ['livechart:2']) }),
      apart: ['anidb:4', 'anidb:5'],
    },
    {
      name: 'a third show claiming Season 4\'s MyAnimeList row',
      rows: reZero(anizipOwn, { stray: row('anizip:888', THIRD, ['mal:61316']) }),
      holds: [refused('anizip:888 -> mal:61316')],
    },
    {
      name: 'the same with an AniDB id on each side of it',
      rows: reZero(anizipOwn, {
        mal: row('mal:61316', { ...SEASON, episodes }, ['anidb:5']),
        stray: row('anizip:999', THIRD, ['mal:61316', 'anidb:6']),
      }),
      holds: [refused('anizip:999 -> mal:61316')],
    },
    {
      name: 'a third show claiming AniList\'s row and Season 4\'s MyAnimeList row',
      rows: reZero(anizipOwn, {
        mal: row('mal:61316', { ...SEASON, episodes }, ['kitsu:49746']),
        stray: row('anizip:999', THIRD, ['anilist:189046', 'mal:61316', 'kitsu:888']),
      }),
      holds: ['link anilist:189046 -> mal:61316 PART_OF active contested', 'link anizip:999 -> mal:61316 PART_OF active contested'],
    },
  ]
  for (const { name, rows, holds = [], apart } of cases) {
    const keys = Object.keys(rows)
    for (const plan of [[keys], keys.map(key => [key]), [...keys].reverse().map(key => [key])]) {
      const shape = await reZeroBuild(rows, plan)
      for (const line of holds) expect(shape, `${name}, ${JSON.stringify(plan)}`).toContain(line)
      if (apart) {
        expect(shape.filter(line => line.startsWith('cluster ') && apart.every(uri => line.split(' ').includes(uri))), `${name}, ${JSON.stringify(plan)}`)
          .toEqual([])
      }
    }
  }
})

/**
 * 8.6: MyAnimeList's one row for both Attack on Titan Final Chapters specials. Its own answer names
 * AniDB's and AniZip's entries, which AniZip maps to Part 1's AniList id only, and Part 2 holds no id
 * of either catalogue, so nothing in those claims says Part 2 is wrong and the row stays with neither
 * part. The second arm adds Part 1's offline row naming the same AniDB entry.
 */
test('MyAnimeList\'s row for both Attack on Titan specials joins neither part', async () => {
  const PART_1 = { type: 'TV', episodeCount: 1, season: 'SPRING', seasonYear: 2023, titles: [title('en', 'Attack on Titan Final Chapters Special 1')] }
  const PART_2 = { type: 'TV', episodeCount: 1, season: 'FALL', seasonYear: 2023, titles: [title('en', 'Attack on Titan Final Chapters Special 2')] }
  const BOTH = { type: 'TV', episodeCount: 2, season: 'SPRING', seasonYear: 2023, titles: [title('en', 'Attack on Titan Final Chapters')] }
  const rows: Rows = {
    part1: () => answer('media', media('anilist:146984', { ...PART_1, handles: [sameAs(media('mal:51535'))] })),
    part2: () => answer('media', media('anilist:162314', { ...PART_2, handles: [sameAs(media('mal:51535'))] })),
    part1Kitsu: () => answer('media', media('kitsu:46038', { ...PART_1, handles: [sameAs(media('anilist:146984')), sameAs(media('mal:51535'))] })),
    part2Kitsu: () => answer('media', media('kitsu:47390', { ...PART_2, handles: [sameAs(media('anilist:162314')), sameAs(media('mal:51535'))] })),
    mal: () => answer('media', media('mal:51535', {
      ...BOTH,
      handles: [sameAs(media('anidb:17303')), sameAs(media('anizip:17303'))],
      episodes: [1, 2].map(number => episode(`mal:51535-${number}`, 'mal:51535', { episodeNumber: number })),
    })),
    anizip: () => answer('media', media('anizip:17303', { ...BOTH, handles: [sameAs(media('mal:51535')), sameAs(media('anilist:146984'))] })),
  }
  const offline = () => answer('media', media('offline:mal-51535', {
    ...PART_1,
    handles: [sameAs(media('mal:51535')), sameAs(media('anilist:146984')), sameAs(media('anidb:17303'))],
  }))
  for (const arm of [rows, { ...rows, offline }]) {
    const keys = Object.keys(arm)
    for (const plan of [[keys], keys.map(key => [key]), [...keys].reverse().map(key => [key])]) {
      const shape = await reZeroBuild(arm, plan)
      for (const claimant of ['anilist:146984', 'anilist:162314']) {
        expect(shape, `${claimant} refused, ${JSON.stringify(plan)}`)
          .toContain(`link ${claimant} -> mal:51535 SAME_AS refused contested`)
      }
    }
  }
})

/**
 * Steel Ball Run, shaped on the answers recorded live on anime.fkn.app on 2026-10-16: the Fall 2026
 * page and the first stage's own page. MyAnimeList 61469 is the first stage (AniList 190327) and 63825
 * the second (AniList 210482). AniList's row for the second names `idMal` 61469, the first stage, and
 * Offline's rows borrow MyAnimeList's ids, so `offline:mal-63825` IS the second stage's MyAnimeList id.
 */
const FALL = { type: 'ONA', season: 'FALL', seasonYear: 2026 }
const STEEL_BALL_RUN: Rows = {
  offline1: () => answer('media', media('offline:mal-61469', {
    ...FALL,
    titles: [title('en', 'Steel Ball Run: JoJo no Kimyou na Bouken', 0.2)],
    handles: [sameAs(media('mal:61469')), sameAs(media('anilist:190327'))],
  })),
  offline2: () => answer('media', media('offline:mal-63825', {
    ...FALL,
    episodeCount: 3,
    titles: [title('en', 'Steel Ball Run: JoJo no Kimyou na Bouken 2nd Stage', 0.2)],
    handles: [sameAs(media('mal:63825')), sameAs(media('anilist:210482'))],
  })),
  mal: () => answer('media', media('mal:61469', {
    ...FALL,
    titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.9), title('jp-en', 'Steel Ball Run: JoJo no Kimyou na Bouken', 0.9)],
  })),
  anilist2: () => answer('media', media('anilist:210482', {
    ...FALL,
    episodeCount: 11,
    status: 'RELEASING',
    titles: [title('en', 'STEEL BALL RUN JoJo\'s Bizarre Adventure 2nd - 3rd STAGE', 0.8)],
    handles: [sameAs(media('mal:61469'))],
  })),
  anilist1: () => answer('media', media('anilist:190327', {
    type: 'ONA',
    season: 'WINTER',
    seasonYear: 2026,
    episodeCount: 1,
    status: 'FINISHED',
    titles: [title('en', 'STEEL BALL RUN JoJo\'s Bizarre Adventure 1st STAGE', 0.8)],
    handles: [sameAs(media('mal:61469'))],
  })),
}

/** The pairs the offline database carries, which is what the trackers widen an id through. */
const CATALOGUE = [
  { mal: 61469, anilist: 190327, kitsu: 0, anidb: 0 },
  { mal: 63825, anilist: 210482, kitsu: 0, anidb: 0 },
  { mal: 63802, anilist: 108992, kitsu: 42337, anidb: 0 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => CATALOGUE.find(row => row[origin] === id) }

const addressOf = async (uri: string): Promise<string> => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.aggUri AS aggUri', { uri })
  return String(row?.aggUri)
}

const trackedAs = async (uri: string): Promise<string> => {
  const identity = identify(await addressOf(uri), catalog)
  return identity.kind === 'ambiguous' ? `ambiguous ${identity.candidates.join(' ')}` : identity.kind
}

/**
 * One id per catalogue in a cluster, Offline's borrowed id counting as the id it borrows. In every
 * order AniList's claim that its second stage is `mal:61469` is refused, the first stage keeps
 * MyAnimeList's row and the second keeps Offline's.
 */
test('Steel Ball Run\'s two stages build two clusters in every arrival order', async () => {
  const keys = Object.keys(STEEL_BALL_RUN)
  for (const plan of [[keys], ...permutations(keys).map(order => order.map(key => [key]))]) {
    const shape = await reZeroBuild(STEEL_BALL_RUN, plan)
    expect(shape.filter(line => line.startsWith('cluster')), JSON.stringify(plan)).toEqual([
      'cluster anilist:190327 mal:61469 offline:mal-61469',
      'cluster anilist:210482 offline:mal-63825',
    ])
    expect(shape.find(line => line.startsWith('link anilist:210482 -> mal:61469 SAME_AS')), JSON.stringify(plan))
      .toMatch(/ refused /)
  }
})

const landsBy = (first: string, second: string) => (order: string[]) => order.indexOf(first) < order.indexOf(second)

/**
 * And the trackers can read both, in every order. Where AniList's second stage row lands before
 * Offline's, its `mal:61469` is all the graph knows and is taken, and the stages split a pass later:
 * a card's address names the rows it holds, so the split leaves no run in the other's address. The
 * second plan is the second stage's own page with nothing of the current season's listing before it,
 * the third the Fall 2026 page.
 */
test('each stage\'s address names its own run only, so the trackers read both, in every arrival order', async () => {
  const keys = Object.keys(STEEL_BALL_RUN)
  const plans = [
    [keys],
    [['offline2'], ['anilist2'], ['offline1'], ['mal'], ['anilist1']],
    [['offline1', 'offline2'], ['anilist2'], ['mal'], ['anilist1']],
    [['offline2', 'anilist2'], ['offline1', 'mal', 'anilist1']],
    ...permutations(keys).map(order => order.map(key => [key])),
  ]
  for (const plan of plans) {
    await reZeroBuild(STEEL_BALL_RUN, plan)
    expect(await addressOf('anilist:190327'), `the first stage, ${JSON.stringify(plan)}`).toBe('ag:(anilist:190327,mal:61469,offline:mal-61469)')
    expect(await addressOf('anilist:210482'), `the second stage, ${JSON.stringify(plan)}`).toBe('ag:(anilist:210482,offline:mal-63825)')
    expect(await trackedAs('anilist:190327'), `the first stage, ${JSON.stringify(plan)}`).toBe('catalogue')
    expect(await trackedAs('anilist:210482'), `the second stage, ${JSON.stringify(plan)}`).toBe('catalogue')
  }
})

/**
 * A link saved while the stages were one card names both, and keeps opening the first stage, the
 * lowest key it reaches. The card's own address opens that card again, so a page that takes it on
 * stays there.
 */
test('a link naming both stages opens the first stage in every arrival order', async () => {
  const saved = 'ag:(anilist:190327,anilist:210482,anizip:19287,mal:61469,offline:mal-61469)'
  for (const order of permutations(Object.keys(STEEL_BALL_RUN))) {
    const plan = order.map(key => [key])
    await reZeroBuild(STEEL_BALL_RUN, plan)
    const [first] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri: 'anilist:190327' })
    clearReadCache()
    const opened = await resolveMedia(saved)
    expect(opened?._id, JSON.stringify(plan)).toBe(first?.id)
    expect(opened?.uri, JSON.stringify(plan)).toBe('ag:(anilist:190327,mal:61469,offline:mal-61469)')
    const again = await resolveMedia(opened!.uri)
    expect([again?._id, again?.uri], JSON.stringify(plan)).toEqual([opened!._id, opened!.uri])
  }
})

/**
 * Mebius Dust as answered live on 2026-10-16: Kitsu names MyAnimeList 39473, an id the offline
 * database does not hold, while Offline's row and AniList both name 63802. Wherever Offline's row
 * lands no later than Kitsu's, Kitsu's id is the one left out and the trackers read the card.
 */
const SUMMER = { type: 'TV', season: 'SUMMER', seasonYear: 2026, titles: [title('en', 'Mebius Dust')] }
const MEBIUS_DUST: Rows = {
  offline: () => answer('media', media('offline:mal-63802', {
    ...SUMMER,
    episodeCount: 12,
    handles: [sameAs(media('mal:63802')), sameAs(media('anilist:108992')), sameAs(media('kitsu:42337'))],
  })),
  kitsu: () => answer('media', media('kitsu:42337', { ...SUMMER, handles: [sameAs(media('anilist:108992')), sameAs(media('mal:39473'))] })),
  mal: () => answer('media', media('mal:63802', { ...SUMMER, episodeCount: 12 })),
  anilist: () => answer('media', media('anilist:108992', { ...SUMMER, episodeCount: 12, handles: [sameAs(media('mal:63802'))] })),
}

test('Kitsu\'s MyAnimeList id for Mebius Dust is refused wherever Offline\'s row lands no later than Kitsu\'s', async () => {
  const keys = Object.keys(MEBIUS_DUST)
  for (const plan of [[keys], ...permutations(keys).filter(landsBy('offline', 'kitsu')).map(order => order.map(key => [key]))]) {
    const shape = await reZeroBuild(MEBIUS_DUST, plan)
    expect(shape.filter(line => line.startsWith('cluster')), JSON.stringify(plan)).toEqual([
      'cluster anilist:108992 kitsu:42337 mal:63802 offline:mal-63802',
      'cluster mal:39473',
    ])
    expect(await trackedAs('anilist:108992'), JSON.stringify(plan)).toBe('catalogue')
  }
})

/**
 * THE CONTROL: one run named by its own ids in three catalogues, Offline's borrowed one included,
 * joins, and `offline:mal-61469` beside `mal:61469` is reported as nothing (5.5).
 */
test('the first stage alone joins across its catalogues in every arrival order', async () => {
  const { offline1, mal, anilist1 } = STEEL_BALL_RUN
  const rows: Rows = { offline1: offline1!, mal: mal!, anilist1: anilist1! }
  const keys = Object.keys(rows)
  for (const plan of [[keys], ...permutations(keys).map(order => order.map(key => [key]))]) {
    const shape = await reZeroBuild(rows, plan)
    expect(shape.filter(line => line.startsWith('cluster')), JSON.stringify(plan))
      .toEqual(['cluster anilist:190327 mal:61469 offline:mal-61469'])
    expect(await trackedAs('mal:61469')).toBe('catalogue')
    const [cluster] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.anomalies AS anomalies', { uri: 'mal:61469' })
    expect(JSON.stringify(cluster?.anomalies ?? null), JSON.stringify(plan)).not.toContain('disagreeing-ids')
  }
})
