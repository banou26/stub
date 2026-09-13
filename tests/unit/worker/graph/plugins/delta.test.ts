/**
 * The scoped pass of 5.3: where a plugin's subjects come from, who is skipped, what `ctx.previous`
 * holds under a partial scope, and the one case that decides whether any of it is safe.
 *
 * THE EQUIVALENCE CASE IS THE POINT OF THE FILE. Everything above it checks a mechanism; the last
 * case checks the only property that matters, which is that a graph built by a stream of scoped
 * passes is the graph one full pass would have built. It is written as a DIFF of two exports rather
 * than as a list of expectations, because a hand-written expectation can only pin what was thought
 * of, and the failure being guarded against is a link, an attachment or a slot nobody thought of.
 *
 * Cluster ids are deliberately NOT compared: two arms mint them in different orders and a stable id
 * is a property of one graph over time, not of two graphs against each other. A cluster is keyed by
 * its sorted members, which is what a reader actually resolves through.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { Plugin, PluginId, PluginRow, Scope } from '../../../../../src/worker/graph/plugins/contract'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../../src/worker/graph/schema'
import {
  DEFAULT_PLUGINS, passSettled, schedulePass, startScheduler, stopScheduler,
} from '../../../../../src/worker/graph/scheduler'
import { answer, episode, media, partOf, rowsOf, sameAs, title } from './fixtures'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

/** How much of the recorded page the equivalence case replays. The whole page is 22 s of CPU. */
const EQUIVALENCE_ROWS = Number(process.env.GRAPH_MEASURE_ROWS ?? 200)

/** Empty every table, the only reset this engine has: it cannot be closed and reopened in one process. */
const truncate = async (): Promise<void> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
}

/** One iteration as the probe saw it: the delta it was handed, flattened to something comparable. */
type Seen = { iteration: number, media: string[], episodes: string[], claims: string[], clusters: string[], full: boolean }

/**
 * A plugin that records the delta of every iteration it runs in, and writes what it was told to.
 *
 * It declares a PARTIAL scope by default, because that is what makes it skippable: a plugin whose
 * last output was `scope.full` is exempt from the skip, and a probe that could never be skipped
 * could not see the rule it is here to check.
 */
const probe = (
  id: string,
  consumes: Plugin['consumes'],
  rowsFor: (iteration: number) => PluginRow[] = () => [],
  scope: Scope = { full: false, clusters: [], uris: [], pairs: [] }
): Plugin & { seen: Seen[] } => {
  const seen: Seen[] = []
  return {
    seen,
    id: id as PluginId,
    consumes,
    produces: { nodes: ['MediaProfile'], edges: [] },
    after: [],
    version: 1,
    run: async ctx => {
      const iteration = seen.length + 1
      seen.push({
        iteration,
        media: [...ctx.delta.media].sort(),
        episodes: [...ctx.delta.episodes].sort(),
        claims: [...ctx.delta.claims].sort(),
        clusters: [...ctx.delta.clusters].sort(),
        full: ctx.delta.full,
      })
      const rows = rowsFor(iteration)
      return {
        // a plugin that desires rows has to scope them, or the writer reads no current set for them
        scope: scope.full ? scope : { full: false, clusters: [], pairs: [], uris: rows.map(row => String(row.uri)) },
        nodes: [{ table: 'MediaProfile', rows }],
        edges: [],
        links: [],
        episodeLinks: [],
      }
    },
  }
}

const profileUris = async (by: string) =>
  (await rowsOf('MATCH (n:MediaProfile) WHERE n.by = $by RETURN n.uri AS uri ORDER BY n.uri', { by })).map(row => row.uri)

beforeAll(async () => {
  await enableGraph(true)
})

afterAll(async () => {
  await closeGraph()
})

// (a) WHERE THE SUBJECTS COME FROM. Iteration 1 is the WAKE: the media uris, episode uris and claim
// keys the commits behind this pass named. Iteration 2 is what the writer APPLIED in iteration 1 and
// nothing else, which is the only source available (`ctx.since` equals `passStart` from iteration 2,
// so a `seq > since` scan would read nothing and the fixed point would end for the wrong reason).
// Mutation: hand every iteration the wake's delta (drop the `tables = changeDelta(applied)` line) and
// iteration 2 below reads the wake's three uris instead of the one row iteration 1 wrote.
test('iteration 1 carries the wake, and iteration 2 carries what iteration 1 applied', async () => {
  resetPassState()
  const recorder = probe(
    'plugin:delta-subjects',
    // every table the wake's three lists are attributed to, so this case reads the whole wake; the
    // per-table filtering `consumes` does is case (b)
    { nodes: ['Media', 'Episode', 'MediaProfile'], edges: ['CLAIMS'] },
    iteration => (iteration === 1 ? [{ uri: 'delta:written', scope: 'RUN' }] : [{ uri: 'delta:written', scope: 'RUN' }])
  )

  const report = await runPlugins([recorder], {
    reason: 'graph:changed',
    seq: 3,
    uris: ['delta:one'],
    episodes: ['delta:one-1'],
    claims: ['claim-key-1'],
  }, { audit: false })

  expect(report.iterations, 'the runner is unchanged: two iterations for a converging pass').toBe(2)
  expect(recorder.seen[0]).toEqual({
    iteration: 1, media: ['delta:one'], episodes: ['delta:one-1'], claims: ['claim-key-1'], clusters: [], full: false,
  })
  expect(recorder.seen[1], 'the row iteration 1 wrote, and not one thing the wake named').toEqual({
    iteration: 2, media: ['delta:written'], episodes: [], claims: [], clusters: [], full: false,
  })
})

// (b) THE SKIP, with its control in the same case: a plugin whose `consumes` names nothing in the
// delta does not run, and one that declared `scope.full` does, because a whole-graph plugin reads
// tables it never declared and the delta says nothing about its output.
// Mutation: run every plugin every iteration (drop the `skipped` branch) and the scoped probe below
// records a second iteration, so `seen.length` is 2 rather than 1.
test('a plugin whose consumes carries nothing in the delta is skipped, and a full-scope one is not', async () => {
  resetPassState()
  // it consumes CLUSTER only, so the MediaProfile the writer applies in iteration 1 is nothing to it
  const scoped = probe('plugin:delta-scoped', { nodes: ['Cluster'], edges: [] })
  const whole = probe(
    'plugin:delta-whole',
    { nodes: ['Cluster'], edges: [] },
    () => [{ uri: 'delta:whole', scope: 'RUN' }],
    { full: true }
  )

  const report = await runPlugins([scoped, whole], {
    reason: 'graph:changed', seq: 1, uris: ['delta:two'], claims: ['claim-key-2'],
  }, { audit: false })

  expect(scoped.seen.length, 'iteration 1 only: nothing it consumes moved in iteration 1').toBe(1)
  expect(whole.seen.length, 'the control: a scope.full plugin runs while the delta is non-empty').toBe(2)
  expect(report.runs.filter(run => run.skipped).map(run => `${run.id} ${run.iteration}`))
    .toEqual(['plugin:delta-scoped 2'])
  expect(await profileUris('plugin:delta-whole'), 'and it wrote what it desired').toEqual(['delta:whole'])
})

// (c) A BOOT PASS IS FULL, whatever the trigger carries beside the reason, and so is a manual one: a
// worker that just started knows nothing is unchanged, and `manual` is a caller asking for
// everything (5.3, full passes).
// Mutation: read the delta off the trigger whatever the reason and the boot pass below reads
// `full: false` with one uri, so a first pass over a cold graph profiles one row.
test('a boot pass is full even when the trigger names uris', async () => {
  resetPassState()
  const recorder = probe('plugin:delta-boot', { nodes: ['Media'], edges: [] })

  await runPlugins([recorder], { reason: 'boot', seq: 1, uris: ['delta:three'] }, { audit: false })
  expect(recorder.seen[0], 'a boot pass says nothing is known to be unchanged').toEqual({
    iteration: 1, media: [], episodes: [], claims: [], clusters: [], full: true,
  })

  const manual = probe('plugin:delta-manual', { nodes: ['Media'], edges: [] })
  await runPlugins([manual], { reason: 'manual', uris: ['delta:three'] }, { audit: false })
  expect(manual.seen[0]!.full).toBe(true)
})

// (d) `ctx.previous` UNDER A PARTIAL SCOPE is the plugin's FULL previous output, not the slice the
// scope named. `plugin:aggregate` takes a non-empty index as the whole of its previous state and
// skips its graph fallback, so a truncated one mints a fresh cluster id for every cluster the scope
// did not name, silently retiring stable ids (5.3).
// Mutation: return the scoped desired set as the index (`return index` unconditionally in the
// writer's `retain`) and the second pass below sees one row instead of two.
test('ctx.previous under a scoped pass holds the rows outside the scope', async () => {
  resetPassState()
  const seen: string[][] = []
  const carrying = (rows: PluginRow[]): Plugin => ({
    id: 'plugin:delta-previous' as PluginId,
    consumes: { nodes: ['Media'], edges: [] },
    produces: { nodes: ['MediaProfile'], edges: [] },
    after: [],
    version: 1,
    run: async ctx => {
      seen.push([...ctx.previous.nodes.MediaProfile?.keys() ?? []].sort())
      return {
        scope: { full: false, clusters: [], pairs: [], uris: rows.map(row => String(row.uri)) },
        nodes: [{ table: 'MediaProfile', rows }],
        edges: [],
        links: [],
        episodeLinks: [],
      }
    },
  })

  await runPlugins([carrying([{ uri: 'keep:1', scope: 'RUN' }, { uri: 'keep:2', scope: 'RUN' }])], {
    reason: 'graph:changed', seq: 1, uris: ['keep:1', 'keep:2'],
  }, { audit: false })
  expect(seen[0], 'the first run has no previous output at all').toEqual([])

  // a second pass that recomputes ONE of the two: the other is outside its scope and untouched. It
  // takes THREE runs to see the difference, because it is the second run's index the third is handed
  await runPlugins([carrying([{ uri: 'keep:1', scope: 'RUN' }])], {
    reason: 'graph:changed', seq: 2, uris: ['keep:1'],
  }, { audit: false })
  expect(seen[1], 'both rows: the first run desired both').toEqual(['keep:1', 'keep:2'])

  await runPlugins([carrying([{ uri: 'keep:1', scope: 'RUN' }])], {
    reason: 'graph:changed', seq: 3, uris: ['keep:1'],
  }, { audit: false })

  expect(seen[2], 'both rows, though the run before this one recomputed one of them').toEqual(['keep:1', 'keep:2'])
  expect(await profileUris('plugin:delta-previous'), 'the control: the row outside the scope still stands')
    .toEqual(['keep:1', 'keep:2'])
})

// (e) A RETRACTION INSIDE THE SCOPE LEAVES THE INDEX. The other half of (d): what the retention
// carries forward is what the scope did not name, never what it named and dropped.
// Mutation: merge the desired set into the kept index without removing what the diff deleted and
// `keep:2` below is still in `ctx.previous` after the run that retracted it.
test('a row the scoped pass retracted leaves ctx.previous with it', async () => {
  resetPassState()
  const seen: string[][] = []
  const retracting = (rows: PluginRow[], uris: string[]): Plugin => ({
    id: 'plugin:delta-retract' as PluginId,
    consumes: { nodes: ['Media'], edges: [] },
    produces: { nodes: ['MediaProfile'], edges: [] },
    after: [],
    version: 1,
    run: async ctx => {
      seen.push([...ctx.previous.nodes.MediaProfile?.keys() ?? []].sort())
      return {
        scope: { full: false, clusters: [], pairs: [], uris },
        nodes: [{ table: 'MediaProfile', rows }],
        edges: [],
        links: [],
        episodeLinks: [],
      }
    },
  })

  await runPlugins([retracting([{ uri: 'drop:1', scope: 'RUN' }, { uri: 'drop:2', scope: 'RUN' }], ['drop:1', 'drop:2'])], {
    reason: 'graph:changed', seq: 1, uris: ['drop:1', 'drop:2'],
  }, { audit: false })
  // the same scope, one row gone: the writer deletes it, and the index must lose it too
  await runPlugins([retracting([{ uri: 'drop:1', scope: 'RUN' }], ['drop:1', 'drop:2'])], {
    reason: 'graph:changed', seq: 2, uris: ['drop:1', 'drop:2'],
  }, { audit: false })
  await runPlugins([retracting([{ uri: 'drop:1', scope: 'RUN' }], ['drop:1'])], {
    reason: 'graph:changed', seq: 3, uris: ['drop:1'],
  }, { audit: false })

  expect(seen[1]).toEqual(['drop:1', 'drop:2'])
  expect(seen[2], 'what the scope retracted is gone from the index too').toEqual(['drop:1'])
  expect(await profileUris('plugin:delta-retract')).toEqual(['drop:1'])
})

// ---------------------------------------------------------------------------------------------
// THE EQUIVALENCE CASE.

/**
 * The graph as a reader sees it, with nothing in it that a pass is free to choose.
 *
 * A cluster is keyed by its sorted members rather than by its id, and every edge is named by uris, so
 * two graphs built in a different order compare equal exactly when they say the same thing about the
 * same rows. `plugin:` stamps are dropped for the same reason they are kept in the graph: which rule
 * wrote a row is not what a reader resolves.
 */
const exportView = async (): Promise<Record<string, string[]>> => {
  const members = await rowsOf(
    'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY c.id, m.uri'
  )
  const byCluster = new Map<string, string[]>()
  for (const row of members) byCluster.set(String(row.id), [...byCluster.get(String(row.id)) ?? [], String(row.uri)])
  const keyOf = (id: string): string => (byCluster.get(id) ?? [`<empty ${id}>`]).join(' ')

  const clusters = await rowsOf(
    'MATCH (c:Cluster) RETURN c.id AS id, c.scope AS scope, c.kind AS kind, c.hidden AS hidden, c.runLength AS runLength ORDER BY c.id'
  )
  const links = await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason
     ORDER BY fromUri, toUri, kind, reason`
  )
  const episodeLinks = await rowsOf(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.status AS status, l.reason AS reason
     ORDER BY fromUri, toUri, reason`
  )
  const attachments = await rowsOf(
    'MATCH (a:Cluster)-[e:ATTACHED_TO]->(b:Cluster) RETURN a.id AS fromId, b.id AS toId, e.via AS via'
  )
  const slots = await rowsOf(
    'MATCH (s:Slot)-[:SLOT_OF]->(c:Cluster) RETURN c.id AS id, s.number AS number, s.id AS slotId ORDER BY c.id, s.number'
  )
  const fills = await rowsOf(
    'MATCH (n)-[:FILLS]->(s:Slot) RETURN s.clusterId AS id, s.number AS number, n.uri AS uri ORDER BY s.clusterId, s.number, n.uri'
  )

  return {
    clusters: clusters.map(row => `${keyOf(String(row.id))} | ${row.scope} ${row.kind} hidden=${row.hidden} run=${row.runLength}`).sort(),
    links: links.map(row => `${row.fromUri} -> ${row.toUri} ${row.kind} ${row.status} ${row.reason}`).sort(),
    episodeLinks: episodeLinks.map(row => `${row.fromUri} -> ${row.toUri} ${row.status} ${row.reason}`).sort(),
    attachments: attachments.map(row => `${keyOf(String(row.fromId))} -> ${keyOf(String(row.toId))} ${row.via}`).sort(),
    slots: slots.map(row => `${keyOf(String(row.id))} #${row.number}`).sort(),
    fills: fills.map(row => `${keyOf(String(row.id))} #${row.number} ${row.uri}`).sort(),
  }
}

/** The walkthrough fixtures, in the batches a page would answer them in: one wake each. */
const walkthroughBatches = async (): Promise<AnswerRow[][]> => [
  [
    await answer('media', media('mal:8001', { titles: [title('en', 'Frieren'), title('en', 'Sousou no Frieren')], episodeCount: 28, startDate: '2023-09-29' })),
    await answer('media', media('kitsu:8001', { titles: [title('en', 'Frieren')], episodeCount: 28, handles: [sameAs(media('mal:8001'))] })),
  ],
  [
    await answer('media', media('cr:GSHOW8', { scope: 'CONTAINER', titles: [title('en', 'Frieren')] })),
    await answer('media', media('cr:GRUN8', { titles: [title('en', 'Frieren Season 1')], episodeCount: 28, handles: [partOf(media('cr:GSHOW8'))] })),
  ],
  [
    await answer('episode', episode('cr:GRUN8-1', 'cr:GRUN8', { episodeNumber: 1, releaseDate: '2023-09-29', titles: [title('en', 'The Journey')] })),
    await answer('episode', episode('cr:GRUN8-2', 'cr:GRUN8', { episodeNumber: 2, releaseDate: '2023-10-06', titles: [title('en', 'It Didn\'t Have to Be Magic')] })),
    await answer('episode', episode('anizip:8001-1', 'mal:8001', { episodeNumber: 1, releaseDate: '2023-09-29' })),
    await answer('episode', episode('anizip:8001-2', 'mal:8001', { episodeNumber: 2, releaseDate: '2023-10-06' })),
  ],
  [
    await answer('media', media('anilist:8001', { titles: [title('en', 'Frieren')], episodeCount: 28, handles: [sameAs(media('mal:8001')), sameAs(media('kitsu:8001'))] })),
    await answer('media', media('nf:8001', { titles: [title('en', 'Frieren: Beyond Journeys End')], episodeCount: 28 })),
  ],
]

/**
 * A pass that settles must actually be settled: a fresh full pass after it writes nothing.
 *
 * `plugin:direct` consumes `MediaProfile` and `CLAIMS`, and until 2026-09-14 not `LINK`. `deltaFor`
 * drops every table a plugin does not declare, so an iteration whose only writes are `LINK`, `Cluster`
 * and `MEMBER_OF` handed direct nothing and the runner SKIPPED it, while the guards it goes through
 * read the active `SAME_AS` link graph for both guard 4 and guard 5. The pass then reported a fixed
 * point it had not reached, and three refusal reasons were still moving.
 *
 * WHY NO EXISTING TEST SAW IT, which is the part worth keeping. Every idempotence case in the plugin
 * suites ("the same page twice is the same links" and its four siblings) drives `runPlugins` with
 * `{ reason: 'manual' }`. A manual trigger makes iteration 1 FULL, so `wholeGraph` holds
 * `plugin:direct` and the skip can never engage in any of them. The recorded page converges in one
 * manual pass with or without the fix, so the measurement could not express the failure either. This
 * case goes through the SCHEDULER, which is the only path that produces a scoped iteration 1.
 *
 * The fixture is five rows whose claims cross: the point is an iteration late in the pass whose only
 * writes are links.
 *
 * Mutation: drop `'LINK'` from `plugin:direct`'s `consumes` and the assertion below reports six
 * changes, three `LINK` updates and three `Cluster` updates.
 */
test('a settled scheduler pass leaves nothing for a fresh full pass to write', async () => {
  const rows = [
    await answer('media', media('anilist:100', {
      titles: [title('en', 'Crossed')],
      handles: [sameAs(media('kitsu:104')), sameAs(media('anidb:103'))],
    })),
    await answer('media', media('kitsu:101', { titles: [title('en', 'Crossed')], handles: [sameAs(media('kitsu:104'))] })),
    await answer('media', media('kitsu:102', { titles: [title('en', 'Crossed')], handles: [sameAs(media('anilist:100'))] })),
    await answer('media', media('anidb:103', {
      titles: [title('en', 'Crossed')],
      handles: [sameAs(media('kitsu:102')), sameAs(media('kitsu:104'))],
    })),
    await answer('media', media('kitsu:104', { titles: [title('en', 'Crossed')], handles: [sameAs(media('anidb:103'))] })),
  ]

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
  await ingestAnswers(rows)
  await passSettled()
  stopScheduler()

  resetPassState()
  const after = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' })
  expect(
    after.changes.map(change => `${change.table} ${change.operation}`),
    'the scheduler said it was settled, so a full pass over the same graph has nothing to write'
  ).toEqual([])
})

/**
 * THE ONE THAT MATTERS: a stream of scoped passes builds the graph one full pass builds.
 *
 * The scoped arm goes through the SCHEDULER, one wake per ingest batch, because the wake is where a
 * scoped delta comes from on the live path and a test that hand-built the delta would be testing its
 * own idea of one. The full arm ingests everything first and then asks for a single `manual` pass,
 * which is a full pass by definition.
 *
 * Both arms start from an emptied graph and both run every plugin. The scoped arm runs with
 * `audit: true`, so the second thing this case proves is that a stream of scoped passes leaves the
 * source tables alone.
 *
 * Mutation: break the retention of `ctx.previous` (return the scoped desired set from the writer's
 * `retain`) and the two arms disagree about clusters, because `plugin:aggregate` re-mints an id for
 * every cluster a wake did not name and the members move with it.
 */
test('a stream of scoped passes builds the graph one full pass builds, on the fixtures', async () => {
  const batches = await walkthroughBatches()

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: true })
  for (const batch of batches) {
    await ingestAnswers(batch)
    await passSettled()
  }
  const settled = await passSettled()
  stopScheduler()
  expect(settled!.audit.ok, settled!.audit.differences.join('; ')).toBe(true)
  const scoped = await exportView()

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: true })
  for (const batch of batches) await ingestAnswers(batch)
  await passSettled()
  const full = await schedulePass('manual')
  stopScheduler()
  expect(full.audit.ok, full.audit.differences.join('; ')).toBe(true)
  const whole = await exportView()

  expect(scoped.clusters!.length, 'the control: the arms built something').toBeGreaterThan(0)
  expect(scoped.links!.length).toBeGreaterThan(0)
  expect(scoped).toEqual(whole)
}, 600_000)

/**
 * The same equivalence on a REAL page, which is the only input carrying the shapes 24 sources
 * produce: a source answering about another origin's uri, handles naming no node, four-deep nesting.
 *
 * Skipped with a message where the corpus has not been walked, because a session with no corpus and
 * a session with a broken pass must not report alike.
 */
test('a stream of scoped passes builds the graph one full pass builds, on the recorded page', async () => {
  if (!existsSync(CORPUS)) {
    console.warn(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= EQUIVALENCE_ROWS) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  // 25 answers per window, which is what a 24-source fan-out lands inside one 50 ms flush
  const WINDOW = 25
  const batches: AnswerRow[][] = []
  for (let index = 0; index < rows.length; index += WINDOW) batches.push(rows.slice(index, index + WINDOW))

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: true })
  for (const batch of batches) {
    await replayAnswers(batch)
    await passSettled()
  }
  const settled = await passSettled()
  stopScheduler()
  expect(settled!.audit.ok, settled!.audit.differences.join('; ')).toBe(true)
  const scoped = await exportView()

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: true })
  for (const batch of batches) await replayAnswers(batch)
  await passSettled()
  const full = await schedulePass('manual')
  stopScheduler()
  expect(full.audit.ok, full.audit.differences.join('; ')).toBe(true)
  const whole = await exportView()

  expect(scoped.clusters!.length, 'the control: the arms built something').toBeGreaterThan(10)
  for (const key of Object.keys(whole)) {
    expect(scoped[key], `${key} (${rows.length} rows)`).toEqual(whole[key])
  }
}, 900_000)
