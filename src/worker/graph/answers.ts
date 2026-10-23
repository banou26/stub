/**
 * The `Answer` log: every source answer kept byte for byte, one row per answer, deduped on content.
 *
 * Section 4.1 of the representation design. `recordAnswers` is called from the one `useOnResolve` in
 * `src/worker/extractor.ts`, so every source and every plugin source goes through it. It promises
 * that a row is written for an ANSWER and for nothing else (see the position whitelist below), that
 * a byte-identical re-fetch writes no row and moves no `seq`, and that it costs nothing at all while
 * the `?graph` flag is down: it returns undefined before touching the engine, so the 22 MB engine is
 * never fetched. It refuses to fail a resolve: a batch the engine rejects is logged and dropped, and
 * the answer the user asked for still returns.
 *
 * `exportAnswers` is the read side, behind `?export=answers` (see `src/answers-export.ts`).
 */
import type { GraphQLResolveInfo } from 'graphql'

import { contextOf } from '../request-context'
import { graphEnabled } from './engine'
import { canonicalJson, sha256Hex } from './hash'
import { graphReady } from './schema'

/** What an answer is about. The `Answer.kind` column of 2.1. */
export type AnswerKind = 'media' | 'episode' | 'origin'

/** One `Answer` row, as it is written and as `exportAnswers` hands it back. */
export type AnswerRow = {
  /** sha-256 over (origin, kind, uri, canonical JSON of raw). The primary key, and the dedupe. */
  key: string
  /** Ingest sequence, monotonic per session, assigned when the key is first seen and never re-used. */
  seq: number
  uri: string
  origin: string
  kind: AnswerKind
  /** The root operation the request carried, or `UNKNOWN` for a hop that arrived with no context. */
  operation: string
  /** The field names the answer carried at the top level, sorted, so a partial answer is visible as such. */
  selection: string[]
  /** The resolver's return value as JSON, byte for byte: handles, relations and episodes included, unless `keepEpisodes(false)`. */
  raw: string
}

/**
 * WHICH POSITIONS ARE ANSWERS, as a closed whitelist of paths, never a blacklist of `handles`.
 *
 * `MediaHandle.node` and `MediaRelationEdge.node` are both `Media!` (`schema.gql:226-231`, `:170`),
 * so a hook keyed on the named type alone cannot tell a source's own answer from the row it merely
 * names. A blacklist of the `handles` segment does not close it either: `relations` is the same
 * shape, an episode's `handles` are a third, and the next nested `Media!` the schema grows would
 * arrive silently as an answer. So the rule runs the other way: a result is an answer only when its
 * path is one of these, and everything else is a nested node that reaches the graph through its
 * parent's decomposition (4.2 step 6, which is step 1b).
 *
 * The value is the GraphQL type the position must return. Position AND type, so `Media.origin`, a
 * String field that happens to be named like the `origin` root, can never be mistaken for one.
 *
 * `similarMedia` is a `Media` today (`schema.gql:551`). When decision 2 lands and it answers a
 * payload, its `media` and `containing` join this list, and so do their `episodes`.
 *
 * `containingMedia` IS AN ANSWER TOO, and was missing here until 2026-09-13 (4.4). It is the same
 * shape as `similarMedia`: a source's own description of a season, episodes included. What differs is
 * only what the CONSUMER claims off it, `PART_OF` rather than `SAME_AS`, which is decided in
 * `similar-consumer.ts` and is no business of this whitelist. While it was absent the season's 24
 * episodes reached the old store through the position-blind inserters and the graph not at all, and
 * the graph got them one round trip later only because `askAddressOf` re-asked the claim's unowned
 * target as an ordinary `media`; `?export=answers` could not carry one, so no corpus could replay it.
 */
const ANSWER_POSITIONS: Record<string, string> = {
  'media': 'Media',
  'similarMedia': 'Media',
  'containingMedia': 'Media',
  'mediaPage.nodes': 'Media',
  'origin': 'Origin',
  'originPage.nodes': 'Origin',
  'media.episodes': 'Episode',
  'similarMedia.episodes': 'Episode',
  'containingMedia.episodes': 'Episode',
  'mediaPage.nodes.episodes': 'Episode',
}

const KIND_OF_TYPE: Record<string, AnswerKind> = { Media: 'media', Episode: 'episode', Origin: 'origin' }

/**
 * The position key of a resolved field: the path from the root with list indices dropped, since
 * `mediaPage.nodes.3.episodes` is the same position as `mediaPage.nodes.0.episodes`.
 */
export const positionKeyOf = (info: Pick<GraphQLResolveInfo, 'path'>): string => {
  const segments: string[] = []
  for (let step: GraphQLResolveInfo['path'] | undefined = info.path; step; step = step.prev) {
    if (typeof step.key === 'string') segments.unshift(step.key)
  }
  return segments.join('.')
}

/**
 * The kind of answer this resolved field is, or undefined for a nested node.
 *
 * `typeName` is the named type of the resolved field, which the caller already computed.
 */
export const answerKindOf = (info: Pick<GraphQLResolveInfo, 'path'>, typeName: string): AnswerKind | undefined => {
  const expected = ANSWER_POSITIONS[positionKeyOf(info)]
  return expected === typeName ? KIND_OF_TYPE[typeName] : undefined
}

// A separator no uri, origin or kind can contain, so (origin 'a', uri 'b:c') and (origin 'a:b',
// uri 'c') cannot hash alike. The same reason `handlePairs` joins on `\0` (`extractor.ts:116`).
const keyOf = (origin: string, kind: AnswerKind, uri: string, value: unknown): Promise<string> =>
  sha256Hex(`${origin}\0${kind}\0${uri}\0${canonicalJson(value)}`)

type Draft = Omit<AnswerRow, 'seq'>

/**
 * What the log hands its rows to once they are written: the ingest of section 4, in the live worker.
 *
 * A sink rather than a direct call so the log stays what step 1a made it, and so a test or a replay
 * can drive the ingest with no log in front of it. It is registered from `./index.ts`'s boot, which
 * runs only behind the `?graph` flag, and it is handed the rows that were actually CREATED: a
 * byte-identical re-fetch reaches it with nothing, the same way it writes nothing.
 */
type AnswerSink = (rows: AnswerRow[]) => Promise<unknown>

let sink: AnswerSink | undefined

/** Registers the sink, or clears it with no argument. Returns the one it replaced. */
export const setAnswerSink = (next?: AnswerSink): AnswerSink | undefined => {
  const previous = sink
  sink = next
  return previous
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** A media and an episode are addressed by `uri`, an origin by its `id`: there is no other address. */
const addressOf = (kind: AnswerKind, value: Record<string, unknown>): { uri: string, origin: string } | undefined => {
  const uri = kind === 'origin' ? value.id : value.uri
  const origin = kind === 'origin' ? value.id : value.origin
  if (typeof uri !== 'string' || !uri || typeof origin !== 'string' || !origin) return undefined
  return { uri, origin }
}

const draftOf = async (kind: AnswerKind, operation: string, value: Record<string, unknown>): Promise<Draft | undefined> => {
  const address = addressOf(kind, value)
  // a row with no address can be neither keyed nor read back; 4.2 step 1 quarantines it as an
  // anomaly, which is step 1b's table
  if (!address) return undefined
  return {
    key: await keyOf(address.origin, kind, address.uri, value),
    ...address,
    kind,
    operation,
    // sorted rather than in the source's own order: what a reader asks of this column is whether a
    // field was answered, and a stable order makes two answers comparable at a glance
    selection: Object.keys(value).filter(field => value[field] !== undefined).sort(),
    raw: JSON.stringify(value),
  }
}

/**
 * The root operation this hop serves, read off the request context registry rather than off the
 * wire (`src/worker/request-context.ts`). `contextOf` is used rather than `readContext` so the hook
 * does not move the miss counter that `request-context.test.ts` asserts on.
 */
const operationOf = (info: Pick<GraphQLResolveInfo, 'variableValues'>): string => {
  const input = (info.variableValues as { input?: { context?: { token?: unknown } } } | undefined)?.input
  return contextOf(input?.context?.token)?.operation ?? 'UNKNOWN'
}

// The same window as the three DataLoaders (`extractor.ts:129-134`), because the rows arrive on the
// same resolves: per-row execute is 18x slower than one UNWIND batch (2,000 nodes in 107 ms against
// 935 ms, 2026-09-11), so what lands inside one window is written by one statement.
const FLUSH_MS = 50

// A separator no field name carries, the same one the ingest joins its list columns on.
const SELECTION_SEPARATOR = '\u0000'

let episodesKept = true

/**
 * Whether answers keep their episodes, as they do unless a caller that never reads an episode says otherwise: a media
 * answer is then logged without its `episodes` and an episode answer not at all, so the graph holds none.
 */
export const keepEpisodes = (kept: boolean): void => { episodesKept = kept }

let pending: Draft[] = []
let timer: ReturnType<typeof setTimeout> | undefined
let settle: (() => void) | undefined
let scheduled: Promise<void> | undefined
// every batch writes behind the previous one, so two flushes can never interleave on the one shared
// connection
let writing: Promise<void> = Promise.resolve()
let seq = 0

const write = async (batch: Draft[]): Promise<void> => {
  if (!batch.length) return
  const { query } = await graphReady()

  // dedupe INSIDE the batch first: one fan-out answers about the same uri several times in one
  // window, and two identical drafts would otherwise race for one primary key
  const unique = new Map<string, Draft>()
  for (const draft of batch) if (!unique.has(draft.key)) unique.set(draft.key, draft)

  // ...then against the table, in ONE round trip for the whole batch rather than a lookup per row
  const keys = [...unique.keys()]
  const seen = await query('UNWIND $keys AS k MATCH (a:Answer {key: k}) RETURN a.key AS key', { keys })
  const existing = new Set(seen.map(row => row.key as string))

  // `seq` is assigned HERE, after the read back, which is what makes a byte-identical re-fetch move
  // nothing: a row that already exists never reaches a number
  const rows = [...unique.values()].filter(draft => !existing.has(draft.key)).map(draft => ({ ...draft, seq: ++seq }))
  if (!rows.length) return

  // `selection` travels JOINED and is split in the statement, never as a JS list. An `UNWIND` struct
  // field is typed from the FIRST row only, so a batch whose first answer selected nothing and whose
  // second selected fields binds that field as LIST(ANY) and the CREATE dies at runtime, taking the
  // whole batch of answers with it (measured 2026-09-12, 0.20.4; see `./ingest.ts`'s header).
  await query(
    `UNWIND $rows AS r
     CREATE (:Answer {key: r.key, seq: r.seq, uri: r.uri, origin: r.origin, kind: r.kind,
                      operation: r.operation,
                      selection: CASE WHEN r.selection = '' THEN cast(NULL AS STRING[]) ELSE string_split(r.selection, $separator) END,
                      raw: r.raw})`,
    { separator: SELECTION_SEPARATOR, rows: rows.map(row => ({ ...row, selection: row.selection.join(SELECTION_SEPARATOR) })) }
  )

  // the ingest runs on the rows this batch WROTE, inside the same serialized window, so a caller that
  // awaits the log (`flushAnswers`, `exportAnswers`, `graphCounts`) has the graph too. It is wrapped
  // here rather than inside itself: a graph the ingest could not write is a gap in a projection of
  // the log, and the log is the source of truth, so it must not take the log's own write down
  try {
    await sink?.(rows)
  } catch (error) {
    // the reason is spelled into the message, not left in `cause`: a page's console shows the top
    // error and its stack, so a binder error reported only as a cause is invisible where it happens
    const reason = error instanceof Error ? error.message : String(error)
    console.error(new Error(`graph: the ingest dropped a batch of ${rows.length} answer(s): ${reason}`, { cause: error }))
  }
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
    // a log that drops a batch is a gap in the record; a log that fails a resolve is a blank page
    console.error(new Error(`graph: the answer log dropped ${batch.length} row(s)`, { cause: error }))
  }).finally(() => done?.())
  return writing
}

const schedule = (): Promise<void> => {
  scheduled ??= new Promise<void>(resolve => { settle = resolve })
  timer ??= setTimeout(() => { void fire() }, FLUSH_MS)
  return scheduled
}

/**
 * Record every ANSWER in a resolver's return value, or nothing at all.
 *
 * Returns undefined synchronously when the flag is down, when the position is not an answer, and
 * when the value carries nothing addressable; otherwise a promise that settles once the batch this
 * answer joined has been written, so a caller that awaits it knows the log is current. An array
 * result (a page's nodes, a media's episodes) is one answer per entry, each keyed on its own uri.
 */
export const recordAnswers = (
  info: Pick<GraphQLResolveInfo, 'path' | 'variableValues'>,
  typeName: string,
  result: unknown
): Promise<void> | undefined => {
  if (!graphEnabled()) return undefined
  const kind = answerKindOf(info, typeName)
  if (!kind || (kind === 'episode' && !episodesKept)) return undefined
  const values = (Array.isArray(result) ? result : [result]).filter(isRecord)
    .map(value => kind === 'media' && !episodesKept ? { ...value, episodes: undefined } : value)
  if (!values.length) return undefined
  const operation = operationOf(info)
  return Promise.all(values.map(value => draftOf(kind, operation, value)))
    .then(drafts => {
      const usable = drafts.filter((draft): draft is Draft => draft !== undefined)
      if (!usable.length) return
      pending.push(...usable)
      return schedule()
    })
    .catch(error => {
      // the returned promise is awaited by the resolve hook, so it must never reject: a value JSON
      // cannot express (a circular franchise, a BigInt) would otherwise take the source's answer
      // down with it
      console.error(new Error('graph: the answer log could not read a resolver return value', { cause: error }))
    })
}

/** Write whatever is queued now rather than at the end of the window. Awaited by every reader. */
export const flushAnswers = async (): Promise<void> => {
  while (pending.length || timer !== undefined) await fire()
  await writing
}

/**
 * Every `Answer` row, ordered by `seq`.
 *
 * Throws when the graph is off, rather than answering with an empty list: an empty log and a log
 * that was never enabled are different facts, and the caller of `?export=answers` has no other way
 * to tell them apart. `raw` comes back as the JSON string that was stored, which is the point of
 * the column: the caller parses it, and gets back exactly what the resolver returned.
 */
export const exportAnswers = async (): Promise<AnswerRow[]> => {
  if (!graphEnabled()) throw new Error('graph: the answer log is off, load the page with ?graph=1')
  await flushAnswers()
  const { query } = await graphReady()
  const rows = await query(
    `MATCH (a:Answer)
     RETURN a.key AS key, a.seq AS seq, a.uri AS uri, a.origin AS origin, a.kind AS kind,
            a.operation AS operation, a.selection AS selection, a.raw AS raw
     ORDER BY a.seq`
  )
  return rows.map(row => ({
    ...row,
    // an EMPTY STRING[] reads back as NULL rather than as an empty list (measured 2026-09-12,
    // 0.20.4), so a caller counting fields would see null where the answer carried none
    selection: (row.selection as string[] | null) ?? [],
  })) as AnswerRow[]
}
