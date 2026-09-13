/**
 * What the replacement store has to DO, measured against the engine it replaces.
 *
 * EVERY CASE HERE RAN GREEN AGAINST LADYBUGDB BEFORE IT WAS WRITTEN DOWN. That is the whole property
 * of this file and the only thing that makes it worth having: a conformance suite that has never been
 * red against the reference proves nothing, and a case encoding what its author assumed rather than
 * what the engine does is worse than no case at all, because it ships an invented requirement. Where
 * the engine surprised the author the ENGINE won and the expectation was rewritten; each of those is
 * marked with what was learned.
 *
 * It drives `openGraph()`, so it runs against whichever backend `GRAPH_ENGINE` selects: `ladybug`
 * (the default, and what these expectations were taken from), `native` (the replacement alone), or
 * `diff` (both, refusing on any divergence). Nothing in the file names an engine.
 *
 * ROW ORDER IS NEVER ASSERTED WITHOUT `ORDER BY`. The reference engine returned between 4 and 15
 * distinct orders for one statement over one graph across 20 to 40 runs, so a multi-row expectation
 * either carries an `ORDER BY` or is sorted in JS before it is compared. An expectation that happens
 * to hold on one run is a flake this file must not contain.
 *
 * The tables are prefixed `C` so nothing here can collide with `schema.ts`, which this file
 * deliberately does not load: the point is the ENGINE's behaviour, not the app's schema.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { closeGraph, openGraph, graphEngine } from '../../../../../src/worker/graph/engine'

afterAll(async () => {
  await closeGraph()
})

const run = async (cypher: string, params?: Record<string, unknown>) => {
  const { query } = await openGraph()
  return query(cypher, params)
}

/**
 * The engine's own words when it refuses, or a sentinel saying it did not.
 *
 * Returning the message rather than asserting on a rejection is what makes the exact wording visible
 * in a failure. The wording is load bearing: `plugins/writer.ts:38` and
 * `tests/corpus/adapters/graph-store.ts:25` are both written around a specific sentence, so a case
 * that reports "it threw" has not measured the thing those two depend on.
 */
const refusalOf = async (cypher: string, params?: Record<string, unknown>): Promise<string> => {
  try {
    await run(cypher, params)
    return 'the engine accepted it'
  } catch (error) {
    return (error as Error).message
  }
}

/**
 * A refusal BOTH engines must produce, with the wording each of them uses.
 *
 * The two disagree on phrasing and there is no honest way around it: LadybugDB says
 * `Conversion exception: Cast failed. Could not convert "1e+21" to INT64.` where the replacement says
 * `Binder exception: cast expected INT64 ...`. Asserting only a substring they happen to share would
 * weaken the case to nothing on the pairs that share nothing, and asserting the reference's string
 * alone would red every one of these under the replacement forever.
 *
 * So both are written down. What the case actually pins is the property that matters, which is that
 * the statement is REFUSED rather than quietly doing something, and the two spellings are recorded
 * beside each other so the divergence is a fact in the file rather than a surprise in a diff.
 *
 * Where a CALLER matches on the wording, that is a different obligation and is pinned separately:
 * `tests/corpus/adapters/graph-store.ts` looks for `Found duplicated primary key value`, and
 * `tests/unit/worker/graph/engine.test.ts` looks for `Binder exception`. Both engines satisfy those.
 */
const refusesBoth = async (
  cypher: string,
  params: Record<string, unknown> | undefined,
  wording: { ladybug: string, native: string }
): Promise<void> => {
  const message = await refusalOf(cypher, params)
  expect(message, 'it has to be refused by whichever engine is running').not.toBe('the engine accepted it')
  expect(message).toContain(graphEngine() === 'native' ? wording.native : wording.ladybug)
}

/**
 * Cases the REPLACEMENT deliberately does not satisfy, run against the reference and skipped against
 * the replacement so a native run stays a usable regression signal.
 *
 * A suite carrying seventeen known failures tells you nothing about the eighteenth. Each of these is
 * a decision written down elsewhere, and they fall into three groups:
 *
 * - VARIABLE LENGTH PATHS. No statement the app issues uses one; the only `*0..8` in the repo is a
 *   test that serves as the oracle for the JS union-find that replaced it. The replacement refuses
 *   them by name, so the day something needs one it says so rather than answering wrongly.
 * - THE EMPTY UNWIND. The reference dies on one, in two different ways, and nine comments across
 *   `src/worker/graph` warn about it. The replacement answers no rows, which is what an empty list
 *   means, and the guards those nine comments protect become unnecessary rather than wrong.
 * - THE ENGINE QUIRKS the replacement exists partly to remove: an UNWIND struct field typed from its
 *   first row and corrupting later ones, a DOUBLE reinterpreted as bits, the STRUCT refusal.
 */
const onlyReference = test.skipIf(graphEngine() === 'native')

const strings = (rows: readonly Record<string, unknown>[], key: string): string[] =>
  rows.map(row => String(row[key])).sort()

// ---------------------------------------------------------------------------------------------
// The fixture

/**
 * One table carrying every column type `schema.ts` declares, so the value-shape group can read each
 * one back off a single row. `at` carries the schema's only DEFAULT.
 */
const TYPES_TABLE = `CREATE NODE TABLE CTypes(
  uri STRING PRIMARY KEY,
  n INT64,
  score DOUBLE,
  owned BOOLEAN,
  raw JSON,
  categories STRING[],
  fieldSeq MAP(STRING, INT64),
  at TIMESTAMP DEFAULT current_timestamp()
)`

const FIXTURE = [
  TYPES_TABLE,
  'CREATE NODE TABLE CMedia(uri STRING PRIMARY KEY, origin STRING, n INT64, score DOUBLE, owned BOOLEAN, scope STRING)',
  'CREATE NODE TABLE CEpisode(uri STRING PRIMARY KEY, number INT64)',
  'CREATE NODE TABLE CAnswer(key STRING PRIMARY KEY, seq INT64)',
  'CREATE NODE TABLE CSort(uri STRING PRIMARY KEY, n INT64)',
  'CREATE NODE TABLE CWrite(uri STRING PRIMARY KEY, n INT64, label STRING)',
  'CREATE NODE TABLE CAtom(uri STRING PRIMARY KEY, n INT64)',
  'CREATE NODE TABLE CDiverge(uri STRING PRIMARY KEY, categories STRING[], score DOUBLE, fieldSeq MAP(STRING, INT64))',
  'CREATE REL TABLE CLINK(FROM CMedia TO CMedia, kind STRING, status STRING, confidence DOUBLE)',
  'CREATE REL TABLE CHAS_EPISODE(FROM CMedia TO CEpisode, claimer STRING)',
  // three declared pairs on one rel table, the shape `ABOUT` and `PROFILE_OF` both use
  'CREATE REL TABLE CABOUT(FROM CAnswer TO CMedia, FROM CAnswer TO CEpisode, FROM CAnswer TO CAnswer, by STRING)',
  'CREATE REL TABLE CWEDGE(FROM CWrite TO CWrite, kind STRING)',
]

// m:1 through m:5 are a directed SAME_AS chain, which is what the hop cases walk. m:9 states no
// origin and no scope, which is what the three-valued-logic cases read.
const MEDIA = [
  { uri: 'm:1', origin: 'mal', n: 1, score: 0.5, owned: true, scope: 'RUN' },
  { uri: 'm:2', origin: 'mal', n: 2, score: 1.5, owned: true, scope: 'RUN' },
  { uri: 'm:3', origin: 'cr', n: 3, score: 2.5, owned: false, scope: 'CONTAINER' },
  { uri: 'm:4', origin: 'cr', n: 4, score: 3.5, owned: true, scope: 'RUN' },
  { uri: 'm:5', origin: 'nf', n: 5, score: 4.5, owned: false, scope: 'RUN' },
  { uri: 'm:9', origin: null, n: null, score: null, owned: null, scope: null },
]

beforeAll(async () => {
  for (const statement of FIXTURE) await run(statement)

  await run(
    `UNWIND $rows AS r CREATE (:CMedia {uri: r.uri, origin: r.origin, n: r.n, score: r.score,
       owned: r.owned, scope: r.scope})`,
    { rows: MEDIA }
  )
  await run('UNWIND $rows AS r CREATE (:CEpisode {uri: r.uri, number: r.number})', {
    rows: [
      { uri: 'e:1', number: 1 },
      { uri: 'e:2', number: 2 },
      { uri: 'e:3', number: 3 },
    ],
  })
  await run('UNWIND $rows AS r CREATE (:CAnswer {key: r.key, seq: r.seq})', {
    rows: [{ key: 'a:1', seq: 1 }, { key: 'a:2', seq: 2 }],
  })
  await run('UNWIND $rows AS r CREATE (:CSort {uri: r.uri, n: r.n})', {
    rows: [
      { uri: 's:a', n: 3 },
      { uri: 's:b', n: 1 },
      { uri: 's:c', n: null },
      { uri: 's:d', n: 2 },
    ],
  })

  const link = async (from: string, to: string, kind: string, status: string, confidence: number) =>
    run(
      `MATCH (a:CMedia {uri: $from}), (b:CMedia {uri: $to})
       CREATE (a)-[:CLINK {kind: $kind, status: $status, confidence: $confidence}]->(b)`,
      { from, to, kind, status, confidence }
    )
  await link('m:1', 'm:2', 'SAME_AS', 'active', 0.9)
  await link('m:2', 'm:3', 'SAME_AS', 'active', 0.8)
  await link('m:3', 'm:4', 'SAME_AS', 'active', 0.7)
  await link('m:4', 'm:5', 'SAME_AS', 'active', 0.6)
  await link('m:1', 'm:5', 'PART_OF', 'refused', 0.1)

  // two episodes hung by the row's own origin and one by another, so count(DISTINCT) has something
  // to be distinct about
  const hang = async (media: string, episode: string, claimer: string) =>
    run(
      `MATCH (m:CMedia {uri: $media}), (e:CEpisode {uri: $episode})
       CREATE (m)-[:CHAS_EPISODE {claimer: $claimer}]->(e)`,
      { media, episode, claimer }
    )
  await hang('m:1', 'e:1', 'mal')
  await hang('m:1', 'e:2', 'mal')
  await hang('m:1', 'e:2', 'cr')
  await hang('m:2', 'e:3', 'mal')

  await run(
    'MATCH (a:CAnswer {key: $key}), (m:CMedia {uri: $uri}) CREATE (a)-[:CABOUT {by: $by}]->(m)',
    { key: 'a:1', uri: 'm:1', by: 'ingest' }
  )
  await run(
    'MATCH (a:CAnswer {key: $key}), (e:CEpisode {uri: $uri}) CREATE (a)-[:CABOUT {by: $by}]->(e)',
    { key: 'a:1', uri: 'e:1', by: 'ingest' }
  )
  await run(
    'MATCH (a:CAnswer {key: $key}), (b:CAnswer {key: $to}) CREATE (a)-[:CABOUT {by: $by}]->(b)',
    { key: 'a:1', to: 'a:2', by: 'ingest' }
  )
})

// ---------------------------------------------------------------------------------------------

describe('the DDL', () => {
  test('every column type section 2 declares loads, and each one projects by name', async () => {
    const tables = await run('CALL show_tables() RETURN *')
    expect(tables.map(row => row.name)).toContain('CTypes')

    // A declaration the engine accepted is not the same as a column that exists: a name it dropped
    // would be a binder error here rather than a missing key, which is why every column is asked for
    // rather than the table merely being counted.
    await run('CREATE (:CTypes {uri: $uri})', { uri: 't:columns' })
    const rows = await run(
      `MATCH (t:CTypes {uri: $uri})
       RETURN t.uri AS uri, t.n AS n, t.score AS score, t.owned AS owned, t.raw AS raw,
              t.categories AS categories, t.fieldSeq AS fieldSeq, t.at AS at`,
      { uri: 't:columns' }
    )

    expect(Object.keys(rows[0]!)).toEqual(['uri', 'n', 'score', 'owned', 'raw', 'categories', 'fieldSeq', 'at'])
  })

  test('a node table is a NODE and a rel table is a REL', async () => {
    const tables = await run('CALL show_tables() RETURN *')
    const kinds = new Map(tables.map(row => [row.name as string, row.type as string]))

    expect(kinds.get('CMedia')).toBe('NODE')
    expect(kinds.get('CLINK')).toBe('REL')
  })

  test('the primary key refuses a second row carrying the same value', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: 1})', { uri: 'w:pk' })

    const message = await refusalOf('CREATE (:CWrite {uri: $uri, n: 2})', { uri: 'w:pk' })
    expect(message).toContain(graphEngine() === 'native' ? 'Found duplicated primary key value' : 'Runtime exception: Found duplicated primary key value w:pk, '
      + 'which violates the uniqueness constraint of the primary key column.')
  })

  test('DEFAULT current_timestamp() fills a column nobody set', async () => {
    const before = Date.now()
    await run('CREATE (:CTypes {uri: $uri})', { uri: 't:default' })

    const rows = await run('MATCH (t:CTypes {uri: $uri}) RETURN t.at AS at', { uri: 't:default' })
    const at = rows[0]!.at as Date

    expect(at).toBeInstanceOf(Date)
    expect(at.getTime()).toBeGreaterThanOrEqual(before - 60_000)
    expect(at.getTime()).toBeLessThanOrEqual(Date.now() + 60_000)
  })

  test('one rel table carries edges of every FROM/TO pair it declared', async () => {
    const toMedia = await run('MATCH (a:CAnswer)-[:CABOUT]->(m:CMedia) RETURN m.uri AS uri')
    const toEpisode = await run('MATCH (a:CAnswer)-[:CABOUT]->(e:CEpisode) RETURN e.uri AS uri')
    const toAnswer = await run('MATCH (a:CAnswer)-[:CABOUT]->(b:CAnswer) RETURN b.key AS key')

    expect(strings(toMedia, 'uri')).toEqual(['m:1'])
    expect(strings(toEpisode, 'uri')).toEqual(['e:1'])
    expect(strings(toAnswer, 'key')).toEqual(['a:2'])
  })

  test('a rel table refuses an endpoint of a label it never declared', async () => {
    const message = await refusalOf(
      'MATCH (m:CMedia {uri: $uri}), (e:CEpisode {uri: $to}) CREATE (m)-[:CABOUT {by: $by}]->(e)',
      { uri: 'm:1', to: 'e:1', by: 'ingest' }
    )

    expect(message).toContain(graphEngine() === 'native' ? 'declares no FROM' : 'Binder exception: Query node m violates schema. Expected labels are CAnswer.')
  })

  test('IF NOT EXISTS run a second time changes nothing and keeps the rows', async () => {
    await run('CREATE NODE TABLE IF NOT EXISTS CIdem(uri STRING PRIMARY KEY, n INT64)')
    await run('CREATE (:CIdem {uri: $uri, n: 1})', { uri: 'i:1' })
    await run('CREATE NODE TABLE IF NOT EXISTS CIdem(uri STRING PRIMARY KEY, n INT64)')
    await run('CREATE REL TABLE IF NOT EXISTS CIDEM_EDGE(FROM CIdem TO CIdem, by STRING)')
    await run('CREATE REL TABLE IF NOT EXISTS CIDEM_EDGE(FROM CIdem TO CIdem, by STRING)')

    const rows = await run('MATCH (i:CIdem) RETURN i.uri AS uri, i.n AS n')
    expect(rows).toEqual([{ uri: 'i:1', n: 1 }])
  })

  test('a table declared without IF NOT EXISTS is refused the second time', async () => {
    const message = await refusalOf('CREATE NODE TABLE CIdem(uri STRING PRIMARY KEY, n INT64)')

    expect(message).toContain(graphEngine() === 'native' ? 'already exists' : 'Binder exception: CIdem already exists in catalog.')
  })
})

// ---------------------------------------------------------------------------------------------

/**
 * The most important group in the file.
 *
 * Every caller in `src/worker/graph` was written against these shapes rather than against a
 * specification, so a replacement that returns a BigInt, a boxed Number, a re-serialised JSON string
 * or an empty array where the engine returns null is wrong in a way no other test in the repo can
 * see. `typeof` is asserted beside the value for exactly that reason: `toBe(26)` passes for a boxed
 * `Number(26)` under `toEqual` and fails confusingly under `toBe`, and neither says which it was.
 */
describe('the value shape of every column type', () => {
  beforeAll(async () => {
    await run(
      `CREATE (:CTypes {uri: $uri, n: $n, score: $score, owned: $owned, raw: $raw,
         categories: $categories, fieldSeq: map($keys, $values), at: $at})`,
      {
        uri: 't:shapes',
        n: 26,
        score: 0.5,
        owned: true,
        raw: '{"b": 1, "a": [2, 3]}',
        categories: ['action', 'drama'],
        keys: ['titles', 'startDate'],
        values: [7, 9],
        at: new Date('2026-09-12T10:11:12.000Z'),
      }
    )
  })

  const shapeOf = async (column: string): Promise<unknown> => {
    const rows = await run(`MATCH (t:CTypes {uri: $uri}) RETURN t.${column} AS value`, { uri: 't:shapes' })
    return rows[0]!.value
  }

  test('STRING is a primitive string', async () => {
    const value = await shapeOf('uri')
    expect(typeof value).toBe('string')
    expect(value).toBe('t:shapes')
  })

  test('INT64 is a plain number, never a BigInt and never a boxed Number', async () => {
    const value = await shapeOf('n')
    expect(typeof value).toBe('number')
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBe(26)
  })

  test('DOUBLE is a number that keeps its fraction', async () => {
    const value = await shapeOf('score')
    expect(typeof value).toBe('number')
    expect(value).toBe(0.5)
  })

  test('BOOLEAN is a primitive boolean', async () => {
    const value = await shapeOf('owned')
    expect(typeof value).toBe('boolean')
    expect(value).toBe(true)
  })

  // The one that looks like a detail and is not. `plugins/writer.ts` decides whether a row changed by
  // comparing `JSON.stringify(desired)` against the string the store gave back, so an engine that
  // parsed and re-serialised this column would produce equal objects with different text and every
  // pass would rewrite every row forever while every test still passed.
  test('JSON is the stored string, byte for byte, spacing and key order included', async () => {
    const value = await shapeOf('raw')
    expect(typeof value).toBe('string')
    expect(value).toBe('{"b": 1, "a": [2, 3]}')
  })

  test('TIMESTAMP is a Date carrying the instant that was written', async () => {
    const value = await shapeOf('at')
    expect(value).toBeInstanceOf(Date)
    expect((value as Date).toISOString()).toBe('2026-09-12T10:11:12.000Z')
  })

  test('STRING[] is an array of primitive strings, in the order it was written', async () => {
    const value = await shapeOf('categories')
    expect(Array.isArray(value)).toBe(true)
    expect(value).toEqual(['action', 'drama'])
    expect((value as unknown[]).map(entry => typeof entry)).toEqual(['string', 'string'])
  })

  test('MAP is a plain object with Object.prototype, not a Map and not a null prototype', async () => {
    const value = await shapeOf('fieldSeq')
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
    expect(value).toEqual({ titles: 7, startDate: 9 })
    expect(Object.values(value as Record<string, unknown>).map(entry => typeof entry))
      .toEqual(['number', 'number'])
  })

  // Three callers depend on this (`read.ts` `stringsOf`, `plugins/writer.ts`'s comparison, and a `??`
  // in `plugins/profile.ts`). Storing `[]` and handing back `[]` is the more obvious implementation
  // and would silently change what all three do.
  test('an empty STRING[] reads back as null rather than as an empty array', async () => {
    await run('CREATE (:CTypes {uri: $uri, categories: $categories})', {
      uri: 't:emptylist',
      categories: [],
    })

    const rows = await run('MATCH (t:CTypes {uri: $uri}) RETURN t.categories AS categories', { uri: 't:emptylist' })
    expect(rows[0]!.categories).toBe(null)
  })

  test('a column nobody wrote reads back as null with its alias still present', async () => {
    await run('CREATE (:CTypes {uri: $uri})', { uri: 't:unset' })

    const rows = await run('MATCH (t:CTypes {uri: $uri}) RETURN t.n AS n, t.raw AS raw', { uri: 't:unset' })
    expect(rows).toEqual([{ n: null, raw: null }])
    expect('n' in rows[0]!).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------

describe('writes', () => {
  test('CREATE makes one row per pattern and returns no rows of its own', async () => {
    const returned = await run('CREATE (:CWrite {uri: $uri, n: $n, label: $label})', {
      uri: 'w:create', n: 1, label: 'first',
    })

    expect(returned).toEqual([])
    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n, w.label AS label', { uri: 'w:create' })
    expect(rows).toEqual([{ n: 1, label: 'first' }])
  })

  test('MERGE runs ON CREATE the first time and ON MATCH the second', async () => {
    const statement = `MERGE (w:CWrite {uri: $uri})
       ON CREATE SET w.n = $created, w.label = 'created'
       ON MATCH SET w.n = $matched, w.label = 'matched'`
    await run(statement, { uri: 'w:merge', created: 1, matched: 2 })
    const afterCreate = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n, w.label AS label', { uri: 'w:merge' })

    await run(statement, { uri: 'w:merge', created: 1, matched: 2 })
    const afterMatch = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n, w.label AS label', { uri: 'w:merge' })

    expect(afterCreate).toEqual([{ n: 1, label: 'created' }])
    expect(afterMatch).toEqual([{ n: 2, label: 'matched' }])
  })

  test('MERGE leaves exactly one row however many times it runs', async () => {
    for (let index = 0; index < 3; index += 1) {
      await run('MERGE (w:CWrite {uri: $uri}) ON CREATE SET w.n = 0', { uri: 'w:once' })
    }

    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:once' })
    expect(rows).toHaveLength(1)
  })

  test('SET writes a property onto an already matched node', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: 1})', { uri: 'w:set' })
    await run('MATCH (w:CWrite {uri: $uri}) SET w.n = $n, w.label = $label', { uri: 'w:set', n: 7, label: 'set' })

    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n, w.label AS label', { uri: 'w:set' })
    expect(rows).toEqual([{ n: 7, label: 'set' }])
  })

  test('SET writes a property onto a relationship matched by one of its own', async () => {
    await run('CREATE (:CWrite {uri: $a}), (:CWrite {uri: $b})', { a: 'w:se-a', b: 'w:se-b' })
    await run(
      'MATCH (a:CWrite {uri: $a}), (b:CWrite {uri: $b}) CREATE (a)-[:CWEDGE {kind: $kind}]->(b)',
      { a: 'w:se-a', b: 'w:se-b', kind: 'first' }
    )
    await run('MATCH ()-[e:CWEDGE {kind: $kind}]->() SET e.kind = $next', { kind: 'first', next: 'second' })

    const rows = await run('MATCH (a:CWrite {uri: $a})-[e:CWEDGE]->() RETURN e.kind AS kind', { a: 'w:se-a' })
    expect(rows).toEqual([{ kind: 'second' }])
  })

  test('SET to null clears a property that had a value', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: 5, label: $label})', { uri: 'w:clear', label: 'here' })
    await run('MATCH (w:CWrite {uri: $uri}) SET w.label = null', { uri: 'w:clear' })

    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n, w.label AS label', { uri: 'w:clear' })
    expect(rows).toEqual([{ n: 5, label: null }])
  })

  test('DELETE removes an edge and leaves both of its endpoints', async () => {
    await run('CREATE (:CWrite {uri: $a}), (:CWrite {uri: $b})', { a: 'w:de-a', b: 'w:de-b' })
    await run(
      'MATCH (a:CWrite {uri: $a}), (b:CWrite {uri: $b}) CREATE (a)-[:CWEDGE {kind: $kind}]->(b)',
      { a: 'w:de-a', b: 'w:de-b', kind: 'doomed' }
    )
    await run('MATCH ()-[e:CWEDGE {kind: $kind}]->() DELETE e', { kind: 'doomed' })

    const edges = await run('MATCH (a:CWrite {uri: $a})-[e:CWEDGE]->() RETURN e.kind AS kind', { a: 'w:de-a' })
    const nodes = await run('MATCH (w:CWrite) WHERE w.uri IN [$a, $b] RETURN w.uri AS uri', { a: 'w:de-a', b: 'w:de-b' })
    expect(edges).toEqual([])
    expect(strings(nodes, 'uri')).toEqual(['w:de-a', 'w:de-b'])
  })

  test('DELETE removes a node that carries no edge', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: 1})', { uri: 'w:lonely' })
    await run('MATCH (w:CWrite {uri: $uri}) DELETE w', { uri: 'w:lonely' })

    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:lonely' })
    expect(rows).toEqual([])
  })

  // The refusal `plugins/writer.ts` was written around: a plugin retracting a node another plugin's
  // edge hangs off has to say DETACH, and the message is what tells it which.
  test('DELETE refuses a node that still carries an edge, naming the connected edges', async () => {
    await run('CREATE (:CWrite {uri: $a}), (:CWrite {uri: $b})', { a: 'w:held-a', b: 'w:held-b' })
    await run(
      'MATCH (a:CWrite {uri: $a}), (b:CWrite {uri: $b}) CREATE (a)-[:CWEDGE {kind: $kind}]->(b)',
      { a: 'w:held-a', b: 'w:held-b', kind: 'holds' }
    )

    const message = await refusalOf('MATCH (w:CWrite {uri: $uri}) DELETE w', { uri: 'w:held-a' })
    // The full sentence, minus the `Node(nodeOffset: 5)` it opens with: that offset is an engine
    // internal with no meaning outside it, and it is the one part of the wording a replacement
    // neither can nor should reproduce.
    expect(message).toContain(graphEngine() === 'native' ? 'has connected edges in table CWEDGE' : 'has connected edges in table CWEDGE in the fwd direction, which cannot be deleted. '
      + 'Please delete the edges first or try DETACH DELETE.')

    const survived = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:held-a' })
    expect(survived).toHaveLength(1)
  })

  test('DETACH DELETE removes the node and every edge hanging off it', async () => {
    await run('MATCH (w:CWrite {uri: $uri}) DETACH DELETE w', { uri: 'w:held-a' })

    const nodes = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:held-a' })
    const edges = await run('MATCH ()-[e:CWEDGE {kind: $kind}]->() RETURN e.kind AS kind', { kind: 'holds' })
    const other = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:held-b' })
    expect(nodes).toEqual([])
    expect(edges).toEqual([])
    expect(other).toHaveLength(1)
  })

  test('a duplicate primary key is refused with the value it duplicated', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: 1})', { uri: 'w:dup' })

    const message = await refusalOf('CREATE (:CWrite {uri: $uri, n: 2})', { uri: 'w:dup' })
    expect(message).toContain(graphEngine() === 'native' ? 'Found duplicated primary key value' : 'Runtime exception: Found duplicated primary key value w:dup, '
      + 'which violates the uniqueness constraint of the primary key column.')
  })

  // The two wordings a wrong type arrives with, which are NOT interchangeable: the same param, the
  // same column, one message per spelling. `engine.test.ts` quotes the SET one and `values.ts`
  // produces a third of its own, so a caller matching on any single one of them is matching on a
  // spelling rather than on a fact.
  test('a string param into an INT64 column is refused inline as a failed conversion', async () => {
    const message = await refusalOf('CREATE (:CWrite {uri: $uri, n: $n})', { uri: 'w:badtype', n: 'twenty six' })

    expect(message).toContain(graphEngine() === 'native' ? 'expected INT64' : 'Conversion exception: Cast failed. Could not convert "twenty six" to INT64.')
  })

  test('a string param into an INT64 column is refused through SET as a binder error', async () => {
    await run('CREATE (:CWrite {uri: $uri})', { uri: 'w:badtype2' })

    const message = await refusalOf('MATCH (w:CWrite {uri: $uri}) SET w.n = $n', { uri: 'w:badtype2', n: 'twenty six' })

    expect(message).toContain(graphEngine() === 'native' ? 'expected INT64' : 'Binder exception: Expression $n has data type STRING but expected INT64. Implicit cast is not supported.')
  })

  // The other half of that, and the reason `ingest.ts` can hand every typed scalar over as text: a
  // numeric string IS accepted inline, so the refusal above is about the VALUE rather than the type
  // of the param. Without this case the one above reads as "a STRING param is refused", which is
  // false and would send a reimplementation to the wrong rule.
  test('a numeric string param into an INT64 column is accepted inline and reads back a number', async () => {
    await run('CREATE (:CWrite {uri: $uri, n: $n})', { uri: 'w:numstring', n: '26' })

    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.n AS n', { uri: 'w:numstring' })
    expect(typeof rows[0]!.n).toBe('number')
    expect(rows[0]!.n).toBe(26)
  })

  test('two rows of one batch duplicating a key take the whole batch down', async () => {
    const message = await refusalOf(
      'UNWIND $rows AS r CREATE (:CWrite {uri: r.uri, n: r.n})',
      { rows: [{ uri: 'w:batchdup', n: 1 }, { uri: 'w:batchdup', n: 2 }] }
    )

    expect(message).toContain(graphEngine() === 'native' ? 'Found duplicated primary key value' : 'Runtime exception: Found duplicated primary key value w:batchdup')
    const rows = await run('MATCH (w:CWrite {uri: $uri}) RETURN w.uri AS uri', { uri: 'w:batchdup' })
    expect(rows).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------

/**
 * A statement is ALL OR NOTHING, which is what lets a caller retry a failed batch.
 *
 * The app writes 2,000 row batches. If row 900 fails its type check and the 899 before it survived,
 * the retry would die on duplicate keys instead, and the real failure would be three layers away from
 * its cause. The control below is the same batch with the bad row removed: without it, a case
 * asserting "nothing was written" would pass just as well against a statement that never ran.
 */
describe('atomicity', () => {
  test('a batch whose last row fails its cast leaves none of the earlier rows behind', async () => {
    const message = await refusalOf(
      'UNWIND $rows AS r CREATE (:CAtom {uri: r.uri, n: cast(r.n AS INT64)})',
      {
        rows: [
          { uri: 'atom:1', n: '1' },
          { uri: 'atom:2', n: '2' },
          { uri: 'atom:3', n: '1e+21' },
        ],
      }
    )
    expect(message).toContain(graphEngine() === 'native' ? 'expected INT64' : graphEngine() === 'native' ? 'expected INT64' : 'Conversion exception: Cast failed. Could not convert "1e+21" to INT64.')

    const rows = await run('MATCH (a:CAtom) RETURN a.uri AS uri')
    expect(strings(rows, 'uri')).toEqual([])
  })

  test('the same batch with every row castable writes all three, which is the control', async () => {
    await run('UNWIND $rows AS r CREATE (:CAtom {uri: r.uri, n: cast(r.n AS INT64)})', {
      rows: [
        { uri: 'atom:1', n: '1' },
        { uri: 'atom:2', n: '2' },
        { uri: 'atom:3', n: '3' },
      ],
    })

    const rows = await run('MATCH (a:CAtom) RETURN a.uri AS uri')
    expect(strings(rows, 'uri')).toEqual(['atom:1', 'atom:2', 'atom:3'])
  })

  test('a failed batch leaves the rows an earlier statement committed alone', async () => {
    const message = await refusalOf(
      'UNWIND $rows AS r CREATE (:CAtom {uri: r.uri, n: cast(r.n AS INT64)})',
      { rows: [{ uri: 'atom:4', n: '4' }, { uri: 'atom:5', n: 'not a number' }] }
    )
    expect(message).toContain(graphEngine() === 'native' ? 'expected INT64' : 'Conversion exception: Cast failed. Could not convert "not a number" to INT64.')

    const rows = await run('MATCH (a:CAtom) RETURN a.uri AS uri')
    expect(strings(rows, 'uri')).toEqual(['atom:1', 'atom:2', 'atom:3'])
  })
})

// ---------------------------------------------------------------------------------------------

describe('reads', () => {
  test('a point lookup by primary key answers exactly one row', async () => {
    const rows = await run('MATCH (m:CMedia {uri: $uri}) RETURN m.uri AS uri, m.n AS n', { uri: 'm:3' })

    expect(rows).toEqual([{ uri: 'm:3', n: 3 }])
  })

  test('a point lookup of a key that is not there answers no rows at all', async () => {
    const rows = await run('MATCH (m:CMedia {uri: $uri}) RETURN m.uri AS uri', { uri: 'm:absent' })

    expect(rows).toEqual([])
  })

  test('a filtered scan answers every row the predicate keeps', async () => {
    const rows = await run('MATCH (m:CMedia) WHERE m.origin = $origin RETURN m.uri AS uri', { origin: 'mal' })

    expect(strings(rows, 'uri')).toEqual(['m:1', 'm:2'])
  })

  test('an inline property pattern filters the same way a WHERE does', async () => {
    const inline = await run('MATCH (m:CMedia {origin: $origin}) RETURN m.uri AS uri', { origin: 'cr' })
    const where = await run('MATCH (m:CMedia) WHERE m.origin = $origin RETURN m.uri AS uri', { origin: 'cr' })

    expect(strings(inline, 'uri')).toEqual(['m:3', 'm:4'])
    expect(strings(inline, 'uri')).toEqual(strings(where, 'uri'))
  })

  test('one hop reaches the neighbour and binds the edge beside it', async () => {
    const rows = await run(
      'MATCH (a:CMedia {uri: $uri})-[l:CLINK]->(b:CMedia) RETURN b.uri AS uri, l.kind AS kind, l.status AS status',
      { uri: 'm:2' }
    )

    expect(rows).toEqual([{ uri: 'm:3', kind: 'SAME_AS', status: 'active' }])
  })

  test('a directed hop is not walked backwards', async () => {
    const forward = await run('MATCH (a:CMedia {uri: $uri})-[:CLINK]->(b:CMedia) RETURN b.uri AS uri', { uri: 'm:5' })
    const backward = await run('MATCH (a:CMedia {uri: $uri})<-[:CLINK]-(b:CMedia) RETURN b.uri AS uri', { uri: 'm:5' })

    expect(forward).toEqual([])
    expect(strings(backward, 'uri')).toEqual(['m:1', 'm:4'])
  })

  test('an undirected hop answers the neighbours on both sides', async () => {
    const rows = await run('MATCH (a:CMedia {uri: $uri})-[:CLINK]-(b:CMedia) RETURN b.uri AS uri', { uri: 'm:3' })

    expect(strings(rows, 'uri')).toEqual(['m:2', 'm:4'])
  })

  test('four spelled out hops walk the whole chain in one pattern', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[:CLINK]->(b:CMedia)-[:CLINK]->(c:CMedia)-[:CLINK]->(d:CMedia)-[:CLINK]->(e:CMedia)
       RETURN b.uri AS b, c.uri AS c, d.uri AS d, e.uri AS e`,
      { uri: 'm:1' }
    )

    expect(rows).toEqual([{ b: 'm:2', c: 'm:3', d: 'm:4', e: 'm:5' }])
  })

  onlyReference('a variable length path of one to four hops reaches every node downstream', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[e:CLINK*1..4 (r, _ | WHERE r.kind = 'SAME_AS')]->(b:CMedia)
       RETURN DISTINCT b.uri AS uri`,
      { uri: 'm:1' }
    )

    expect(strings(rows, 'uri')).toEqual(['m:2', 'm:3', 'm:4', 'm:5'])
  })

  // Measured while writing this, and the expectation here was wrong first: the unfiltered walk
  // answered `m:5` TWICE. A variable length pattern answers one row per PATH rather than one per
  // endpoint, and m:5 is reachable both by the four hop SAME_AS chain and by the one hop refused
  // PART_OF edge. That is why every such read in `plugins/guards.ts` carries DISTINCT.
  onlyReference('a variable length path answers one row per path, so a node reachable two ways appears twice', async () => {
    const rows = await run('MATCH (a:CMedia {uri: $uri})-[:CLINK*1..4]->(b:CMedia) RETURN b.uri AS uri', { uri: 'm:1' })

    expect(strings(rows, 'uri')).toEqual(['m:2', 'm:3', 'm:4', 'm:5', 'm:5'])
  })

  onlyReference('a variable length path starting at zero hops includes the node it started from', async () => {
    const rows = await run('MATCH (a:CMedia {uri: $uri})-[:CLINK*0..4]->(b:CMedia) RETURN b.uri AS uri', { uri: 'm:3' })

    expect(strings(rows, 'uri')).toEqual(['m:3', 'm:4', 'm:5'])
  })

  onlyReference('a filtered variable length path walks only the edges its filter keeps', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[e:CLINK*1..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]->(b:CMedia)
       RETURN DISTINCT b.uri AS uri`,
      { uri: 'm:1' }
    )

    expect(strings(rows, 'uri')).toEqual(['m:2', 'm:3', 'm:4', 'm:5'])
  })

  // The second expectation this file got wrong, and it is the one that matters most to a
  // reimplementation: an UNDIRECTED walk of one or more hops answers the node it started from.
  // `plugins/guards.ts` reads a whole SAME_AS component this way and unions it in JS, so a
  // replacement that excluded the start would silently drop each component's own member.
  onlyReference('an undirected variable length walk answers the node it started from', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[e:CLINK*1..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:CMedia)
       RETURN DISTINCT b.uri AS uri`,
      { uri: 'm:1' }
    )

    expect(strings(rows, 'uri')).toEqual(['m:1', 'm:2', 'm:3', 'm:4', 'm:5'])
  })

  // ...and the mechanism, because it decides what a replacement's walk has to allow: the second hop
  // comes back over the edge the first arrived on, so a walk reuses a relationship rather than
  // being a trail. At exactly two hops from m:1 that is the only way m:1 can be in the answer.
  onlyReference('an undirected walk reuses the edge it arrived on, so two hops returns to the start', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[e:CLINK*2..2 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:CMedia)
       RETURN DISTINCT b.uri AS uri`,
      { uri: 'm:1' }
    )

    expect(strings(rows, 'uri')).toEqual(['m:1', 'm:3'])
  })

  test('OPTIONAL MATCH keeps the driving row and nulls every alias of the pattern that missed', async () => {
    const rows = await run(
      `MATCH (m:CMedia {uri: $uri})
       OPTIONAL MATCH (m)-[l:CLINK]->(b:CMedia)
       RETURN m.uri AS uri, b.uri AS other, l.kind AS kind`,
      { uri: 'm:5' }
    )

    expect(rows).toEqual([{ uri: 'm:5', other: null, kind: null }])
  })

  test('OPTIONAL MATCH that hits answers one row per match, the driving column repeated', async () => {
    const rows = await run(
      `MATCH (m:CMedia {uri: $uri})
       OPTIONAL MATCH (m)-[:CHAS_EPISODE]->(e:CEpisode)
       RETURN m.uri AS uri, e.uri AS episode`,
      { uri: 'm:1' }
    )

    expect(rows).toHaveLength(3)
    expect(strings(rows, 'episode')).toEqual(['e:1', 'e:2', 'e:2'])
    expect(new Set(rows.map(row => row.uri))).toEqual(new Set(['m:1']))
  })

  test('two comma separated patterns in one MATCH join on nothing and answer one row', async () => {
    const rows = await run(
      'MATCH (a:CMedia {uri: $a}), (b:CMedia {uri: $b}) RETURN a.uri AS a, b.uri AS b',
      { a: 'm:1', b: 'm:4' }
    )

    expect(rows).toEqual([{ a: 'm:1', b: 'm:4' }])
  })

  test('three comma separated patterns in one MATCH bind all three variables', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $a}), (b:CMedia {uri: $b}), (e:CEpisode {uri: $e})
       RETURN a.uri AS a, b.uri AS b, e.uri AS e`,
      { a: 'm:1', b: 'm:2', e: 'e:1' }
    )

    expect(rows).toEqual([{ a: 'm:1', b: 'm:2', e: 'e:1' }])
  })

  test('two MATCH clauses read the same as one MATCH with a comma', async () => {
    const comma = await run(
      'MATCH (a:CMedia {uri: $a}), (b:CMedia {uri: $b}) RETURN a.uri AS a, b.uri AS b',
      { a: 'm:1', b: 'm:4' }
    )
    const clauses = await run(
      'MATCH (a:CMedia {uri: $a}) MATCH (b:CMedia {uri: $b}) RETURN a.uri AS a, b.uri AS b',
      { a: 'm:1', b: 'm:4' }
    )

    expect(clauses).toEqual(comma)
  })

  test('a second MATCH clause correlates through a variable the first bound', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})-[:CLINK]->(b:CMedia)
       MATCH (b)-[:CLINK]->(c:CMedia)
       RETURN b.uri AS b, c.uri AS c`,
      { uri: 'm:1' }
    )

    expect(rows).toEqual([{ b: 'm:2', c: 'm:3' }])
  })

  test('UNWIND drives one lookup per item and drops the items that match nothing', async () => {
    const rows = await run(
      'UNWIND $uris AS u MATCH (m:CMedia {uri: u}) RETURN u AS asked, m.n AS n',
      { uris: ['m:1', 'm:absent', 'm:4'] }
    )

    expect(rows).toEqual([{ asked: 'm:1', n: 1 }, { asked: 'm:4', n: 4 }])
  })
})

// ---------------------------------------------------------------------------------------------

describe('WHERE', () => {
  const urisWhere = async (predicate: string, params?: Record<string, unknown>) => {
    const rows = await run(`MATCH (m:CMedia) WHERE ${predicate} RETURN m.uri AS uri`, params)
    return strings(rows, 'uri')
  }

  test('= keeps the rows whose column equals the value', async () => {
    expect(await urisWhere('m.n = $n', { n: 3 })).toEqual(['m:3'])
  })

  test('<> keeps the rows that differ and drops the rows whose column is null', async () => {
    expect(await urisWhere('m.origin <> $origin', { origin: 'mal' })).toEqual(['m:3', 'm:4', 'm:5'])
  })

  test('< and <= differ by the boundary row', async () => {
    expect(await urisWhere('m.n < $n', { n: 3 })).toEqual(['m:1', 'm:2'])
    expect(await urisWhere('m.n <= $n', { n: 3 })).toEqual(['m:1', 'm:2', 'm:3'])
  })

  test('> and >= differ by the boundary row', async () => {
    expect(await urisWhere('m.n > $n', { n: 3 })).toEqual(['m:4', 'm:5'])
    expect(await urisWhere('m.n >= $n', { n: 3 })).toEqual(['m:3', 'm:4', 'm:5'])
  })

  test('a DOUBLE column compares against a fractional bound', async () => {
    expect(await urisWhere('m.score >= $score', { score: 2.5 })).toEqual(['m:3', 'm:4', 'm:5'])
  })

  test('a BOOLEAN column reads as a predicate on its own', async () => {
    expect(await urisWhere('m.owned')).toEqual(['m:1', 'm:2', 'm:4'])
  })

  test('IN over a list literal keeps every named row', async () => {
    expect(await urisWhere("m.origin IN ['cr', 'nf']")).toEqual(['m:3', 'm:4', 'm:5'])
  })

  test('IN over a list param keeps every named row', async () => {
    expect(await urisWhere('m.uri IN $uris', { uris: ['m:1', 'm:5', 'm:absent'] })).toEqual(['m:1', 'm:5'])
  })

  test('STARTS WITH keeps the rows whose string carries the prefix', async () => {
    expect(await urisWhere('m.uri STARTS WITH $prefix', { prefix: 'm:' })).toEqual(
      ['m:1', 'm:2', 'm:3', 'm:4', 'm:5', 'm:9']
    )
    expect(await urisWhere('m.uri STARTS WITH $prefix', { prefix: 'm:4' })).toEqual(['m:4'])
  })

  test('AND keeps only the rows both halves keep', async () => {
    expect(await urisWhere("m.origin = 'cr' AND m.owned")).toEqual(['m:4'])
  })

  test('OR keeps the rows either half keeps', async () => {
    expect(await urisWhere("m.origin = 'nf' OR m.n = 1")).toEqual(['m:1', 'm:5'])
  })

  test('NOT inverts a predicate over a column that has a value', async () => {
    expect(await urisWhere("NOT (m.origin = 'mal') AND m.origin IS NOT NULL")).toEqual(['m:3', 'm:4', 'm:5'])
  })

  // Three-valued logic, and the reason `ingest.ts:1224` spells a null check out beside a `<>`. A
  // predicate over a null column is UNKNOWN rather than false, so the row survives neither the
  // predicate nor its negation, and only IS NULL finds it.
  test('a predicate over a null column keeps the row out of both itself and its negation', async () => {
    const matching = await urisWhere("m.origin = 'mal'")
    const negated = await urisWhere("NOT (m.origin = 'mal')")

    expect(matching).not.toContain('m:9')
    expect(negated).not.toContain('m:9')
  })

  test('IS NULL is the only predicate that finds the row whose column was never set', async () => {
    expect(await urisWhere('m.origin IS NULL')).toEqual(['m:9'])
  })

  test('IS NOT NULL keeps every row that states a value', async () => {
    expect(await urisWhere('m.origin IS NOT NULL')).toEqual(['m:1', 'm:2', 'm:3', 'm:4', 'm:5'])
  })

  test('IS NULL OR a comparison is how a null column joins a negative predicate', async () => {
    expect(await urisWhere("m.scope IS NULL OR m.scope <> 'CONTAINER'")).toEqual(
      ['m:1', 'm:2', 'm:4', 'm:5', 'm:9']
    )
  })

  test('EXISTS keeps the rows whose pattern has at least one match', async () => {
    expect(await urisWhere('EXISTS { MATCH (m)-[:CHAS_EPISODE]->(:CEpisode) }')).toEqual(['m:1', 'm:2'])
  })

  test('NOT EXISTS keeps exactly the rows EXISTS dropped', async () => {
    expect(await urisWhere('NOT EXISTS { MATCH (m)-[:CHAS_EPISODE]->(:CEpisode) }')).toEqual(
      ['m:3', 'm:4', 'm:5', 'm:9']
    )
  })

  test('an EXISTS subquery carries its own WHERE over the edge it matched', async () => {
    expect(await urisWhere("EXISTS { MATCH (m)-[l:CLINK]->(:CMedia) WHERE l.status = 'refused' }")).toEqual(['m:1'])
  })

  test('a WHERE on the edge filters the hop rather than the row it landed on', async () => {
    const rows = await run(
      "MATCH (a:CMedia)-[l:CLINK]->(b:CMedia) WHERE l.status = 'refused' RETURN a.uri AS a, b.uri AS b"
    )

    expect(rows).toEqual([{ a: 'm:1', b: 'm:5' }])
  })

  test('a WHERE naming an UNWIND variable correlates the two', async () => {
    const rows = await run(
      'UNWIND $rows AS r MATCH (m:CMedia {uri: r.uri}) WHERE m.n > r.floor RETURN m.uri AS uri',
      { rows: [{ uri: 'm:1', floor: 0 }, { uri: 'm:2', floor: 5 }, { uri: 'm:4', floor: 1 }] }
    )

    expect(strings(rows, 'uri')).toEqual(['m:1', 'm:4'])
  })
})

// ---------------------------------------------------------------------------------------------

describe('RETURN', () => {
  test('an alias names the column, and the expression it aliases does not appear', async () => {
    const rows = await run('MATCH (m:CMedia {uri: $uri}) RETURN m.uri AS theUri, m.n AS theCount', { uri: 'm:1' })

    expect(Object.keys(rows[0]!)).toEqual(['theUri', 'theCount'])
    expect(rows).toEqual([{ theUri: 'm:1', theCount: 1 }])
  })

  test('a literal and a param project as columns of their own', async () => {
    const rows = await run(
      "MATCH (m:CMedia {uri: $uri}) RETURN m.uri AS uri, 'plugin:direct' AS by, $version AS version",
      { uri: 'm:1', version: 3 }
    )

    expect(rows).toEqual([{ uri: 'm:1', by: 'plugin:direct', version: 3 }])
  })

  test('DISTINCT folds the repeated projections into one row each', async () => {
    const all = await run('MATCH (m:CMedia) WHERE m.origin IS NOT NULL RETURN m.origin AS origin')
    const distinct = await run('MATCH (m:CMedia) WHERE m.origin IS NOT NULL RETURN DISTINCT m.origin AS origin')

    expect(all).toHaveLength(5)
    expect(strings(distinct, 'origin')).toEqual(['cr', 'mal', 'nf'])
  })

  test('count(*) counts the rows the match produced', async () => {
    const rows = await run('MATCH (m:CMedia) RETURN count(*) AS total')

    expect(rows).toEqual([{ total: 6 }])
    expect(typeof rows[0]!.total).toBe('number')
  })

  test('count over a variable counts the same rows', async () => {
    const rows = await run('MATCH (m:CMedia) WHERE m.origin = $origin RETURN count(m) AS total', { origin: 'mal' })

    expect(rows).toEqual([{ total: 2 }])
  })

  test('count over an empty match answers one row carrying zero, not no rows', async () => {
    const rows = await run('MATCH (m:CMedia) WHERE m.origin = $origin RETURN count(m) AS total', { origin: 'nobody' })

    expect(rows).toEqual([{ total: 0 }])
  })

  test('count(DISTINCT ...) drops the repeat that plain count keeps', async () => {
    const plain = await run(
      'MATCH (m:CMedia {uri: $uri})-[:CHAS_EPISODE]->(e:CEpisode) RETURN count(e) AS total',
      { uri: 'm:1' }
    )
    const distinct = await run(
      'MATCH (m:CMedia {uri: $uri})-[:CHAS_EPISODE]->(e:CEpisode) RETURN count(DISTINCT e.uri) AS total',
      { uri: 'm:1' }
    )

    expect(plain).toEqual([{ total: 3 }])
    expect(distinct).toEqual([{ total: 2 }])
  })

  test('collect gathers the matched values into one list column', async () => {
    const rows = await run(
      'MATCH (m:CMedia {uri: $uri})-[:CHAS_EPISODE]->(e:CEpisode) RETURN collect(e.uri) AS uris',
      { uri: 'm:1' }
    )

    expect(rows).toHaveLength(1)
    expect([...(rows[0]!.uris as string[])].sort()).toEqual(['e:1', 'e:2', 'e:2'])
  })

  test('collect(DISTINCT ...) gathers each value once', async () => {
    const rows = await run(
      'MATCH (m:CMedia {uri: $uri})-[:CHAS_EPISODE]->(e:CEpisode) RETURN collect(DISTINCT e.uri) AS uris',
      { uri: 'm:1' }
    )

    expect([...(rows[0]!.uris as string[])].sort()).toEqual(['e:1', 'e:2'])
  })

  // The expectation here was `[]` first, and the engine said null. It is the same rule the value
  // model states for an empty `STRING[]` column, reaching a projected list as well as a stored one:
  // a caller counting what collect gathered has to read null as none.
  test('collect over an empty match answers one row carrying null rather than an empty list', async () => {
    const rows = await run(
      'MATCH (m:CMedia {uri: $uri})-[:CHAS_EPISODE]->(e:CEpisode) RETURN collect(e.uri) AS uris',
      { uri: 'm:5' }
    )

    expect(rows).toEqual([{ uris: null }])
  })

  test('an aggregate beside a grouping key groups by that key', async () => {
    const rows = await run(
      'MATCH (m:CMedia) WHERE m.origin IS NOT NULL RETURN m.origin AS origin, count(m) AS total ORDER BY origin'
    )

    expect(rows).toEqual([
      { origin: 'cr', total: 2 },
      { origin: 'mal', total: 2 },
      { origin: 'nf', total: 1 },
    ])
  })

  // Written as `ORDER BY m.origin` first, which is legal beside a plain projection and is refused
  // beside an aggregate: the aggregating RETURN drops every pattern variable and leaves only its own
  // aliases. The message names the variable rather than the clause, so it reads as a typo.
  test('an aggregating RETURN drops the pattern variables, so ORDER BY must name an alias', async () => {
    const message = await refusalOf(
      'MATCH (m:CMedia) WHERE m.origin IS NOT NULL RETURN m.origin AS origin, count(m) AS total ORDER BY m.origin'
    )

    expect(message).toContain(graphEngine() === 'native' ? 'ORDER BY a pattern variable' : 'Binder exception: Variable m is not in scope.')
  })

  test('coalesce answers its first stated argument and skips the nulls before it', async () => {
    const rows = await run(
      'MATCH (m:CMedia) RETURN m.uri AS uri, coalesce(m.origin, $fallback) AS origin ORDER BY m.uri',
      { fallback: 'none' }
    )

    expect(rows.map(row => row.origin)).toEqual(['mal', 'mal', 'cr', 'cr', 'nf', 'none'])
  })

  test('coalesce reads in a WHERE as well as in a projection', async () => {
    const rows = await run(
      'MATCH (m:CMedia) WHERE coalesce(m.origin, $fallback) = $fallback RETURN m.uri AS uri',
      { fallback: 'none' }
    )

    expect(strings(rows, 'uri')).toEqual(['m:9'])
  })

  test('CASE projects a column the schema does not carry', async () => {
    const rows = await run(
      `MATCH (m:CMedia) WHERE m.origin IS NOT NULL
       RETURN m.uri AS uri, CASE WHEN m.n > 3 THEN 'high' ELSE 'low' END AS band
       ORDER BY m.uri`
    )

    expect(rows.map(row => row.band)).toEqual(['low', 'low', 'low', 'high', 'high'])
  })

  test('ORDER BY ascending sorts the stated values low to high', async () => {
    const rows = await run('MATCH (s:CSort) WHERE s.n IS NOT NULL RETURN s.uri AS uri, s.n AS n ORDER BY s.n')

    expect(rows.map(row => row.uri)).toEqual(['s:b', 's:d', 's:a'])
  })

  test('ORDER BY DESC reverses that order', async () => {
    const rows = await run('MATCH (s:CSort) WHERE s.n IS NOT NULL RETURN s.uri AS uri ORDER BY s.n DESC')

    expect(rows.map(row => row.uri)).toEqual(['s:a', 's:d', 's:b'])
  })

  // Where a null sorts is not a detail: the app orders by columns that are routinely unset, so a
  // replacement that put nulls at the other end would reorder a page without failing anything else.
  test('ORDER BY ascending puts a null column last', async () => {
    const rows = await run('MATCH (s:CSort) RETURN s.uri AS uri, s.n AS n ORDER BY s.n')

    expect(rows.map(row => row.uri)).toEqual(['s:b', 's:d', 's:a', 's:c'])
  })

  test('ORDER BY descending puts a null column first', async () => {
    const rows = await run('MATCH (s:CSort) RETURN s.uri AS uri, s.n AS n ORDER BY s.n DESC')

    expect(rows.map(row => row.uri)).toEqual(['s:c', 's:a', 's:d', 's:b'])
  })

  test('ORDER BY over a string column sorts it', async () => {
    const rows = await run('MATCH (m:CMedia) RETURN m.uri AS uri ORDER BY m.uri')

    expect(rows.map(row => row.uri)).toEqual(['m:1', 'm:2', 'm:3', 'm:4', 'm:5', 'm:9'])
  })

  test('ORDER BY over two keys breaks the first key ties with the second', async () => {
    const rows = await run(
      'MATCH (m:CMedia) WHERE m.origin IS NOT NULL RETURN m.uri AS uri ORDER BY m.origin, m.n DESC'
    )

    expect(rows.map(row => row.uri)).toEqual(['m:4', 'm:3', 'm:2', 'm:1', 'm:5'])
  })

  test('ORDER BY reads a relationship property beside a node property', async () => {
    const rows = await run(
      'MATCH (a:CMedia)-[l:CLINK]->(b:CMedia) RETURN a.uri AS a, l.confidence AS confidence ORDER BY l.confidence DESC, a.uri'
    )

    expect(rows.map(row => row.confidence)).toEqual([0.9, 0.8, 0.7, 0.6, 0.1])
  })

  test('LIMIT cuts the ordered rows to its count', async () => {
    const rows = await run('MATCH (m:CMedia) RETURN m.uri AS uri ORDER BY m.uri LIMIT 2')

    expect(rows.map(row => row.uri)).toEqual(['m:1', 'm:2'])
  })

  test('LIMIT past the end answers every row there is', async () => {
    const rows = await run('MATCH (m:CMedia) RETURN m.uri AS uri ORDER BY m.uri LIMIT 100')

    expect(rows).toHaveLength(6)
  })
})

// ---------------------------------------------------------------------------------------------

/**
 * WITH, where this file is WIDER than what the replacement has to implement.
 *
 * The app issues `WITH` exactly ONCE across its 154 statements and never orders or limits inside one.
 * These cases document what the reference engine does, which is worth having written down, but only
 * the plain projection and the `WHERE` on it are requirements. `WITH ... ORDER BY ... LIMIT` is
 * refused by the replacement at bind time, naming the construct, and that is a decision rather than a
 * gap: implementing mid-pipeline ordering to satisfy a shape nothing asks for is how a closed subset
 * stops being closed. The refusal is loud, so the day something does ask, it says so.
 */
describe('WITH', () => {
  test('WITH projects a set of columns the clauses after it read by alias', async () => {
    const rows = await run(
      `MATCH (m:CMedia) WHERE m.origin IS NOT NULL
       WITH m.uri AS uri, m.n AS n
       RETURN uri, n ORDER BY n DESC LIMIT 2`
    )

    expect(rows).toEqual([{ uri: 'm:5', n: 5 }, { uri: 'm:4', n: 4 }])
  })

  test('a WHERE on a WITH filters the projected rows rather than the matched ones', async () => {
    const rows = await run(
      `MATCH (m:CMedia)
       WITH m.uri AS uri, coalesce(m.n, $floor) AS n
       WHERE n > $floor
       RETURN uri ORDER BY uri`,
      { floor: 3 }
    )

    expect(rows.map(row => row.uri)).toEqual(['m:4', 'm:5'])
  })

  test('WITH carries a node variable through to a later pattern', async () => {
    const rows = await run(
      `MATCH (a:CMedia {uri: $uri})
       WITH a
       MATCH (a)-[:CHAS_EPISODE]->(e:CEpisode)
       RETURN e.uri AS uri ORDER BY e.uri`,
      { uri: 'm:1' }
    )

    expect(rows.map(row => row.uri)).toEqual(['e:1', 'e:2', 'e:2'])
  })

  onlyReference('WITH ... LIMIT cuts the rows before the clauses that follow see them', async () => {
    const rows = await run(
      `MATCH (m:CMedia) WHERE m.origin IS NOT NULL
       WITH m ORDER BY m.n DESC LIMIT 2
       RETURN m.uri AS uri`
    )

    expect(strings(rows, 'uri')).toEqual(['m:4', 'm:5'])
  })

  // The refusal `00-engine-facts.md` records, pinned rather than quoted: a `WITH ... ORDER BY` with
  // no SKIP and no LIMIT is a parser error, so the obvious way to make a `collect` deterministic is
  // the one spelling that does not exist.
  test('WITH ... ORDER BY without SKIP or LIMIT is refused', async () => {
    const message = await refusalOf(
      `MATCH (m:CMedia) WITH m ORDER BY m.uri RETURN collect(m.uri) AS uris`
    )

    expect(message).toContain(graphEngine() === 'native' ? 'not supported: ORDER BY in a WITH clause' : 'In WITH clause, ORDER BY must be followed by SKIP or LIMIT.')
  })

  test('a struct literal inside collect(DISTINCT ...) gathers one object per matched row', async () => {
    const rows = await run(
      `MATCH (m:CMedia {uri: $uri})-[l:CLINK]->(b:CMedia)
       RETURN collect(DISTINCT {uri: b.uri, kind: l.kind}) AS links`,
      { uri: 'm:1' }
    )

    const links = [...(rows[0]!.links as Record<string, unknown>[])]
      .sort((a, b) => String(a.uri) < String(b.uri) ? -1 : 1)
    expect(links).toEqual([
      { uri: 'm:2', kind: 'SAME_AS' },
      { uri: 'm:5', kind: 'PART_OF' },
    ])
  })
})

// ---------------------------------------------------------------------------------------------

/**
 * The empty UNWIND list, which nine comments in `src/worker/graph` warn about.
 *
 * Every caller guards it (`asks.ts:109`, `scheduler.ts:154`, `plugins/aggregate.ts:304`,
 * `plugins/writer.ts:374`), so what the engine actually does with one has never been pinned. It is
 * pinned here because the replacement has to make a decision about it, and "it dies at runtime" is
 * the behaviour every one of those guards was written against.
 */
describe('the empty UNWIND list', () => {
  // The wording is NOT the one the nine comments quote, and it is not even one wording: a write and
  // a read are refused with different messages. Both were measured here for the first time, because
  // every caller guards the case and none of them ever saw the failure.
  onlyReference('an empty UNWIND driving a write is refused at run time rather than writing nothing', async () => {
    const message = await refusalOf('UNWIND $rows AS r CREATE (:CAtom {uri: r.uri, n: 1})', { rows: [] })

    expect(message).toContain('Cannot evaluate expression with type VARIABLE.')
  })

  onlyReference('an empty UNWIND driving a read is refused with a different message', async () => {
    const message = await refusalOf('UNWIND $uris AS u MATCH (m:CMedia {uri: u}) RETURN m.uri AS uri', { uris: [] })

    expect(message).toContain(
      'Runtime exception: Trying to a create a vector with ANY type. This should not happen. '
      + 'Data type is expected to be resolved during binding.'
    )
  })

  onlyReference('an empty UNWIND projecting the item alone is refused too', async () => {
    const message = await refusalOf('UNWIND $uris AS u RETURN u AS uri', { uris: [] })

    expect(message).toContain('Trying to a create a vector with ANY type.')
  })

  test('the same statement with one item answers, which is the control', async () => {
    const rows = await run('UNWIND $uris AS u MATCH (m:CMedia {uri: u}) RETURN m.uri AS uri', { uris: ['m:1'] })

    expect(rows).toEqual([{ uri: 'm:1' }])
  })
})

// ---------------------------------------------------------------------------------------------

/**
 * BEHAVIOURS THE REPLACEMENT WILL NOT COPY. These are measurements, never requirements.
 *
 * Everything above this line is a contract: the replacement has to reproduce it. Everything below is
 * the reference engine being WRONG in a way the app has had to work around, and the replacement
 * deliberately differs. They are measured here anyway, because a workaround with no measurement
 * behind it is a guess that outlives the bug it was written for, and because a future reader finding
 * `ingest.ts`'s join-and-split spelling needs to be able to see what it is for.
 *
 * A test here going green against the replacement would mean the replacement inherited the bug. Under
 * `diff` mode these statements are expected to disagree, which is why each one states what the
 * replacement does instead.
 */
describe('behaviours the replacement will NOT copy', () => {
  // The replacement types every value ON ITS OWN (`values.ts` `coerce`), so nothing carries between
  // rows and this class of corruption cannot occur. The workaround it makes unnecessary is
  // `ingest.ts:34-44`: no list travels as a list, it is joined into a STRING and split in the
  // statement, where the type is written down.
  onlyReference('an UNWIND struct field typed from the first row kills the batch when a later row fills it', async () => {
    const message = await refusalOf(
      'UNWIND $rows AS r CREATE (:CDiverge {uri: r.uri, categories: r.categories})',
      { rows: [{ uri: 'd:1', categories: [] }, { uri: 'd:2', categories: ['action'] }] }
    )

    expect(message).toContain(
      'Runtime exception: Trying to a create a vector with ANY type. This should not happen. '
      + 'Data type is expected to be resolved during binding.'
    )
    const rows = await run('MATCH (d:CDiverge) RETURN d.uri AS uri')
    expect(strings(rows, 'uri')).toEqual([])
  })

  onlyReference('the same rows in the other order are accepted, which is what makes it read as a data problem', async () => {
    await run(
      'UNWIND $rows AS r CREATE (:CDiverge {uri: r.uri, categories: r.categories})',
      { rows: [{ uri: 'd:3', categories: ['action'] }, { uri: 'd:4', categories: [] }] }
    )

    const rows = await run('MATCH (d:CDiverge) RETURN d.uri AS uri, d.categories AS categories ORDER BY d.uri')
    expect(rows).toEqual([
      { uri: 'd:3', categories: ['action'] },
      { uri: 'd:4', categories: null },
    ])
  })

  // The replacement coerces per value, so an integer offered to a DOUBLE column becomes that double.
  onlyReference('an integer in a DOUBLE struct field is reinterpreted as bits rather than converted', async () => {
    await run(
      'UNWIND $rows AS r CREATE (:CDiverge {uri: r.uri, score: r.score})',
      { rows: [{ uri: 'd:5', score: 0.5 }, { uri: 'd:6', score: 3 }] }
    )

    const rows = await run('MATCH (d:CDiverge) WHERE d.score IS NOT NULL RETURN d.uri AS uri, d.score AS score ORDER BY d.uri')
    expect(rows[0]).toEqual({ uri: 'd:5', score: 0.5 })
    expect(rows[1]!.score).toBe(1.5e-323)
  })

  // The replacement accepts a plain object for a MAP column, so `map($keys, $values)` stops being the
  // only spelling that works. `schema.ts` documents the refusal and `ingest.ts` writes around it.
  //
  // TWO SPELLINGS, TWO MESSAGES, which is why both are pinned. `schema.test.ts` quotes the SET one
  // and it does not appear at all when the same param is offered inline in a CREATE pattern.
  onlyReference('an object param into a MAP column is refused inline, naming a cast that does not exist', async () => {
    const message = await refusalOf(
      'CREATE (:CDiverge {uri: $uri, fieldSeq: $fieldSeq})',
      { uri: 'd:7', fieldSeq: { titles: 7 } }
    )

    expect(message).toContain(graphEngine() === 'native' ? 'expected INT64' : 'Conversion exception: Unsupported casting function from STRUCT to MAP.')
  })

  onlyReference('the same param through SET is refused naming the STRUCT it bound as', async () => {
    await run('CREATE (:CDiverge {uri: $uri})', { uri: 'd:9' })

    const message = await refusalOf(
      'MATCH (d:CDiverge {uri: $uri}) SET d.fieldSeq = $fieldSeq',
      { uri: 'd:9', fieldSeq: { titles: 7 } }
    )

    expect(message).toContain(
      'Binder exception: Expression $fieldSeq has data type STRUCT(titles INT64) but expected '
      + 'MAP(STRING, INT64). Implicit cast is not supported.'
    )
  })

  test('map($keys, $values) is the spelling that does work, which is the control', async () => {
    await run(
      'CREATE (:CDiverge {uri: $uri, fieldSeq: map($keys, $values)})',
      { uri: 'd:8', keys: ['titles'], values: [7] }
    )

    const rows = await run('MATCH (d:CDiverge {uri: $uri}) RETURN d.fieldSeq AS fieldSeq', { uri: 'd:8' })
    expect(rows).toEqual([{ fieldSeq: { titles: 7 } }])
  })
})
