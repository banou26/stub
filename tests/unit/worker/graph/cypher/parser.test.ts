/**
 * The parser against every statement the app issues, and against the edges of the closed grammar.
 *
 * THE CORPUS IS THE ACCEPTANCE CRITERION. 154 string literals were extracted from the app; 142 of
 * them are statements and the other 12 are not Cypher at all (prose in a key config, the word
 * `create` used as an operation label, the verb list `plugins/runner.ts` scans a statement for).
 * Both counts are asserted, so a statement that silently stopped being checked shows up as
 * arithmetic that no longer adds to 154 rather than as a corpus that quietly shrank.
 *
 * 32 OF THE 142 ARE BUILT FROM TEMPLATE LITERALS, and what is written below is the interpolated
 * form, with every expansion read off the source that builds it: `read.ts`'s `NOT_HIDDEN` and
 * `RESOLVE_COLUMNS`, `ingest.ts`'s `stringListOf` and `FIELD_SEQ`, `writer.ts`'s `expression`,
 * `edgeMatch` and its projections, `direct.ts`'s `claimColumns`, `profile.ts`'s `form`. Where a
 * builder serves several tables (the writer runs one statement per table) the table it is spelled
 * with here is one the spec really names.
 *
 * Every other test states one rule of the grammar. They are written as assertions about the TREE
 * rather than about "it parsed", because a parser that accepts everything and builds the wrong tree
 * passes every smoke test ever written.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'vitest'

import type {
  CreateNodeTable,
  CreateRelTable,
  Expr,
  Pattern,
  Query,
  ReadingClause,
  ReturnClause,
  Statement,
  UpdatingClause,
} from '../../../../../src/worker/graph/cypher/ast'

import { CypherError } from '../../../../../src/worker/graph/cypher/ast'
import { tokenize } from '../../../../../src/worker/graph/cypher/lexer'
import { parse } from '../../../../../src/worker/graph/cypher/parser'

const queryOf = (cypher: string): Query => {
  const parsed = parse(cypher)
  if (parsed.kind !== 'query') throw new Error(`expected a query, parsed a ${parsed.kind}`)
  return parsed
}

const nodeTableOf = (cypher: string): CreateNodeTable => {
  const parsed = parse(cypher)
  if (parsed.kind !== 'createNodeTable') throw new Error(`expected a node table, parsed a ${parsed.kind}`)
  return parsed
}

const relTableOf = (cypher: string): CreateRelTable => {
  const parsed = parse(cypher)
  if (parsed.kind !== 'createRelTable') throw new Error(`expected a rel table, parsed a ${parsed.kind}`)
  return parsed
}

const matchAt = (query: Query, index: number): Extract<ReadingClause, { kind: 'match' }> => {
  const clause = query.reading[index]
  if (clause?.kind !== 'match') throw new Error(`reading clause ${index} is a ${clause?.kind ?? 'nothing'}`)
  return clause
}

const withAt = (query: Query, index: number): Extract<ReadingClause, { kind: 'with' }> => {
  const clause = query.reading[index]
  if (clause?.kind !== 'with') throw new Error(`reading clause ${index} is a ${clause?.kind ?? 'nothing'}`)
  return clause
}

const updateAt = (query: Query, index: number): UpdatingClause => {
  const clause = query.updating[index]
  if (!clause) throw new Error(`there is no updating clause ${index}`)
  return clause
}

const returnOf = (query: Query): ReturnClause => {
  if (!query.returning) throw new Error('the query has no RETURN')
  return query.returning
}

const onlyPattern = (patterns: readonly Pattern[]): Pattern => {
  const [pattern, ...rest] = patterns
  if (!pattern || rest.length) throw new Error(`expected one pattern, got ${patterns.length}`)
  return pattern
}

const messageOf = (run: () => unknown): string => {
  try {
    run()
  } catch (error) {
    if (error instanceof CypherError) return `${error.phase}: ${error.message}`
    return `not a CypherError: ${String(error)}`
  }
  throw new Error('nothing was refused')
}

/** Every statement the app issues, template literals interpolated. See the file header. */
const CORPUS: readonly { file: string, cypher: string }[] = [
  { file: 'seed-origins.ts', cypher: 'UNWIND $rows AS r MERGE (o:Origin {id: r.id}) ON CREATE SET o.raw = r.raw, o.hash = r.hash, o.seq = cast(\'0\' AS INT64)' },
  { file: 'seed-origins.ts', cypher: 'MATCH (o:Origin) RETURN count(o) AS total' },
  { file: 'counts.ts', cypher: 'MATCH (n:Media) RETURN count(n) AS total' },
  { file: 'counts.ts', cypher: 'MATCH ()-[e:LINK]->() RETURN count(e) AS total' },
  { file: 'scheduler.ts', cypher: 'UNWIND $ids AS i MATCH (a:Alias {id: i}) RETURN a.clusterId AS clusterId' },
  { file: 'scheduler.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id' },
  { file: 'scheduler.ts', cypher: 'UNWIND $uris AS u MATCH (e:Episode {uri: u})<-[:HAS_EPISODE]-(m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id' },
  { file: 'scheduler.ts', cypher: 'UNWIND $ids AS i MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: i}) RETURN m.uri AS uri' },
  { file: 'read.ts', cypher: 'MATCH (c:Cluster) WHERE coalesce(c.hidden, false) = false RETURN c.id AS id, c.card AS card' },
  { file: 'read.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN DISTINCT c.id AS id, c.hidden AS hidden, c.hiddenBy AS hiddenBy, c.card AS card' },
  { file: 'read.ts', cypher: 'UNWIND $ids AS hid MATCH (c:Cluster {id: hid}) WHERE coalesce(c.hidden, false) = false RETURN c.id AS id, c.card AS card' },
  { file: 'read.ts', cypher: 'UNWIND $ids AS i MATCH (c:Cluster {id: i}) RETURN c.id AS id, c.hidden AS hidden, c.hiddenBy AS hiddenBy, c.card AS card' },
  { file: 'read.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN DISTINCT c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun, c.key AS key, CASE WHEN c.scope = \'RUN\' THEN 0 ELSE 1 END AS scopeRank ORDER BY scopeRank, key LIMIT 1' },
  { file: 'read.ts', cypher: 'UNWIND $uris AS u MATCH (c:Cluster) WHERE u IN c.published RETURN DISTINCT c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun, c.key AS key, CASE WHEN c.scope = \'RUN\' THEN 0 ELSE 1 END AS scopeRank ORDER BY scopeRank, key LIMIT 1' },
  { file: 'read.ts', cypher: 'MATCH (x:Alias {id: $id}) MATCH (c:Cluster {id: x.clusterId}) RETURN c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun' },
  { file: 'read.ts', cypher: 'MATCH (c:Cluster {id: $id})<-[:MEMBER_OF]-(:Media)-[cl:CLAIMS]->(t:Media {owned: false}) RETURN DISTINCT t.uri AS uri, t.origin AS origin, cl.provenance AS provenance' },
  { file: 'read.ts', cypher: 'MATCH (c:Cluster {id: $id}) RETURN c.id AS id, c.scope AS scope, c.preferredRun AS preferredRun' },
  { file: 'read.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster {id: $id}) RETURN c.id AS id' },
  { file: 'read.ts', cypher: 'MATCH (c:Cluster {id: $id}) RETURN c.media AS media, c.kind AS kind' },
  { file: 'read.ts', cypher: 'MATCH (c:Cluster {id: $id}) RETURN c.episodes AS episodes' },
  { file: 'read.ts', cypher: 'UNWIND $ids AS i MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: i}) RETURN m.uri AS uri' },
  { file: 'trace.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN DISTINCT c.id AS id, c.key AS key, CASE WHEN c.scope = \'RUN\' THEN 0 ELSE 1 END AS scopeRank ORDER BY scopeRank, key LIMIT 1' },
  { file: 'trace.ts', cypher: 'UNWIND $uris AS u MATCH (c:Cluster) WHERE u IN c.published RETURN DISTINCT c.id AS id, c.key AS key, CASE WHEN c.scope = \'RUN\' THEN 0 ELSE 1 END AS scopeRank ORDER BY scopeRank, key LIMIT 1' },
  { file: 'trace.ts', cypher: 'MATCH (n:Media) RETURN count(n) AS total' },
  { file: 'trace.ts', cypher: 'MATCH ()-[e:LINK]->() RETURN count(e) AS total' },
  { file: 'trace.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN DISTINCT c.id AS id ORDER BY id' },
  { file: 'trace.ts', cypher: 'MATCH (c:Cluster {id: $id}) RETURN c.aggUri AS aggUri, c.scope AS scope, c.kind AS kind, c.runLength AS runLength, c.runLengthTier AS tier, c.runLengthWitnesses AS witnesses, c.runLengthFrom AS witnessedBy, c.anomalies AS anomalies' },
  { file: 'trace.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $id}) OPTIONAL MATCH (p:MediaProfile {uri: m.uri}) RETURN m.uri AS uri, m.origin AS origin, m.owned AS owned, m.titles AS titles, m.episodeCount AS episodeCount, m.startDate AS startDate, coalesce(p.scope, m.scope) AS scope, p.countKind AS countKind ORDER BY uri' },
  { file: 'trace.ts', cypher: 'MATCH (c:Cluster {id: $id})<-[:MEMBER_OF]-(:Media)-[:CLAIMS]->(t:Media {owned: false}) WHERE NOT t.uri IN $members RETURN DISTINCT t.uri AS uri, t.origin AS origin ORDER BY uri' },
  { file: 'trace.ts', cypher: 'MATCH (a:Media)-[cl:CLAIMS]->(b:Media) WHERE a.uri IN $uris AND b.uri IN $uris RETURN a.uri AS fromUri, b.uri AS toUri, cl.kind AS kind, cl.claimer AS claimer, cl.provenance AS provenance, cl.answerSeq AS answerSeq, cl.targetScope AS targetScope, cl.key AS key ORDER BY fromUri, toUri, kind, claimer' },
  { file: 'trace.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE a.uri IN $uris OR b.uri IN $uris RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.by AS by, l.reason AS reason, l.confidence AS confidence, l.version AS version, l.evidence AS evidence, l.gates AS gates, l.supports AS supports, l.key AS key ORDER BY fromUri, toUri, kind, by' },
  { file: 'trace.ts', cypher: 'MATCH (a:Cluster)-[t:ATTACHED_TO]->(b:Cluster) WHERE a.id = $id OR b.id = $id RETURN a.id AS fromId, b.id AS toId, a.aggUri AS fromUri, b.aggUri AS toUri, t.via AS via, t.by AS by, t.supports AS supports ORDER BY fromId, toId' },
  { file: 'trace.ts', cypher: 'MATCH (s:Slot)-[:SLOT_OF]->(c:Cluster {id: $id}) OPTIONAL MATCH (e:Episode)-[f:FILLS]->(s) RETURN s.id AS slotId, s.number AS number, s.episode AS episode, e.uri AS episodeUri, e.origin AS origin, f.via AS via, f.by AS by, f.number AS fillNumber, f.supports AS supports ORDER BY slotId, episodeUri' },
  { file: 'trace.ts', cypher: 'MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE m.uri IN $uris RETURN m.uri AS fromUri, e.uri AS toUri, h.claimer AS claimer, h.answerSeq AS answerSeq, h.key AS key ORDER BY fromUri, toUri, claimer' },
  { file: 'trace.ts', cypher: 'MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE e.uri IN $uris AND NOT m.uri IN $members RETURN m.uri AS fromUri, e.uri AS toUri, h.claimer AS claimer, h.answerSeq AS answerSeq, h.key AS key ORDER BY fromUri, toUri, claimer' },
  { file: 'trace.ts', cypher: 'MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode) WHERE a.uri IN $uris OR b.uri IN $uris RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.by AS by, l.reason AS reason, l.fromNumber AS fromNumber, l.toNumber AS toNumber, l.evidence AS evidence, l.supports AS supports, l.key AS key ORDER BY fromUri, toUri, by' },
  { file: 'trace.ts', cypher: 'MATCH (a:Episode)-[ec:EPISODE_CLAIMS]->(b:Episode) WHERE a.uri IN $uris OR b.uri IN $uris RETURN a.uri AS fromUri, b.uri AS toUri, ec.kind AS kind, ec.claimer AS claimer, ec.provenance AS provenance, ec.answerSeq AS answerSeq, ec.key AS key ORDER BY fromUri, toUri, claimer' },
  { file: 'trace.ts', cypher: 'MATCH (k:Ask) RETURN k.clusterId AS clusterId, k.runUri AS runUri, k.origin AS origin, k.outcome AS outcome, k.reason AS reason, k.seq AS seq ORDER BY seq' },
  { file: 'trace.ts', cypher: 'MATCH (a:Answer) WHERE a.uri IN $uris RETURN a.seq AS seq, a.uri AS uri, a.origin AS origin, a.operation AS operation, a.raw AS raw ORDER BY seq' },
  { file: 'trace.ts', cypher: 'MATCH (a:Answer) WHERE a.seq = cast($seq AS INT64) RETURN a.key AS key, a.seq AS seq, a.uri AS uri, a.origin AS origin, a.kind AS kind, a.operation AS operation, a.selection AS selection, a.raw AS raw' },
  { file: 'trace.ts', cypher: 'MATCH (c:Cluster {id: $id}) RETURN c.id AS id' },
  { file: 'trace.ts', cypher: 'MATCH (x:Alias {id: $id}) MATCH (c:Cluster {id: x.clusterId}) RETURN c.id AS id' },
  { file: 'trace.ts', cypher: 'MATCH (m:Media) WHERE m.uri IN $uris RETURN m.uri AS uri LIMIT 1' },
  { file: 'asks.ts', cypher: 'UNWIND $rows AS r CREATE (:Ask {key: r.key, clusterId: r.clusterId, runUri: r.runUri, origin: r.origin, showId: r.showId, questionHash: r.questionHash, outcome: r.outcome, reason: r.reason, answerUri: CASE WHEN r.answerUri = \'\' THEN cast(NULL AS STRING) ELSE r.answerUri END, seq: cast(r.seq AS INT64)})' },
  { file: 'asks.ts', cypher: 'MATCH (k:Ask) RETURN k.key AS key, k.seq AS seq, k.clusterId AS clusterId, k.runUri AS runUri, k.origin AS origin, k.showId AS showId, k.questionHash AS questionHash, k.outcome AS outcome, k.reason AS reason, k.answerUri AS answerUri ORDER BY k.seq' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r CREATE (:Answer {key: r.key, seq: cast(r.seq AS INT64), uri: r.uri, origin: r.origin, kind: r.kind, operation: r.operation, selection: CASE WHEN r.selection = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.selection, $separator) END, raw: r.raw})' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (o:Origin {id: r.id}) ON CREATE SET o.raw = r.raw, o.hash = r.hash, o.seq = cast(r.seq AS INT64) ON MATCH SET o.raw = r.raw, o.hash = r.hash, o.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (m:Media {uri: r.uri}) ON CREATE SET m.origin = r.origin, m.id = r.id, m.owned = false, m.scope = r.scope, m.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (m:Media {uri: r.uri}) ON CREATE SET m.origin = r.origin, m.id = r.id, m.owned = cast(r.owned AS BOOLEAN), m.scope = r.scope, m.raw = r.raw, m.score = cast(r.score AS DOUBLE), m.episodeCount = cast(r.episodeCount AS INT64), m.startDate = r.startDate, m.endDate = r.endDate, m.type = r.type, m.status = r.status, m.season = r.season, m.seasonYear = cast(r.seasonYear AS INT64), m.titles = r.titles, m.categories = CASE WHEN r.categories = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.categories, $separator) END, m.fieldSeq = CASE WHEN r.fieldKeys = \'\' THEN cast(NULL AS MAP(STRING, INT64)) ELSE map(string_split(r.fieldKeys, $separator), cast(string_split(r.fieldSeqs, $separator) AS INT64[])) END, m.hash = r.hash, m.seq = cast(r.seq AS INT64) ON MATCH SET m.origin = r.origin, m.id = r.id, m.owned = cast(r.owned AS BOOLEAN), m.scope = r.scope, m.raw = r.raw, m.score = cast(r.score AS DOUBLE), m.episodeCount = cast(r.episodeCount AS INT64), m.startDate = r.startDate, m.endDate = r.endDate, m.type = r.type, m.status = r.status, m.season = r.season, m.seasonYear = cast(r.seasonYear AS INT64), m.titles = r.titles, m.categories = CASE WHEN r.categories = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.categories, $separator) END, m.fieldSeq = CASE WHEN r.fieldKeys = \'\' THEN cast(NULL AS MAP(STRING, INT64)) ELSE map(string_split(r.fieldKeys, $separator), cast(string_split(r.fieldSeqs, $separator) AS INT64[])) END, m.hash = r.hash, m.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (e:Episode {uri: r.uri}) ON CREATE SET e.origin = r.origin, e.id = r.id, e.mediaUri = r.mediaUri, e.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (e:Episode {uri: r.uri}) ON CREATE SET e.origin = r.origin, e.id = r.id, e.mediaUri = r.mediaUri, e.raw = r.raw, e.episodeNumber = cast(r.episodeNumber AS INT64), e.seasonNumber = cast(r.seasonNumber AS INT64), e.absoluteEpisodeNumber = cast(r.absoluteEpisodeNumber AS INT64), e.releaseDate = r.releaseDate, e.titles = r.titles, e.fieldSeq = CASE WHEN r.fieldKeys = \'\' THEN cast(NULL AS MAP(STRING, INT64)) ELSE map(string_split(r.fieldKeys, $separator), cast(string_split(r.fieldSeqs, $separator) AS INT64[])) END, e.hash = r.hash, e.seq = cast(r.seq AS INT64) ON MATCH SET e.origin = r.origin, e.id = r.id, e.mediaUri = r.mediaUri, e.raw = r.raw, e.episodeNumber = cast(r.episodeNumber AS INT64), e.seasonNumber = cast(r.seasonNumber AS INT64), e.absoluteEpisodeNumber = cast(r.absoluteEpisodeNumber AS INT64), e.releaseDate = r.releaseDate, e.titles = r.titles, e.fieldSeq = CASE WHEN r.fieldKeys = \'\' THEN cast(NULL AS MAP(STRING, INT64)) ELSE map(string_split(r.fieldKeys, $separator), cast(string_split(r.fieldSeqs, $separator) AS INT64[])) END, e.hash = r.hash, e.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS h MATCH (a:Media {uri: h.fromUri}), (b:Media {uri: h.toUri}) WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: h.key}]->(b) } CREATE (a)-[:CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer, targetScope: h.targetScope, node: h.node, hash: h.hash, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS h MATCH (a:Media {uri: h.fromUri})-[c:CLAIMS {key: h.key}]->(b:Media {uri: h.toUri}) SET c.node = h.node, c.hash = h.hash, c.answerSeq = cast(h.answerSeq AS INT64), c.seq = cast(h.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS h MATCH (a:Episode {uri: h.fromUri}), (b:Episode {uri: h.toUri}) WHERE NOT EXISTS { MATCH (a)-[:EPISODE_CLAIMS {key: h.key}]->(b) } CREATE (a)-[:EPISODE_CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer, node: h.node, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS h MATCH (m:Media {uri: h.fromUri}), (e:Episode {uri: h.toUri}) WHERE NOT EXISTS { MATCH (m)-[:HAS_EPISODE {key: h.key}]->(e) } CREATE (m)-[:HAS_EPISODE {key: h.key, claimer: h.claimer, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(e)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MATCH (a:Media {uri: r.fromUri})-[e:RELATED {relation: r.relation, claimer: r.claimer}]->(b:Media {uri: r.toUri}) RETURN a.uri AS fromUri, b.uri AS toUri, e.relation AS relation, e.claimer AS claimer' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MATCH (a:Media {uri: r.fromUri}), (b:Media {uri: r.toUri}) WHERE NOT EXISTS { MATCH (a)-[:RELATED {relation: r.relation, claimer: r.claimer}]->(b) } CREATE (a)-[:RELATED {relation: r.relation, format: r.format, claimer: r.claimer, node: r.node, answerSeq: cast(r.answerSeq AS INT64)}]->(b)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MATCH (a:Answer {key: r.key}), (n:Media {uri: r.uri}) WHERE NOT EXISTS { MATCH (a)-[:ABOUT]->(n) } CREATE (a)-[:ABOUT]->(n)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS r MERGE (m:Media {uri: r.uri}) ON CREATE SET m.origin = r.origin, m.id = r.id, m.owned = false, m.scope = r.scope, m.seq = cast(r.seq AS INT64)' },
  { file: 'ingest.ts', cypher: 'UNWIND $rows AS h MATCH (a:Media {uri: h.fromUri}), (b:Media {uri: h.toUri}) WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: h.key}]->(b) } CREATE (a)-[:CLAIMS {key: h.key, kind: h.kind, provenance: h.provenance, claimer: h.claimer, targetScope: h.targetScope, node: h.node, hash: h.hash, answerSeq: cast(h.answerSeq AS INT64), seq: cast(h.seq AS INT64)}]->(b)' },
  { file: 'ingest.ts', cypher: 'MATCH (m:Media {uri: $runUri})-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(o:Media) WHERE o.scope IS NULL OR o.scope <> \'CONTAINER\' RETURN o.uri AS uri, o.origin AS origin' },
  { file: 'ingest.ts', cypher: 'UNWIND $keys AS k MATCH (a:Answer {key: k}) RETURN a.key AS key' },
  { file: 'ingest.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri, m.raw AS raw, m.hash AS hash, m.owned AS owned, m.fieldSeq AS fieldSeq' },
  { file: 'ingest.ts', cypher: 'UNWIND $uris AS u MATCH (e:Episode {uri: u}) RETURN e.uri AS uri, e.raw AS raw, e.hash AS hash, e.fieldSeq AS fieldSeq' },
  { file: 'ingest.ts', cypher: 'UNWIND $ids AS i MATCH (o:Origin {id: i}) RETURN o.id AS id, o.raw AS raw, o.hash AS hash' },
  { file: 'ingest.ts', cypher: 'UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media) RETURN c.key AS key, c.node AS node, c.hash AS hash, c.answerSeq AS answerSeq' },
  { file: 'ingest.ts', cypher: 'UNWIND $keys AS k MATCH (a:Episode)-[c:EPISODE_CLAIMS {key: k}]->(b:Episode) RETURN c.key AS key' },
  { file: 'ingest.ts', cypher: 'UNWIND $keys AS k MATCH (m:Media)-[h:HAS_EPISODE {key: k}]->(e:Episode) RETURN h.key AS key' },
  { file: 'ingest.ts', cypher: 'UNWIND $keys AS k MATCH (a:Answer {key: k})-[:ABOUT]->() RETURN a.key AS key' },
  { file: 'ingest.ts', cypher: 'MATCH (a:Media)-[c:CLAIMS {key: $key}]->(b:Media) RETURN c.key AS key' },
  { file: 'ingest.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri' },
  { file: 'answers.ts', cypher: 'UNWIND $rows AS r CREATE (:Answer {key: r.key, seq: r.seq, uri: r.uri, origin: r.origin, kind: r.kind, operation: r.operation, selection: CASE WHEN r.selection = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.selection, $separator) END, raw: r.raw})' },
  { file: 'answers.ts', cypher: 'MATCH (a:Answer) RETURN a.key AS key, a.seq AS seq, a.uri AS uri, a.origin AS origin, a.kind AS kind, a.operation AS operation, a.selection AS selection, a.raw AS raw ORDER BY a.seq' },
  { file: 'answers.ts', cypher: 'UNWIND $keys AS k MATCH (a:Answer {key: k}) RETURN a.key AS key' },
  { file: 'plugins/invariants.ts', cypher: 'MATCH (a:Media)-[:LINK {kind: \'INCLUDES\', status: \'active\'}]->(b:Media), (a)-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(b) RETURN count(*) AS total' },
  { file: 'plugins/invariants.ts', cypher: 'MATCH (a:Media)-[:LINK {kind: \'PART_OF\', status: \'active\'}]->(b:Media), (a)-[:MEMBER_OF]->(c:Cluster)<-[:MEMBER_OF]-(b) RETURN count(*) AS total' },
  { file: 'plugins/invariants.ts', cypher: 'MATCH (a:Media)-[:LINK {kind: \'SAME_AS\', status: \'active\'}]-(b:Media), (pa:MediaProfile)-[:PROFILE_OF]->(a), (pb:MediaProfile)-[:PROFILE_OF]->(b) WHERE pa.scope <> pb.scope RETURN count(*) AS total' },
  { file: 'plugins/invariants.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WITH m, count(c) AS n WHERE n > 1 RETURN count(*) AS total' },
  { file: 'plugins/sameness.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = $by AND l.kind = \'SAME_AS\' AND l.status = \'active\' RETURN a.uri AS fromUri, b.uri AS toUri, l.key AS key, l.reason AS reason, l.supports AS supports ORDER BY fromUri, toUri' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.status = \'refused\' AND l.reason = \'disagreeing-ids\' RETURN a.uri AS fromUri, b.uri AS toUri, l.evidence AS evidence ORDER BY fromUri, toUri' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.kind = \'PART_OF\' AND l.status = \'active\' AND l.reason = \'contested\' RETURN b.uri AS target, a.uri AS claimant ORDER BY target, claimant' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (a:Answer)-[:ABOUT]->(m:Media) WHERE a.kind = \'media\' RETURN m.uri AS uri, a.origin AS origin, a.raw AS raw ORDER BY uri, a.seq' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (a:Media)-[c:CLAIMS]->(b:Media) WHERE c.kind = \'SAME_AS\' AND c.provenance <> \'address\' RETURN b.uri AS target, count(DISTINCT a.uri) AS claimants ORDER BY target' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (s:Slot)-[:SLOT_OF]->(c:Cluster) WHERE s.number IS NOT NULL AND c.runLength IS NOT NULL RETURN c.id AS cluster, c.runLength AS runLength, c.runLengthWitnesses AS witnesses, s.number AS number ORDER BY cluster, number' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (p:MediaProfile) WHERE p.countStated IS NOT NULL AND p.countDistinct IS NOT NULL AND p.countStated <> p.countDistinct RETURN p.uri AS uri, p.countStated AS stated, p.countDistinct AS listed ORDER BY uri' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (p:MediaProfile) RETURN p.uri AS uri, p.idParent AS idParent' },
  { file: 'plugins/anomalies.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster {id: $id}) RETURN m.uri AS uri ORDER BY uri' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) MATCH (p:MediaProfile)-[:PROFILE_OF]->(m) RETURN c.id AS id, c.scope AS scope, c.key AS key, c.runLength AS runLength, m.uri AS uri, m.owned AS owned, p.startDay AS startDay, p.folding AS folding, p.countStated AS countStated, p.countDistinct AS countDistinct ORDER BY id, uri' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.status = \'active\' AND l.kind IN [\'PART_OF\', \'INCLUDES\'] RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.reason AS reason, l.key AS linkKey ORDER BY fromUri, toUri, kind, reason' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) MATCH (p:EpisodeProfile)-[:PROFILE_OF]->(e) WHERE h.claimer = m.origin AND p.day IS NOT NULL RETURN m.uri AS uri, p.day AS day ORDER BY uri' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.status = \'active\' AND l.kind = \'SAME_AS\' RETURN a.uri AS fromUri, b.uri AS toUri, l.key AS linkKey, l.evidence AS evidence, l.supports AS supports ORDER BY fromUri, toUri' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.status = \'refused\' AND l.kind = \'SAME_AS\' AND l.reason = \'contained\' RETURN a.uri AS fromUri, b.uri AS toUri ORDER BY fromUri, toUri' },
  { file: 'plugins/containment.ts', cypher: 'MATCH (a:Media)-[c:CLAIMS]->(b:Media) RETURN c.key AS claimKey, c.seq AS seq' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (p:MediaProfile)-[:PROFILE_OF]->(m:Media) RETURN m.uri AS uri, m.origin AS origin, m.id AS id, m.owned AS owned, m.score AS score, m.raw AS raw, m.fieldSeq AS fieldSeq, p.scope AS scope, p.countKind AS countKind, p.countStated AS countStated, p.countDistinct AS countDistinct, p.startDay AS startDay ORDER BY uri' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.status = \'active\' AND l.kind IN [\'PART_OF\', \'INCLUDES\'] RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.reason AS reason, l.by AS by, l.key AS linkKey ORDER BY fromUri, toUri, kind' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE h.claimer = m.origin MATCH (p:EpisodeProfile)-[:PROFILE_OF]->(e) RETURN m.uri AS mediaUri, e.uri AS uri, e.origin AS origin, e.id AS id, e.episodeNumber AS episodeNumber, e.seasonNumber AS seasonNumber, e.raw AS raw, e.fieldSeq AS fieldSeq, p.numberSpace AS numberSpace, h.key AS hasEpisodeKey ORDER BY mediaUri, uri' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode) WHERE l.status = \'active\' RETURN a.uri AS fromUri, b.uri AS toUri, l.toNumber AS toNumber, l.key AS linkKey ORDER BY fromUri, toUri' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode) WHERE l.status = \'active\' AND l.by = $by MATCH (m:Media)-[h:HAS_EPISODE]->(a) MATCH (p:EpisodeProfile)-[:PROFILE_OF]->(a) RETURN m.uri AS mediaUri, a.uri AS uri, a.origin AS origin, a.id AS id, a.episodeNumber AS episodeNumber, a.seasonNumber AS seasonNumber, a.raw AS raw, a.fieldSeq AS fieldSeq, p.numberSpace AS numberSpace, h.key AS hasEpisodeKey, b.uri AS toUri, l.toNumber AS toNumber, l.key AS linkKey ORDER BY uri, toUri, mediaUri' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (a:Media)-[r:RELATED]->(b:Media) RETURN a.uri AS fromUri, b.uri AS toUri, r.relation AS relation, r.format AS format, r.claimer AS claimer, r.node AS node ORDER BY fromUri, toUri, relation' },
  { file: 'plugins/aggregate.ts', cypher: 'UNWIND $uris AS u MATCH (a:Media)-[c:CLAIMS]->(b:Media {uri: u}) RETURN u AS uri, a.uri AS claimant, a.score AS score, c.node AS node ORDER BY uri, claimant' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (c:Cluster) WHERE c.by = $by RETURN c.id AS id, c.key AS key, c.published AS published, c.aliases AS aliases ORDER BY id' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (m:Media)-[e:MEMBER_OF]->(c:Cluster) WHERE e.by = $by RETURN m.uri AS uri, c.id AS id ORDER BY uri' },
  { file: 'plugins/aggregate.ts', cypher: 'MATCH (a:Alias) WHERE a.by = $by RETURN a.id AS id ORDER BY id' },
  { file: 'plugins/writer.ts', cypher: 'MATCH (n:Cluster) WHERE n.by = $by RETURN n.uri AS uri, n.by AS by, n.version AS version, n.published AS published, n.anomalyCount AS anomalyCount' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $keys AS k MATCH (n:Cluster {id: k}) WHERE n.by = $by RETURN n.uri AS uri, n.by AS by, n.version AS version, n.published AS published, n.anomalyCount AS anomalyCount' },
  { file: 'plugins/writer.ts', cypher: 'MATCH (a:Media)-[e:MEMBER_OF]->(b:Cluster) WHERE e.by = $by RETURN a.uri AS __from, b.id AS __to, e.key AS key, e.by AS by, e.version AS version, e.supports AS supports' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $keys AS k MATCH (a:Media {uri: k})-[e:MEMBER_OF]->(b:Cluster) WHERE e.by = $by RETURN a.uri AS __from, b.id AS __to, e.key AS key, e.by AS by, e.version AS version, e.supports AS supports' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $keys AS k MATCH (a:Media)-[e:MEMBER_OF]->(b:Cluster {id: k}) WHERE e.by = $by RETURN a.uri AS __from, b.id AS __to, e.key AS key, e.by AS by, e.version AS version, e.supports AS supports' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MATCH (n:Cluster {id: r.__key}) WHERE n.by = $by DETACH DELETE n' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MERGE (n:Cluster {id: r.__key}) ON CREATE SET n.by = r.by, n.version = cast(r.version AS INT64), n.card = r.card, n.hidden = cast(r.hidden AS BOOLEAN), n.published = CASE WHEN r.published = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.published, $separator) END ON MATCH SET n.by = r.by, n.version = cast(r.version AS INT64), n.card = r.card, n.hidden = cast(r.hidden AS BOOLEAN), n.published = CASE WHEN r.published = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.published, $separator) END' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MATCH (n:Cluster {id: r.__key}) WHERE n.by = $by SET n.by = r.by, n.version = cast(r.version AS INT64), n.card = r.card, n.hidden = cast(r.hidden AS BOOLEAN), n.published = CASE WHEN r.published = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.published, $separator) END' },
  { file: 'plugins/writer.ts', cypher: 'MATCH (a:Media {uri: r.__from})-[e:LINK]->(b:Media {uri: r.__to})' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MATCH (a:Media {uri: r.__from}), (b:Media {uri: r.__to}) WHERE NOT EXISTS { MATCH (a)-[:LINK {key: r.key, by: $by}]->(b) } CREATE (a)-[:LINK {key: r.key, by: r.by, version: cast(r.version AS INT64), status: r.status, supports: CASE WHEN r.supports = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.supports, $separator) END}]->(b)' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MATCH (a:Media {uri: r.__from})-[e:LINK]->(b:Media {uri: r.__to}) WHERE e.by = $by AND e.key = r.key SET e.by = r.by, e.version = cast(r.version AS INT64), e.confidence = cast(r.confidence AS DOUBLE), e.supports = CASE WHEN r.supports = \'\' THEN cast(NULL AS STRING[]) ELSE string_split(r.supports, $separator) END' },
  { file: 'plugins/writer.ts', cypher: 'UNWIND $rows AS r MATCH (a:Media {uri: r.__from})-[e:LINK]->(b:Media {uri: r.__to}) WHERE e.by = $by AND e.key = r.key DELETE e' },
  { file: 'plugins/direct.ts', cypher: 'MATCH (a:Media)-[c:CLAIMS]->(b:Media) MATCH (pa:MediaProfile)-[:PROFILE_OF]->(a), (pb:MediaProfile)-[:PROFILE_OF]->(b) RETURN a.uri AS fromUri, b.uri AS toUri, a.origin AS fromOrigin, b.origin AS toOrigin, c.kind AS kind, c.claimer AS claimer, c.provenance AS provenance, c.key AS claimKey, pa.scope AS fromScope, pb.scope AS toScope, pa.idParent AS fromParent, pb.idParent AS toParent ORDER BY fromUri, toUri, kind, claimer' },
  { file: 'plugins/direct.ts', cypher: 'UNWIND $uris AS u MATCH (a:Media {uri: u})-[c:CLAIMS]->(b:Media) RETURN a.uri AS fromUri, b.uri AS toUri, a.origin AS fromOrigin, b.origin AS toOrigin, c.kind AS kind, c.claimer AS claimer, c.provenance AS provenance, c.key AS claimKey ORDER BY fromUri, toUri, kind, claimer' },
  { file: 'plugins/direct.ts', cypher: 'UNWIND $uris AS u MATCH (p:MediaProfile {uri: u}) RETURN p.uri AS uri, p.scope AS scope, p.idParent AS idParent' },
  { file: 'plugins/direct.ts', cypher: 'MATCH (m:Media) RETURN count(m) AS total' },
  { file: 'plugins/runner.ts', cypher: 'MATCH (n:Media)' },
  { file: 'plugins/runner.ts', cypher: 'MATCH ()-[e:MEMBER_OF]->()' },
  { file: 'plugins/profile.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})<-[:ABOUT]-(a:Answer) RETURN m.uri AS uri, collect(DISTINCT {origin: a.origin, said: json_extract(a.raw, \'scope\')}) AS said' },
  { file: 'plugins/profile.ts', cypher: 'MATCH (m:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE h.claimer = m.origin RETURN m.uri AS uri, count(DISTINCT e.uri) AS ownEpisodes' },
  { file: 'plugins/profile.ts', cypher: 'UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media) RETURN a.uri AS fromUri, b.uri AS toUri' },
  { file: 'plugins/profile.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster) WHERE c.scope = \'RUN\' AND c.runLength IS NOT NULL RETURN c.id AS id, c.runLength AS runLength, c.runLengthFrom AS runLengthFrom ORDER BY id' },
  { file: 'plugins/range.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WHERE c.scope = \'RUN\' RETURN c.id AS id, m.uri AS uri ORDER BY id, uri' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster)<-[:MEMBER_OF]-(o:Media)-[oh:HAS_EPISODE]->(oe:Episode)<-[:PROFILE_OF]-(poe:EpisodeProfile) WHERE c.scope = \'RUN\' AND oh.claimer = o.origin AND oe.origin = o.origin RETURN c.id AS runCluster, o.uri AS memberUri, oe.uri AS uri, oe.origin AS origin, oe.episodeNumber AS number, poe.day AS day, poe.titleKeys AS keys, poe.synopsisKeys AS synopsis, oh.key AS hung ORDER BY runCluster, uri' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster)<-[:MEMBER_OF]-(r:Media)-[l:LINK]-(s:Media)<-[:PROFILE_OF]-(ps:MediaProfile) WHERE c.scope = \'RUN\' AND l.kind = \'PART_OF\' AND l.status = \'active\' AND s.uri <> r.uri AND (l.reason IN [\'count-mismatch\', \'no-length\', \'span\', \'containing\', \'contested\', \'cross-scope\'] OR (l.reason = \'asserted\' AND ps.folding)) MATCH (s)-[h:HAS_EPISODE]->(se:Episode)<-[:PROFILE_OF]-(pse:EpisodeProfile) WHERE h.claimer = s.origin RETURN c.id AS runCluster, r.uri AS memberUri, s.uri AS seasonUri, l.key AS via, coalesce(ps.countDistinct, ps.countStated) AS theirCount, ps.retranslates AS retranslates, se.uri AS uri, se.origin AS origin, se.episodeNumber AS number, pse.day AS day, pse.titleKeys AS keys, pse.synopsisKeys AS synopsis, h.key AS hung ORDER BY runCluster, seasonUri, uri, memberUri, via' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster)<-[:MEMBER_OF]-(m:Media)-[h:HAS_EPISODE]->(e:Episode)<-[:PROFILE_OF]-(pe:EpisodeProfile) WHERE c.scope = \'RUN\' AND h.claimer <> m.origin RETURN c.id AS runCluster, m.uri AS memberUri, h.claimer AS claimer, e.uri AS uri, e.origin AS origin, e.episodeNumber AS number, pe.day AS day, pe.titleKeys AS keys, pe.synopsisKeys AS synopsis, h.key AS hung ORDER BY runCluster, claimer, uri, hung' },
  { file: 'plugins/range.ts', cypher: 'MATCH (a:Episode)-[c:EPISODE_CLAIMS]->(b:Episode) WHERE c.kind = \'SAME_AS\' RETURN a.uri AS fromUri, b.uri AS toUri, c.key AS claimKey, a.episodeNumber AS fromNumber, b.episodeNumber AS toNumber ORDER BY fromUri, toUri, claimKey' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster)<-[:MEMBER_OF]-(m:Media)-[:HAS_EPISODE]->(e:Episode) WHERE c.scope = \'RUN\' RETURN c.id AS clusterId, e.uri AS uri ORDER BY clusterId, uri' },
  { file: 'plugins/range.ts', cypher: 'MATCH (c:Cluster)<-[:MEMBER_OF]-(r:Media)-[l:LINK]-(s:Media)-[h:HAS_EPISODE]->(e:Episode) WHERE c.scope = \'RUN\' AND l.kind = \'PART_OF\' AND l.status = \'active\' AND s.uri <> r.uri AND h.claimer = s.origin RETURN c.id AS clusterId, e.uri AS uri ORDER BY clusterId, uri' },
  { file: 'plugins/guards.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.kind = \'SAME_AS\' AND l.status = \'active\' RETURN a.uri AS fromUri, b.uri AS toUri' },
  { file: 'plugins/guards.ts', cypher: 'UNWIND $uris AS u MATCH (a:Media)-[c:CLAIMS]->(b:Media {uri: u}) WHERE c.kind = \'SAME_AS\' AND c.provenance <> \'address\' RETURN DISTINCT u AS target, a.uri AS claimant, c.claimer AS claimer ORDER BY target, claimant, claimer' },
  { file: 'plugins/guards.ts', cypher: 'UNWIND $uris AS u MATCH (p:MediaProfile {uri: u}), (m:Media {uri: u}) RETURN p.uri AS uri, m.origin AS origin, p.scope AS scope, p.idParent AS idParent, p.folding AS folding, p.countStated AS countStated, p.countDistinct AS countDistinct, p.format AS format, p.showLevelOrigin AS showLevelOrigin, m.status AS status' },
  { file: 'plugins/guards.ts', cypher: 'UNWIND $uris AS u MATCH (m:Media {uri: u})-[:MEMBER_OF]->(c:Cluster) RETURN u AS uri, c.runLength AS runLength' },
  { file: 'plugins/guards.ts', cypher: 'UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media) WHERE c.provenance = \'address\' RETURN DISTINCT c.key AS key' },
  { file: 'plugins/guards.ts', cypher: 'UNWIND $pairs AS p MATCH (a:Media {uri: p.a})-[l:LINK {status: \'active\'}]-(b:Media {uri: p.b}) WHERE l.kind IN [\'PART_OF\', \'INCLUDES\'] RETURN DISTINCT p.a AS a, p.b AS b, l.reason AS reason' },
  { file: 'plugins/title.ts', cypher: 'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) MATCH (p:MediaProfile)-[:PROFILE_OF]->(m) RETURN c.id AS cluster, c.scope AS clusterScope, m.uri AS uri, p.scope AS memberScope, p.dateSubject AS dateSubject, p.titleKeys AS titleKeys, p.year AS year, p.startDay AS startDay, p.format AS format, p.workKind AS workKind, p.seasonOrdinal AS seasonOrdinal, p.partOrdinal AS partOrdinal, p.companion AS companion ORDER BY cluster, uri' },
  { file: 'plugins/title.ts', cypher: 'UNWIND $clusters AS cid MATCH (ca:Cluster {id: cid})<-[:MEMBER_OF]-(a:Media)-[:HAS_KEY {class: \'MAIN\'}]->(t:TitleKey)<-[:HAS_KEY {class: \'MAIN\'}]-(b:Media)-[:MEMBER_OF]->(cb:Cluster) WHERE cb.id <> ca.id MATCH (pa:MediaProfile)-[:PROFILE_OF]->(:Media)-[:MEMBER_OF]->(ca), (pb:MediaProfile)-[:PROFILE_OF]->(:Media)-[:MEMBER_OF]->(cb) WHERE pa.year IS NOT NULL AND pb.year = pa.year AND ((ca.scope = \'CONTAINER\' AND pa.dateSubject = \'container\') OR (ca.scope <> \'CONTAINER\' AND pa.dateSubject = \'run\')) AND ((cb.scope = \'CONTAINER\' AND pb.dateSubject = \'container\') OR (cb.scope <> \'CONTAINER\' AND pb.dateSubject = \'run\')) RETURN DISTINCT ca.id AS fromCluster, cb.id AS toCluster, t.key AS shared, pa.year AS year ORDER BY fromCluster, toCluster, shared' },
  { file: 'plugins/title.ts', cypher: 'MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = $by AND l.kind = \'SAME_AS\' AND l.status = \'active\' RETURN a.uri AS fromUri, b.uri AS toUri, l.reason AS reason, l.confidence AS confidence, l.evidence AS evidence, l.gates AS gates, l.supports AS supports ORDER BY fromUri, toUri' },]

/**
 * The 12 extracted literals that are not statements, kept so the arithmetic below stays checkable:
 * 142 statements plus these is the 154 the extractor found.
 */
const NOT_STATEMENTS: readonly { index: number, file: string, what: string }[] = [
  { index: 0, file: 'src/sources/key-configs.ts', what: 'help text for a key config, which opens with the word Create' },
  { index: 1, file: 'src/sources/key-configs.ts', what: 'help text for a key config, which opens with the word Create' },
  { index: 117, file: 'plugins/writer.ts', what: "the operation label 'create' counted per changed row" },
  { index: 118, file: 'plugins/writer.ts', what: "the operation label 'create' counted per changed row" },
  { index: 119, file: 'plugins/writer.ts', what: "the operation label 'create' counted per changed row" },
  { index: 120, file: 'plugins/writer.ts', what: "the operation label 'create' counted per changed row" },
  { index: 127, file: 'plugins/runner.ts', what: 'one entry of WRITE_VERBS, the list a read-only guard scans for' },
  { index: 128, file: 'plugins/runner.ts', what: 'one entry of WRITE_VERBS, the list a read-only guard scans for' },
  { index: 129, file: 'plugins/runner.ts', what: 'one entry of WRITE_VERBS, the list a read-only guard scans for' },
  { index: 130, file: 'plugins/runner.ts', what: 'one entry of WRITE_VERBS, the list a read-only guard scans for' },
  { index: 134, file: 'plugins/profile.ts', what: "the word 'with' from a sentence, not a clause" },
  { index: 153, file: 'src/party/store.ts', what: "the operation label 'create'" },
]

/** Runs the corpus through the parser and says which entries it refused, with the reason. */
const parseAll = (entries: readonly { file: string, cypher: string }[]) => {
  const trees: Statement[] = []
  const failures: string[] = []
  for (const entry of entries) {
    try {
      trees.push(parse(entry.cypher))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      failures.push(`${entry.file}: ${reason} || ${entry.cypher.slice(0, 90)}`)
    }
  }
  return { trees, failures }
}

describe('the statements the app issues', () => {
  test('the 154 extracted literals are 142 statements and 12 that are not Cypher', () => {
    expect(CORPUS.length).toBe(142)
    expect(NOT_STATEMENTS.length).toBe(12)
    expect(CORPUS.length + NOT_STATEMENTS.length).toBe(154)
  })

  test('every one of the 142 statements parses into a tree', () => {
    const { trees, failures } = parseAll(CORPUS)

    expect(failures).toEqual([])
    expect(trees.length).toBe(142)
    expect(trees.every(tree => tree.kind === 'query' || tree.kind === 'showTables')).toBe(true)
  })

  // the control: without it, a loop that swallowed its own failures would report 142 parsed
  // whatever the parser did
  test('the corpus check reports a statement the parser refuses', () => {
    const broken = { file: 'the control', cypher: 'MATCH (n:Media RETURN n.uri AS uri' }
    const { trees, failures } = parseAll([...CORPUS, broken])

    expect(trees.length).toBe(142)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('the control')
  })

  test('the corpus covers the constructs the grammar names', () => {
    const all = CORPUS.map(entry => entry.cypher).join('\n')

    expect(all).toContain('OPTIONAL MATCH')
    expect(all).toContain('WITH m, count(c) AS n')
    expect(all).toContain('DETACH DELETE')
    expect(all).toContain('NOT EXISTS {')
    expect(all).toContain('<-[:MEMBER_OF]-')
    expect(all).toContain('collect(DISTINCT')
    expect(all).toContain('json_extract(')
    expect(all).toContain('MAP(STRING, INT64)')
    expect(all).toContain('STRING[]')
  })
})

const SCHEMA = readFileSync(new URL('../../../../../src/worker/graph/schema.ts', import.meta.url), 'utf8')

// the DDL lives as string literals rather than as an export this file can import, because importing
// schema.ts pulls in the engine module beside it: what is read here is the source text
const SCHEMA_DDL = [...SCHEMA.matchAll(/(['`])(CREATE (?:NODE|REL) TABLE[\s\S]*?)\1/g)].map(match => match[2]!)

describe('the schema DDL', () => {
  test('schema.ts declares 24 tables and every one of them parses', () => {
    // the extraction is its own control: a regex that matched nothing would report no failures
    expect(SCHEMA_DDL.length).toBe(24)

    const parsed = SCHEMA_DDL.map(statement => parse(statement))
    const nodes = parsed.filter((statement): statement is CreateNodeTable => statement.kind === 'createNodeTable')
    const rels = parsed.filter((statement): statement is CreateRelTable => statement.kind === 'createRelTable')

    expect(nodes.length).toBe(11)
    expect(rels.length).toBe(13)
    expect(nodes.map(table => table.name)).toContain('Media')
    expect(rels.map(table => table.name)).toContain('LINK')
    expect(parsed.every(statement => statement.kind === 'createNodeTable' || statement.kind === 'createRelTable')).toBe(true)
  })

  test('a // comment inside a DDL literal is not read as a column', () => {
    const origin = nodeTableOf(SCHEMA_DDL[0]!)

    expect(origin.name).toBe('Origin')
    expect(origin.ifNotExists).toBe(true)
    // the literal carries `raw JSON,  // the Origin row as the resolver returned it`
    expect(origin.columns.map(column => column.name)).toEqual(['id', 'raw', 'hash', 'seq'])
    expect(origin.columns.map(column => column.type.kind)).toEqual(['STRING', 'JSON', 'STRING', 'INT64'])
    expect(origin.columns[0]!.primaryKey).toBe(true)
    expect(origin.columns[1]!.primaryKey).toBe(false)
  })

  test('a column type carries its element and key types', () => {
    const media = nodeTableOf(SCHEMA_DDL[1]!)
    const categories = media.columns.find(column => column.name === 'categories')
    const fieldSeq = media.columns.find(column => column.name === 'fieldSeq')

    expect(categories?.type).toEqual({ kind: 'LIST', of: { kind: 'STRING' } })
    expect(fieldSeq?.type).toEqual({ kind: 'MAP', key: { kind: 'STRING' }, value: { kind: 'INT64' } })
  })

  test('DEFAULT current_timestamp() is kept as the expression it is', () => {
    const answer = nodeTableOf(SCHEMA_DDL[3]!)
    const at = answer.columns.find(column => column.name === 'at')

    expect(at?.type).toEqual({ kind: 'TIMESTAMP' })
    expect(at?.defaultTo).toEqual({ kind: 'call', name: 'current_timestamp', args: [], distinct: false, star: false })
  })

  test('a rel table keeps every FROM ... TO pair it declares', () => {
    const about = relTableOf(SCHEMA_DDL.find(statement => statement.includes('ABOUT'))!)

    expect(about.name).toBe('ABOUT')
    expect(about.pairs).toEqual([
      { from: 'Answer', to: 'Media' },
      { from: 'Answer', to: 'Episode' },
      { from: 'Answer', to: 'Origin' },
    ])
    expect(about.columns).toEqual([])
  })

  test('a rel table declares its columns beside its pairs', () => {
    const hasKey = relTableOf(SCHEMA_DDL.find(statement => statement.includes('HAS_KEY'))!)

    expect(hasKey.pairs).toEqual([{ from: 'Media', to: 'TitleKey' }])
    expect(hasKey.columns.map(column => column.name)).toEqual(['key', 'by', 'version', 'score', 'language', 'class'])
  })
})

describe('the grammar', () => {
  test('a keyword is only a keyword where the grammar expects one', () => {
    // `key`, `by` and `number` are all columns, and `Slot.number` is the one that reads worst
    const query = queryOf('MATCH (n:Slot) RETURN n.number AS number, n.key AS key, n.by AS by ORDER BY number, by DESC')
    const projection = returnOf(query)

    expect(projection.items.map(item => item.as)).toEqual(['number', 'key', 'by'])
    expect(projection.orderBy).toEqual([
      { value: { kind: 'variable', name: 'number' }, descending: false },
      { value: { kind: 'variable', name: 'by' }, descending: true },
    ])
  })

  test('keywords and function names are case insensitive', () => {
    const lower = queryOf('match (n:Media) where n.owned = TRUE return Count(*) as total')
    const projection = returnOf(lower)

    expect(matchAt(lower, 0).where).toEqual({
      kind: 'compare', op: '=',
      left: { kind: 'property', target: { kind: 'variable', name: 'n' }, name: 'owned' },
      right: { kind: 'literal', value: true },
    })
    expect(projection.items[0]).toEqual({
      value: { kind: 'call', name: 'count', args: [], distinct: false, star: true },
      as: 'total',
    })
  })

  test('a relationship carries the direction it was written with', () => {
    const query = queryOf(
      'MATCH (c:Cluster)<-[:MEMBER_OF]-(r:Media)-[l:LINK]-(s:Media)-[h:HAS_EPISODE]->(e:Episode) RETURN c.id AS id'
    )
    const pattern = onlyPattern(matchAt(query, 0).patterns)

    expect(pattern.start).toEqual({ variable: 'c', label: 'Cluster', properties: [] })
    expect(pattern.steps.map(step => step.rel.direction)).toEqual(['left', 'undirected', 'right'])
    expect(pattern.steps.map(step => step.rel.type)).toEqual(['MEMBER_OF', 'LINK', 'HAS_EPISODE'])
    expect(pattern.steps.map(step => step.rel.variable)).toEqual([undefined, 'l', 'h'])
    expect(pattern.steps.map(step => step.node.variable)).toEqual(['r', 's', 'e'])
  })

  test('a relationship carries the properties written inside its brackets', () => {
    const query = queryOf("MATCH (a:Media)-[:HAS_KEY {class: 'MAIN', by: $by}]->(t:TitleKey) RETURN t.key AS key")
    const [step] = onlyPattern(matchAt(query, 0).patterns).steps

    expect(step?.rel.properties).toEqual([
      { name: 'class', value: { kind: 'literal', value: 'MAIN' } },
      { name: 'by', value: { kind: 'param', name: 'by' } },
    ])
  })

  test('a variable length relationship keeps its bounds and its filter', () => {
    const query = queryOf(
      "MATCH (a:Media {uri: $uri})-[e:LINK*0..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:Media) RETURN DISTINCT b.uri AS uri"
    )
    const [step] = onlyPattern(matchAt(query, 0).patterns).steps

    expect(step?.rel.direction).toBe('undirected')
    expect(step?.rel.range?.min).toBe(0)
    expect(step?.rel.range?.max).toBe(8)
    expect(step?.rel.range?.filter).toEqual({
      kind: 'and',
      left: {
        kind: 'compare', op: '=',
        left: { kind: 'property', target: { kind: 'variable', name: 'r' }, name: 'kind' },
        right: { kind: 'literal', value: 'SAME_AS' },
      },
      right: {
        kind: 'compare', op: '=',
        left: { kind: 'property', target: { kind: 'variable', name: 'r' }, name: 'status' },
        right: { kind: 'literal', value: 'active' },
      },
    })
    expect(returnOf(query).distinct).toBe(true)
  })

  test('a list literal and a list type are told apart by where they sit', () => {
    const query = queryOf(
      "MATCH (a:Answer) WHERE a.kind IN ['media', 'episode'] RETURN cast(a.selection AS STRING[]) AS selection"
    )

    expect(matchAt(query, 0).where).toEqual({
      kind: 'in',
      value: { kind: 'property', target: { kind: 'variable', name: 'a' }, name: 'kind' },
      list: { kind: 'list', items: [{ kind: 'literal', value: 'media' }, { kind: 'literal', value: 'episode' }] },
    })
    expect(returnOf(query).items[0]?.value).toEqual({
      kind: 'cast',
      value: { kind: 'property', target: { kind: 'variable', name: 'a' }, name: 'selection' },
      to: { kind: 'LIST', of: { kind: 'STRING' } },
    })
  })

  test('one statement can hold several MATCH clauses, and one MATCH several patterns', () => {
    const query = queryOf(
      'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) MATCH (pa:MediaProfile)-[:PROFILE_OF]->(m), (pb:MediaProfile)-[:PROFILE_OF]->(c) WHERE pa.year IS NOT NULL RETURN c.id AS id'
    )

    expect(query.reading).toHaveLength(2)
    expect(matchAt(query, 0).patterns).toHaveLength(1)
    expect(matchAt(query, 1).patterns).toHaveLength(2)
    expect(matchAt(query, 1).where).toEqual({
      kind: 'isNull',
      value: { kind: 'property', target: { kind: 'variable', name: 'pa' }, name: 'year' },
      negated: true,
    })
  })

  test('OPTIONAL MATCH is a MATCH that says it is optional', () => {
    const query = queryOf('MATCH (s:Slot) OPTIONAL MATCH (e:Episode)-[f:FILLS]->(s) RETURN s.id AS slotId LIMIT 1')

    expect(matchAt(query, 0).optional).toBe(false)
    expect(matchAt(query, 1).optional).toBe(true)
    expect(returnOf(query).limit).toBe(1)
  })

  test('an un-aliased projection takes its own source text as its name', () => {
    const query = queryOf('MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) WITH m, count(c) AS n WHERE n > 1 RETURN count(*) AS total')
    const items = withAt(query, 1).items

    expect(items.map(item => item.as)).toEqual(['m', 'n'])
    expect(withAt(query, 1).where).toEqual({
      kind: 'compare', op: '>',
      left: { kind: 'variable', name: 'n' },
      right: { kind: 'literal', value: 1 },
    })
  })

  test('UNWIND binds one variable over a parameter', () => {
    const query = queryOf('UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri')

    expect(query.reading[0]).toEqual({ kind: 'unwind', source: { kind: 'param', name: 'uris' }, as: 'u' })
  })

  test('CASE keeps every WHEN beside its ELSE', () => {
    const query = queryOf(
      "MATCH (c:Cluster) RETURN CASE WHEN c.scope = 'RUN' THEN 0 WHEN c.scope = 'CONTAINER' THEN 1 ELSE 2 END AS scopeRank"
    )
    const value = returnOf(query).items[0]?.value

    expect(value?.kind).toBe('case')
    if (value?.kind !== 'case') throw new Error('expected a CASE')
    expect(value.whens.map(entry => entry.then)).toEqual([
      { kind: 'literal', value: 0 },
      { kind: 'literal', value: 1 },
    ])
    expect(value.otherwise).toEqual({ kind: 'literal', value: 2 })
  })

  test('count(*), count(DISTINCT x) and a collected struct are three different calls', () => {
    const query = queryOf(
      'MATCH (m:Media)-[c:CLAIMS]->(b:Media) RETURN count(*) AS total, count(DISTINCT b.uri) AS targets, collect(DISTINCT {kind: c.kind, claimer: c.claimer}) AS claims'
    )
    const values: Expr[] = returnOf(query).items.map(item => item.value)

    expect(values[0]).toEqual({ kind: 'call', name: 'count', args: [], distinct: false, star: true })
    expect(values[1]).toEqual({
      kind: 'call', name: 'count', distinct: true, star: false,
      args: [{ kind: 'property', target: { kind: 'variable', name: 'b' }, name: 'uri' }],
    })
    expect(values[2]).toEqual({
      kind: 'call', name: 'collect', distinct: true, star: false,
      args: [{
        kind: 'struct',
        entries: [
          { name: 'kind', value: { kind: 'property', target: { kind: 'variable', name: 'c' }, name: 'kind' } },
          { name: 'claimer', value: { kind: 'property', target: { kind: 'variable', name: 'c' }, name: 'claimer' } },
        ],
      }],
    })
  })

  test('NOT EXISTS is one pattern predicate rather than a negation wrapped around one', () => {
    const query = queryOf(
      'UNWIND $rows AS h MATCH (a:Media {uri: h.fromUri}), (b:Media {uri: h.toUri}) WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: h.key}]->(b) } CREATE (a)-[:CLAIMS {key: h.key}]->(b)'
    )
    const where = matchAt(query, 1).where

    expect(where?.kind).toBe('exists')
    if (where?.kind !== 'exists') throw new Error('expected an EXISTS')
    expect(where.negated).toBe(true)
    expect(where.where).toBeUndefined()
    expect(onlyPattern(where.pattern).steps[0]?.rel.type).toBe('CLAIMS')
    expect(updateAt(query, 0).kind).toBe('create')
  })

  test('MERGE keeps its ON CREATE and ON MATCH assignments apart', () => {
    const query = queryOf(
      'UNWIND $rows AS r MERGE (m:Media {uri: r.uri}) ON CREATE SET m.origin = r.origin, m.owned = false ON MATCH SET m.owned = m.owned OR r.owned'
    )
    const merge = updateAt(query, 0)

    expect(merge.kind).toBe('merge')
    if (merge.kind !== 'merge') throw new Error('expected a MERGE')
    expect(merge.node).toEqual({
      variable: 'm',
      label: 'Media',
      properties: [{ name: 'uri', value: { kind: 'property', target: { kind: 'variable', name: 'r' }, name: 'uri' } }],
    })
    expect(merge.onCreate.map(assignment => assignment.target)).toEqual([
      { kind: 'property', target: { kind: 'variable', name: 'm' }, name: 'origin' },
      { kind: 'property', target: { kind: 'variable', name: 'm' }, name: 'owned' },
    ])
    expect(merge.onMatch).toHaveLength(1)
    expect(merge.onMatch[0]?.value.kind).toBe('or')
  })

  test('DETACH DELETE says it detaches', () => {
    const query = queryOf('UNWIND $rows AS r MATCH (n:Cluster {id: r.__key}) WHERE n.by = $by DETACH DELETE n')

    expect(updateAt(query, 0)).toEqual({ kind: 'delete', detach: true, targets: [{ kind: 'variable', name: 'n' }] })
  })

  test('CALL show_tables() RETURN * is its own statement', () => {
    expect(parse('CALL show_tables() RETURN *')).toEqual({ kind: 'showTables' })
  })
})

describe('a refusal names what it refused', () => {
  test('a statement outside the grammar is refused at parse with the text it stopped on', () => {
    expect(messageOf(() => parse('MATCH (a:Media)-->(b:Media) RETURN a.uri AS uri')))
      .toMatch(/^parse: expected \[ after -/)
    expect(messageOf(() => parse('MATCH (n:Media RETURN n.uri AS uri'))).toMatch(/^parse: expected \)/)
    expect(messageOf(() => parse("MATCH (n:Media) WHERE n.uri = 'unterminated RETURN n.uri AS uri")))
      .toMatch(/^parse: an unterminated string/)
  })

  test('a construct that parses and is not implemented is refused at bind, naming it', () => {
    expect(messageOf(() => parse('MATCH (n:Media) RETURN n.uri AS uri ORDER BY uri SKIP 5')))
      .toBe('bind: not supported: the SKIP clause')
    expect(messageOf(() => parse('CALL table_info() RETURN *')))
      .toBe('bind: not supported: CALL table_info()')
    expect(messageOf(() => parse('MATCH (n:Media:Episode) RETURN n.uri AS uri')))
      .toBe('bind: not supported: a node pattern with several labels')
    expect(messageOf(() => parse('MATCH (n:Media) RETURN n.seq + 1 AS next')))
      .toBe('bind: not supported: arithmetic (+) in an expression')
    expect(messageOf(() => parse('MATCH (n:Media) RETURN *')))
      .toBe('bind: not supported: RETURN *')
    expect(messageOf(() => parse('COPY Media FROM $rows')))
      .toBe('bind: not supported: the COPY clause')
    expect(messageOf(() => parse('MATCH (n:Media) RETURN n.uri AS uri; MATCH (m:Media) RETURN m.uri AS uri')))
      .toBe('bind: not supported: several statements in one string')
  })

  test('a refusal carries the statement it refused', () => {
    const cypher = 'MERGE (a:Media)-[:LINK]->(b:Media)'
    try {
      parse(cypher)
      throw new Error('nothing was refused')
    } catch (error) {
      expect(error).toBeInstanceOf(CypherError)
      if (!(error instanceof CypherError)) throw error
      expect(error.statement).toBe(cypher)
      expect(error.message).toBe('not supported: MERGE of a relationship pattern')
    }
  })
})

describe('the lexer', () => {
  test('a // comment runs to the end of its line and leaves nothing behind', () => {
    const tokens = tokenize('MATCH (n:Media)   // WHERE n.uri = 1\nRETURN n.uri AS uri')

    expect(tokens.map(token => token.text)).toEqual([
      'MATCH', '(', 'n', ':', 'Media', ')', 'RETURN', 'n', '.', 'uri', 'AS', 'uri', '',
    ])
  })

  test('a .. after a number is a range rather than a decimal point', () => {
    expect(tokenize('*0..8').map(token => `${token.kind}:${token.text}`))
      .toEqual(['symbol:*', 'number:0', 'symbol:..', 'number:8', 'end:'])
    expect(tokenize('1.5').map(token => `${token.kind}:${token.text}`)).toEqual(['number:1.5', 'end:'])
  })

  test('a string keeps its escapes decoded and its source offsets intact', () => {
    const [text] = tokenize("'it\\'s'")

    expect(text?.kind).toBe('string')
    expect(text?.text).toBe("it's")
    expect(text?.start).toBe(0)
    expect(text?.end).toBe(7)
  })

  test('a word carries both its spelling and its upper case', () => {
    const [word] = tokenize('Media')

    expect(word?.text).toBe('Media')
    expect(word?.upper).toBe('MEDIA')
  })
})
