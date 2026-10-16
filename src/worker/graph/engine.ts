import type { CypherStore } from './cypher'

import { createCypherStore } from './cypher'

/**
 * The graph store, opened once per worker and queried in Cypher.
 *
 * `openGraph()` is the only way in: it memoizes one store and returns a `query` helper over it.
 * Nothing here decides a schema; this only makes the store reachable. `graphEnabled()` reports the
 * page's `?graph` flag, which `setGraphEnabled` carries in.
 *
 * THE STORE IS `./cypher`, IN THIS WORKER, since 2026-09-14. It was LadybugDB, a wasm database in a
 * worker of its own, until the boundary turned out to be the whole cost: about 2.2 ms and six round
 * trips for any statement whatever it did, while the app exported its entire graph across it 21 times
 * per page load. Replacing it took the corpus from 408 s to 8.6 s, and this file from 263 lines to
 * ninety, because most of what was here existed to marshal values across that boundary.
 *
 * The replacement was established differentially rather than by reading it: both engines ran every
 * statement of every suite and every row was compared, 380 of 380 graph tests and 922 of 922 corpus
 * cases agreeing, before the reference was removed. That harness is gone with the reference, which is
 * what a harness is for. What remains of it is
 * `tests/unit/worker/graph/cypher/conformance.test.ts`, written against the old engine and green
 * there before the new one existed.
 */

export type GraphRow = Record<string, unknown>

export type Graph = {
  /**
   * Runs one statement and returns its rows.
   *
   * A WRITABLE OWN PROPERTY, deliberately: `tests/unit/worker/graph/read.test.ts` reassigns it to
   * count the statements one read runs, so a getter or a frozen object breaks that.
   */
  query: (cypher: string, params?: Record<string, unknown>) => Promise<GraphRow[]>
  /** The store version, for the boot log. */
  version: string
}

/**
 * Fires after any statement that can CHANGE the graph, so a cache over graph state cannot go stale.
 *
 * `plugins/guards.ts` caches its component snapshot on this. Hooking the writer instead was tried and
 * was wrong: anything holding a `query` handle can write, and `plugins/aggregate.test.ts` retracts a
 * `SAME_AS` row with a raw DELETE to drive a split. Here there is no path around it.
 *
 * The test is CONSERVATIVE: anything naming a write keyword counts, so an over-broad match costs a
 * re-read and a missed one would cost correctness.
 */
const WRITES = /\b(CREATE|MERGE|SET|DELETE|DETACH|DROP|ALTER|COPY|INSTALL|LOAD)\b/i

const writeListeners: (() => void)[] = []

export const onGraphWrite = (listener: () => void): void => { writeListeners.push(listener) }

const announceWrite = (cypher: string): void => {
  if (!WRITES.test(cypher)) return
  for (const listener of writeListeners) listener()
}

let turn: Promise<unknown> = Promise.resolve()

/**
 * Run `work` once every turn asked for before it has ended, and alone until it ends.
 *
 * The scheduler runs each pass in a turn and the page reader each read, so a page reads a pass's fixed
 * point and never the graph between two of its iterations, where a row the next iteration joins is
 * still a cluster of its own with a card of its own. Measured on the Summer 2026 search page,
 * 2026-10-16: MyAnimeList's answer gave 82 of its rows a cluster of their own in iteration 1 and
 * joined each to the Offline row borrowing its id in iteration 2, and a page read landing in between
 * drew all 82 twice.
 *
 * The cost is that a read waits for the pass in flight: up to one whole pass, about 0.5 to 2.5 s when
 * a second source's batch starts a pass right after the first (a replay of that page's answers).
 *
 * A turn that waits on another turn never ends, since that turn queues behind it.
 */
export const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
  const result = turn.then(work)
  turn = result.catch(() => undefined)
  return result
}

let opening: Promise<Graph> | undefined
let store: CypherStore | undefined

const open = async (): Promise<Graph> => {
  const opened = createCypherStore()
  store = opened
  return {
    // a plain object with `query` as a writable own property: see `Graph`
    query: async (cypher, params) => {
      const rows = await opened.query(cypher, params) as GraphRow[]
      announceWrite(cypher)
      return rows
    },
    version: 'cypher-store',
  }
}

/** Opens the store, or returns the open one. Every caller shares one. */
export const openGraph = (): Promise<Graph> => (opening ??= open())

export const closeGraph = async (): Promise<void> => {
  const graph = opening
  opening = undefined
  if (!graph) return
  await graph
  store?.close()
  store = undefined
}

let enabled = false

/** Set from the page over osra, because a worker cannot read the page's query string itself. */
export const setGraphEnabled = (value: boolean): void => { enabled = value }

export const graphEnabled = (): boolean => enabled
