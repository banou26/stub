// The DDL of section 2, loaded on the real engine. Under node the graph module loads the `nodejs`
// variant and the browser build loads the default one, so this is the same schema the worker creates
// at boot, run through the same `query` helper.
import { afterAll, describe, expect, test } from 'vitest'

import { closeGraph, openGraph, graphEngine } from '../../../../src/worker/graph/engine'
import { createGraphSchema, GRAPH_SCHEMA, GRAPH_TABLES, PLUGIN_REL_TABLES, SOURCE_REL_TABLES, tableNameOf } from '../../../../src/worker/graph/schema'

afterAll(async () => {
  await closeGraph()
})

const tablesOnEngine = async () => {
  const { query } = await openGraph()
  const rows = await query('CALL show_tables() RETURN *')
  return new Map(rows.map(row => [row.name as string, row.type as string]))
}

describe('createGraphSchema', () => {
  test('loads, and every table the schema declares exists', async () => {
    await createGraphSchema(await openGraph())

    const tables = await tablesOnEngine()
    expect(GRAPH_TABLES.filter(name => !tables.has(name))).toEqual([])
    // the ingest's five source tables and the log itself, by name, so a table dropped from the list
    // is not silently "no missing tables"
    expect(GRAPH_TABLES).toEqual(expect.arrayContaining(['Origin', 'Media', 'Episode', 'Answer', 'Ask', 'CLAIMS', 'HAS_EPISODE', 'ABOUT', 'Cluster', 'Slot', 'LINK', 'FILLS']))
    expect(GRAPH_TABLES.length).toBe(GRAPH_SCHEMA.length)
  })

  test('a rel table is created as a rel table, not as a node table with FROM columns', async () => {
    await createGraphSchema(await openGraph())

    const tables = await tablesOnEngine()
    for (const statement of [...SOURCE_REL_TABLES, ...PLUGIN_REL_TABLES]) {
      expect([tableNameOf(statement), tables.get(tableNameOf(statement))]).toEqual([tableNameOf(statement), 'REL'])
    }
  })

  test('a second load changes nothing, because every statement carries IF NOT EXISTS', async () => {
    const graph = await openGraph()
    await createGraphSchema(graph)
    const before = await tablesOnEngine()
    await createGraphSchema(graph)

    expect(await tablesOnEngine()).toEqual(before)
  })

  // The two column types in section 2 that `docs/design-inputs/00-engine-facts.md` does not list as
  // exercised. Declaring them is not the same as being able to write and read them, which is what
  // the ingest will do in step 1b, so both are driven here rather than assumed from a CREATE that
  // did not throw.
  test('BOOLEAN and MAP(STRING, INT64) carry a value, not just a declaration', async () => {
    const { query } = await openGraph()
    await createGraphSchema({ query })
    await query(
      'MERGE (m:Media {uri: $uri}) ON CREATE SET m.owned = $owned, m.fieldSeq = map($keys, $values), m.seq = $seq',
      { uri: 'mal:1', owned: true, keys: ['titles', 'startDate'], values: [7, 9], seq: 1 }
    )

    const rows = await query('MATCH (m:Media {uri: $uri}) RETURN m.owned AS owned, m.fieldSeq AS fieldSeq', { uri: 'mal:1' })
    expect(rows).toEqual([{ owned: true, fieldSeq: { titles: 7, startDate: 9 } }])
  })

  // ...and the reason the statement above spells the map out. An object param binds as a STRUCT,
  // which the MAP column refuses, so the obvious spelling is the one that fails: pinned here, since
  // the failure names a type nobody wrote and reads as a bad column rather than a bad param.
  // REFERENCE ONLY. The replacement ACCEPTS a plain object into a MAP column, deliberately: the
  // refusal here is the engine binding an object literal as a STRUCT and then refusing to cast it,
  // which is a quirk the ingest works around rather than a rule anything wants. Kept because it
  // documents what the old engine did, skipped under the new one because it is not a requirement.
  test.skipIf(graphEngine() === 'native')('an object param into a MAP column is refused, naming the STRUCT it bound as', async () => {
    const { query } = await openGraph()
    await createGraphSchema({ query })

    await expect(query(
      'MERGE (m:Media {uri: $uri}) ON CREATE SET m.fieldSeq = $fieldSeq',
      { uri: 'mal:2', fieldSeq: { titles: 7 } }
    )).rejects.toThrow(/STRUCT\(titles INT64\) but expected MAP\(STRING, INT64\)/)
  })
})
