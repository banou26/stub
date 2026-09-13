import type { Row, Value } from './values'

import { applyNodeTable, applyRelTable, showTables } from './ddl'
import { bind } from './binder'
import { CypherError } from './ast'
import { execute } from './executor'
import { parse } from './parser'
import { Store } from './storage'

export type { Row, Value } from './values'
export { CypherError } from './ast'

/**
 * An in-process Cypher store: the whole public surface of this library is below.
 *
 * `createCypherStore()` hands back one store and a `query` over it. That is the entire API, and it is
 * shaped to match what `src/worker/graph/engine.ts` already hands every caller, so the engine
 * underneath the app can be swapped without a single call site changing.
 *
 * WHAT IT IS FOR. The app keeps a graph of about 8,000 rows and asks it a few thousand small
 * questions per page. The previous engine was a wasm database in its own worker, which charged about
 * 2.2 ms and six round trips for any statement whatever it did, and the app exported its whole graph
 * across that boundary 21 times per page load. Nothing here is faster at databases; it is simply on
 * the same side of the wall as its caller.
 *
 * WHAT IT IS NOT. Not a general Cypher engine and not a step toward one. The grammar in `./ast.ts` is
 * closed, derived from the 142 statements the app issues, and anything outside it is refused by name
 * rather than approximated. There is no query planner: a primary key lookup is a `Map` read and
 * everything else is a scan, which is the right answer at this size and stops being the right answer
 * somewhere north of a million rows.
 *
 * WHAT IT PROMISES, beyond answering correctly:
 * - ONE STATEMENT IS ALL OR NOTHING. A batch whose thousandth row fails its type check leaves the
 *   store exactly as it was, because the caller will retry the batch and half-applied rows would then
 *   collide (see the undo log in `./storage.ts`).
 * - ROW ORDER IS DETERMINISTIC. Natural order is insertion order throughout, so the same history of
 *   writes gives the same sequence every time. The engine this replaces did not have that property:
 *   the same statement over the same graph returned between 4 and 15 distinct orders across 20 to 40
 *   runs. A statement carrying ORDER BY is sorted stably on top of natural order, so ties are total.
 * - REFUSALS ARE LOUD AND NAMED. Every unimplemented construct throws a `CypherError` whose message
 *   names it, so an unmet need is a one line fix in a known place rather than a wrong answer.
 */
export type CypherStore = {
  query: (cypher: string, params?: Record<string, unknown>) => Promise<Row[]>
  /** Every declared table, for a boot log or a test. */
  tables: () => { name: string, kind: 'node' | 'rel' }[]
  close: () => void
}

/**
 * The statement cache: parse and bind once, run many times.
 *
 * Statements in this app are module constants issued thousands of times per page with different
 * parameters, so parsing is pure overhead after the first call. Keyed on the text, which is what
 * makes it safe: two callers sharing a string share a tree, and a generated statement that differs
 * by one character is a different entry rather than a wrong hit.
 */
const CACHE_LIMIT = 500

export const createCypherStore = (): CypherStore => {
  const store = new Store()
  const cache = new Map<string, ReturnType<typeof parse>>()

  const compiled = (cypher: string) => {
    const found = cache.get(cypher)
    if (found) return found
    const statement = parse(cypher)
    if (statement.kind === 'query') bind(store, statement, cypher)
    // a plain cap rather than an LRU: the app issues a bounded set of statements, so this only ever
    // trims a test that generates them, and evicting the oldest is as good a rule as any there
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    cache.set(cypher, statement)
    return statement
  }

  const run = (cypher: string, params: Record<string, unknown>): Row[] => {
    const statement = compiled(cypher)
    switch (statement.kind) {
      case 'createNodeTable': return applyNodeTable(store, statement, cypher)
      case 'createRelTable': return applyRelTable(store, statement, cypher)
      case 'showTables': return showTables(store)
      case 'query':
        // EVERY statement goes through the undo log, reads included. A read cannot fail half way in a
        // way that matters, but a statement that both reads and writes can, and telling them apart
        // here would be a rule to get wrong for no gain: an unused log costs one array.
        return store.transact(() => execute({ store, params: params as Record<string, Value>, cypher }, statement))
    }
  }

  return {
    query: async (cypher, params = {}) => {
      try {
        return run(cypher, params)
      } catch (error) {
        // THE STATEMENT IS ADDED HERE, at the boundary, and nowhere inside. A refusal names a column
        // or a construct, not the statement it came from, and every caller reads `error.message`
        // rather than a field: `engine.ts` wrapped LadybugDB exactly this way and
        // `engine.test.ts` asserts the statement is in the text. Keeping the decoration out of
        // `CypherError` leaves the library's own messages comparable in its own tests.
        const reason = error instanceof Error ? error.message : String(error)
        const phase = error instanceof CypherError ? error.phase : 'run'
        throw new CypherError(phase, `${reason} (statement: ${cypher.slice(0, 120)})`, cypher)
      }
    },
    tables: () => store.all().map(table => ({ name: table.name, kind: table.kind })),
    close: () => { cache.clear() },
  }
}
