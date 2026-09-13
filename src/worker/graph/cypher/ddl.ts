import type { CreateNodeTable, CreateRelTable } from './ast'
import type { Store, Table } from './storage'
import type { Value } from './values'

import { CypherError } from './ast'

/**
 * Applying a table declaration to the store.
 *
 * `IF NOT EXISTS` is what the app always writes (`schema.ts` declares every table that way) because
 * the schema is applied on every boot and the store lives for one session. Without it a second boot
 * in the same worker would throw on the first table, so the idempotence is load bearing rather than
 * defensive.
 *
 * A REDECLARATION IS NOT CHECKED FOR AGREEMENT. `IF NOT EXISTS` means "leave what is there", and the
 * engine being replaced does not compare the two shapes either. A test that redeclares a table with
 * different columns gets the first shape, silently, from both.
 *
 * DDL ANSWERS A ROW, which is easy to miss because nothing in the app reads it.
 *
 * The reference returns `[{ result: 'Table X has been created.' }]`, and the differential harness
 * compares row counts on every statement, so a store that answered nothing here would report a
 * divergence on the very first statement of every session. Measured against the reference 2026-09-13.
 */
export const CREATED = (name: string): Record<string, string>[] =>
  [{ result: `Table ${name} has been created.` }]

/** And an `IF NOT EXISTS` over a table that is already there says so, rather than claiming a create. */
export const ALREADY = (name: string): Record<string, string>[] =>
  [{ result: `Table ${name} already exists.` }]

export const applyNodeTable = (store: Store, statement: CreateNodeTable, cypher: string): Record<string, string>[] => {
  const existing = store.table(statement.name)
  if (existing) {
    if (statement.ifNotExists) return ALREADY(statement.name)
    throw new CypherError('run', `Binder exception: ${statement.name} already exists in catalog.`, cypher)
  }
  const keys = statement.columns.filter(column => column.primaryKey)
  if (keys.length !== 1) {
    throw new CypherError(
      'bind',
      `node table ${statement.name} declares ${keys.length} primary keys, and exactly one is required`,
      cypher
    )
  }
  store.declareNode(statement.name, statement.columns)
  return CREATED(statement.name)
}

export const applyRelTable = (store: Store, statement: CreateRelTable, cypher: string): Record<string, string>[] => {
  const existing = store.table(statement.name)
  if (existing) {
    if (statement.ifNotExists) return ALREADY(statement.name)
    throw new CypherError('run', `Binder exception: ${statement.name} already exists in catalog.`, cypher)
  }
  if (!statement.pairs.length) {
    throw new CypherError('bind', `rel table ${statement.name} declares no FROM ... TO ... pair`, cypher)
  }
  for (const pair of statement.pairs) {
    for (const side of [pair.from, pair.to]) {
      const table = store.table(side)
      if (!table) {
        throw new CypherError('bind', `rel table ${statement.name} names ${side}, which is not declared`, cypher)
      }
      if (table.kind !== 'node') {
        throw new CypherError('bind', `rel table ${statement.name} names ${side}, which is a rel table`, cypher)
      }
    }
  }
  if (statement.columns.some(column => column.primaryKey)) {
    throw new CypherError('bind', `rel table ${statement.name} declares a PRIMARY KEY, which a rel table has no place for`, cypher)
  }
  store.declareRel(statement.name, statement.pairs, statement.columns)
  return CREATED(statement.name)
}

/**
 * The rows `CALL show_tables()` answers, which one test reads to enumerate the schema.
 *
 * THE FULL COLUMN SET, including three nothing reads. `id`, `comment` and `database name` are the
 * reference's, and the differential harness compares whole rows: answering a useful subset would be
 * a divergence on every run. They are constants here because this store has one database, no table
 * comments, and no id worth inventing.
 */
export const showTables = (store: Store): Record<string, Value>[] =>
  store.all().map((table: Table, index: number) => ({
    id: index,
    name: table.name,
    type: table.kind === 'node' ? 'NODE' : 'REL',
    'database name': 'main(graph)',
    comment: '',
  }))
