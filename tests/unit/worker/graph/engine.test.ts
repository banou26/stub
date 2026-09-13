import { afterAll, describe, expect, test } from 'vitest'

import { closeGraph, graphEnabled, openGraph } from '../../../../src/worker/graph/engine'

// Under node the module loads the `nodejs` variant, which resolves its own engine worker; the
// browser build loads the default variant and the file the vite plugin serves. Same module, one
// switch inside it, so the test drives the code the worker runs.

afterAll(async () => {
  await closeGraph()
})

describe('openGraph', () => {
  test('opens, writes with params, and reads an INT64 back as a plain number', async () => {
    const { query } = await openGraph()
    await query('CREATE NODE TABLE T(uri STRING PRIMARY KEY, n INT64)')
    await query('MERGE (t:T {uri: $uri}) ON CREATE SET t.n = $n', { uri: 'mal:1', n: 26 })
    const rows = await query('MATCH (t:T {uri: $uri}) RETURN t.uri AS uri, t.n AS n', { uri: 'mal:1' })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.uri).toBe('mal:1')
    // The engine hands INT64 back as a BigInt in the browser and as a boxed Number under nodejs.
    // Either one fails `toBe(26)`, and both are what the conversion exists to remove.
    expect(typeof rows[0]!.n).toBe('number')
    expect(rows[0]!.n).toBe(26)
  })

  test('a binder error rejects with the statement in the message', async () => {
    const { query } = await openGraph()
    const statement = 'MERGE (t:T {uri: $uri}) ON CREATE SET t.n = $n'
    // A STRING param into an INT64 column with no cast. The engine THROWS this rather than
    // returning isSuccess() false, so without the wrapper the statement is nowhere in the message.
    await expect(query(statement, { uri: 'mal:2', n: 'twenty six' })).rejects.toThrow(statement)
    await expect(query(statement, { uri: 'mal:2', n: 'twenty six' })).rejects.toThrow(/Binder exception/)
  })

  // `db` and `conn` were asserted here until 2026-09-13 and are gone from `Graph`: they were
  // LadybugDB's own handles, and the engine is being replaced by an in-process interpreter behind the
  // same `query`. The property this case is actually about is unchanged and is now stated on the two
  // things every caller shares: one backend, one `query`.
  test('called twice, it hands back the one open database', async () => {
    const first = await openGraph()
    const second = await openGraph()

    // `db`/`conn` were asserted here while the store was LadybugDB, and `backend` while the two ran
    // side by side. Both are gone; the property is unchanged and rests on the one thing every caller
    // shares.
    expect(second.query).toBe(first.query)
    expect(second.version).toBe(first.version)
  })

  // `read.test.ts` counts the statements a read runs by REASSIGNING `graph.query`, so it has to be a
  // writable own property rather than a getter or a frozen field. That is easy to break while moving
  // the engine around and the failure reads as a broken test rather than as a changed shape.
  test('query is a writable own property, which is how a test counts statements', async () => {
    const graph = await openGraph()
    const descriptor = Object.getOwnPropertyDescriptor(graph, 'query')
    expect(descriptor?.writable, 'reassignable').toBe(true)
    const real = graph.query
    let seen = 0
    graph.query = (cypher, params) => { seen += 1; return real(cypher, params) }
    await graph.query('MATCH (t:T) RETURN count(t) AS total')
    graph.query = real
    expect(seen).toBe(1)
  })
})

describe('graphEnabled', () => {
  test('is off until the page says otherwise', () => {
    expect(graphEnabled()).toBe(false)
  })
})
