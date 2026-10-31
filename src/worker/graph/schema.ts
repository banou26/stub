/**
 * The graph's DDL, section 2 of the representation design, as literal Cypher.
 *
 * `GRAPH_SCHEMA` is the statement list in dependency order: every node table before the rel tables
 * that name it, because a rel table declares every `FROM/TO` pair it will ever carry at `CREATE`
 * time (`ALTER` is not among the exercised facts). `createGraphSchema` runs them against an open
 * engine and promises that afterwards every table in the list exists; it refuses nothing and is
 * idempotent, since each statement carries `IF NOT EXISTS`, so a second boot is a no-op rather than
 * an error. It does not seed a row, and the plugin tables of 2.2 are created empty and stay empty
 * until step 2 puts a plugin behind them.
 *
 * TYPES OUTSIDE THE MEASURED FACT LIST. `docs/design-inputs/00-engine-facts.md` lists the column
 * types exercised on 2026-09-11; `BOOLEAN` and `MAP(STRING, INT64)` are not among them, and both are
 * in the design's own DDL. Measured here on 2026-09-12, `@ladybugdb/wasm-core` 0.20.4 under node:
 * both load and both carry a value, so neither is substituted. The whole list is re-measured on
 * every suite run by `tests/unit/worker/graph/schema.test.ts`, which is why no substitution is
 * guessed at.
 *
 * TWO MEASURED SURPRISES, both 2026-09-12 on the same engine, and the ingest has to live with each:
 *
 * - **A JS OBJECT PARAM BINDS AS A `STRUCT`, NEVER AS A `MAP`**, so `SET m.fieldSeq = $fieldSeq`
 *   is a binder error ("has data type STRUCT(titles INT64) but expected MAP(STRING, INT64)"), and
 *   the write spelling is `SET m.fieldSeq = map($keys, $values)`, which works from a plain param and
 *   from an `UNWIND` variable alike. The column reads BACK as an object either way.
 * - **An empty `STRING[]` reads back as NULL**, not as an empty list. Anything reading `selection`
 *   off an `Answer` row has to treat NULL as "the resolver returned no field", which
 *   `exportAnswers` does.
 */
import type { Graph } from './engine'

import { openGraph } from './engine'

/**
 * Section 2.1, the source tables: written by the ingest and by nothing else. `Answer` is the only
 * one step 1a writes; the rest are created here so step 1b has them.
 */
export const SOURCE_NODE_TABLES = [
  `CREATE NODE TABLE IF NOT EXISTS Origin(
    id STRING PRIMARY KEY,
    raw JSON,                  // the Origin row as the resolver returned it
    hash STRING, seq INT64
  )`,
  `CREATE NODE TABLE IF NOT EXISTS Media(
    uri STRING PRIMARY KEY,
    origin STRING,             // 'mal', 'cr', 'nf' ... the ORIGIN, not the module
    id STRING,
    owned BOOLEAN,             // true once the origin's own resolver described this uri; false = placeholder
    scope STRING,              // the OWNER'S last word: RUN, CONTAINER or NULL
    raw JSON,                  // the owner's field-merged row (4.3): a projection of the Answer log
    score DOUBLE,              // verbatim projections of raw, so a WHERE clause can read them
    episodeCount INT64, startDate STRING, endDate STRING, type STRING, status STRING,
    season STRING, seasonYear INT64, titles JSON, categories STRING[],
    fieldSeq MAP(STRING, INT64),   // field name -> Answer.seq that supplied the current value
    hash STRING,               // content hash of the merged row, re-checked by the audit (5.3)
    seq INT64
  )`,
  `CREATE NODE TABLE IF NOT EXISTS Episode(
    uri STRING PRIMARY KEY,
    origin STRING, id STRING,
    mediaUri STRING,           // the uri the source hung it on, as returned
    raw JSON,
    episodeNumber INT64, seasonNumber INT64, absoluteEpisodeNumber INT64,   // the SOURCE'S numbering space
    releaseDate STRING,        // as returned: an instant or a named day
    titles JSON,
    fieldSeq MAP(STRING, INT64),
    hash STRING, seq INT64
  )`,
  `CREATE NODE TABLE IF NOT EXISTS Answer(
    key STRING PRIMARY KEY,    // sha-256 over (origin, kind, uri, canonical JSON of raw)
    seq INT64,                 // ingest sequence, monotonic, assigned when the key is first seen
    uri STRING, origin STRING,
    kind STRING,               // 'media' | 'episode' | 'origin'
    operation STRING,          // the root operation the request carried
    selection STRING[],        // the field names the answer carried, so a partial answer is visible as such
    raw JSON,                  // the resolver's return value, byte for byte, handles and episodes included
    at TIMESTAMP DEFAULT current_timestamp()
  )`,
  `CREATE NODE TABLE IF NOT EXISTS Ask(
    key STRING PRIMARY KEY,    // sha-256 over (clusterId, origin, showId, questionHash, seq)
    runUri STRING, clusterId STRING, origin STRING, showId STRING,
    questionHash STRING,       // the normalised SimilarMediaInput
    outcome STRING,            // 'answered' | 'containing' | 'refused' | 'declined' | 'refused-by-title' | 'refused-other-run'
    reason STRING,             // SimilarOutcome's reason (src/sources/similar.ts:51-52)
    answerUri STRING, seq INT64
  )`,
]

/** Section 2.1's edges: what a source asserted, and nothing a rule concluded. */
export const SOURCE_REL_TABLES = [
  `CREATE REL TABLE IF NOT EXISTS CLAIMS(FROM Media TO Media,
    key STRING,                // sha-256 over (from, to, kind, claimer, provenance)
    kind STRING,               // 'SAME_AS' | 'PART_OF' | 'INCLUDES'
    provenance STRING,         // 'source' | 'ask' | 'seed' | 'address'
    claimer STRING,            // the origin whose resolver returned the handle
    targetScope STRING,        // the scope stamped on the nested node, or NULL
    node JSON,                 // the nested node as returned: the claimer's DESCRIPTION of the target
    hash STRING,               // content hash of node, re-checked by the audit (5.3)
    answerSeq INT64, seq INT64)`,
  `CREATE REL TABLE IF NOT EXISTS HAS_EPISODE(FROM Media TO Episode,
    key STRING,                // sha-256 over (from, to, claimer)
    claimer STRING, answerSeq INT64, seq INT64)`,
  `CREATE REL TABLE IF NOT EXISTS EPISODE_CLAIMS(FROM Episode TO Episode,
    key STRING, kind STRING, provenance STRING, claimer STRING, node JSON, answerSeq INT64, seq INT64)`,
  `CREATE REL TABLE IF NOT EXISTS RELATED(FROM Media TO Media,
    relation STRING, format STRING, claimer STRING, node JSON, answerSeq INT64)`,
  'CREATE REL TABLE IF NOT EXISTS ABOUT(FROM Answer TO Media, FROM Answer TO Episode, FROM Answer TO Origin)',
]

/** Section 2.2, the plugin tables: every row stamped `by`, and every one of them derived (2.4). */
export const PLUGIN_NODE_TABLES = [
  `CREATE NODE TABLE IF NOT EXISTS MediaProfile(
    uri STRING PRIMARY KEY, by STRING, version INT64,
    scope STRING,                  // the EFFECTIVE scope, the ratchet computed as a view (5.4 P0)
    scopeFrom STRING[],            // which answers or claims said CONTAINER
    dateSubject STRING,            // 'run' | 'container': what the row's dates date
    titleKeys JSON,                // [{key, score, language, class}]
    titleKeysFolded JSON,          // the same after NFD with combining marks removed
    seasonOrdinal INT64, partOrdinal INT64, ordinalFrom STRING,   // parsed from RAW titles; NULL = silent
    year INT64, startDay INT64,    // startDay is a UTC day number; NULL when the precision is not a day
    datePrecision STRING,          // 'day' | 'month-or-year' | 'none'
    dateDerivation STRING,         // 'published' | 'coerced' | 'declared'
    format STRING, workKind STRING, companion BOOLEAN,
    countKind STRING,              // 'declared' | 'listLength' | 'none'
    countStated INT64,             // the source's own figure
    countDistinct INT64,           // count(DISTINCT HAS_EPISODE targets) when a list exists, else NULL
    folding BOOLEAN,               // origin folds cours into seasons: cr, nf, jw
    retranslates BOOLEAN,          // origin commissions its own episode titles: nf
    showLevelOrigin BOOLEAN,       // every id of this origin names a container
    idParent STRING                // the same-origin prefix parent of this id, when one exists
  )`,
  `CREATE NODE TABLE IF NOT EXISTS EpisodeProfile(
    uri STRING PRIMARY KEY, by STRING, version INT64,
    day INT64,                     // UTC day of releaseDate (consensus.ts:85-88)
    dayPrecision STRING,           // 'instant' | 'day' | 'none'
    numberSpace STRING,            // 'entry' | 'season' | 'position'
    titleKeys JSON,
    synopsisKeys JSON,             // [{key, score, language}]: the synopsis as content words (5.4 P4 rule 3)
    generic BOOLEAN                // 'Episode 13' carries no identity
  )`,
  'CREATE NODE TABLE IF NOT EXISTS TitleKey(key STRING PRIMARY KEY, by STRING, version INT64)',
  `CREATE NODE TABLE IF NOT EXISTS Cluster(
    id STRING PRIMARY KEY,         // the Media._id the app caches on; minted once, carried across growth
    by STRING, version INT64,
    scope STRING,                  // 'RUN' | 'CONTAINER'
    key STRING,                    // lowest member uri
    published STRING[],            // every routable member uri ever published under this id: append-only
    aggUri STRING,                 // 'ag:(' + sorted routable member uris + ')'
    aliases STRING[],              // ids retired into this cluster
    hidden BOOLEAN,                // the listing hide rule (6.1), written false explicitly, never left unset
    hiddenBy STRING[],             // the run cluster ids the hide rule found
    kind STRING,                   // 'RUN' | 'CONTAINER' | 'FOLD' (6.5): which page is drawn, never the visibility
    runLength INT64, runLengthTier DOUBLE, runLengthWitnesses INT64, runLengthFrom STRING[],
    preferredRun STRING,           // a container cluster's earliest attached run cluster id
    card JSON,                     // the listing's fields (6.1)
    media JSON,                    // the full aggregated Media with provenance (6.3)
    episodes JSON,                 // the ordered episode list, one entry per Slot (6.4)
    anomalies JSON,                // [{rule, detail}]
    anomalyCount INT64             // tested by the trace, because size() over a JSON column is a string length
  )`,
  'CREATE NODE TABLE IF NOT EXISTS Alias(id STRING PRIMARY KEY, clusterId STRING, by STRING, version INT64)',
  `CREATE NODE TABLE IF NOT EXISTS Slot(
    id STRING PRIMARY KEY,         // '<clusterId>#<number>', or '<clusterId>#s:<lowest uri>' for a special
    by STRING, version INT64, clusterId STRING, number INT64,
    episode JSON                   // the aggregated Episode with provenance (6.4)
  )`,
]

/** Section 2.2's edges: plugin-minted, retractable by the stamp they carry. */
export const PLUGIN_REL_TABLES = [
  `CREATE REL TABLE IF NOT EXISTS LINK(FROM Media TO Media,
    key STRING,                    // sha-256 over (from, to, kind, by): the writer's diff key
    kind STRING,                   // 'SAME_AS' | 'PART_OF' | 'INCLUDES'
    by STRING, version INT64,
    status STRING,                 // 'active' | 'refused'   (a refused proposal is kept, with its reason)
    reason STRING, confidence DOUBLE, evidence JSON,
    gates JSON,                    // {format, season, date, companion}: 'passed' | 'refused' | 'silent'
    fromStart INT64, fromEnd INT64, toStart INT64, toEnd INT64,   // INCLUDES only (section 3.4)
    contiguous BOOLEAN, aligned INT64, total INT64,
    supports STRING[])             // keys of the CLAIMS / LINK / EPISODE_LINK edges it was derived from`,
  `CREATE REL TABLE IF NOT EXISTS EPISODE_LINK(FROM Episode TO Episode,
    key STRING,                    // sha-256 over (from, to, by)
    kind STRING,                   // 'SAME_AS'
    by STRING, version INT64, status STRING, reason STRING, confidence DOUBLE, evidence JSON,
    fromNumber INT64, toNumber INT64,   // the two rows' own numbers, so a renumbering is readable off the edge
    supports STRING[])`,
  // Two tables, as one uri can name a media and an episode (Watchmode links a Netflix show by its episodes' ids), which
  // is why `pairOf` in the writer refuses a table of two pairs
  'CREATE REL TABLE IF NOT EXISTS PROFILE_OF(FROM MediaProfile TO Media, by STRING)',
  'CREATE REL TABLE IF NOT EXISTS EPISODE_PROFILE_OF(FROM EpisodeProfile TO Episode, by STRING)',
  'CREATE REL TABLE IF NOT EXISTS HAS_KEY(FROM Media TO TitleKey, key STRING, by STRING, version INT64, score DOUBLE, language STRING, class STRING)',
  'CREATE REL TABLE IF NOT EXISTS MEMBER_OF(FROM Media TO Cluster, by STRING, version INT64, via STRING)',
  'CREATE REL TABLE IF NOT EXISTS ATTACHED_TO(FROM Cluster TO Cluster, by STRING, version INT64, via STRING, supports STRING[])',
  'CREATE REL TABLE IF NOT EXISTS SLOT_OF(FROM Slot TO Cluster, by STRING)',
  'CREATE REL TABLE IF NOT EXISTS FILLS(FROM Episode TO Slot, by STRING, version INT64, via STRING, number INT64, supports STRING[])',
]

/**
 * Every statement, in the one order that loads: the node tables of 2.1 and 2.2 first, then every rel
 * table, since a rel table's endpoints must already exist.
 */
export const GRAPH_SCHEMA = [
  ...SOURCE_NODE_TABLES,
  ...PLUGIN_NODE_TABLES,
  ...SOURCE_REL_TABLES,
  ...PLUGIN_REL_TABLES,
]

/** The table each statement creates, read off the statement itself so the two can never disagree. */
export const tableNameOf = (statement: string): string =>
  statement.match(/CREATE (?:NODE|REL) TABLE IF NOT EXISTS (\w+)/)?.[1] ?? ''

/** Every table name the schema declares, in creation order. */
export const GRAPH_TABLES = GRAPH_SCHEMA.map(tableNameOf)

// Split because counting one takes a different pattern: `MATCH (n:T)` for a node table and
// `MATCH ()-[e:T]->()` for a rel table, and asking the wrong one is a binder error rather than a zero.
export const GRAPH_NODE_TABLES = [...SOURCE_NODE_TABLES, ...PLUGIN_NODE_TABLES].map(tableNameOf)
export const GRAPH_REL_TABLES = [...SOURCE_REL_TABLES, ...PLUGIN_REL_TABLES].map(tableNameOf)

/**
 * Creates every table of section 2 on an open engine, one statement at a time.
 *
 * Promises that every name in `GRAPH_TABLES` exists when it resolves, and that running it twice
 * changes nothing. Refuses to swallow a failure: a statement the engine rejects throws with the
 * statement in the message, the way `openGraph`'s `query` reports any other binder error.
 */
export const createGraphSchema = async ({ query }: Pick<Graph, 'query'>): Promise<void> => {
  for (const statement of GRAPH_SCHEMA) await query(statement)
}

let created: { graph: Graph, done: Promise<void> } | undefined

/**
 * The open engine WITH its schema on it, which is what every reader and writer actually needs.
 *
 * `openGraph()` resolves as soon as the database and the connection are open, which is several
 * awaits before the tables exist, so a caller that races the boot gets "Table Answer does not
 * exist" (measured 2026-09-12 by the browser arm of `scripts/check-graph-engine.mjs`, where the
 * page read the log 300 ms into a 470 ms boot). This is the one way in for anything that touches a
 * table. The DDL runs once per open database, and `closeGraph` is honoured because a new database
 * is a different object.
 */
export const graphReady = async (): Promise<Graph> => {
  const graph = await openGraph()
  if (created?.graph !== graph) created = { graph, done: createGraphSchema(graph) }
  await created.done
  return graph
}
