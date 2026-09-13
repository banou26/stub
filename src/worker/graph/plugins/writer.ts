/**
 * The writer: the one chokepoint every plugin row goes through (section 5.2, first paragraph).
 *
 * `applyPluginOutput` takes a plugin id, a version and a `PluginOutput`, stamps `by` and `version` on
 * every row, computes the DESIRED set per table keyed by primary key or edge key, reads the CURRENT
 * set inside the declared scope (`... WHERE by = $id AND <scope>`), and applies `DELETE current -
 * desired`, `CREATE desired - current` and `SET` on the rows whose properties changed. A retract is
 * an empty desired set with `scope.full`.
 *
 * WHAT IT PROMISES.
 * - Idempotence as a property of the CONTRACT rather than of each plugin's discipline: same graph,
 *   same scope, same output writes nothing the second time, which
 *   `tests/unit/worker/graph/plugins/writer.test.ts` asserts in exactly those words.
 * - Nothing outside the declared scope moves. A plugin that recomputed three uris retracts nothing
 *   about the other thousand, which is what makes an incremental pass safe.
 *
 * WHAT IT REFUSES, both with the plugin id in the message (isolation layer 1 of 5.3, evaluated at
 * runtime rather than only in the type):
 * - any row naming a SOURCE table (2.1), whoever declared it,
 * - any row naming a table outside the plugin's own `produces`.
 *
 * WHAT A PROPOSAL MEETS HERE. Every `LinkProposal` passes the nine guards of 5.2 (`./guards.ts`) in
 * the precedence order of `./sameness.ts`, and a refusal is WRITTEN rather than dropped: the refused
 * row keeps its reason so it can be queried, and six of the nine also write the downgrade, a
 * `PART_OF` from the run or shorter side to the container or longer side. The guards are asked in one
 * batch per apply, so the snapshot every verdict is computed against is the same one.
 *
 * THE ENGINE FACTS THAT SHAPE EVERY STATEMENT, on `@ladybugdb/wasm-core` 0.20.4, the first four from
 * `docs/design-inputs/00-engine-facts.md` and the last two measured here on 2026-09-12:
 * - every typed scalar travels as a STRING and is cast in the statement, because a param binds by JS
 *   type, a column refuses an implicit cast, and `cast(<INT64> AS DOUBLE)` REINTERPRETS the bits,
 * - no list travels as a list, because an `UNWIND` struct field is typed from its first row only, so
 *   a list is joined into a STRING and split in the statement,
 * - a `MAP` column refuses an object param and is written `map($keys, $values)` over two joined lists,
 * - an empty `STRING[]` reads BACK as NULL, so the comparison normalizes an empty list to null,
 * - an EMPTY `UNWIND` list dies at runtime with "Trying to create a vector with ANY type", so no
 *   statement here runs with no rows,
 * - deleting a node that still carries an edge fails with "has connected edges in table PROFILE_OF
 *   ... try DETACH DELETE", so a node delete is a `DETACH DELETE`.
 */
import type {
  Guards, Plugin, PluginEdgeTable, PluginId, PluginNodeTable, PluginOutput, PluginOutputIndex, PluginRow, Scope,
} from './contract'
import type { GuardsFactory } from './guards'
import type { DesiredLink } from './sameness'

import { emptyOutput } from './contract'
import { sha256Hex } from '../hash'
import {
  graphReady, PLUGIN_NODE_TABLES, PLUGIN_REL_TABLES, SOURCE_NODE_TABLES, SOURCE_REL_TABLES, tableNameOf,
} from '../schema'
import { prepareGuards, invalidateComponents } from './guards'
import {
  isRefusedProposal, mergeDesired, orderLinkProposals, readStickyLinks, rowsForVerdict, verdictFor,
} from './sameness'

/** Every table a plugin may name, and every table it may not, read off the DDL rather than retyped. */
const PLUGIN_TABLES = new Set([...PLUGIN_NODE_TABLES, ...PLUGIN_REL_TABLES].map(tableNameOf))
const SOURCE_TABLES = new Set([...SOURCE_NODE_TABLES, ...SOURCE_REL_TABLES].map(tableNameOf))

// The same separator the ingest joins its list columns on, which is the convention `handlePairs`
// already uses (`extractor.ts:116`): a character no uri, field name or title carries. It is passed as
// `$separator` rather than written into a statement so no escaping question arises.
const LIST_SEPARATOR = '\u0000'

// One statement carries the batch, chunked only so a param list stays a size the binder is known to
// take: 2,000 rows through MERGE measured at 434 ms (2026-09-12).
const CHUNK = 2000

type ColumnKind = 'STRING' | 'INT64' | 'DOUBLE' | 'BOOLEAN' | 'JSON' | 'LIST' | 'MAP' | 'OTHER'

type Column = {
  name: string
  kind: ColumnKind
  /** The element type of a LIST, or the value type of a MAP: what the split list is cast to. */
  element: string
  /** The declared type text, for the `cast(NULL AS ...)` spellings and for error messages. */
  type: string
  primary: boolean
}

/**
 * The columns of one `CREATE ... TABLE` statement, parsed out of the DDL itself.
 *
 * Reading the schema rather than repeating it is what keeps this file and `schema.ts` from
 * disagreeing about a column's type, which the engine reports as a binder error on a whole batch
 * rather than on the row that caused it. `//` comments are stripped first, the outermost parentheses
 * are taken, and the split is depth aware so `MAP(STRING, INT64)` stays one column.
 */
export const columnsOf = (statement: string): Column[] => {
  const body = statement.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n')
  const open = body.indexOf('(')
  const close = body.lastIndexOf(')')
  if (open < 0 || close < open) return []
  const entries: string[] = []
  let depth = 0
  let current = ''
  for (const character of body.slice(open + 1, close)) {
    if (character === '(') depth += 1
    if (character === ')') depth -= 1
    if (character === ',' && depth === 0) {
      entries.push(current)
      current = ''
      continue
    }
    current += character
  }
  entries.push(current)

  const columns: Column[] = []
  for (const entry of entries) {
    const text = entry.trim().replace(/\s+/g, ' ')
    // a rel table declares its endpoint pairs in the same comma list as its properties
    if (!text || /^FROM /i.test(text)) continue
    const match = /^(\w+) (.+)$/.exec(text)
    if (!match) continue
    const primary = /PRIMARY KEY/i.test(match[2]!)
    const type = match[2]!.replace(/PRIMARY KEY/i, '').replace(/DEFAULT .*$/i, '').trim()
    const list = type.endsWith('[]')
    const map = /^MAP\(/i.test(type)
    const element = list
      ? type.slice(0, -2)
      : map ? (/^MAP\(\s*[^,]+,\s*(.+?)\s*\)$/i.exec(type)?.[1] ?? 'STRING') : type
    const kind: ColumnKind =
      list ? 'LIST'
      : map ? 'MAP'
      : type === 'STRING' || type === 'INT64' || type === 'DOUBLE' || type === 'BOOLEAN' || type === 'JSON' ? type
      : 'OTHER'
    columns.push({ name: match[1]!, kind, element, type, primary })
  }
  return columns
}

/** The `FROM A TO B` pairs a rel table declares, in the order it declares them. */
export const pairsOf = (statement: string): { from: string, to: string }[] =>
  [...statement.matchAll(/FROM (\w+) TO (\w+)/g)].map(match => ({ from: match[1]!, to: match[2]! }))

/**
 * How a row of each label is ADDRESSED, and what places it in a scope.
 *
 * `key` is the column a key lookup matches on. `space` says which list of a partial scope places the
 * row: a uri space row is placed by `scope.uris`, a cluster space row by `scope.clusters`, and a
 * `none` row cannot be placed at all. `TitleKey` is the `none` case and it is deliberate: one node
 * per key exists across the WHOLE store, so a scope naming three uris says nothing about which keys
 * are still wanted, and a scoped pass therefore never retracts one. A key nothing points at is inert,
 * since every reader arrives through `HAS_KEY`, which is scoped by its `Media` end.
 */
const LABELS: Record<string, { key: string, space: 'uri' | 'cluster' | 'none', place?: string }> = {
  Media: { key: 'uri', space: 'uri' },
  Episode: { key: 'uri', space: 'uri' },
  MediaProfile: { key: 'uri', space: 'uri' },
  EpisodeProfile: { key: 'uri', space: 'uri' },
  TitleKey: { key: 'key', space: 'none' },
  Cluster: { key: 'id', space: 'cluster' },
  Alias: { key: 'id', space: 'cluster', place: 'clusterId' },
  Slot: { key: 'id', space: 'cluster', place: 'clusterId' },
}

type NodeTableSpec = {
  table: PluginNodeTable
  columns: Column[]
  key: string
  place: string
  space: 'uri' | 'cluster' | 'none'
}

type EdgeTableSpec = {
  table: PluginEdgeTable
  columns: Column[]
  pairs: { from: string, to: string }[]
  /** True when the table declares its own `key` column, which then joins the diff key. */
  keyed: boolean
}

const nodeSpecs = new Map<string, NodeTableSpec>()
const edgeSpecs = new Map<string, EdgeTableSpec>()

for (const statement of PLUGIN_NODE_TABLES) {
  const table = tableNameOf(statement) as PluginNodeTable
  const columns = columnsOf(statement)
  const label = LABELS[table]!
  nodeSpecs.set(table, {
    table,
    columns,
    key: columns.find(column => column.primary)?.name ?? label.key,
    place: label.place ?? label.key,
    space: label.space,
  })
}
for (const statement of PLUGIN_REL_TABLES) {
  const table = tableNameOf(statement) as PluginEdgeTable
  const columns = columnsOf(statement)
  edgeSpecs.set(table, {
    table, columns, pairs: pairsOf(statement), keyed: columns.some(column => column.name === 'key'),
  })
}

// ---------------------------------------------------------------------------------------------
// Values: how a JS value travels to a column, and what it will read back as.

const isSafeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)

/**
 * The param value for one column: a STRING for every typed scalar, a joined STRING for a list.
 *
 * A value of the wrong JS type becomes NULL rather than being coerced, the same rule the ingest's
 * projections follow: a coerced value is a fact no plugin stated.
 */
const travel = (column: Column, value: unknown): string | null => {
  if (value === null || value === undefined) return column.kind === 'LIST' ? '' : null
  switch (column.kind) {
    case 'STRING': return typeof value === 'string' ? value : null
    case 'INT64': return isSafeInteger(value) ? String(value) : null
    case 'DOUBLE': return typeof value === 'number' && Number.isFinite(value) ? String(value) : null
    case 'BOOLEAN': return typeof value === 'boolean' ? String(value) : null
    // the writer owns the encoding, so a plugin hands over the JS value rather than serialized text:
    // two runs building the same object produce the same string, which is what the diff compares
    case 'JSON': return JSON.stringify(value)
    case 'LIST': return Array.isArray(value) ? value.map(String).join(LIST_SEPARATOR) : ''
    default: return null
  }
}

/** The two joined params a MAP column travels as: its keys and its values, in one order. */
const travelMap = (value: unknown): { keys: string, values: string } => {
  if (value === null || typeof value !== 'object') return { keys: '', values: '' }
  const entries = Object.entries(value as Record<string, unknown>)
  return {
    keys: entries.map(([key]) => key).join(LIST_SEPARATOR),
    values: entries.map(([, entry]) => String(entry)).join(LIST_SEPARATOR),
  }
}

/**
 * What the column will hold once the value above has landed, so the diff compares like with like.
 *
 * Two engine facts make this more than an identity: an empty `STRING[]` reads back as NULL, and a
 * value the cast refuses lands as NULL.
 */
const canonical = (column: Column, value: unknown): unknown => {
  if (column.kind === 'MAP') return travelMap(value).keys ? value : null
  const travelled = travel(column, value)
  switch (column.kind) {
    case 'STRING': case 'JSON': return travelled
    case 'INT64': case 'DOUBLE': return travelled === null ? null : Number(travelled)
    case 'BOOLEAN': return travelled === null ? null : travelled === 'true'
    case 'LIST': return travelled ? travelled.split(LIST_SEPARATOR) : null
    default: return null
  }
}

/** What a column read back off the engine means, normalized the way `canonical` normalizes. */
const readBack = (column: Column, value: unknown): unknown => {
  if (value === null || value === undefined) return null
  if (column.kind === 'LIST') return Array.isArray(value) && value.length ? value.map(String) : null
  if (column.kind === 'INT64' || column.kind === 'DOUBLE') return Number(value)
  return value
}

const sameValue = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((entry, index) => entry === b[index])
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

/** The right hand side that carries one column's value out of the `UNWIND` variable `r`. */
const expression = (column: Column): string => {
  switch (column.kind) {
    case 'STRING': case 'JSON': return `r.${column.name}`
    case 'INT64': case 'DOUBLE': case 'BOOLEAN': return `cast(r.${column.name} AS ${column.type})`
    case 'LIST':
      return `CASE WHEN r.${column.name} = '' THEN cast(NULL AS ${column.type}) ELSE ${
        column.element === 'STRING'
          ? `string_split(r.${column.name}, $separator)`
          : `cast(string_split(r.${column.name}, $separator) AS ${column.type})`
      } END`
    case 'MAP':
      return `CASE WHEN r.${column.name}__keys = '' THEN cast(NULL AS ${column.type}) ELSE map(string_split(r.${column.name}__keys, $separator), ${
        column.element === 'STRING'
          ? `string_split(r.${column.name}__values, $separator)`
          : `cast(string_split(r.${column.name}__values, $separator) AS ${column.element}[])`
      }) END`
    default: return `r.${column.name}`
  }
}

const assignment = (alias: string, column: Column): string => `${alias}.${column.name} = ${expression(column)}`
const inlineProperty = (column: Column): string => `${column.name}: ${expression(column)}`

// ---------------------------------------------------------------------------------------------
// Scope.

type ExpandedScope = {
  full: boolean
  uris: Set<string>
  clusters: Set<string>
  pairs: Set<string>
  /** Every key a scoped READ looks rows up by: the scope's own uris plus both ends of every pair. */
  endpoints: string[]
}

const pairKey = (from: string, to: string): string => `${from}${LIST_SEPARATOR}${to}`

const expandScope = (scope: Scope): ExpandedScope => {
  if (scope.full) return { full: true, uris: new Set(), clusters: new Set(), pairs: new Set(), endpoints: [] }
  const endpoints = new Set(scope.uris)
  for (const [from, to] of scope.pairs) {
    endpoints.add(from)
    endpoints.add(to)
  }
  return {
    full: false,
    uris: new Set(scope.uris),
    clusters: new Set(scope.clusters),
    pairs: new Set(scope.pairs.map(([from, to]) => pairKey(from, to))),
    endpoints: [...endpoints],
  }
}

const inScopeNode = (spec: NodeTableSpec, row: Record<string, unknown>, scope: ExpandedScope): boolean => {
  if (spec.space === 'none') return false
  const place = String(row[spec.place] ?? '')
  return spec.space === 'uri' ? scope.uris.has(place) : scope.clusters.has(place)
}

/** An edge belongs to the scope that named EITHER endpoint, or that named the pair itself (5.1). */
const inScopeEdge = (row: Record<string, unknown>, scope: ExpandedScope): boolean => {
  const from = String(row.__from)
  const to = String(row.__to)
  if (scope.pairs.has(pairKey(from, to))) return true
  const fromPlace = row.__fromPlace === undefined ? from : String(row.__fromPlace)
  const toPlace = row.__toPlace === undefined ? to : String(row.__toPlace)
  return scope.uris.has(from) || scope.uris.has(to) || scope.clusters.has(fromPlace) || scope.clusters.has(toPlace)
}

// ---------------------------------------------------------------------------------------------
// What a diff came to.

/** One applied change, in the form the pass hashes to detect a cycle (5.3). */
export type WriterChange = { table: string, key: string, operation: 'create' | 'update' | 'delete' }

/** What one `applyPluginOutput` did. An empty `changes` is an idempotent run. */
export type WriterReport = {
  id: PluginId
  version: number
  changes: WriterChange[]
  /** Per table, how many rows were created, updated and deleted. Only tables that moved appear. */
  counts: Record<string, { created: number, updated: number, deleted: number }>
  /**
   * The plugin's full output as the writer keys it, which is what `ctx.previous` hands the next run.
   *
   * Under `scope.full` that is this run's desired set and nothing else. Under a partial scope it is
   * the `previous` index the caller handed in, with the keys this run DELETED dropped and this run's
   * desired rows written over it, so a plugin that recomputed three clusters still sees the other
   * thousand (5.3, and `plugin:aggregate`'s id carry, which mints a fresh id for every cluster
   * missing from it).
   */
  index: PluginOutputIndex
  ms: number
}

type DesiredRow = { key: string, row: PluginRow, from?: string, to?: string }

type Query = (cypher: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>[]>

const chunked = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

// Never with an empty list: an empty `UNWIND` param dies at runtime on this engine (measured
// 2026-09-12), which reads as a corrupt batch rather than as nothing to do.
const runChunked = async (
  query: Query,
  cypher: string,
  rows: Record<string, unknown>[],
  params: Record<string, unknown> = {}
): Promise<void> => {
  for (const chunk of chunked(rows, CHUNK)) {
    if (!chunk.length) continue
    await query(cypher, { ...params, separator: LIST_SEPARATOR, rows: chunk })
    // THE WRITER'S ONLY WRITE STATEMENT, so this is the one place the guards' component snapshot can
    // go stale. Bumping here is what lets `readComponents` answer every proposal of one batch from a
    // single read instead of re-scanning the graph per proposal (see guards.ts).
    invalidateComponents()
  }
}

/** The param row for one desired row: every column travelled, plus the writer's own key fields. */
const paramsOf = (columns: Column[], desired: DesiredRow): Record<string, unknown> => {
  const params: Record<string, unknown> = { __key: desired.key, __from: desired.from ?? '', __to: desired.to ?? '' }
  for (const column of columns) {
    if (column.kind === 'MAP') {
      const { keys, values } = travelMap(desired.row[column.name])
      params[`${column.name}__keys`] = keys
      params[`${column.name}__values`] = values
      continue
    }
    params[column.name] = travel(column, desired.row[column.name])
  }
  return params
}

// ---------------------------------------------------------------------------------------------
// The guard hook.

/**
 * The nine guards of 5.2 over the open graph, as the writer asks them.
 *
 * The plugin-facing `Guards` of the contract is this object narrowed: a plugin is told whether a
 * proposal passes and whether a refusal downgrades, and the writer reads the full verdict (the
 * downgrade's direction and its `{theirs, ours}`) from the same evaluation.
 */
export const graphGuards = (): Guards => ({
  sameAs: async (a, b, proposal) => {
    const { query } = await graphReady()
    const pass = await prepareGuards(query, [{ fromUri: a, toUri: b, supports: proposal.supports }])
    const verdict = pass.sameAs({ fromUri: a, toUri: b, supports: proposal.supports })
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason, downgrade: Boolean(verdict.downgrade) }
  },
  partOf: async (part, whole) => {
    const { query } = await graphReady()
    const pass = await prepareGuards(query, [{ fromUri: part, toUri: whole, supports: [] }])
    const verdict = pass.partOf(part, whole)
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason }
  },
})

// ---------------------------------------------------------------------------------------------

const refusal = (id: PluginId, table: string, produces: Plugin['produces']): Error => {
  if (SOURCE_TABLES.has(table)) {
    return new Error(`${id} may not write ${table}: a source table is written by the ingest and by nothing else (2.3)`)
  }
  if (!PLUGIN_TABLES.has(table)) return new Error(`${id} may not write ${table}: no such table in the schema of section 2`)
  return new Error(
    `${id} may not write ${table}: it declares produces { nodes: [${produces.nodes.join(', ')}], edges: [${produces.edges.join(', ')}] }`
  )
}

/** The `LINK` key of 2.2: sha-256 over (from, to, kind, by), which is what a trace descends by. */
export const linkKey = (fromUri: string, toUri: string, kind: string, by: string): Promise<string> =>
  sha256Hex([fromUri, toUri, kind, by].join(LIST_SEPARATOR))

/** The `EPISODE_LINK` key of 2.2: sha-256 over (from, to, by). */
export const episodeLinkKey = (fromUri: string, toUri: string, by: string): Promise<string> =>
  sha256Hex([fromUri, toUri, by].join(LIST_SEPARATOR))

/**
 * Apply one plugin's output, and say what changed.
 *
 * `produces` is taken from the PLUGIN rather than from the output, so a row naming a table the plugin
 * never declared is refused even when that table exists. Throws on a refusal and on any statement the
 * engine rejects; a caller that wants a failing plugin to be survivable catches it (the runner does,
 * and keeps the plugin's previous output, 5.3).
 */
export const applyPluginOutput = async (options: {
  id: PluginId
  version: number
  produces: Plugin['produces']
  output: PluginOutput
  /**
   * What this plugin desired LAST time, so a scoped run's report carries its full output rather than
   * the slice it recomputed. Absent means there is none, which is the first run.
   */
  previous?: PluginOutputIndex
  /** How the batch of verdicts is built. The default is the nine guards; a test may pass another. */
  prepare?: GuardsFactory
}): Promise<WriterReport> => {
  const started = Date.now()
  const { id, version, produces, output } = options
  const prepare = options.prepare ?? prepareGuards
  const { query } = await graphReady()
  const scope = expandScope(output.scope)
  const changes: WriterChange[] = []
  const counts: WriterReport['counts'] = {}
  const index: PluginOutputIndex = { nodes: {}, edges: {} }

  const count = (table: string, operation: WriterChange['operation'], key: string) => {
    const entry = counts[table] ?? { created: 0, updated: 0, deleted: 0 }
    if (operation === 'create') entry.created += 1
    if (operation === 'update') entry.updated += 1
    if (operation === 'delete') entry.deleted += 1
    counts[table] = entry
    changes.push({ table, key, operation })
  }

  // DESIRED, per table. Every table the plugin PRODUCES is diffed, including the ones it desires
  // nothing in, because that is what makes a retract a retract rather than a no-op.
  const desiredNodes = new Map<PluginNodeTable, Map<string, DesiredRow>>()
  const desiredEdges = new Map<PluginEdgeTable, Map<string, DesiredRow>>()
  // `produces` itself is checked first: the type has no member for a source table, and a plugin
  // written in JS or cast through an `as` has one anyway, which would otherwise reach the statement
  // builders as an unknown table rather than as a refusal
  for (const table of produces.nodes) {
    if (!nodeSpecs.has(table)) throw refusal(id, table, produces)
    desiredNodes.set(table, new Map())
  }
  for (const table of produces.edges) {
    if (!edgeSpecs.has(table)) throw refusal(id, table, produces)
    desiredEdges.set(table, new Map())
  }

  for (const { table, rows } of output.nodes) {
    const desired = desiredNodes.get(table)
    if (!desired) throw refusal(id, table, produces)
    const spec = nodeSpecs.get(table)!
    for (const row of rows) {
      const key = row[spec.key]
      if (typeof key !== 'string' || !key) throw new Error(`${id}: a ${table} row carries no ${spec.key}`)
      desired.set(key, { key, row: { ...row, by: id, version } })
    }
  }

  for (const { table, rows } of output.edges) {
    const desired = desiredEdges.get(table)
    if (!desired) throw refusal(id, table, produces)
    const spec = edgeSpecs.get(table)!
    for (const row of rows) {
      const from = row.from
      const to = row.to
      if (typeof from !== 'string' || typeof to !== 'string' || !from || !to) {
        throw new Error(`${id}: a ${table} row carries no from and to`)
      }
      // the diff key is the pair plus the table's own `key` when it declares one, so two LINK rows of
      // different kinds between one pair are two rows while a HAS_KEY is one row per pair
      const key = `${from}${LIST_SEPARATOR}${to}${LIST_SEPARATOR}${spec.keyed ? String(row.key ?? '') : ''}`
      desired.set(key, { key, row: { ...row, by: id, version }, from, to })
    }
  }

  // THE PROPOSALS, and the one place the guards are asked (5.2).
  //
  // Every proposal of this output is weighed in ONE batch: the guards read the graph once, and every
  // verdict is computed against that one snapshot, which is what "evaluated against the graph as it
  // stands, never within one pass" means for guard 4. The order is the precedence of 5.2, so two
  // proposals reaching one key are resolved by the rule rather than by the array.
  if (output.links.length && !desiredEdges.has('LINK')) throw refusal(id, 'LINK', produces)
  const ordered = orderLinkProposals(output.links)
  const reproposed = new Set(ordered.map(proposal => `${proposal.fromUri} ${proposal.toUri}`))
  // THE STICKY RULE's other half: the active links this plugin owns that this pass did NOT re-propose,
  // which a scoped run would otherwise leave un-rechecked (`readStickyLinks`, and the 2c hook in it)
  const sticky = output.links.length || !scope.full
    ? await readStickyLinks(query, id, reproposed)
    : []
  const pass = await prepare(query, [
    ...ordered.map(proposal => ({ fromUri: proposal.fromUri, toUri: proposal.toUri, supports: proposal.supports })),
    ...sticky.map(link => ({ fromUri: link.fromUri, toUri: link.toUri, supports: link.supports })),
  ])

  const desiredLinks = new Map<string, DesiredLink>()
  const put = async (row: Omit<DesiredLink, 'key'>) => {
    mergeDesired(desiredLinks, await linkKey(row.fromUri, row.toUri, row.kind, id), row)
  }
  for (const proposal of ordered) {
    // a row the PLUGIN already refused under a rule it owns (5.4 P1) is written as it stands: the
    // guards weigh proposals, and a refusal is not one
    if (isRefusedProposal(proposal)) {
      await put({
        fromUri: proposal.fromUri, toUri: proposal.toUri, kind: proposal.kind, status: 'refused',
        reason: proposal.reason, confidence: proposal.confidence, evidence: proposal.evidence ?? null,
        gates: proposal.gates ?? null, range: proposal.range ?? null, supports: proposal.supports,
      })
      continue
    }
    for (const row of rowsForVerdict({ ...proposal, evidence: proposal.evidence ?? null }, verdictFor(pass, proposal))) {
      await put(row)
    }
  }
  for (const link of sticky) {
    const verdict = pass.sameAs({ fromUri: link.fromUri, toUri: link.toUri, supports: link.supports })
    if (verdict.ok) continue
    // the pair enters the SCOPE as well as the desired set: the diff reads the current row inside the
    // scope, and a flip the read never saw would be a create the create statement refuses (the edge
    // is already there), so the retraction would silently not happen
    scope.pairs.add(pairKey(link.fromUri, link.toUri))
    scope.endpoints.push(link.fromUri, link.toUri)
    for (const row of rowsForVerdict({
      fromUri: link.fromUri, toUri: link.toUri, kind: 'SAME_AS', reason: link.reason,
      confidence: 1, evidence: null, supports: link.supports,
    }, verdict)) {
      await put(row)
    }
  }

  for (const row of desiredLinks.values()) {
    const diffKey = `${row.fromUri}${LIST_SEPARATOR}${row.toUri}${LIST_SEPARATOR}${row.key}`
    desiredEdges.get('LINK')!.set(diffKey, {
      key: diffKey,
      from: row.fromUri,
      to: row.toUri,
      row: {
        key: row.key, kind: row.kind, by: id, version, status: row.status,
        reason: row.reason, confidence: row.confidence,
        evidence: row.evidence ?? null, gates: row.gates ?? null,
        fromStart: row.range?.fromStart ?? null, fromEnd: row.range?.fromEnd ?? null,
        toStart: row.range?.toStart ?? null, toEnd: row.range?.toEnd ?? null,
        contiguous: row.range?.contiguous ?? null, aligned: row.range?.aligned ?? null,
        total: row.range?.total ?? null, supports: row.supports,
      },
    })
  }
  if (output.episodeLinks.length && !desiredEdges.has('EPISODE_LINK')) throw refusal(id, 'EPISODE_LINK', produces)
  for (const proposal of output.episodeLinks) {
    const key = await episodeLinkKey(proposal.fromUri, proposal.toUri, id)
    const diffKey = `${proposal.fromUri}${LIST_SEPARATOR}${proposal.toUri}${LIST_SEPARATOR}${key}`
    desiredEdges.get('EPISODE_LINK')!.set(diffKey, {
      key: diffKey,
      from: proposal.fromUri,
      to: proposal.toUri,
      row: {
        // the proposal's own verdict, the way a `LINK` carries a refusal the plugin already decided:
        // an episode pair asks no guard (the nine of 5.2 weigh media sameness), so a rule that turned
        // a pair down writes the refusal here and the row stays queryable (5.4 P4's fourth input)
        key, kind: 'SAME_AS', by: id, version,
        status: proposal.status === 'refused' ? 'refused' : 'active', reason: proposal.reason,
        confidence: proposal.confidence, evidence: proposal.evidence ?? null,
        fromNumber: proposal.fromNumber, toNumber: proposal.toNumber, supports: proposal.supports,
      },
    })
  }

  // CURRENT, inside the scope. The read is a SUPERSET (an edge is read by either endpoint, and a pair
  // scope is read by both of its uris) and the exact in-scope test runs in JS below, because spelling
  // the pair test in Cypher would need a string concatenation no measured fact records.
  const deleteNodes: { spec: NodeTableSpec, rows: DesiredRow[] }[] = []
  const updateNodes: { spec: NodeTableSpec, rows: DesiredRow[] }[] = []
  const createNodes: { spec: NodeTableSpec, rows: DesiredRow[] }[] = []

  for (const [table, desired] of desiredNodes) {
    const spec = nodeSpecs.get(table)!
    const projection = spec.columns.map(column => `n.${column.name} AS ${column.name}`).join(', ')
    const current = new Map<string, Record<string, unknown>>()
    if (scope.full) {
      for (const row of await query(`MATCH (n:${table}) WHERE n.by = $by RETURN ${projection}`, { by: id })) {
        current.set(String(row[spec.key]), row)
      }
    } else if (spec.space !== 'none') {
      // a key lookup per subject (5.3), never a membership list over a table thousands long
      const keys = spec.space === 'uri' ? scope.endpoints : [...scope.clusters]
      for (const chunk of chunked(keys, CHUNK)) {
        if (!chunk.length) continue
        const rows = await query(
          `UNWIND $keys AS k MATCH (n:${table} {${spec.place}: k}) WHERE n.by = $by RETURN ${projection}`,
          { keys: chunk, by: id }
        )
        for (const row of rows) current.set(String(row[spec.key]), row)
      }
    }

    const toDelete: DesiredRow[] = []
    const toUpdate: DesiredRow[] = []
    const toCreate: DesiredRow[] = []
    for (const [key, row] of current) {
      if (desired.has(key)) continue
      if (!scope.full && !inScopeNode(spec, row, scope)) continue
      toDelete.push({ key, row })
      count(table, 'delete', key)
    }
    for (const [key, row] of desired) {
      const existing = current.get(key)
      if (!existing) {
        toCreate.push(row)
        count(table, 'create', key)
        continue
      }
      const moved = spec.columns.some(column =>
        !sameValue(canonical(column, row.row[column.name]), readBack(column, existing[column.name])))
      if (moved) {
        toUpdate.push(row)
        count(table, 'update', key)
      }
    }
    if (toDelete.length) deleteNodes.push({ spec, rows: toDelete })
    if (toUpdate.length) updateNodes.push({ spec, rows: toUpdate })
    if (toCreate.length) createNodes.push({ spec, rows: toCreate })
    index.nodes[table] = new Map([...desired].map(([key, entry]) => [key, entry.row]))
  }

  const deleteEdges: { spec: EdgeTableSpec, rows: DesiredRow[] }[] = []
  const updateEdges: { spec: EdgeTableSpec, rows: DesiredRow[] }[] = []
  const createEdges: { spec: EdgeTableSpec, rows: DesiredRow[] }[] = []

  for (const [table, desired] of desiredEdges) {
    const spec = edgeSpecs.get(table)!
    const current = new Map<string, Record<string, unknown>>()
    for (const pair of spec.pairs) {
      const from = LABELS[pair.from]!
      const to = LABELS[pair.to]!
      const projection = [
        `a.${from.key} AS __from`,
        `b.${to.key} AS __to`,
        ...from.place ? [`a.${from.place} AS __fromPlace`] : [],
        ...to.place ? [`b.${to.place} AS __toPlace`] : [],
        ...spec.columns.map(column => `e.${column.name} AS ${column.name}`),
      ].join(', ')
      const take = (rows: Record<string, unknown>[]) => {
        for (const row of rows) {
          const key = `${String(row.__from)}${LIST_SEPARATOR}${String(row.__to)}${LIST_SEPARATOR}${spec.keyed ? String(row.key ?? '') : ''}`
          current.set(key, row)
        }
      }
      if (scope.full) {
        take(await query(
          `MATCH (a:${pair.from})-[e:${table}]->(b:${pair.to}) WHERE e.by = $by RETURN ${projection}`,
          { by: id }
        ))
        continue
      }
      // both directions, because an edge belongs to the scope that named EITHER endpoint. An endpoint
      // in no space (`TitleKey`) places nothing, so that direction is not asked: the edge is still
      // read through its other end, which is the one a scope can name.
      for (const chunk of chunked(from.space === 'none' ? [] : from.space === 'uri' ? scope.endpoints : [...scope.clusters], CHUNK)) {
        if (!chunk.length) continue
        take(await query(
          `UNWIND $keys AS k MATCH (a:${pair.from} {${from.place ?? from.key}: k})-[e:${table}]->(b:${pair.to})
           WHERE e.by = $by RETURN ${projection}`,
          { keys: chunk, by: id }
        ))
      }
      for (const chunk of chunked(to.space === 'none' ? [] : to.space === 'uri' ? scope.endpoints : [...scope.clusters], CHUNK)) {
        if (!chunk.length) continue
        take(await query(
          `UNWIND $keys AS k MATCH (a:${pair.from})-[e:${table}]->(b:${pair.to} {${to.place ?? to.key}: k})
           WHERE e.by = $by RETURN ${projection}`,
          { keys: chunk, by: id }
        ))
      }
    }

    const toDelete: DesiredRow[] = []
    const toUpdate: DesiredRow[] = []
    const toCreate: DesiredRow[] = []
    for (const [key, row] of current) {
      if (desired.has(key)) continue
      if (!scope.full && !inScopeEdge(row, scope)) continue
      toDelete.push({ key, row, from: String(row.__from), to: String(row.__to) })
      count(table, 'delete', key)
    }
    for (const [key, row] of desired) {
      const existing = current.get(key)
      if (!existing) {
        toCreate.push(row)
        count(table, 'create', key)
        continue
      }
      const moved = spec.columns.some(column =>
        !sameValue(canonical(column, row.row[column.name]), readBack(column, existing[column.name])))
      if (moved) {
        toUpdate.push(row)
        count(table, 'update', key)
      }
    }
    if (toDelete.length) deleteEdges.push({ spec, rows: toDelete })
    if (toUpdate.length) updateEdges.push({ spec, rows: toUpdate })
    if (toCreate.length) createEdges.push({ spec, rows: toCreate })
    index.edges[table] = new Map([...desired].map(([key, entry]) => [key, entry.row]))
  }

  // APPLY, in the one order that cannot fail on itself: this plugin's own edges go before its nodes,
  // so a node delete has nothing of its own still hanging off it, and nodes are created before the
  // edges that name them.
  for (const { spec, rows } of deleteEdges) await applyEdgeDelete(query, id, spec, rows)
  for (const { spec, rows } of deleteNodes) {
    await runChunked(query,
      `UNWIND $rows AS r MATCH (n:${spec.table} {${spec.key}: r.__key}) WHERE n.by = $by DETACH DELETE n`,
      rows.map(row => ({ __key: row.key })), { by: id })
  }
  for (const { spec, rows } of createNodes) {
    const assignments = spec.columns.filter(column => column.name !== spec.key).map(column => assignment('n', column)).join(', ')
    // MERGE rather than CREATE: a node table's primary key is shared across plugins (`TitleKey` holds
    // one node per key across the whole store), and a CREATE onto a key another plugin already minted
    // is an error rather than a no-op.
    await runChunked(query,
      `UNWIND $rows AS r MERGE (n:${spec.table} {${spec.key}: r.__key})
       ON CREATE SET ${assignments} ON MATCH SET ${assignments}`,
      rows.map(row => paramsOf(spec.columns, row)))
  }
  for (const { spec, rows } of updateNodes) {
    const assignments = spec.columns.filter(column => column.name !== spec.key).map(column => assignment('n', column)).join(', ')
    await runChunked(query,
      `UNWIND $rows AS r MATCH (n:${spec.table} {${spec.key}: r.__key}) WHERE n.by = $by SET ${assignments}`,
      rows.map(row => paramsOf(spec.columns, row)), { by: id })
  }
  for (const { spec, rows } of createEdges) await applyEdgeCreate(query, id, spec, rows)
  for (const { spec, rows } of updateEdges) await applyEdgeUpdate(query, id, spec, rows)

  return {
    id, version, changes, counts, ms: Date.now() - started,
    index: retain(options.previous, index, scope, changes),
  }
}

/**
 * The plugin's full previous output after a run: what it kept, minus what this run retracted, plus
 * what it now desires.
 *
 * A full scope is authoritative on its own, so the desired set IS the index. Under a partial scope
 * the desired set is only the slice the run recomputed, and handing that back as `ctx.previous` is
 * what breaks `plugin:aggregate`: `previousStateOf` takes a non-empty index as the whole of the
 * previous state and skips its graph fallback, so every cluster the scope did not name loses its id.
 *
 * What is dropped is what the DIFF deleted, which is exactly the rows inside the scope this run no
 * longer wants. A key the index held that is inside the scope, is no longer desired and was not
 * deleted is a key whose row was already absent from the graph, so it lingers here; the graph, not
 * this index, is what a plugin's output is diffed against.
 */
const retain = (
  previous: PluginOutputIndex | undefined,
  index: PluginOutputIndex,
  scope: ExpandedScope,
  changes: WriterChange[]
): PluginOutputIndex => {
  if (scope.full || !previous) return index
  const deleted = new Set(changes.filter(change => change.operation === 'delete').map(change => `${change.table} ${change.key}`))
  const merge = (table: string, kept: Map<string, PluginRow> | undefined, desired: Map<string, PluginRow>): Map<string, PluginRow> => {
    const rows = new Map(kept ?? [])
    for (const key of [...rows.keys()]) if (deleted.has(`${table} ${key}`)) rows.delete(key)
    for (const [key, row] of desired) rows.set(key, row)
    return rows
  }
  const merged: PluginOutputIndex = { nodes: {}, edges: {} }
  for (const [table, desired] of Object.entries(index.nodes)) {
    merged.nodes[table as PluginNodeTable] = merge(table, previous.nodes[table as PluginNodeTable], desired)
  }
  for (const [table, desired] of Object.entries(index.edges)) {
    merged.edges[table as PluginEdgeTable] = merge(table, previous.edges[table as PluginEdgeTable], desired)
  }
  return merged
}

/** The one MATCH an edge update or delete opens with, per declared FROM/TO pair. */
const edgeMatch = (table: string, pair: { from: string, to: string }): string =>
  `MATCH (a:${pair.from} {${LABELS[pair.from]!.key}: r.__from})-[e:${table}]->(b:${pair.to} {${LABELS[pair.to]!.key}: r.__to})`

const applyEdgeCreate = async (query: Query, id: PluginId, spec: EdgeTableSpec, rows: DesiredRow[]): Promise<void> => {
  const properties = spec.columns.map(inlineProperty).join(', ')
  // the same idempotence guard the ingest writes its claims with: the pair is matched, the edge this
  // plugin already carries there is refused, and the rest are created
  const exists = spec.keyed ? '{key: r.key, by: $by}' : '{by: $by}'
  for (const pair of spec.pairs) {
    await runChunked(query,
      `UNWIND $rows AS r
       MATCH (a:${pair.from} {${LABELS[pair.from]!.key}: r.__from}), (b:${pair.to} {${LABELS[pair.to]!.key}: r.__to})
       WHERE NOT EXISTS { MATCH (a)-[:${spec.table} ${exists}]->(b) }
       CREATE (a)-[:${spec.table} {${properties}}]->(b)`,
      rows.map(row => paramsOf(spec.columns, row)), { by: id })
  }
}

const applyEdgeUpdate = async (query: Query, id: PluginId, spec: EdgeTableSpec, rows: DesiredRow[]): Promise<void> => {
  const assignments = spec.columns.filter(column => column.name !== 'key').map(column => assignment('e', column)).join(', ')
  if (!assignments) return
  for (const pair of spec.pairs) {
    await runChunked(query,
      `UNWIND $rows AS r ${edgeMatch(spec.table, pair)}
       WHERE e.by = $by${spec.keyed ? ' AND e.key = r.key' : ''} SET ${assignments}`,
      rows.map(row => paramsOf(spec.columns, row)), { by: id })
  }
}

const applyEdgeDelete = async (query: Query, id: PluginId, spec: EdgeTableSpec, rows: DesiredRow[]): Promise<void> => {
  for (const pair of spec.pairs) {
    await runChunked(query,
      `UNWIND $rows AS r ${edgeMatch(spec.table, pair)}
       WHERE e.by = $by${spec.keyed ? ' AND e.key = r.key' : ''} DELETE e`,
      rows.map(row => ({ __from: row.from, __to: row.to, key: row.row.key ?? null })), { by: id })
  }
}

/**
 * Retract everything one plugin ever wrote: an empty desired set over `scope.full` (5.2, 5.3).
 *
 * This is what disabling a plugin does, and what a version bump does before the full pass that
 * follows it. The `keep: true` carve-out 5.3 gives `Cluster` and `Alias` lands with
 * `plugin:aggregate`; no table is kept yet.
 */
export const retractPlugin = (plugin: Pick<Plugin, 'id' | 'version' | 'produces'>): Promise<WriterReport> =>
  applyPluginOutput({
    id: plugin.id,
    version: plugin.version,
    produces: plugin.produces,
    output: emptyOutput({ full: true }),
  })
