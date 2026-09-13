import type { GraphRow } from './engine'

/**
 * Which engine answers a statement, and the DIFFERENTIAL mode that is the whole point of this file.
 *
 * LadybugDB is being replaced by an in-process Cypher interpreter (`./cypher/`). The replacement is a
 * query engine, so reading it carefully is not how you establish that it agrees with the thing it
 * replaces. Running both on every statement the app and the suites issue, and comparing the rows, is.
 * That is `diff` mode, and it exists so a divergence is reported the moment it happens, naming the
 * statement, rather than surfacing three layers up as a plugin that welded the wrong pair.
 *
 * THE COMPARISON IS A MULTISET, NEVER AN ORDERED LIST, and that is a measured decision rather than a
 * convenience. LadybugDB does not have a stable row order without `ORDER BY`: the same statement over
 * the same seeded graph returned between 4 and 15 distinct orders across 20 to 40 runs at its default
 * 16 threads, and even pinned to one thread the tie order is a plan artifact. So there is no engine
 * order to reproduce, an ordered comparison would report differences that are not differences, and
 * nothing in the app can be relying on it either. A statement that carries `ORDER BY` is the one case
 * where order IS the contract, and those are compared in order.
 */
export type BackendName = 'ladybug' | 'native' | 'diff'

/** One engine: the same shape `openGraph` hands out, minus the memoization. */
export type Backend = {
  name: string
  query: (cypher: string, params?: Record<string, unknown>) => Promise<GraphRow[]>
  close: () => Promise<void>
  version: string
}

/**
 * Read the backend from the environment, defaulting to the engine that ships today.
 *
 * `globalThis.process?.env` rather than a bare `process.env`, because vite polyfills `process` into
 * the browser bundle: a bare read would be a ReferenceError under node's ESM loader in some configs
 * and a silent `undefined` in the browser, and neither failure names the flag.
 */
export const backendFromEnv = (): BackendName => {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.GRAPH_ENGINE
  return raw === 'native' || raw === 'diff' ? raw : 'ladybug'
}

/**
 * One row reduced to a string that compares equal exactly when two rows mean the same thing.
 *
 * KEY ORDER IS NOT MEANINGFUL and neither is the identity of a list, so both are normalised: an
 * object becomes its keys sorted, and everything nests. What IS meaningful is the VALUE, including
 * its type, so `1` and `'1'` must not canonicalise alike; the type tag in front of every scalar is
 * what keeps a number that became a string a reported difference rather than a silent pass.
 *
 * A JSON column is a STRING here, compared byte for byte. That is load bearing rather than lazy:
 * `plugins/writer.ts` decides whether a row changed by comparing `JSON.stringify(desired)` against
 * the stored text, so an engine that re-serialised a JSON column with different spacing or key order
 * would make every pass rewrite every row while every test still passed.
 */
export const canonicalRow = (row: GraphRow): string => canonicalValue(row)

const canonicalValue = (value: unknown): string => {
  if (value === null || value === undefined) return 'n'
  if (typeof value === 'string') return `s:${value}`
  if (typeof value === 'number') return `d:${Object.is(value, -0) ? 0 : value}`
  if (typeof value === 'bigint') return `d:${value}`
  if (typeof value === 'boolean') return `b:${value ? 1 : 0}`
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (value instanceof Date) return `t:${value.toISOString()}`
  if (typeof value === 'object') {
    // `undefined` is NOT dropped, it is canonicalised as null with the key kept. A column that is
    // absent and one that is explicitly null are the same fact on the way out of both engines, and
    // dropping the key instead would make {a: undefined} compare equal to {} and hide a lost column.
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, entry]) => `${key}=${canonicalValue(entry)}`).join(',')}}`
  }
  return `?:${String(value)}`
}

/** Whether the statement's own order is part of its answer. Only then is order compared. */
const ordered = (cypher: string): boolean => /\bORDER\s+BY\b/i.test(cypher)

const counted = (rows: readonly GraphRow[]): Map<string, number> => {
  const tally = new Map<string, number>()
  for (const row of rows) {
    const key = canonicalRow(row)
    tally.set(key, (tally.get(key) ?? 0) + 1)
  }
  return tally
}

/** The first way two row sets differ, in words, or undefined when they agree. */
export const rowsDiffer = (
  cypher: string,
  a: readonly GraphRow[],
  b: readonly GraphRow[]
): string | undefined => {
  if (a.length !== b.length) return `row count ${a.length} against ${b.length}`
  if (ordered(cypher)) {
    for (let index = 0; index < a.length; index += 1) {
      const left = canonicalRow(a[index]!)
      const right = canonicalRow(b[index]!)
      if (left !== right) return `row ${index} of an ORDER BY statement:\n    ${left}\n    ${right}`
    }
    return undefined
  }
  const left = counted(a)
  const right = counted(b)
  for (const [key, count] of left) {
    const other = right.get(key) ?? 0
    if (other !== count) return `row appears ${count} time(s) against ${other}:\n    ${key}`
  }
  for (const key of right.keys()) {
    if (!left.has(key)) return `row only the second engine returned:\n    ${key}`
  }
  return undefined
}

/**
 * Run both engines on one statement and answer the reference's rows, or throw naming the divergence.
 *
 * BOTH ARE ALWAYS RUN, including for writes, because the two stores have to stay in step: a write
 * applied to one and not the other makes every later read diverge for a reason that has nothing to do
 * with the statement being reported. The reference's rows are what the caller gets, so a bug in the
 * candidate can never change what the app does while diff mode is on.
 *
 * A THROW IS PART OF THE ANSWER. An engine that refuses a statement and one that accepts it disagree
 * just as much as two that return different rows, so the outcome is compared before the rows are.
 */
export const diffQuery = async (
  reference: Backend,
  candidate: Backend,
  cypher: string,
  params?: Record<string, unknown>
): Promise<GraphRow[]> => {
  const settle = async (backend: Backend) => {
    try {
      return { rows: await backend.query(cypher, params) }
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) }
    }
  }
  // SEQUENTIALLY and reference first, never `Promise.all`: both mutate their own store, and a write
  // interleaved with the read that follows it would report an order-of-execution difference as an
  // engine difference
  const left = await settle(reference)
  const right = await settle(candidate)

  const where = `${cypher.slice(0, 300)}\n  params: ${JSON.stringify(params ?? {}).slice(0, 300)}`
  if (left.failed && right.failed) return []
  if (left.failed) throw new Error(`graph diff: ${reference.name} threw and ${candidate.name} did not.\n  ${left.failed}\n  ${where}`)
  if (right.failed) throw new Error(`graph diff: ${candidate.name} threw and ${reference.name} did not.\n  ${right.failed}\n  ${where}`)

  const difference = rowsDiffer(cypher, left.rows!, right.rows!)
  if (difference) throw new Error(`graph diff: ${difference}\n  ${where}`)
  return left.rows!
}
