import type { ColumnDecl, ColumnType } from './ast'
import type { Value } from './values'

/**
 * The store: tables, records, indexes, and the undo log that makes one statement all or nothing.
 *
 * IT HOLDS ABOUT 8,000 ROWS. That figure is not incidental, it is the design constraint: the whole
 * graph for a session is 8,346 rows across 24 tables, which is small enough that the only structures
 * worth having are the ones that turn a scan into a lookup. There is no query optimiser here and
 * there should not be one. A primary key map, an adjacency set per node per relationship table, and
 * one secondary index for the single pattern that needs it.
 *
 * INSERTION ORDER IS THE NATURAL ORDER, and it is load bearing. A `Map` and a `Set` both iterate in
 * insertion order, so a table scan and an adjacency expansion are deterministic for a given history
 * of writes, and a statement with no `ORDER BY` returns rows in a defined sequence. The engine this
 * replaces does not have that property: the same statement over the same graph returned 4 to 15
 * distinct orders across 20 to 40 runs. Determinism here is strictly better than what shipped, and it
 * is what makes a failing corpus case reproducible instead of a flake.
 *
 * READS COPY OUT, AND THE WRITER OWNS WHAT IT HANDS IN. In process there is no serializer standing
 * between a caller and the store, so a caller mutating a list it was handed would silently corrupt a
 * row: `copyOut` is what prevents that, and every read goes through it. The other direction is a
 * DIVISION OF LABOUR rather than a copy: `createNode`, `createEdge` and `setProperty` take ownership
 * of the record they are given, and the executor builds a fresh one per row while coercing it, so
 * nothing a caller still holds is ever stored. This file does not defend against a caller that breaks
 * that, because the executor is the only caller and the copy would be paid on every row written.
 */

export type NodeTable = {
  readonly kind: 'node'
  readonly name: string
  readonly columns: readonly ColumnDecl[]
  readonly byName: ReadonlyMap<string, ColumnDecl>
  /** The primary key column. Every node table in this schema declares exactly one. */
  readonly primaryKey: ColumnDecl
  /** Primary key value to record, in insertion order. The only node index that exists. */
  readonly rows: Map<Value, NodeRecord>
}

export type RelTable = {
  readonly kind: 'rel'
  readonly name: string
  readonly columns: readonly ColumnDecl[]
  readonly byName: ReadonlyMap<string, ColumnDecl>
  /** Every declared `FROM A TO B`. Several tables declare more than one and the binder checks them. */
  readonly pairs: readonly { from: string, to: string }[]
  /** Every edge, in insertion order: the scan a whole-table read walks. */
  readonly edges: Set<EdgeRecord>
  /**
   * `key` column to edges, built only for the tables that carry one.
   *
   * The app addresses individual edges by a sha-256 `key` constantly (`UNWIND $keys AS k MATCH ()-[c:CLAIMS {key: k}]->()`,
   * and the same shape for LINK, HAS_EPISODE and EPISODE_CLAIMS). Without this those are a full edge
   * scan per key. It is the one secondary index in the store and it exists because real statements
   * asked for it, not because an index seemed prudent.
   */
  readonly byKey: Map<Value, Set<EdgeRecord>> | undefined
}

export type Table = NodeTable | RelTable

export type NodeRecord = {
  readonly table: NodeTable
  /**
   * The primary key value this row is FILED under, which is not always what `props` currently says.
   *
   * `deleteNode` used to recompute the key from `props` at delete time. A `SET` on the primary key
   * column between the create and the delete desynchronises the two: the row stays in the map under
   * its old key, unreachable but present, and the undo then files a SECOND entry for one record.
   * Keeping the filing key on the record is what makes the delete and its undo agree with the create.
   */
  key: Value
  /** A global counter, so natural order is stable across tables and survives deletes. */
  readonly seq: number
  props: Record<string, Value>
  /** Outgoing edges by relationship table, insertion ordered. */
  readonly out: Map<RelTable, Set<EdgeRecord>>
  readonly in: Map<RelTable, Set<EdgeRecord>>
  deleted: boolean
}

export type EdgeRecord = {
  readonly table: RelTable
  readonly seq: number
  readonly from: NodeRecord
  readonly to: NodeRecord
  props: Record<string, Value>
  deleted: boolean
}

/** A reversal, pushed by every mutation so a statement that throws leaves nothing behind. */
type Undo = () => void

export class Store {
  private readonly tables = new Map<string, Table>()
  private counter = 0
  private undo: Undo[] | undefined
  /** Containers an undo put something back into, which have to be re-ordered afterwards. */
  private restored: Set<Map<Value, NodeRecord> | Set<EdgeRecord>> | undefined

  /** Every table, in declaration order, for `CALL show_tables()`. */
  all (): readonly Table[] { return [...this.tables.values()] }

  table (name: string): Table | undefined { return this.tables.get(name) }

  node (name: string): NodeTable | undefined {
    const table = this.tables.get(name)
    return table?.kind === 'node' ? table : undefined
  }

  rel (name: string): RelTable | undefined {
    const table = this.tables.get(name)
    return table?.kind === 'rel' ? table : undefined
  }

  declareNode (name: string, columns: readonly ColumnDecl[]): NodeTable {
    const primaryKey = columns.find(column => column.primaryKey)
    if (!primaryKey) throw new Error(`node table ${name} declares no PRIMARY KEY`)
    const table: NodeTable = {
      kind: 'node', name, columns, primaryKey,
      byName: new Map(columns.map(column => [column.name, column])),
      rows: new Map(),
    }
    this.tables.set(name, table)
    return table
  }

  declareRel (
    name: string,
    pairs: readonly { from: string, to: string }[],
    columns: readonly ColumnDecl[]
  ): RelTable {
    const table: RelTable = {
      kind: 'rel', name, pairs, columns,
      byName: new Map(columns.map(column => [column.name, column])),
      edges: new Set(),
      byKey: columns.some(column => column.name === 'key') ? new Map() : undefined,
    }
    this.tables.set(name, table)
    return table
  }

  // -------------------------------------------------------------------------------------------
  // The undo log

  /**
   * Run one statement's mutations, or leave the store exactly as it was.
   *
   * A statement writes many rows: a 2,000 row `UNWIND ... CREATE` is ordinary here. If row 900 fails
   * its type check, the 899 before it must not survive, because the caller will retry the batch and
   * the duplicates would then be the error. The engine being replaced is all or nothing per statement
   * and the app is built on that; this is how that property is kept.
   */
  transact<T> (work: () => T): T {
    if (this.undo) return work()
    const log: Undo[] = []
    this.undo = log
    this.restored = new Set()
    try {
      const out = work()
      this.undo = undefined
      this.restored = undefined
      return out
    } catch (error) {
      this.undo = undefined
      const containers = this.restored ?? new Set()
      // `restored` STAYS SET while the undos run, because they are what report which containers they
      // put something back into. Clearing it first makes every `resort` call a silent no-op, and the
      // rollback then restores content with the order still wrong, which is the bug this exists for.
      // REVERSE ORDER, so an insert that a later delete removed is restored before being removed
      for (let index = log.length - 1; index >= 0; index -= 1) log[index]!()
      this.restored = undefined
      // THEN PUT THE ORDER BACK. `Map.set` and `Set.add` APPEND, so anything an undo restores lands
      // at the end of iteration order rather than where it was: delete the first of two rows, throw,
      // and the table afterwards iterates second-then-first. Content would be identical and natural
      // order, which this file promises and which is what makes an unordered read deterministic,
      // would not. Every record carries a monotonic `seq`, so natural order IS seq order and the
      // containers an undo touched can simply be rebuilt in it. This runs only on a failed statement.
      for (const container of containers) reorderBySeq(container)
      throw error
    }
  }

  private resort (container: Map<Value, NodeRecord> | Set<EdgeRecord>): void {
    this.restored?.add(container)
  }

  private record (undo: Undo): void { this.undo?.push(undo) }

  // -------------------------------------------------------------------------------------------
  // Mutation

  createNode (table: NodeTable, props: Record<string, Value>): NodeRecord {
    const key = props[table.primaryKey.name] ?? null
    if (table.rows.has(key)) {
      // the engine's own wording, which `tests/corpus/adapters/graph-store.ts` matches on
      throw new Error(`Found duplicated primary key value ${String(key)}`)
    }
    const node: NodeRecord = {
      table, key, seq: (this.counter += 1), props, deleted: false,
      out: new Map(), in: new Map(),
    }
    table.rows.set(key, node)
    this.record(() => { table.rows.delete(key) })
    return node
  }

  createEdge (
    table: RelTable,
    from: NodeRecord,
    to: NodeRecord,
    props: Record<string, Value>
  ): EdgeRecord {
    const edge: EdgeRecord = { table, seq: (this.counter += 1), from, to, props, deleted: false }
    table.edges.add(edge)
    adjacency(from.out, table).add(edge)
    adjacency(to.in, table).add(edge)
    const key = table.byKey ? props.key ?? null : undefined
    if (table.byKey && key !== undefined) {
      const bucket = table.byKey.get(key) ?? new Set<EdgeRecord>()
      bucket.add(edge)
      table.byKey.set(key, bucket)
    }
    this.record(() => {
      table.edges.delete(edge)
      // the CONTAINER goes too when it empties, not just the entry. A node that never kept an edge
      // would otherwise be left carrying `out: Map { CLAIMS -> Set {} }` after a rolled back create,
      // which nothing can observe but which makes "exactly as it was" untrue and makes a snapshot
      // comparison in a test fail for a reason that is not the one under test.
      dropEmpty(from.out, table, edge)
      dropEmpty(to.in, table, edge)
      if (table.byKey && key !== undefined) {
        const bucket = table.byKey.get(key)
        bucket?.delete(edge)
        if (bucket && !bucket.size) table.byKey.delete(key)
      }
    })
    return edge
  }

  setProperty (target: NodeRecord | EdgeRecord, name: string, value: Value): void {
    const had = Object.prototype.hasOwnProperty.call(target.props, name)
    const previous = target.props[name]
    target.props[name] = value
    this.record(() => {
      if (had) target.props[name] = previous as Value
      else delete target.props[name]
    })
  }

  deleteEdge (edge: EdgeRecord): void {
    if (edge.deleted) return
    const { table, from, to } = edge
    edge.deleted = true
    table.edges.delete(edge)
    from.out.get(table)?.delete(edge)
    to.in.get(table)?.delete(edge)
    const key = table.byKey ? edge.props.key ?? null : undefined
    if (table.byKey && key !== undefined) table.byKey.get(key)?.delete(edge)
    this.record(() => {
      edge.deleted = false
      table.edges.add(edge)
      adjacency(from.out, table).add(edge)
      adjacency(to.in, table).add(edge)
      if (table.byKey && key !== undefined) {
        const bucket = table.byKey.get(key) ?? new Set<EdgeRecord>()
        bucket.add(edge)
        table.byKey.set(key, bucket)
      }
      this.resort(table.edges)
      this.resort(from.out.get(table)!)
      this.resort(to.in.get(table)!)
    })
  }

  /** Every edge touching a node, in either direction, across every relationship table. */
  edgesOf (node: NodeRecord): EdgeRecord[] {
    const out: EdgeRecord[] = []
    for (const set of node.out.values()) out.push(...set)
    for (const set of node.in.values()) out.push(...set)
    return out
  }

  deleteNode (node: NodeRecord): void {
    if (node.deleted) return
    // the key it was FILED under, never a fresh read of props: see `NodeRecord.key`
    const { key } = node
    node.deleted = true
    node.table.rows.delete(key)
    this.record(() => {
      node.deleted = false
      node.table.rows.set(key, node)
      this.resort(node.table.rows)
    })
  }
}

/** Remove one edge from an adjacency, and the adjacency itself once it holds nothing. */
const dropEmpty = (map: Map<RelTable, Set<EdgeRecord>>, table: RelTable, edge: EdgeRecord): void => {
  const set = map.get(table)
  if (!set) return
  set.delete(edge)
  if (!set.size) map.delete(table)
}

/** Rebuild a container in `seq` order, which is the natural order every read depends on. */
const reorderBySeq = (container: Map<Value, NodeRecord> | Set<EdgeRecord>): void => {
  if (container instanceof Set) {
    const sorted = [...container].sort((a, b) => a.seq - b.seq)
    container.clear()
    for (const edge of sorted) container.add(edge)
    return
  }
  const sorted = [...container.entries()].sort((a, b) => a[1].seq - b[1].seq)
  container.clear()
  for (const [key, node] of sorted) container.set(key, node)
}

const adjacency = (map: Map<RelTable, Set<EdgeRecord>>, table: RelTable): Set<EdgeRecord> => {
  const found = map.get(table)
  if (found) return found
  const made = new Set<EdgeRecord>()
  map.set(table, made)
  return made
}

/**
 * A deep copy on the way out, so a caller cannot reach back into a stored row.
 *
 * Scalars and `Date` are immutable enough to share; lists and maps are not. This is the in-process
 * replacement for the serialization that used to sit between the store and its callers by accident.
 */
export const copyOut = (value: Value): Value => {
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  if (Array.isArray(value)) return value.map(copyOut)
  const out: Record<string, Value> = {}
  for (const [key, entry] of Object.entries(value as Record<string, Value>)) out[key] = copyOut(entry)
  return out
}

/** The declared type of a column, for the coercion on the way in. */
export const columnType = (table: Table, name: string): ColumnType | undefined =>
  table.byName.get(name)?.type
