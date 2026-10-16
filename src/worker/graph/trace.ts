/**
 * THE TRACE of section 7.5: "why is this here", as ONE bundle for ONE cluster.
 *
 * Section 7.5 lists nine questions a bug report asks and gives the Cypher for each. This module runs
 * all of them for one address and answers a single JSON document, because the panel that renders it
 * cannot ask nine follow-up questions over osra while a user is looking at a wrong page.
 *
 * WHAT IT PROMISES.
 * - **A REFUSED ROW IS FIRST CLASS.** Every `LINK` and `EPISODE_LINK` the bundle names is carried
 *   whatever its `status`, because the question is almost always "why is this NOT here", and the
 *   refusal with its `reason`, `evidence` and `gates` is the answer. Nothing here filters on
 *   `status = 'active'`.
 * - **`supports` IS THE DESCENT, and it is carried verbatim.** A link names the edge keys it was
 *   derived from (3.2), so a reader walks link to claim to `Answer` by key rather than by walking
 *   paths. An empty `STRING[]` reads back as NULL on this engine, so every list column is normalized
 *   to `[]` on the way out and a missing descent is never a null.
 * - **`evidence` and `gates` stay STRINGS.** Their content is per rule, so they are passed through as
 *   the JSON the writer stored and parsed by the caller.
 * - **NOTHING IS INVENTED.** A field the graph does not carry is `null`. Two of the contract's fields
 *   are permanently null for that reason and both are named below.
 * - **IT NEVER WRITES.** Every statement goes through `readOnlyQuery` (5.3's isolation layer 1), the
 *   same handle a plugin is given, so a write verb in this file throws with `graph trace` in the
 *   message rather than moving a row.
 *
 * WHY THE COUNTS ARE RE-READ HERE rather than through `graphCounts`. That export flushes the answer
 * log first and waits out the pass it wakes, which WRITES: it is the right answer for
 * `?export=answers`, where a caller wants the graph current, and the wrong one for a panel whose
 * whole claim is that looking at the graph does not change it. The trace reads the tables where they
 * stand.
 *
 * THE FOUR EMPTY ANSWERS ARE FOUR DIFFERENT FACTS (`reason`), and telling them apart is the single
 * most useful thing the panel does: `not-enabled` (the flag is down, so there is no engine at all),
 * `graph-empty` (an engine with nothing in it), `no-row` (the uri names no `Media` row) and
 * `no-cluster` (a row that no pass has clustered yet). A panel that answered "nothing" to all four
 * would send every reader to read the ingest.
 */
import type { AnswerKind } from './answers'
import type { Graph } from './engine'

import { graphEnabled } from './engine'
import { readOnlyQuery } from './plugins/runner'
import { addressUris } from './read'
import { graphReady, GRAPH_NODE_TABLES, GRAPH_REL_TABLES } from './schema'

/**
 * Why a bundle carries no cluster. Absent when one resolved.
 *
 * `not-enabled` is answered without touching the engine, so a page carrying neither flag never
 * fetches the 22 MB wasm to be told the flag is down.
 */
export type TraceReason = 'no-row' | 'no-cluster' | 'graph-empty' | 'not-enabled'

/**
 * The cluster the address landed on, and the page it would draw (6.5).
 *
 * `otherClusters` is the one thing here that is about what was NOT drawn: an `ag:(a,b)` address whose
 * members sit in two clusters resolves to exactly one (RUN before CONTAINER, then visible before
 * hidden, then lowest key), and the other cluster's members are absent from `members` with nothing
 * saying so. A split cluster is a common cause of "this page shows the wrong thing", so the ids it
 * did not pick are named. Empty for the ordinary case, and for any address of one uri.
 */
export type TraceResolved = {
  clusterId: string
  aggUri: string
  scope: string
  kind: string | null
  otherClusters: string[]
}

/**
 * One row the cluster names: a member, or a placeholder a member's claim named (4.3).
 *
 * `scope` is the EFFECTIVE scope, `MediaProfile.scope`, falling back to the owner's own `Media.scope`
 * when no profile exists, because the effective one is what every rule downstream read. `via`
 * separates the two kinds of row: a `placeholder` is a uri no source has described, so it carries
 * its uri and its origin and nothing else, and the claim that named it is in `claims`.
 */
export type TraceMember = {
  uri: string
  origin: string
  owned: boolean
  scope: string | null
  title: string | null
  episodeCount: number | null
  countKind: string | null
  startDate: string | null
  via: 'member' | 'placeholder'
}

/** One `CLAIMS` row between two uris the bundle names: what a source asserted, never a conclusion. */
export type TraceClaim = {
  fromUri: string
  toUri: string
  kind: string
  claimer: string
  provenance: string
  answerSeq: number
  targetScope: string | null
  key: string
}

/**
 * One `LINK` row touching a member, ACTIVE OR REFUSED.
 *
 * Not restricted to pairs of members, and that is the point: "why is Netflix missing here" is
 * answered by a refused link whose other end is precisely NOT in this cluster.
 */
export type TraceLink = {
  fromUri: string
  toUri: string
  kind: string
  status: string
  by: string
  reason: string
  confidence: number | null
  version: number | null
  evidence: string | null
  gates: string | null
  supports: string[]
  key: string
}

/**
 * One `ATTACHED_TO` edge this cluster is an end of, in the edge's own direction.
 *
 * `runUri` is the ATTACHING cluster and `containerUri` the one it attaches to; `via` says which is
 * which, since `show-show` joins two containers and `part` points at a run (5.4 P2). Both are the
 * cluster's `aggUri`, falling back to its id when it has published nothing.
 *
 * `evidence` IS ALWAYS NULL: `ATTACHED_TO` carries no such column (2.2). `supports` is the column it
 * does carry, and it is the descent to the `PART_OF` links the attachment was grouped from.
 */
export type TraceAttachment = {
  runUri: string
  containerUri: string
  via: string
  by: string
  evidence: string | null
  supports: string[]
}

/** One row filling a slot, and the keys that put it there (5.4 P5). */
export type TraceFill = {
  episodeUri: string
  origin: string
  via: string
  by: string
  number: number | null
  supports: string[]
}

/** One `Slot` of the cluster with the rows that fill it, in the order a page draws them (6.4). */
export type TraceEpisode = {
  slotId: string
  number: number | null
  title: string | null
  fills: TraceFill[]
}

/** One `EPISODE_LINK` touching an episode the bundle names, active or refused. */
export type TraceEpisodeLink = {
  fromUri: string
  toUri: string
  kind: string
  status: string
  by: string
  reason: string
  fromNumber: number | null
  toNumber: number | null
  evidence: string | null
  supports: string[]
  key: string
}

/**
 * One `HAS_EPISODE` edge: a source's own episode list, which is source truth like a claim.
 *
 * `fromUri` is the media row that hung the episode and `toUri` the episode. It is in the bundle
 * because a `via: member` fill's `supports` names exactly this key, so without the table every such
 * fill's descent dead-ended. `answerSeq` carries it one step further, to the `Answer` the list
 * arrived in.
 */
export type TraceEpisodeSource = {
  fromUri: string
  toUri: string
  claimer: string
  answerSeq: number
  key: string
}

/** One `EPISODE_CLAIMS` row: an episode identity a source asserted (2.1). */
export type TraceEpisodeClaim = {
  fromUri: string
  toUri: string
  kind: string
  claimer: string
  provenance: string
  answerSeq: number
  key: string
}

/**
 * "Why did this count win" (7.5), off the cluster's own columns.
 *
 * `from` is `runLengthFrom` joined by `, `: the column is a `STRING[]` of the uris that voted, and it
 * is one readable line here rather than a list, which is what the panel prints beside the number.
 * `tier` is `runLengthTier` as text for the same reason, since a tier is a label to a reader.
 */
export type TraceRunLength = {
  value: number | null
  from: string | null
  tier: string | null
  witnesses: number | null
}

/** One finding of 5.5, as `plugin:aggregate` filed it on the cluster. */
export type TraceAnomaly = { rule: string, detail: string }

/**
 * One question the similar consumer put for this cluster, and what it came to (7.3).
 *
 * `seq` is the ask's own sequence, monotonic per session and assigned in the order the questions
 * settled, so a row here lines up with the `Ask` log a walk exports. `at` IS ALWAYS NULL: `Ask`
 * carries no timestamp column (2.1), only that `seq`, and inventing a time from an ordering would be
 * a guess. The panel draws the sequence and does not draw a column that can never carry anything.
 */
export type TraceAsk = {
  seq: number
  origin: string
  outcome: string
  reason: string | null
  at: number | null
}

/**
 * One `Answer` row as METADATA: never its `raw`.
 *
 * A bundle carrying every raw answer is megabytes the panel does not render (843 to 896 rows and 1.6
 * to 1.9 MB on one real page, 2026-09-12), so `bytes` stands in for the payload and `traceAnswer`
 * fetches the one row a reader actually opened.
 */
export type TraceAnswerMeta = {
  seq: number
  uri: string
  origin: string
  operation: string
  bytes: number
}

/** One `Answer` in full, which is what "why is this field this value" ends at. */
export type TraceAnswerDetail = {
  key: string
  seq: number
  uri: string
  origin: string
  kind: AnswerKind
  operation: string
  selection: string[]
  raw: string
}

/**
 * Everything 7.5 asks about one cluster, in one document.
 *
 * `cost` is the panel's own bill: how many statements the bundle took and how long they cost. It is
 * here rather than in a log line because the trace is the one read with no statement budget (6.1's
 * budget is the page's), so the number has to be visible to stay honest.
 */
export type TraceBundle = {
  asked: string
  resolved: TraceResolved | null
  reason?: TraceReason
  members: TraceMember[]
  claims: TraceClaim[]
  links: TraceLink[]
  attachments: TraceAttachment[]
  episodes: TraceEpisode[]
  episodeLinks: TraceEpisodeLink[]
  episodeClaims: TraceEpisodeClaim[]
  episodeSources: TraceEpisodeSource[]
  runLength: TraceRunLength
  anomalies: TraceAnomaly[]
  asks: TraceAsk[]
  answers: TraceAnswerMeta[]
  counts: Record<string, number>
  cost: { statements: number, ms: number }
}

// ---------------------------------------------------------------------------------------------
// Reading columns back.

// An empty `STRING[]` reads back as NULL on this engine (the engine facts of 2026-09-12), so every
// list column is normalized here rather than at each use: a link with no descent must read as an
// empty `supports`, never as a null the caller has to test for.
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

const textOf = (value: unknown): string => typeof value === 'string' ? value : ''

const nullableTextOf = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

const numberOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    // a column the writer could not have written: the panel is the last place that should throw, so
    // it is reported once and read as absent
    console.error(new Error(`graph trace: a column is not JSON: ${value.slice(0, 80)}`))
    return null
  }
}

type TitleEntry = { title?: unknown, language?: unknown, score?: unknown }

/**
 * The one title a row is named by: highest `score`, ties by language then text.
 *
 * `Media.titles` is the ingest's field-merged list in no particular order, while a slot's
 * `episode.titles` is already sorted by score (6.4), so the same rule over both picks the same entry
 * the page's own header does.
 */
const bestTitle = (titles: unknown): string | null => {
  if (!Array.isArray(titles)) return null
  const entries = titles
    .filter((entry): entry is TitleEntry => entry !== null && typeof entry === 'object')
    .filter(entry => typeof entry.title === 'string' && entry.title)
    .sort((a, b) =>
      (numberOf(b.score) ?? 0) - (numberOf(a.score) ?? 0)
      || textOf(a.language).localeCompare(textOf(b.language))
      || String(a.title).localeCompare(String(b.title)))
  return entries.length ? String(entries[0]!.title) : null
}

// Two callers and two shapes: `Media.titles` arrives as the JSON column, a slot's titles arrive
// already parsed out of `Slot.episode`. Split because one function taking both silently answered NULL
// for every slot on this file's first run: `parseJson` of an array is not a string, so it reported the
// column unreadable and the panel drew no episode title anywhere.
const titleOf = (value: unknown): string | null => bestTitle(parseJson(value))

// `size()` over a STRING or JSON column counts CHARACTERS, not bytes (measured 2026-09-12 on 0.20.4:
// 1 for `日`, whose UTF-8 is three bytes), so the byte length is taken in JS off the stored string
// and the string itself is dropped: a JSON field is quoted in the log, and `bytes` has to be the
// figure a reader can compare against a transfer.
const bytesOf = (value: unknown): number =>
  typeof value === 'string' ? new TextEncoder().encode(value).length : 0

// ---------------------------------------------------------------------------------------------
// The statements.

type Reader = <Row>(cypher: string, params?: Record<string, unknown>) => Promise<Row[]>

/** A counting, write-refusing handle over the open engine. `spent` counts only its own statements. */
const readerOf = (query: Graph['query']) => {
  const guarded = readOnlyQuery('graph trace', query)
  let statements = 0
  const read: Reader = async <Row>(cypher: string, params?: Record<string, unknown>): Promise<Row[]> => {
    statements += 1
    return guarded<Row>(cypher, params)
  }
  return { read, spent: (): number => statements }
}

// The resolve of 6.2 statement 1, narrowed to the id: one cluster, RUN before CONTAINER, then
// visible before hidden, then by lowest member uri. `read.ts` owns the same three lookups and keeps
// neither half this needs, since `resolveMedia` follows a container's `preferredRun` (which hides
// the cluster the uri actually reached) and answers undefined for a cluster whose `media` JSON was
// never materialized (which is exactly the state a trace is opened to explain). Its pure
// `addressUris` IS reused; its `placeholdersOf` is not, because that one reads through read.ts's
// own handle rather than through this file's write-refusing one, and the promise at the top of this
// file is that EVERY statement goes through the reader. The placeholder statement is re-spelled
// below with its member filter.
const RESOLVE_ID = `RETURN DISTINCT c.id AS id, c.key AS key,
       CASE WHEN c.scope = 'RUN' THEN 0 ELSE 1 END AS scopeRank,
       CASE WHEN c.hidden THEN 1 ELSE 0 END AS hiddenRank
   ORDER BY scopeRank, hiddenRank, key
   LIMIT 1`

const resolveClusterId = async (read: Reader, asked: string, uris: readonly string[]): Promise<string | null> => {
  if (uris.length) {
    const [member] = await read<{ id: unknown }>(
      `UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) ${RESOLVE_ID}`,
      { uris: [...uris] }
    )
    if (member) return String(member.id)
    // `published` is append-only, so a departed member still resolves, and membership ranks above it
    const [published] = await read<{ id: unknown }>(
      `UNWIND $uris AS u MATCH (c:Cluster) WHERE u IN c.published ${RESOLVE_ID}`,
      { uris: [...uris] }
    )
    if (published) return String(published.id)
  }
  if (!asked) return null
  const [current] = await read<{ id: unknown }>(
    'MATCH (c:Cluster {id: $id}) RETURN c.id AS id', { id: asked }
  )
  if (current) return String(current.id)
  const [aliased] = await read<{ id: unknown }>(
    'MATCH (x:Alias {id: $id}) MATCH (c:Cluster {id: x.clusterId}) RETURN c.id AS id', { id: asked }
  )
  return aliased ? String(aliased.id) : null
}

/** Every table's row count, read where the tables stand: no flush, no pass, no write. */
const countsOf = async (read: Reader): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {}
  for (const table of GRAPH_NODE_TABLES) {
    const rows = await read<{ total: unknown }>(`MATCH (n:${table}) RETURN count(n) AS total`)
    counts[table] = numberOf(rows[0]?.total) ?? 0
  }
  for (const table of GRAPH_REL_TABLES) {
    const rows = await read<{ total: unknown }>(`MATCH ()-[e:${table}]->() RETURN count(e) AS total`)
    counts[table] = numberOf(rows[0]?.total) ?? 0
  }
  return counts
}

// A FUNCTION rather than a shared constant: every bundle leaves through osra and a caller is free to
// edit what it was handed, so two bundles must not name one object.
const noRunLength = (): TraceRunLength => ({ value: null, from: null, tier: null, witnesses: null })

const emptyBundle = (
  asked: string,
  reason: TraceReason,
  counts: Record<string, number>,
  cost: { statements: number, ms: number }
): TraceBundle => ({
  asked,
  resolved: null,
  reason,
  members: [],
  claims: [],
  links: [],
  attachments: [],
  episodes: [],
  episodeLinks: [],
  episodeClaims: [],
  episodeSources: [],
  runLength: noRunLength(),
  anomalies: [],
  asks: [],
  answers: [],
  counts,
  cost,
})

/**
 * Everything 7.5 asks about the cluster one address reaches, in one bundle.
 *
 * `uri` is an aggregated address (`ag:(anilist:108465,mal:39535)`), a bare member uri (`mal:39535`)
 * or a cluster id (`cl:anilist:108465`), current or retired: all three spellings of one cluster
 * answer the same bundle, because a bug report carries whichever the reporter had in the address bar.
 *
 * It promises to write nothing, to carry refused rows, and to answer a `reason` rather than a silence
 * when no cluster resolves. It refuses to carry any `Answer.raw`: `traceAnswer` is that, one row at a
 * time.
 */
export const traceGraph = async (uri: string): Promise<TraceBundle> => {
  const asked = uri ?? ''
  const started = performance.now()
  // BEFORE `graphReady`, deliberately: with the flag down there is no engine to ask, and opening one
  // to report that the flag is down would fetch 22 MB to answer a question about a query parameter
  if (!graphEnabled()) {
    return emptyBundle(asked, 'not-enabled', {}, { statements: 0, ms: 0 })
  }

  const { query } = await graphReady()
  const { read, spent } = readerOf(query)
  const cost = () => ({ statements: spent(), ms: Math.round(performance.now() - started) })

  const uris = addressUris(asked)
  const counts = await countsOf(read)
  const clusterId = await resolveClusterId(read, asked, uris)

  if (!clusterId) {
    // AN EMPTY GRAPH IS NOT A MISSING ROW, and it is read first: `no-row` is also true of an empty
    // graph and it sends the reader to look for one uri when NOTHING is there.
    //
    // Emptiness is `Media`, not every table. The boot seeds an `Origin` row per extractor before any
    // source answers (`./index.ts`), so a graph that has only ever booted carries two dozen rows and
    // an "every count is zero" test would never fire on a real page. A log with answers and no
    // `Media` rows is a THIRD thing, an ingest that quarantined the page, and the `Answer` count
    // sitting in `counts` beside this reason is what shows it.
    if ((counts.Media ?? 0) === 0) {
      return emptyBundle(asked, 'graph-empty', counts, cost())
    }
    const rows = uris.length
      ? await read<{ uri: unknown }>('MATCH (m:Media) WHERE m.uri IN $uris RETURN m.uri AS uri LIMIT 1', { uris: [...uris] })
      : []
    return emptyBundle(asked, rows.length ? 'no-cluster' : 'no-row', counts, cost())
  }

  // The clusters the ASKED address reaches that this bundle is not about. `resolveClusterId` picks
  // one and the rest go silently missing from `members`, which reads as a cluster that lost rows
  // rather than as an address that spans two. Only for a multi-uri address: one uri is in one
  // cluster by construction (4.3). Filtered in JS rather than with `<>`, so the statement uses
  // nothing beyond the shapes this engine is measured on.
  const spanRows = uris.length > 1
    ? await read<{ id: unknown }>(
      `UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster)
       RETURN DISTINCT c.id AS id ORDER BY id`,
      { uris: [...uris] }
    )
    : []
  const otherClusters = spanRows.map(row => textOf(row.id)).filter(id => id && id !== clusterId)

  const [cluster] = await read<Record<string, unknown>>(
    `MATCH (c:Cluster {id: $id})
     RETURN c.aggUri AS aggUri, c.scope AS scope, c.kind AS kind, c.runLength AS runLength,
            c.runLengthTier AS tier, c.runLengthWitnesses AS witnesses,
            c.runLengthFrom AS witnessedBy, c.anomalies AS anomalies`,
    { id: clusterId }
  )

  const memberRows = await read<Record<string, unknown>>(
    `MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $id})
     OPTIONAL MATCH (p:MediaProfile {uri: m.uri})
     RETURN m.uri AS uri, m.origin AS origin, m.owned AS owned, m.titles AS titles,
            m.episodeCount AS episodeCount, m.startDate AS startDate,
            coalesce(p.scope, m.scope) AS scope, p.countKind AS countKind
     ORDER BY uri`,
    { id: clusterId }
  )
  const memberUris = memberRows.map(row => textOf(row.uri))

  // THE PLACEHOLDER LIST EXCLUDES THE MEMBERS, and that filter is the whole point of re-spelling
  // read.ts's statement here.
  //
  // `owned: false` means "no source has described this uri" (`schema.ts`), which is NOT the same as
  // "not a member": `plugin:aggregate` clusters an undescribed row whenever one origin fails to
  // answer while others claim it, and 50 of 241 clusters on a recorded page (20.7%, measured
  // 2026-09-13) carried at least one uri in both lists. A uri in both is drawn TWICE at one position,
  // once as a member and once as a non-member with no scope, and the last box painted wins, so a
  // member reads as a placeholder: the exact class of lie this panel exists to prevent.
  //
  // `owned` is a property match rather than a `coalesce` for read.ts's reason: the ingest writes the
  // column on both of its branches and no plugin writes `Media` at all, so it is never NULL. One
  // entry per uri, whatever provenance named it, since the claims below carry the provenance.
  const placeholderRows = await read<Record<string, unknown>>(
    `MATCH (c:Cluster {id: $id})<-[:MEMBER_OF]-(:Media)-[:CLAIMS]->(t:Media {owned: false})
     WHERE NOT t.uri IN $members
     RETURN DISTINCT t.uri AS uri, t.origin AS origin
     ORDER BY uri`,
    { id: clusterId, members: memberUris }
  )

  const members: TraceMember[] = [
    ...memberRows.map(row => ({
      uri: textOf(row.uri),
      origin: textOf(row.origin),
      owned: row.owned === true,
      scope: nullableTextOf(row.scope),
      title: titleOf(row.titles),
      episodeCount: numberOf(row.episodeCount),
      countKind: nullableTextOf(row.countKind),
      startDate: nullableTextOf(row.startDate),
      via: 'member' as const,
    })),
    ...placeholderRows.map(row => ({
      uri: textOf(row.uri),
      origin: textOf(row.origin),
      owned: false,
      scope: null,
      title: null,
      episodeCount: null,
      countKind: null,
      startDate: null,
      via: 'placeholder' as const,
    })),
  ]

  const named = members.map(member => member.uri)

  const claimRows = named.length
    ? await read<Record<string, unknown>>(
      `MATCH (a:Media)-[cl:CLAIMS]->(b:Media)
       WHERE a.uri IN $uris AND b.uri IN $uris
       RETURN a.uri AS fromUri, b.uri AS toUri, cl.kind AS kind, cl.claimer AS claimer,
              cl.provenance AS provenance, cl.answerSeq AS answerSeq, cl.targetScope AS targetScope,
              cl.key AS key
       ORDER BY fromUri, toUri, kind, claimer`,
      { uris: named }
    )
    : []

  // DIRECTED, and both directions asked as one statement, because an undirected `-[l:LINK]-` answers
  // the edge from the anchor's side and `fromUri` would then be whichever end was matched rather than
  // the end the writer wrote. The `OR` is what keeps a refused link to a row OUTSIDE the cluster in.
  const linkRows = named.length
    ? await read<Record<string, unknown>>(
      `MATCH (a:Media)-[l:LINK]->(b:Media)
       WHERE a.uri IN $uris OR b.uri IN $uris
       RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.by AS by,
              l.reason AS reason, l.confidence AS confidence, l.version AS version,
              l.evidence AS evidence, l.gates AS gates, l.supports AS supports, l.key AS key
       ORDER BY fromUri, toUri, kind, by`,
      { uris: named }
    )
    : []

  const attachmentRows = await read<Record<string, unknown>>(
    `MATCH (a:Cluster)-[t:ATTACHED_TO]->(b:Cluster)
     WHERE a.id = $id OR b.id = $id
     RETURN a.id AS fromId, b.id AS toId, a.aggUri AS fromUri, b.aggUri AS toUri,
            t.via AS via, t.by AS by, t.supports AS supports
     ORDER BY fromId, toId`,
    { id: clusterId }
  )

  const slotRows = await read<Record<string, unknown>>(
    `MATCH (s:Slot)-[:SLOT_OF]->(c:Cluster {id: $id})
     OPTIONAL MATCH (e:Episode)-[f:FILLS]->(s)
     RETURN s.id AS slotId, s.number AS number, s.episode AS episode, e.uri AS episodeUri,
            e.origin AS origin, f.via AS via, f.by AS by, f.number AS fillNumber,
            f.supports AS supports
     ORDER BY slotId, episodeUri`,
    { id: clusterId }
  )

  // The episode uris the episode-level rows are asked about: what the members HANG, not what reached
  // a slot. A row the trim of 5.4 P5 took off the page has no slot and its pair is the answer to "why
  // is this row not here", so anchoring on the fills alone would drop exactly the interesting case.
  //
  // THE EDGE ITSELF IS CARRIED, not only its far end, and that is what makes a `via: member` fill
  // followable: such a fill's `supports` names the `HAS_EPISODE` it came from, and with the table
  // absent from the bundle every one of them reported "not in this bundle" (237 of 237 fill supports
  // over a recorded page, 2026-09-13), which trains a reader to ignore the one warning that means
  // something. One extra column on a statement this read already issued.
  const episodeSourceRows = named.length
    ? await read<Record<string, unknown>>(
      `MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE m.uri IN $uris
       RETURN m.uri AS fromUri, e.uri AS toUri, h.claimer AS claimer, h.answerSeq AS answerSeq,
              h.key AS key
       ORDER BY fromUri, toUri, claimer`,
      { uris: named }
    )
    : []
  const episodeUris = [...new Set([
    ...episodeSourceRows.map(row => textOf(row.toUri)),
    ...slotRows.map(row => textOf(row.episodeUri)).filter(Boolean),
  ])].sort()

  // AND THE LISTS THAT NAME A SLOT'S EPISODE FROM OUTSIDE THIS CLUSTER. 5.4 P5 lends a container's
  // episode onto a run's members, so a fill can descend to a `HAS_EPISODE` whose media end is not a
  // member here: the statement above, anchored on the members alone, could not carry it and 11 such
  // keys read as "not in this bundle" on a real page (2026-09-13). One more statement, anchored on
  // the episodes instead.
  const lentSourceRows = episodeUris.length
    ? await read<Record<string, unknown>>(
      `MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode)
       WHERE e.uri IN $uris AND NOT m.uri IN $members
       RETURN m.uri AS fromUri, e.uri AS toUri, h.claimer AS claimer, h.answerSeq AS answerSeq,
              h.key AS key
       ORDER BY fromUri, toUri, claimer`,
      { uris: episodeUris, members: named }
    )
    : []

  const episodeLinkRows = episodeUris.length
    ? await read<Record<string, unknown>>(
      `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
       WHERE a.uri IN $uris OR b.uri IN $uris
       RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.by AS by,
              l.reason AS reason, l.fromNumber AS fromNumber, l.toNumber AS toNumber,
              l.evidence AS evidence, l.supports AS supports, l.key AS key
       ORDER BY fromUri, toUri, by`,
      { uris: episodeUris }
    )
    : []

  const episodeClaimRows = episodeUris.length
    ? await read<Record<string, unknown>>(
      `MATCH (a:Episode)-[ec:EPISODE_CLAIMS]->(b:Episode)
       WHERE a.uri IN $uris OR b.uri IN $uris
       RETURN a.uri AS fromUri, b.uri AS toUri, ec.kind AS kind, ec.claimer AS claimer,
              ec.provenance AS provenance, ec.answerSeq AS answerSeq, ec.key AS key
       ORDER BY fromUri, toUri, claimer`,
      { uris: episodeUris }
    )
    : []

  const aggUri = textOf(cluster?.aggUri)

  // EVERY ASK IS READ AND MATCHED IN JS, because no string equality can find the rows.
  //
  // `Ask.clusterId` is written as `toAggregatedUri(cluster.map(m => m.uri))` over the consumer's own
  // member list (`similar-consumer.ts`), which INCLUDES the placeholders; `Cluster.aggUri` is built
  // from the members, which do not. The two therefore differ by exactly the placeholders this
  // bundle draws, and a `k.clusterId = $aggUri` test missed 2 of 2 refused Netflix asks on a page
  // whose panel then printed "nothing was asked of any origin" (measured 2026-09-13). That is a false
  // negative on 7.5's headline question, and it points a reader at the consumer instead of at the
  // guard that refused the link.
  //
  // So the addresses are INTERSECTED instead: an ask belongs to this cluster when its own address
  // shares a uri with the cluster's members or placeholders. The table is tiny (1 to 3 rows a page,
  // one per question the consumer put in this session), so reading it whole costs the same one
  // statement the equality did. The three equalities are kept as the fast path, and `runUri` is
  // matched too, which is what the spec's own `k.runUri IN $members` asks for (`asks.ts` now writes
  // that column).
  const askRows = await read<Record<string, unknown>>(
    `MATCH (k:Ask)
     RETURN k.clusterId AS clusterId, k.runUri AS runUri, k.origin AS origin, k.outcome AS outcome,
            k.reason AS reason, k.seq AS seq
     ORDER BY seq`
  )
  const namedUris = new Set(named)
  const asksForCluster = askRows.filter(row => {
    const rowCluster = textOf(row.clusterId)
    if (rowCluster === clusterId || rowCluster === aggUri || rowCluster === asked) return true
    const runUri = textOf(row.runUri)
    if (runUri && namedUris.has(runUri)) return true
    return addressUris(rowCluster).some(uri => namedUris.has(uri))
  })

  const answerUris = [...new Set([...named, ...episodeUris])]
  const answerRows = answerUris.length
    ? await read<Record<string, unknown>>(
      `MATCH (a:Answer) WHERE a.uri IN $uris
       RETURN a.seq AS seq, a.uri AS uri, a.origin AS origin, a.operation AS operation, a.raw AS raw
       ORDER BY seq`,
      { uris: answerUris }
    )
    : []

  const slots = new Map<string, TraceEpisode>()
  for (const row of slotRows) {
    const slotId = textOf(row.slotId)
    const slot = slots.get(slotId) ?? {
      slotId,
      number: numberOf(row.number),
      title: bestTitle((parseJson(row.episode) as { titles?: unknown } | null)?.titles),
      fills: [],
    }
    const episodeUri = textOf(row.episodeUri)
    // OPTIONAL MATCH: a slot with no fill is a row the page draws with nothing behind it, which is
    // itself a finding, so the slot stays and its `fills` is empty
    if (episodeUri) {
      slot.fills.push({
        episodeUri,
        origin: textOf(row.origin),
        via: textOf(row.via),
        by: textOf(row.by),
        number: numberOf(row.fillNumber),
        supports: stringsOf(row.supports),
      })
    }
    slots.set(slotId, slot)
  }

  const anomalies = parseJson(cluster?.anomalies)

  return {
    asked,
    resolved: {
      clusterId,
      aggUri,
      scope: textOf(cluster?.scope),
      kind: nullableTextOf(cluster?.kind),
      otherClusters,
    },
    members,
    claims: claimRows.map(row => ({
      fromUri: textOf(row.fromUri),
      toUri: textOf(row.toUri),
      kind: textOf(row.kind),
      claimer: textOf(row.claimer),
      provenance: textOf(row.provenance),
      answerSeq: numberOf(row.answerSeq) ?? 0,
      targetScope: nullableTextOf(row.targetScope),
      key: textOf(row.key),
    })),
    links: linkRows.map(row => ({
      fromUri: textOf(row.fromUri),
      toUri: textOf(row.toUri),
      kind: textOf(row.kind),
      status: textOf(row.status),
      by: textOf(row.by),
      reason: textOf(row.reason),
      confidence: numberOf(row.confidence),
      version: numberOf(row.version),
      evidence: nullableTextOf(row.evidence),
      gates: nullableTextOf(row.gates),
      supports: stringsOf(row.supports),
      key: textOf(row.key),
    })),
    attachments: attachmentRows.map(row => ({
      runUri: textOf(row.fromUri) || textOf(row.fromId),
      containerUri: textOf(row.toUri) || textOf(row.toId),
      via: textOf(row.via),
      by: textOf(row.by),
      evidence: null,
      supports: stringsOf(row.supports),
    })),
    episodes: [...slots.values()].sort((a, b) =>
      (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0)
      || (a.number ?? 0) - (b.number ?? 0)
      || a.slotId.localeCompare(b.slotId)),
    episodeLinks: episodeLinkRows.map(row => ({
      fromUri: textOf(row.fromUri),
      toUri: textOf(row.toUri),
      kind: textOf(row.kind),
      status: textOf(row.status),
      by: textOf(row.by),
      reason: textOf(row.reason),
      fromNumber: numberOf(row.fromNumber),
      toNumber: numberOf(row.toNumber),
      evidence: nullableTextOf(row.evidence),
      supports: stringsOf(row.supports),
      key: textOf(row.key),
    })),
    episodeClaims: episodeClaimRows.map(row => ({
      fromUri: textOf(row.fromUri),
      toUri: textOf(row.toUri),
      kind: textOf(row.kind),
      claimer: textOf(row.claimer),
      provenance: textOf(row.provenance),
      answerSeq: numberOf(row.answerSeq) ?? 0,
      key: textOf(row.key),
    })),
    episodeSources: [...episodeSourceRows, ...lentSourceRows].map(row => ({
      fromUri: textOf(row.fromUri),
      toUri: textOf(row.toUri),
      claimer: textOf(row.claimer),
      answerSeq: numberOf(row.answerSeq) ?? 0,
      key: textOf(row.key),
    })),
    runLength: {
      value: numberOf(cluster?.runLength),
      from: stringsOf(cluster?.witnessedBy).join(', ') || null,
      tier: numberOf(cluster?.tier) === null ? null : String(numberOf(cluster?.tier)),
      witnesses: numberOf(cluster?.witnesses),
    },
    anomalies: Array.isArray(anomalies)
      ? anomalies
        .filter((entry): entry is { rule?: unknown, detail?: unknown } => entry !== null && typeof entry === 'object')
        .map(entry => ({ rule: textOf(entry.rule), detail: textOf(entry.detail) }))
      : [],
    asks: asksForCluster.map(row => ({
      seq: numberOf(row.seq) ?? 0,
      origin: textOf(row.origin),
      outcome: textOf(row.outcome),
      reason: nullableTextOf(row.reason),
      at: null,
    })),
    answers: answerRows.map(row => ({
      seq: numberOf(row.seq) ?? 0,
      uri: textOf(row.uri),
      origin: textOf(row.origin),
      operation: textOf(row.operation),
      bytes: bytesOf(row.raw),
    })),
    counts,
    cost: cost(),
  }
}

/**
 * One `Answer` in full, by `seq`: the bytes a source returned and the fields the document selected.
 *
 * This is the end of "why is this field this value" (7.5): the aggregate's `provenance` names a
 * member uri and an `answerSeq`, and this turns that number into the row. It is a separate call
 * rather than part of the bundle because a bundle carrying every `raw` is megabytes the panel never
 * renders.
 *
 * `seq` travels as a STRING and is cast in the statement, the rule every typed scalar on this engine
 * follows. Returns null when no row carries that `seq`, which is what a stale provenance looks like.
 */
export const traceAnswer = async (seq: number): Promise<TraceAnswerDetail | null> => {
  if (!graphEnabled()) return null
  if (!Number.isSafeInteger(seq)) return null
  const { query } = await graphReady()
  const { read } = readerOf(query)
  const [row] = await read<Record<string, unknown>>(
    `MATCH (a:Answer) WHERE a.seq = cast($seq AS INT64)
     RETURN a.key AS key, a.seq AS seq, a.uri AS uri, a.origin AS origin, a.kind AS kind,
            a.operation AS operation, a.selection AS selection, a.raw AS raw`,
    { seq: String(seq) }
  )
  if (!row) return null
  return {
    key: textOf(row.key),
    seq: numberOf(row.seq) ?? seq,
    uri: textOf(row.uri),
    origin: textOf(row.origin),
    kind: textOf(row.kind) as AnswerKind,
    operation: textOf(row.operation),
    // an empty `STRING[]` reads back as NULL, so an answer that selected nothing is `[]` here
    selection: stringsOf(row.selection),
    raw: textOf(row.raw),
  }
}
