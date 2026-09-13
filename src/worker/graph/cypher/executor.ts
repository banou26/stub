import type {
  Expr, NodePattern, Pattern, Query, ReadingClause, RelPattern, ReturnClause, ReturnItem, UpdatingClause,
} from './ast'
import type { EdgeRecord, NodeRecord, NodeTable, RelTable, Store } from './storage'
import type { Row, Value } from './values'

import { CypherError, notSupported } from './ast'
import { copyOut } from './storage'
import { castValue, coerce, compareValues, equals } from './values'

/**
 * Running a bound statement.
 *
 * THE MODEL IS A LIST OF BINDINGS, which is the whole design in one sentence. Execution starts with
 * one empty binding, every reading clause turns each binding into zero or more longer ones, the
 * updating clauses run once per surviving binding, and RETURN projects them into rows. There is no
 * query plan and no optimiser, deliberately: the graph is about 8,000 rows, and the only thing worth
 * doing is turning a scan into a lookup where a primary key is available (see `startingNodes`).
 *
 * MATCHING IS HOMOMORPHIC: one pattern may traverse the same relationship twice. That is measured
 * behaviour of the engine being replaced rather than a simplification (`conformance.test.ts`, "an
 * undirected walk reuses the edge it arrived on"), and it is also the cheaper rule.
 *
 * NATURAL ORDER IS INSERTION ORDER, top to bottom: UNWIND walks its list in order, a table scan walks
 * the primary key map in insertion order, an expansion walks the adjacency set in insertion order.
 * Every one of those is a `Map` or a `Set`, so the sequence is determined by the history of writes
 * and nothing else. That is a property the previous engine did not have, and it is what makes a
 * failing corpus case reproducible rather than a flake.
 */

type Bound =
  | { kind: 'node', node: NodeRecord }
  | { kind: 'edge', edge: EdgeRecord }
  | { kind: 'value', value: Value }

type Binding = Map<string, Bound>

type Context = {
  store: Store
  params: Record<string, Value>
  cypher: string
}

export const execute = (context: Context, query: Query): Row[] => {
  let bindings: Binding[] = [new Map()]
  for (const clause of query.reading) bindings = readClause(context, clause, bindings)

  if (query.updating.length) {
    for (const clause of query.updating) bindings = updateClause(context, clause, bindings)
  }

  if (!query.returning) return []
  return project(context, query.returning, bindings)
}

// ---------------------------------------------------------------------------------------------
// Reading

const readClause = (context: Context, clause: ReadingClause, bindings: Binding[]): Binding[] => {
  switch (clause.kind) {
    case 'unwind': {
      const out: Binding[] = []
      for (const binding of bindings) {
        const source = evaluate(context, binding, clause.source)
        if (source === null) continue
        if (!Array.isArray(source)) {
          throw new CypherError('run', `UNWIND expects a list, got ${typeof source}`, context.cypher)
        }
        for (const item of source) {
          const next = new Map(binding)
          next.set(clause.as, { kind: 'value', value: item })
          out.push(next)
        }
      }
      return out
    }
    case 'match': {
      const out: Binding[] = []
      for (const binding of bindings) {
        let expanded: Binding[] = [binding]
        for (const pattern of clause.patterns) expanded = expanded.flatMap(one => expand(context, one, pattern))
        const kept = clause.where
          ? expanded.filter(one => evaluate(context, one, clause.where!) === true)
          : expanded
        if (kept.length) { out.push(...kept); continue }
        if (!clause.optional) continue
        // OPTIONAL MATCH keeps the driving row and NULLS every alias the pattern would have bound.
        // Which aliases is not obvious: it is every variable the pattern names, including the ones
        // already bound outside, and those must keep their values rather than being nulled.
        const missed = new Map(binding)
        for (const name of variablesOf(clause.patterns)) {
          if (!missed.has(name)) missed.set(name, { kind: 'value', value: null })
        }
        out.push(missed)
      }
      return out
    }
    case 'with': {
      // WITH AGGREGATES exactly as RETURN does, which is not obvious and is what the invariant
      // queries need: `WITH m, count(c) AS n WHERE n > 1` groups by `m` and counts each group, then
      // filters on the count. Without it a statement like that refuses, which the differential
      // harness reported as "native threw and ladybug did not" on the first whole-suite run.
      const groups = clause.items.some(item => isAggregate(item.value))
        ? groupBindings(context, clause.items, bindings)
        : bindings.map(binding => projectBinding(context, clause.items, binding))
      return clause.where
        ? groups.filter(one => evaluate(context, one, clause.where!) === true)
        : groups
    }
  }
}

/** One binding projected through a list of items, keeping node and edge bindings where it can. */
const projectBinding = (context: Context, items: readonly ReturnItem[], binding: Binding): Binding => {
  const next: Binding = new Map()
  for (const item of items) {
    // a bare variable carries its BINDING through, node or edge included, which is what lets a later
    // MATCH keep walking from it. Anything else becomes a value.
    if (item.value.kind === 'variable' && binding.has(item.value.name)) {
      next.set(item.as, binding.get(item.value.name)!)
      continue
    }
    next.set(item.as, { kind: 'value', value: evaluate(context, binding, item.value) })
  }
  return next
}

/** The same grouping RETURN does, answering BINDINGS so later clauses can keep reading them. */
const groupBindings = (
  context: Context,
  items: readonly ReturnItem[],
  bindings: readonly Binding[]
): Binding[] => {
  const keys = items.filter(item => !isAggregate(item.value))
  const groups = new Map<string, { binding: Binding, members: Binding[] }>()
  for (const binding of bindings) {
    const projected = projectBinding(context, keys, binding)
    const identity = stable(Object.fromEntries(
      [...projected].map(([name, bound]) => [name, bound.kind === 'value' ? bound.value : `${bound.kind}#${identityOf(bound)}`])
    ))
    const found = groups.get(identity)
    if (found) found.members.push(binding)
    else groups.set(identity, { binding: projected, members: [binding] })
  }
  return [...groups.values()].map(group => {
    const next = new Map(group.binding)
    for (const item of items) {
      if (keys.includes(item)) continue
      next.set(item.as, { kind: 'value', value: aggregateValue(context, item.value, group.members) })
    }
    return next
  })
}

const identityOf = (bound: Bound): number =>
  bound.kind === 'node' ? bound.node.seq : bound.kind === 'edge' ? bound.edge.seq : 0

const variablesOf = (patterns: readonly Pattern[]): string[] => {
  const names: string[] = []
  for (const pattern of patterns) {
    if (pattern.start.variable) names.push(pattern.start.variable)
    for (const step of pattern.steps) {
      if (step.rel.variable) names.push(step.rel.variable)
      if (step.node.variable) names.push(step.node.variable)
    }
  }
  return names
}

/**
 * Walk the chain from whichever END is cheaper, reversing it if that is the far one.
 *
 * `MATCH (pa:MediaProfile)-[:PROFILE_OF]->(m)` with `m` already bound is the shape this exists for,
 * and the app writes it constantly: the plugins join a profile onto a media they already have. Walked
 * as written it scans every MediaProfile row and keeps the handful whose edge happens to reach `m`.
 * Walked backward it is one adjacency lookup. Measured on the home page: two statements of this shape
 * cost 890 ms across 32 calls before, and the rows they returned were never the issue.
 *
 * CHEAPER means, in order: an endpoint already BOUND, then one addressed by its PRIMARY KEY, then
 * nothing. Only the two ends are considered, not the middle of a longer chain, because every shape
 * the app issues is anchored at one end or the other and a general planner is not what this needs.
 */
const anchored = (context: Context, binding: Binding, pattern: Pattern): Pattern => {
  if (!pattern.steps.length) return pattern
  const last = pattern.steps[pattern.steps.length - 1]!.node
  if (rank(context, binding, pattern.start) >= rank(context, binding, last)) return pattern
  return reverse(pattern)
}

const rank = (context: Context, binding: Binding, node: NodePattern): number => {
  if (node.variable && binding.has(node.variable)) return 2
  const table = node.label ? context.store.node(node.label) : undefined
  if (table && node.properties.some(entry => entry.name === table.primaryKey.name)) return 1
  return 0
}

/** The same chain read from the other end: steps reversed, every relationship direction flipped. */
const reverse = (pattern: Pattern): Pattern => {
  const nodes = [pattern.start, ...pattern.steps.map(step => step.node)]
  const rels = pattern.steps.map(step => step.rel)
  const flipped = rels.map(rel => ({
    ...rel,
    direction: rel.direction === 'right' ? 'left' as const
      : rel.direction === 'left' ? 'right' as const
        : 'undirected' as const,
  }))
  return {
    start: nodes[nodes.length - 1]!,
    steps: flipped.reverse().map((rel, index) => ({ rel, node: nodes[nodes.length - 2 - index]! })),
  }
}

/**
 * THE EDGE KEY INDEX, which is the difference between a lookup and a scan of the whole graph.
 *
 * `MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media)` addresses ONE edge by its sha-256, and the app
 * issues that shape constantly: CLAIMS, LINK, HAS_EPISODE and EPISODE_CLAIMS all carry a `key` and
 * all are read this way. Expanded node first it scans every Media row and walks each one's adjacency
 * looking for a key that is usually on none of them. Measured on the home page before this existed:
 * 14 calls, 856 ms, ZERO rows returned. Sixty one milliseconds each to find nothing.
 *
 * `storage.ts` has built the index the whole time and nothing consulted it, which is the more useful
 * half of the lesson: an index is not a decision, it is a decision plus the call site that uses it.
 *
 * Only for a single hop with no endpoint already bound. Anything else falls through to the ordinary
 * expansion, because the point is to catch the one shape that matters rather than to plan.
 */
const edgeAnchored = (context: Context, binding: Binding, pattern: Pattern): EdgeRecord[] | undefined => {
  if (pattern.steps.length !== 1) return undefined
  const step = pattern.steps[0]!
  if (step.rel.range || !step.rel.type) return undefined
  if (pattern.start.variable && binding.has(pattern.start.variable)) return undefined
  if (step.node.variable && binding.has(step.node.variable)) return undefined

  const table = context.store.rel(step.rel.type)
  if (!table?.byKey) return undefined
  const keyed = step.rel.properties.find(entry => entry.name === 'key')
  if (!keyed) return undefined

  const key = evaluate(context, binding, keyed.value)
  return [...(table.byKey.get(key ?? null) ?? [])]
}

/** One pattern against one binding: zero or more bindings extended with what the pattern named. */
const expand = (context: Context, binding: Binding, original: Pattern): Binding[] => {
  let pattern = original
  const byKey = edgeAnchored(context, binding, pattern)
  if (byKey) {
    const step = pattern.steps[0]!
    const out: Binding[] = []
    for (const edge of byKey) {
      // an undirected pattern matches the edge from either end, so both readings are offered
      const readings = step.rel.direction === 'undirected'
        ? [{ start: edge.from, end: edge.to }, { start: edge.to, end: edge.from }]
        : step.rel.direction === 'left'
          ? [{ start: edge.to, end: edge.from }]
          : [{ start: edge.from, end: edge.to }]
      for (const reading of readings) {
        const first = withNode(context, binding, pattern.start, reading.start)
        if (!first) continue
        const second = withNode(context, first, step.node, reading.end)
        if (!second) continue
        if (!matches(context, second, step.rel.properties, edge.props)) continue
        if (step.rel.variable) second.set(step.rel.variable, { kind: 'edge', edge })
        out.push(second)
      }
    }
    return out
  }

  const chain = anchored(context, binding, pattern)
  let current = startingNodes(context, binding, chain.start)
    .map(node => withNode(context, binding, chain.start, node))
    .filter((one): one is Binding => one !== undefined)

  pattern = chain

  for (const step of pattern.steps) {
    const next: Binding[] = []
    for (const one of current) {
      const from = nodeOf(one, pattern, step)
      if (!from) continue
      if (step.rel.range) { next.push(...walkRange(context, one, step, from)); continue }
      for (const { edge, other } of walk(context, from, step.rel)) {
        const bound = withNode(context, one, step.node, other)
        if (!bound) continue
        if (!matches(context, bound, step.rel.properties, edge.props)) continue
        if (step.rel.variable) bound.set(step.rel.variable, { kind: 'edge', edge })
        next.push(bound)
      }
    }
    current = next
  }
  return current
}

/**
 * A variable length hop, `*1..4` and friends: ONE BINDING PER PATH, not per endpoint.
 *
 * A node reachable two ways appears twice, which is the reference's behaviour and is the whole reason
 * the callers of this construct write `RETURN DISTINCT`. Measured in `conformance.test.ts`.
 *
 * THE WALK IS HOMOMORPHIC, so it may come back over the edge it arrived on: at exactly two undirected
 * hops from a node, returning to the start is the ONLY way the start can be in the answer, and the
 * reference puts it there. That also means a cycle can be walked round and round, which is why the
 * depth is bounded by `max` and why an open range is refused at parse time rather than given an
 * invented ceiling.
 *
 * The filter `(r, _ | WHERE ...)` is evaluated per HOP with `r` bound to that hop's relationship, so a
 * path is kept only while every edge on it passes. Its variable names come from the pattern rather
 * than from a convention (see `RelPattern.range`).
 */
const walkRange = function* (
  context: Context,
  binding: Binding,
  step: Pattern['steps'][number],
  from: NodeRecord
): Generator<Binding> {
  const range = step.rel.range!
  const seen = new Set<string>()

  const emit = function* (node: NodeRecord, edges: readonly EdgeRecord[]): Generator<Binding> {
    if (edges.length < range.min) return
    const bound = withNode(context, binding, step.node, node)
    if (!bound) return
    if (step.rel.variable) {
      // the whole PATH, as the relationship identities it walked: nothing in this repo reads it, and
      // binding only the last edge would be quietly wrong for anything that did
      bound.set(step.rel.variable, { kind: 'value', value: edges.map(edge => `edge#${edge.seq}`) })
    }
    yield bound
  }

  const descend = function* (node: NodeRecord, edges: EdgeRecord[]): Generator<Binding> {
    yield* emit(node, edges)
    if (edges.length >= range.max) return
    for (const { edge, other } of walk(context, node, step.rel)) {
      if (!matches(context, binding, step.rel.properties, edge.props)) continue
      if (range.filter) {
        const hop = new Map(binding)
        if (range.relVariable) hop.set(range.relVariable, { kind: 'edge', edge })
        if (range.nodeVariable) hop.set(range.nodeVariable, { kind: 'node', node: other })
        if (evaluate(context, hop, range.filter) !== true) continue
      }
      edges.push(edge)
      // a PATH is the unit, so the same endpoint reached twice is two answers, but the same path
      // reached twice is not: the key is the edge sequence, which is what stops a cycle repeating
      const key = `${edges.map(one => one.seq).join(',')}#${other.seq}`
      if (!seen.has(key)) {
        seen.add(key)
        yield* descend(other, edges)
      }
      edges.pop()
    }
  }

  yield* descend(from, [])
}

/**
 * Where an expansion starts from, and the ONE optimisation in this file.
 *
 * A node pattern naming its table's primary key with a computable value is a `Map` lookup rather than
 * a scan. That single case covers most of what the app issues, because nearly every read is an
 * `UNWIND $uris AS u MATCH (m:Media {uri: u})` over a list of keys. Everything else scans the table,
 * which at a few hundred rows is not worth planning around.
 */
const startingNodes = (context: Context, binding: Binding, pattern: NodePattern): NodeRecord[] => {
  const already = pattern.variable ? binding.get(pattern.variable) : undefined
  if (already) return already.kind === 'node' ? [already.node] : []

  if (!pattern.label) {
    // AN UNLABELLED, UNBOUND NODE SCANS EVERY NODE TABLE. `MATCH ()-[e:LINK]->() DELETE e` and
    // `MATCH (a)-[r]->(b)` are both ordinary, and refusing them would be a limitation invented here
    // rather than one the grammar has. It is the widest thing this executor does, and it is bounded
    // by the whole store being a few thousand rows.
    return context.store.all()
      .filter((table): table is NodeTable => table.kind === 'node')
      .flatMap(table => [...table.rows.values()])
  }
  const table = context.store.node(pattern.label)
  if (!table) return []

  const keyed = pattern.properties.find(entry => entry.name === table.primaryKey.name)
  if (keyed) {
    const key = evaluate(context, binding, keyed.value)
    const found = table.rows.get(key ?? null)
    return found ? [found] : []
  }
  return [...table.rows.values()]
}

const nodeOf = (binding: Binding, pattern: Pattern, step: Pattern['steps'][number]): NodeRecord | undefined => {
  // the node this step walks FROM is whichever node the previous step bound; it is tracked by the
  // `__from` slot rather than by name, because a pattern may name none of its nodes
  const held = binding.get(FROM)
  if (held?.kind === 'node') return held.node
  const start = pattern.start.variable ? binding.get(pattern.start.variable) : undefined
  return start?.kind === 'node' ? start.node : undefined
}

/** The internal slot that tracks the node an expansion has walked to. Never visible to a statement. */
const FROM = '  from'

const withNode = (
  context: Context,
  binding: Binding,
  pattern: NodePattern,
  node: NodeRecord
): Binding | undefined => {
  if (pattern.label && node.table.name !== pattern.label) return undefined
  if (pattern.variable) {
    const already = binding.get(pattern.variable)
    if (already && (already.kind !== 'node' || already.node !== node)) return undefined
  }
  // the INLINE PROPERTIES are a filter as much as the primary key is. `startingNodes` uses one of
  // them for a lookup where it can, and every one of them still has to be checked here: a pattern
  // keyed on a non key column was answering the whole table before this line existed.
  if (!matches(context, binding, pattern.properties, node.props)) return undefined
  const next = new Map(binding)
  if (pattern.variable) next.set(pattern.variable, { kind: 'node', node })
  next.set(FROM, { kind: 'node', node })
  return next
}

/** Every edge out of a node that a relationship pattern could use, with the node at its far end. */
const walk = function* (
  context: Context,
  from: NodeRecord,
  pattern: RelPattern
): Generator<{ edge: EdgeRecord, other: NodeRecord }> {
  const tables: RelTable[] = pattern.type
    ? [context.store.rel(pattern.type)].filter((table): table is RelTable => table !== undefined)
    : context.store.all().filter((table): table is RelTable => table.kind === 'rel')

  for (const table of tables) {
    if (pattern.direction !== 'left') {
      for (const edge of from.out.get(table) ?? []) yield { edge, other: edge.to }
    }
    if (pattern.direction !== 'right') {
      for (const edge of from.in.get(table) ?? []) yield { edge, other: edge.from }
    }
  }
}

/** Whether every inline property of a pattern equals the record's. Null never matches. */
const matches = (
  context: Context,
  binding: Binding,
  properties: readonly { name: string, value: Expr }[],
  props: Record<string, Value>
): boolean =>
  properties.every(entry => equals(props[entry.name] ?? null, evaluate(context, binding, entry.value)) === true)

// ---------------------------------------------------------------------------------------------
// Writing

const updateClause = (context: Context, clause: UpdatingClause, bindings: Binding[]): Binding[] => {
  switch (clause.kind) {
    case 'create':
      return bindings.map(binding => {
        let next = binding
        for (const pattern of clause.patterns) next = create(context, next, pattern)
        return next
      })
    case 'merge':
      return bindings.map(binding => merge(context, binding, clause))
    case 'set':
      for (const binding of bindings) {
        for (const assignment of clause.assignments) apply(context, binding, assignment)
      }
      return bindings
    case 'delete':
      for (const binding of bindings) {
        for (const target of clause.targets) {
          if (target.kind !== 'variable') {
            throw new CypherError('run', 'DELETE takes a variable', context.cypher)
          }
          const bound = binding.get(target.name)
          if (!bound) continue
          if (bound.kind === 'edge') { context.store.deleteEdge(bound.edge); continue }
          if (bound.kind !== 'node') continue
          const attached = context.store.edgesOf(bound.node)
          if (attached.length && !clause.detach) {
            throw new CypherError(
              'run',
              `Cannot delete node ${String(bound.node.key)}: it has connected edges in table `
              + `${attached[0]!.table.name}. Try DETACH DELETE instead.`,
              context.cypher
            )
          }
          for (const edge of attached) context.store.deleteEdge(edge)
          context.store.deleteNode(bound.node)
        }
      }
      return bindings
  }
}

const create = (context: Context, binding: Binding, pattern: Pattern): Binding => {
  let next = binding
  let from = resolveOrCreate(context, next, pattern.start)
  next = from.binding
  for (const step of pattern.steps) {
    const to = resolveOrCreate(context, next, step.node)
    next = to.binding
    if (!step.rel.type) throw new CypherError('run', 'CREATE needs a relationship type', context.cypher)
    const table = context.store.rel(step.rel.type)
    if (!table) throw new CypherError('run', `no rel table named ${step.rel.type}`, context.cypher)
    const [start, end] = step.rel.direction === 'left'
      ? [to.node, from.node]
      : [from.node, to.node]
    const declared = table.pairs.some(pair =>
      pair.from === start.table.name && pair.to === end.table.name)
    if (!declared) {
      throw new CypherError(
        'run',
        `${table.name} declares no FROM ${start.table.name} TO ${end.table.name}`,
        context.cypher
      )
    }
    const edge = context.store.createEdge(table, start, end, propsFor(context, next, table, step.rel.properties))
    if (step.rel.variable) next.set(step.rel.variable, { kind: 'edge', edge })
    from = { binding: next, node: to.node }
  }
  return next
}

const resolveOrCreate = (
  context: Context,
  binding: Binding,
  pattern: NodePattern
): { binding: Binding, node: NodeRecord } => {
  const already = pattern.variable ? binding.get(pattern.variable) : undefined
  if (already?.kind === 'node') return { binding, node: already.node }
  if (!pattern.label) throw new CypherError('run', 'CREATE needs a label on a new node', context.cypher)
  const table = context.store.node(pattern.label)
  if (!table) throw new CypherError('run', `no node table named ${pattern.label}`, context.cypher)
  const node = context.store.createNode(table, propsFor(context, binding, table, pattern.properties))
  const next = new Map(binding)
  if (pattern.variable) next.set(pattern.variable, { kind: 'node', node })
  return { binding: next, node }
}

/** A complete record: every declared column present, defaults applied, every value coerced. */
const propsFor = (
  context: Context,
  binding: Binding,
  table: NodeTable | RelTable,
  properties: readonly { name: string, value: Expr }[]
): Record<string, Value> => {
  const given = new Map(properties.map(entry => [entry.name, entry.value]))
  const props: Record<string, Value> = {}
  for (const column of table.columns) {
    const source = given.get(column.name)
    const raw = source
      ? evaluate(context, binding, source)
      : column.defaultTo
        ? evaluate(context, binding, column.defaultTo)
        : null
    props[column.name] = coerce(raw, column.type, `${table.name}.${column.name}`, context.cypher)
  }
  return props
}

const merge = (context: Context, binding: Binding, clause: Extract<UpdatingClause, { kind: 'merge' }>): Binding => {
  const table = context.store.node(clause.node.label ?? '')
  if (!table) throw new CypherError('run', `no node table named ${clause.node.label}`, context.cypher)
  const entry = clause.node.properties[0]!
  const key = coerce(
    evaluate(context, binding, entry.value),
    table.primaryKey.type,
    `${table.name}.${table.primaryKey.name}`,
    context.cypher
  )

  const found = table.rows.get(key)
  const next = new Map(binding)
  if (found) {
    if (clause.node.variable) next.set(clause.node.variable, { kind: 'node', node: found })
    for (const assignment of clause.onMatch) apply(context, next, assignment)
    return next
  }
  const node = context.store.createNode(table, propsFor(context, binding, table, clause.node.properties))
  if (clause.node.variable) next.set(clause.node.variable, { kind: 'node', node })
  for (const assignment of clause.onCreate) apply(context, next, assignment)
  return next
}

const apply = (context: Context, binding: Binding, assignment: { target: Expr, value: Expr }): void => {
  const { target } = assignment
  if (target.kind !== 'property' || target.target.kind !== 'variable') {
    throw new CypherError('run', 'SET assigns to a property of a bound variable', context.cypher)
  }
  const bound = binding.get(target.target.name)
  if (!bound || bound.kind === 'value') return
  const record = bound.kind === 'node' ? bound.node : bound.edge
  const table = record.table
  const column = table.byName.get(target.name)
  if (!column) {
    throw new CypherError('run', `${table.name} declares no column ${target.name}`, context.cypher)
  }
  if (column.primaryKey) {
    throw new CypherError('run', `${table.name}.${target.name} is a primary key and cannot be SET`, context.cypher)
  }
  const value = coerce(
    evaluate(context, binding, assignment.value),
    column.type,
    `${table.name}.${target.name}`,
    context.cypher
  )
  context.store.setProperty(record, target.name, value)
}

// ---------------------------------------------------------------------------------------------
// Projection

const AGGREGATES = new Set(['count', 'collect', 'max', 'min', 'sum'])

const isAggregate = (item: Expr): boolean => {
  switch (item.kind) {
    case 'call': return AGGREGATES.has(item.name) || item.args.some(isAggregate)
    case 'cast': return isAggregate(item.value)
    case 'not': return isAggregate(item.value)
    case 'and': case 'or': return isAggregate(item.left) || isAggregate(item.right)
    case 'compare': return isAggregate(item.left) || isAggregate(item.right)
    case 'list': return item.items.some(isAggregate)
    case 'struct': return item.entries.some(entry => isAggregate(entry.value))
    default: return false
  }
}

/**
 * RETURN, and the reason a row is carried next to the binding that produced it.
 *
 * ORDER BY can name an alias the RETURN just made (`RETURN m.uri AS uri ORDER BY uri`, which is what
 * nearly every ordered statement in the app writes) OR an expression over the pattern variables that
 * the RETURN never projected (`RETURN m.uri AS uri ORDER BY m.n DESC`). The second needs the binding,
 * which is gone once a row exists, so both travel together until the sort is done.
 *
 * AN AGGREGATING RETURN HAS NO BINDING TO OFFER, because the rows it makes are groups rather than
 * matches: `RETURN c.id AS id, count(m) AS total ORDER BY total` can only order by what it projected.
 * That is the reference's behaviour too, and ordering by a pattern variable there is refused by name
 * rather than silently ordering by null.
 */
const project = (context: Context, clause: ReturnClause, bindings: Binding[]): Row[] => {
  const aggregated = clause.items.some(item => isAggregate(item.value))
  let carried: { row: Row, binding: Binding | undefined }[] = aggregated
    ? aggregate(context, clause, bindings).map(row => ({ row, binding: undefined }))
    : bindings.map(binding => {
      const row: Row = {}
      for (const item of clause.items) row[item.as] = copyOut(evaluate(context, binding, item.value))
      return { row, binding }
    })

  if (clause.distinct) carried = distinct(carried)

  if (clause.orderBy.length) {
    // a STABLE sort, so ties keep natural order and every ORDER BY is therefore a total order
    const keyed = carried.map((entry, index) => ({ entry, index }))
    keyed.sort((a, b) => {
      for (const key of clause.orderBy) {
        const left = orderValue(context, clause, a.entry, key.value)
        const right = orderValue(context, clause, b.entry, key.value)
        const order = compareValues(left, right) * (key.descending ? -1 : 1)
        if (order !== 0) return order
      }
      return a.index - b.index
    })
    carried = keyed.map(entry => entry.entry)
  }

  const rows = carried.map(entry => entry.row)
  return clause.limit === undefined ? rows : rows.slice(0, clause.limit)
}

/**
 * ORDER BY reads the RETURN's own aliases, not the bindings.
 *
 * `RETURN m.uri AS uri ORDER BY uri` is the shape almost every ordered statement in the app uses, and
 * the alias is the only thing still in scope by then. An expression that is not an alias is refused
 * rather than guessed at, because ordering by something the row does not carry would silently order
 * by null.
 */
const orderValue = (
  context: Context,
  clause: ReturnClause,
  entry: { row: Row, binding: Binding | undefined },
  key: Expr
): Value => {
  // AN ALIAS FIRST, because `ORDER BY uri` after `RETURN m.uri AS uri` means the projected column,
  // and a pattern variable of the same name would be the wrong answer if one existed
  if (key.kind === 'variable' && key.name in entry.row) return entry.row[key.name]!
  if (entry.binding) return evaluate(context, entry.binding, key)
  throw notSupported(
    'ORDER BY a pattern variable in an aggregating RETURN, which has only its own columns',
    context.cypher
  )
}

const distinct = <T extends { row: Row }>(entries: readonly T[]): T[] => {
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of entries) {
    const key = stable(entry.row)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/** A comparable form for DISTINCT, key order independent so two rows built differently agree. */
const stable = (value: Value): string => {
  if (value === null) return 'n'
  if (value instanceof Date) return `t:${value.toISOString()}`
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, Value>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${key}=${stable(entry)}`).join(',')}}`
  }
  return `${typeof value}:${String(value)}`
}

const aggregate = (context: Context, clause: ReturnClause, bindings: Binding[]): Row[] => {
  const groups = new Map<string, { row: Row, members: Binding[] }>()
  const keys = clause.items.filter(item => !isAggregate(item.value))

  for (const binding of bindings) {
    const row: Row = {}
    for (const item of keys) row[item.as] = copyOut(evaluate(context, binding, item.value))
    const key = stable(row)
    const found = groups.get(key)
    if (found) found.members.push(binding)
    else groups.set(key, { row, members: [binding] })
  }

  // NO GROUPS AND NO KEYS still answers one row: `RETURN count(n) AS total` over an empty match is 0,
  // not nothing, and several callers read `rows[0].total` without checking the length first
  if (!groups.size && !keys.length) groups.set('', { row: {}, members: [] })

  return [...groups.values()].map(group => {
    const row: Row = { ...group.row }
    for (const item of clause.items) {
      if (keys.includes(item)) continue
      row[item.as] = copyOut(aggregateValue(context, item.value, group.members))
    }
    // the RETURN's own order, not the grouping order
    const ordered: Row = {}
    for (const item of clause.items) ordered[item.as] = row[item.as] ?? null
    return ordered
  })
}

const aggregateValue = (context: Context, item: Expr, members: readonly Binding[]): Value => {
  if (item.kind !== 'call' || !AGGREGATES.has(item.name)) {
    return members.length ? evaluate(context, members[0]!, item) : null
  }
  const values = item.star
    ? members.map(() => 1 as Value)
    : members.map(binding => evaluate(context, binding, item.args[0]!)).filter(value => value !== null)
  const used = item.distinct ? dedupe(values) : values

  switch (item.name) {
    case 'count': return used.length
    // COLLECT OF NOTHING IS NULL, not an empty list, which is the reference's behaviour and is also
    // the same rule `values.ts` applies to an empty STRING[] column: there is one spelling of "no
    // list here" in this store rather than two.
    case 'collect': return used.length ? used : null
    case 'sum': return used.reduce<number>((total, value) => total + Number(value), 0)
    case 'max': return used.length ? used.reduce((best, value) => (compareValues(value, best) > 0 ? value : best)) : null
    case 'min': return used.length ? used.reduce((best, value) => (compareValues(value, best) < 0 ? value : best)) : null
    default: throw notSupported(`the aggregate ${item.name}`, context.cypher)
  }
}

const dedupe = (values: readonly Value[]): Value[] => {
  const seen = new Set<string>()
  const out: Value[] = []
  for (const value of values) {
    const key = stable(value)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// Expressions

export const evaluate = (context: Context, binding: Binding, item: Expr): Value => {
  switch (item.kind) {
    case 'literal': return item.value
    case 'param': {
      if (!(item.name in context.params)) {
        throw new CypherError('run', `no parameter $${item.name} was given`, context.cypher)
      }
      return context.params[item.name] ?? null
    }
    case 'variable': {
      const bound = binding.get(item.name)
      if (!bound) return null
      if (bound.kind === 'value') return bound.value
      // a node or a relationship used as a value is only ever compared or collected, and its identity
      // is what matters there, so its record sequence stands in for it
      return bound.kind === 'node' ? `node#${bound.node.seq}` : `edge#${bound.edge.seq}`
    }
    case 'property': {
      if (item.target.kind === 'variable') {
        const bound = binding.get(item.target.name)
        if (!bound) return null
        if (bound.kind === 'node') return copyOut(bound.node.props[item.name] ?? null)
        if (bound.kind === 'edge') return copyOut(bound.edge.props[item.name] ?? null)
        const value = bound.value
        if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
          return copyOut((value as Record<string, Value>)[item.name] ?? null)
        }
        return null
      }
      const target = evaluate(context, binding, item.target)
      if (target !== null && typeof target === 'object' && !Array.isArray(target) && !(target instanceof Date)) {
        return copyOut((target as Record<string, Value>)[item.name] ?? null)
      }
      return null
    }
    case 'list': return item.items.map(entry => evaluate(context, binding, entry))
    case 'struct': {
      const out: Record<string, Value> = {}
      for (const entry of item.entries) out[entry.name] = evaluate(context, binding, entry.value)
      return out
    }
    case 'cast': return castTo(context, evaluate(context, binding, item.value), item)
    case 'case': {
      for (const branch of item.whens) {
        if (evaluate(context, binding, branch.when) === true) return evaluate(context, binding, branch.then)
      }
      return item.otherwise ? evaluate(context, binding, item.otherwise) : null
    }
    case 'not': {
      const value = evaluate(context, binding, item.value)
      return value === null ? null : value !== true
    }
    case 'and': {
      const left = evaluate(context, binding, item.left)
      if (left === false) return false
      const right = evaluate(context, binding, item.right)
      if (right === false) return false
      return left === null || right === null ? null : true
    }
    case 'or': {
      const left = evaluate(context, binding, item.left)
      if (left === true) return true
      const right = evaluate(context, binding, item.right)
      if (right === true) return true
      return left === null || right === null ? null : false
    }
    case 'compare': return compare(context, binding, item)
    case 'in': {
      const value = evaluate(context, binding, item.value)
      const list = evaluate(context, binding, item.list)
      if (list === null || !Array.isArray(list)) return null
      if (value === null) return null
      let unknown = false
      for (const entry of list) {
        const same = equals(value, entry)
        if (same === true) return true
        if (same === null) unknown = true
      }
      return unknown ? null : false
    }
    case 'startsWith': {
      const value = evaluate(context, binding, item.value)
      const prefix = evaluate(context, binding, item.prefix)
      if (typeof value !== 'string' || typeof prefix !== 'string') return null
      return value.startsWith(prefix)
    }
    case 'isNull': {
      const value = evaluate(context, binding, item.value)
      return item.negated ? value !== null : value === null
    }
    case 'exists': {
      let found: Binding[] = [binding]
      for (const pattern of item.pattern) found = found.flatMap(one => expand(context, one, pattern))
      const kept = item.where
        ? found.filter(one => evaluate(context, one, item.where!) === true)
        : found
      return item.negated ? kept.length === 0 : kept.length > 0
    }
    case 'call': return call(context, binding, item)
  }
}

const compare = (context: Context, binding: Binding, item: Extract<Expr, { kind: 'compare' }>): Value => {
  const left = evaluate(context, binding, item.left)
  const right = evaluate(context, binding, item.right)
  if (item.op === '=') return equals(left, right)
  if (item.op === '<>') {
    const same = equals(left, right)
    return same === null ? null : !same
  }
  if (left === null || right === null) return null
  const order = compareValues(left, right)
  switch (item.op) {
    case '<': return order < 0
    case '<=': return order <= 0
    case '>': return order > 0
    case '>=': return order >= 0
  }
}

const castTo = (context: Context, value: Value, item: Extract<Expr, { kind: 'cast' }>): Value =>
  castValue(value, item.to, context.cypher)

const call = (context: Context, binding: Binding, item: Extract<Expr, { kind: 'call' }>): Value => {
  const args = item.args.map(argument => evaluate(context, binding, argument))
  switch (item.name) {
    case 'coalesce': return args.find(value => value !== null) ?? null
    case 'size': {
      const value = args[0]
      if (value === null || value === undefined) return null
      if (Array.isArray(value)) return value.length
      if (typeof value === 'string') return value.length
      return null
    }
    case 'current_timestamp': return new Date()
    case 'string_split': {
      const [value, separator] = args
      if (typeof value !== 'string' || typeof separator !== 'string') return null
      const parts = value.split(separator)
      return parts.length ? parts : null
    }
    case 'map': {
      const [keys, values] = args
      if (!Array.isArray(keys) || !Array.isArray(values)) return null
      const out: Record<string, Value> = {}
      keys.forEach((key, index) => { out[String(key)] = values[index] ?? null })
      return out
    }
    case 'json_extract': {
      const [text, path] = args
      if (typeof text !== 'string' || typeof path !== 'string') return null
      try {
        const parsed = JSON.parse(text) as Value
        const name = path.replace(/^\$\.?/, '')
        if (!name) return text
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const found = (parsed as Record<string, Value>)[name]
        // JSON IN, JSON OUT: extracting a string member answers `"RUN"` WITH its quotes, not `RUN`.
        // The reference does this and `plugins/profile.ts` reads the result as JSON text, so handing
        // back the decoded value would look right in a log and be wrong at every call site.
        return found === undefined ? null : JSON.stringify(found)
      } catch { return null }
    }
    default:
      if (AGGREGATES.has(item.name)) {
        // an aggregate outside a RETURN is not a thing this store implements, and silently treating
        // it as a scalar would answer something plausible and wrong
        throw notSupported(`the aggregate ${item.name} outside RETURN`, context.cypher)
      }
      throw notSupported(`the function ${item.name}`, context.cypher)
  }
}
