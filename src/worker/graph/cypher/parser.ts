/**
 * The parser: one Cypher statement in, one `Statement` from `ast.ts` out.
 *
 * A RECURSIVE DESCENT PARSER OVER A CLOSED GRAMMAR. It is not a Cypher front end with features
 * missing: it accepts exactly the shapes the app issues, and every other shape leaves through one of
 * two doors, both of which NAME what they refused.
 *
 * - `CypherError` with `phase: 'parse'` is for text that is not in the grammar: a missing bracket, a
 *   relationship written `-->`, a character no token starts with.
 * - `notSupported(construct)` from `ast.ts` is for text that is well formed Cypher, would be
 *   understood by a full engine, and this subset does not implement: `SKIP`, `RETURN *` outside
 *   `CALL show_tables()`, a second label on a node, `CALL` of anything else. The reader then knows
 *   the statement is right and the store is small, which is a different repair from a typo.
 *
 * TWO DECISIONS A CALLER CAN SEE, both made here so they are made once.
 *
 * A FUNCTION NAME IS LOWERCASED. `count`, `Count` and `COUNT` produce the same `call` node, so the
 * binder compares against one spelling and can never disagree with itself about case. The parser
 * does NOT check that the name exists: which functions can be evaluated is the binder's list, and a
 * second list here would rot the moment the two differed.
 *
 * AN UN-ALIASED PROJECTION TAKES ITS SOURCE TEXT AS ITS NAME. `WITH m, count(c) AS n` names its
 * first column `m`, and a hypothetical `RETURN a.uri` would name its column `a.uri`, which is what
 * the engine being replaced does. Every projection therefore has a name, and `ReturnItem.as` never
 * has to be optional.
 */
import type {
  Assignment,
  ColumnDecl,
  ColumnType,
  CompareOp,
  Direction,
  Expr,
  NodePattern,
  OrderKey,
  Pattern,
  ReadingClause,
  RelPattern,
  ReturnClause,
  ReturnItem,
  Statement,
  UpdatingClause,
} from './ast'
import type { Token } from './lexer'

import { CypherError, notSupported } from './ast'
import { tokenize } from './lexer'

/**
 * Parses one statement, or throws `CypherError` naming what it refused.
 *
 * The result is a plain tree: no position information survives, because everything that reads a tree
 * reports against the statement text it already holds.
 */
export const parse = (statement: string): Statement => {
  const cursor: Cursor = { statement, tokens: tokenize(statement), index: 0 }
  const parsed = parseStatement(cursor)
  if (peek(cursor).kind !== 'end') refuseTrailing(cursor)
  return parsed
}

// ---------------------------------------------------------------------------------------------
// The cursor, and the primitives every rule below is written in terms of.

type Cursor = {
  readonly statement: string
  readonly tokens: readonly Token[]
  index: number
}

const peek = (cursor: Cursor, ahead = 0): Token =>
  cursor.tokens[Math.min(cursor.index + ahead, cursor.tokens.length - 1)]!

const advance = (cursor: Cursor): Token => {
  const token = peek(cursor)
  if (token.kind !== 'end') cursor.index += 1
  return token
}

const atWord = (cursor: Cursor, upper: string, ahead = 0): boolean => {
  const token = peek(cursor, ahead)
  return token.kind === 'word' && token.upper === upper
}

const atSymbol = (cursor: Cursor, text: string, ahead = 0): boolean => {
  const token = peek(cursor, ahead)
  return token.kind === 'symbol' && token.text === text
}

const skipWord = (cursor: Cursor, upper: string): boolean => {
  if (!atWord(cursor, upper)) return false
  cursor.index += 1
  return true
}

const skipSymbol = (cursor: Cursor, text: string): boolean => {
  if (!atSymbol(cursor, text)) return false
  cursor.index += 1
  return true
}

const expectWord = (cursor: Cursor, upper: string, where: string): void => {
  if (!skipWord(cursor, upper)) fail(cursor, `expected ${upper} ${where}`)
}

const expectSymbol = (cursor: Cursor, text: string, where: string): void => {
  if (!skipSymbol(cursor, text)) fail(cursor, `expected ${text} ${where}`)
}

/** Any word at all, which is how an identifier is read: no keyword is reserved (see `lexer.ts`). */
const identifier = (cursor: Cursor, what: string): string => {
  const token = peek(cursor)
  if (token.kind !== 'word') fail(cursor, `expected ${what}`)
  cursor.index += 1
  return token.text
}

const fail = (cursor: Cursor, message: string): never => {
  const token = peek(cursor)
  const saw = token.kind === 'end'
    ? 'the end of the statement'
    : JSON.stringify(cursor.statement.slice(token.start, token.end))
  throw new CypherError('parse', `${message}, saw ${saw} at ${token.start}`, cursor.statement)
}

// Clauses a full Cypher engine has and this subset does not. Naming them is the whole point: a
// statement opening with COPY is a correct statement this store cannot run, and "expected a
// statement" would send the reader looking for a typo that is not there.
const UNSUPPORTED_CLAUSES = new Set([
  'ALTER', 'ATTACH', 'CALL', 'COPY', 'DROP', 'EXPORT', 'FOREACH', 'IMPORT', 'INSTALL', 'LOAD',
  'REMOVE', 'SKIP', 'UNION', 'USE',
])

const refuseTrailing = (cursor: Cursor): never => {
  const token = peek(cursor)
  if (token.kind === 'symbol' && token.text === ';') {
    throw notSupported('several statements in one string', cursor.statement)
  }
  if (token.kind === 'word' && UNSUPPORTED_CLAUSES.has(token.upper)) {
    throw notSupported(`the ${token.upper} clause`, cursor.statement)
  }
  return fail(cursor, 'expected the end of the statement')
}

// ---------------------------------------------------------------------------------------------
// Statements.

const parseStatement = (cursor: Cursor): Statement => {
  if (atWord(cursor, 'CREATE') && (atWord(cursor, 'NODE', 1) || atWord(cursor, 'REL', 1))) {
    return parseCreateTable(cursor)
  }
  if (atWord(cursor, 'CALL')) return parseProcedure(cursor)
  return parseQuery(cursor)
}

/** `CALL show_tables() RETURN *`, the one procedure the subset answers. */
const parseProcedure = (cursor: Cursor): Statement => {
  advance(cursor)
  const name = identifier(cursor, 'a procedure name after CALL')
  if (name.toLowerCase() !== 'show_tables') {
    throw notSupported(`CALL ${name}()`, cursor.statement)
  }
  expectSymbol(cursor, '(', 'after show_tables')
  expectSymbol(cursor, ')', 'after show_tables(')
  expectWord(cursor, 'RETURN', 'after CALL show_tables()')
  expectSymbol(cursor, '*', 'after RETURN, which is the only projection show_tables takes')
  return { kind: 'showTables' }
}

const parseCreateTable = (cursor: Cursor): Statement => {
  advance(cursor)
  const node = skipWord(cursor, 'NODE')
  if (!node) expectWord(cursor, 'REL', 'after CREATE, to say which kind of table')
  expectWord(cursor, 'TABLE', `after CREATE ${node ? 'NODE' : 'REL'}`)

  let ifNotExists = false
  if (skipWord(cursor, 'IF')) {
    expectWord(cursor, 'NOT', 'after IF')
    expectWord(cursor, 'EXISTS', 'after IF NOT')
    ifNotExists = true
  }

  const name = identifier(cursor, 'a table name')
  expectSymbol(cursor, '(', 'to open the table body')

  const pairs: { from: string, to: string }[] = []
  const columns: ColumnDecl[] = []
  if (!atSymbol(cursor, ')')) {
    do {
      // `FROM A TO B` only ever opens an item, so a column called `from` is still readable: it is
      // followed by its type rather than by a table name and TO
      if (atWord(cursor, 'FROM') && atWord(cursor, 'TO', 2)) {
        advance(cursor)
        const from = identifier(cursor, 'the FROM table')
        expectWord(cursor, 'TO', 'after the FROM table')
        pairs.push({ from, to: identifier(cursor, 'the TO table') })
        continue
      }
      columns.push(parseColumn(cursor))
    } while (skipSymbol(cursor, ','))
  }
  expectSymbol(cursor, ')', 'to close the table body')

  if (node) {
    if (pairs.length) fail(cursor, 'a node table cannot declare FROM ... TO')
    return { kind: 'createNodeTable', name, ifNotExists, columns }
  }
  if (!pairs.length) fail(cursor, 'a rel table must declare at least one FROM ... TO')
  return { kind: 'createRelTable', name, ifNotExists, pairs, columns }
}

const parseColumn = (cursor: Cursor): ColumnDecl => {
  const name = identifier(cursor, 'a column name')
  const type = parseColumnType(cursor)
  let primaryKey = false
  if (atWord(cursor, 'PRIMARY')) {
    advance(cursor)
    expectWord(cursor, 'KEY', 'after PRIMARY')
    primaryKey = true
  }
  const defaultTo = skipWord(cursor, 'DEFAULT') ? parseExpr(cursor) : undefined
  return { name, type, primaryKey, defaultTo }
}

const parseColumnType = (cursor: Cursor): ColumnType => {
  const token = peek(cursor)
  if (token.kind !== 'word') fail(cursor, 'expected a column type')
  cursor.index += 1

  let type: ColumnType
  switch (token.upper) {
    case 'STRING': type = { kind: 'STRING' }; break
    case 'INT64': type = { kind: 'INT64' }; break
    case 'DOUBLE': type = { kind: 'DOUBLE' }; break
    case 'BOOLEAN': type = { kind: 'BOOLEAN' }; break
    case 'JSON': type = { kind: 'JSON' }; break
    case 'TIMESTAMP': type = { kind: 'TIMESTAMP' }; break
    case 'MAP': {
      expectSymbol(cursor, '(', 'after MAP')
      const key = parseColumnType(cursor)
      expectSymbol(cursor, ',', 'between the MAP key type and its value type')
      const value = parseColumnType(cursor)
      expectSymbol(cursor, ')', 'to close MAP(')
      type = { kind: 'MAP', key, value }
      break
    }
    default:
      throw notSupported(`the column type ${token.text}`, cursor.statement)
  }

  // `STRING[]`, and `INT64[]` inside the cast the ingest writes its `fieldSeq` values with
  while (atSymbol(cursor, '[') && atSymbol(cursor, ']', 1)) {
    cursor.index += 2
    type = { kind: 'LIST', of: type }
  }
  return type
}

const parseQuery = (cursor: Cursor): Statement => {
  const reading: ReadingClause[] = []
  const updating: UpdatingClause[] = []
  let returning: ReturnClause | undefined

  const read = (clause: ReadingClause): void => {
    if (updating.length) throw notSupported('a reading clause after an updating clause', cursor.statement)
    reading.push(clause)
  }

  for (;;) {
    const token = peek(cursor)
    if (token.kind !== 'word') break

    if (token.upper === 'UNWIND') {
      read(parseUnwind(cursor))
      continue
    }
    if (token.upper === 'MATCH' || (token.upper === 'OPTIONAL' && atWord(cursor, 'MATCH', 1))) {
      read(parseMatch(cursor))
      continue
    }
    if (token.upper === 'WITH') {
      read(parseWith(cursor))
      continue
    }
    if (token.upper === 'CREATE') {
      updating.push(parseCreatePattern(cursor))
      continue
    }
    if (token.upper === 'MERGE') {
      updating.push(parseMerge(cursor))
      continue
    }
    if (token.upper === 'SET') {
      updating.push(parseSet(cursor))
      continue
    }
    if (token.upper === 'DELETE' || (token.upper === 'DETACH' && atWord(cursor, 'DELETE', 1))) {
      updating.push(parseDelete(cursor))
      continue
    }
    if (token.upper === 'RETURN') {
      returning = parseReturn(cursor)
    }
    break
  }

  if (!reading.length && !updating.length && !returning) {
    const token = peek(cursor)
    if (token.kind === 'word' && UNSUPPORTED_CLAUSES.has(token.upper)) {
      throw notSupported(`the ${token.upper} clause`, cursor.statement)
    }
    fail(cursor, 'expected a statement')
  }
  return { kind: 'query', reading, updating, returning }
}

// ---------------------------------------------------------------------------------------------
// Reading clauses.

const parseUnwind = (cursor: Cursor): ReadingClause => {
  advance(cursor)
  const source = parseExpr(cursor)
  expectWord(cursor, 'AS', 'after the UNWIND source')
  return { kind: 'unwind', source, as: identifier(cursor, 'a variable after AS') }
}

const parseMatch = (cursor: Cursor): ReadingClause => {
  const optional = skipWord(cursor, 'OPTIONAL')
  expectWord(cursor, 'MATCH', optional ? 'after OPTIONAL' : 'to open a match')
  const patterns = [parsePattern(cursor)]
  while (skipSymbol(cursor, ',')) patterns.push(parsePattern(cursor))
  const where = skipWord(cursor, 'WHERE') ? parseExpr(cursor) : undefined
  return { kind: 'match', optional, patterns, where }
}

const parseWith = (cursor: Cursor): ReadingClause => {
  advance(cursor)
  if (atWord(cursor, 'DISTINCT')) throw notSupported('WITH DISTINCT', cursor.statement)
  const items = [parseReturnItem(cursor)]
  while (skipSymbol(cursor, ',')) items.push(parseReturnItem(cursor))
  // STRICTER THAN THE ENGINE BEING REPLACED, deliberately. That one refuses `WITH ... ORDER BY` with
  // no SKIP or LIMIT ("In WITH clause, ORDER BY must be followed by SKIP or LIMIT") and accepts it
  // with one. `ReadingClause.with` has nowhere to put an ordering or a limit and no statement the app
  // issues orders in a WITH, so this names the construct rather than dropping an ordering that
  // decides which rows survive.
  if (atWord(cursor, 'ORDER')) throw notSupported('ORDER BY in a WITH clause', cursor.statement)
  const where = skipWord(cursor, 'WHERE') ? parseExpr(cursor) : undefined
  return { kind: 'with', items, where }
}

// ---------------------------------------------------------------------------------------------
// Updating clauses.

const parseCreatePattern = (cursor: Cursor): UpdatingClause => {
  advance(cursor)
  const patterns = [parsePattern(cursor)]
  while (skipSymbol(cursor, ',')) patterns.push(parsePattern(cursor))
  return { kind: 'create', patterns }
}

const parseMerge = (cursor: Cursor): UpdatingClause => {
  advance(cursor)
  const node = parseNodePattern(cursor)
  if (atSymbol(cursor, '-') || atSymbol(cursor, '<-')) {
    throw notSupported('MERGE of a relationship pattern', cursor.statement)
  }
  const onCreate: Assignment[] = []
  const onMatch: Assignment[] = []
  while (atWord(cursor, 'ON')) {
    advance(cursor)
    const into = skipWord(cursor, 'CREATE')
      ? onCreate
      : skipWord(cursor, 'MATCH') ? onMatch : fail(cursor, 'expected CREATE or MATCH after ON')
    expectWord(cursor, 'SET', 'after ON CREATE / ON MATCH')
    into.push(...parseAssignments(cursor))
  }
  return { kind: 'merge', node, onCreate, onMatch }
}

const parseSet = (cursor: Cursor): UpdatingClause => {
  advance(cursor)
  return { kind: 'set', assignments: parseAssignments(cursor) }
}

const parseAssignments = (cursor: Cursor): Assignment[] => {
  const assignments = [parseAssignment(cursor)]
  while (skipSymbol(cursor, ',')) assignments.push(parseAssignment(cursor))
  return assignments
}

const parseAssignment = (cursor: Cursor): Assignment => {
  // the target is read at the operand level rather than as an expression, so the `=` below stays an
  // assignment instead of being swallowed as a comparison
  const target = parseOperand(cursor)
  if (target.kind !== 'property' && target.kind !== 'variable') {
    fail(cursor, 'expected a variable or a property on the left of =')
  }
  expectSymbol(cursor, '=', 'in an assignment')
  return { target, value: parseExpr(cursor) }
}

const parseDelete = (cursor: Cursor): UpdatingClause => {
  const detach = skipWord(cursor, 'DETACH')
  expectWord(cursor, 'DELETE', detach ? 'after DETACH' : 'to open a delete')
  const targets = [parseOperand(cursor)]
  while (skipSymbol(cursor, ',')) targets.push(parseOperand(cursor))
  return { kind: 'delete', targets, detach }
}

// ---------------------------------------------------------------------------------------------
// The projection.

const parseReturn = (cursor: Cursor): ReturnClause => {
  advance(cursor)
  const distinct = skipWord(cursor, 'DISTINCT')
  if (atSymbol(cursor, '*')) throw notSupported('RETURN *', cursor.statement)

  const items = [parseReturnItem(cursor)]
  while (skipSymbol(cursor, ',')) items.push(parseReturnItem(cursor))

  const orderBy: OrderKey[] = []
  if (skipWord(cursor, 'ORDER')) {
    expectWord(cursor, 'BY', 'after ORDER')
    do {
      const value = parseExpr(cursor)
      const descending = skipWord(cursor, 'DESC')
      if (!descending) skipWord(cursor, 'ASC')
      orderBy.push({ value, descending })
    } while (skipSymbol(cursor, ','))
  }

  let limit: number | undefined
  if (skipWord(cursor, 'LIMIT')) {
    const token = peek(cursor)
    if (token.kind !== 'number') throw notSupported('LIMIT with anything but a number', cursor.statement)
    cursor.index += 1
    limit = Number(token.text)
  }
  return { distinct, items, orderBy, limit }
}

const parseReturnItem = (cursor: Cursor): ReturnItem => {
  const start = peek(cursor).start
  const value = parseExpr(cursor)
  const end = cursor.tokens[cursor.index - 1]?.end ?? start
  if (skipWord(cursor, 'AS')) return { value, as: identifier(cursor, 'an alias after AS') }
  return { value, as: cursor.statement.slice(start, end) }
}

// ---------------------------------------------------------------------------------------------
// Patterns.

const parsePattern = (cursor: Cursor): Pattern => {
  const start = parseNodePattern(cursor)
  const steps: { rel: RelPattern, node: NodePattern }[] = []
  while (atSymbol(cursor, '-') || atSymbol(cursor, '<-')) {
    const rel = parseRelPattern(cursor)
    steps.push({ rel, node: parseNodePattern(cursor) })
  }
  return { start, steps }
}

const parseNodePattern = (cursor: Cursor): NodePattern => {
  expectSymbol(cursor, '(', 'to open a node pattern')
  const variable = peek(cursor).kind === 'word' ? identifier(cursor, 'a variable') : undefined
  let label: string | undefined
  if (skipSymbol(cursor, ':')) {
    label = identifier(cursor, 'a label after :')
    if (atSymbol(cursor, ':')) throw notSupported('a node pattern with several labels', cursor.statement)
  }
  const properties = atSymbol(cursor, '{') ? parseEntries(cursor) : []
  expectSymbol(cursor, ')', 'to close a node pattern')
  return { variable, label, properties }
}

const parseRelPattern = (cursor: Cursor): RelPattern => {
  const leftward = skipSymbol(cursor, '<-')
  if (!leftward) expectSymbol(cursor, '-', 'to open a relationship pattern')
  expectSymbol(cursor, '[', 'after -, since every relationship in this subset is written -[...]-')

  const variable = peek(cursor).kind === 'word' ? identifier(cursor, 'a variable') : undefined
  let type: string | undefined
  if (skipSymbol(cursor, ':')) {
    type = identifier(cursor, 'a relationship type after :')
    if (atSymbol(cursor, '|')) {
      throw notSupported('a relationship pattern with several types', cursor.statement)
    }
  }
  const range = atSymbol(cursor, '*') ? parseRange(cursor) : undefined
  const properties = atSymbol(cursor, '{') ? parseEntries(cursor) : []
  expectSymbol(cursor, ']', 'to close a relationship pattern')

  const rightward = skipSymbol(cursor, '->')
  if (!rightward) expectSymbol(cursor, '-', 'to close a relationship pattern')
  if (leftward && rightward) fail(cursor, 'a relationship cannot point both ways')
  const direction: Direction = leftward ? 'left' : rightward ? 'right' : 'undirected'

  return { variable, type, direction, properties, range }
}

/**
 * `*0..8 (r, _ | WHERE r.kind = 'SAME_AS')`, the variable length form.
 *
 * An OPEN range (`*`, `*2..`) is refused rather than given an invented ceiling: `range.max` is a
 * number, and writing `Infinity` there would read downstream as a bound somebody measured.
 *
 * The filter's two variable names are KEPT. They are what the filter expression is written against,
 * and a tree that dropped them would force the binder to assume the `(r, _)` spelling every call site
 * in this repo happens to use. An assumption that is true of every existing caller is exactly the
 * kind that reads as a rule right up until it is not.
 */
const parseRange = (cursor: Cursor): NonNullable<RelPattern['range']> => {
  advance(cursor)
  const lower = peek(cursor)
  if (lower.kind !== 'number') fail(cursor, 'expected a lower bound after * in a variable length relationship')
  cursor.index += 1
  const min = Number(lower.text)

  let max = min
  if (skipSymbol(cursor, '..')) {
    const upper = peek(cursor)
    if (upper.kind !== 'number') {
      throw notSupported('a variable length relationship with no upper bound', cursor.statement)
    }
    cursor.index += 1
    max = Number(upper.text)
  }

  let filter: Expr | undefined
  let relVariable: string | undefined
  let nodeVariable: string | undefined
  if (skipSymbol(cursor, '(')) {
    relVariable = identifier(cursor, 'the relationship variable of a variable length filter')
    expectSymbol(cursor, ',', 'between the two variables of a variable length filter')
    nodeVariable = identifier(cursor, 'the node variable of a variable length filter')
    expectSymbol(cursor, '|', 'after the variables of a variable length filter')
    expectWord(cursor, 'WHERE', 'to open a variable length filter')
    filter = parseExpr(cursor)
    expectSymbol(cursor, ')', 'to close a variable length filter')
  }
  return { min, max, relVariable, nodeVariable, filter }
}

/** `{k: expr, ...}`, which is a property map on a pattern and a struct literal in an expression. */
const parseEntries = (cursor: Cursor): { name: string, value: Expr }[] => {
  expectSymbol(cursor, '{', 'to open a property map')
  const entries: { name: string, value: Expr }[] = []
  if (!atSymbol(cursor, '}')) {
    do {
      const name = identifier(cursor, 'a property name')
      expectSymbol(cursor, ':', 'after a property name')
      entries.push({ name, value: parseExpr(cursor) })
    } while (skipSymbol(cursor, ','))
  }
  expectSymbol(cursor, '}', 'to close a property map')
  return entries
}

// ---------------------------------------------------------------------------------------------
// Expressions, loosest binding first: OR, AND, NOT, then one comparison, then an operand.

const ARITHMETIC = new Set(['+', '-', '*', '/', '%'])

const parseExpr = (cursor: Cursor): Expr => {
  const value = parseOr(cursor)
  const token = peek(cursor)
  // a complete expression followed by an operator can only be arithmetic: a pattern's own '-' is
  // read by parsePattern, and count(*)'s '*' never reaches here
  if (token.kind === 'symbol' && ARITHMETIC.has(token.text)) {
    throw notSupported(`arithmetic (${token.text}) in an expression`, cursor.statement)
  }
  return value
}

const parseOr = (cursor: Cursor): Expr => {
  let left = parseAnd(cursor)
  while (skipWord(cursor, 'OR')) left = { kind: 'or', left, right: parseAnd(cursor) }
  if (atWord(cursor, 'XOR')) throw notSupported('XOR', cursor.statement)
  return left
}

const parseAnd = (cursor: Cursor): Expr => {
  let left = parseNot(cursor)
  while (skipWord(cursor, 'AND')) left = { kind: 'and', left, right: parseNot(cursor) }
  return left
}

const parseNot = (cursor: Cursor): Expr => {
  if (!atWord(cursor, 'NOT')) return parseComparison(cursor)
  // NOT EXISTS is ONE node rather than a negation wrapped around one: `ast.ts` gives `exists` its own
  // `negated` field, so a reader never has to match two shapes for the same predicate
  if (atWord(cursor, 'EXISTS', 1)) {
    cursor.index += 2
    return parseExists(cursor, true)
  }
  advance(cursor)
  return { kind: 'not', value: parseNot(cursor) }
}

const COMPARISONS: Record<string, CompareOp> = {
  '=': '=', '<>': '<>', '<': '<', '<=': '<=', '>': '>', '>=': '>=',
}

const parseComparison = (cursor: Cursor): Expr => {
  const left = parseOperand(cursor)

  if (atWord(cursor, 'IS')) {
    advance(cursor)
    const negated = skipWord(cursor, 'NOT')
    expectWord(cursor, 'NULL', negated ? 'after IS NOT' : 'after IS')
    return { kind: 'isNull', value: left, negated }
  }
  if (skipWord(cursor, 'IN')) return { kind: 'in', value: left, list: parseOperand(cursor) }
  if (atWord(cursor, 'STARTS')) {
    advance(cursor)
    expectWord(cursor, 'WITH', 'after STARTS')
    return { kind: 'startsWith', value: left, prefix: parseOperand(cursor) }
  }
  if (atWord(cursor, 'ENDS')) throw notSupported('ENDS WITH', cursor.statement)
  if (atWord(cursor, 'CONTAINS')) throw notSupported('CONTAINS', cursor.statement)

  const token = peek(cursor)
  const op = token.kind === 'symbol' ? COMPARISONS[token.text] : undefined
  if (!op) return left
  cursor.index += 1
  // comparisons do not chain: `a = b = c` is not in the grammar, so the right hand side is an
  // operand rather than another comparison
  return { kind: 'compare', op, left, right: parseOperand(cursor) }
}

const parseOperand = (cursor: Cursor): Expr => {
  let value = parsePrimary(cursor)
  while (skipSymbol(cursor, '.')) {
    value = { kind: 'property', target: value, name: identifier(cursor, 'a property name after .') }
  }
  return value
}

const parsePrimary = (cursor: Cursor): Expr => {
  const token = peek(cursor)

  if (token.kind === 'number') {
    cursor.index += 1
    return { kind: 'literal', value: Number(token.text) }
  }
  if (token.kind === 'string') {
    cursor.index += 1
    return { kind: 'literal', value: token.text }
  }
  if (token.kind === 'param') {
    cursor.index += 1
    return { kind: 'param', name: token.text }
  }

  if (token.kind === 'symbol') {
    if (token.text === '(') {
      cursor.index += 1
      const inner = parseExpr(cursor)
      expectSymbol(cursor, ')', 'to close a parenthesised expression')
      return inner
    }
    if (token.text === '[') {
      cursor.index += 1
      const items: Expr[] = []
      if (!atSymbol(cursor, ']')) {
        do items.push(parseExpr(cursor))
        while (skipSymbol(cursor, ','))
      }
      expectSymbol(cursor, ']', 'to close a list')
      return { kind: 'list', items }
    }
    if (token.text === '{') return { kind: 'struct', entries: parseEntries(cursor) }
    if (token.text === '-') {
      // a negative literal, which is the only place a sign appears: there is no arithmetic
      const number = peek(cursor, 1)
      if (number.kind !== 'number') fail(cursor, 'expected an expression')
      cursor.index += 2
      return { kind: 'literal', value: -Number(number.text) }
    }
    return fail(cursor, 'expected an expression')
  }

  if (token.kind === 'word') {
    switch (token.upper) {
      case 'TRUE': cursor.index += 1; return { kind: 'literal', value: true }
      case 'FALSE': cursor.index += 1; return { kind: 'literal', value: false }
      case 'NULL': cursor.index += 1; return { kind: 'literal', value: null }
      case 'CASE': return parseCase(cursor)
      case 'EXISTS':
        cursor.index += 1
        return parseExists(cursor, false)
      default: break
    }
    if (atSymbol(cursor, '(', 1)) return parseFunction(cursor)
    cursor.index += 1
    return { kind: 'variable', name: token.text }
  }

  return fail(cursor, 'expected an expression')
}

const parseFunction = (cursor: Cursor): Expr => {
  const name = identifier(cursor, 'a function name').toLowerCase()
  expectSymbol(cursor, '(', 'after a function name')

  if (name === 'cast') {
    const value = parseExpr(cursor)
    expectWord(cursor, 'AS', 'inside cast(...)')
    const to = parseColumnType(cursor)
    expectSymbol(cursor, ')', 'to close cast(')
    return { kind: 'cast', value, to }
  }

  let star = false
  let distinct = false
  const args: Expr[] = []
  if (skipSymbol(cursor, '*')) {
    star = true
  } else if (!atSymbol(cursor, ')')) {
    distinct = skipWord(cursor, 'DISTINCT')
    do args.push(parseExpr(cursor))
    while (skipSymbol(cursor, ','))
  }
  expectSymbol(cursor, ')', `to close ${name}(`)
  return { kind: 'call', name, args, distinct, star }
}

const parseCase = (cursor: Cursor): Expr => {
  advance(cursor)
  if (!atWord(cursor, 'WHEN')) throw notSupported('CASE over a value (CASE x WHEN ...)', cursor.statement)
  const whens: { when: Expr, then: Expr }[] = []
  while (skipWord(cursor, 'WHEN')) {
    const when = parseExpr(cursor)
    expectWord(cursor, 'THEN', 'after a CASE condition')
    whens.push({ when, then: parseExpr(cursor) })
  }
  const otherwise = skipWord(cursor, 'ELSE') ? parseExpr(cursor) : undefined
  expectWord(cursor, 'END', 'to close CASE')
  return { kind: 'case', whens, otherwise }
}

/** `EXISTS { MATCH Pattern [WHERE Expr] }`, with EXISTS already consumed by the caller. */
const parseExists = (cursor: Cursor, negated: boolean): Expr => {
  if (atSymbol(cursor, '(')) throw notSupported('EXISTS over an expression', cursor.statement)
  expectSymbol(cursor, '{', 'to open an EXISTS subquery')
  if (atWord(cursor, 'OPTIONAL')) throw notSupported('OPTIONAL MATCH in a subquery', cursor.statement)
  expectWord(cursor, 'MATCH', 'inside an EXISTS subquery, which holds one MATCH and nothing else')
  const pattern = [parsePattern(cursor)]
  while (skipSymbol(cursor, ',')) pattern.push(parsePattern(cursor))
  const where = skipWord(cursor, 'WHERE') ? parseExpr(cursor) : undefined
  expectSymbol(cursor, '}', 'to close an EXISTS subquery')
  return { kind: 'exists', pattern, where, negated }
}
