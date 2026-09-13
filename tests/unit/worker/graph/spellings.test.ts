/**
 * The nine Cypher spellings the representation design uses that were outside the measured set
 * (11.1), each run against the real engine on a tiny schema and asserted against the exact rows it
 * must return. They are MEASUREMENTS, not smoke tests: a statement that parses and answers the wrong
 * rows is a refusal that would otherwise ship.
 *
 * A spelling the engine refuses skips with the engine's own message quoted, rather than being
 * deleted, and the fallback 11.1 names for it is written beside it. `the control` at the bottom is
 * what proves a refusal is reported as one: without it, a harness that could never express a failure
 * would report nine exercised spellings whatever the engine did.
 */
import type { TestContext } from 'vitest'

import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { closeGraph, openGraph } from '../../../../src/worker/graph/engine'

afterAll(async () => {
  await closeGraph()
})

/** Runs one spelling, or skips the test quoting the engine's refusal. Never returns on a refusal. */
const measure = async (ctx: TestContext, cypher: string, params?: Record<string, unknown>) => {
  const { query } = await openGraph()
  try {
    return await query(cypher, params)
  } catch (error) {
    ctx.skip(`REFUSED by the engine: ${(error as Error).message}`)
    throw error
  }
}

const FIXTURE = [
  'CREATE NODE TABLE SMedia(uri STRING PRIMARY KEY, origin STRING, n INT64, owned BOOLEAN, countStated INT64, countDistinct INT64)',
  'CREATE NODE TABLE SEpisode(uri STRING PRIMARY KEY, number INT64)',
  'CREATE NODE TABLE SCluster(id STRING PRIMARY KEY, key STRING, scope STRING, published STRING[])',
  'CREATE REL TABLE SCLAIMS(FROM SMedia TO SMedia, key STRING, kind STRING, claimer STRING, node JSON, answerSeq INT64, seq INT64)',
  'CREATE REL TABLE SLINK(FROM SMedia TO SMedia, kind STRING, status STRING)',
  'CREATE REL TABLE SHAS_EPISODE(FROM SMedia TO SEpisode, claimer STRING)',
  'CREATE REL TABLE SMEMBER_OF(FROM SMedia TO SCluster, via STRING)',
]

const MEDIA = [
  // the collect fixture
  { uri: 'coll:1', origin: 'coll', n: 2, owned: false, countStated: 12, countDistinct: 10 },
  { uri: 'coll:2', origin: 'coll', n: 1, owned: true, countStated: 14, countDistinct: null },
  { uri: 'coll:3', origin: 'coll', n: 1, owned: false, countStated: null, countDistinct: null },
  // the closure fixture: a SAME_AS chain, one PART_OF neighbour and one refused SAME_AS
  { uri: 'pa:1', origin: 'pa', n: 0, owned: true, countStated: null, countDistinct: null },
  { uri: 'pa:2', origin: 'pa', n: 0, owned: true, countStated: null, countDistinct: null },
  { uri: 'pa:3', origin: 'pa', n: 0, owned: true, countStated: null, countDistinct: null },
  { uri: 'pa:4', origin: 'pa', n: 0, owned: true, countStated: null, countDistinct: null },
  { uri: 'pa:5', origin: 'pa', n: 0, owned: true, countStated: null, countDistinct: null },
  // the claim fixture, for the NOT EXISTS insert and the re-assert SET
  { uri: 'cl:1', origin: 'cl', n: 0, owned: true, countStated: null, countDistinct: null },
  { uri: 'cl:2', origin: 'cl', n: 0, owned: true, countStated: null, countDistinct: null },
  // the episode-count fixture
  { uri: 'ep:1', origin: 'ep', n: 0, owned: true, countStated: null, countDistinct: null },
  // the membership fixture
  { uri: 'mb:1', origin: 'mb', n: 0, owned: true, countStated: null, countDistinct: null },
  // the MERGE fixture: mg:1 exists, mg:2 does not
  { uri: 'mg:1', origin: 'mg', n: 1, owned: true, countStated: null, countDistinct: null },
]

beforeAll(async () => {
  const { query } = await openGraph()
  for (const statement of FIXTURE) await query(statement)
  await query(
    `UNWIND $rows AS r CREATE (:SMedia {uri: r.uri, origin: r.origin, n: r.n, owned: r.owned,
       countStated: r.countStated, countDistinct: r.countDistinct})`,
    { rows: MEDIA }
  )
  await query('UNWIND $rows AS r CREATE (:SEpisode {uri: r.uri, number: r.number})', {
    rows: [{ uri: 'ep:1-1', number: 1 }, { uri: 'ep:1-2', number: 2 }, { uri: 'nf:1-1', number: 1 }],
  })
  await query('UNWIND $rows AS r CREATE (:SCluster {id: r.id, key: r.key, scope: r.scope, published: r.published})', {
    rows: [
      { id: 'c-run', key: 'mb:1', scope: 'RUN', published: ['mb:1', 'mal:39535'] },
      { id: 'c-container', key: 'mb:0', scope: 'CONTAINER', published: ['mb:9'] },
    ],
  })

  const link = async (from: string, to: string, kind: string, status: string) =>
    query(
      'MATCH (a:SMedia {uri: $from}), (b:SMedia {uri: $to}) CREATE (a)-[:SLINK {kind: $kind, status: $status}]->(b)',
      { from, to, kind, status }
    )
  await link('pa:1', 'pa:2', 'SAME_AS', 'active')
  await link('pa:2', 'pa:3', 'SAME_AS', 'active')
  await link('pa:3', 'pa:4', 'PART_OF', 'active')
  await link('pa:1', 'pa:5', 'SAME_AS', 'refused')

  // two of the three episodes are hung by the row's OWN origin, and one of those twice: the
  // duplicated epid of netflixid 80198505 season 3, which is why the count is DISTINCT
  const hang = async (media: string, episode: string, claimer: string) =>
    query(
      'MATCH (m:SMedia {uri: $media}), (e:SEpisode {uri: $episode}) CREATE (m)-[:SHAS_EPISODE {claimer: $claimer}]->(e)',
      { media, episode, claimer }
    )
  await hang('ep:1', 'ep:1-1', 'ep')
  await hang('ep:1', 'ep:1-2', 'ep')
  await hang('ep:1', 'ep:1-2', 'ep')
  await hang('ep:1', 'nf:1-1', 'nf')

  await query(
    'MATCH (m:SMedia {uri: $uri}), (c:SCluster {id: $id}) CREATE (m)-[:SMEMBER_OF {via: $via}]->(c)',
    { uri: 'mb:1', id: 'c-run', via: 'member' }
  )
  await query(
    'MATCH (m:SMedia {uri: $uri}), (c:SCluster {id: $id}) CREATE (m)-[:SMEMBER_OF {via: $via}]->(c)',
    { uri: 'mb:1', id: 'c-container', via: 'member' }
  )
})

describe('the nine spellings of 11.1', () => {
  // Fallback if refused: name every field in the collect (`collect(m.uri) AS uris, collect(m.n) AS
  // ns`), joined by position in JS.
  //
  // Measured while writing this: a `WITH m ORDER BY m.uri` ahead of the collect, to make the list
  // order deterministic, is REFUSED with "In WITH clause, ORDER BY must be followed by SKIP or
  // LIMIT". So a collected list is ordered in JS, or the WITH carries a LIMIT it does not need.
  test('1. a struct literal inside collect', async (ctx) => {
    const rows = await measure(
      ctx,
      `MATCH (m:SMedia) WHERE m.origin = 'coll'
       RETURN m.origin AS origin, collect({uri: m.uri, n: m.n}) AS rows`
    )

    expect(rows).toHaveLength(1)
    const collected = (rows[0]!.rows as { uri: string, n: number }[]).slice().sort((a, b) => a.uri < b.uri ? -1 : 1)
    expect(collected).toEqual([{ uri: 'coll:1', n: 2 }, { uri: 'coll:2', n: 1 }, { uri: 'coll:3', n: 1 }])
  })

  // The closure of 3.5, verbatim: *0..8, UNDIRECTED, two clauses in the filter. What was measured on
  // 2026-09-11 is the directed `*1..3` form, so the zero-length lower bound and the direction are
  // both new here. Fallback if refused: walk the edges in JS from a flat MATCH of active SAME_AS.
  test('2. the named filtered variable-length path', async (ctx) => {
    const rows = await measure(
      ctx,
      `MATCH (a:SMedia {uri: $uri})-[e:SLINK*0..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:SMedia)
       RETURN DISTINCT b.uri AS uri
       ORDER BY uri`,
      { uri: 'pa:1' }
    )

    // the whole component including the row itself (the 0 hop), and neither the PART_OF neighbour
    // nor the refused link's target
    expect(rows).toEqual([{ uri: 'pa:1' }, { uri: 'pa:2' }, { uri: 'pa:3' }])
  })

  // 4.2 step 5. Fallback if refused: a MATCH then CREATE pair, with the existence check in JS.
  test('3. MERGE bound to an UNWIND variable', async (ctx) => {
    await measure(
      ctx,
      `UNWIND $rows AS r
       MERGE (m:SMedia {uri: r.uri})
       ON CREATE SET m.origin = r.origin, m.n = r.n, m.owned = r.owned
       ON MATCH SET m.n = r.n, m.owned = m.owned OR r.owned`,
      { rows: [{ uri: 'mg:1', origin: 'mg', n: 5, owned: false }, { uri: 'mg:2', origin: 'mg', n: 7, owned: false }] }
    )

    const { query } = await openGraph()
    const rows = await query(`MATCH (m:SMedia) WHERE m.origin = 'mg' RETURN m.uri AS uri, m.n AS n, m.owned AS owned ORDER BY m.uri`)
    // ON MATCH kept mg:1's own `owned` and took the new count; ON CREATE wrote mg:2 whole
    expect(rows).toEqual([{ uri: 'mg:1', n: 5, owned: true }, { uri: 'mg:2', n: 7, owned: false }])
  })

  // 4.2 step 6, the claim insert. Fallback if refused: read the existing keys back and filter in JS.
  test('4. a correlated NOT EXISTS naming an UNWIND variable', async (ctx) => {
    const claims = [{ fromUri: 'cl:1', toUri: 'cl:2', key: 'k1', kind: 'SAME_AS', claimer: 'cl', node: '{"uri":"cl:2"}', answerSeq: 1, seq: 1 }]
    const insert = `UNWIND $claims AS h
       MATCH (a:SMedia {uri: h.fromUri}), (b:SMedia {uri: h.toUri})
       WHERE NOT EXISTS { MATCH (a)-[:SCLAIMS {key: h.key}]->(b) }
       CREATE (a)-[:SCLAIMS {key: h.key, kind: h.kind, claimer: h.claimer, node: h.node,
                             answerSeq: h.answerSeq, seq: h.seq}]->(b)`

    await measure(ctx, insert, { claims })
    await measure(ctx, insert, { claims })

    const { query } = await openGraph()
    // the second run is the whole point: one edge, not two
    expect(await query('MATCH (:SMedia)-[c:SCLAIMS]->(:SMedia) RETURN c.key AS key, c.answerSeq AS answerSeq'))
      .toEqual([{ key: 'k1', answerSeq: 1 }])
  })

  // 6.2 statement 1, where the rank has to be a projected column because ORDER BY after a DISTINCT
  // projection may only name what was projected. Fallback if refused: compute the rank in JS.
  test('5. CASE as a projected column beside DISTINCT', async (ctx) => {
    const rows = await measure(
      ctx,
      `UNWIND $uris AS u
       MATCH (m:SMedia {uri: u})-[:SMEMBER_OF]->(c:SCluster)
       RETURN DISTINCT c.id AS id, c.scope AS scope, c.key AS key,
              CASE WHEN c.scope = 'RUN' THEN 0 ELSE 1 END AS scopeRank
       ORDER BY scopeRank, key`,
      { uris: ['mb:1'] }
    )

    // the RUN cluster ranks above the container it is attached to, which is what the CASE is for
    expect(rows).toEqual([
      { id: 'c-run', scope: 'RUN', key: 'mb:1', scopeRank: 0 },
      { id: 'c-container', scope: 'CONTAINER', key: 'mb:0', scopeRank: 1 },
    ])
  })

  // 4.2 step 6, the re-assert. Fallback if refused: DELETE the edge and CREATE it again.
  test('6. SET on a relationship matched by property', async (ctx) => {
    const { query } = await openGraph()
    await query(
      `MATCH (a:SMedia {uri: 'cl:1'}), (b:SMedia {uri: 'cl:2'})
       CREATE (a)-[:SCLAIMS {key: 'k2', kind: 'SAME_AS', claimer: 'cl', node: '{"titles":[]}', answerSeq: 4, seq: 4}]->(b)`
    )
    const reassert = `UNWIND $rows AS h
       MATCH (a:SMedia {uri: h.fromUri})-[c:SCLAIMS {key: h.key}]->(b:SMedia {uri: h.toUri})
       WHERE c.answerSeq < h.answerSeq
       SET c.node = h.mergedNode, c.answerSeq = h.answerSeq, c.seq = h.seq`
    const row = (answerSeq: number, node: string) => [{ fromUri: 'cl:1', toUri: 'cl:2', key: 'k2', mergedNode: node, answerSeq, seq: answerSeq }]

    await measure(ctx, reassert, { rows: row(9, '{"titles":["a richer answer"]}') })
    // the guard is part of the spelling: an OLDER answer must not move the row
    await measure(ctx, reassert, { rows: row(2, '{"titles":["a poorer answer"]}') })

    expect(await query("MATCH (:SMedia)-[c:SCLAIMS {key: 'k2'}]->(:SMedia) RETURN c.answerSeq AS answerSeq, c.node AS node"))
      .toEqual([{ answerSeq: 9, node: '{"titles":["a richer answer"]}' }])
  })

  // 6.2 statement 1a. Fallback if refused: read the cluster rows and filter `published` in JS.
  test('7. IN over a STRING[] column', async (ctx) => {
    const rows = await measure(
      ctx,
      `UNWIND $uris AS u
       MATCH (c:SCluster)
       WHERE u IN c.published
       RETURN DISTINCT c.id AS id, c.key AS key
       ORDER BY key`,
      { uris: ['mal:39535'] }
    )

    expect(rows).toEqual([{ id: 'c-run', key: 'mb:1' }])
  })

  // 5.4 P2 and P4, in both positions the design uses: a WHERE and a projection. Fallback: a JS `??`.
  test('8. coalesce', async (ctx) => {
    const rows = await measure(
      ctx,
      `MATCH (m:SMedia)
       WHERE m.origin = 'coll' AND coalesce(m.countDistinct, m.countStated) > $runLength
       RETURN m.uri AS uri, coalesce(m.countDistinct, m.countStated) AS count
       ORDER BY uri`,
      { runLength: 11 }
    )

    // coll:1 answers 10 (its distinct count), which is NOT over 11, so the fallthrough is what is
    // measured here: coll:2 has no distinct count and answers its stated 14
    expect(rows).toEqual([{ uri: 'coll:2', count: 14 }])
  })

  // 5.4 P0's own-episode count. Fallback if refused: collect the uris and count them in JS.
  test('9. count(DISTINCT ...) under a WHERE on the edge', async (ctx) => {
    const rows = await measure(
      ctx,
      `UNWIND $uris AS u
       MATCH (m:SMedia {uri: u})-[h:SHAS_EPISODE]->(e:SEpisode)
       WHERE h.claimer = m.origin
       RETURN m.uri AS uri, count(DISTINCT e.uri) AS ownEpisodes`,
      { uris: ['ep:1'] }
    )

    // four edges, one of them a foreign claimer and one a duplicate of an own row: two episodes
    expect(rows).toEqual([{ uri: 'ep:1', ownEpisodes: 2 }])
  })
})

// A measurement that cannot express a refusal reports success unconditionally. This is the arm that
// must fail.
//
// It used to be `RETURN m AS m ORDER BY m`, which LadybugDB refused with `Order by`. The store that
// replaced it accepts that one, so the control was re-pointed rather than dropped: the grammar in
// `cypher/ast.ts` is CLOSED, and anything outside it is refused by name, so a refusal is still easy
// to come by. `SKIP` is outside it because no statement the app issues uses one.
test('the control: a spelling the store refuses is reported, not passed', async () => {
  const { query } = await openGraph()

  await expect(query('MATCH (m:SMedia) RETURN m.uri AS uri SKIP 1'))
    .rejects.toThrow(/not supported/)
})
