/**
 * The `Ask` log: one row per question the similar consumer put through `similarMedia`, with what
 * that question came to.
 *
 * Section 7.3 of the representation design, and the row 7.5 reads to answer "why is Netflix missing
 * here": a cluster with no `nf` row and no `Ask` row was never asked, one with an `Ask` row whose
 * outcome is `refused` was asked and turned down, and one whose outcome is `declined` never reached
 * the source at all. Those are three different facts about a page and nothing else in the graph
 * tells them apart.
 *
 * THE LOG IS A HISTORY, NOT A DEDUPE. The key hashes the sequence number in with the question, so
 * the same question asked again after new evidence, or retried after a decline, is a SECOND row.
 * `Answer`'s key deliberately does the opposite (a byte-identical re-fetch is one row there, 4.1),
 * because an answer is a fact about a work while an ask is an event in a session: two asks that
 * carry the same bytes are still two asks, and a log that folded them would report one question
 * where four were spent against the consumer's cap.
 *
 * `recordAsk` promises that a row is written for one ask and for nothing else, that it costs nothing
 * at all while the `?graph` flag is down (it returns undefined before touching the engine, so the
 * 22 MB engine is never fetched), and that it never rejects: a caller records what it did and is
 * never made to handle the recording. `exportAsks` is the read side, behind `?export=answers` (see
 * `src/answers-export.ts`).
 */
import { graphEnabled } from './engine'
import { sha256Hex } from './hash'
import { graphReady } from './schema'

/**
 * What one ask came to.
 *
 * `answered`, `containing`, `refused` and `declined` are `SimilarOutcome`'s own four
 * (`src/sources/similar.ts`), kept under the same names so a log line and a row read alike: a decline
 * never reached the answering source and may be retried, a refusal did and is final for that
 * evidence. `containing` is an answer too, and a separate row value because what it came to is a
 * different claim: a season that holds the run rather than the run (4.4). `error` is a throw on the
 * asking path, and `timeout` is an ask a caller gave up waiting on (the funnel reports its own
 * deadline as a decline, `timeout`, so the consumer records that as `declined` today).
 */
export type AskOutcome = 'answered' | 'containing' | 'refused' | 'declined' | 'error' | 'timeout'

/** What a caller records: the question it put, and what that question came to. */
export type Ask = {
  /**
   * The cluster the question was asked FOR, as its aggregated uri (`ag:(anilist:1,kitsu:2)`), which
   * is the id the page carries today. The `Cluster` table's own ids arrive with `plugin:aggregate`
   * (5.4 P5) and this column takes them when they do.
   *
   * IT IS NOT A `Cluster.aggUri`. The consumer builds it over its own member list, placeholders
   * included, where `aggUri` is built from the members, which excludes them, so the two spellings of
   * one cluster differ by exactly its placeholders. A reader matching asks to a cluster has to
   * INTERSECT the two addresses rather than compare them (`./trace.ts` does, after a string equality
   * missed 2 of 2 rows on a live page, 2026-09-13).
   */
  clusterId: string
  /**
   * The run the question was asked about: the lowest member uri of the run cluster
   * (`planSimilarAsks`), which is the one spelling of this cluster that does not move as sources are
   * folded in. Declared in 2.1 and written by nobody until 2026-09-13, which made 7.5's own
   * `WHERE k.runUri IN $members` a statement that could only ever return no rows.
   */
  runUri: string
  /** The origin that was asked, and the show id it was asked about. */
  origin: string
  showId: string
  /** The normalised question (`similarAskKey`), hashed into `questionHash` rather than stored raw. */
  question: string
  outcome: AskOutcome
  /**
   * Why, in one token: `SimilarOutcome`'s reason for a decline or a source refusal (`no-evidence`,
   * `ceiling`, `null`, `not-a-run`), the consumer's own reason for a refusal it made itself
   * (`other-run`, `by-title`), and the ANSWER'S URI for an answered or a containing one.
   */
  reason: string
}

/** One `Ask` row, as it is written and as `exportAsks` hands it back. */
export type AskRow = Omit<Ask, 'question'> & {
  /** sha-256 over (clusterId, origin, showId, questionHash, seq): one key per ask, never a dedupe. */
  key: string
  /** Ask sequence, monotonic per session, assigned in the order the questions settled. */
  seq: number
  /** sha-256 of the normalised question, so two asks that put the same question are comparable. */
  questionHash: string
  /** The answer's uri for an ask that was answered at all, `containing` included; else null. */
  answerUri: string | null
}

// The same window and the same reason as the `Answer` log (`./answers.ts`): a page settling several
// asks at once writes them in one UNWIND rather than one execute each.
const FLUSH_MS = 50

// A separator no origin, show id or uri can carry, so (origin 'a', showId 'b:c') and (origin 'a:b',
// showId 'c') cannot hash alike. The same reason the `Answer` key joins on `\0`.
const SEPARATOR = '\u0000'

let pending: AskRow[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let settle: (() => void) | undefined
let scheduled: Promise<void> | undefined
// every batch writes behind the previous one, so two flushes can never interleave on the one shared
// connection
let writing: Promise<void> = Promise.resolve()
let seq = 0
// rows whose key is still being hashed. A caller records fire and forget, so a reader that drained
// only `pending` would miss an ask that was recorded a microtask ago and is not queued yet
const drafting = new Set<Promise<void>>()

const write = async (batch: AskRow[]): Promise<void> => {
  // an empty UNWIND list dies at RUNTIME rather than at the binder (`00-engine-facts.md`)
  if (!batch.length) return
  const { query } = await graphReady()
  // no dedupe, inside the batch or against the table: every row carries its own seq in its key, so
  // two asks can never collide on the primary key and two identical questions are two rows
  await query(
    `UNWIND $rows AS r
     CREATE (:Ask {key: r.key, clusterId: r.clusterId, runUri: r.runUri, origin: r.origin, showId: r.showId,
                   questionHash: r.questionHash, outcome: r.outcome, reason: r.reason,
                   answerUri: CASE WHEN r.answerUri = '' THEN cast(NULL AS STRING) ELSE r.answerUri END,
                   seq: cast(r.seq AS INT64)})`,
    // every typed scalar travels as a STRING and is cast in the statement, and nothing travels as
    // null: a struct field is typed from the FIRST row of the list, so one batch's shape must not
    // depend on which row happened to arrive first (measured 2026-09-12, 0.20.4)
    { rows: batch.map(row => ({ ...row, answerUri: row.answerUri ?? '', seq: String(row.seq) })) }
  )
}

const fire = (): Promise<void> => {
  if (timer !== undefined) clearTimeout(timer)
  const done = settle
  timer = undefined
  settle = undefined
  scheduled = undefined
  const batch = pending
  pending = []
  writing = writing.then(() => write(batch)).catch(error => {
    // a log that drops a batch is a gap in the record; a log that throws at its caller is a consumer
    // that stopped asking because a database was unhappy
    console.error(new Error(`graph: the ask log dropped ${batch.length} row(s)`, { cause: error }))
  }).finally(() => done?.())
  return writing
}

const schedule = (): Promise<void> => {
  scheduled ??= new Promise<void>(resolve => { settle = resolve })
  timer ??= setTimeout(() => { void fire() }, FLUSH_MS)
  return scheduled
}

// `seq` is taken SYNCHRONOUSLY, before the two digests, so the rows carry the order their questions
// settled in rather than the order their hashes happened to finish in.
const queue = async (ask: Ask): Promise<void> => {
  const next = ++seq
  const questionHash = await sha256Hex(ask.question)
  const key = await sha256Hex([ask.clusterId, ask.origin, ask.showId, questionHash, next].join(SEPARATOR))
  pending.push({
    key,
    seq: next,
    clusterId: ask.clusterId,
    runUri: ask.runUri,
    origin: ask.origin,
    showId: ask.showId,
    questionHash,
    outcome: ask.outcome,
    reason: ask.reason,
    // the answered reason IS the answer's uri (see `Ask.reason`), and the trace of 7.5 reads it off
    // this column, so the derivation lives here rather than in every caller
    answerUri: ask.outcome === 'answered' || ask.outcome === 'containing' ? ask.reason : null,
  })
}

/**
 * Record one ask, or nothing at all.
 *
 * Returns undefined synchronously when the `?graph` flag is down; otherwise a promise that settles
 * once the batch this ask joined has been written, so a caller that awaits it knows the log is
 * current. It never rejects: a row the engine refuses is logged here and dropped.
 */
export const recordAsk = (ask: Ask): Promise<void> | undefined => {
  if (!graphEnabled()) return undefined
  const queued = queue(ask).catch(error => {
    console.error(new Error('graph: the ask log could not key a row', { cause: error }))
  })
  drafting.add(queued)
  void queued.finally(() => { drafting.delete(queued) })
  return queued.then(() => schedule())
}

/**
 * Write whatever is queued now rather than at the end of the window. Awaited by every reader.
 *
 * `drafting` is drained first and the loop re-checks it, because a caller records fire and forget:
 * an ask whose key is still being hashed is not in `pending` yet, and a flush that read only that
 * list would report a page's asks one short of what it asked.
 */
export const flushAsks = async (): Promise<void> => {
  while (drafting.size || pending.length || timer !== undefined) {
    await Promise.all([...drafting])
    if (pending.length || timer !== undefined) await fire()
  }
  await writing
}

/**
 * Every `Ask` row, ordered by `seq`.
 *
 * Throws when the graph is off, rather than answering with an empty list: a log that was never
 * enabled and a session that asked nothing are different facts, and the caller of
 * `?export=answers` has no other way to tell them apart. Same rule as `exportAnswers`.
 */
export const exportAsks = async (): Promise<AskRow[]> => {
  if (!graphEnabled()) throw new Error('graph: the ask log is off, load the page with ?graph=1')
  await flushAsks()
  const { query } = await graphReady()
  const rows = await query(
    `MATCH (k:Ask)
     RETURN k.key AS key, k.seq AS seq, k.clusterId AS clusterId, k.runUri AS runUri,
            k.origin AS origin, k.showId AS showId, k.questionHash AS questionHash,
            k.outcome AS outcome, k.reason AS reason, k.answerUri AS answerUri
     ORDER BY k.seq`
  )
  return rows as AskRow[]
}
