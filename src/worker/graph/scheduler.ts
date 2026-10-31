/**
 * The scheduler of 5.3: the wake is the event, one pass at a time, one pending wake behind it.
 *
 * `runPlugins` is the inner loop and knows nothing about events; this file is the only thing that
 * subscribes to the ingest's `graph:changed` and `row:changed`, the only thing that decides when a
 * pass runs, and the only thing that emits `view:changed` (4.5, 6.6).
 *
 * WHAT IT PROMISES.
 * - AT MOST ONE PASS IN FLIGHT, and at most one wake waiting behind it. Two overlapping `runPlugins`
 *   calls would interleave on the runner's module state (`lastCompleted`, `previousOutput`), so the
 *   gate is the whole point rather than an optimization. A wake landing mid-pass merges into the
 *   pending wake: never a queue, so a burst of twenty commits costs one more pass and not twenty.
 * - The pending wake carries the UNION of the media uris, episode uris and claim keys every merged
 *   wake named, and the HIGHEST `seq`. That union IS the scoped pass's delta: `runPlugins` takes
 *   iteration 1's subjects from the trigger and every later iteration's from what it just applied.
 * - `view:changed` fires AFTER a pass that applied something, naming the clusters it touched and
 *   every member uri of those clusters. A pass that applied nothing emits nothing, which is the
 *   second half of the idempotence contract of 6.6 (the first is the ingest's, which emits no
 *   `graph:changed` for a batch that moved nothing, so an idempotent replay wakes no pass at all).
 * - A pass that throws is caught, logged once, and releases the gate: the wake behind it still runs.
 *   Nothing here ever throws into the event bus.
 *
 * WHAT IT DOES NOT DO YET. `row:changed` is a plain wake, the same as `graph:changed`: the cheaper
 * re-materialization of 4.5 (the touched clusters' JSON only, no guards and no links) is a later
 * step, and until it exists a raw-only change is served by an ordinary scoped pass over the uris it
 * named rather than not at all.
 */
import type { Plugin } from './plugins/contract'
import type { PassReport, PassTrigger } from './plugins/runner'
import type { WriterChange } from './plugins/writer'

import { emit, listen } from '../store/events'
import { inTurn } from './engine'
import { aggregatePlugin } from './plugins/aggregate'
import { containmentPlugin } from './plugins/containment'
import { directPlugin } from './plugins/direct'
import { profilePlugin } from './plugins/profile'
import { rangePlugin } from './plugins/range'
import { runPlugins } from './plugins/runner'
import { titlePlugin } from './plugins/title'
import { graphReady } from './schema'

/**
 * Every plugin the live worker runs, in no particular order: `runPlugins` sorts by `after`, and a
 * cycle is legal there, so this list is a membership statement rather than a schedule.
 */
export const DEFAULT_PLUGINS: Plugin[] = [
  profilePlugin, directPlugin, titlePlugin, containmentPlugin, rangePlugin, aggregatePlugin,
]

/**
 * One pass in sixteen is audited on the live path.
 *
 * The audit reads every row of nine source tables TWICE per pass and re-hashes each one in JS
 * (`runner.ts`), which is the cost 5.3 asks to pay over a sample in production and in full in dev
 * and in the harness. Sixteen keeps a tampering plugin inside one screenful of passes while leaving
 * fifteen of them at the cost of the pass itself.
 */
export const AUDIT_EVERY = 16

/**
 * What a pass was woken by: the reason, the highest seq merged into the wake, and what it named.
 *
 * The object handed to `runPlugins` IS this one, so a report's `trigger` carries the wake's subjects
 * at runtime and a reader that wants them casts the report's trigger to this type.
 *
 * `episodes` and `claims` are present only when the wake named any, which is deliberate: the runner
 * reads a `graph:changed` trigger naming NONE of the three lists as a full pass, so an empty list and
 * an absent one would be the same statement written two ways, and a trigger says what it knows.
 */
export type ScheduledTrigger = PassTrigger & { seq: number, uris: string[] }

/** What the scheduler has done since it was last started. The step 2 measurement reads these. */
export type SchedulerStats = {
  /** Requests: every bus event plus every `schedulePass`, merged ones included. */
  wakes: number
  /** Passes that actually ran. */
  passes: number
  /** Passes whose audit ran. */
  audits: number
  /** Time inside `runPlugins`, summed, and the longest single pass. */
  totalMs: number
  longestMs: number
  /** A pass is in flight. */
  running: boolean
  /** A wake is waiting for it. */
  waiting: boolean
}

type Claim = { resolve: (report: PassReport) => void, reject: (error: unknown) => void }

/** One wake, which is one PASS worth of requests however many events merged into it. */
type Wake = {
  reason: PassTrigger['reason']
  seq: number
  /** `Media.uri`, `Episode.uri` and `CLAIMS.key`: the union of every commit merged into this wake. */
  uris: Set<string>
  episodes: Set<string>
  claimKeys: Set<string>
  /** The `schedulePass` callers this wake answers. */
  claims: Claim[]
}

let plugins: Plugin[] = DEFAULT_PLUGINS
let auditEveryPass = false
let unsubscribes: (() => void)[] | undefined
let pending: Wake | undefined
let running: Promise<void> | undefined
let last: PassReport | null = null
let settlers: ((report: PassReport | null) => void)[] = []
let counters = { wakes: 0, passes: 0, audits: 0, totalMs: 0, longestMs: 0 }

// The writer joins an edge's diff key as `from`, `to` and the table's own key on this separator
// (`plugins/writer.ts`), and a node's diff key is its primary key alone. `view:changed` is read out
// of those keys rather than out of a second query per change.
const KEY_SEPARATOR = '\u0000'

/** A `Slot` id is `<clusterId>#<number>` or `<clusterId>#s:<uri>` (2.2), so the cluster is its head. */
const clusterOfSlot = (id: string): string => {
  const hash = id.indexOf('#')
  return hash < 0 ? id : id.slice(0, hash)
}

/**
 * The `view:changed` payload for what a pass applied: the clusters it touched, their members and the placeholders
 * their members claim to be.
 *
 * Every change is mapped to a cluster by its key alone where the key names one, and through ONE
 * query per remaining class where it does not. `MediaProfile`, `EpisodeProfile`, `TitleKey`,
 * `PROFILE_OF`, `EPISODE_PROFILE_OF` and `HAS_KEY` map to nothing on purpose: 6.6 fires this event when a cluster's
 * membership, slots, attachments, run length, anomalies or JSON moved, and a profile is none of
 * those. A pass that moved only profiles therefore names no cluster and emits nothing.
 */
export const viewOf = async (changes: WriterChange[]): Promise<{ clusters: string[], uris: string[] }> => {
  const clusters = new Set<string>()
  const aliases = new Set<string>()
  const mediaUris = new Set<string>()
  const episodeUris = new Set<string>()

  for (const change of changes) {
    const [from = '', to = ''] = change.key.split(KEY_SEPARATOR)
    switch (change.table) {
      case 'Cluster': clusters.add(change.key); break
      case 'Slot': clusters.add(clusterOfSlot(change.key)); break
      case 'Alias': aliases.add(change.key); break
      case 'MEMBER_OF': case 'SLOT_OF': clusters.add(to); break
      case 'ATTACHED_TO': clusters.add(from); clusters.add(to); break
      case 'FILLS': clusters.add(clusterOfSlot(to)); break
      case 'LINK': mediaUris.add(from); mediaUris.add(to); break
      case 'EPISODE_LINK': episodeUris.add(from); episodeUris.add(to); break
      default: break
    }
  }

  const { query } = await graphReady()
  // never with an empty list: an empty `UNWIND` param dies at runtime on this engine (the engine
  // facts of 2026-09-12), which reads as a corrupt statement rather than as nothing to do
  if (aliases.size) {
    const rows = await query('UNWIND $ids AS i MATCH (a:Alias {id: i}) RETURN a.clusterId AS clusterId', { ids: [...aliases] })
    for (const row of rows) if (typeof row.clusterId === 'string') clusters.add(row.clusterId)
  }
  if (mediaUris.size) {
    const rows = await query(
      'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id',
      { uris: [...mediaUris] }
    )
    for (const row of rows) clusters.add(String(row.id))
  }
  // an episode is a member of nothing: it reaches a cluster through the media it hangs off, which is
  // why this is a second statement rather than the same one
  if (episodeUris.size) {
    const rows = await query(
      'UNWIND $uris AS u MATCH (e:Episode {uri: u})<-[:HAS_EPISODE]-(m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id',
      { uris: [...episodeUris] }
    )
    for (const row of rows) clusters.add(String(row.id))
  }

  const ids = [...clusters].filter(Boolean).sort()
  if (!ids.length) return { clusters: [], uris: [] }

  const members = await query(
    'UNWIND $ids AS i MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: i}) RETURN m.uri AS uri',
    { ids }
  )
  // and the placeholders a member says it IS, which a reader addressed by one of them draws (`createMediaReader`)
  const claimed = await query(
    `UNWIND $ids AS i MATCH (c:Cluster {id: i})<-[:MEMBER_OF]-(:Media)-[k:CLAIMS]->(t:Media {owned: false})
     WHERE k.kind = 'SAME_AS' AND k.provenance <> 'address' RETURN t.uri AS uri`,
    { ids }
  )
  return { clusters: ids, uris: [...new Set([...members, ...claimed].map(row => String(row.uri)))].sort() }
}

const drain = async (): Promise<void> => {
  try {
    while (pending) {
      const wake = pending
      pending = undefined
      counters.passes += 1
      const audit = auditEveryPass || counters.passes % AUDIT_EVERY === 0
      if (audit) counters.audits += 1
      const trigger: ScheduledTrigger = {
        reason: wake.reason,
        seq: wake.seq,
        uris: [...wake.uris].sort(),
        ...wake.episodes.size ? { episodes: [...wake.episodes].sort() } : {},
        ...wake.claimKeys.size ? { claims: [...wake.claimKeys].sort() } : {},
      }
      try {
        const report = await inTurn(() => runPlugins(plugins, trigger, { audit }))
        last = report
        counters.totalMs += report.ms
        counters.longestMs = Math.max(counters.longestMs, report.ms)
        // AFTER the pass, never during it (5.3): a reader woken here reads the fixed point
        if (report.changes.length) {
          const view = await viewOf(report.changes)
          if (view.clusters.length) emit('view:changed', view)
        }
        // the claims settle after the event, so a caller that awaited a pass has already seen what
        // that pass published
        for (const claim of wake.claims) claim.resolve(report)
      } catch (error) {
        console.error(new Error('graph: a pass failed; the wake behind it still runs', { cause: error }))
        for (const claim of wake.claims) claim.reject(error)
      }
    }
  } finally {
    // in the same tick as the `while (pending)` that just read false, so a wake landing between the
    // two can never find the gate held by a drain that has already stopped looking
    running = undefined
    const waiting = settlers
    settlers = []
    for (const settle of waiting) settle(last)
  }
}

const request = (
  reason: PassTrigger['reason'],
  detail: { seq?: number, uris?: string[], episodes?: string[], claims?: string[] },
  claim?: Claim
): void => {
  counters.wakes += 1
  const wake = pending
    ?? { reason, seq: 0, uris: new Set<string>(), episodes: new Set<string>(), claimKeys: new Set<string>(), claims: [] }
  wake.seq = Math.max(wake.seq, detail.seq ?? 0)
  for (const uri of detail.uris ?? []) wake.uris.add(uri)
  for (const uri of detail.episodes ?? []) wake.episodes.add(uri)
  for (const key of detail.claims ?? []) wake.claimKeys.add(key)
  if (claim) wake.claims.push(claim)
  pending = wake
  running ??= drain()
}

/**
 * Subscribe to the ingest's events and run a pass per wake. Idempotent: starting twice replaces the
 * options and leaves exactly ONE subscription, because two would run two passes per commit.
 *
 * `audit` true audits every pass, which is what a test and the corpus harness want; left off, one
 * pass in `AUDIT_EVERY` is audited, which is what the live path wants.
 */
export const startScheduler = (options: { plugins?: Plugin[], audit?: boolean } = {}): void => {
  if (unsubscribes) stopScheduler()
  plugins = options.plugins ?? DEFAULT_PLUGINS
  auditEveryPass = options.audit === true
  counters = { wakes: 0, passes: 0, audits: 0, totalMs: 0, longestMs: 0 }
  last = null
  unsubscribes = [
    listen('graph:changed', detail => request('graph:changed', detail)),
    // a raw-only change wakes the same pass under the same reason until the re-materialization of
    // 4.5 exists: there is no third reason in `PassTrigger`, and inventing one here would say the
    // pass did something different when it did not
    listen('row:changed', detail => request('graph:changed', detail)),
  ]
}

/** Unsubscribe. A pass in flight runs to completion, and so does the wake already behind it. */
export const stopScheduler = (): void => {
  for (const unsubscribe of unsubscribes ?? []) unsubscribe()
  unsubscribes = undefined
}

/**
 * Ask for a pass, and resolve with the report of the pass that INCLUDED the request.
 *
 * A request that lands while a pass is in flight joins the pending wake, so it never resolves with
 * the report of a pass that started before it was made. Rejects when that pass throws, which is why
 * the boot caller catches: a failed boot pass must not fail `enableGraph`.
 */
export const schedulePass = (reason: 'boot' | 'manual' | 'merge-order'): Promise<PassReport> =>
  new Promise<PassReport>((resolve, reject) => { request(reason, {}, { resolve, reject }) })

/**
 * Resolve once nothing is in flight and nothing is pending, with the last pass's report, or null
 * when no pass has run since the scheduler was started.
 *
 * This is the fixed point a reader wants: `graphCounts` awaits it, and so does any test that woke a
 * pass with an event and has no other handle on it.
 */
export const passSettled = (): Promise<PassReport | null> => {
  if (!running && !pending) return Promise.resolve(last)
  return new Promise<PassReport | null>(resolve => { settlers.push(resolve) })
}

/** What the scheduler has done since it was last started. */
export const schedulerStats = (): SchedulerStats =>
  ({ ...counters, running: Boolean(running), waiting: Boolean(pending) })
