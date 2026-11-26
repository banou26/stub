/**
 * `plugin:direct` of 5.4 P1: the decision table, row by row, then a real recorded page through it.
 *
 * The table is the whole plugin, so each case here is one of its rows and nothing else, and the two
 * refusals it owns (`foreign-includes` and the same-origin `disagreeing-ids`) are asserted as ROWS
 * rather than as absences: a refusal that leaves no record cannot be queried, which is the point of
 * writing it (5.2).
 *
 * The last case is the 800 recorded rows of one page: 24 sources, nested nodes four deep, and the
 * only shapes here that nobody chose.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { Candidate } from '../../../../../src/worker/graph/plugins/direct'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { decide, directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import { checkInvariants } from '../../../../../src/worker/graph/plugins/invariants'
import { answer, media, rowsOf, title } from './fixtures'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const includes = (node: Record<string, unknown>) => ({ relation: 'INCLUDES', node })
const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })
const partOfRun = (node: Record<string, unknown>) => ({ relation: 'PART_OF', node })
const bare = (uri: string) => ({ uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1) })

const runPass = async () => {
  resetPassState()
  const report = await runPlugins([profilePlugin, directPlugin], { reason: 'manual' })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.anomalies.filter(anomaly => anomaly.rule === 'plugin-failed')).toEqual([])
  return report
}

/** Every link `plugin:direct` wrote for one row, as a shape a case can read at a glance. */
const linksFrom = async (uri: string) =>
  (await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = 'plugin:direct' AND (a.uri = $uri OR b.uri = $uri)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason,
       l.confidence AS confidence, l.evidence AS evidence, l.supports AS supports
     ORDER BY fromUri, toUri, kind`,
    { uri }
  )).map(row => ({
    pair: `${String(row.fromUri)} ${String(row.toUri)}`,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    confidence: row.confidence,
    evidence: row.evidence,
    supports: row.supports,
  }))

/** Every link this plugin wrote, counted by kind, status and reason: the histogram of the replay. */
const histogramOf = async (): Promise<Map<string, number>> => new Map((await rowsOf(
  `MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:direct'
   RETURN l.kind AS kind, l.status AS status, l.reason AS reason, count(l) AS total
   ORDER BY kind, status, reason`
)).map(row => [`${String(row.kind)} ${String(row.status)} ${String(row.reason)}`, Number(row.total)]))

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    // SAME_AS, equal scopes: the union-by-id pair that needs no matching at all
    await answer('media', media('anilist:1', { titles: [title('en', 'Frieren')], handles: [sameAs(media('kitsu:1'))] })),
    await answer('media', media('kitsu:1', { titles: [title('en', 'Frieren')] })),
    // SAME_AS, differing scopes: a run claiming a show
    await answer('media', media('anilist:2', { titles: [title('en', 'Mushoku')], handles: [sameAs(media('cr:GSHOW', { scope: 'CONTAINER' }))] })),
    await answer('media', media('cr:GSHOW', { scope: 'CONTAINER', titles: [title('en', 'Mushoku')] })),
    // scope NULL: the claim names a uri no answer has described, of an origin that is not show
    // level (a `tvdb:` or `imdb:` placeholder reads CONTAINER before any answer, 5.4 P0)
    await answer('media', media('anilist:3', { titles: [title('en', 'Waiting')], handles: [sameAs(bare('kitsu:3'))] })),
    // PART_OF as claimed, RUN into RUN, and the inverted one beside it
    await answer('media', media('kitsu:4', { titles: [title('en', 'Part')], handles: [partOfRun(media('anilist:4'))] })),
    await answer('media', media('anilist:4', { titles: [title('en', 'Whole')] })),
    await answer('media', media('cr:GINV', { scope: 'CONTAINER', titles: [title('en', 'Inverted')], handles: [partOfRun(media('anilist:5'))] })),
    await answer('media', media('anilist:5', { titles: [title('en', 'Inverted run')] })),
    // the prefix rule: a Crunchyroll season claiming its own series
    await answer('media', media('cr:G24H1N3MP-GS00374452', {
      titles: [title('en', 'Mushoku Tensei Season 1')],
      handles: [sameAs(media('cr:G24H1N3MP', { scope: 'CONTAINER' }))],
    })),
    await answer('media', media('cr:G24H1N3MP', { scope: 'CONTAINER', titles: [title('en', 'Mushoku Tensei')] })),
    // the same origin, no prefix between them: two unrelated ids one source called one thing
    await answer('media', media('nf:70000-1', { titles: [title('en', 'Netflix one')], handles: [sameAs(media('nf:80000-1'))] })),
    await answer('media', media('nf:80000-1', { titles: [title('en', 'Netflix two')] })),
    // the fenced INCLUDES: a show naming the season rows of its OWN origin
    await answer('media', media('tmdb:10', { scope: 'CONTAINER', titles: [title('en', 'Show')], handles: [includes(media('tmdb:10-s1'))] })),
    await answer('media', media('tmdb:10-s1', { titles: [title('en', 'Show Season 1')] })),
    // and the foreign one: an ordinal is never portable between id spaces
    await answer('media', media('tmdb:11', { scope: 'CONTAINER', titles: [title('en', 'Other show')], handles: [includes(media('tvmaze:11'))] })),
    await answer('media', media('tvmaze:11', { titles: [title('en', 'Other show season')] })),
    // the address pair: both rows described, the claim written by hand below
    await answer('media', media('anilist:20', { titles: [title('en', 'Addressed')] })),
    await answer('media', media('tvmaze:20', { titles: [title('en', 'Addressed')] })),
  ])

  const { query } = await graphReady()
  await query(
    `MATCH (a:Media {uri: $from}), (b:Media {uri: $to})
     WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: $key}]->(b) }
     CREATE (a)-[:CLAIMS {key: $key, kind: 'SAME_AS', provenance: 'address', claimer: $claimer,
       targetScope: NULL, node: '{}', hash: '', answerSeq: cast('0' AS INT64), seq: cast('0' AS INT64)}]->(b)`,
    { from: 'anilist:20', to: 'tvmaze:20', key: 'address-claim-20', claimer: 'anilist' }
  )
  await runPass()
})

afterAll(async () => {
  await closeGraph()
})

// THE TABLE, rows 1 to 3: a NULL scope waits, equal scopes propose, differing scopes derive the
// containment edge "media to handle, whatever was claimed" (`db.ts:166-169`).
// Mutation: drop the NULL test and a claim takes the RUN default before its row lands, which is the
// justwatch-before-crunchyroll weld; drop the scope test and a show enters a run's cluster.
test('the scope rows of the table: NULL waits, equal proposes, differing derives PART_OF', async () => {
  expect(await linksFrom('anilist:1')).toEqual([{
    pair: 'anilist:1 kitsu:1', kind: 'SAME_AS', status: 'active', reason: 'asserted', confidence: 1,
    evidence: '{"claimer":"anilist","provenance":"source"}', supports: expect.any(Array),
  }])

  expect(await linksFrom('kitsu:3'), 'no edge this pass; replayed next pass').toEqual([])

  expect(await linksFrom('cr:GSHOW')).toEqual([{
    pair: 'anilist:2 cr:GSHOW', kind: 'PART_OF', status: 'active', reason: 'cross-scope', confidence: 1,
    evidence: '{"claimer":"anilist","provenance":"source","theirs":"CONTAINER","ours":"RUN"}',
    supports: expect.any(Array),
  }])
})

// THE TABLE'S FIRST TWO ROWS AT THE PLUGIN'S OWN LEVEL, which the graph cannot show: the writer's
// guard 1 refuses an unknown scope too, and guard 3 refuses an address support, so a case that only
// reads the rows back cannot tell whether the TABLE decided or the guard did.
// Mutation: drop either early return from `decide` and this goes red while every row in the graph
// stays exactly as it was.
test('the table decides a NULL scope and an address claim before the writer is asked', () => {
  const candidate: Candidate = {
    fromUri: 'anilist:1', toUri: 'kitsu:1', fromOrigin: 'anilist', toOrigin: 'kitsu',
    kind: 'SAME_AS', claimer: 'anilist', provenance: 'source', claimKey: 'k',
    fromScope: 'RUN', toScope: 'RUN', fromParent: null, toParent: null,
  }
  expect(decide(candidate).map(link => `${link.kind} ${link.reason}`), 'the control').toEqual(['SAME_AS asserted'])
  expect(decide({ ...candidate, toScope: null }), 'no edge this pass; replayed next pass').toEqual([])
  expect(decide({ ...candidate, fromScope: null })).toEqual([])
  expect(decide({ ...candidate, provenance: 'address' }), 'a pointer is never consumed here').toEqual([])
})

// THE TABLE, rows 4 and 5: `PART_OF` as claimed is `asserted`, and a CONTAINER claimed as part of a
// RUN is refused rather than flipped (`db.ts:244-245`). A catalogue season as part of a longer run is
// RUN into RUN, which passes, and that is the case the first half asserts.
// Mutation: flip the inverted pair instead of refusing it and a caller that got the order wrong has
// its scopes accepted too.
test('the containment rows of the table: asserted, and inverted refused', async () => {
  expect(await linksFrom('kitsu:4')).toEqual([{
    pair: 'kitsu:4 anilist:4', kind: 'PART_OF', status: 'active', reason: 'asserted', confidence: 1,
    evidence: '{"claimer":"kitsu","provenance":"source"}', supports: expect.any(Array),
  }])

  expect(await linksFrom('cr:GINV')).toEqual([{
    pair: 'cr:GINV anilist:5', kind: 'PART_OF', status: 'refused', reason: 'inverted', confidence: 1,
    evidence: '{"claimer":"cr","provenance":"source"}', supports: expect.any(Array),
  }])
})

// THE TABLE, rows 6 and 7: specificity is PREFIX EXTENSION and never length (`src/utils/uri.ts:23-34`,
// fc36ffc), so a season claiming its own series is containment with the reason that says why, and two
// ids of one origin that extend nothing are refused and downgraded.
// Mutation: read specificity as "the longer id" and `nf:70000-1` becomes a part of `nf:80000-1`,
// which is two unrelated shows in a containment nobody asserted.
test('the same-origin rows of the table: prefix is containment, anything else disagrees', async () => {
  expect(await linksFrom('cr:G24H1N3MP-GS00374452')).toEqual([{
    pair: 'cr:G24H1N3MP-GS00374452 cr:G24H1N3MP', kind: 'PART_OF', status: 'active', reason: 'prefix',
    confidence: 1, evidence: '{"claimer":"cr","provenance":"source"}', supports: expect.any(Array),
  }])

  expect(await linksFrom('nf:70000-1')).toEqual([
    {
      pair: 'nf:70000-1 nf:80000-1', kind: 'PART_OF', status: 'active', reason: 'disagreeing-ids',
      confidence: 1,
      evidence: '{"claimer":"nf","provenance":"source","theirs":"nf:80000-1","ours":"nf:70000-1"}',
      supports: expect.any(Array),
    },
    {
      pair: 'nf:70000-1 nf:80000-1', kind: 'SAME_AS', status: 'refused', reason: 'disagreeing-ids',
      confidence: 1, evidence: '{"claimer":"nf","provenance":"source"}', supports: expect.any(Array),
    },
  ])
})

// THE TABLE, rows 8 and 9: a fenced `INCLUDES` is a show naming the season rows of its OWN origin,
// derived as `PART_OF` from the season to the show; anything else is refused `foreign-includes` with
// no downgrade, because JustWatch and Netflix disagree on the season number for 6 of 31 shows.
// Mutation: accept an `INCLUDES` across origins and an ordinal becomes portable, which is the
// containment that put every season's episodes on one page.
test('the INCLUDES rows of the table: fenced to one id space, refused outside it', async () => {
  expect(await linksFrom('tmdb:10-s1')).toEqual([{
    pair: 'tmdb:10-s1 tmdb:10', kind: 'PART_OF', status: 'active', reason: 'asserted', confidence: 1,
    evidence: '{"claimer":"tmdb","provenance":"source","claimed":"INCLUDES"}', supports: expect.any(Array),
  }])

  expect(await linksFrom('tvmaze:11')).toEqual([{
    pair: 'tmdb:11 tvmaze:11', kind: 'INCLUDES', status: 'refused', reason: 'foreign-includes',
    confidence: 1, evidence: '{"claimer":"tmdb","provenance":"source"}', supports: expect.any(Array),
  }])
})

// THE TABLE, row 10: an `address` claim is never consumed here (3.3). It routes a re-ask and enters
// nothing, and the row it names still renders as a badge carrying its own url (6.2).
// Mutation: consume it like a source claim and two old season links in one stale bookmark weld.
test('an address claim is never consumed, and leaves no row behind', async () => {
  expect(await linksFrom('tvmaze:20')).toEqual([])
  const [supported] = await rowsOf(
    `MATCH ()-[l:LINK]->() WHERE l.supports IS NOT NULL AND 'address-claim-20' IN l.supports RETURN count(l) AS total`
  )
  expect(Number(supported!.total), 'and nothing names it in supports').toBe(0)
})

// SUPPORTS AND EVIDENCE, which is what makes a link traceable at all: the claim key it came from, so
// a trace descends to the claim and from there to the `Answer` that carried it (3.2).
// Mutation: emit `supports: []` and every link is an assertion with no provenance, which is the
// "why is this here" the trace loop of 7.5 exists to answer.
test('every emitted link names the claim key it was derived from', async () => {
  const [link] = await linksFrom('anilist:1')
  const claims = (await rowsOf(
    `MATCH (a:Media {uri: 'anilist:1'})-[c:CLAIMS]->(b:Media {uri: 'kitsu:1'}) RETURN c.key AS key`
  )).map(row => String(row.key))
  expect(claims.length).toBe(1)
  expect(link!.supports).toEqual(claims)
})

// IDEMPOTENCE, which is the contract rather than the plugin's discipline: the same graph twice is the
// same links, and the pass that follows a pass writes nothing.
// Mutation: key a link on anything that moves between passes (the version, a timestamp) and every
// pass rewrites every row, which on a live page is a re-render per flush.
test('a second pass over the same graph writes nothing', async () => {
  const again = await runPass()
  expect(again.changes).toEqual([])
})

// THE SCOPED PATH, against the full pass that is its definition: a wake naming one new claim and the
// two rows it joined has to leave the graph exactly where a full pass leaves it.
// The scan is by URI and not by claim key on purpose, and this case is why: the scope a scoped run
// declares is its subject uris, so the writer may retract any link with a subject at either end, and
// a run that read only the claims the delta named would have every OTHER link those uris carry
// deleted for never having been re-derived.
// Mutation: read only `delta.claims` in `plugin:direct`'s scan (drop the two by-uri reads) and the
// histogram below loses the links the wake did not name, while the pass reports no anomaly at all.
test('a scoped pass over one new claim leaves the graph where a full pass leaves it', async () => {
  await runPass()
  const before = await histogramOf()

  // a new source claiming an existing pair: one new claim, two rows whose profiles move with it
  const rows = [
    await answer('media', media('simkl:70', { titles: [title('en', 'Frieren')], handles: [sameAs(media('anilist:1'))] })),
  ]
  const committed = await ingestAnswers(rows)
  expect(committed.changed.claims.length, 'the control: the batch wrote a claim').toBeGreaterThan(0)

  const scoped = await runPlugins([profilePlugin, directPlugin], {
    reason: 'graph:changed',
    seq: 1,
    uris: committed.changed.media,
    claims: committed.changed.claims,
  })
  expect(scoped.anomalies.filter(anomaly => anomaly.rule === 'plugin-failed')).toEqual([])
  expect(scoped.audit.ok, scoped.audit.differences.join('; ')).toBe(true)
  const after = await histogramOf()
  expect([...after].length, 'the scoped pass added the pair it was woken for').not.toEqual(0)
  expect(after.get('SAME_AS active asserted'), 'and it is one more than before')
    .toBe((before.get('SAME_AS active asserted') ?? 0) + 1)

  // THE DEFINITION: a full pass over the same graph agrees, row for row, and writes nothing
  const full = await runPass()
  expect(full.changes, 'a full pass has nothing to add to what the scoped pass built').toEqual([])
  expect(await histogramOf()).toEqual(after)
})

test('scoped direct runs exclude still-refused cross-origin pairs and empty deltas return an empty scope', async () => {
  await ingestAnswers([
    await answer('media', media('anilist:9101', { titles: [title('en', 'Disagreeing')], handles: [sameAs(media('mal:9101'))] })),
    await answer('media', media('kitsu:9101', { titles: [title('en', 'Disagreeing')], handles: [sameAs(media('anilist:9101')), sameAs(media('mal:9102'))] })),
    await answer('media', media('mal:9101', { titles: [title('en', 'Disagreeing')] })),
    await answer('media', media('mal:9102', { titles: [title('en', 'Disagreeing B')] })),
  ])
  await runPass()

  const queries = {
    query: <Row>(cypher: string, params?: Record<string, unknown>) => rowsOf(cypher, params) as Promise<Row[]>,
  }
  const baseCtx = {
    ...queries,
    id: 'plugin:direct' as const,
    since: 0,
    passStart: 0,
    guards: {} as any,
    previous: { nodes: {}, edges: {} },
    titleSimilarity: async () => 0,
    maxPossibleSimilarity: () => 0,
    parseSeasonNumber: () => undefined,
    isOnlySeasonLabel: () => false,
    isGenericEpisodeTitle: () => false,
    log: () => {},
  }
  const emptyRun = await directPlugin.run({
    ...baseCtx,
    delta: { full: false, media: [], episodes: [], claims: [], links: [], clusters: [] },
  })
  expect(emptyRun.scope).toEqual({ full: false, uris: [], clusters: [], pairs: [] })
  expect(emptyRun.links).toEqual([])

  const unrelatedRun = await directPlugin.run({
    ...baseCtx,
    delta: { full: false, media: ['simkl:70'], episodes: [], claims: [], links: [], clusters: [] },
  })
  expect(unrelatedRun.scope).toEqual({ full: false, uris: ['simkl:70'], clusters: [], pairs: [] })
})

// A REAL RECORDED PAGE, which is the only case here that meets shapes nobody chose. It reports the
// histogram rather than asserting a threshold on it: a number pinned to one walk fails on the next
// walk rather than on the next bug. What IS asserted is what must hold whatever the page contains:
// the four invariants of 3.5, the audit, and a second pass that writes nothing.
test('the first 800 corpus rows replay, run both plugins, and hold the invariants', async () => {
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

  // the fixtures above are already in the graph, so every number below is reported as a DELTA: a
  // total would read as the corpus's and be wrong by whatever this file ingested first
  const baseline = await histogramOf()

  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])

  const started = Date.now()
  const pass = await runPass()
  const passMs = Date.now() - started

  const { query } = await graphReady()
  const invariants = await checkInvariants(query)
  expect(invariants.counts, 'the four queries of 3.5').toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })

  const histogram = await histogramOf()
  const [claims] = await rowsOf('MATCH ()-[c:CLAIMS]->() RETURN count(c) AS total')
  console.info('plugin:direct over 800 corpus rows:', JSON.stringify({
    claims: Number(claims!.total),
    links: [...histogram].map(([key, total]) => `${key}: ${total - (baseline.get(key) ?? 0)}`),
    iterations: pass.iterations,
    passMs,
    auditMs: pass.audit.ms,
  }, null, 2))

  const again = await runPass()
  expect(again.changes, 'the same page twice is the same links').toEqual([])
  console.info(`the second pass over the same graph: ${again.ms} ms, ${again.iterations} iteration(s), nothing written`)
  const still = await checkInvariants(query)
  expect(still.ok).toBe(true)
}, 300_000)
