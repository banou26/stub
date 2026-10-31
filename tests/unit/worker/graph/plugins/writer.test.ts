/**
 * The writer of 5.2, driven the way the runner drives it: an output in, a diff out.
 *
 * Against the REAL engine, because every assertion here is about a statement the binder either takes
 * or refuses, and a mocked connection would pass whatever it was handed (the whole class of failure
 * `docs/design-inputs/00-engine-facts.md` exists to record).
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import type { PluginId, PluginOutput, Scope } from '../../../../../src/worker/graph/plugins/contract'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { SOURCE_NODE_TABLES } from '../../../../../src/worker/graph/schema'
import { acceptEveryPair } from '../../../../../src/worker/graph/plugins/guards'
import { applyPluginOutput, columnsOf, pairOf, retractPlugin } from '../../../../../src/worker/graph/plugins/writer'
import { answer, episode, media, rowsOf, title } from './fixtures'

const PLUGIN = {
  id: 'plugin:test' as PluginId,
  version: 1,
  produces: {
    nodes: ['MediaProfile' as const, 'TitleKey' as const],
    edges: ['PROFILE_OF' as const, 'HAS_KEY' as const, 'LINK' as const],
  },
}

/** A second plugin, because `EPISODE_LINK` is a table the one above does not declare (case e). */
const EPISODES = {
  id: 'plugin:episodes' as PluginId,
  version: 1,
  produces: { nodes: [], edges: ['EPISODE_LINK' as const] },
}

const output = (scope: Scope, parts: Partial<PluginOutput> = {}): PluginOutput =>
  ({ scope, nodes: [], edges: [], links: [], episodeLinks: [], ...parts })

// `acceptEveryPair` rather than the nine guards of 5.2: every case here is about the DIFF, and the
// rows it writes carry no profile, so the real guards would refuse each of them `unknown-scope` and
// this file would be testing `./guards.ts` instead. The guards have their own suite.
const apply = (out: PluginOutput) => applyPluginOutput({ ...PLUGIN, output: out, prepare: acceptEveryPair })

const profileRow = async (uri: string) =>
  (await rowsOf(
    `MATCH (n:MediaProfile {uri: $uri})
     RETURN n.uri AS uri, n.by AS by, n.version AS version, n.scope AS scope, n.scopeFrom AS scopeFrom,
       n.titleKeys AS titleKeys, n.companion AS companion, n.year AS year, n.countStated AS countStated`,
    { uri }
  ))[0]

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    await answer('media', media('mal:1', { titles: [title('en', 'Frieren')] })),
    // the episodes hang off rows that already exist, so the media count the retract case reads is
    // still three: what this file needs from them is two `Episode` endpoints an `EPISODE_LINK` can
    // name, since a rel row whose endpoint matches no node writes nothing and reports nothing
    await answer('media', media('mal:2', {
      titles: [title('en', 'Ranking of Kings')],
      episodes: [
        episode('mal:2-1', 'mal:2', { episodeNumber: 1 }),
        episode('mal:2-2', 'mal:2', { episodeNumber: 2 }),
      ],
    })),
    await answer('media', media('mal:3', {
      episodes: [
        episode('mal:3-1', 'mal:3', { episodeNumber: 1 }),
        episode('mal:3-2', 'mal:3', { episodeNumber: 2 }),
      ],
    })),
  ])
})

afterAll(async () => {
  await closeGraph()
})

const profile = (uri: string, fields: Record<string, unknown> = {}) => ({
  uri, scope: 'RUN', scopeFrom: [], titleKeys: [{ key: 'frieren', score: 1 }],
  companion: false, year: 2026, countStated: null, ...fields,
})

// (a) THE DIFF. Three operations out of one comparison: what is new is created, what moved is SET,
// and what the plugin no longer desires inside the scope is deleted.
// Mutation: drop the `moved` test in `applyPluginOutput` (every desired row then reports `update`, so
// the second apply below reports two rather than none), or drop the `toDelete` branch (mal:2 stands).
test('a desired set becomes create, update and delete against what this plugin wrote before', async () => {
  const first = await apply(output({ full: true }, {
    nodes: [{ table: 'MediaProfile', rows: [profile('mal:1'), profile('mal:2')] }],
  }))
  expect(first.counts.MediaProfile).toEqual({ created: 2, updated: 0, deleted: 0 })
  expect((await profileRow('mal:1'))!.by).toBe('plugin:test')
  expect((await profileRow('mal:1'))!.version).toBe(1)

  const second = await apply(output({ full: true }, {
    nodes: [{ table: 'MediaProfile', rows: [profile('mal:1', { year: 2025 }), profile('mal:2')] }],
  }))
  expect(second.counts.MediaProfile, 'only the row whose property moved').toEqual({ created: 0, updated: 1, deleted: 0 })
  expect((await profileRow('mal:1'))!.year).toBe(2025)
  expect((await profileRow('mal:2'))!.year, 'the row that did not move is untouched').toBe(2026)

  const third = await apply(output({ full: true }, { nodes: [{ table: 'MediaProfile', rows: [profile('mal:1', { year: 2025 })] }] }))
  expect(third.counts.MediaProfile).toEqual({ created: 0, updated: 0, deleted: 1 })
  expect(await profileRow('mal:2'), 'a row the plugin stopped desiring is retracted').toBeUndefined()
})

// (b) IDEMPOTENCE, which is the contract itself: same graph, same scope, same output. It has to hold
// across every column TYPE, since the comparison is against what the column READ BACK, and two of
// those do not read back what was written (an empty STRING[] is NULL, a JSON column is text).
// Mutation: normalize an empty `STRING[]` to `[]` rather than to null in `canonical` (the engine
// reads one back as NULL) and every row carrying an empty list reports as changed on every pass,
// forever, which on a live page is a re-render per flush.
test('the same output applied twice writes nothing the second time', async () => {
  const rows = [profile('mal:3', {
    scopeFrom: ['answer:mal', 'claim:kitsu'],
    titleKeys: [{ key: 'frieren', score: 0.5, language: 'en', class: 'MAIN' }],
    companion: true,
    countStated: 12,
  })]
  const first = await apply(output({ full: true }, {
    nodes: [{ table: 'MediaProfile', rows: [profile('mal:1', { year: 2025 }), ...rows] }],
  }))
  expect(first.counts.MediaProfile!.created).toBe(1)

  const again = await apply(output({ full: true }, {
    nodes: [{ table: 'MediaProfile', rows: [profile('mal:1', { year: 2025 }), ...rows] }],
  }))
  expect(again.changes, 'not one statement had a row to write').toEqual([])
  expect(again.counts).toEqual({})

  const stored = (await profileRow('mal:3'))!
  expect(stored.scopeFrom).toEqual(['answer:mal', 'claim:kitsu'])
  expect(JSON.parse(stored.titleKeys as string)).toEqual([{ key: 'frieren', score: 0.5, language: 'en', class: 'MAIN' }])
  expect(stored.companion).toBe(true)
  expect(stored.countStated).toBe(12)
})

// (c) THE SCOPE. A scoped run retracts inside its scope and nowhere else, which is what makes an
// incremental pass safe: a plugin that recomputed one uri may not touch the other thousand.
// Mutation: make `inScopeNode` return true (or delete the `!scope.full &&` guard in the delete
// branch) and the mal:3 profile disappears with mal:1's, on a scope that never named it.
test('an empty desired set inside a scope retracts that scope and leaves the rest standing', async () => {
  const scoped = await apply(output({ full: false, uris: ['mal:1'], clusters: [], pairs: [] }))
  expect(scoped.counts.MediaProfile).toEqual({ created: 0, updated: 0, deleted: 1 })
  expect(await profileRow('mal:1')).toBeUndefined()
  expect(await profileRow('mal:3'), 'outside the scope, so outside the diff').toBeTruthy()
})

// (d) THE EDGES, and the one trap the engine set: a node that still carries an edge cannot be
// deleted with a plain DELETE ("has connected edges in table PROFILE_OF", measured 2026-09-12), so a
// retract has to reach the edge first. The `LINK` here is written through `acceptEveryPair`: what
// the nine guards do with a proposal is `guards.test.ts`.
// Mutation: change the node delete to a plain `DELETE n` and the retract throws on the profile that
// still carries ANOTHER plugin's PROFILE_OF; drop `applyEdgeDelete` from the apply order and every
// retract throws the same way.
test('edges are written and retracted with their nodes, and a retract empties the plugin', async () => {
  const written = await apply(output({ full: true }, {
    nodes: [
      { table: 'MediaProfile', rows: [profile('mal:1'), profile('mal:2')] },
      { table: 'TitleKey', rows: [{ key: 'frieren' }, { key: 'ranking of kings' }] },
    ],
    edges: [
      { table: 'PROFILE_OF', rows: [{ from: 'mal:1', to: 'mal:1' }, { from: 'mal:2', to: 'mal:2' }] },
      { table: 'HAS_KEY', rows: [{ from: 'mal:1', to: 'frieren', key: 'frieren', score: 1, language: 'en', class: 'MAIN' }] },
    ],
    links: [{ kind: 'SAME_AS', fromUri: 'mal:1', toUri: 'mal:2', reason: 'test', confidence: 0.9, supports: ['a', 'b'] }],
  }))
  expect(written.counts.PROFILE_OF).toEqual({ created: 2, updated: 0, deleted: 0 })
  expect(written.counts.HAS_KEY!.created).toBe(1)
  expect(written.counts.LINK!.created).toBe(1)
  expect(await rowsOf('MATCH (a:Media)-[e:LINK]->(b:Media) RETURN a.uri AS from, b.uri AS to, e.status AS status, e.supports AS supports'))
    .toEqual([{ from: 'mal:1', to: 'mal:2', status: 'active', supports: ['a', 'b'] }])

  // and the same output again is still a no-op, edges included
  const again = await apply(output({ full: true }, {
    nodes: [
      { table: 'MediaProfile', rows: [profile('mal:1'), profile('mal:2')] },
      { table: 'TitleKey', rows: [{ key: 'frieren' }, { key: 'ranking of kings' }] },
    ],
    edges: [
      { table: 'PROFILE_OF', rows: [{ from: 'mal:1', to: 'mal:1' }, { from: 'mal:2', to: 'mal:2' }] },
      { table: 'HAS_KEY', rows: [{ from: 'mal:1', to: 'frieren', key: 'frieren', score: 1, language: 'en', class: 'MAIN' }] },
    ],
    links: [{ kind: 'SAME_AS', fromUri: 'mal:1', toUri: 'mal:2', reason: 'test', confidence: 0.9, supports: ['a', 'b'] }],
  }))
  expect(again.changes).toEqual([])

  // A SECOND PLUGIN'S EDGE onto this plugin's node, which is the case that decides the delete
  // spelling: `plugin:aggregate` retracting a `Cluster` that `plugin:containment` attached to is the
  // same shape. Plain DELETE dies here ("has connected edges in table PROFILE_OF", measured
  // 2026-09-12) and DETACH DELETE takes the foreign edge with it, which is correct because an edge
  // cannot outlive its endpoint: the pass recomputes the other plugin on its next iteration.
  await applyPluginOutput({
    id: 'plugin:other' as PluginId,
    version: 1,
    produces: { nodes: [], edges: ['PROFILE_OF'] },
    output: output({ full: true }, { edges: [{ table: 'PROFILE_OF', rows: [{ from: 'mal:1', to: 'mal:1' }] }] }),
    prepare: acceptEveryPair,
  })
  expect(await rowsOf('MATCH ()-[e:PROFILE_OF]->() RETURN count(e) AS total'), 'two plugins, one pair').toEqual([{ total: 3 }])

  const retracted = await retractPlugin(PLUGIN)
  expect(retracted.counts.MediaProfile!.deleted).toBe(2)
  expect(retracted.counts.PROFILE_OF!.deleted).toBe(2)
  expect(retracted.counts.LINK!.deleted).toBe(1)
  expect(await rowsOf('MATCH (n:MediaProfile) RETURN count(n) AS total')).toEqual([{ total: 0 }])
  expect(await rowsOf('MATCH ()-[e:PROFILE_OF]->() RETURN count(e) AS total'), 'the other plugin\'s edge went with its endpoint')
    .toEqual([{ total: 0 }])
  expect(await rowsOf('MATCH ()-[e:LINK]->() RETURN count(e) AS total')).toEqual([{ total: 0 }])
  expect(await rowsOf('MATCH (m:Media) RETURN count(m) AS total'), 'and the source rows are untouched')
    .toEqual([{ total: 3 }])
})

// (e) THE TWO REFUSALS of isolation layer 1, evaluated at RUNTIME rather than only in the type: the
// output type has no member that can name `Media`, and a plugin written in JS, or cast through an
// `as`, has one anyway.
// Mutation: delete the `desiredNodes.get(table)` check and the Media row is written into the source
// table the ingest owns, which the audit would then have to catch after the fact.
test('a row naming a source table, or a table outside produces, is refused with the plugin named', async () => {
  const sourceRow = output({ full: true }, {
    nodes: [{ table: 'Media' as never, rows: [{ uri: 'mal:1', scope: 'CONTAINER' }] }],
  })
  await expect(apply(sourceRow)).rejects.toThrow(/plugin:test may not write Media: a source table/)

  const undeclared = output({ full: true }, { nodes: [{ table: 'Cluster', rows: [{ id: 'c1' }] }] })
  await expect(apply(undeclared)).rejects.toThrow(/plugin:test may not write Cluster: it declares produces/)

  const undeclaredEdge = output({ full: true }, { episodeLinks: [{ fromUri: 'a', toUri: 'b', reason: 'r', confidence: 1, fromNumber: 1, toNumber: 1, supports: [] }] })
  await expect(apply(undeclaredEdge)).rejects.toThrow(/plugin:test may not write EPISODE_LINK/)

  // and a plugin that DECLARED a source table is refused before it can hand over a row at all
  const declaresSource = applyPluginOutput({
    ...PLUGIN,
    produces: { nodes: ['Media' as never], edges: [] },
    output: output({ full: true }),
    prepare: acceptEveryPair,
  })
  await expect(declaresSource).rejects.toThrow(/plugin:test may not write Media: a source table/)

  expect((await rowsOf('MATCH (m:Media {uri: "mal:1"}) RETURN m.scope AS scope'))[0]!.scope, 'nothing landed')
    .toBe('RUN')
})

// (g) AN EPISODE PAIR CARRIES THE PROPOSAL'S OWN VERDICT (5.4 P4's fourth input). A rule that turned
// a claimed pair down has to be able to SAY so, the way a `LINK` says it, or the only two outcomes
// available are an active pair and a silence, and a silence is not queryable.
// Mutation: stamp `status: 'active'` on every `EPISODE_LINK` the writer builds (which is what it did
// until this step) and the refused row below reads active, so a claim nothing placed puts a play
// button on a row of another run.
test('an episode pair is written with its own status, and a flip to active is an update', async () => {
  const pair = (fromUri: string, toUri: string, extra: Record<string, unknown> = {}) => ({
    fromUri, toUri, reason: 'dates', confidence: 1, fromNumber: 1, toNumber: 1, supports: ['claim'], ...extra,
  })
  const episodes = (parts: Record<string, unknown>[]) => applyPluginOutput({
    ...EPISODES,
    output: output({ full: true }, { episodeLinks: parts as PluginOutput['episodeLinks'] }),
    prepare: acceptEveryPair,
  })
  const written = async () => rowsOf(
    `MATCH (a:Episode)-[e:EPISODE_LINK]->(b:Episode)
     RETURN a.uri AS from, b.uri AS to, e.status AS status, e.reason AS reason, e.kind AS kind,
       e.fromNumber AS fromNumber, e.toNumber AS toNumber, e.supports AS supports
     ORDER BY from, to`
  )

  const first = await episodes([
    pair('mal:3-1', 'mal:2-1', { status: 'refused', reason: 'foreign-episode' }),
    pair('mal:3-2', 'mal:2-2', { fromNumber: 2, toNumber: null, supports: ['claim', 'hang'] }),
  ])
  expect(first.counts.EPISODE_LINK).toEqual({ created: 2, updated: 0, deleted: 0 })
  expect(await written()).toEqual([
    {
      from: 'mal:3-1', to: 'mal:2-1', kind: 'SAME_AS', status: 'refused', reason: 'foreign-episode',
      fromNumber: 1, toNumber: 1, supports: ['claim'],
    },
    {
      from: 'mal:3-2', to: 'mal:2-2', kind: 'SAME_AS', status: 'active', reason: 'dates',
      // a side that carries no number of its own is NULL rather than a made-up one
      fromNumber: 2, toNumber: null, supports: ['claim', 'hang'],
    },
  ])

  const again = await episodes([
    pair('mal:3-1', 'mal:2-1', { status: 'refused', reason: 'foreign-episode' }),
    pair('mal:3-2', 'mal:2-2', { fromNumber: 2, toNumber: null, supports: ['claim', 'hang'] }),
  ])
  expect(again.changes, 'the same verdict twice is the same row').toEqual([])

  // THE FLIP: the premise moved, so the verdict moved, and the row is SET rather than replaced, which
  // is what keeps the key a trace descends by stable across it
  const flipped = await episodes([
    pair('mal:3-1', 'mal:2-1', { reason: 'asserted' }),
    pair('mal:3-2', 'mal:2-2', { fromNumber: 2, toNumber: null, supports: ['claim', 'hang'] }),
  ])
  expect(flipped.counts.EPISODE_LINK).toEqual({ created: 0, updated: 1, deleted: 0 })
  expect((await written())[0]).toMatchObject({ status: 'active', reason: 'asserted' })

  await retractPlugin(EPISODES)
  expect(await written(), 'and the plugin owns both of them, refused included').toEqual([])
})

// (f) THE COLUMN PARSER, which is why the writer cannot disagree with the DDL about a type. `Media`
// is the statement that carries both traps: a `MAP(STRING, INT64)` whose comma is inside parentheses,
// and `//` comments on most lines.
// Mutation: split the DDL on ',' without counting depth and `fieldSeq` becomes two columns named
// `fieldSeq MAP(STRING` and `INT64)`, which writes a binder error rather than a row.
// Mutation: return the first pair without looking for a second, and a table of two loads and loses an edge wherever a
// uri names a row on both sides.
test('a plugin rel table of two pairs is refused at load', () => {
  expect(pairOf('CREATE REL TABLE IF NOT EXISTS HAS_KEY(FROM Media TO TitleKey, key STRING)')).toEqual({ from: 'Media', to: 'TitleKey' })
  expect(() => pairOf('CREATE REL TABLE X(FROM MediaProfile TO Media, FROM EpisodeProfile TO Episode, by STRING)')).toThrow('one FROM/TO pair')
  expect(() => pairOf('CREATE REL TABLE X(by STRING)')).toThrow('one FROM/TO pair')
})

test('the column parser reads the DDL, nested commas and comments included', () => {
  const columns = columnsOf(SOURCE_NODE_TABLES.find(statement => statement.includes('TABLE IF NOT EXISTS Media'))!)
  const byName = new Map(columns.map(column => [column.name, column]))
  expect(byName.get('uri')).toMatchObject({ kind: 'STRING', primary: true })
  expect(byName.get('owned')).toMatchObject({ kind: 'BOOLEAN' })
  expect(byName.get('categories')).toMatchObject({ kind: 'LIST', element: 'STRING', type: 'STRING[]' })
  expect(byName.get('fieldSeq'), 'the MAP survives its own comma').toMatchObject({
    kind: 'MAP', element: 'INT64', type: 'MAP(STRING, INT64)',
  })
  expect(byName.get('raw')).toMatchObject({ kind: 'JSON' })
  expect(columns.filter(column => column.primary).length, 'exactly one primary key').toBe(1)
})
