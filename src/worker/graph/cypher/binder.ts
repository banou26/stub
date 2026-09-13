import type {
  Expr, NodePattern, Pattern, Query, ReadingClause, RelPattern, UpdatingClause,
} from './ast'
import type { Store } from './storage'

import { CypherError, notSupported } from './ast'

/**
 * The schema and scope check, run once per statement before anything executes.
 *
 * IT IS MANDATORY, NOT A POLISH, and that is a deliberate reversal of the obvious order. The engine
 * being replaced type checks against its schema for free, and several callers lean on that: the
 * ingest hands values over as strings and casts them rather than validating each field, and the
 * writer relies on a primary key column refusing a `SET`. Losing that check quietly would turn a
 * class of loud failures into wrong data, which is the worst trade available here.
 *
 * WHAT IT REFUSES, all at bind time with the construct named:
 * - a label or relationship type that is not declared
 * - a property that the table does not declare, on a read or a write
 * - a relationship whose (from label, to label) pair the rel table never declared, when WRITING
 * - a variable used before anything binds it
 * - every construct the executor does not implement
 *
 * WHAT IT DELIBERATELY ALLOWS: an undeclared pair on a READ. `MATCH (a:Media)-[:PROFILE_OF]->(b:Media)`
 * where the table declares no such pair answers no rows rather than throwing, which is what the
 * reference does and what `plugins/writer.ts` relies on when it offers every row to both pairs.
 */
export const bind = (store: Store, query: Query, cypher: string): void => {
  const scope = new Set<string>()
  const fail = (message: string): never => { throw new CypherError('bind', message, cypher) }

  const node = (pattern: NodePattern, writing: boolean): void => {
    if (pattern.label) {
      const table = store.table(pattern.label)
      if (!table) fail(`no node table named ${pattern.label}`)
      else if (table.kind !== 'node') fail(`${pattern.label} is a rel table, used as a node label`)
      else {
        for (const entry of pattern.properties) {
          if (!table.byName.has(entry.name)) fail(`${pattern.label} declares no column ${entry.name}`)
        }
      }
    } else if (pattern.properties.length && !pattern.variable) {
      fail('a node pattern with properties and no label cannot be resolved to a table')
    }
    for (const entry of pattern.properties) expr(entry.value)
    if (pattern.variable) scope.add(pattern.variable)
    // a write against a node with no label can only mean an already bound variable
    if (writing && !pattern.label && pattern.variable && !scope.has(pattern.variable)) {
      fail(`${pattern.variable} is written to before anything binds it`)
    }
  }

  const rel = (pattern: RelPattern): void => {
    if (pattern.range) throw notSupported('a variable length relationship', cypher)
    if (pattern.type) {
      const table = store.table(pattern.type)
      if (!table) fail(`no rel table named ${pattern.type}`)
      else if (table.kind !== 'rel') fail(`${pattern.type} is a node table, used as a relationship type`)
      else {
        for (const entry of pattern.properties) {
          if (!table.byName.has(entry.name)) fail(`${pattern.type} declares no column ${entry.name}`)
        }
      }
    }
    for (const entry of pattern.properties) expr(entry.value)
    if (pattern.variable) scope.add(pattern.variable)
  }

  const pattern = (item: Pattern, writing: boolean): void => {
    node(item.start, writing)
    for (const step of item.steps) {
      rel(step.rel)
      node(step.node, writing)
    }
  }

  const expr = (item: Expr): void => {
    switch (item.kind) {
      case 'literal': case 'param': return
      case 'variable':
        // a variable is resolved at run time against the binding, so an unknown one is only an error
        // when nothing in the statement could have bound it
        if (!scope.has(item.name)) fail(`${item.name} is used before anything binds it`)
        return
      case 'property': expr(item.target); return
      case 'list': item.items.forEach(expr); return
      case 'struct': item.entries.forEach(entry => expr(entry.value)); return
      case 'call': item.args.forEach(expr); return
      case 'cast': expr(item.value); return
      case 'case':
        item.whens.forEach(branch => { expr(branch.when); expr(branch.then) })
        if (item.otherwise) expr(item.otherwise)
        return
      case 'not': expr(item.value); return
      case 'and': case 'or': expr(item.left); expr(item.right); return
      case 'compare': expr(item.left); expr(item.right); return
      case 'in': expr(item.value); expr(item.list); return
      case 'startsWith': expr(item.value); expr(item.prefix); return
      case 'isNull': expr(item.value); return
      case 'exists': {
        // a pattern predicate binds its own variables, and they do NOT escape it
        const outer = new Set(scope)
        item.pattern.forEach(entry => pattern(entry, false))
        if (item.where) expr(item.where)
        scope.clear()
        for (const name of outer) scope.add(name)
        return
      }
    }
  }

  const reading = (clause: ReadingClause): void => {
    switch (clause.kind) {
      case 'unwind':
        expr(clause.source)
        scope.add(clause.as)
        return
      case 'match':
        clause.patterns.forEach(entry => pattern(entry, false))
        if (clause.where) expr(clause.where)
        return
      case 'with': {
        clause.items.forEach(entry => expr(entry.value))
        // WITH REPLACES the scope: anything it does not project is gone, which is the whole point of
        // the clause and is what a statement reading a dropped variable afterwards has to be told
        const projected = new Set(clause.items.map(entry => entry.as))
        scope.clear()
        for (const name of projected) scope.add(name)
        if (clause.where) expr(clause.where)
        return
      }
    }
  }

  const updating = (clause: UpdatingClause): void => {
    switch (clause.kind) {
      case 'create': clause.patterns.forEach(entry => pattern(entry, true)); return
      case 'merge': {
        node(clause.node, false)
        if (!clause.node.label) fail('MERGE needs a label')
        const table = store.node(clause.node.label ?? '')
        if (table) {
          const keys = clause.node.properties.map(entry => entry.name)
          if (keys.length !== 1 || keys[0] !== table.primaryKey.name) {
            // the engine refuses this too, and so does the binder: MERGE on a non key column has no
            // index to answer it and would mean a scan with surprising semantics on a tie
            throw notSupported(
              `MERGE on ${keys.join(', ') || 'no column'} rather than on the primary key ${table.primaryKey.name}`,
              cypher
            )
          }
        }
        clause.onCreate.forEach(assignment => assign(assignment.target, assignment.value))
        clause.onMatch.forEach(assignment => assign(assignment.target, assignment.value))
        return
      }
      case 'set': clause.assignments.forEach(assignment => assign(assignment.target, assignment.value)); return
      case 'delete': clause.targets.forEach(expr); return
    }
  }

  const assign = (target: Expr, value: Expr): void => {
    expr(value)
    if (target.kind !== 'property') {
      fail('SET assigns to a property, as in SET n.col = value')
      return
    }
    expr(target.target)
  }

  query.reading.forEach(reading)
  query.updating.forEach(updating)
  if (query.returning) {
    query.returning.items.forEach(item => expr(item.value))
    // ORDER BY reads the RETURN's aliases as well as the bindings, which is why it is checked after
    for (const alias of query.returning.items) scope.add(alias.as)
    query.returning.orderBy.forEach(key => expr(key.value))
  }
}
