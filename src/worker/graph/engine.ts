/**
 * LadybugDB, opened once per worker and queried in Cypher.
 *
 * `openGraph()` is the only way in: it memoizes one in-memory `Database` and one `Connection` and
 * returns a `query` helper over them. Nothing here decides a schema; this only makes the engine
 * reachable. `graphEnabled()` reports the page's `?graph` flag, which `setGraphEnabled` carries in.
 */
import type { Connection, QueryResult } from '@ladybugdb/wasm-core'

import type { Backend, BackendName } from './backend'

import { backendFromEnv, diffQuery } from './backend'
import { createCypherStore } from './cypher'

export type GraphRow = Record<string, unknown>

export type Graph = {
  /** The engine actually answering, so a test can name it. Nothing in the app reads it. */
  backend: Backend
  /**
   * Runs one statement and returns its rows. Params are bound through `prepare` + `execute`, and
   * every engine failure arrives as a thrown Error naming the statement.
   */
  query: (cypher: string, params?: Record<string, unknown>) => Promise<GraphRow[]>
  /** The engine version, for the boot log. */
  version: string
}

/** The default (browser) variant's module shape. The nodejs variant exports the same surface. */
type Engine = typeof import('@ladybugdb/wasm-core')

// The engine is one 22 MB file that the package's exports map does not expose, so it cannot be
// imported and is served at the app root instead: a vite plugin streams it in dev and emits it into
// the build, which keeps those bytes out of git. `setWorkerPath` must run before any other call.
const WORKER_PATH = '/lbug_wasm_worker.js'

// Node has no `location`, and the browser build always runs inside a worker, which does. `process`
// is not the switch here: vite-plugin-node-polyfills ships a shim of it into the browser bundle.
const inBrowser = typeof globalThis.location !== 'undefined'

let loading: Promise<Engine> | undefined

const loadEngine = (): Promise<Engine> => (loading ??= importEngine())

const importEngine = async (): Promise<Engine> => {
  if (!inBrowser) {
    // The `./nodejs` subpath is published under the `require` condition only, so `import()` cannot
    // reach it. Both specifiers are held in variables so no bundler follows them into the browser
    // build, where naming a `node:` builtin makes vite serve the module as a 500.
    const nodeModule = 'node:module'
    const nodeVariant = '@ladybugdb/wasm-core/nodejs'
    const { createRequire } = await import(/* @vite-ignore */ nodeModule) as typeof import('node:module')
    return createRequire(import.meta.url)(nodeVariant) as Engine
  }
  const module = await import('@ladybugdb/wasm-core')
  const engine = (module as unknown as { default?: Engine }).default ?? module
  engine.setWorkerPath(WORKER_PATH)
  return engine
}

/**
 * INT64 reaches JS as a BigInt in the browser and as a boxed `Number` under the nodejs variant
 * (measured 2026-09-12, 0.20.4: `t.n` is `[object Number]` with typeof `object`, while a node's
 * `_id.offset` is a real BigInt). Both are unusable downstream, and a BigInt also refuses
 * `JSON.stringify` and structured clone, so rows are flattened to plain numbers on the way out.
 */
/**
 * Exported because it defines the VALUE SHAPE AT THE SEAM, which is a contract rather than a detail.
 *
 * Every caller in the app is written against what comes out of here: plain numbers, not BigInt and
 * not boxed Number; JSON columns as strings. A replacement engine has to produce the same shapes, and
 * `tests/unit/worker/graph/diff-mode.test.ts` needs it to build a second reference that differs from
 * the first in nothing at all. A simpler flattening there reported a real divergence within minutes
 * (a boxed `Number` from the nodejs variant against a plain one), which is the harness working.
 */
export const toPlain = (value: unknown): unknown => {
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) return value.map(toPlain)
  if (value instanceof Date) return value
  if (value instanceof Number || value instanceof BigInt) return Number(value.valueOf())
  if (value instanceof String) return String(value.valueOf())
  const prototype = value === null || typeof value !== 'object' ? undefined : Object.getPrototypeOf(value)
  if (prototype === Object.prototype || prototype === null) {
    return Object.fromEntries(Object.entries(value as object).map(([key, entry]) => [key, toPlain(entry)]))
  }
  return value
}

const rowsOf = async (result: QueryResult): Promise<GraphRow[]> => {
  try {
    if (!result.isSuccess()) throw new Error(await result.getErrorMessage())
    const rows = await result.getAllObjects()
    return rows.map(row => toPlain(row) as GraphRow)
  } finally {
    await result.close()
  }
}

/**
 * Fires after any statement that can CHANGE the graph, so a cache over graph state cannot go stale.
 *
 * AT THE ENGINE, deliberately, rather than at the writer. `plugins/writer.ts` has exactly one write
 * statement and hooking that looked sufficient, but it is not: anything holding a `query` handle can
 * write, and `aggregate.test.ts` does precisely that ("the SAME_AS row is retracted directly") to
 * drive a split. A cache keyed on the writer alone answered that test from before the delete. Here
 * there is no path around it, because every statement in the app goes through this function.
 *
 * The test is CONSERVATIVE: anything naming a write keyword counts, so an over-broad match costs a
 * re-read and a missed one would cost correctness. Read statements are the overwhelming majority and
 * pay one regex.
 */
const WRITES = /\b(CREATE|MERGE|SET|DELETE|DETACH|DROP|ALTER|COPY|INSTALL|LOAD)\b/i

const writeListeners: (() => void)[] = []

/** Subscribe to "the graph may have changed". Called for every write statement, after it succeeds. */
export const onGraphWrite = (listener: () => void): void => { writeListeners.push(listener) }

const announceWrite = (cypher: string): void => {
  if (!WRITES.test(cypher)) return
  for (const listener of writeListeners) listener()
}

const queryWith = (conn: Connection) =>
  async (cypher: string, params?: Record<string, unknown>): Promise<GraphRow[]> => {
    try {
      if (!params) {
        const rows = await rowsOf(await conn.query(cypher))
        announceWrite(cypher)
        return rows
      }
      const prepared = await conn.prepare(cypher)
      try {
        if (!prepared.isSuccess()) throw new Error(await prepared.getErrorMessage())
        const rows = await rowsOf(await conn.execute(prepared, params))
        announceWrite(cypher)
        return rows
      } finally {
        await prepared.close()
      }
    } catch (error) {
      // A binder error is THROWN by the engine rather than reported through isSuccess(), so the
      // statement it came from is nowhere in the message. Both paths are re-thrown carrying it.
      const reason = error instanceof Error ? error.message : String(error)
      throw new Error(`graph: ${reason} (statement: ${cypher.slice(0, 120)})`, { cause: error })
    }
  }

let opening: Promise<Graph> | undefined

/**
 * WHICH ENGINE ANSWERS, while LadybugDB is being replaced by the in-process interpreter.
 *
 * Defaults to `ladybug`, which is what ships, so nothing changes until something asks. `native` is
 * the replacement alone and `diff` runs both and refuses on any divergence (see ./backend.ts).
 * Settable from code as well as from the environment because the browser has no env: a page that
 * wants the replacement calls `setGraphEngine` before the first `openGraph`.
 */
let engineChoice: BackendName = backendFromEnv()

export const setGraphEngine = (next: BackendName): void => {
  if (opening) throw new Error(`setGraphEngine(${next}) after the graph is already open: close it first`)
  engineChoice = next
}

export const graphEngine = (): BackendName => engineChoice

const openLadybug = async (): Promise<Backend> => {
  const engine = await loadEngine()
  const db = new engine.Database(':memory:')
  const conn = new engine.Connection(db)
  await conn.init()
  // ONE THREAD, so the reference engine is as repeatable as it can be made while it is the thing
  // every comparison is against. It does not make the row order deterministic (that was measured:
  // the tie order is a plan artifact even at one thread) but it removes the run to run variation
  // that comes from the parallel scan, at about one percent of the engine's cost.
  await conn.setMaxNumThreadForExec(1)
  const version = await engine.getVersion()
  return {
    name: 'ladybug',
    version,
    query: queryWith(conn),
    close: async () => { await conn.close(); await db.close(); await (await loading)?.close() },
  }
}

/**
 * The candidate engine, injected rather than imported.
 *
 * `src/worker/graph/cypher/` does not exist yet (it lands in step 2), and this file must not import
 * it before it does. Registering it here also lets a test plug in a DELIBERATELY WRONG backend to
 * prove diff mode can actually fail, which is the only way to know the harness works at all.
 */
let nativeFactory: (() => Promise<Backend>) | undefined

export const setNativeBackend = (factory: (() => Promise<Backend>) | undefined): void => {
  nativeFactory = factory
}

const openNative = async (): Promise<Backend> => {
  // a registered factory wins, which is how `diff-mode.test.ts` plugs in a deliberately wrong backend
  // to prove the harness can fail. Otherwise this is the real store.
  if (nativeFactory) return nativeFactory()
  const store = createCypherStore()
  return {
    name: 'native',
    version: 'cypher-store',
    query: async (cypher, params) => {
      const rows = await store.query(cypher, params)
      // THE SAME ANNOUNCEMENT THE OTHER BACKEND MAKES. `announceWrite` used to live only in the
      // LadybugDB path, so under the native engine `onGraphWrite` never fired and the guards' cached
      // component snapshot was never invalidated: two rows a statement had just joined still read as
      // separate components. Anything hanging off a write notification has to hear from BOTH engines,
      // or the replacement is silently missing a side effect the app is built on.
      announceWrite(cypher)
      return rows
    },
    close: async () => { store.close() },
  }
}

const openBackend = async (): Promise<Backend> => {
  if (engineChoice === 'ladybug') return openLadybug()
  if (engineChoice === 'native') return openNative()

  const reference = await openLadybug()
  const candidate = await openNative()
  return {
    name: `diff(${reference.name} against ${candidate.name})`,
    version: reference.version,
    query: (cypher, params) => diffQuery(reference, candidate, cypher, params),
    // BOTH are closed, and the reference last, so a candidate that throws on close still leaves the
    // engine that owns the wasm worker shut down
    close: async () => {
      try { await candidate.close() } finally { await reference.close() }
    },
  }
}

const open = async (): Promise<Graph> => {
  const backend = await openBackend()
  // a plain object with `query` as a WRITABLE own property: `tests/unit/worker/graph/read.test.ts`
  // reassigns it to count the statements one read runs, and a getter or a frozen object breaks that
  return { backend, query: backend.query, version: backend.version }
}

/** Opens the engine, or returns the open one. Every caller shares one store. */
export const openGraph = (): Promise<Graph> => (opening ??= open())

export const closeGraph = async (): Promise<void> => {
  const graph = opening
  opening = undefined
  loading = undefined
  if (!graph) return
  await (await graph).backend.close()
}

let enabled = false

/** Set from the page over osra, because a worker cannot read the page's query string itself. */
export const setGraphEnabled = (value: boolean): void => { enabled = value }

export const graphEnabled = (): boolean => enabled
