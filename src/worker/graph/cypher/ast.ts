/**
 * The syntax tree for the Cypher subset this store implements.
 *
 * THE SUBSET IS CLOSED AND DELIBERATELY SMALL. It is not a step toward a general Cypher engine: it is
 * exactly the grammar the app issues, derived by reading all 154 runtime statements. Anything outside
 * it is refused at BIND TIME with a message naming the construct, so an unmet need arrives as
 * `not supported: OPTIONAL MATCH in a subquery` rather than as a wrong answer. That refusal is the
 * feature. A store that silently did something reasonable with a construct nobody checked is how a
 * query engine becomes untrustworthy.
 *
 * Every node here is a plain data object with a `kind` tag and no methods, so the tree can be logged,
 * compared and snapshotted in a test without a custom serializer.
 */

// ---------------------------------------------------------------------------------------------
// Types and literals

/** The column types the schema declares. `MAP` is only ever `MAP(STRING, INT64)` in this app. */
export type ColumnType =
  | { kind: 'STRING' }
  | { kind: 'INT64' }
  | { kind: 'DOUBLE' }
  | { kind: 'BOOLEAN' }
  | { kind: 'JSON' }
  | { kind: 'TIMESTAMP' }
  | { kind: 'LIST', of: ColumnType }
  | { kind: 'MAP', key: ColumnType, value: ColumnType }

// ---------------------------------------------------------------------------------------------
// Expressions

export type Expr =
  | { kind: 'literal', value: string | number | boolean | null }
  /** `$name`. Params are substituted at run time, never at parse time, so one parse serves every call. */
  | { kind: 'param', name: string }
  /** A bound pattern variable: a node, a relationship, or an UNWIND item. */
  | { kind: 'variable', name: string }
  /** `x.prop`. On a node or relationship this is a column; on a map or an UNWIND row it is a field. */
  | { kind: 'property', target: Expr, name: string }
  | { kind: 'list', items: Expr[] }
  /** `{a: 1, b: $x}`: a struct literal, which `collect(DISTINCT {...})` and `map()` both build. */
  | { kind: 'struct', entries: { name: string, value: Expr }[] }
  | { kind: 'call', name: string, args: Expr[], distinct: boolean, star: boolean }
  | { kind: 'cast', value: Expr, to: ColumnType }
  | { kind: 'case', whens: { when: Expr, then: Expr }[], otherwise: Expr | undefined }
  | { kind: 'not', value: Expr }
  | { kind: 'and', left: Expr, right: Expr }
  | { kind: 'or', left: Expr, right: Expr }
  | { kind: 'compare', op: CompareOp, left: Expr, right: Expr }
  | { kind: 'in', value: Expr, list: Expr }
  | { kind: 'startsWith', value: Expr, prefix: Expr }
  | { kind: 'isNull', value: Expr, negated: boolean }
  /** `EXISTS { MATCH ... }` and its negation: a pattern predicate, evaluated against live state. */
  | { kind: 'exists', pattern: Pattern[], where: Expr | undefined, negated: boolean }

export type CompareOp = '=' | '<>' | '<' | '<=' | '>' | '>='

// ---------------------------------------------------------------------------------------------
// Patterns

/** `(v:Label {k: expr})`. Every part is optional except the parentheses. */
export type NodePattern = {
  variable: string | undefined
  label: string | undefined
  properties: { name: string, value: Expr }[]
}

export type Direction = 'right' | 'left' | 'undirected'

/** `-[v:TYPE {k: expr}]->`. `range` is the tests-only variable length form (see the binder). */
export type RelPattern = {
  variable: string | undefined
  type: string | undefined
  direction: Direction
  properties: { name: string, value: Expr }[]
  /**
   * `*0..8 (r, _ | WHERE r.kind = 'SAME_AS')`, which appears in TESTS only and is refused at bind.
   *
   * The two variable names are carried rather than dropped, even though nothing executes this yet.
   * The filter is written against them, so a tree that kept only the expression would force whoever
   * implements it to hard-code the convention that the relationship is spelled `r`. Every call site
   * in this repo does spell it `(r, _)`, which is exactly the kind of accident that reads as a rule
   * until the first statement spells it otherwise and is evaluated against an unbound name.
   */
  range: {
    min: number
    max: number
    relVariable: string | undefined
    nodeVariable: string | undefined
    filter: Expr | undefined
  } | undefined
}

/** A chain: a node, then zero or more (relationship, node) steps. */
export type Pattern = {
  start: NodePattern
  steps: { rel: RelPattern, node: NodePattern }[]
}

// ---------------------------------------------------------------------------------------------
// Clauses

export type ReadingClause =
  | { kind: 'unwind', source: Expr, as: string }
  | { kind: 'match', optional: boolean, patterns: Pattern[], where: Expr | undefined }
  | { kind: 'with', items: ReturnItem[], where: Expr | undefined }

export type Assignment = { target: Expr, value: Expr }

export type UpdatingClause =
  | { kind: 'create', patterns: Pattern[] }
  | { kind: 'merge', node: NodePattern, onCreate: Assignment[], onMatch: Assignment[] }
  | { kind: 'set', assignments: Assignment[] }
  | { kind: 'delete', targets: Expr[], detach: boolean }

export type ReturnItem = { value: Expr, as: string }

export type OrderKey = { value: Expr, descending: boolean }

export type ReturnClause = {
  distinct: boolean
  items: ReturnItem[]
  orderBy: OrderKey[]
  limit: number | undefined
}

// ---------------------------------------------------------------------------------------------
// Statements

/** One declared column. `primaryKey` is at most one per node table and never on a rel table. */
export type ColumnDecl = {
  name: string
  type: ColumnType
  primaryKey: boolean
  /** `DEFAULT current_timestamp()`, the only default the schema uses. */
  defaultTo: Expr | undefined
}

export type CreateNodeTable = {
  kind: 'createNodeTable'
  name: string
  ifNotExists: boolean
  columns: ColumnDecl[]
}

export type CreateRelTable = {
  kind: 'createRelTable'
  name: string
  ifNotExists: boolean
  /** Every declared `FROM A TO B`. A rel table may declare several, and several are used. */
  pairs: { from: string, to: string }[]
  columns: ColumnDecl[]
}

export type Query = {
  kind: 'query'
  reading: ReadingClause[]
  updating: UpdatingClause[]
  returning: ReturnClause | undefined
}

/** `CALL show_tables() RETURN *`, which one test uses to enumerate the schema. */
export type ShowTables = { kind: 'showTables' }

export type Statement = CreateNodeTable | CreateRelTable | Query | ShowTables

// ---------------------------------------------------------------------------------------------

/**
 * The one error type this library throws, so a caller can tell a statement it refused from a bug.
 *
 * `phase` says WHERE it was refused, which is the difference between "this store does not implement
 * that" and "that statement is wrong". A caller seeing `bind` knows the subset needs extending; a
 * caller seeing `run` has a data problem.
 */
export class CypherError extends Error {
  readonly phase: 'parse' | 'bind' | 'run'
  readonly statement: string

  constructor (phase: 'parse' | 'bind' | 'run', message: string, statement: string) {
    super(message)
    this.name = 'CypherError'
    this.phase = phase
    this.statement = statement
  }
}

/** The refusal every unimplemented construct goes through, so they all read alike and are greppable. */
export const notSupported = (construct: string, statement: string): CypherError =>
  new CypherError('bind', `not supported: ${construct}`, statement)
