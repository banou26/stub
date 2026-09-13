/**
 * The nine guards of 5.2, one case each, every one of them with its CONTROL: the pair that differs
 * in exactly the fact the guard reads and passes.
 *
 * A guard is a rule about what NOT to write, so a suite without controls would report the same green
 * as one that refused everything. Each case therefore asserts three things: the proposal was refused
 * with the right reason, the downgrade the refusal owes was written in the right DIRECTION, and the
 * control pair became an active link.
 *
 * Against the REAL engine and through the REAL writer, because a verdict that never reaches a row is
 * half the rule: the refusal is a `LINK` row with a status, and the downgrade is a second row of
 * another kind, and both of those are statements the binder either takes or refuses.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { LinkProposal, PluginId, Scope } from '../../../../../src/worker/graph/plugins/contract'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { prepareGuards, readComponents } from '../../../../../src/worker/graph/plugins/guards'
import { orderLinkProposals, precedenceClassOf } from '../../../../../src/worker/graph/plugins/sameness'
import { applyPluginOutput } from '../../../../../src/worker/graph/plugins/writer'
import { answer, media, rowsOf, title } from './fixtures'

const TEST = {
  id: 'plugin:test' as PluginId,
  version: 1,
  produces: { nodes: [], edges: ['LINK' as const] },
}

/** A `SAME_AS` proposal shaped the way `plugin:direct` shapes one: a source claim, confidence 1. */
const sameAs = (fromUri: string, toUri: string, parts: Partial<LinkProposal> = {}): LinkProposal => ({
  kind: 'SAME_AS',
  fromUri,
  toUri,
  reason: 'asserted',
  confidence: 1,
  evidence: { claimer: fromUri.slice(0, fromUri.indexOf(':')), provenance: 'source' },
  supports: [],
  ...parts,
})

const partOf = (fromUri: string, toUri: string, parts: Partial<LinkProposal> = {}): LinkProposal =>
  ({ ...sameAs(fromUri, toUri, parts), kind: 'PART_OF' })

const propose = (links: LinkProposal[], scope: Scope = { full: true }) =>
  applyPluginOutput({ ...TEST, output: { scope, nodes: [], edges: [], links, episodeLinks: [] } })

const linksOf = async (by = 'plugin:test') =>
  (await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = $by
     RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason,
       l.evidence AS evidence, l.supports AS supports, l.confidence AS confidence
     ORDER BY fromUri, toUri, kind`,
    { by }
  )).map(row => ({
    pair: `${String(row.fromUri)} ${String(row.toUri)}`,
    kind: row.kind,
    status: row.status,
    reason: row.reason,
    evidence: row.evidence,
    supports: row.supports,
    confidence: row.confidence,
  }))

/** A handle node with NO scope stamp: the shape `buildHandlesFromUri` rebuilds from an address. */
const bare = (uri: string) => ({ uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1) })

const runProfile = async () => {
  resetPassState()
  const report = await runPlugins([profilePlugin], { reason: 'manual' })
  expect(report.anomalies).toEqual([])
}

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    // 1. unknown-scope: a uri named by a claim whose node carries no scope, and never described
    await answer('media', media('mal:100', { titles: [title('en', 'One')], handles: [{ relation: 'SAME_AS', node: bare('kitsu:100') }] })),
    await answer('media', media('mal:101', { titles: [title('en', 'One')] })),
    await answer('media', media('kitsu:101', { titles: [title('en', 'One')] })),
    // 2. cross-scope: a container stamped by its own answer, beside a run
    await answer('media', media('anilist:200', { titles: [title('en', 'Two')] })),
    await answer('media', media('cr:C200', { scope: 'CONTAINER', titles: [title('en', 'Two')] })),
    // 3. address-only: the pair is described, the address claim is written by hand below
    await answer('media', media('anilist:300', { titles: [title('en', 'Three')] })),
    await answer('media', media('tvmaze:300', { titles: [title('en', 'Three')] })),
    // 4. disagreeing-ids: two anilist runs and one mal row that one of them is welded to
    await answer('media', media('anilist:400', { titles: [title('en', 'Four')] })),
    await answer('media', media('anilist:401', { titles: [title('en', 'Four part two')] })),
    await answer('media', media('mal:400', { titles: [title('en', 'Four')] })),
    await answer('media', media('kitsu:400', { titles: [title('en', 'Four')] })),
    // 4b. the `offline` origin, whose ids are BORROWED: two rows of it disagree only when they borrow
    // from the SAME catalogue. `offline:anilist-410` and `offline:mal-410` are one row under two
    // addresses; `offline:mal-411` is a different mal row and so a real disagreement.
    await answer('media', media('offline:anilist-410', { titles: [title('en', 'Four ten')] })),
    await answer('media', media('offline:mal-410', { titles: [title('en', 'Four ten')] })),
    await answer('media', media('offline:mal-411', { titles: [title('en', 'Four eleven')] })),
    await answer('media', media('offline:mal-412', { titles: [title('en', 'Four twelve')] })),
    await answer('media', media('kitsu:410', { titles: [title('en', 'Four ten')] })),
    await answer('media', media('kitsu:411', { titles: [title('en', 'Four eleven')] })),
    // 5. contested: two anilist runs both claiming one mal row, the AoT Final Chapters shape (8.6)
    await answer('media', media('anilist:500', { titles: [title('en', 'Five')], handles: [{ relation: 'SAME_AS', node: media('mal:500') }] })),
    await answer('media', media('anilist:501', { titles: [title('en', 'Five part two')], handles: [{ relation: 'SAME_AS', node: media('mal:500') }] })),
    await answer('media', media('mal:500', { titles: [title('en', 'Five')] })),
    // the control beside it: one claimant only
    await answer('media', media('anilist:502', { titles: [title('en', 'Five point two')], handles: [{ relation: 'SAME_AS', node: media('mal:502') }] })),
    await answer('media', media('mal:502', { titles: [title('en', 'Five point two')] })),
    // 6. contained: a RUN claiming PART_OF another RUN, which is `asserted` containment
    await answer('media', media('kitsu:600', { titles: [title('en', 'Six')], handles: [{ relation: 'PART_OF', node: media('anilist:600') }] })),
    await answer('media', media('anilist:600', { titles: [title('en', 'Six')] })),
    await answer('media', media('kitsu:601', { titles: [title('en', 'Six control')] })),
    await answer('media', media('anilist:601', { titles: [title('en', 'Six control')] })),
    // 7. count-mismatch: a folding origin's season against runs of 12, 24 and 11
    await answer('media', media('cr:C700-S1', { titles: [title('en', 'Seven')], episodeCount: 24 })),
    await answer('media', media('anilist:700', { titles: [title('en', 'Seven')], episodeCount: 12 })),
    await answer('media', media('anilist:702', { titles: [title('en', 'Seven')], episodeCount: 24 })),
    await answer('media', media('cr:C701-S1', { titles: [title('en', 'Seven b')], episodeCount: 11 })),
    await answer('media', media('anilist:701', { titles: [title('en', 'Seven b')], episodeCount: 24, status: 'FINISHED' })),
    await answer('media', media('anilist:703', { titles: [title('en', 'Seven b')], episodeCount: 24, status: 'RELEASING' })),
    // 8. no-length: a folding season facing a run that states nothing at all
    await answer('media', media('cr:C800-S1', { titles: [title('en', 'Eight')], episodeCount: 12 })),
    await answer('media', media('anilist:800', { titles: [title('en', 'Eight')] })),
    await answer('media', media('anilist:801', { titles: [title('en', 'Eight')], episodeCount: 12 })),
    // 9. kind-mismatch: `tmdb:550` is Fight Club as a film and Till Death Us Do Part as a series
    await answer('media', media('tmdb:900', { titles: [title('en', 'Nine')], type: 'MOVIE', categories: ['MOVIE'] })),
    await answer('media', media('anilist:900', { titles: [title('en', 'Nine')], type: 'TV', categories: ['SERIES'] })),
    await answer('media', media('anilist:901', { titles: [title('en', 'Nine')], type: 'TV', categories: ['SERIES'] })),
    await answer('media', media('tmdb:901', { titles: [title('en', 'Nine')], type: 'TV', categories: ['SERIES'] })),
    // a pair nothing else in this file touches, for the two cases about ORDER rather than about a
    // guard: a containment edge another case wrote would refuse them `contained` before order counts
    await answer('media', media('anilist:1000', { titles: [title('en', 'Ten')] })),
    await answer('media', media('kitsu:1000', { titles: [title('en', 'Ten')] })),
    // a count-mismatch pair nothing else claims, for the case about CONVERGENCE: a weld landing in
    // either component would let a higher guard fire on the second apply, which moves a verdict for
    // a reason that is not the one under test
    await answer('media', media('cr:C900-S1', { titles: [title('en', 'Nine hundred')], episodeCount: 24 })),
    await answer('media', media('anilist:950', { titles: [title('en', 'Nine fifty')], episodeCount: 12 })),
  ])
  await runProfile()

  // the one claim no source writes yet (3.3): an `address` handle, written the way the ingest writes
  // a claim so the guard meets the real column rather than a stand-in
  const { query } = await graphReady()
  await query(
    `MATCH (a:Media {uri: $from}), (b:Media {uri: $to})
     WHERE NOT EXISTS { MATCH (a)-[:CLAIMS {key: $key}]->(b) }
     CREATE (a)-[:CLAIMS {key: $key, kind: 'SAME_AS', provenance: 'address', claimer: $claimer,
       targetScope: NULL, node: '{}', hash: '', answerSeq: cast('0' AS INT64), seq: cast('0' AS INT64)}]->(b)`,
    { from: 'anilist:300', to: 'tvmaze:300', key: 'address-claim-300', claimer: 'anilist' }
  )
})

afterAll(async () => {
  await closeGraph()
})

// (1) UNKNOWN-SCOPE: the claim that took the RUN default before its row landed (`db.ts:113-123`).
// Nothing is written at all, which is the one refusal that leaves no row: the proposal waits.
// Mutation: return `write: true` for this guard and the pair below carries a refused row, which a
// later pass would have to delete rather than simply not have written.
test('guard 1 refuses a pair whose endpoint has no effective scope, and writes nothing', async () => {
  const report = await propose([sameAs('mal:100', 'kitsu:100'), sameAs('mal:101', 'kitsu:101')])

  expect(await linksOf(), 'the control pair, and nothing for the one that waits').toEqual([
    { pair: 'mal:101 kitsu:101', kind: 'SAME_AS', status: 'active', reason: 'asserted', evidence: expect.anything(), supports: null, confidence: 1 },
  ])
  expect(report.counts.LINK).toEqual({ created: 1, updated: 0, deleted: 0 })
})

// (2) CROSS-SCOPE: the derivation table of `db.ts:166-169`, as a guard rather than as a comment. The
// downgrade runs from the RUN to the CONTAINER whatever direction the proposal had.
// Mutation: drop the `a.scope !== b.scope` branch and a show enters a run's identity space, which is
// the weld `tests/unit/worker/store/container-scope.test.ts` exists to prevent.
test('guard 2 refuses a pair whose scopes differ and downgrades run to container', async () => {
  await propose([sameAs('cr:C200', 'anilist:200'), sameAs('mal:101', 'kitsu:101')])

  expect(await linksOf()).toEqual([
    {
      pair: 'anilist:200 cr:C200', kind: 'PART_OF', status: 'active', reason: 'cross-scope',
      evidence: '{"theirs":"CONTAINER","ours":"RUN"}', supports: null, confidence: 1,
    },
    {
      pair: 'cr:C200 anilist:200', kind: 'SAME_AS', status: 'refused', reason: 'cross-scope',
      evidence: '{"theirs":"CONTAINER","ours":"RUN"}', supports: null, confidence: 1,
    },
    { pair: 'mal:101 kitsu:101', kind: 'SAME_AS', status: 'active', reason: 'asserted', evidence: expect.anything(), supports: null, confidence: 1 },
  ])
})

// (3) ADDRESS-ONLY: a pointer, whoever the claimer. Refused and NOT downgraded, because the address
// asserts nothing about how its uris relate (3.3, the owner's decision of 2026-09-12).
// Mutation: read the supports without the provenance test and the two old season links of a stale
// bookmark weld, which is the failure the whole provenance exists to stop.
test('guard 3 refuses a proposal supported by an address claim, and never downgrades it', async () => {
  await propose([
    sameAs('anilist:300', 'tvmaze:300', { supports: ['address-claim-300'] }),
    sameAs('mal:101', 'kitsu:101', { supports: ['not-an-address'] }),
  ])

  const rows = await linksOf()
  expect(rows.filter(row => row.pair.startsWith('anilist:300'))).toEqual([{
    pair: 'anilist:300 tvmaze:300', kind: 'SAME_AS', status: 'refused', reason: 'address-only',
    evidence: '{"theirs":["address-claim-300"],"ours":["address-claim-300"]}',
    supports: ['address-claim-300'], confidence: 1,
  }])
  expect(rows.filter(row => row.pair.startsWith('anilist:300') && row.kind === 'PART_OF'), 'no downgrade').toEqual([])
  expect(rows.find(row => row.pair === 'mal:101 kitsu:101')!.status, 'the control: a source support').toBe('active')
})

// (4) DISAGREEING-IDS: the union would put two anilist ids in one component, and neither extends the
// other (`anomalies.ts:18-25`, `src/utils/uri.ts:23-34`). Both claimants downgrade toward the shared
// row, which is the AoT shape one claim earlier (8.6).
// Mutation: compare the two ENDPOINTS only, rather than the union of their components, and the
// second claimant welds: the graph as it stands is the whole evidence this guard has.
test('guard 4 refuses a union that puts two ids of one origin in one component', async () => {
  // the first claimant welds, which is the component the second one meets
  await propose([sameAs('anilist:400', 'mal:400')])
  expect((await linksOf()).map(row => row.status)).toEqual(['active'])

  await propose([
    sameAs('anilist:400', 'mal:400'),
    sameAs('anilist:401', 'mal:400'),
    sameAs('kitsu:400', 'mal:400'),
  ])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'anilist:401 mal:400' && row.kind === 'SAME_AS')).toEqual({
    pair: 'anilist:401 mal:400', kind: 'SAME_AS', status: 'refused', reason: 'disagreeing-ids',
    evidence: '{"theirs":"anilist:400","ours":"anilist:401"}', supports: null, confidence: 1,
  })
  expect(rows.find(row => row.pair === 'anilist:401 mal:400' && row.kind === 'PART_OF'), 'the claimant points at the shared row')
    .toMatchObject({ status: 'active', reason: 'disagreeing-ids' })
  expect(rows.find(row => row.pair === 'anilist:400 mal:400')!.status, 'the standing weld is not what this guard retracts').toBe('active')
  expect(rows.find(row => row.pair === 'kitsu:400 mal:400')!.status, 'the control: another origin disagrees with nobody').toBe('active')
})

// (4b) THE SAME GUARD, on the one origin that does not issue its own ids.
//
// An anime offline database row has no id of its own: it is named by whichever foreign id reached it
// first, mal before anilist before kitsu before anidb (`sources/offline/index-lookup.ts` `rowId`), so
// `offline:anilist-410` and `offline:mal-410` are routinely ONE row under two addresses and disagree
// about nothing. Read as a plain origin they look like two rows that cannot both be this show, and
// guard 4 refuses a correct merge.
//
// Measured on the recorded page 2026-09-14: reading the plain origin split 57 corpus lines that the
// labels say are one show, and every one of them was an `offline:` pair borrowing from two different
// catalogues.
//
// Mutation: make `identitySpaceOf` return the plain origin and the first case below refuses; drop the
// borrowed-source split entirely and the second stops refusing, which is the half that must not be
// lost. The corpus catches the first, but `corpus/` is not in git, so a session without one would see
// neither: these two are the version that travels.
test('guard 4 reads the BORROWED source of an offline id, not the offline origin', async () => {
  // the first address welds, which is the component the second one meets: one batch would weigh both
  // against the same pre-batch snapshot and neither would ever see the other
  await propose([sameAs('offline:anilist-410', 'kitsu:410')])
  await propose([
    sameAs('offline:anilist-410', 'kitsu:410'),
    sameAs('offline:mal-410', 'kitsu:410'),
  ])

  // BY KIND AS WELL AS BY PAIR. A refused `SAME_AS` is written beside an active `PART_OF` downgrade,
  // and `PART_OF` sorts first, so a find on the pair alone reads the downgrade and calls it active in
  // both states.
  const rows = await linksOf()
  const link = (pair: string, kind: string) => rows.find(row => row.pair === pair && row.kind === kind)
  expect(link('offline:anilist-410 kitsu:410', 'SAME_AS')!.status).toBe('active')
  expect(
    link('offline:mal-410 kitsu:410', 'SAME_AS')!.status,
    'two addresses of one offline row are not two rows'
  ).toBe('active')
  expect(link('offline:mal-410 kitsu:410', 'PART_OF'), 'and no downgrade was written').toBeUndefined()
})

test('the control: two offline ids borrowed from the SAME catalogue still disagree', async () => {
  await propose([sameAs('offline:mal-411', 'kitsu:411')])
  expect((await linksOf()).find(row => row.pair === 'offline:mal-411 kitsu:411')!.status).toBe('active')

  await propose([
    sameAs('offline:mal-411', 'kitsu:411'),
    sameAs('offline:mal-412', 'kitsu:411'),
  ])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'offline:mal-412 kitsu:411' && row.kind === 'SAME_AS'))
    .toMatchObject({ status: 'refused', reason: 'disagreeing-ids' })
})

// (5) CONTESTED, evaluated over every CLAIM rather than over active links, so two claimants landing
// in different flushes still meet and the verdict is the same on every later pass. This is 8.6 end to
// end: two PART_OF badges and no card, rather than one lost row and a third card.
// Mutation: read the active links instead of the claims and the first claimant keeps its weld, so
// which run owns `mal:500` depends on which flush arrived first.
test('guard 5 refuses every claim into a target two disagreeing components claim', async () => {
  await propose([
    sameAs('anilist:500', 'mal:500'),
    sameAs('anilist:501', 'mal:500'),
    sameAs('anilist:502', 'mal:502'),
  ])

  const rows = await linksOf()
  for (const claimant of ['anilist:500', 'anilist:501']) {
    expect(rows.find(row => row.pair === `${claimant} mal:500` && row.kind === 'SAME_AS'), `${claimant} is refused`)
      .toMatchObject({ status: 'refused', reason: 'contested' })
    expect(rows.find(row => row.pair === `${claimant} mal:500` && row.kind === 'PART_OF'), `${claimant} points at the shared row`)
      .toMatchObject({ status: 'active', reason: 'contested' })
  }
  expect(rows.find(row => row.pair === 'anilist:502 mal:502'), 'the control: one claimant is not a contest')
    .toMatchObject({ kind: 'SAME_AS', status: 'active' })
})

// (6) CONTAINED: an active PART_OF or INCLUDES already joins the pair (3.5), so the refusal's
// downgrade is a no-op and none is written. The containment edge here is `plugin:direct`'s, from a
// PART_OF claim between two runs.
// Mutation: drop the guard and the owner's rule breaks in the one place it is cheapest to enforce,
// at proposal time; drop the DOWNGRADE_REASONS exclusion instead and the reason of a refused row
// flips between `cross-scope` and `contained` on alternating passes, which never converges.
test('guard 6 refuses a pair an active containment edge already joins', async () => {
  const direct = await import('../../../../../src/worker/graph/plugins/direct')
  resetPassState()
  await runPlugins([profilePlugin, direct.directPlugin], { reason: 'manual' })
  expect((await linksOf('plugin:direct')).find(row => row.pair === 'kitsu:600 anilist:600'))
    .toMatchObject({ kind: 'PART_OF', status: 'active', reason: 'asserted' })

  await propose([sameAs('kitsu:600', 'anilist:600'), sameAs('kitsu:601', 'anilist:601')])

  const rows = await linksOf()
  expect(rows.filter(row => row.pair === 'kitsu:600 anilist:600')).toEqual([{
    pair: 'kitsu:600 anilist:600', kind: 'SAME_AS', status: 'refused', reason: 'contained',
    evidence: '{"theirs":"anilist:600","ours":"kitsu:600"}', supports: null, confidence: 1,
  }])
  expect(rows.find(row => row.pair === 'kitsu:601 anilist:601')!.status, 'the control: no containment between them')
    .toBe('active')

  // and the containment edge `plugin:direct` wrote is untouched: a refusal never retracts the fact
  // it was refused for
  expect((await linksOf('plugin:direct')).find(row => row.pair === 'kitsu:600 anilist:600'))
    .toMatchObject({ status: 'active', reason: 'asserted' })
})

// (7) COUNT-MISMATCH, both directions and the gate between them: the LONGER direction downgrades
// always (zero tolerance, `foldVetoed`), the SHORTER one only when the run is FINISHED, because
// twelve sources set `episodeCount = episodes.length` and a short list on a RELEASING run is not
// evidence (`consensus.ts:164-168`).
// Mutation: drop the FINISHED gate and the Elusive Samurai row with 8 of 12 aired stops being a
// member; drop the zero tolerance and BAKI's 13 welds to a finished 26.
test('guard 7 refuses a folding season whose count disagrees, and gates the shorter direction', async () => {
  await propose([
    sameAs('cr:C700-S1', 'anilist:700'),
    sameAs('cr:C700-S1', 'anilist:702'),
    sameAs('cr:C701-S1', 'anilist:701'),
    sameAs('cr:C701-S1', 'anilist:703'),
  ])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'cr:C700-S1 anilist:700' && row.kind === 'SAME_AS'), '24 against 12')
    .toMatchObject({ status: 'refused', reason: 'count-mismatch', evidence: '{"theirs":24,"ours":12}' })
  expect(rows.find(row => row.pair === 'anilist:700 cr:C700-S1' && row.kind === 'PART_OF'), 'the shorter side is the part')
    .toMatchObject({ status: 'active', reason: 'count-mismatch' })
  expect(rows.find(row => row.pair === 'cr:C700-S1 anilist:702'), 'the control: the counts agree')
    .toMatchObject({ kind: 'SAME_AS', status: 'active' })

  expect(rows.find(row => row.pair === 'cr:C701-S1 anilist:701' && row.kind === 'SAME_AS'), '11 against a FINISHED 24')
    .toMatchObject({ status: 'refused', reason: 'count-mismatch', evidence: '{"theirs":11,"ours":24}' })
  expect(rows.find(row => row.pair === 'cr:C701-S1 anilist:701' && row.kind === 'PART_OF'), 'the folding season is the part')
    .toMatchObject({ status: 'active', reason: 'count-mismatch' })
  expect(rows.find(row => row.pair === 'cr:C701-S1 anilist:703'), 'the control: the same 11 against a RELEASING 24')
    .toMatchObject({ kind: 'SAME_AS', status: 'active' })
})

// A DOWNGRADE IS NOT A CONTAINMENT FACT, which is the one exclusion guard 6 carries. The refusal
// above writes a `PART_OF` between the pair; a guard 6 that read it would refuse the same pair
// `contained` on the next pass, drop the downgrade with it, and refuse it `count-mismatch` again on
// the pass after that. The rows would never stop moving, and the pass would report a cycle rather
// than a verdict.
// Mutation: delete `DOWNGRADE_REASONS` from the guard 6 read and the second apply below rewrites
// every row of the pair, which is a re-render per flush on a live page.
// The pair is its own, because a verdict may legitimately move when the GRAPH moves: once a weld
// lands in one of these components, guard 4 outranks guard 7 for the same pair and the reason
// changes once, which is the fixed point the pass iterates to rather than a cycle.
test('the same evidence twice is the same verdict, downgrade included', async () => {
  const proposals = [sameAs('cr:C900-S1', 'anilist:950')]
  await propose(proposals)
  const rows = await linksOf()
  expect(rows.map(row => `${row.kind} ${row.status} ${row.reason}`)).toEqual([
    'PART_OF active count-mismatch', 'SAME_AS refused count-mismatch',
  ])

  const again = await propose(proposals)
  expect(again.changes).toEqual([])
  expect(await linksOf()).toEqual(rows)
})

// (8) NO-LENGTH: "no count" is not zero (2026-09-09), so a folding season facing a run with no length
// at all is never welded on a guess.
// Mutation: read a missing count as 0 and this becomes a count-mismatch, which downgrades the same
// pair for a reason the evidence does not support; skip the guard and the weld happens on nothing.
test('guard 8 refuses a folding season facing a run with no length', async () => {
  await propose([sameAs('cr:C800-S1', 'anilist:800'), sameAs('cr:C800-S1', 'anilist:801')])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'cr:C800-S1 anilist:800' && row.kind === 'SAME_AS'))
    .toMatchObject({ status: 'refused', reason: 'no-length', evidence: '{"theirs":12,"ours":null}' })
  expect(rows.find(row => row.pair === 'anilist:800 cr:C800-S1' && row.kind === 'PART_OF'))
    .toMatchObject({ status: 'active', reason: 'no-length' })
  expect(rows.find(row => row.pair === 'cr:C800-S1 anilist:801'), 'the control: a run that states its length')
    .toMatchObject({ kind: 'SAME_AS', status: 'active' })
})

// (9) KIND-MISMATCH: one uri whose answers disagree about MOVIE against SERIES is an anomaly (5.5),
// and a claim between a film and a series is a refusal (`tmdb:550`, 2026-09-04).
// Mutation: compare the two formats without the MOVIE test and two rows that merely name different
// work kinds are refused, which is a different rule and a much larger one.
test('guard 9 refuses a film claimed the same as a series', async () => {
  await propose([sameAs('tmdb:900', 'anilist:900'), sameAs('tmdb:901', 'anilist:901')])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'tmdb:900 anilist:900' && row.kind === 'SAME_AS'))
    .toMatchObject({ status: 'refused', reason: 'kind-mismatch' })
  expect(rows.some(row => row.reason === 'kind-mismatch' && row.kind === 'PART_OF' && row.status === 'active'), 'and it downgrades')
    .toBe(true)
  expect(rows.find(row => row.pair === 'tmdb:901 anilist:901'), 'the control: two series')
    .toMatchObject({ kind: 'SAME_AS', status: 'active' })
})

// THE `partOf` GUARDS: `unknown-scope`, `self` and `inverted`, and a CONTAINER proposed as part of a
// RUN is refused rather than flipped, because a caller that got the order wrong may have the scopes
// wrong too (`db.ts:244-245`).
// Mutation: flip an inverted pair instead of refusing it and `container-scope.test.ts`'s "container
// then run is refused, never flipped" has no successor here.
test('the partOf guards refuse self, inverted and an unknown scope, and pass RUN into RUN', async () => {
  await propose([
    partOf('anilist:200', 'anilist:200'),
    partOf('cr:C200', 'anilist:200'),
    partOf('mal:100', 'kitsu:100'),
    partOf('anilist:200', 'cr:C200'),
    partOf('mal:101', 'kitsu:101'),
  ])

  const rows = await linksOf()
  expect(rows.find(row => row.pair === 'anilist:200 anilist:200')).toMatchObject({ status: 'refused', reason: 'self' })
  expect(rows.find(row => row.pair === 'cr:C200 anilist:200')).toMatchObject({ status: 'refused', reason: 'inverted' })
  expect(rows.some(row => row.pair === 'mal:100 kitsu:100'), 'an unknown scope writes nothing and waits').toBe(false)
  expect(rows.find(row => row.pair === 'anilist:200 cr:C200'), 'the control: a run into its container')
    .toMatchObject({ status: 'active', reason: 'asserted' })
  expect(rows.find(row => row.pair === 'mal:101 kitsu:101'), 'and RUN into RUN, which a catalogue season is')
    .toMatchObject({ status: 'active', reason: 'asserted' })
})

// PRECEDENCE (5.2): two proposals reaching one `LINK` key are one row, and the first in class order
// supplies its reason while every one of them contributes its supports. A title link therefore never
// beats an id claim into the same target, whichever order the plugin emitted them in.
// Mutation: drop the class ordering from `orderLinkProposals` and the row's reason depends on the
// order of an array, which is the "SEQUENCE of unions decides root survival" defect of
// `fuzzy-merge.ts:631-633` in a new place.
test('an id claim outranks a title match into the same pair, in either emission order', async () => {
  const titleLink = sameAs('anilist:1000', 'kitsu:1000', {
    reason: 'title',
    confidence: 0.94,
    evidence: { score: 0.94 },
    supports: ['title-support'],
    gates: { format: 'passed', season: 'silent', date: 'passed', companion: 'silent' },
  })
  const idClaim = sameAs('anilist:1000', 'kitsu:1000', { reason: 'asserted', supports: ['claim-support'] })
  expect([precedenceClassOf(idClaim), precedenceClassOf(titleLink)]).toEqual(['run-id', 'title'])
  // the CLASS is what orders them, not the pair: these two name different pairs, and the id claim's
  // `fromUri` sorts AFTER the title link's, so a sort without the classes puts them the other way
  expect(orderLinkProposals([titleLink, sameAs('mal:101', 'kitsu:101')]).map(link => link.fromUri))
    .toEqual(['mal:101', 'anilist:1000'])

  await propose([titleLink, idClaim])
  const first = await linksOf()
  expect(first).toEqual([{
    pair: 'anilist:1000 kitsu:1000', kind: 'SAME_AS', status: 'active', reason: 'asserted',
    evidence: '{"claimer":"anilist","provenance":"source"}',
    supports: ['claim-support', 'title-support'], confidence: 1,
  }])

  await propose([idClaim, titleLink])
  expect(await linksOf(), 'the other emission order is the same row').toEqual(first)
})

// DETERMINISM: the same proposals in a different input order write the same rows. This is the whole
// point of a precedence class list rather than a hash tie-break.
// Mutation: sort by `(fromUri, toUri)` alone and the pairs below still agree, because the classes are
// what separates them: shuffle the class list instead and the reasons swap.
test('two runs of the same proposals in different input order write the same LINK rows', async () => {
  const proposals = [
    sameAs('anilist:1000', 'kitsu:1000'),
    sameAs('cr:C700-S1', 'anilist:700'),
    sameAs('anilist:500', 'mal:500'),
    sameAs('tmdb:900', 'anilist:900'),
    sameAs('cr:C800-S1', 'anilist:800'),
  ]
  await propose(proposals)
  const forwards = await linksOf()

  const shuffled = [...proposals].reverse()
  const again = await propose(shuffled)
  expect(again.changes, 'the same desired set, so nothing moved').toEqual([])
  expect(await linksOf()).toEqual(forwards)
})

// THE STICKY RULE, half one: PROFILE DRIFT NEVER RETRACTS. A member's titles moving is not evidence
// about identity, and no guard reads a title, a key or a score.
// Mutation: have any guard read `titleKeys` and this link disappears the moment a source returns a
// different title for one of its members, which on a live page is every other flush.
test('an active link survives a profile whose titles changed', async () => {
  await propose([sameAs('mal:101', 'kitsu:101')])
  expect((await linksOf())[0]).toMatchObject({ status: 'active' })

  await ingestAnswers([
    await answer('media', media('kitsu:101', { titles: [title('en', 'A completely different title')] })),
  ])
  await runProfile()

  const report = await propose([sameAs('mal:101', 'kitsu:101')])
  expect(report.counts.LINK, 'not one row moved').toBeUndefined()
  expect((await linksOf())[0]).toMatchObject({ status: 'active' })
})

// THE STICKY RULE, half two: a link the pass did NOT re-propose is still re-checked, and retracted
// when a guard now fails. The evidence that moves here is the scope ratchet, which is the
// justwatch-before-crunchyroll race of `db.ts:113-123` as a fixture rather than as a comment.
// Mutation: skip `readStickyLinks` and a scoped pass leaves a link standing whose endpoints no longer
// share a scope, which is a show inside a run's cluster for as long as nobody re-proposes it.
test('an active link the pass did not re-propose is retracted when a scope flips under it', async () => {
  await propose([sameAs('anilist:300', 'tvmaze:300', { supports: [] })])
  expect((await linksOf())[0]).toMatchObject({ status: 'active', reason: 'asserted' })

  // the ratchet: one answer says CONTAINER, and the effective scope never flips back (5.4 P0)
  await ingestAnswers([
    await answer('media', media('tvmaze:300', { scope: 'CONTAINER', titles: [title('en', 'Three')] })),
  ])
  await runProfile()

  // a pass that proposes NOTHING and names an empty scope: only the sticky re-check can move this
  await propose([], { full: false, uris: [], clusters: [], pairs: [] })

  const rows = await linksOf()
  expect(rows.find(row => row.kind === 'SAME_AS'), 'the guard that now fails is cross-scope')
    .toMatchObject({ status: 'refused', reason: 'cross-scope' })
  expect(rows.find(row => row.kind === 'PART_OF'), 'and the downgrade is written with it')
    .toMatchObject({ pair: 'anilist:300 tvmaze:300', status: 'active', reason: 'cross-scope' })
})

// THE COMPONENT READ, which every one of guards 4 and 5 is computed against: the union-find over the
// active SAME_AS edges has to agree with the recursive walk of 3.5, uri by uri, or the guards are
// reading a different graph from the one the aggregation will.
// Mutation: union on every LINK rather than on the active SAME_AS ones and the two disagree at the
// first refused row, which is the first pair this suite writes.
test('the batch component read equals the recursive LINK*0..8 walk of 3.5', async () => {
  await propose([
    sameAs('mal:101', 'kitsu:101'),
    sameAs('anilist:400', 'mal:400'),
    sameAs('kitsu:400', 'mal:400'),
    sameAs('cr:C200', 'anilist:200'),
  ])
  const { query } = await graphReady()
  const components = await readComponents(query)

  const uris = (await rowsOf('MATCH (m:Media) RETURN m.uri AS uri ORDER BY uri')).map(row => String(row.uri))
  let joined = 0
  for (const uri of uris) {
    const walked = (await rowsOf(
      `MATCH (a:Media {uri: $uri})-[e:LINK*0..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:Media)
       RETURN DISTINCT b.uri AS uri ORDER BY uri`,
      { uri }
    )).map(row => String(row.uri))
    expect(components.membersOf(uri), `the component of ${uri}`).toEqual(walked)
    if (walked.length > 1) joined += 1
  }
  expect(joined, 'the control: a walk that found no member but the row itself would prove nothing').toBeGreaterThan(0)
}, 60_000)

// THE SNAPSHOT IS CACHED BETWEEN WRITES, and this is the case that decides whether that is safe.
//
// `graphGuards()` is asked about ONE pair at a time, so before the cache every proposal paid for a
// whole-graph read of the active SAME_AS edges: 165 calls carrying 44,283 rows on a real modal,
// 2026-09-13, the single hottest statement of the page. Caching it is only correct if NOTHING can
// change the graph without dropping it.
//
// The invalidation therefore hangs off the ENGINE, not off the writer. Hooking `runChunked` was the
// first attempt and it was wrong: `aggregate.test.ts` retracts a SAME_AS row with a raw DELETE
// through the query handle, and the cache answered from before it. This case reproduces that shape
// directly, since it is the one a reasonable-looking fix gets wrong.
// MUTATED: unsubscribe `invalidateComponents` entirely and this reddens on the FIRST assertion, not
// the second, because the snapshot then predates even this case's own setup. That is the honest
// shape of the failure: an uninvalidated cache is stale in both directions, not just after a delete.
test('a component snapshot is dropped by a direct write, not only by the writer', async () => {
  // its own pair, and the LINK is written DIRECTLY rather than proposed: what is under test is the
  // cache's invalidation, so the setup must not also depend on nine guards agreeing to write it
  await ingestAnswers([
    await answer('media', media('mal:920', { titles: [title('ja', 'Snapshot Probe')], type: 'TV', categories: ['ANIME', 'SERIES'] })),
    await answer('media', media('kitsu:920', { titles: [title('ja', 'Snapshot Probe')], type: 'TV', categories: ['ANIME', 'SERIES'] })),
  ])
  const { query } = await graphReady()
  await query(
    `MATCH (a:Media {uri: 'mal:920'}), (b:Media {uri: 'kitsu:920'})
     CREATE (a)-[:LINK {key: 'probe-920', kind: 'SAME_AS', status: 'active', by: 'plugin:test', version: 1}]->(b)`
  )

  const before = await readComponents(query)
  expect(before.membersOf('mal:920'), 'the two are one component to start with').toEqual(['kitsu:920', 'mal:920'])

  // exactly what aggregate.test.ts does to drive a split: no writer, no event, just a statement
  await query(
    `MATCH (a:Media {uri: 'mal:920'})-[l:LINK]->(b:Media)
     WHERE l.kind = 'SAME_AS' AND l.status = 'active' DELETE l`
  )

  const after = await readComponents(query)
  expect(after.membersOf('mal:920'), 'and the very next read has to see the retraction').toEqual(['mal:920'])
}, 60_000)

// THE GUARD BATCH is one snapshot: every verdict in one apply is computed against the graph as it
// stood when the batch was prepared, which is what guard 4's "never within one pass" means.
// Mutation: prepare per proposal and the second of two proposals in one output sees the first one's
// link, so an output's own order starts deciding verdicts again.
test('one batch of verdicts reads one snapshot of the graph', async () => {
  const { query } = await graphReady()
  const pass = await prepareGuards(query, [{ fromUri: 'anilist:401', toUri: 'mal:400', supports: [] }])
  const before = pass.sameAs({ fromUri: 'anilist:401', toUri: 'mal:400', supports: [] })
  const after = pass.sameAs({ fromUri: 'anilist:401', toUri: 'mal:400', supports: [] })
  expect(before).toEqual(after)
  expect(pass.profileOf('anilist:401').scope, 'and the facts it read are the profile\'s own').toBe('RUN')
})
