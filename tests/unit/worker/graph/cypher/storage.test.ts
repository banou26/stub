/**
 * The store: tables, indexes, adjacency, and the undo log that makes one statement all or nothing.
 *
 * THE UNDO LOG IS WHAT THIS SUITE IS FOR. Every other property here is a lookup handing back what was
 * put in it, and a wrong answer is loud. A half unwound statement is silent: the row counts come back
 * right while an adjacency set still holds an edge nobody can reach, and the next statement reads it.
 * So every failed-transaction case compares a SNAPSHOT of the whole store, every table, row, edge,
 * both adjacency directions and the key index, rather than counting rows. A count would pass on a
 * store whose adjacency was left corrupt, which is precisely the bug an undo log gets wrong.
 *
 * The property the app is built on is the batch one: a 2,000 row `UNWIND ... CREATE` whose row 900
 * fails must leave NOTHING behind, because the caller retries the batch and the first 899 would come
 * back as duplicate key errors. `a duplicate primary key part way through a batch` is that case at a
 * size that fits on screen.
 */
import { expect, test } from 'vitest'

import type { ColumnDecl } from '../../../../../src/worker/graph/cypher/ast'
import type { EdgeRecord, NodeRecord, RelTable } from '../../../../../src/worker/graph/cypher/storage'
import type { Value } from '../../../../../src/worker/graph/cypher/values'

import { columnType, copyOut, Store } from '../../../../../src/worker/graph/cypher/storage'

const string = (name: string, primaryKey = false): ColumnDecl =>
  ({ name, type: { kind: 'STRING' }, primaryKey, defaultTo: undefined })

const int = (name: string): ColumnDecl =>
  ({ name, type: { kind: 'INT64' }, primaryKey: false, defaultTo: undefined })

const strings = (name: string): ColumnDecl =>
  ({ name, type: { kind: 'LIST', of: { kind: 'STRING' } }, primaryKey: false, defaultTo: undefined })

/** A store shaped like the app's: two node tables, a keyed edge table and an unkeyed one. */
const schema = () => {
  const store = new Store()
  const media = store.declareNode('MEDIA', [string('uri', true), string('title'), int('year'), strings('tags')])
  const episode = store.declareNode('EPISODE', [string('uri', true), int('number')])
  const claims = store.declareRel(
    'CLAIMS',
    [{ from: 'MEDIA', to: 'MEDIA' }, { from: 'EPISODE', to: 'EPISODE' }, { from: 'MEDIA', to: 'EPISODE' }],
    [string('key'), string('note'), strings('tags')]
  )
  const partOf = store.declareRel('PART_OF', [{ from: 'EPISODE', to: 'MEDIA' }], [string('note')])
  return { store, media, episode, claims, partOf }
}

// ---------------------------------------------------------------------------------------------
// The snapshot

type Adjacency = { table: string, edges: string[] }[]

type NodeSnapshot = {
  key: string
  id: string
  deleted: boolean
  props: Record<string, Value>
  out: Adjacency
  in: Adjacency
}

type EdgeSnapshot = {
  id: string
  from: string
  to: string
  deleted: boolean
  props: Record<string, Value>
}

type Snapshot = (
  | { table: string, kind: 'node', rows: NodeSnapshot[] }
  | {
      table: string
      kind: 'rel'
      pairs: readonly { from: string, to: string }[]
      edges: EdgeSnapshot[]
      byKey: { key: string, edges: string[] }[] | 'no key column'
    }
)[]

/** `typeof` is in the label because the key `null` and the key `'null'` are two different rows. */
const label = (value: Value): string => `${typeof value}:${String(value)}`

const idOf = (record: NodeRecord | EdgeRecord): string => `${record.table.name}#${record.seq}`

const sequenced = <T extends NodeRecord | EdgeRecord>(records: readonly T[], order: Order): T[] =>
  order === 'natural' ? [...records] : [...records].sort((a, b) => a.seq - b.seq)

type Order = 'natural' | 'bySeq'

/**
 * The whole store as a comparable value: every table, row, edge, adjacency and index.
 *
 * `order` was not a convenience when this file was written: a failed transaction restored CONTENT but
 * not natural order, because an undone delete re-inserts into a `Map` or `Set` that no longer holds
 * the key and therefore lands at the END of iteration (`mal:1, mal:2` became `mal:2, mal:1`).
 * BOTH OF THOSE ARE FIXED as of 2026-09-13: `transact` rebuilds every container an undo touched in
 * `seq` order, and an undone `createEdge` now removes an adjacency or key bucket it emptied rather
 * than leaving it behind. The three cases at the end of this file are what hold those fixed.
 *
 * The two loosenings are KEPT anyway, deliberately. `bySeq` and the dropped empties make this helper
 * report only differences that something downstream could observe, so a case about a key index does
 * not go red over iteration order. The strict comparison now has its own cases instead of being
 * everything's business, which is why those three assert on `natural` and on the raw containers.
 */
const snapshot = (store: Store, order: Order = 'natural'): Snapshot => {
  const adjacencyOf = (map: ReadonlyMap<RelTable, Set<EdgeRecord>>): Adjacency =>
    [...map]
      .filter(([, edges]) => edges.size > 0)
      .map(([table, edges]) => ({ table: table.name, edges: sequenced([...edges], order).map(idOf) }))

  return store.all().map(table => {
    if (table.kind === 'node') {
      const rows = [...table.rows]
      if (order === 'bySeq') rows.sort(([, left], [, right]) => left.seq - right.seq)
      return {
        table: table.name,
        kind: 'node',
        rows: rows.map(([key, node]) => ({
          key: label(key),
          id: idOf(node),
          deleted: node.deleted,
          // `setProperty` writes into this record in place, so the snapshot has to own a copy
          props: { ...node.props },
          out: adjacencyOf(node.out),
          in: adjacencyOf(node.in),
        })),
      }
    }
    return {
      table: table.name,
      kind: 'rel',
      pairs: table.pairs,
      edges: sequenced([...table.edges], order).map(edge => ({
        id: idOf(edge),
        from: idOf(edge.from),
        to: idOf(edge.to),
        deleted: edge.deleted,
        props: { ...edge.props },
      })),
      byKey: table.byKey === undefined
        ? 'no key column'
        : [...table.byKey]
          .filter(([, edges]) => edges.size > 0)
          .map(([key, edges]) => ({ key: label(key), edges: sequenced([...edges], order).map(idOf) })),
    }
  })
}

/** Run something that must throw, and hand the error back so a case can assert on it. */
const threw = (work: () => unknown): Error => {
  try {
    work()
  } catch (error) {
    return error as Error
  }
  throw new Error('the work was expected to throw and did not')
}

// ---------------------------------------------------------------------------------------------
// Declaration

test('a node table indexes its rows by the column marked PRIMARY KEY', () => {
  const { store, media } = schema()

  expect(media.kind).toBe('node')
  expect(media.primaryKey.name).toBe('uri')
  expect([...media.byName.keys()]).toEqual(['uri', 'title', 'year', 'tags'])
  expect(media.rows.size).toBe(0)
  expect(store.node('MEDIA')).toBe(media)
  expect(store.rel('MEDIA')).toBeUndefined()
})

test('a node table declaring no PRIMARY KEY is refused at declaration', () => {
  const store = new Store()

  expect(() => store.declareNode('BROKEN', [string('uri'), string('title')]))
    .toThrow('node table BROKEN declares no PRIMARY KEY')
  // the control: the same call with the column marked passes, so the refusal is about the mark
  expect(store.declareNode('FINE', [string('uri', true)]).primaryKey.name).toBe('uri')
})

test('a rel table keeps every declared FROM A TO B pair, in declaration order', () => {
  const { store, claims } = schema()

  expect(claims.pairs).toEqual([
    { from: 'MEDIA', to: 'MEDIA' },
    { from: 'EPISODE', to: 'EPISODE' },
    { from: 'MEDIA', to: 'EPISODE' },
  ])
  expect(store.rel('CLAIMS')).toBe(claims)
  expect(store.node('CLAIMS')).toBeUndefined()
})

test('byKey exists only on a rel table that declares a key column', () => {
  const { claims, partOf } = schema()

  expect(claims.byKey).toBeInstanceOf(Map)
  expect(partOf.byKey).toBeUndefined()
})

test('all() lists every table in declaration order, which is what show_tables() walks', () => {
  const { store, media, episode, claims, partOf } = schema()

  expect(store.all()).toEqual([media, episode, claims, partOf])
  expect(store.table('EPISODE')).toBe(episode)
  expect(store.table('NOTHING')).toBeUndefined()
})

test('columnType reads a declared column type, and is undefined for a column nobody declared', () => {
  const { media } = schema()

  expect(columnType(media, 'year')).toEqual({ kind: 'INT64' })
  expect(columnType(media, 'uri')).toEqual({ kind: 'STRING' })
  expect(columnType(media, 'nothing')).toBeUndefined()
})

// ---------------------------------------------------------------------------------------------
// Nodes

test('created nodes sit in the table under their primary key value, in insertion order', () => {
  const { store, media } = schema()

  const first = store.createNode(media, { uri: 'mal:1', title: 'one' })
  const second = store.createNode(media, { uri: 'mal:2', title: 'two' })

  expect([...media.rows.keys()]).toEqual(['mal:1', 'mal:2'])
  expect(media.rows.get('mal:1')).toBe(first)
  expect(second.seq).toBeGreaterThan(first.seq)
  expect(first.deleted).toBe(false)
})

test('a second node with the same primary key value is refused with the engine wording', () => {
  const { store, media } = schema()
  store.createNode(media, { uri: 'mal:1' })

  // `tests/corpus/adapters/graph-store.ts` matches on this text, so the wording is the contract
  expect(() => store.createNode(media, { uri: 'mal:1' }))
    .toThrow('Found duplicated primary key value mal:1')
  // the control: another key goes in, so the refusal is about the value and not about the table
  expect(() => store.createNode(media, { uri: 'mal:2' })).not.toThrow()
  expect(media.rows.size).toBe(2)
})

test('a node with no value for its primary key column is keyed by null', () => {
  const { store, media } = schema()

  const node = store.createNode(media, { title: 'nameless' })

  expect(media.rows.get(null)).toBe(node)
  expect(() => store.createNode(media, { title: 'also nameless' }))
    .toThrow('Found duplicated primary key value null')
})

// ---------------------------------------------------------------------------------------------
// Edges

test('a created edge is in the table scan and in both endpoints adjacency', () => {
  const { store, media, episode, claims } = schema()
  const from = store.createNode(media, { uri: 'mal:1' })
  const to = store.createNode(episode, { uri: 'mal:1#1' })

  const edge = store.createEdge(claims, from, to, { key: 'k1', note: 'first' })

  expect([...claims.edges]).toEqual([edge])
  expect([...(from.out.get(claims) ?? [])]).toEqual([edge])
  expect([...(to.in.get(claims) ?? [])]).toEqual([edge])
  expect(from.in.size).toBe(0)
  expect(to.out.size).toBe(0)
})

test('an edge is found by its key, and several edges can share one key', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1' })
  const b = store.createNode(media, { uri: 'mal:2' })

  const first = store.createEdge(claims, a, b, { key: 'shared', note: 'one' })
  const second = store.createEdge(claims, b, a, { key: 'shared', note: 'two' })
  const other = store.createEdge(claims, a, b, { key: 'other', note: 'three' })

  expect([...(claims.byKey?.get('shared') ?? [])]).toEqual([first, second])
  expect([...(claims.byKey?.get('other') ?? [])]).toEqual([other])
  expect(claims.byKey?.get('missing')).toBeUndefined()
})

test('an edge on a table with no key column is stored, and indexes nothing', () => {
  const { store, media, episode, partOf } = schema()
  const from = store.createNode(episode, { uri: 'mal:1#1' })
  const to = store.createNode(media, { uri: 'mal:1' })

  const edge = store.createEdge(partOf, from, to, { note: 'unkeyed' })

  expect([...partOf.edges]).toEqual([edge])
  expect(partOf.byKey).toBeUndefined()
})

test('deleteEdge takes the edge out of the table, both adjacencies and the key index', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1' })
  const b = store.createNode(media, { uri: 'mal:2' })
  const doomed = store.createEdge(claims, a, b, { key: 'k1', note: 'doomed' })
  const survivor = store.createEdge(claims, a, b, { key: 'k2', note: 'survivor' })

  store.deleteEdge(doomed)

  expect(doomed.deleted).toBe(true)
  expect([...claims.edges]).toEqual([survivor])
  expect([...(a.out.get(claims) ?? [])]).toEqual([survivor])
  expect([...(b.in.get(claims) ?? [])]).toEqual([survivor])
  expect([...(claims.byKey?.get('k1') ?? [])]).toEqual([])
  // the control: the sibling is still reachable by all four routes, so the delete was targeted
  expect([...(claims.byKey?.get('k2') ?? [])]).toEqual([survivor])
  expect(store.edgesOf(a)).toEqual([survivor])
})

test('deleting an edge twice is the same as deleting it once', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1' })
  const b = store.createNode(media, { uri: 'mal:2' })
  const edge = store.createEdge(claims, a, b, { key: 'k1' })

  store.deleteEdge(edge)
  const after = snapshot(store)
  store.deleteEdge(edge)

  expect(snapshot(store)).toEqual(after)
})

// ---------------------------------------------------------------------------------------------
// Nodes with edges

test('edgesOf reports every edge touching a node in both directions, across tables', () => {
  const { store, media, episode, claims, partOf } = schema()
  const show = store.createNode(media, { uri: 'mal:1' })
  const first = store.createNode(episode, { uri: 'mal:1#1' })
  const other = store.createNode(media, { uri: 'mal:2' })
  const outgoing = store.createEdge(claims, show, first, { key: 'k1' })
  const incoming = store.createEdge(claims, other, show, { key: 'k2' })
  const member = store.createEdge(partOf, first, show, { note: 'episode of' })

  expect(store.edgesOf(show)).toEqual([outgoing, incoming, member])
  expect(store.edgesOf(other)).toEqual([incoming])
})

test('deleteNode removes the row and leaves its edges, which is what edgesOf is for', () => {
  const { store, media, episode, claims } = schema()
  const show = store.createNode(media, { uri: 'mal:1' })
  const first = store.createNode(episode, { uri: 'mal:1#1' })
  const edge = store.createEdge(claims, show, first, { key: 'k1' })

  // a DETACH DELETE is the caller asking for the edges and deleting them itself, so a node delete on
  // its own is the half that leaves an edge pointing at a row the table no longer holds
  const orphaned = store.edgesOf(show)
  store.deleteNode(show)

  expect(orphaned).toEqual([edge])
  expect(show.deleted).toBe(true)
  expect(media.rows.size).toBe(0)
  expect([...claims.edges]).toEqual([edge])

  for (const each of orphaned) store.deleteEdge(each)
  expect([...claims.edges]).toEqual([])
  expect([...(first.in.get(claims) ?? [])]).toEqual([])
})

test('deleting a node twice is the same as deleting it once', () => {
  const { store, media } = schema()
  const node = store.createNode(media, { uri: 'mal:1' })

  store.deleteNode(node)
  const after = snapshot(store)
  store.deleteNode(node)

  expect(snapshot(store)).toEqual(after)
})

// ---------------------------------------------------------------------------------------------
// copyOut
//
// `Value` is readonly all the way down, so a case that mutates what it was handed has to look
// through the type. That caller is real: app code sorts a list it read off a row, and in process
// there is no serializer standing between it and the stored record.

test('a list handed out by copyOut can be mutated without touching the row it came from', () => {
  const { store, media } = schema()
  const node = store.createNode(media, { uri: 'mal:1', tags: ['action', 'drama'] })

  const handed = copyOut(node.props.tags ?? null) as Value[]
  handed.push('comedy')
  handed[0] = 'wrecked'

  expect(handed).toEqual(['wrecked', 'drama', 'comedy'])
  expect(node.props.tags).toEqual(['action', 'drama'])
})

test('copyOut copies every level of a nested map and list', () => {
  const stored = { outer: { inner: ['a', 'b'] }, list: [{ deep: 1 }] }

  const handed = copyOut(stored) as typeof stored
  handed.outer.inner.push('c')
  handed.list[0]!.deep = 99

  expect(stored).toEqual({ outer: { inner: ['a', 'b'] }, list: [{ deep: 1 }] })
  expect(handed.outer).not.toBe(stored.outer)
  expect(handed.list[0]).not.toBe(stored.list[0])
})

test('copyOut shares a Date and every scalar, because nothing downstream rewrites those', () => {
  const when = new Date('2026-09-13T00:00:00.000Z')

  expect(copyOut(when)).toBe(when)
  expect(copyOut('text')).toBe('text')
  expect(copyOut(26)).toBe(26)
  expect(copyOut(null)).toBe(null)
  expect(copyOut(true)).toBe(true)
})

test('a caller wrecking every list it was handed leaves the whole store unchanged', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1', tags: ['action'] })
  const b = store.createNode(media, { uri: 'mal:2', tags: ['drama'] })
  store.createEdge(claims, a, b, { key: 'k1', tags: ['claimed'] })
  const before = snapshot(store)

  for (const table of store.all()) {
    const records: (NodeRecord | EdgeRecord)[] = table.kind === 'node'
      ? [...table.rows.values()]
      : [...table.edges]
    for (const record of records) {
      const handed = copyOut(record.props) as Record<string, Value[]>
      for (const value of Object.values(handed)) if (Array.isArray(value)) value.push('injected')
    }
  }

  expect(snapshot(store)).toEqual(before)
})

// ---------------------------------------------------------------------------------------------
// The undo log

test('a transaction that throws after several creates leaves the store exactly as it was', () => {
  const { store, media, episode, claims } = schema()
  const show = store.createNode(media, { uri: 'mal:1', title: 'kept' })
  const first = store.createNode(episode, { uri: 'mal:1#1' })
  store.createEdge(claims, show, first, { key: 'kept', note: 'kept' })
  const before = snapshot(store)

  const error = threw(() => store.transact(() => {
    const second = store.createNode(episode, { uri: 'mal:1#2' })
    store.createEdge(claims, show, second, { key: 'doomed', note: 'doomed' })
    store.createEdge(claims, first, second, { key: 'doomed', note: 'doomed too' })
    store.setProperty(show, 'title', 'overwritten')
    throw new Error('row 900 failed its type check')
  }))

  expect(error.message).toBe('row 900 failed its type check')
  expect(snapshot(store)).toEqual(before)
})

test('a duplicate primary key part way through a batch leaves none of the rows before it', () => {
  const { store, media } = schema()
  store.createNode(media, { uri: 'mal:6' })
  const before = snapshot(store)

  const error = threw(() => store.transact(() => {
    for (const uri of ['mal:1', 'mal:2', 'mal:3', 'mal:4', 'mal:5', 'mal:6', 'mal:7']) {
      store.createNode(media, { uri })
    }
  }))

  expect(error.message).toContain('Found duplicated primary key value mal:6')
  expect(snapshot(store)).toEqual(before)
  // the property a retry depends on: the five that went in first are gone, so the retry is clean
  expect([...media.rows.keys()]).toEqual(['mal:6'])
})

test('a throw after an edge delete puts the edge back in the table, both adjacencies and byKey', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1' })
  const b = store.createNode(media, { uri: 'mal:2' })
  const edge = store.createEdge(claims, a, b, { key: 'k1', note: 'restored' })
  store.createEdge(claims, a, b, { key: 'k2', note: 'untouched' })
  const before = snapshot(store, 'bySeq')

  threw(() => store.transact(() => {
    store.deleteEdge(edge)
    throw new Error('later in the same statement')
  }))

  expect(snapshot(store, 'bySeq')).toEqual(before)
  expect(edge.deleted).toBe(false)
  expect(claims.edges.has(edge)).toBe(true)
  expect(a.out.get(claims)?.has(edge)).toBe(true)
  expect(b.in.get(claims)?.has(edge)).toBe(true)
  expect(claims.byKey?.get('k1')?.has(edge)).toBe(true)
})

test('a throw after a node delete puts the row back under its primary key', () => {
  const { store, media, episode, claims } = schema()
  const show = store.createNode(media, { uri: 'mal:1', title: 'restored' })
  const first = store.createNode(episode, { uri: 'mal:1#1' })
  store.createEdge(claims, show, first, { key: 'k1' })
  const before = snapshot(store, 'bySeq')

  threw(() => store.transact(() => {
    store.deleteNode(show)
    throw new Error('later in the same statement')
  }))

  expect(snapshot(store, 'bySeq')).toEqual(before)
  expect(show.deleted).toBe(false)
  expect(media.rows.get('mal:1')).toBe(show)
})

test('a throw after setProperty puts the previous value back', () => {
  const { store, media } = schema()
  const node = store.createNode(media, { uri: 'mal:1', title: 'original', year: 2026 })

  threw(() => store.transact(() => {
    store.setProperty(node, 'title', 'replaced')
    store.setProperty(node, 'year', 1999)
    throw new Error('later in the same statement')
  }))

  expect(node.props).toEqual({ uri: 'mal:1', title: 'original', year: 2026 })
})

test('a throw after setProperty restores an absent property as absent, not as null', () => {
  const { store, media } = schema()
  // `wasNull` is the control: the undo has to tell "there was no such property" from "there was one
  // and it held null", and the two are different answers to `n.col IS NULL` against a row that has
  // never carried the column at all
  const node = store.createNode(media, { uri: 'mal:1', wasNull: null })

  threw(() => store.transact(() => {
    store.setProperty(node, 'wasAbsent', 'written')
    store.setProperty(node, 'wasNull', 'written')
    throw new Error('later in the same statement')
  }))

  expect('wasAbsent' in node.props).toBe(false)
  expect(node.props.wasAbsent).toBeUndefined()
  expect('wasNull' in node.props).toBe(true)
  expect(node.props.wasNull).toBeNull()
})

test('a delete and a create of one primary key unwind in reverse, so the original row is back', () => {
  const { store, media } = schema()
  const original = store.createNode(media, { uri: 'mal:1', title: 'original' })
  const before = snapshot(store, 'bySeq')

  threw(() => store.transact(() => {
    store.deleteNode(original)
    store.createNode(media, { uri: 'mal:1', title: 'replacement' })
    throw new Error('later in the same statement')
  }))

  // replayed FORWARD the key is gone entirely: the create's undo deletes it before the delete's undo
  // puts it back, and a row the statement never touched is what the next statement then misses
  expect(media.rows.get('mal:1')).toBe(original)
  expect(media.rows.size).toBe(1)
  expect(snapshot(store, 'bySeq')).toEqual(before)
})

test('a create and a delete of one edge unwind in reverse, so neither survives', () => {
  const { store, media, episode, claims } = schema()
  const show = store.createNode(media, { uri: 'mal:1' })
  const first = store.createNode(episode, { uri: 'mal:1#1' })
  const before = snapshot(store, 'bySeq')

  threw(() => store.transact(() => {
    const second = store.createNode(episode, { uri: 'mal:1#2' })
    const edge = store.createEdge(claims, show, second, { key: 'k1', note: 'transient' })
    store.deleteEdge(edge)
    store.deleteNode(second)
    throw new Error('later in the same statement')
  }))

  // replayed forward, the two deletes' undos run LAST and resurrect both, so the store keeps a node
  // and an edge that this statement created and removed inside itself
  expect(snapshot(store, 'bySeq')).toEqual(before)
  expect([...media.rows.keys()]).toEqual(['mal:1'])
  expect([...episode.rows.keys()]).toEqual(['mal:1#1'])
  expect(claims.edges.size).toBe(0)
  expect(store.edgesOf(show)).toEqual([])
  expect(store.edgesOf(first)).toEqual([])
})

test('a statement of mixed writes that throws leaves every table, adjacency and index identical', () => {
  const { store, media, episode, claims, partOf } = schema()
  const show = store.createNode(media, { uri: 'mal:1', title: 'kept', tags: ['action'] })
  const other = store.createNode(media, { uri: 'mal:2' })
  const first = store.createNode(episode, { uri: 'mal:1#1', number: 1 })
  const second = store.createNode(episode, { uri: 'mal:1#2', number: 2 })
  const keptEdge = store.createEdge(claims, show, other, { key: 'kept', note: 'kept' })
  store.createEdge(claims, show, other, { key: 'kept', note: 'shares a key' })
  store.createEdge(partOf, first, show, { note: 'kept' })
  const before = snapshot(store, 'bySeq')

  threw(() => store.transact(() => {
    store.deleteEdge(keptEdge)
    store.setProperty(show, 'title', 'rewritten')
    store.setProperty(other, 'title', 'added')
    const third = store.createNode(episode, { uri: 'mal:1#3', number: 3 })
    store.createEdge(partOf, third, show, { note: 'transient' })
    store.createEdge(claims, second, third, { key: 'kept', note: 'joins the shared bucket' })
    store.deleteNode(second)
    store.createNode(episode, { uri: 'mal:1#2', number: 99 })
    throw new Error('the last row of the batch failed')
  }))

  expect(snapshot(store, 'bySeq')).toEqual(before)
  expect(episode.rows.get('mal:1#2')).toBe(second)
  expect([...(claims.byKey?.get('kept') ?? [])]).toHaveLength(2)
  expect(store.edgesOf(show)).toHaveLength(3)
})

test('a nested transact joins the outer log, so an inner failure unwinds the whole statement', () => {
  const { store, media } = schema()
  store.createNode(media, { uri: 'mal:1' })
  const before = snapshot(store)

  threw(() => store.transact(() => {
    store.createNode(media, { uri: 'mal:2' })
    store.transact(() => {
      store.createNode(media, { uri: 'mal:3' })
      throw new Error('thrown inside the nested transact')
    })
  }))

  // the inner call opens no second log: one that did would unwind its own row and hand the outer
  // one a store with `mal:2` still in it and no record of how it got there
  expect(snapshot(store)).toEqual(before)
  expect([...media.rows.keys()]).toEqual(['mal:1'])
})

test('a nested transact that returned is still undone when the outer one throws', () => {
  const { store, media } = schema()
  const before = snapshot(store)
  let inner: Value[] = []

  threw(() => store.transact(() => {
    store.transact(() => { store.createNode(media, { uri: 'mal:1' }) })
    inner = [...media.rows.keys()]
    throw new Error('thrown after the nested transact returned')
  }))

  expect(inner).toEqual(['mal:1'])
  expect(snapshot(store)).toEqual(before)
})

test('transact hands back what the work returned, and keeps what it wrote', () => {
  const { store, media } = schema()

  const node = store.transact(() => store.createNode(media, { uri: 'mal:1' }))

  expect(media.rows.get('mal:1')).toBe(node)
  // and the log is closed on the way out, so a later failed statement cannot reach back into it
  threw(() => store.transact(() => {
    store.createNode(media, { uri: 'mal:2' })
    throw new Error('a later statement')
  }))
  expect([...media.rows.keys()]).toEqual(['mal:1'])
})

test('a failed transaction that wrote nothing leaves the store alone', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1' })
  const b = store.createNode(media, { uri: 'mal:2' })
  store.createEdge(claims, a, b, { key: 'k1' })
  const before = snapshot(store)

  threw(() => store.transact(() => { throw new Error('touches nothing') }))

  expect(snapshot(store)).toEqual(before)
})

// This is where a case asserting the OPPOSITE used to sit. It documented, correctly and deliberately,
// that an undone delete put the row back at the END of natural order, because the agent who found it
// did not own `storage.ts` and reported rather than fixed. The fix landed straight after, so the case
// was replaced by the three below rather than left asserting a bug as a promise: a test that pins
// known-wrong behaviour is worth having exactly until the behaviour is fixed, and is actively
// misleading one commit later.

// ---------------------------------------------------------------------------------------------
// The three properties the undo log used to get wrong. Each was found by mutation testing this file
// against an implementation that looked right, and each is a way "the store is exactly as it was" can
// be false while every row is present and every count matches.

// MUTATED: drop the `reorderBySeq` loop from `transact`'s catch and this reads `mal:2, mal:1`. The
// rows are all there and the counts agree, which is why a test that counted would not have seen it.
test('a rolled back delete puts the row back where it was, not at the end', () => {
  const { store, media } = schema()
  store.createNode(media, { uri: 'mal:1', title: null, year: null, tags: null })
  store.createNode(media, { uri: 'mal:2', title: null, year: null, tags: null })
  const before = snapshot(store, 'natural')

  expect(() => store.transact(() => {
    store.deleteNode(store.node('MEDIA')!.rows.get('mal:1')!)
    throw new Error('row 900 failed its type check')
  })).toThrow('row 900')

  expect([...media.rows.keys()], 'natural order survives the rollback').toEqual(['mal:1', 'mal:2'])
  expect(snapshot(store, 'natural'), 'and so does everything else').toEqual(before)
})

// The same property for an edge, where the container is a Set and there are three of them to restore:
// the table, the source adjacency and the target adjacency.
test('a rolled back edge delete restores every container in order, not just the table', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1', title: null, year: null, tags: null })
  const b = store.createNode(media, { uri: 'mal:2', title: null, year: null, tags: null })
  store.createEdge(claims, a, b, { key: 'k1', note: null, tags: null })
  store.createEdge(claims, a, b, { key: 'k2', note: null, tags: null })
  const before = snapshot(store, 'natural')

  expect(() => store.transact(() => {
    store.deleteEdge([...claims.edges][0]!)
    throw new Error('nope')
  })).toThrow('nope')

  expect([...claims.edges].map(edge => edge.props.key)).toEqual(['k1', 'k2'])
  expect([...a.out.get(claims)!].map(edge => edge.props.key)).toEqual(['k1', 'k2'])
  expect([...b.in.get(claims)!].map(edge => edge.props.key)).toEqual(['k1', 'k2'])
  expect(snapshot(store, 'natural')).toEqual(before)
})

// MUTATED: have `deleteNode` recompute the key from `props` instead of reading `node.key`, which is
// the shape it had first, and the row survives the delete: `rows` still holds it under 'mal:1' and
// the undo files a SECOND entry for one record.
test('a row whose primary key was changed is still filed, and deleted, under the key it was created with', () => {
  const { store, media } = schema()
  const node = store.createNode(media, { uri: 'mal:1', title: null, year: null, tags: null })
  store.setProperty(node, 'uri', 'renamed')

  expect(node.key, 'the filing key is not what props now says').toBe('mal:1')
  store.deleteNode(node)
  expect([...media.rows.keys()], 'and the delete found it').toEqual([])
})

// MUTATED: put back `from.out.get(table)?.delete(edge)` in place of `dropEmpty` and the node is left
// carrying `CLAIMS -> Set {}` for an edge that never survived, with a `k1 -> Set {}` bucket beside it.
test('a rolled back edge create leaves no empty adjacency or key bucket behind', () => {
  const { store, media, claims } = schema()
  const a = store.createNode(media, { uri: 'mal:1', title: null, year: null, tags: null })
  const b = store.createNode(media, { uri: 'mal:2', title: null, year: null, tags: null })

  expect(() => store.transact(() => {
    store.createEdge(claims, a, b, { key: 'k1', note: null, tags: null })
    throw new Error('nope')
  })).toThrow('nope')

  expect(a.out.has(claims), 'no adjacency for a table this node never kept an edge in').toBe(false)
  expect(b.in.has(claims)).toBe(false)
  expect([...claims.byKey!.keys()], 'and no bucket for a key no edge ever had').toEqual([])
})

