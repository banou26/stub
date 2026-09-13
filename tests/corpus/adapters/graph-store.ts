/**
 * The corpus adapter for the GRAPH store, `src/worker/graph`: the ingest of section 4 and the
 * plugins of section 5, driven through the same seven methods `current-store.ts` answers.
 *
 * It is the acceptance harness for the redesign. The cases are the record's hand-decided answers and
 * neither store gets to change them, so a case that passes here and fails there, or the reverse, is
 * the difference between the two implementations stated in the record's own terms.
 *
 * WHAT IT DOES WITH A CASE. A corpus row is store-shaped, and this store has no store-shaped door: the
 * only way in is an `Answer` (4.1). So each row becomes one media answer carrying its own claims as
 * `handles`, each episode becomes one episode answer, and `ingestAnswers` decomposes them exactly as
 * a live page does. Nothing here writes a source table directly, which is what keeps the adapter from
 * proving a shape the app can never produce.
 *
 * RESET IS A TRUNCATION, NOT A REOPEN. That was forced by the engine this store replaced, and it is
 * kept because it is also the cheaper of the two: on
 * `@ladybugdb/wasm-core` 0.20.4 under node, `closeGraph()` resolves and the `openGraph()` after it
 * NEVER settles (2026-09-12, a 20 s test timeout with the close logged and the open still pending),
 * so an engine is one per process and a case that wanted a fresh database would hang the run. `DETACH
 * DELETE` over the eleven node tables empties every table, the rel tables hanging off them included,
 * and leaves the schema in place: 9 ms on a case-sized graph, and 245 ms on the first call of a
 * process, which is the engine still warming up rather than the delete.
 *
 * AN ANSWER IS DEDUPED ON ITS KEY BEFORE THE INGEST SEES IT, because the ingest has no dedupe of its
 * own: `answers.ts` does it in the flush window, and a batch reaching `ingestAnswers` with the same
 * answer twice dies with "Found duplicated primary key value" and takes every other answer in the
 * batch with it (measured 2026-09-12 on `the-live-mushoku-s1-s3-weld`, which states `cr:G24H1N3MP`
 * four times). Any caller that bypasses the log owes the same dedupe.
 *
 * THE PLUGIN STATE IS RESET WITH IT. `runPlugins` keeps each plugin's last output in the module
 * (`resetPassState`), and `plugin:aggregate` carries its cluster ids from exactly that (5.4 P5), so a
 * case that reused it would inherit the previous case's ids and aliases.
 */
import type { CorpusStore } from '../run'
import type { AnswerKind, AnswerRow } from '../../../src/worker/graph/answers'
import type { CorpusClaim, CorpusEpisode, CorpusIncludes, CorpusMedia } from '../types'

import { contentHash } from '../../../src/worker/graph/hash'
import { ingestAnswers } from '../../../src/worker/graph/ingest'
import { GRAPH_NODE_TABLES, graphReady } from '../../../src/worker/graph/schema'
import { DEFAULT_PLUGINS } from '../../../src/worker/graph/scheduler'
import { resetPassState, runPlugins } from '../../../src/worker/graph/plugins/runner'

/**
 * The pass this adapter runs: EXACTLY the live worker's list, imported rather than retyped.
 *
 * A second list of plugins is the drift that lets the harness prove a pass the app never runs, which
 * is what this was until step 2g-c (it named four of the six, so no title match and no episode range
 * existed here while both shipped). `runPlugins` is still driven directly rather than through the
 * scheduler, because the corpus wants one settled pass per `upsert` and no event timing in it; the
 * scheduler's own suite covers the bus path.
 */
export const CORPUS_PLUGINS = DEFAULT_PLUGINS

/** What the last `upsert` cost, so a caller can report the pass rather than guess at it. */
export type UpsertCost = { answers: number, ingestMs: number, passMs: number, iterations: number }

let lastCost: UpsertCost = { answers: 0, ingestMs: 0, passMs: 0, iterations: 0 }

/** The cost of the most recent `upsert`. Reported by the corpus test, asserted by nothing. */
export const lastUpsertCost = (): UpsertCost => lastCost

let seq = 0

const query = async (cypher: string, params?: Record<string, unknown>) => {
  const graph = await graphReady()
  return graph.query(cypher, params)
}

const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))
const idOf = (uri: string): string => uri.slice(uri.indexOf(':') + 1)

const answerOf = async (kind: AnswerKind, value: Record<string, unknown>): Promise<AnswerRow> => {
  const at = ++seq
  return {
    key: await contentHash([kind, value]),
    seq: at,
    uri: String(value.uri),
    origin: String(value.origin),
    kind,
    operation: 'MEDIA',
    selection: Object.keys(value).sort(),
    raw: JSON.stringify(value),
  }
}

/**
 * The node a claim carries: the claimer's own DESCRIPTION of the target (4.3).
 *
 * The case's own row for the target supplies the `scope` stamp when it has one, because that stamp is
 * what the scope ratchet of 5.4 P0 reads off a claim and it is the difference between a season row
 * that is a container and one that is a run. Nothing else of the target travels: the owner's answer
 * describes it, and a nested node that carried its fields would let a claimer contribute fields it
 * never published.
 */
const claimNode = (uri: string, rows: readonly CorpusMedia[]): Record<string, unknown> => {
  const described = rows.find(row => row.uri === uri)
  return {
    uri,
    origin: described?.origin ?? originOf(uri),
    id: described?.id ?? idOf(uri),
    ...described?.scope ? { scope: described.scope } : {},
  }
}

/** One corpus row as its own origin's answer, with the claims that row makes as its handles. */
const mediaAnswer = (row: CorpusMedia, claims: readonly CorpusClaim[], rows: readonly CorpusMedia[]): Record<string, unknown> => ({
  uri: row.uri,
  origin: row.origin,
  id: row.id,
  // an absent scope is RUN, which is the default the schema gives one (./types.ts)
  scope: row.scope ?? 'RUN',
  type: row.type ?? null,
  categories: row.categories ?? [],
  titles: row.titles,
  startDate: row.startDate ?? null,
  episodeCount: row.episodeCount ?? null,
  score: row.score ?? null,
  handles: claims
    .filter(claim => claim.mediaUri === row.uri)
    .map(claim => ({ relation: claim.relation ?? 'SAME_AS', node: claimNode(claim.handleUri, rows) })),
})

const episodeAnswer = (episode: CorpusEpisode): Record<string, unknown> => ({
  uri: episode.uri,
  origin: episode.origin,
  id: episode.id,
  mediaUri: episode.mediaUri,
  episodeNumber: episode.episodeNumber,
  releaseDate: episode.releaseDate ?? null,
  score: episode.score ?? null,
  titles: episode.titles,
})

/**
 * The refusals a guard of 5.2 wrote between two rows of one group: WHY the closure does not hold it.
 *
 * The report's own diagnostic, and deliberately not a `CorpusStore` method: the corpus asks who ended
 * up with whom and never how, so a store that has no notion of a refusal must not be asked for one.
 * A refused `LINK` row is exactly what makes a split readable, because a guard that fired is a
 * decision with a reason while a split with no refusal behind it is a missing plugin or a bug.
 */
export const refusalsWithin = async (uris: readonly string[]): Promise<{ pair: string, reason: string }[]> => {
  if (uris.length < 2) return []
  const inside = new Set(uris)
  const rows = await query(
    `UNWIND $uris AS u MATCH (a:Media {uri: u})-[l:LINK]->(b:Media)
     WHERE l.status = 'refused'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.reason AS reason ORDER BY fromUri, toUri, reason`,
    { uris: [...uris] }
  )
  return rows
    .filter(row => inside.has(String(row.toUri)))
    .map(row => ({ pair: `${String(row.fromUri)} ${String(row.toUri)}`, reason: String(row.reason ?? '') }))
}

/**
 * Whether a SOURCE claimed containment between these two rows, in either direction.
 *
 * The report's second diagnostic, and the same kind of thing `refusalsWithin` is: not a `CorpusStore`
 * method, because the corpus asks who holds whom and never what was claimed. It is what separates a
 * `PART_OF` line the store OWES (a source said so and no edge came of it) from one that waits on a
 * plugin nobody has written: an `ask` claim reaches the graph only once a source ships `containing`
 * (4.4), and a title or a date match is `plugin:title` and `plugin:range`.
 *
 * An `address` claim is excluded, because a pointer asserts nothing about how its uris relate (3.3).
 */
export const containmentClaimed = async (part: string, whole: string): Promise<boolean> => {
  const rows = await query(
    `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
     WHERE c.kind IN ['PART_OF', 'INCLUDES'] AND c.provenance <> 'address'
       AND ((a.uri = $part AND b.uri = $whole) OR (a.uri = $whole AND b.uri = $part))
     RETURN count(c) AS total`,
    { part, whole }
  )
  return Number(rows[0]?.total ?? 0) > 0
}

export const graphStore: CorpusStore = {
  reset: async () => {
    // one statement per node table: an edge cannot outlive its endpoints, so the rel tables of 2.1
    // and 2.2 empty with them, and `DETACH DELETE` is what a node carrying edges needs (2026-09-12)
    for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
    resetPassState()
    seq = 0
    lastCost = { answers: 0, ingestMs: 0, passMs: 0, iterations: 0 }
  },

  upsert: async (rows, claims, episodes) => {
    // DEDUPED ON THE KEY, which is the content hash, exactly as the log dedupes a flush window
    // (`answers.ts`: "two identical drafts would otherwise race for one primary key"). A case may
    // state one row twice, and `the-live-mushoku-s1-s3-weld` states `cr:G24H1N3MP` four times because
    // four season fan-outs each returned it; byte-identical answers are ONE answer, and a batch
    // carrying both kills the whole statement with a duplicated primary key rather than the row.
    const unique = new Map<string, AnswerRow>()
    const add = (answer: AnswerRow) => { if (!unique.has(answer.key)) unique.set(answer.key, answer) }
    for (const row of rows) add(await answerOf('media', mediaAnswer(row, claims, rows)))
    for (const episode of episodes ?? []) add(await answerOf('episode', episodeAnswer(episode)))
    const answers = [...unique.values()]

    const ingestStarted = Date.now()
    await ingestAnswers(answers)
    const ingestMs = Date.now() - ingestStarted

    // the pass runs to its fixed point, which is what the app does before a page is built (5.3)
    const passStarted = Date.now()
    const report = await runPlugins(CORPUS_PLUGINS, { reason: 'manual' })
    lastCost = { answers: answers.length, ingestMs, passMs: Date.now() - passStarted, iterations: report.iterations }
  },

  clusters: async () => {
    const rows = await query(
      'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY id, uri'
    )
    const clusters = new Map<string, string[]>()
    for (const row of rows) clusters.set(String(row.id), [...clusters.get(String(row.id)) ?? [], String(row.uri)])
    return [...clusters.values()]
  },

  /**
   * How many DISTINCT episode numbers this cluster draws, which is one per NUMBERED slot.
   *
   * A slot is the row a page renders (6.4), so this is a count of rows rather than of episodes: three
   * sources over one broadcast episode are one slot. An unnumbered slot (anizip's `S1`) draws no
   * number and is not counted, which is the question the corpus asks.
   */
  episodesOf: async uri => {
    const rows = await query(
      `MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)<-[:SLOT_OF]-(s:Slot)
       WHERE s.number IS NOT NULL
       RETURN count(s) AS total`,
      { uri }
    )
    return Number(rows[0]?.total ?? 0)
  },

  /**
   * The containers of this row's cluster, read off the MATERIALIZED attachment: every member of every
   * cluster this row's cluster is `ATTACHED_TO` (5.4 P2).
   *
   * IT IS A DIFFERENT READ FROM THE ONE THIS ANSWERED UNTIL STEP 2g-c, and the difference is the
   * point. That read walked the `PART_OF` links out of the cluster's members itself and expanded each
   * target's cluster in JS, which is the walk of 3.5 done by hand; this one asks `plugin:containment`
   * what it concluded, which is what a page reads (6.5). Three consequences, all of them intended:
   * - a `PART_OF` whose TARGET has no cluster contributes nothing, where the hand walk fell back to
   *   the bare target uri. A row with no effective scope has no cluster (5.4 P5), so the fallback was
   *   reporting a container the read path could never draw.
   * - a `PART_OF` pointing inside the asking cluster contributes nothing, because `attachmentsOf`
   *   drops `from === to` at the source. The hand walk filtered the same case afterwards, so the
   *   answer is unchanged and the filter now lives in one place.
   * - several `PART_OF` between one pair of clusters are ONE attachment, so the answer no longer
   *   depends on how many members carried the link.
   */
  containersOf: async uri => {
    const rows = await query(
      `MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)-[:ATTACHED_TO]->(whole:Cluster)<-[:MEMBER_OF]-(other:Media)
       RETURN DISTINCT other.uri AS uri ORDER BY uri`,
      { uri }
    )
    return rows.map(row => String(row.uri)).sort()
  },

  /**
   * Every active `INCLUDES` naming this uri, with the range when the edge carries one (3.4).
   *
   * `plugin:range` writes them (5.4 P4) and runs here since step 2g-c, so this is now a real answer
   * rather than the empty one a `pending` case was marked against. The range fields are read off the
   * edge and a row with a NULL `fromStart` is a rangeless containment, which is a different statement
   * from a range and never collapsed into one (3.1).
   *
   * `plugin:direct` writes a REFUSED `INCLUDES` for a claim across two id spaces (`foreign-includes`)
   * and that is not an edge: the status filter is what keeps a refusal from reading as a containment.
   */
  includesOf: async uri => {
    const rows = await query(
      `MATCH (a:Media)-[l:LINK {kind: 'INCLUDES', status: 'active'}]->(b:Media)
       WHERE a.uri = $uri OR b.uri = $uri
       RETURN a.uri AS container, b.uri AS run, l.fromStart AS fromStart, l.fromEnd AS fromEnd,
         l.toStart AS toStart, l.toEnd AS toEnd
       ORDER BY container, run`,
      { uri }
    )
    return rows.map((row): CorpusIncludes => ({
      container: String(row.container),
      run: String(row.run),
      ...row.fromStart === null || row.fromStart === undefined ? {} : {
        range: {
          fromStart: Number(row.fromStart),
          fromEnd: Number(row.fromEnd),
          toStart: Number(row.toStart),
          toEnd: Number(row.toEnd),
        },
      },
    }))
  },

  /**
   * The other rows this store draws as the SAME broadcast episode: the rows sharing its slot, plus
   * any `EPISODE_LINK` partner.
   *
   * A slot is the grouping (5.4 P5), so two rows pair when a member hung both on one number inside one
   * cluster. The `EPISODE_LINK` half is `plugin:range`'s and is what carries a pair ACROSS a cluster
   * boundary, which a renumbering (Crunchyroll's 13..20 for a run's 1..8) is made of; it runs here
   * since step 2g-c.
   *
   * BOTH DIRECTIONS, as two directed statements rather than one undirected pattern. `EPISODE_LINK` is
   * written from the container's row toward the run's (3.4), so the run's own episode is only ever the
   * TO side and an outgoing-only read would answer half the pairs the corpus names. A refused pair is
   * excluded by the status filter, the same way a refused `LINK` is.
   */
  episodePairsOf: async episodeUri => {
    const rows = await query(
      `MATCH (e:Episode {uri: $uri})-[:FILLS]->(s:Slot)<-[:FILLS]-(other:Episode)
       RETURN DISTINCT other.uri AS uri ORDER BY uri`,
      { uri: episodeUri }
    )
    const paired = new Set(rows.map(row => String(row.uri)))
    const outgoing = await query(
      `MATCH (a:Episode {uri: $uri})-[l:EPISODE_LINK {status: 'active'}]->(b:Episode)
       RETURN DISTINCT b.uri AS uri ORDER BY uri`,
      { uri: episodeUri }
    )
    const incoming = await query(
      `MATCH (a:Episode)-[l:EPISODE_LINK {status: 'active'}]->(b:Episode {uri: $uri})
       RETURN DISTINCT a.uri AS uri ORDER BY uri`,
      { uri: episodeUri }
    )
    for (const row of [...outgoing, ...incoming]) paired.add(String(row.uri))
    paired.delete(episodeUri)
    return [...paired].sort()
  },
}
