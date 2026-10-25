/**
 * The worker end of the `?graph` flag.
 *
 * A worker cannot read the page's query string, so `src/worker.ts` reads it and calls
 * `setGraphEnabled` over osra right after spawning. Off is the default and costs nothing: the engine
 * client is imported lazily, so with the flag down neither it nor the 22 MB engine is ever fetched.
 */
import { holdMergeOrder } from '../../sources/merge-order'
import { setAnswerSink } from './answers'
import { graphEnabled, setGraphEnabled } from './engine'
import { ingestAnswers } from './ingest'
import { graphReady, GRAPH_TABLES } from './schema'
import { schedulePass, startScheduler } from './scheduler'
import { seedOrigins } from './seed-origins'

export { closeGraph, graphEnabled, openGraph, setGraphEnabled } from './engine'
export type { Graph, GraphRow } from './engine'
export { createGraphSchema, graphReady, GRAPH_SCHEMA, GRAPH_TABLES } from './schema'
export { exportAnswers, flushAnswers, keepEpisodes, recordAnswers } from './answers'
export type { AnswerKind, AnswerRow } from './answers'
// Section 7.3: the questions the similar consumer put, and what each came to.
export { exportAsks, flushAsks, recordAsk } from './asks'
export type { Ask, AskOutcome, AskRow } from './asks'
export { graphCounts } from './counts'
export { ingestAnswers, replayAnswers } from './ingest'
export type { IngestChanged, IngestQuarantine, IngestReport } from './ingest'
// Section 5: the contract, the writer and the pass. `./scheduler` is what subscribes to
// `graph:changed`; `runPlugins` on its own runs a pass only when a caller asks for one.
export type { Plugin, PluginContext, PluginOutput, Scope } from './plugins/contract'
export { applyPluginOutput, graphGuards, retractPlugin } from './plugins/writer'
export type { WriterChange, WriterReport } from './plugins/writer'
export { auditSources, PASS_CAP, runPlugins } from './plugins/runner'
export type { AuditReport, PassReport } from './plugins/runner'
export { profilePlugin } from './plugins/profile'
// Section 5.2 and 5.4 P1: the guards every proposal meets, the precedence they are weighed in, and
// the first plugin that proposes anything.
export { prepareGuards, readComponents } from './plugins/guards'
export type { GuardPass, SameAsVerdict } from './plugins/guards'
export { orderLinkProposals, precedenceClassOf } from './plugins/sameness'
export { directPlugin } from './plugins/direct'
// Section 5.4 P3: the fuzzy title pass, as a plugin whose verdict is a row.
export { titlePlugin } from './plugins/title'
// Section 5.4 P5: the materialized view, and the field policy of 6.3 and 6.4 it writes.
export { aggregatePlugin } from './plugins/aggregate'
// Section 5.4 P2: the RUN versus CONTAINER exchange, plus the listing rules of 6.1 and 6.5 it owns.
export { containmentPlugin } from './plugins/containment'
// Section 5.4 P4: the episode pairs and the ranges of 3.4, which is what places a play button.
export { rangePlugin } from './plugins/range'
export { aggregateEpisodeFields, aggregateFields } from './plugins/fields'
export type { AggregatedEpisode, AggregatedMedia, ClusterCard } from './plugins/fields'
export { checkInvariants, INVARIANTS } from './plugins/invariants'
export { readAnomalies } from './plugins/anomalies'
export type { Anomaly } from './plugins/anomalies'
export { seedOrigins } from './seed-origins'
// Section 6: the read path, and the flag that switches the three reads onto it. It lives in `./read`
// rather than here so `../extractor.ts` can read the flag without importing every plugin.
export {
  addressUris, askAddressOf, createMediaReader, createPageReader, episodesOf, memberUrisOf,
  pageClusters, placeholdersOf, readStore, resolveMedia, setReadStore,
} from './read'
export type { Placeholder, ReadStore } from './read'
// Section 7.5: "why is this here", as one read-only bundle per cluster plus the one answer a reader
// opens. Its own module for the same reason `./read` is one: it is a READ, it writes nothing, and the
// `/debug/trace` page must be able to ask it about a graph whose plugins produced nothing.
export { traceAnswer, traceGraph } from './trace'
export type {
  TraceAnomaly, TraceAnswerDetail, TraceAnswerMeta, TraceAsk, TraceAttachment, TraceBundle,
  TraceClaim, TraceEpisode, TraceEpisodeClaim, TraceEpisodeLink, TraceEpisodeSource, TraceFill,
  TraceLink, TraceMember, TraceReason, TraceResolved, TraceRunLength,
} from './trace'
// Section 5.3: when a pass runs, and the `view:changed` it ends in.
export {
  AUDIT_EVERY, DEFAULT_PLUGINS, passSettled, schedulePass, schedulerStats, startScheduler,
  stopScheduler, viewOf,
} from './scheduler'
export type { ScheduledTrigger, SchedulerStats } from './scheduler'

let booting: Promise<void> | undefined

const boot = async (scheduler: boolean) => {
  const started = performance.now()
  // THE ONE PLACE THE LIVE INGEST IS WIRED, and only behind the flag. The log hands it the rows a
  // flush wrote, so the tee runs after `recordAnswers` and after the old store's own inserters, and
  // a throw inside it is logged there rather than reaching the resolve.
  setAnswerSink(ingestAnswers)
  // the schema of section 2 is created at start, so the first answer of the session has a table to
  // land in; `graphReady` is also what every reader waits on, so nothing can race this boot
  const graph = await graphReady()
  // the Origin rows of 2.1, before anything asks: a badge is drawn from a row, and one origin
  // (`imdb`) answers nothing at all, so its row can only ever come from here
  const origins = await seedOrigins()
  console.info(`graph: engine ready in ${Math.round(performance.now() - started)} ms, version ${graph.version}, ${GRAPH_TABLES.length} tables, ${origins} origins`)
  if (!scheduler) return
  // the pass wakes on the ingest's events from here on, and the seeding above is inside the boot
  // pass rather than behind it, so nothing that landed before the subscription is missed
  startScheduler()
  try {
    // THE BOOT PASS of 5.3. A worker keeps nothing across a reload, so the graph it starts on is
    // always empty and the boot pass is always free: there is no stored version to compare and
    // nothing to retract, and adding either would be code for a state that cannot occur.
    const report = await schedulePass('boot')
    console.info(`graph: boot pass in ${report.ms} ms, ${report.iterations} iterations, ${report.changes.length} changes`)
  } catch (error) {
    // a boot pass that failed leaves the plugins' previous output standing, which on a cold worker is
    // nothing at all; the next commit wakes another pass, so this must not fail `enableGraph`
    console.error(new Error('graph: the boot pass failed', { cause: error }))
  }
}

/**
 * Carries the page's flag in, and opens the engine once when it is on.
 *
 * `scheduler` wires the live pass, and it is OFF by default because a caller that drives
 * `runPlugins` itself must not race one: the runner keeps what each plugin last wrote in module
 * state, so two overlapping passes interleave there. The live worker asks for it in the one place
 * that owns the flag (`../yoga.ts`), and a test that wants the pass starts the scheduler itself.
 */
export const enableGraph = (enabled: boolean, options: { scheduler?: boolean } = {}): Promise<void> => {
  setGraphEnabled(enabled)
  if (!graphEnabled()) return Promise.resolve()
  return (booting ??= boot(options.scheduler === true))
}

/**
 * Holds the viewer's merge order, and once the engine is on and the order followed changed, re-merges every cluster
 * in a pass of its own, which ends in the `view:changed` that redraws what is on screen.
 */
export const setMergeOrder = async (order: readonly string[]): Promise<void> => {
  if (!holdMergeOrder(order) || !graphEnabled()) return
  await schedulePass('merge-order').catch(error => console.error(new Error('graph: the merge order pass failed', { cause: error })))
}
