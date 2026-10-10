/**
 * The `Origin` rows seeded at boot from the extractor definitions (2.1).
 *
 * The case that matters is `imdb`, which answers NOTHING by design: five sources mint an `imdb:tt...`
 * handle and the UI builds its source rows from the registered origins, so with no row there is no
 * name, no icon and no badge, and the link is carried the whole way and dropped one line short of the
 * screen. Nothing but a seed can ever write that row.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { originSeedsFrom, seedOrigins } from '../../../../src/worker/graph/seed-origins'
import { answer, rowsOf } from './plugins/fixtures'

beforeAll(async () => {
  await enableGraph(true)
})

afterAll(async () => {
  await closeGraph()
})

// THE SEED ITSELF, and the origin that exists only because of it.
// Mutation: drop the `seedOrigins()` call from `boot` and `imdb` has no row in any session where no
// source answered about it, which is every session: the extractor answers nothing at all.
test('every extractor definition has an Origin row, imdb included', async () => {
  const rows = await rowsOf('MATCH (o:Origin) RETURN o.id AS id, o.raw AS raw ORDER BY o.id')
  expect(rows.length, 'the 25 sources of src/sources/index.ts, plus any plugin that registered')
    .toBeGreaterThanOrEqual(25)

  const imdb = rows.find(row => row.id === 'imdb')
  expect(imdb, 'the origin that answers nothing and therefore can never write its own row').toBeTruthy()
  expect(JSON.parse(String(imdb!.raw))).toMatchObject({
    id: 'imdb', name: 'IMDb', url: 'https://www.imdb.com', isApiOnly: false,
  })
  expect(rows.map(row => row.id)).toContain('cr')
})

// IDEMPOTENCE, and the rule that makes it safe to run at every boot: `ON CREATE` only, so an origin
// a source DESCRIBED keeps its own row.
// Mutation: change the write to `ON MATCH SET` as well and a boot overwrites what a resolver
// answered, which is the ingest's row (2.3) being rewritten by a seed.
test('a second seed writes nothing, and never overwrites a row an answer described', async () => {
  await ingestAnswers([await answer('origin', { id: 'imdb', name: 'IMDb, as answered', url: 'https://www.imdb.com' })])
  const described = await rowsOf('MATCH (o:Origin {id: "imdb"}) RETURN o.raw AS raw, o.seq AS seq')
  expect(JSON.parse(String(described[0]!.raw)).name).toBe('IMDb, as answered')

  const total = await seedOrigins()
  expect(total).toBeGreaterThanOrEqual(24)
  const after = await rowsOf('MATCH (o:Origin {id: "imdb"}) RETURN o.raw AS raw, o.seq AS seq')
  expect(after, 'the answer owns the row, not the seed').toEqual(described)
})

// WHAT IS SKIPPED, so a module that is not an origin cannot mint one.
// Mutation: default the name to the origin id and a module declaring only `origin` writes a row the
// UI has no label for.
test('a module with no origin or no name is not an origin row', () => {
  expect(originSeedsFrom({
    good: { origin: 'x', name: 'X', originUrl: 'https://x.test', icon: null, color: '#fff', isApiOnly: true },
    nameless: { origin: 'y' },
    anonymous: { name: 'Z' },
    notAModule: undefined,
  })).toEqual([{ id: 'x', name: 'X', url: 'https://x.test', icon: null, color: '#fff', isApiOnly: true }])
})
