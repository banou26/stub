/**
 * The plugin contract, section 5.1 of the representation design, as types and nothing else.
 *
 * This file is the whole public surface between core and a plugin: a plugin declares what it reads,
 * what it may write and what must have run before it, and returns a DESIRED set of rows for a
 * declared scope. It never holds the connection, and the type has no member that can name a source
 * table, which is isolation layer 1 of 5.3. The writer (`./writer.ts`) is the only code that turns a
 * `PluginOutput` into statements, and the runner (`./runner.ts`) is the only code that calls `run`.
 *
 * Nothing here executes. Keeping it free of imports from the engine is deliberate: a test, a plugin
 * and the writer all speak these types, and none of them should have to open a database to do it.
 */

/** Every plugin id is prefixed, so `by` on a row says at a glance that a rule wrote it (2.3). */
export type PluginId = `plugin:${string}`

/** The tables of 2.1. The ingest writes them; no plugin may name one, and no type here admits one. */
export type SourceNodeTable = 'Media' | 'Episode' | 'Origin' | 'Answer' | 'Ask'
export type SourceEdgeTable = 'CLAIMS' | 'HAS_EPISODE' | 'EPISODE_CLAIMS' | 'RELATED' | 'ABOUT'

/** The tables of 2.2, every row of which carries `by` and is retractable by that stamp. */
export type PluginNodeTable = 'MediaProfile' | 'EpisodeProfile' | 'TitleKey' | 'Cluster' | 'Alias' | 'Slot'
export type PluginEdgeTable =
  | 'LINK' | 'EPISODE_LINK' | 'PROFILE_OF' | 'EPISODE_PROFILE_OF' | 'HAS_KEY' | 'MEMBER_OF' | 'ATTACHED_TO' | 'SLOT_OF' | 'FILLS'

/** The closed set of 3.1. A plugin may propose no other relation. */
export type LinkKind = 'SAME_AS' | 'PART_OF' | 'INCLUDES'

/** One row as a plugin builds it: plain JS values, which the writer encodes for the column (5.2). */
export type PluginRow = Record<string, unknown>

/**
 * The part of the graph a run recomputed, and therefore the part the writer may retract inside.
 *
 * Everything outside is untouched, which is what makes a plugin that recomputed three clusters
 * harmless to the other thousand. An edge whose endpoints straddle the boundary belongs to the scope
 * that named either endpoint. `full` is the whole table: the first run, a version bump, a re-enable.
 *
 * A cluster scope is expanded to uris by the writer (the members at the START of the pass united with
 * the members at the END), so a link whose endpoint moved between clusters is retractable under
 * either. That expansion lands with `plugin:aggregate` in a later step; today the clusters list is
 * carried and matched against `Cluster.id`, `Alias.clusterId` and `Slot.clusterId` only.
 */
export type Scope =
  | { full: true }
  | { full: false, clusters: string[], uris: string[], pairs: [string, string][] }

/** Whether a guard that was asked had anything to say, and what it said (5.2). */
export type Gate = 'passed' | 'refused' | 'silent'

/** Why the guards refused a proposal (5.2). Written onto the refused row so it can be queried. */
export type Refusal =
  | 'unknown-scope' | 'cross-scope' | 'address-only' | 'disagreeing-ids' | 'contested'
  | 'contained' | 'count-mismatch' | 'no-length' | 'kind-mismatch'
  | 'inverted' | 'self' | 'foreign-includes'

/**
 * One proposed relation between two source rows.
 *
 * A proposal is not an edge: `SAME_AS` passes the guards of 5.2 first, and a refused one is written
 * as its downgrade rather than dropped. `supports` names the keys of the `CLAIMS`, `LINK` and
 * `EPISODE_LINK` edges the proposal was derived from, which is what a trace descends by.
 */
export type LinkProposal = {
  kind: LinkKind
  fromUri: string
  toUri: string
  /**
   * `refused` for a rule the PLUGIN owns and has already decided: `plugin:direct`'s `inverted`,
   * `foreign-includes` and same-origin `disagreeing-ids` (5.4 P1), and `plugin:title`'s
   * `disagreeing-ids` and `ambiguous` between two shows (5.4 P3). The guards are not asked about a
   * row that is already a refusal, and a plugin may not use this to write an ACTIVE row past them.
   * Absent means `active`, which is a proposal and meets every guard of 5.2.
   */
  status?: 'active' | 'refused'
  reason: string
  confidence: number
  evidence?: unknown
  supports: string[]
  gates?: { format: Gate, season: Gate, date: Gate, companion: Gate }
  range?: {
    fromStart: number, fromEnd: number, toStart: number, toEnd: number,
    contiguous: boolean, aligned: number, total: number,
  }
}

/** The episode form of a proposal: one numbering space against another (3.4). */
export type EpisodeLinkProposal = {
  fromUri: string
  toUri: string
  /**
   * `refused` for a pair the PLUGIN weighed and turned down, which is the only way the fourth input
   * of 5.4 P4 can say so: an `EPISODE_CLAIMS` row whose two episodes sit in no common cluster is
   * written `refused` with reason `foreign-episode` rather than dropped, so "why is there no button"
   * is a query. Absent means `active`. No guard is asked: the nine of 5.2 weigh media sameness, and
   * an episode pair is proven by the rule that proposed it.
   */
  status?: 'active' | 'refused'
  reason: string
  confidence: number
  evidence?: unknown
  /**
   * The two rows' own numbers, so a renumbering is readable off the edge. NULL where a side carries
   * none: an asserted claim between two specials is a pair whatever either side is numbered, and
   * `plugin:aggregate` fills a slot from `toNumber` only when it is a positive whole number.
   */
  fromNumber: number | null
  toNumber: number | null
  supports: string[]
}

/**
 * What one run desires, for the scope it names.
 *
 * It is a DESIRED SET, never a list of edits: the writer diffs it against what this plugin wrote last
 * time inside the same scope and applies the difference, so the contract a plugin has to keep is
 * "same graph, same scope, same output" and nothing about ordering or about what it wrote before.
 * A retract is an empty output with `scope.full`.
 */
export type PluginOutput = {
  scope: Scope
  nodes: { table: PluginNodeTable, rows: PluginRow[] }[]
  edges: { table: Exclude<PluginEdgeTable, 'LINK' | 'EPISODE_LINK'>, rows: PluginRow[] }[]
  links: LinkProposal[]
  episodeLinks: EpisodeLinkProposal[]
}

/**
 * The one evaluation path for sameness (5.2), exposed so a plugin can ask before it proposes.
 *
 * The writer asks again, so a plugin that does not ask cannot slip a proposal past a guard. The nine
 * guards are `./guards.ts`; the verdict here is the plugin-facing shape (did it pass, and would a
 * refusal be downgraded), while the writer reads the full one, which carries the downgrade's own
 * direction and evidence.
 */
export type Guards = {
  sameAs: (
    a: string,
    b: string,
    proposal: Pick<LinkProposal, 'reason' | 'supports'>
  ) => Promise<{ ok: true } | { ok: false, reason: Refusal, downgrade: boolean }>
  partOf: (
    part: string,
    whole: string
  ) => Promise<{ ok: true } | { ok: false, reason: 'unknown-scope' | 'self' | 'inverted' }>
}

/**
 * The previous output of this plugin, keyed exactly as the writer keys it.
 *
 * For plugins that carry state across passes, which today is `plugin:aggregate` and its cluster ids
 * (5.3). The key of a node row is its primary key; the key of an edge row is `from`, `to` and the
 * edge's own `key` column joined, which is the writer's diff key.
 */
export type PluginOutputIndex = {
  nodes: Partial<Record<PluginNodeTable, Map<string, PluginRow>>>
  edges: Partial<Record<PluginEdgeTable, Map<string, PluginRow>>>
}

/** What a plugin logged while it ran. Reported by the pass, never thrown. */
export type PluginLogEvent = { level: 'info' | 'warn', rule: string, detail: string, uris?: string[] }

/**
 * What moved, as the subjects a scan looks its rows up BY (5.1).
 *
 * Every list is a key, never a row and never a seq range: the pass takes its subjects from here by
 * `UNWIND $keys AS k MATCH (... {column: k})`, which is the one scan shape 5.3 allows. There is no
 * `seq > since` form, because the two counters a pass sees (the answer log's and the ingest's commit
 * sequence) are independent and no single number bounds both.
 *
 * Where the lists come from: iteration 1 of a `graph:changed` pass is the wake, which is the union of
 * every commit that landed since the last pass started; iteration 2 and later is what the writer
 * APPLIED in the iteration before, mapped through each plugin's `consumes`, so a plugin sees only the
 * tables it reads. `full` is the first run, a version bump, a boot pass and a manual pass, and it
 * means the lists say nothing: the scan reads the whole graph.
 */
export type Delta = {
  /** `Media.uri`. A row created, a projected column that moved, or a new answer written ABOUT it. */
  media: string[]
  /** `Episode.uri`, never a `HAS_EPISODE` key: the profile of an episode is looked up by its uri. */
  episodes: string[]
  /** `CLAIMS.key`, which is what `plugin:direct` anchors its candidate scan on. */
  claims: string[]
  /** The writer's `LINK` and `EPISODE_LINK` diff keys, `from`, `to` and the edge's own key joined. */
  links: string[]
  /** `Cluster.id`, for the plugins that recompute per cluster. */
  clusters: string[]
  /** True when the lists are empty because everything moved, rather than because nothing did. */
  full: boolean
}

/**
 * Everything a plugin is given. It is a READ handle plus the shared scorers, and nothing more.
 *
 * `query` is Cypher over the whole graph, other plugins' output included, and refuses every write
 * verb outside a string literal (5.3 isolation 2). Scans take their subjects from `delta` by key
 * lookup, never by a membership list thousands long.
 */
export type PluginContext = {
  id: PluginId
  query: <Row>(cypher: string, params?: Record<string, unknown>) => Promise<Row[]>
  /**
   * The audit bound this plugin last completed at, and an AUDIT bound only: 0 before its first run.
   *
   * No scan may filter on it. It is `max(seq)` across tables carrying two independent counters (the
   * answer log's and the ingest's commit sequence), so `seq > since` is not comparable to either, and
   * from iteration 2 of a pass it already equals `passStart` and would read nothing. The subjects are
   * in `delta`.
   */
  since: number
  /** The ingest seq this pass started at: the audit bound of 5.3. */
  passStart: number
  /** What moved, in the tables this plugin `consumes`. `full` means the lists say nothing. */
  delta: Delta
  guards: Guards
  /**
   * This plugin's FULL previous output, across passes, even when the last pass scoped itself.
   *
   * The runner retains it by merging each scoped desired set into the one it kept, so a plugin that
   * carries state across passes (`plugin:aggregate` and its cluster ids) sees every row it owns
   * rather than the slice one wake happened to name.
   */
  previous: PluginOutputIndex
  /**
   * The shared scorers, so every plugin scores exactly as the record measured. `titleSimilarity` is
   * `src/sources/utils.ts:253-270`: frizbee, each direction divided by that side's own self score,
   * the weaker direction taken. Never the nyaa matcher's min(self(alias), self(candidate)).
   */
  titleSimilarity: (a: string, b: string) => Promise<number>
  maxPossibleSimilarity: (a: string, b: string) => number
  parseSeasonNumber: (rawTitle: string) => number | undefined
  isOnlySeasonLabel: (rawTitle: string) => boolean
  isGenericEpisodeTitle: (rawTitle: string) => boolean
  log: (event: PluginLogEvent) => void
}

/**
 * One rule, as core sees it.
 *
 * `consumes` is what the scheduler watches: a plugin runs only when one of those tables carries a
 * delta since its last run, and a plugin that writes a table gives every consumer of that table a
 * delta. `produces` is what the writer will accept from it and nothing else: a row naming a table
 * outside this set is refused with the plugin id in the message, which is isolation layer 1 evaluated
 * at runtime. `after` names the plugins that must have run earlier in the same pass; cycles are
 * legal, since the pass iterates to a fixed point (5.3). `version` is bumped when the rule changes,
 * and the writer then retracts every row stamped with an older one and runs a full pass.
 */
export type Plugin = {
  id: PluginId
  consumes: {
    nodes: (SourceNodeTable | PluginNodeTable)[]
    edges: (SourceEdgeTable | PluginEdgeTable)[]
    kinds?: LinkKind[]
  }
  produces: { nodes: PluginNodeTable[], edges: PluginEdgeTable[], kinds?: LinkKind[] }
  after: PluginId[]
  version: number
  run: (ctx: PluginContext) => Promise<PluginOutput>
}

/** An empty output for a scope: what a retract is, and the starting point for building one. */
export const emptyOutput = (scope: Scope): PluginOutput => ({ scope, nodes: [], edges: [], links: [], episodeLinks: [] })
