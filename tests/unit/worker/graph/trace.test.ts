/**
 * The trace of section 7.5, against a real engine seeded through the real ingest and a real pass.
 *
 * WHAT EACH GROUP IS FOR. A trace panel has one job and two ways to fail at it silently. It can
 * answer "nothing" to four different facts, which sends every reader to read the ingest; and it can
 * quietly drop the rows that carry the answer, which are the REFUSED ones, since the question a bug
 * report asks is almost always "why is this NOT here". So the four reasons are asserted apart from
 * each other, a refused link is asserted as a ROW, and `supports` is compared against the columns it
 * was read from rather than merely being non-empty.
 *
 * Group (g) is the four a LIVE page found and none of the groups above could: an ask matched by
 * string equality against an address the app never writes, a uri drawn as both a member and a
 * placeholder, a fill whose descent names a table the bundle did not carry, and an address spanning
 * two clusters. Each one had the panel stating the opposite of the graph it was reading.
 *
 * The read-only group is the one the panel's whole claim rests on: reading the graph must not move it.
 * It is proven the way 5.3's isolation layer is, by intercepting the engine handle rather than by
 * trusting the facade, plus a witness over every table before and after.
 *
 * Every case names the mutation that reddens it.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../src/worker/graph/answers'
import type { Uri } from '../../../../src/utils/uri'

import { enableGraph } from '../../../../src/worker/graph'
import { flushAsks, recordAsk } from '../../../../src/worker/graph/asks'
import { closeGraph, setGraphEnabled } from '../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../src/worker/graph/ingest'
import { assertReadOnly, resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { graphReady, GRAPH_NODE_TABLES, GRAPH_REL_TABLES } from '../../../../src/worker/graph/schema'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { traceAnswer, traceGraph, type TraceBundle } from '../../../../src/worker/graph/trace'
import { toAggregatedUri } from '../../../../src/utils/uri'
import { answer, episode, media, rowsOf, title } from './plugins/fixtures'

const CORPUS = new URL('../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })

const MS_PER_DAY = 86_400_000
const weekly = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + index * 7 * MS_PER_DAY).toISOString().slice(0, 10))

const DAYS = weekly('2021-01-10', 3)

// ---------------------------------------------------------------------------------------------
// The fixture. One run of three episodes described by three sources, a SECOND ANILIST ID claimed the
// same as it (which the guards of 5.2 refuse `disagreeing-ids` and downgrade, so the graph carries a
// refused row and an attachment), and one placeholder nobody described.

const answers = async () => [
  await answer('media', media('anilist:108465', {
    url: 'https://anilist.test/108465', score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 3,
    startDate: DAYS[0], season: 'WINTER', seasonYear: 2021, categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation')],
    handles: [
      sameAs(media('mal:39535', { score: 0.9 })),
      sameAs(media('anizip:14758', {})),
      // A SECOND ID OF ITS OWN ORIGIN that extends nothing: refused `SAME_AS`, downgraded to an
      // active `PART_OF` (`direct.test.ts`, "prefix is containment, anything else disagrees"). Its
      // far end is in ANOTHER cluster, which is the case the links statement's `OR` exists for.
      sameAs(media('anilist:127720', { score: 0.8 })),
      // the placeholder of 7.1 step 3: a uri a claim names, with no scope stamp, that no source
      // describes, so it is a `Media` row and never a member
      sameAs(media('anidb:14758', { scope: null })),
    ],
  })),
  await answer('media', media('mal:39535', {
    url: 'https://mal.test/39535', score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 3,
    startDate: DAYS[0], categories: ['ANIME', 'SERIES'], titles: [title('en', 'Mushoku Tensei')],
    episodes: DAYS.map((day, index) => episode(`mal:39535-${index + 1}`, 'mal:39535', {
      episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Episode ${index + 1}`)],
    })),
  })),
  // the episode supplier: the same three days from a second origin, so `plugin:range` has a pair to
  // prove and a `supports` list to carry, plus one special that takes a slot of its own
  await answer('media', media('anizip:14758', {
    url: 'https://anizip.test/14758', type: 'TV', episodeCount: 3,
    titles: [title('en', 'Mushoku Tensei')],
    episodes: [
      ...DAYS.map((day, index) => episode(`anizip:14758-${index + 1}`, 'anizip:14758', {
        episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Episode ${index + 1}`)],
      })),
      episode('anizip:14758-s1', 'anizip:14758', {
        episodeNumber: null, titles: [title('en', 'Eris the Special')],
      }),
    ],
  })),
  // the far end of the refused pair, answering for itself so it is owned and clustered
  await answer('media', media('anilist:127720', {
    url: 'https://anilist.test/127720', score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12,
    startDate: '2021-10-03', categories: ['ANIME', 'SERIES'],
    titles: [title('en', 'Mushoku Tensei Season 1 Part 2')],
  })),
]

const runPass = async () => {
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

const clusterIdOf = async (uri: string): Promise<string> => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri })
  return String(row!.id)
}

/**
 * Every row of every table, as one string: the witness the read-only case compares.
 *
 * Counts alone cannot see a `SET`, which is the sentence 2.3 ends on and the mistake the runner's own
 * audit case names, so the content of every column a read could plausibly move is in here too.
 */
const witness = async (): Promise<string> => {
  const parts: string[] = []
  for (const table of GRAPH_NODE_TABLES) {
    parts.push(`${table}=${JSON.stringify((await rowsOf(`MATCH (n:${table}) RETURN count(n) AS total`))[0]?.total)}`)
  }
  for (const table of GRAPH_REL_TABLES) {
    parts.push(`${table}=${JSON.stringify((await rowsOf(`MATCH ()-[e:${table}]->() RETURN count(e) AS total`))[0]?.total)}`)
  }
  parts.push(JSON.stringify(await rowsOf(
    'MATCH (m:Media) RETURN m.uri AS uri, m.raw AS raw, m.scope AS scope, m.hash AS hash, m.seq AS seq ORDER BY uri')))
  parts.push(JSON.stringify(await rowsOf(
    `MATCH (c:Cluster) RETURN c.id AS id, c.aggUri AS aggUri, c.media AS media, c.episodes AS episodes,
            c.hidden AS hidden, c.runLength AS runLength, c.anomalies AS anomalies ORDER BY id`)))
  parts.push(JSON.stringify(await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.key AS key, l.status AS status, l.reason AS reason,
            l.supports AS supports ORDER BY key, fromUri, toUri`)))
  parts.push(JSON.stringify(await rowsOf('MATCH (a:Answer) RETURN a.key AS key, a.raw AS raw ORDER BY key')))
  return parts.join('\n')
}

/** Runs one call with the engine handle intercepted, so every statement it issued can be read back. */
const recordStatements = async <T>(run: () => Promise<T>): Promise<{ value: T, cyphers: string[] }> => {
  const graph = await graphReady()
  const original = graph.query
  const cyphers: string[] = []
  graph.query = async (cypher: string, params?: Record<string, unknown>) => {
    cyphers.push(cypher)
    return original(cypher, params)
  }
  try {
    return { value: await run(), cyphers }
  } finally {
    graph.query = original
  }
}

let EMPTY: TraceBundle
let RUN_ID = ''
let AGG_URI = ''
let ASK_CLUSTER_ID = ''

beforeAll(async () => {
  await enableGraph(true)
  // BEFORE ANY ANSWER, which is the only moment `graph-empty` exists: the boot has already seeded an
  // `Origin` row per extractor, so this also proves emptiness is not read off every table at once.
  EMPTY = await traceGraph('mal:39535')

  await ingestAnswers(await answers())
  await runPass()
  RUN_ID = await clusterIdOf('mal:39535')
  const [cluster] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.aggUri AS aggUri', { id: RUN_ID })
  AGG_URI = String(cluster!.aggUri)

  // ONE ASK, WRITTEN THE WAY THE APP WRITES ONE, which is 7.5's "why is Netflix missing here".
  //
  // `clusterId` comes out of `toAggregatedUri` over the consumer's own member list, PLACEHOLDERS
  // INCLUDED (`similar-consumer.ts`), and that address is not `Cluster.aggUri`: `aggUri` is built
  // from the members, so the two differ by exactly `anidb:14758`. This fixture wrote a bare `cl:` id
  // until 2026-09-13, a spelling no live caller ever produces, so it asserted a row it had planted
  // in a dialect the app does not speak while the panel printed "nothing was asked of any origin"
  // over two real refused asks. A rig that cannot express the live failure is not a rig.
  ASK_CLUSTER_ID = toAggregatedUri([
    'anilist:108465', 'anizip:14758', 'mal:39535', 'anidb:14758',
  ] as Uri[])
  await recordAsk({
    clusterId: ASK_CLUSTER_ID, runUri: 'anilist:108465', origin: 'nf', showId: '80987039',
    question: 'mushoku', outcome: 'refused', reason: 'no-evidence',
  })
  // and a second, for a cluster that shares NO uri with this one: the control for the intersection,
  // since a filter that matched everything would report this row too
  await recordAsk({
    clusterId: toAggregatedUri(['mal:1', 'anilist:1'] as Uri[]), runUri: 'anilist:1', origin: 'nf',
    showId: '70153404', question: 'bebop', outcome: 'declined', reason: 'ceiling',
  })
  await flushAsks()
}, 300_000)

afterAll(async () => {
  setGraphEnabled(true)
  await closeGraph()
})

// ---------------------------------------------------------------------------------------------
// (a) THE FOUR EMPTY ANSWERS. Each is a different fact about a session and the panel prints which.

// Mutation: answer `reason: 'no-row'` for every empty bundle and this case passes for exactly one of
// the four, which is the state the field exists to end.
test('the four empty answers are four different reasons', async () => {
  expect(EMPTY.reason, 'an engine with no Media row at all').toBe('graph-empty')
  expect(EMPTY.resolved).toBe(null)
  expect(EMPTY.counts.Origin, 'and the boot HAD seeded rows, so emptiness is not every table').toBeGreaterThan(0)
  expect(EMPTY.counts.Media).toBe(0)

  const missing = await traceGraph('nosuch:1')
  expect(missing.reason, 'a uri that names no Media row').toBe('no-row')
  expect(missing.counts.Media, 'the control: this graph is NOT empty').toBeGreaterThan(0)

  // a placeholder IS a `Media` row and is never a member (4.3), so it is the one uri in a full graph
  // that has a row and no cluster
  const [placeholder] = await rowsOf(
    'MATCH (m:Media {owned: false}) RETURN m.uri AS uri ORDER BY uri LIMIT 1')
  expect(String(placeholder!.uri)).toBe('anidb:14758')
  const unclustered = await traceGraph('anidb:14758')
  expect(unclustered.reason, 'a row no pass has clustered').toBe('no-cluster')

  setGraphEnabled(false)
  try {
    const off = await traceGraph('mal:39535')
    expect(off.reason, 'the flag is down, so there is no engine to ask').toBe('not-enabled')
    expect(off.counts, 'and it answered without opening one').toEqual({})
    expect(off.cost.statements).toBe(0)
    expect(await traceAnswer(1), 'the same rule for one answer').toBe(null)
  } finally {
    setGraphEnabled(true)
  }
  // the control for the flag: the same uri resolves with it up
  expect((await traceGraph('mal:39535')).reason).toBe(undefined)
})

// ---------------------------------------------------------------------------------------------
// (b) THE THREE SPELLINGS. A bug report carries whichever the reporter had in the address bar.

// Mutation: drop the `Cluster {id: $id}` lookup from `resolveClusterId` and the `cl:` spelling
// reports `no-row` while the other two keep passing.
test('a member uri, an aggregated address and a cluster id all reach one cluster', async () => {
  const bare = await traceGraph('mal:39535')
  const address = await traceGraph(AGG_URI)
  const byId = await traceGraph(RUN_ID)

  expect(RUN_ID.startsWith('cl:'), 'the id spelling under test').toBe(true)
  expect(AGG_URI.startsWith('ag:('), 'and the address spelling').toBe(true)
  for (const bundle of [bare, address, byId]) {
    expect(bundle.resolved?.clusterId).toBe(RUN_ID)
    expect(bundle.resolved?.aggUri).toBe(AGG_URI)
    expect(bundle.reason).toBe(undefined)
  }
  expect(bare.asked).toBe('mal:39535')
  expect(byId.asked, 'and each carries what was asked, verbatim').toBe(RUN_ID)

  // the control: a well-formed address of uris that are in no cluster resolves to nothing
  expect((await traceGraph('ag:(nosuch:1,nosuch:2)')).reason).toBe('no-row')
})

// ---------------------------------------------------------------------------------------------
// (c) THE MEMBERS AND THE CLAIMS, which is what "why is this uri in this cluster" reads.

test('the members carry the placeholder, and the claims are source truth', async () => {
  const bundle = await traceGraph('mal:39535')
  expect(bundle.members.map(member => `${member.uri} ${member.via}`)).toEqual([
    'anilist:108465 member', 'anizip:14758 member', 'mal:39535 member', 'anidb:14758 placeholder',
  ])
  const mal = bundle.members.find(member => member.uri === 'mal:39535')!
  expect(mal).toEqual({
    uri: 'mal:39535', origin: 'mal', owned: true, scope: 'RUN', title: 'Mushoku Tensei',
    episodeCount: 3, countKind: 'declared', startDate: DAYS[0], via: 'member',
  })
  const placeholder = bundle.members.find(member => member.via === 'placeholder')!
  expect(placeholder.owned, 'a placeholder is a uri, an origin and nothing else').toBe(false)
  expect(placeholder.title).toBe(null)

  // every claim is BETWEEN uris the bundle names, and the placeholder's is the one that proves the
  // set includes it
  const claimed = bundle.claims.map(claim => `${claim.fromUri} ${claim.kind} ${claim.toUri}`)
  expect(claimed).toContain('anilist:108465 SAME_AS mal:39535')
  expect(claimed, 'the claim that named the placeholder').toContain('anilist:108465 SAME_AS anidb:14758')
  for (const claim of bundle.claims) {
    expect(claim.provenance, 'a source claim, never a rule').toBe('source')
    expect(claim.answerSeq).toBeGreaterThan(0)
    expect(claim.key).toMatch(/^[0-9a-f]{64}$/)
  }
})

// ---------------------------------------------------------------------------------------------
// (d) REFUSED ROWS ARE FIRST CLASS. The one thing the panel exists for.

// Mutation: add `AND l.status = 'active'` to the links statement of `traceGraph`. The refused row
// disappears and this case reddens on its first expectation, which is the whole of 5.2's "a refused
// proposal is kept, with its reason".
test('a refused link is in the bundle, with its reason and its far end', async () => {
  const bundle = await traceGraph('mal:39535')
  const refused = bundle.links.filter(link => link.status === 'refused')
  expect(refused.length, 'the guards refused the second anilist id').toBeGreaterThan(0)

  const pair = refused.find(link =>
    link.fromUri === 'anilist:108465' && link.toUri === 'anilist:127720' && link.kind === 'SAME_AS')
  expect(pair, `refused links were ${JSON.stringify(refused.map(link => `${link.fromUri} ${link.toUri} ${link.kind}`))}`)
    .toBeDefined()
  expect(pair!.reason).toBe('disagreeing-ids')
  expect(pair!.by).toBe('plugin:direct')
  expect(pair!.evidence, 'evidence stays the JSON string the writer stored').toContain('"claimer":"anilist"')

  // the far end is in ANOTHER cluster, so a statement restricted to pairs of members would lose it
  expect(bundle.members.map(member => member.uri)).not.toContain('anilist:127720')
  expect(await clusterIdOf('anilist:127720')).not.toBe(RUN_ID)

  // the control: the active rows are there too, so this is not a bundle of refusals only
  expect(bundle.links.some(link => link.status === 'active' && link.kind === 'SAME_AS')).toBe(true)
  // and the direction is the writer's, never the anchor's: an undirected match would report
  // `anilist:127720` as the FROM of half these rows
  for (const link of bundle.links) {
    const [row] = await rowsOf(
      'MATCH (a:Media)-[l:LINK {key: $key}]->(b:Media) RETURN a.uri AS fromUri, b.uri AS toUri',
      { key: link.key }
    )
    expect(`${String(row!.fromUri)} ${String(row!.toUri)}`).toBe(`${link.fromUri} ${link.toUri}`)
  }
})

// ---------------------------------------------------------------------------------------------
// (e) `supports` IS THE DESCENT, so it is carried verbatim and never reshaped.

// Mutation: truncate the keys (`stringsOf(row.supports).map(key => key.slice(0, 8))`) in the links
// mapping. Every key still looks like a key and the descent below finds no claim, which is how this
// class of bug reaches a panel in the first place.
test('supports is carried verbatim, and descends to the claims it names', async () => {
  const bundle = await traceGraph('mal:39535')
  const stored = new Map((await rowsOf(
    'MATCH (a:Media)-[l:LINK]->(b:Media) RETURN l.key AS key, l.supports AS supports'
  )).map(row => [String(row.key), (row.supports as string[] | null) ?? []]))

  const carried = bundle.links.filter(link => link.supports.length)
  expect(carried.length, 'the fixture has links with a descent').toBeGreaterThan(0)
  for (const link of bundle.links) {
    expect(link.supports, `link ${link.key}`).toEqual(stored.get(link.key))
  }

  // THE DESCENT ITSELF: every key a link names is a claim key in the same bundle, which is what lets
  // the panel walk link -> claim -> Answer without walking a path
  const claimKeys = new Set(bundle.claims.map(claim => claim.key))
  const descended = carried.flatMap(link => link.supports).filter(key => claimKeys.has(key))
  expect(descended.length, 'at least one link descends to a claim the bundle carries').toBeGreaterThan(0)

  // the episode side of the same rule
  const fills = bundle.episodes.flatMap(slot => slot.fills)
  expect(fills.length).toBeGreaterThan(0)
  for (const fill of fills) expect(Array.isArray(fill.supports)).toBe(true)
  expect(fills.some(fill => fill.supports.length), 'a fill names the HAS_EPISODE it came from').toBe(true)
})

// Mutation: return `row.supports` instead of `stringsOf(row.supports)` in the links mapping and this
// reads back `null`, because an empty `STRING[]` is NULL on this engine (the engine facts of
// 2026-09-12) and every caller would then owe the test this file makes unnecessary.
test('a link with no supports reads back as an empty array, never null', async () => {
  const { query } = await graphReady()
  await query(
    `MATCH (a:Media {uri: 'mal:39535'}), (b:Media {uri: 'anizip:14758'})
     CREATE (a)-[:LINK {key: 'trace-fixture-empty-supports', kind: 'SAME_AS', by: 'plugin:fixture',
                        status: 'refused', reason: 'fixture', version: 1}]->(b)`
  )
  try {
    // the control: the column really is NULL, so this is a normalization and not a tautology
    const [stored] = await rowsOf(
      `MATCH ()-[l:LINK {key: 'trace-fixture-empty-supports'}]->() RETURN l.supports AS supports`)
    expect(stored!.supports).toBe(null)

    const bundle = await traceGraph('mal:39535')
    const link = bundle.links.find(entry => entry.key === 'trace-fixture-empty-supports')
    expect(link).toBeDefined()
    expect(link!.supports).toEqual([])
    expect(link!.gates, 'and an unwritten JSON column is null, not the string "null"').toBe(null)
    expect(link!.confidence).toBe(null)
  } finally {
    await query(`MATCH ()-[l:LINK {key: 'trace-fixture-empty-supports'}]->() DELETE l`)
  }
})

// ---------------------------------------------------------------------------------------------
// (f) THE REST OF THE BUNDLE: the slots a page draws, the count vote, the asks and the answers.

test('the bundle answers the rest of 7.5 for one cluster', async () => {
  const bundle = await traceGraph('mal:39535')

  // the slots, numbered ascending then the special, which is the order a page draws them (6.4)
  expect(bundle.episodes.map(slot => slot.number)).toEqual([1, 2, 3, null])
  expect(bundle.episodes[0]!.fills.map(fill => fill.episodeUri).sort())
    .toEqual(['anizip:14758-1', 'mal:39535-1'])
  // BOTH slot titles, numbered and special: one function reading two shapes answered NULL for every
  // slot on this file's first run, and a case that only read the special would have called that half
  // a special-case bug
  expect(bundle.episodes[0]!.title).toBe('Episode 1')
  expect(bundle.episodes[3]!.title).toBe('Eris the Special')
  for (const fill of bundle.episodes.flatMap(slot => slot.fills)) {
    expect(fill.via, 'how the row reached the slot (5.4 P5)').toMatch(/^(member|aligned)$/)
    expect(fill.by).toBe('plugin:aggregate')
  }

  // "why did this count win"
  expect(bundle.runLength.value).toBe(3)
  expect(bundle.runLength.witnesses).toBeGreaterThan(0)
  expect(bundle.runLength.from, 'the uris that voted, as one line').toContain('mal:39535')

  // "why is Netflix missing here": asked and refused is a ROW, never a silence (7.3)
  expect(bundle.asks).toEqual([
    { seq: 1, origin: 'nf', outcome: 'refused', reason: 'no-evidence', at: null },
  ])

  // the answers are METADATA: the seq, the operation and the size, never the bytes
  expect(bundle.answers.length).toBeGreaterThan(0)
  for (const meta of bundle.answers) {
    expect(meta.bytes, `answer ${meta.seq}`).toBeGreaterThan(0)
    expect(Object.keys(meta).sort()).toEqual(['bytes', 'operation', 'origin', 'seq', 'uri'])
  }
  expect(JSON.stringify(bundle), 'no raw answer rides along in the bundle')
    .not.toContain('https://mal.test/39535')

  // the attachment the downgrade produced, in the edge's own direction
  expect(bundle.attachments.length).toBeGreaterThan(0)
  for (const attachment of bundle.attachments) {
    expect(attachment.by).toBe('plugin:containment')
    expect(attachment.evidence, 'ATTACHED_TO carries no evidence column (2.2)').toBe(null)
  }
  expect(bundle.anomalies.every(anomaly => anomaly.rule && anomaly.detail)).toBe(true)
})

// Mutation: return `raw` on the bundle's answers instead of `bytes` and the case above reddens on the
// key list; drop this call and "why is this field this value" has no last step at all.
test('traceAnswer returns one answer in full, and nothing for a seq no row carries', async () => {
  const bundle = await traceGraph('mal:39535')
  const meta = bundle.answers.find(entry => entry.uri === 'mal:39535')!
  const detail = await traceAnswer(meta.seq)

  expect(detail).not.toBe(null)
  expect(detail!.uri).toBe('mal:39535')
  expect(detail!.origin).toBe('mal')
  expect(detail!.operation).toBe('MEDIA')
  expect(detail!.kind).toBe('media')
  expect(detail!.selection, 'the fields the document selected, so a partial answer is visible')
    .toContain('episodeCount')
  expect(JSON.parse(detail!.raw), 'the resolver return value, byte for byte')
    .toMatchObject({ uri: 'mal:39535', url: 'https://mal.test/39535', episodeCount: 3 })
  expect(new TextEncoder().encode(detail!.raw).length, 'and the bundle sized it exactly')
    .toBe(meta.bytes)

  expect(await traceAnswer(999_999), 'a stale provenance seq').toBe(null)
  expect(await traceAnswer(1.5), 'and a seq that is not an integer').toBe(null)
})

// ---------------------------------------------------------------------------------------------
// (g) THE FOUR CASES A LIVE PAGE FOUND that no case above could see, each one a panel that stated
// the opposite of the graph it was reading.

// Mutation: put the statement back the way it was, matching `k.clusterId` against `$id`, `$aggUri`
// and `$asked` only. `bundle.asks` comes back EMPTY and the page prints "nothing was asked of any
// origin" over a refused ask, which is what shipped until 2026-09-13.
test('an ask the app wrote is matched to its cluster, address against address', async () => {
  // THE PREMISE FIRST, because the bug is entirely in these three lines: the ask's address and the
  // cluster's differ, by exactly the placeholder, so no equality between them can ever hold.
  expect(ASK_CLUSTER_ID, "the consumer's address carries the placeholder").toContain('anidb:14758')
  expect(AGG_URI, "the cluster's does not, it is built from the members").not.toContain('anidb:14758')
  expect(ASK_CLUSTER_ID).not.toBe(AGG_URI)
  expect(ASK_CLUSTER_ID).not.toBe(RUN_ID)

  const bundle = await traceGraph('mal:39535')
  expect(bundle.asks.map(ask => `${ask.origin} ${ask.outcome} ${ask.reason}`))
    .toEqual(['nf refused no-evidence'])

  // and the same row through every spelling of the address, since a reader arrives with any of them
  for (const spelling of [AGG_URI, RUN_ID, 'anilist:108465']) {
    expect((await traceGraph(spelling)).asks.length, `asked as ${spelling}`).toBe(1)
  }

  // THE CONTROL: the log holds a second ask, for a cluster sharing no uri with this one, and the
  // intersection leaves it out. A filter that matched everything would report two rows here.
  const logged = await rowsOf('MATCH (k:Ask) RETURN k.clusterId AS clusterId, k.origin AS origin')
  expect(logged.length, 'two asks were recorded').toBe(2)
  expect(bundle.asks.length).toBe(1)
})

// Mutation: drop `WHERE NOT t.uri IN $members` from the placeholder statement. `anidb:14758` comes
// back twice, once `member` and once `placeholder`, which the page draws as two boxes at one position
// whose meta lines overstrike: a member then reads as a non-member with no scope.
test('a uri the cluster both holds and claims is ONE row, the member', async () => {
  const before = await traceGraph('mal:39535')
  expect(
    before.members.filter(member => member.uri === 'anidb:14758').map(member => member.via),
    'the control: while it is only claimed, it is the placeholder row',
  ).toEqual(['placeholder'])

  // `plugin:aggregate` clusters an `owned: false` row whenever one origin fails to answer while
  // others claim it (50 of 241 clusters on a recorded page carried such a uri, 2026-09-13). The
  // fixture's placeholder is not clustered, so the state is made here rather than waited for.
  const { query } = await graphReady()
  await query(
    `MATCH (m:Media {uri: 'anidb:14758'}), (c:Cluster {id: $id}) CREATE (m)-[:MEMBER_OF]->(c)`,
    { id: RUN_ID }
  )
  try {
    const bundle = await traceGraph('mal:39535')
    const rows = bundle.members.filter(member => member.uri === 'anidb:14758')
    expect(rows.map(member => member.via), 'one row, and it is the membership').toEqual(['member'])
    expect(rows[0]!.owned, 'still an undescribed row: `owned` is what says so, not membership')
      .toBe(false)
    // the whole list, not just this uri: no other uri doubled either
    const uris = bundle.members.map(member => member.uri)
    expect(uris.length, uris.join(' ')).toBe(new Set(uris).size)
  } finally {
    await query(
      `MATCH (m:Media {uri: 'anidb:14758'})-[e:MEMBER_OF]->(c:Cluster {id: $id}) DELETE e`,
      { id: RUN_ID }
    )
  }
  expect((await traceGraph('mal:39535')).members.map(member => member.via))
    .toEqual(before.members.map(member => member.via))
})

// Mutation: drop `episodeSources` from the returned bundle (or the `h.key` column from its
// statement). Every `via: member` fill's descent dead-ends, which is what the page rendered as
// "<64 hex> is not in this bundle" on 56 of 56 fills.
test('a fill names a row the bundle carries, HAS_EPISODE included', async () => {
  const bundle = await traceGraph('mal:39535')

  expect(bundle.episodeSources.length, 'the members hang episodes, so the table is not empty')
    .toBeGreaterThan(0)
  for (const row of bundle.episodeSources) {
    expect(row.key).toMatch(/^[0-9a-f]{64}$/)
    expect(bundle.members.map(member => member.uri)).toContain(row.fromUri)
    expect(row.answerSeq, 'and it descends one more step, to the answer the list arrived in')
      .toBeGreaterThan(0)
  }

  const keys = new Set([
    ...bundle.links.map(row => row.key),
    ...bundle.claims.map(row => row.key),
    ...bundle.episodeLinks.map(row => row.key),
    ...bundle.episodeClaims.map(row => row.key),
    ...bundle.episodeSources.map(row => row.key),
  ])
  const fills = bundle.episodes.flatMap(slot => slot.fills)
  const named = fills.flatMap(fill => fill.supports)
  expect(named.length, 'the fixture has fills with a descent').toBeGreaterThan(0)
  expect(named.filter(key => !keys.has(key)), 'every support a fill names is a row in the bundle')
    .toEqual([])
  // the control: the same list against the bundle WITHOUT the new table is exactly what used to fail
  const without = new Set([...keys].filter(key => !bundle.episodeSources.some(row => row.key === key)))
  expect(named.some(key => !without.has(key)), 'and it is the HAS_EPISODE rows that close it')
    .toBe(true)
})

// Mutation: answer `otherClusters: []` unconditionally. An address whose members sit in two clusters
// then reports one and leaves the other's members out of `members` with nothing saying so.
test('an address that spans two clusters names the one it did not draw', async () => {
  const other = await clusterIdOf('anilist:127720')
  expect(other, 'the fixture keeps the refused pair in two clusters').not.toBe(RUN_ID)

  const bundle = await traceGraph(`ag:(mal:39535,anilist:127720)`)
  expect([RUN_ID, other]).toContain(bundle.resolved?.clusterId)
  expect(bundle.resolved?.otherClusters, 'the cluster it did not pick, by id')
    .toEqual([bundle.resolved?.clusterId === RUN_ID ? other : RUN_ID])

  // the control: an address of one cluster's own members spans nothing
  expect((await traceGraph(AGG_URI)).resolved?.otherClusters).toEqual([])
  expect((await traceGraph('mal:39535')).resolved?.otherClusters, 'and a bare uri never can').toEqual([])
})

// ---------------------------------------------------------------------------------------------
// (h) READING THE GRAPH DOES NOT MOVE IT, proven the way 5.3's isolation is: at the handle, plus a
// witness over every table.

// Mutation: add one write to `traceGraph` (`SET c.hidden = false` on the cluster it resolved). The
// interception catches it at `assertReadOnly` and the witness catches it again, and the control below
// is what proves the checker can report a write at all.
test('the trace writes nothing, and every statement it issues would refuse one', async () => {
  const before = await witness()
  const { cyphers } = await recordStatements(async () => {
    await traceGraph('mal:39535')
    await traceAnswer(1)
  })

  expect(cyphers.length, 'the interception saw the statements').toBeGreaterThan(10)
  for (const cypher of cyphers) {
    expect(() => assertReadOnly('graph trace', cypher), cypher.slice(0, 100)).not.toThrow()
  }
  // THE CONTROL: the same checker over a write, so a pass above is a result rather than a rig that
  // cannot express a failure
  expect(() => assertReadOnly('graph trace', 'MATCH (c:Cluster) SET c.hidden = true')).toThrow(/SET/)
  expect(() => assertReadOnly('graph trace', 'MATCH (c:Cluster) DETACH DELETE c')).toThrow()

  expect(await witness(), 'and no row moved').toBe(before)

  // THE WITNESS'S OWN CONTROL. A comparison that cannot report a difference reports success
  // unconditionally, so one row is moved here and moved back, and the witness has to see both.
  const { query } = await graphReady()
  const [cluster] = await rowsOf('MATCH (c:Cluster {id: $id}) RETURN c.aggUri AS aggUri', { id: RUN_ID })
  await query('MATCH (c:Cluster {id: $id}) SET c.aggUri = $probe', { id: RUN_ID, probe: 'ag:(trace:witness)' })
  expect(await witness(), 'the witness can see a row move').not.toBe(before)
  await query('MATCH (c:Cluster {id: $id}) SET c.aggUri = $was', { id: RUN_ID, was: String(cluster!.aggUri) })
  expect(await witness(), 'and the graph is where it was').toBe(before)
})

// The cost, printed rather than bounded: a figure nobody reads is a figure nobody can defend, and the
// statement count is the one number a reader of this panel should be able to see.
test('the cost of one bundle, reported', async () => {
  const bundle = await traceGraph('mal:39535')
  const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length
  console.info(
    `trace: ${bundle.cost.statements} statements in ${bundle.cost.ms} ms, ${bytes} bytes of bundle`
    + ` (${GRAPH_NODE_TABLES.length + GRAPH_REL_TABLES.length} of the statements are the table counts),`
    + ` ${bundle.members.length} members, ${bundle.claims.length} claims, ${bundle.links.length} links,`
    + ` ${bundle.episodes.length} slots, ${bundle.answers.length} answers`
  )
  expect(bundle.cost.statements).toBeGreaterThan(GRAPH_NODE_TABLES.length + GRAPH_REL_TABLES.length)
})

// ---------------------------------------------------------------------------------------------
// (i) THE SAME BUNDLE ON A REAL PAGE, which is the only place the cost means anything. LAST in the
// file on purpose: it replays a recorded fan-out into the graph the cases above are seeded in, so
// every number before it would move if it ran earlier.

test('the cost of one bundle on a recorded page, reported', async () => {
  if (!existsSync(CORPUS)) {
    console.warn(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= 800) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  expect(rows.length, 'a recorded page is about 800 rows (2026-09-12)').toBeGreaterThan(100)

  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])
  await runPass()

  // the widest cluster in the graph, which is the worst case the panel meets on this page
  const [widest] = await rowsOf(
    `MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster)
     RETURN c.id AS id, count(m) AS members ORDER BY members DESC, id LIMIT 1`)
  for (const id of [String(widest!.id), RUN_ID]) {
    const bundle = await traceGraph(id)
    const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length
    console.info(
      `trace on a recorded page, cluster ${id}: ${bundle.cost.statements} statements in`
      + ` ${bundle.cost.ms} ms, ${bytes} bytes of bundle, ${bundle.members.length} members,`
      + ` ${bundle.claims.length} claims, ${bundle.links.length} links`
      + ` (${bundle.links.filter(link => link.status === 'refused').length} refused),`
      + ` ${bundle.episodes.length} slots, ${bundle.episodeLinks.length} episode links,`
      + ` ${bundle.answers.length} answers of ${bundle.answers.reduce((total, meta) => total + meta.bytes, 0)} bytes,`
      + ` ${bundle.asks.length} asks, ${bundle.anomalies.length} anomalies`
    )
    expect(bundle.resolved?.clusterId).toBe(id)
  }
  console.info(`trace: the graph it read was ${JSON.stringify((await traceGraph(RUN_ID)).counts)}`)
}, 300_000)
