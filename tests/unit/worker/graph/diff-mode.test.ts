/**
 * Diff mode driven with TWO REAL ENGINES, which is what says the plumbing works.
 *
 * `backend.test.ts` proves the comparison catches every class of divergence, but it does so against
 * hand written fakes: it never opens a database, never applies a write to two stores, and never finds
 * out whether the two stay in step across a session. This file does, by registering a second real
 * LadybugDB as the "native" backend. Two independent stores, the same statements applied to both.
 *
 * That is a strong check precisely because the two engines are the SAME code: anything it reports is
 * the harness being wrong, not the engines disagreeing. When the real interpreter lands in step 2 it
 * takes this slot unchanged, and any divergence it reports is then a real one.
 *
 * The last case is the control: a backend deliberately dropping one row on one statement has to be
 * caught here too, or the harness could be passing because nothing ever reaches the comparison.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { Backend } from '../../../../src/worker/graph/backend'

import {
  closeGraph, openGraph, setGraphEngine, setNativeBackend, toPlain,
} from '../../../../src/worker/graph/engine'

/** A second engine, opened the way `openLadybug` opens the first. Its own Database, its own store. */
const secondLadybug = async (): Promise<Backend> => {
  // `./nodejs` is published under the `require` condition ONLY, so `import()` cannot reach it and
  // fails with "is not exported under the conditions". `engine.ts` takes the same route for the same
  // reason; both specifiers are held in variables so no bundler follows them into a browser build.
  const nodeModule = 'node:module'
  const nodeVariant = '@ladybugdb/wasm-core/nodejs'
  const { createRequire } = await import(/* @vite-ignore */ nodeModule) as typeof import('node:module')
  const module = createRequire(import.meta.url)(nodeVariant) as Record<string, unknown>
  const engine = (module.default ?? module) as {
    Database: new (path: string) => { close: () => Promise<void> }
    Connection: new (db: unknown) => {
      init: () => Promise<void>
      query: (cypher: string) => Promise<unknown>
      prepare: (cypher: string) => Promise<unknown>
      execute: (prepared: unknown, params: unknown) => Promise<unknown>
      close: () => Promise<void>
    }
    getVersion: () => Promise<string>
  }
  const db = new engine.Database(':memory:')
  const conn = new engine.Connection(db)
  await conn.init()

  const rowsOf = async (result: unknown) => {
    const handle = result as {
      isSuccess: () => boolean
      getErrorMessage: () => Promise<string>
      getAllObjects: () => Promise<Record<string, unknown>[]>
      close: () => Promise<void>
    }
    try {
      if (!handle.isSuccess()) throw new Error(await handle.getErrorMessage())
      const rows = await handle.getAllObjects()
      // `engine.ts`'s OWN converter, not a simplified one. A hand written version that handled only
      // BigInt reported a divergence on the first read: the nodejs variant hands INT64 back as a
      // BOXED Number, which the real converter unboxes and the simple one did not.
      return rows.map(row => toPlain(row) as Record<string, unknown>)
    } finally {
      await handle.close()
    }
  }

  return {
    name: 'second-ladybug',
    version: await engine.getVersion(),
    close: async () => { await conn.close(); await db.close() },
    query: async (cypher, params) => {
      if (!params) return rowsOf(await conn.query(cypher))
      const prepared = await conn.prepare(cypher) as { close: () => Promise<void> }
      try {
        return rowsOf(await conn.execute(prepared, params))
      } finally {
        await prepared.close()
      }
    },
  }
}

beforeAll(async () => {
  await closeGraph()
  setNativeBackend(secondLadybug)
  setGraphEngine('diff')
})

afterAll(async () => {
  await closeGraph()
  setNativeBackend(undefined)
  setGraphEngine('ladybug')
})

test('two real engines agree across a schema, writes and reads', async () => {
  const { query, backend } = await openGraph()
  expect(backend.name, 'diff mode really is what is answering').toContain('diff(')

  await query('CREATE NODE TABLE D(uri STRING PRIMARY KEY, n INT64, tag STRING)')
  await query('CREATE REL TABLE DL(FROM D TO D, kind STRING)')

  // a batched write, which is how nearly all writing happens in this app
  await query(
    'UNWIND $rows AS r CREATE (:D {uri: r.uri, n: r.n, tag: r.tag})',
    { rows: [
      { uri: 'a:1', n: 1, tag: 'x' },
      { uri: 'a:2', n: 2, tag: 'y' },
      { uri: 'a:3', n: 3, tag: 'x' },
    ] }
  )
  await query(
    'MATCH (a:D {uri: $from}), (b:D {uri: $to}) CREATE (a)-[:DL {kind: $kind}]->(b)',
    { from: 'a:1', to: 'a:2', kind: 'SAME_AS' }
  )

  // a point read, a filtered scan, a one hop join, an aggregate and an ordered read: if the two
  // stores had drifted on the writes above, every one of these would report it
  expect(await query('MATCH (d:D {uri: $uri}) RETURN d.n AS n', { uri: 'a:2' })).toEqual([{ n: 2 }])
  expect(await query('MATCH (d:D) WHERE d.tag = $tag RETURN d.uri AS uri ORDER BY uri', { tag: 'x' }))
    .toEqual([{ uri: 'a:1' }, { uri: 'a:3' }])
  expect(await query('MATCH (a:D)-[l:DL]->(b:D) RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind'))
    .toEqual([{ fromUri: 'a:1', toUri: 'a:2', kind: 'SAME_AS' }])
  expect(await query('MATCH (d:D) RETURN count(d) AS total')).toEqual([{ total: 3 }])

  // a delete, then the read that proves both stores saw it
  await query("MATCH (d:D {uri: 'a:3'}) DETACH DELETE d")
  expect(await query('MATCH (d:D) RETURN count(d) AS total')).toEqual([{ total: 2 }])
}, 120_000)

// THE CONTROL. Everything above passes if the comparison is never reached, so one run has to fail:
// a backend that answers correctly except for dropping a row on one statement.
test('CONTROL: a second engine that drops a row is caught by the live harness', async () => {
  await closeGraph()
  setNativeBackend(async () => {
    const real = await secondLadybug()
    return {
      ...real,
      name: 'lossy',
      query: async (cypher, params) => {
        const rows = await real.query(cypher, params)
        return /RETURN .*AS uri/.test(cypher) && rows.length > 1 ? rows.slice(1) : rows
      },
    }
  })
  setGraphEngine('diff')

  const { query } = await openGraph()
  await query('CREATE NODE TABLE E(uri STRING PRIMARY KEY)')
  await query('UNWIND $rows AS r CREATE (:E {uri: r.uri})', { rows: [{ uri: 'b:1' }, { uri: 'b:2' }] })

  await expect(query('MATCH (e:E) RETURN e.uri AS uri ORDER BY uri'))
    .rejects.toThrow(/graph diff: row count 2 against 1/)
}, 120_000)
