/**
 * The ingest of section 4, driven the way both of its callers drive it: rows in, graph out.
 *
 * Every test here runs against the REAL engine, because every one of them is about a statement the
 * binder either takes or refuses, and a mocked connection would pass whatever it was handed (the
 * whole class of failure `docs/design-inputs/00-engine-facts.md` exists to record). The last one
 * replays a recorded page, which is the only case that meets real shapes: 24 sources, nested nodes
 * four deep, handles that name no node.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import { closeGraph } from '../../../../src/worker/graph/engine'
import { enableGraph } from '../../../../src/worker/graph'
import { graphReady } from '../../../../src/worker/graph/schema'
import { contentHash } from '../../../../src/worker/graph/hash'
import { ingestAnswers, replayAnswers } from '../../../../src/worker/graph/ingest'
import { flushAnswers, recordAnswers, type AnswerKind, type AnswerRow } from '../../../../src/worker/graph/answers'
import { lastWriteLongestArray } from '../../../../src/worker/store/graph'
import { listen } from '../../../../src/worker/store/events'

const CORPUS = new URL('../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

type Row = Record<string, unknown>

let nextSeq = 0

/**
 * One answer row, keyed on its content the way the log keys one, so a replay of it is the same row.
 *
 * `seq` is taken before the await, not after: `Promise.all` over this helper resumes in completion
 * order, so reading the counter after the digest hands the third answer the first seq and the merge
 * then folds the batch in an order the caller never wrote.
 */
const answer = async (kind: AnswerKind, value: Row, operation = 'MEDIA'): Promise<AnswerRow> => {
  const seq = ++nextSeq
  return {
    key: await contentHash([kind, value]),
    seq,
    uri: String(kind === 'origin' ? value.id : value.uri),
    origin: String(kind === 'origin' ? value.id : value.origin),
    kind,
    operation,
    selection: Object.keys(value).sort(),
    raw: JSON.stringify(value),
  }
}

const media = (uri: string, fields: Row = {}): Row => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  scope: 'RUN',
  handles: [],
  ...fields,
})

const sameAs = (node: Row) => ({ relation: 'SAME_AS', node })
const partOf = (node: Row) => ({ relation: 'PART_OF', node: { ...node, scope: 'CONTAINER' } })

const rowsOf = async (cypher: string, params?: Record<string, unknown>) => {
  const { query } = await graphReady()
  return query(cypher, params)
}

const mediaRow = async (uri: string) =>
  (await rowsOf('MATCH (m:Media {uri: $uri}) RETURN m.uri AS uri, m.owned AS owned, m.raw AS raw, m.scope AS scope, m.origin AS origin, m.fieldSeq AS fieldSeq, m.episodeCount AS episodeCount, m.titles AS titles', { uri }))[0]

const claimsFrom = async (uri: string) =>
  rowsOf('MATCH (a:Media {uri: $uri})-[c:CLAIMS]->(b:Media) RETURN b.uri AS toUri, c.kind AS kind, c.claimer AS claimer, c.provenance AS provenance, c.targetScope AS targetScope, c.node AS node ORDER BY b.uri', { uri })

/** Every event the ingest emitted while `run` ran, in order. */
const emissions = async <T>(run: () => Promise<T>): Promise<{ result: T, events: string[] }> => {
  const events: string[] = []
  const stop = [
    listen('graph:changed', detail => events.push(`graph:changed ${JSON.stringify(detail.uris)}`)),
    listen('row:changed', detail => events.push(`row:changed ${JSON.stringify(detail.uris)}`)),
  ]
  try {
    return { result: await run(), events }
  } finally {
    for (const off of stop) off()
  }
}

beforeAll(async () => {
  await enableGraph(true)
})

afterAll(async () => {
  await closeGraph()
})

// (a) THE ROUND TRIP. The log is the source of truth and `Media.raw` is its fold, so folding the same
// answers through the old store's rule has to produce the same row, field for field. The four answers
// carry all five cases `store/graph.test.ts` pins, which 9.2 moves here.
// Mutation: drop the `current.length > value.length` guard in `mergeFields` (an incoming empty array
// then beats a filled one) and the row ends with no titles.
const title = (language: string, text: string) => ({ language, title: text, score: 1 })

test('a sequence of answers for one uri rebuilds exactly the row lastWriteLongestArray would', async () => {
  const answers = [
    media('mal:1', { titles: [title('en', 'Frieren')], status: 'RELEASING', score: 0.5, url: 'https://myanimelist.net/anime/1' }),
    media('mal:1', { titles: [title('en', 'Frieren'), title('ja', 'Sousou no Frieren')], status: null, url: 'https://myanimelist.net/anime/1-2' }),
    media('mal:1', { titles: [title('en', 'Frieren: Beyond Journey\'s End'), title('de', 'Frieren')], episodeCount: 28 }),
    media('mal:1', { titles: [] }),
  ]
  const rows: AnswerRow[] = []
  for (const value of answers) rows.push(await answer('media', value))
  const report = await ingestAnswers(rows)
  expect(report.quarantined).toEqual([])

  const expected = answers.reduce((accumulator, value) => lastWriteLongestArray(value, accumulator))
  const stored = await mediaRow('mal:1')
  expect(JSON.parse(stored!.raw as string)).toEqual(expected)

  // the two the comparison above would also pass if both sides were wrong together, spelled out
  expect((expected.titles as unknown[]).length, 'an incoming empty array never beats a filled one').toBe(2)
  expect(expected.titles, 'equal non-zero lengths take the incoming').toEqual(answers[2]!.titles)
  expect(expected.status, 'an incoming null scalar keeps the existing value').toBe('RELEASING')
  expect(expected.url, 'an incoming non-null scalar wins').toBe('https://myanimelist.net/anime/1-2')

  // the projections are copies of that row, and `fieldSeq` says which answer supplied each field
  expect(stored!.owned).toBe(true)
  expect(stored!.episodeCount).toBe(28)
  expect(JSON.parse(stored!.titles as string)).toEqual(expected.titles)
  const fieldSeq = stored!.fieldSeq as Record<string, number>
  expect(fieldSeq.episodeCount, 'the third answer carried the count').toBe(rows[2]!.seq)
  expect(fieldSeq.titles, 'the third answer carried the surviving title list, and the fourth could not take it').toBe(rows[2]!.seq)
  expect(fieldSeq.status, 'a null never supplies a field, so the first answer still owns it').toBe(rows[0]!.seq)
})

// AniList's not-yet-aired list loses an entry every time one airs and is empty once the run ends, so
// longest-wins would keep the first list a tab ever saw, dates AniList has since moved included.
// Mutation: drop the `airingSchedule` exemption from either merge and the row keeps the first list.
test('a fresh schedule replaces the stored one in both merges, though it is shorter or empty', async () => {
  const answers = [
    media('anilist:1195516', { airingSchedule: [
      { episodeNumber: 4, airingAt: 'Fri, 16 Oct 2026 14:00:00 GMT' },
      { episodeNumber: 5, airingAt: 'Fri, 23 Oct 2026 14:00:00 GMT' },
      { episodeNumber: 6, airingAt: 'Fri, 30 Oct 2026 14:00:00 GMT' },
    ] }),
    media('anilist:1195516', { airingSchedule: [
      { episodeNumber: 5, airingAt: 'Fri, 30 Oct 2026 14:00:00 GMT' },
      { episodeNumber: 6, airingAt: 'Fri, 06 Nov 2026 14:00:00 GMT' },
    ] }),
    media('anilist:1195516', { status: 'RELEASING' }),
    media('anilist:1195516', { airingSchedule: [] }),
  ]
  const rows: AnswerRow[] = []
  for (const value of answers) rows.push(await answer('media', value))
  const stored = async () => JSON.parse((await mediaRow('anilist:1195516'))!.raw as string)

  await ingestAnswers(rows.slice(0, 3))
  const rescheduled = answers.slice(0, 3).reduce((accumulator, value) => lastWriteLongestArray(value, accumulator))
  expect(await stored()).toEqual(rescheduled)
  expect(rescheduled.airingSchedule, 'a shorter list replaces, and an answer that never asked keeps it').toEqual(answers[1]!.airingSchedule)

  await ingestAnswers(rows.slice(3))
  const finished = lastWriteLongestArray(answers[3]!, rescheduled)
  expect(await stored()).toEqual(finished)
  expect(finished.airingSchedule, 'an empty list replaces once nothing is scheduled').toEqual([])
})

// (b) THE PLACEHOLDER RULE. A nested node of another origin is a description, not a row, until its
// own origin answers; the claim that named it does not wait and does not move when it does (4.3).
// Mutation: give the placeholder branch an `ON MATCH SET` that writes `raw` and `owned`, and the
// mal row loses its own answer to the next anilist mention of it.
// The target is a mal id because AniList publishes `idMal` and nothing else of another catalogue
// (`anilist/extractor.ts:586`), so the claim is `source` under `NATIVE_ID_SPACES` and this case stays
// about placeholders. Provenance has its own suite in ./provenance.test.ts.
test('a nested handle node lands as a placeholder, and its own answer flips it without losing the claim', async () => {
  const claimed = media('mal:42323', { url: 'https://myanimelist.net/anime/42323' })
  await ingestAnswers([await answer('media', media('anilist:108465', { handles: [sameAs(claimed)] }))])

  const placeholder = await mediaRow('mal:42323')
  expect(placeholder!.owned, 'nobody from mal has spoken yet').toBe(false)
  expect(placeholder!.raw, 'a node contributing no field may not take one').toBe(null)
  expect(placeholder!.origin).toBe('mal')
  const claims = await claimsFrom('anilist:108465')
  expect(claims.map(claim => [claim.toUri, claim.kind, claim.claimer, claim.provenance]))
    .toEqual([['mal:42323', 'SAME_AS', 'anilist', 'source']])
  expect(JSON.parse(claims[0]!.node as string).url, 'the claimer\'s description rides the claim').toBe('https://myanimelist.net/anime/42323')

  await ingestAnswers([await answer('media', media('mal:42323', { titles: [{ language: 'en', title: 'Mushoku Tensei', score: 1 }], episodeCount: 11 }))])

  const owned = await mediaRow('mal:42323')
  expect(owned!.owned).toBe(true)
  expect(JSON.parse(owned!.raw as string).episodeCount).toBe(11)
  expect(await claimsFrom('anilist:108465'), 'the claim that named it is untouched').toHaveLength(1)

  // and a later placeholder never takes the owned row back
  await ingestAnswers([await answer('media', media('anilist:178789', { handles: [sameAs(media('mal:42323'))] }))])
  expect((await mediaRow('mal:42323'))!.owned).toBe(true)
  expect(JSON.parse((await mediaRow('mal:42323'))!.raw as string).episodeCount).toBe(11)
})

// (c) THE WALK STOPS AT A PART_OF NODE, with the control that a SAME_AS subtree is still walked to the
// bottom (`tests/unit/worker/store/part-of-subtree.test.ts`, restated on the ingest).
// Mutation: drop `options.viaPartOf` from the early return in `visitMedia` and the show contributes a
// claim to each season's kitsu id, which is the weld PART_OF exists to prevent.
test('a PART_OF node contributes no claims of its own, and a SAME_AS node still does', async () => {
  const show = (claim: string) => media('cr:G24H1N3MP', {
    url: 'https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei',
    handles: [sameAs(media(claim))],
  })
  await ingestAnswers([
    await answer('media', media('anilist:1108465', { handles: [partOf(show('kitsu:142323'))] })),
    await answer('media', media('anilist:1178789', { handles: [partOf(show('kitsu:149002'))] })),
  ])

  expect(await claimsFrom('cr:G24H1N3MP'), 'a pair rooted at the show welds every run that points at it').toEqual([])
  const container = await mediaRow('cr:G24H1N3MP')
  expect(container, 'the container is still a row, so its url can render').toBeTruthy()
  expect(container!.owned, 'crunchyroll has said nothing yet').toBe(false)
  const claim = (await claimsFrom('anilist:1108465'))[0]!
  expect(claim.kind).toBe('PART_OF')
  expect(claim.targetScope, 'partOf stamps the node CONTAINER (src/sources/utils.ts:40)').toBe('CONTAINER')
  expect(JSON.parse(claim.node as string).url).toContain('/series/G24H1N3MP/')

  // THE CONTROL, without which this is indistinguishable from "stop walking handles"
  await ingestAnswers([
    await answer('media', media('anilist:2108465', {
      handles: [sameAs(media('kitsu:242323', { handles: [sameAs(media('mal:239535'))] }))],
    })),
  ])
  expect((await claimsFrom('kitsu:242323')).map(entry => entry.toUri)).toEqual(['mal:239535'])
})

// (d) THE QUARANTINE. One bare row in `handles` made the shared insert batch reject for every
// extractor in it on 2026-09-05; here a row the decomposition cannot read is a line in the report.
// Mutation: let `decompose` throw on an unparsable `raw` instead of quarantining, and the good row
// never lands.
test('a malformed row is quarantined and the rest of the batch lands', async () => {
  const good = await answer('media', media('mal:404', { titles: [{ language: 'en', title: 'Ranking of Kings', score: 1 }] }))
  const unparsable: AnswerRow = { ...good, key: 'unparsable', seq: ++nextSeq, uri: 'mal:405', raw: '{"uri":"mal:405"' }
  const noOrigin: AnswerRow = { ...good, key: 'no-origin', seq: ++nextSeq, uri: 'bare', raw: JSON.stringify({ uri: 'bare', id: 'bare' }) }
  const circular: Row = { uri: 'mal:406', origin: 'mal', id: '406', handles: [] }
  ;(circular.handles as unknown[]).push({ relation: 'SAME_AS', node: circular })
  const selfReferencing = { ...good, key: 'circular', seq: ++nextSeq, uri: 'mal:406', raw: circular as unknown as string }

  const report = await ingestAnswers([unparsable, noOrigin, good, selfReferencing])

  expect(report.quarantined.map(entry => [entry.uri, entry.reason])).toEqual([
    ['mal:405', 'raw is not JSON'],
    ['bare', 'a row carries no uri an origin can be read from'],
    ['mal:406', 'raw is not JSON'],
  ])
  expect((await mediaRow('mal:404'))!.owned, 'the shared batch is not rejected by any of them').toBe(true)
  expect(await mediaRow('bare'), 'and nothing unaddressable was invented').toBeUndefined()
  expect(await mediaRow('mal:406'), 'a row that cannot be stored as JSON is not half stored').toBeUndefined()
})

// (e) IDEMPOTENCE, the newness contract generalized from edges to rows. A byte-identical replay is
// what a re-fetch produces and what the fixture corpus replays.
// Mutation: compute `hash` over `Date.now()` (or drop the `existing?.hash === hash` skip) and the
// second pass writes every row again, reports them changed and wakes a pass.
test('replaying a batch changes nothing and emits nothing', async () => {
  const rows = [
    await answer('media', media('jw:tm1000', { scope: 'CONTAINER', titles: [{ language: 'en', title: 'Frieren', score: 1 }] })),
    await answer('media', media('jw:ts1001', { handles: [partOf(media('jw:tm1000'))], episodeCount: 28 })),
    await answer('episode', { uri: 'jw:ts1001-1', origin: 'jw', id: 'ts1001-1', mediaUri: 'jw:ts1001', episodeNumber: 1 }),
  ]

  const first = await emissions(() => ingestAnswers(rows))
  expect(first.result.changed.media.length + first.result.changed.claims.length + first.result.changed.episodes.length).toBeGreaterThan(0)
  expect(first.events.length, 'the first pass moved something, so it wakes one').toBeGreaterThan(0)

  const again = await emissions(() => replayAnswers(rows))
  expect(again.result.changed).toEqual({ media: [], claims: [], episodes: [], raw: [] })
  expect(again.result.written, 'not one statement had a row to write').toEqual({})
  expect(again.events, 'an idempotent batch wakes nothing').toEqual([])
})

// (f) ARRIVAL ORDER. An episode reaching the graph before its media is the ordinary case on a cold
// page, and the edge may not wait: the anchor is written first (4.3 replaces `pendingClaims`).
// Mutation: skip the `draftOf` call in `visitEpisode` and the HAS_EPISODE statement matches nothing,
// so the edge is silently never written while the report still claims it.
test('an episode arriving before its media lands with a placeholder media and a HAS_EPISODE', async () => {
  await ingestAnswers([
    await answer('episode', { uri: 'cr:GX1-1', origin: 'cr', id: 'GX1-1', mediaUri: 'cr:GX1', episodeNumber: 1, titles: [{ language: 'en', title: 'The Journey', score: 1 }] }),
  ])

  const placeholder = await mediaRow('cr:GX1')
  expect(placeholder!.owned).toBe(false)
  expect(placeholder!.raw).toBe(null)
  const edges = await rowsOf('MATCH (m:Media {uri: $uri})-[h:HAS_EPISODE]->(e:Episode) RETURN e.uri AS uri, h.claimer AS claimer, e.episodeNumber AS number', { uri: 'cr:GX1' })
  expect(edges).toEqual([{ uri: 'cr:GX1-1', claimer: 'cr', number: 1 }])

  // the media's own answer then fills the row the episode anchored, and the edge does not move
  await ingestAnswers([await answer('media', media('cr:GX1', { titles: [{ language: 'en', title: 'Frieren', score: 1 }] }))])
  expect((await mediaRow('cr:GX1'))!.owned).toBe(true)
  expect(await rowsOf('MATCH (m:Media {uri: $uri})-[h:HAS_EPISODE]->(e:Episode) RETURN count(h) AS total', { uri: 'cr:GX1' })).toEqual([{ total: 1 }])
})

// THE WAKE'S SUBJECTS. `graph:changed` is what a scoped pass takes its scans from (5.3), so the
// three lists have to be what a scan looks a row up BY: `Media.uri`, `Episode.uri` and `CLAIMS.key`.
// The episode half is the one that was wrong: `changed.episodes` held `HAS_EPISODE` edge KEYS, which
// `UNWIND $uris AS u MATCH (e:Episode {uri: u})` matches nothing at all, so a scoped profile pass
// silently profiled fewer episodes than the delta named.
// Mutation: push `key` rather than `draft.toUri` at the `HAS_EPISODE` write and the episode list
// below is two hashes, matching no row in the table the control reads.
test('the wake names episode URIS and claim keys, which is what a scan looks a row up by', async () => {
  const rows = [
    await answer('media', media('tmdb:900', { titles: [title('en', 'Frieren')], handles: [partOf(media('tmdb:901'))] })),
    await answer('episode', { uri: 'tmdb:900-1', origin: 'tmdb', id: '900-1', mediaUri: 'tmdb:900', episodeNumber: 1 }),
    await answer('episode', { uri: 'tmdb:900-2', origin: 'tmdb', id: '900-2', mediaUri: 'tmdb:900', episodeNumber: 2 }),
  ]
  const details: { uris: string[], episodes?: string[], claims?: string[] }[] = []
  const stop = listen('graph:changed', detail => { details.push(detail) })
  const report = await ingestAnswers(rows)
  stop()

  expect(details.length, 'one commit, one wake').toBe(1)
  expect(details[0]!.episodes, 'episode uris, in the order the edges were written')
    .toEqual(['tmdb:900-1', 'tmdb:900-2'])
  expect(report.changed.episodes).toEqual(['tmdb:900-1', 'tmdb:900-2'])
  // THE CONTROL: every uri the event named is a row the scoped scan's own statement finds
  const found = await rowsOf('UNWIND $uris AS u MATCH (e:Episode {uri: u}) RETURN e.uri AS uri ORDER BY e.uri', { uris: details[0]!.episodes })
  expect(found.map(row => row.uri), 'the list is a key into the table it names').toEqual(['tmdb:900-1', 'tmdb:900-2'])

  expect(details[0]!.claims, 'and the claim keys the commit wrote').toEqual(report.changed.claims)
  expect(details[0]!.claims!.length, 'the control: the batch carried a claim').toBeGreaterThan(0)
  const claims = await rowsOf(
    'UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media) RETURN count(c) AS total',
    { keys: details[0]!.claims }
  )
  expect(Number(claims[0]!.total), 'and so are those').toBe(details[0]!.claims!.length)
})

// THE LIST TRAP, which cost a real page 148 of its 816 answers. An `UNWIND` struct field is typed
// from the FIRST row only, so a list that is empty in row one and filled in row two binds as
// LIST(ANY) and the whole statement dies at runtime, after the binder passed it. The order is the
// whole test: filled first has always worked, which is why every fixture and every replay missed it.
// Mutation: pass `categories` as a JS array and write `m.categories = cast(r.categories AS STRING[])`
// (the spelling this replaced) and the batch is rejected entirely.
test('a batch whose first row has an empty list and a later row a filled one lands whole', async () => {
  const report = await ingestAnswers([
    await answer('media', media('simkl:1', { categories: [], titles: [title('en', 'Frieren')] })),
    await answer('media', media('simkl:2', { categories: ['ANIME', 'MOVIE'], titles: [title('en', 'Ranking of Kings')] })),
  ])

  expect(report.quarantined).toEqual([])
  expect((await mediaRow('simkl:1'))!.owned, 'the row whose list was empty').toBe(true)
  expect((await mediaRow('simkl:2'))!.owned, 'and the row that typed the column').toBe(true)
  expect(await rowsOf('MATCH (m:Media {uri: $uri}) RETURN m.categories AS categories', { uri: 'simkl:2' }))
    .toEqual([{ categories: ['ANIME', 'MOVIE'] }])
  // the empty one reads back as NULL, which is what an empty STRING[] does on this engine anyway
  expect(await rowsOf('MATCH (m:Media {uri: $uri}) RETURN m.categories AS categories', { uri: 'simkl:1' }))
    .toEqual([{ categories: null }])
})

// THE LIVE WIRING, which is the other half of "one code path": the log's own flush hands the rows it
// wrote to the ingest, so a page that fills the log fills the graph. It also pins the `ABOUT` edge on
// the live ordering, where the `Answer` row EXISTS before the ingest ever sees it: filtering those
// rows as "not new" left the table empty on a real page while every other one filled (measured by
// `scripts/check-graph-engine.mjs`, 2026-09-12).
// Mutation 1: drop `setAnswerSink(ingestAnswers)` from `graph/index.ts`'s boot and no row lands.
// Mutation 2: write `ABOUT` only for answers this commit created and the edge is never written.
test('the log\'s flush drives the ingest, and an answer already in the table still gets its ABOUT', async () => {
  const value = media('tvdb:77', { titles: [title('en', 'Frieren')] })
  await recordAnswers({ path: { key: 'media', prev: undefined, typename: undefined }, variableValues: {} }, 'Media', value)
  await flushAnswers()

  expect((await mediaRow('tvdb:77'))!.owned, 'the hook wrote the log and the log drove the ingest').toBe(true)
  expect(await rowsOf('MATCH (a:Answer)-[:ABOUT]->(m:Media {uri: $uri}) RETURN count(a) AS total', { uri: 'tvdb:77' }))
    .toEqual([{ total: 1 }])
})

// (g) A REAL RECORDED PAGE. Everything above is a shape this file chose; this is the shape 24 sources
// actually produced, and it is the only test here that can meet a handle naming no node, a relation
// snapshot, or a node four deep. It is skipped with a message where the corpus has not been walked,
// because a session with no corpus and a session with a broken ingest must not report alike.
test('the first 800 rows of a recorded page replay, and replay again for nothing', async () => {
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

  const report = await replayAnswers(rows)
  expect(report.quarantined, 'a real page carries nothing the decomposition cannot read').toEqual([])
  expect(report.written.Media).toBeGreaterThan(0)
  expect(report.written.CLAIMS).toBeGreaterThan(0)
  expect(report.changed.media.length).toBeGreaterThan(0)

  const again = await emissions(() => replayAnswers(rows))
  expect(again.result.changed, 'the same page twice is the same graph').toEqual({ media: [], claims: [], episodes: [], raw: [] })
  expect(again.events).toEqual([])
}, 120_000)
