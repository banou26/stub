/**
 * The scheduler of 5.3: one pass per wake, one wake pending behind the pass in flight, the
 * `view:changed` a pass ends in, and the audit cadence.
 *
 * WHAT EACH CASE IS FOR. Every promise this file makes is about something that did NOT happen: a
 * second pass that did not start, a queue that did not form, an event that was not published. That
 * class of assertion passes while doing nothing more easily than any other, so each case names the
 * mutation that reddens it and most of them carry a control in the same test: the pass that DID run,
 * the membership the event is checked against, the pass that did apply something.
 *
 * The timings are real rather than faked. A pass is a chain of awaits on one engine lane, and a fake
 * clock would let the test decide an ordering the scheduler is supposed to decide, which is the one
 * thing being measured here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { existsSync, readFileSync } from 'node:fs'

import type { GraphQLResolveInfo } from 'graphql'

import type { AnswerRow } from '../../../../src/worker/graph/answers'
import type { Plugin, PluginId, PluginRow } from '../../../../src/worker/graph/plugins/contract'
import type { PassReport } from '../../../../src/worker/graph/plugins/runner'
import type { ScheduledTrigger } from '../../../../src/worker/graph/scheduler'

import { enableGraph, graphCounts } from '../../../../src/worker/graph'
import { recordAnswers } from '../../../../src/worker/graph/answers'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../src/worker/graph/ingest'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import {
  AUDIT_EVERY, DEFAULT_PLUGINS, passSettled, schedulePass, schedulerStats, startScheduler,
  stopScheduler,
} from '../../../../src/worker/graph/scheduler'
import { emit, listen } from '../../../../src/worker/store/events'
import { answer, media, rowsOf, title } from './plugins/fixtures'

const CORPUS = new URL('../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms) })

/** A plugin that writes the rows it was given, after pausing `ms` inside each iteration. */
const writer = (id: string, rows: PluginRow[], ms = 0): Plugin => ({
  id: id as PluginId,
  consumes: { nodes: ['Media'], edges: [] },
  produces: { nodes: ['MediaProfile'], edges: [] },
  after: [],
  version: 1,
  run: async () => {
    if (ms) await sleep(ms)
    return { scope: { full: true }, nodes: [{ table: 'MediaProfile', rows }], edges: [], links: [], episodeLinks: [] }
  },
})

/** A plugin that writes one cluster with its members and one slot: the four keys `view:changed` reads. */
const clusterer = (id: string, clusterId: string, members: string[]): Plugin => ({
  id: id as PluginId,
  consumes: { nodes: ['Media'], edges: [] },
  produces: { nodes: ['Cluster', 'Slot'], edges: ['MEMBER_OF', 'SLOT_OF'] },
  after: [],
  version: 1,
  run: async () => ({
    scope: { full: true },
    nodes: [
      {
        table: 'Cluster',
        rows: [{
          id: clusterId, scope: 'RUN', key: members[0], published: members,
          aggUri: `ag:(${members.join(' ')})`, hidden: false, kind: 'RUN',
        }],
      },
      { table: 'Slot', rows: [{ id: `${clusterId}#1`, clusterId, number: 1 }] },
    ],
    edges: [
      { table: 'MEMBER_OF', rows: members.map(uri => ({ from: uri, to: clusterId, via: 'test' })) },
      { table: 'SLOT_OF', rows: [{ from: `${clusterId}#1`, to: clusterId }] },
    ],
    links: [],
    episodeLinks: [],
  }),
})

/** A plugin the runner cannot even order, so the PASS throws rather than one plugin failing in it. */
const broken = (id: string): Plugin => ({ ...writer(id, []), after: undefined as unknown as PluginId[] })

const triggerOf = (report: PassReport | null): ScheduledTrigger => report!.trigger as ScheduledTrigger

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    await answer('media', media('sch:1', { titles: [title('en', 'Scheduler One')] })),
    await answer('media', media('sch:2', { titles: [title('en', 'Scheduler Two')] })),
  ])
})

beforeEach(() => {
  resetPassState()
})

afterEach(async () => {
  await passSettled()
  stopScheduler()
})

afterAll(async () => {
  await closeGraph()
})

// (a) ONE WAKE, ONE PASS, and the trigger says what woke it. The runner's own contract is untouched:
// a converging pass is two iterations, the second being the one that proves it converged.
// Mutation: build the trigger with an empty `uris` and the pass no longer knows what woke it, which
// is the whole input the scoping of step 2 will read.
test('a wake runs exactly one pass, and the trigger carries the seq and the uris it named', async () => {
  startScheduler({ plugins: [writer('plugin:wake', [{ uri: 'wake:1', scope: 'RUN' }])], audit: true })

  emit('graph:changed', { seq: 7, uris: ['sch:1'] })
  const report = await passSettled()

  expect(schedulerStats().passes).toBe(1)
  expect(report!.iterations, 'the runner is unchanged: two iterations for a converging pass').toBe(2)
  expect(triggerOf(report)).toEqual({ reason: 'graph:changed', seq: 7, uris: ['sch:1'] })
  expect(report!.audit.ok).toBe(true)
  expect(report!.changes.map(change => change.operation), 'the control: it wrote something').toEqual(['create'])
})

// (b) COALESCING. Three wakes landing inside one pass are ONE more pass, carrying the union of what
// they named and the highest seq. `row:changed` wakes the same pass, which is what 4.5 asks for until
// the cheaper re-materialization exists.
// Mutation: queue a pass per wake (push the wakes into an array and shift one per iteration) and
// this reports four passes, the last trigger carrying one uri.
test('three wakes inside one pass become exactly one more, with their union and the highest seq', async () => {
  startScheduler({ plugins: [writer('plugin:merge', [{ uri: 'merge:1', scope: 'RUN' }], 80)], audit: true })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  await sleep(20)
  expect(schedulerStats().running, 'the control: the first pass is still in flight').toBe(true)

  emit('graph:changed', { seq: 5, uris: ['sch:2'] })
  emit('row:changed', { uris: ['sch:1', 'sch:3'] })
  emit('graph:changed', { seq: 3, uris: ['sch:4'] })
  expect(schedulerStats().waiting, 'one pending wake, never three').toBe(true)

  const report = await passSettled()

  expect(schedulerStats().passes).toBe(2)
  expect(triggerOf(report).seq, 'the highest, not the last').toBe(5)
  expect(triggerOf(report).uris).toEqual(['sch:1', 'sch:2', 'sch:3', 'sch:4'])
})

// (c) THE PENDING WAKE IS MERGED INTO, not replaced and not queued behind: a wake landing when one is
// already pending is still the same one pass.
// Mutation: assign `pending` rather than merging into it and the trigger below carries only `sch:5`.
test('a wake landing on the pending wake merges into it, and there is never a third pass', async () => {
  startScheduler({ plugins: [writer('plugin:third', [{ uri: 'third:1', scope: 'RUN' }], 80)], audit: true })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  await sleep(20)
  emit('graph:changed', { seq: 2, uris: ['sch:2'] })
  await sleep(20)
  expect(schedulerStats().waiting, 'the control: a wake is already pending').toBe(true)
  emit('graph:changed', { seq: 4, uris: ['sch:5'] })

  const report = await passSettled()

  expect(schedulerStats().passes).toBe(2)
  expect(triggerOf(report).uris).toEqual(['sch:2', 'sch:5'])
  expect(triggerOf(report).seq).toBe(4)
})

// (d) `passSettled` IS THE FIXED POINT, not the next settling: it resolves when nothing is in flight
// AND nothing is pending, with the last report.
// Mutation: resolve the settlers at the end of each pass rather than after the drain and this
// resolves with the first pass, whose trigger never names `pend:1`.
test('passSettled resolves after the pending pass, not after the one in flight', async () => {
  startScheduler({ plugins: [writer('plugin:settle', [{ uri: 'settle:1', scope: 'RUN' }], 80)], audit: true })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  await sleep(20)
  const settled = passSettled()
  emit('graph:changed', { seq: 2, uris: ['pend:1'] })

  const report = await settled

  expect(schedulerStats().passes).toBe(2)
  expect(triggerOf(report).uris).toEqual(['pend:1'])
})

// (e) A REQUESTED PASS resolves with the report of the pass that INCLUDED the request, never with the
// one that was already running when it was made.
// Mutation: hand the claim to the wake being run rather than to the pending one and this resolves
// with pass one, whose reason is `graph:changed`.
test('schedulePass resolves with the report of the pass that included it', async () => {
  startScheduler({ plugins: [writer('plugin:manual', [{ uri: 'manual:1', scope: 'RUN' }], 80)], audit: true })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  await sleep(20)
  const requested = schedulePass('manual')
  const report = await requested

  expect(schedulerStats().passes, 'the pass in flight was not the one it asked for').toBe(2)
  expect(report.trigger.reason).toBe('manual')

  const second = await schedulePass('manual')
  expect(schedulerStats().passes, 'and on an idle scheduler it runs one of its own').toBe(3)
  expect(second.trigger.reason).toBe('manual')
})

// (f) `view:changed` NAMES THE CLUSTERS AND THEIR MEMBERS (6.6), read off the changes the writer
// applied, and the member uris are checked against `MEMBER_OF` itself rather than against the list
// the plugin was built from. The second half is the idempotence contract: the same output twice
// applies nothing and publishes nothing.
// Mutation: emit the cluster ids with no uris, or emit whenever a pass ran rather than when it
// applied something, and one of the two halves goes red.
test('a pass that moved a cluster publishes it, and an idempotent second pass publishes nothing', async () => {
  const events: { clusters: string[], uris: string[] }[] = []
  const unlisten = listen('view:changed', detail => { events.push(detail) })
  startScheduler({ plugins: [clusterer('plugin:view', 'cl:view', ['sch:1', 'sch:2'])], audit: true })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  const report = await passSettled()

  expect(report!.changes.length, 'the control: the pass applied something').toBeGreaterThan(0)
  expect(report!.audit.ok).toBe(true)
  expect(events.length).toBe(1)
  expect(events[0]!.clusters).toEqual(['cl:view'])
  const members = (await rowsOf(
    'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $id}) RETURN m.uri AS uri ORDER BY m.uri', { id: 'cl:view' }
  )).map(row => row.uri)
  expect(members, 'the control: the membership is really in the graph').toEqual(['sch:1', 'sch:2'])
  expect(events[0]!.uris, 'and the event names every member of the cluster it named').toEqual(members)

  emit('graph:changed', { seq: 2, uris: ['sch:1'] })
  const again = await passSettled()

  expect(schedulerStats().passes).toBe(2)
  expect(again!.changes, 'the same output twice is not a change').toEqual([])
  expect(events.length, 'and an idempotent pass publishes no view').toBe(1)
  unlisten()
})

// (g) THE OTHER HALF OF IDEMPOTENCE, paired with the ingest's (`ingest.test.ts`): a replay of a batch
// that already landed emits no `graph:changed`, so no pass runs at all. And a pass that moved only
// `MediaProfile` rows moved no cluster's view, so it publishes nothing either (6.6).
// Mutation: derive the clusters from every change rather than from the six tables that carry one and
// the profile pass below publishes an empty event.
test('an idempotent replay wakes nothing, and a profile-only pass publishes no view', async () => {
  const rows = [await answer('media', media('sch:6', { titles: [title('en', 'Scheduler Six')] }))]
  const events: unknown[] = []
  const unlisten = listen('view:changed', detail => { events.push(detail) })
  startScheduler({ plugins: [writer('plugin:idem', [{ uri: 'idem:1', scope: 'RUN' }])], audit: true })

  await ingestAnswers(rows)
  const first = await passSettled()

  expect(schedulerStats().passes, 'the commit woke one pass').toBe(1)
  expect(first!.changes.length, 'the control: the pass applied something').toBeGreaterThan(0)
  expect(events, 'a MediaProfile is not a view (6.6)').toEqual([])

  await replayAnswers(rows)
  await sleep(20)

  expect(schedulerStats().wakes, 'an idempotent batch emits no graph:changed, so nothing wakes').toBe(1)
  expect(schedulerStats().passes).toBe(1)
  unlisten()
})

// (h) THE AUDIT CADENCE. It reads every row of nine tables twice, so the live path pays it on one
// pass in sixteen (5.3 asks for a sample in production).
// Mutation: AUDIT_EVERY to 1 and pass fifteen is audited too, which this asserts it is not.
test('the audit runs on the sixteenth pass and not on the fifteenth', async () => {
  startScheduler({ plugins: [writer('plugin:audit', [{ uri: 'audit:1', scope: 'RUN' }])] })

  // sixteen passes, written as sixteen rather than as `AUDIT_EVERY`: a case that counts in terms of
  // the constant it is testing moves with the constant and stops testing it
  const reports: PassReport[] = []
  for (let pass = 1; pass <= 16; pass += 1) reports.push(await schedulePass('manual'))

  const audited = reports.map(report => Object.keys(report.audit.before.tables).length > 0)
  expect(audited[14], 'pass fifteen is not audited').toBe(false)
  expect(audited[15], 'pass sixteen is').toBe(true)
  expect(audited.filter(Boolean).length, 'one pass in sixteen, not two').toBe(1)
  expect(schedulerStats().audits).toBe(1)
  expect(reports[15]!.audit.ok, 'and the audit that ran passed').toBe(true)
  expect(AUDIT_EVERY, 'and the cadence those numbers are the cadence of').toBe(16)
})

// (i) A PASS THAT THROWS releases the gate and the wake behind it still runs. The runner catches a
// plugin that throws; what is left is the pass itself failing, which a plugin the runner cannot even
// order produces.
// Mutation: drop the per-pass try/catch and the throw escapes the drain's loop, so the pending wake
// is never run (this reads one pass), the drain rejects with nobody holding it, and the wake left
// behind hangs the next `passSettled`. Dropping the outer `finally` alone is NOT that mutation and
// reddens nothing while the per-pass catch stands: with every pass caught, the loop only ever exits
// normally, so the gate release runs either way. The `finally` is what keeps that true of an await
// added outside the per-pass catch later.
test('a pass that throws releases the gate, and the wake behind it still runs', async () => {
  const errors: Error[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation(error => { errors.push(error as Error) })
  startScheduler({ plugins: [broken('plugin:broken')] })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  emit('graph:changed', { seq: 2, uris: ['sch:2'] })
  const report = await passSettled()
  spy.mockRestore()

  expect(schedulerStats().passes, 'the second wake ran despite the first pass throwing').toBe(2)
  expect(schedulerStats().running).toBe(false)
  expect(report, 'neither pass produced a report').toBe(null)
  expect(errors.filter(error => error.message.includes('a pass failed')).length, 'logged once per pass').toBe(2)

  // THE CONTROL: the gate is genuinely free afterwards, not merely reported as free
  startScheduler({ plugins: [writer('plugin:after-throw', [{ uri: 'after:1', scope: 'RUN' }])] })
  const good = await schedulePass('manual')
  expect(good.changes.length).toBeGreaterThan(0)
})

// (j) `stopScheduler` IS WHAT A TEST UNDOES A START WITH, so it has to actually unsubscribe.
// Mutation: make it a no-op and the wake below runs a second pass.
test('stopScheduler unsubscribes, so a wake after it runs nothing', async () => {
  startScheduler({ plugins: [writer('plugin:stop', [{ uri: 'stop:1', scope: 'RUN' }])] })
  await schedulePass('manual')
  expect(schedulerStats().passes, 'the control: it was listening a moment ago').toBe(1)

  stopScheduler()
  emit('graph:changed', { seq: 9, uris: ['sch:1'] })
  await sleep(20)

  expect(schedulerStats().passes, 'the bus no longer reaches it').toBe(1)
  expect(schedulerStats().waiting).toBe(false)
})

// (k) STARTING TWICE SUBSCRIBES ONCE. Two subscriptions would run two passes per commit, the second
// of them woken by an event the first already consumed.
// Mutation: drop the `if (unsubscribes) stopScheduler()` and one commit reads two wakes and two passes.
test('starting twice leaves one subscription, so one commit is one pass', async () => {
  const plugins = [writer('plugin:once', [{ uri: 'once:1', scope: 'RUN' }], 40)]
  startScheduler({ plugins })
  startScheduler({ plugins })

  emit('graph:changed', { seq: 1, uris: ['sch:1'] })
  await passSettled()

  expect(schedulerStats().wakes, 'one subscription, one wake').toBe(1)
  expect(schedulerStats().passes).toBe(1)
})

// (l) `graphCounts` IS A FIXED POINT, not a snapshot of the middle of a pass: it flushes the log,
// which ends in a commit and therefore in a wake, and then waits the pass out.
// Mutation: drop the `await passSettled()` in `counts.ts` and the delta below is 0, because the
// counts are read while the plugin is still inside its first iteration.
test('graphCounts waits out the pass the flush woke', async () => {
  const before = await graphCounts()
  const rows = [{ uri: 'counts:1', scope: 'RUN' }, { uri: 'counts:2', scope: 'RUN' }]
  startScheduler({ plugins: [writer('plugin:counts', rows, 150)] })

  await ingestAnswers([await answer('media', media('sch:7', { titles: [title('en', 'Scheduler Seven')] }))])
  const counts = await graphCounts()

  expect(schedulerStats().passes).toBe(1)
  expect(counts.MediaProfile! - before.MediaProfile!, "the pass's own rows are in the count").toBe(2)
})

// ---------------------------------------------------------------------------------------------

/** How much of the recorded page the measurement replays. 800 is the whole of it; see the case below. */
const MEASURE_ROWS = Number(process.env.GRAPH_MEASURE_ROWS ?? 200)

/** Empty every table, the only reset this engine has: it cannot be closed and reopened in one process. */
const truncate = async (): Promise<void> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
}

type ResolveInfo = Pick<GraphQLResolveInfo, 'path' | 'variableValues'>

/** A resolver path from its segments, innermost last, as graphql builds one. */
const pathOf = (keys: string[]): GraphQLResolveInfo['path'] =>
  keys.reduce<GraphQLResolveInfo['path'] | undefined>(
    (prev, key) => ({ prev, key, typename: undefined }), undefined
  )!

/** The resolver position a recorded answer arrived at, as `answers.ts` keys one (4.1). */
const positionOf = (kind: AnswerRow['kind']): { info: ResolveInfo, typeName: string } =>
  kind === 'episode'
    ? { info: { path: pathOf(['media', 'episodes']), variableValues: {} }, typeName: 'Episode' }
    : kind === 'origin'
      ? { info: { path: pathOf(['origin']), variableValues: {} }, typeName: 'Origin' }
      : { info: { path: pathOf(['media']), variableValues: {} }, typeName: 'Media' }

/**
 * THE MEASUREMENT 5.3 ASKS FOR: what a pass costs under a real page's flush, in the one engine lane
 * the ingest, the pass and every read share.
 *
 * It REPORTS rather than asserts, the way the recorded-page case in `range.test.ts` does: a threshold
 * pinned to one walk fails on the next walk rather than on the next bug. What it asserts is the shape
 * that must hold whatever the page contains, which is that coalescing happened at all (fewer passes
 * than wakes) and that the ingest never lost a batch.
 *
 * It runs LAST and empties the graph twice, so nothing above may depend on what it leaves behind.
 *
 * THE SIZE IS A KNOB because the full page is 22 s of solid CPU, and inside the whole suite that is
 * enough to push a neighbouring file past vitest's 5 s default: `range.test.ts` timed out on two runs
 * out of two with this case at 800 rows, was green alone, and is green with the suite at 200
 * (measured 2026-09-12). So the suite runs the small version, and the recorded figures in
 * `docs/design-inputs/00-engine-facts.md` come from `GRAPH_MEASURE_ROWS=800`, which is printed in the
 * line below so a reader always knows which size produced them.
 */
test('the recorded page through a live scheduler: wakes, passes, and what it costs the ingest', async () => {
  if (!existsSync(CORPUS)) {
    console.warn(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= MEASURE_ROWS) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  expect(rows.length, 'a recorded page is about 800 rows (2026-09-12)').toBeGreaterThan(100)

  // 25 answers per window, which is what a 24-source fan-out lands inside one 50 ms flush. The timers
  // are REAL: `recordAnswers` resolves when the batch its answer joined has been written and ingested,
  // so awaiting one window is exactly the latency a resolve waits out.
  const WINDOW = 25
  const feed = async (): Promise<{ ms: number, longest: number, batches: number }> => {
    let ms = 0
    let longest = 0
    let batches = 0
    for (let index = 0; index < rows.length; index += WINDOW) {
      const window = rows.slice(index, index + WINDOW)
      const started = Date.now()
      await Promise.all(window.map(row => {
        const { info, typeName } = positionOf(row.kind)
        return recordAnswers(info, typeName, JSON.parse(row.raw))
      }))
      const took = Date.now() - started
      ms += took
      longest = Math.max(longest, took)
      batches += 1
    }
    return { ms, longest, batches }
  }

  // THE CONTROL ARM FIRST, with no scheduler: the same rows, the same windows, the same engine.
  stopScheduler()
  await truncate()
  resetPassState()
  const alone = await feed()

  await truncate()
  resetPassState()
  startScheduler({ plugins: DEFAULT_PLUGINS, audit: false })
  const withPass = await feed()
  const settled = await passSettled()
  const stats = schedulerStats()
  stopScheduler()

  console.info([
    `scheduler over ${rows.length} recorded answers (GRAPH_MEASURE_ROWS) in ${withPass.batches} windows of ${WINDOW}:`,
    `${stats.wakes} wakes, ${stats.passes} passes (${stats.audits} audited), ${stats.totalMs} ms of pass,`,
    `longest pass ${stats.longestMs} ms, last pass ${settled?.iterations} iterations;`,
    `ingest ${withPass.ms} ms with the scheduler (longest window ${withPass.longest} ms)`,
    `against ${alone.ms} ms with it stopped (longest window ${alone.longest} ms).`,
  ].join(' '))
  // WHERE THE PASS GOES, per plugin per iteration of the LAST pass, so the next step reads the cost
  // off a measurement rather than off an assumption about which scan is the expensive one. A skipped
  // plugin is printed as `skipped` rather than as 0 ms: not running and running for nothing are
  // different facts about the same number.
  console.info('the last pass, per plugin per iteration:', JSON.stringify(
    (settled?.runs ?? []).map(run => `${run.iteration} ${run.id} ${run.skipped ? 'skipped' : `${run.ms} ms, ${run.changes} changes`}`)
  ))

  // NEVER MORE PASSES THAN WAKES, which is the property this line is actually about: a burst of
  // commits must not queue up one pass each and fall behind. Whether it COALESCES is a different
  // question and depends on how long a pass takes, which is why this was `toBeLessThan` until
  // 2026-09-13 and is not any more.
  //
  // Under the in-process store a pass finishes before the next wake arrives, so passes equals wakes
  // and nothing merges. That is not a regression: each pass now costs a fraction of what it did (the
  // corpus went from 408 s to 8.6 s), so the merging that used to be load bearing has nothing left to
  // save. An engine fast enough to make its own batching pointless is the good version of this.
  expect(stats.passes, 'a burst of commits never queues up a pass each').toBeLessThanOrEqual(stats.wakes)
  expect(stats.passes).toBeGreaterThan(0)
  expect(settled!.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 900_000)
