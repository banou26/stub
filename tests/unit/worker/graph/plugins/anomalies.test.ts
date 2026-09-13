/**
 * The anomaly rules of 5.5 and the four invariant queries of 3.5, each with the control 5.5 demands:
 * "every rule ships with a control fixture that must report zero, so a rule that cannot fire in its
 * failure state is caught by its own test".
 *
 * The invariant queries get the same treatment for a harder reason. Three of the four read
 * `MEMBER_OF`, which `plugin:aggregate` writes and which does not exist yet, so all four return 0
 * today whatever the graph holds. A check that reports zero because its table is empty has told you
 * nothing, so each of them is FIRED here by writing the membership by hand through the writer: the
 * positive is what makes the zero elsewhere worth reading.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import type { PluginId, PluginOutput, Scope } from '../../../../../src/worker/graph/plugins/contract'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import { acceptEveryPair } from '../../../../../src/worker/graph/plugins/guards'
import { applyPluginOutput, retractPlugin } from '../../../../../src/worker/graph/plugins/writer'
import { checkInvariants } from '../../../../../src/worker/graph/plugins/invariants'
import {
  constantId, contested, disagreeingIds, kindDisagrees,
} from '../../../../../src/worker/graph/plugins/anomalies'
import { answer, media, rowsOf, title } from './fixtures'

const FAKE = {
  id: 'plugin:fake-aggregate' as PluginId,
  version: 1,
  produces: { nodes: ['Cluster' as const], edges: ['MEMBER_OF' as const, 'LINK' as const] },
}

const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })

const apply = (output: PluginOutput) => applyPluginOutput({ ...FAKE, output, prepare: acceptEveryPair })

const empty = (scope: Scope = { full: true }): PluginOutput =>
  ({ scope, nodes: [], edges: [], links: [], episodeLinks: [] })

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    // contested: two anilist runs claiming one mal row, the AoT Final Chapters shape (8.6)
    await answer('media', media('anilist:10', { titles: [title('en', 'Final Chapters Part 1')], handles: [sameAs(media('mal:51535'))] })),
    await answer('media', media('anilist:11', { titles: [title('en', 'Final Chapters Part 2')], handles: [sameAs(media('mal:51535'))] })),
    await answer('media', media('mal:51535', { titles: [title('en', 'Final Chapters')] })),
    // the control beside it: one claimant, which is not a contest
    await answer('media', media('anilist:12', { titles: [title('en', 'Alone')], handles: [sameAs(media('mal:12'))] })),
    await answer('media', media('mal:12', { titles: [title('en', 'Alone')] })),
    // kind-disagrees: one uri, two answers, one film and one series (`tmdb:550`)
    await answer('media', { ...media('tmdb:550', { titles: [title('en', 'Fight Club')] }), type: 'MOVIE', categories: ['MOVIE'] }),
    await answer('media', { ...media('tmdb:550', { titles: [title('en', 'Till Death Us Do Part')] }), type: 'TV', categories: ['SERIES'] }),
    // the control: two answers that agree
    await answer('media', { ...media('tmdb:551', { titles: [title('en', 'Agreed')] }), type: 'TV', categories: ['SERIES'] }),
    await answer('media', { ...media('tmdb:551', { titles: [title('en', 'Agreed again')] }), type: 'TV', categories: ['SERIES'] }),
    // constant-id: three distinct rows claiming one uri, which is never right (threshold 3). The
    // claimants are JustWatch rows because `hbo:watch` is JustWatch's own constant: `parts[1]` of an
    // HBO series url is the literal string "watch" (`justwatch/id.ts:91-93`), and hbo is one of the
    // origins its offers name natively, so these are `source` claims. A `nf` row claiming another
    // provider is an echo of the asked address and would be `provenance: 'address'` (3.3)
    await answer('media', media('jw:1', { titles: [title('en', 'One')], handles: [sameAs(media('hbo:watch'))] })),
    await answer('media', media('jw:2', { titles: [title('en', 'Two')], handles: [sameAs(media('hbo:watch'))] })),
    await answer('media', media('jw:3', { titles: [title('en', 'Three')], handles: [sameAs(media('hbo:watch'))] })),
    // the control: two claimants is a contest, not a constant
    await answer('media', media('jw:4', { titles: [title('en', 'Four')], handles: [sameAs(media('hbo:pair'))] })),
    await answer('media', media('jw:5', { titles: [title('en', 'Five')], handles: [sameAs(media('hbo:pair'))] })),
    // disagreeing-ids: two anilist ids a weld would put in one component, and a prefix pair that is
    // one id at two precisions and therefore no disagreement at all
    await answer('media', media('anilist:20', { titles: [title('en', 'Twenty')] })),
    await answer('media', media('anilist:21', { titles: [title('en', 'Twenty one')] })),
    await answer('media', media('kitsu:20', { titles: [title('en', 'Twenty')] })),
    await answer('media', media('cr:GSER', { titles: [title('en', 'Series')] })),
    await answer('media', media('cr:GSER-S1', { titles: [title('en', 'Series Season 1')] })),
    // the `offline` origin, whose ids are BORROWED from another catalogue: two of its rows are the
    // same row under two addresses unless they borrow from the SAME catalogue
    await answer('media', media('offline:anilist-30', { titles: [title('en', 'Thirty')] })),
    await answer('media', media('offline:mal-30', { titles: [title('en', 'Thirty')] })),
    await answer('media', media('offline:mal-31', { titles: [title('en', 'Thirty one')] })),
    await answer('media', media('kitsu:30', { titles: [title('en', 'Thirty')] })),
  ])
  resetPassState()
  const pass = await runPlugins([profilePlugin, directPlugin], { reason: 'manual' })
  expect(pass.audit.ok).toBe(true)
})

afterAll(async () => {
  await closeGraph()
})

// `contested`: a target refused to two components under guard 5, both claimants named. Read off the
// DOWNGRADE, which is where the direction lives.
// Mutation: group by the claimant rather than by the target and every contest reports as two
// findings of one claimant each, which names no shared row and cannot be rendered as one badge pair.
test('contested reports the shared row and both of its claimants, and stays silent on one', async () => {
  const { query } = await graphReady()
  const found = await contested(query)

  // the `hbo:watch` fixture below is a contest too, and reports as one: three jw rows whose ids
  // disagree all claim it, which is what makes it a constant as well
  const aot = found.find(anomaly => anomaly.uris[0] === 'mal:51535')
  expect(aot!.uris).toEqual(['mal:51535', 'anilist:10', 'anilist:11'])
  expect(aot!.detail).toContain('anilist:10, anilist:11')
  expect(found.some(anomaly => anomaly.uris.includes('mal:12')), 'the control: one claimant is not a contest').toBe(false)
})

// `kind-disagrees`: one uri whose ANSWERS disagree about MOVIE against SERIES. Read per answer and
// never off the profile, which is silent exactly where the disagreement is (5.4 P0 writes NULL).
// Mutation: read `MediaProfile.format` instead and this reports nothing at all, because the profile
// of a row whose own fields disagree is NULL rather than either value.
test('kind-disagrees reports a uri two answers call different kinds', async () => {
  const { query } = await graphReady()
  const found = await kindDisagrees(query)

  expect(found.map(anomaly => anomaly.uris.join())).toEqual(['tmdb:550'])
  expect(found[0]!.detail).toMatch(/MOVIE|SERIES/)
  expect(found.some(anomaly => anomaly.uris.includes('tmdb:551')), 'the control: two answers that agree').toBe(false)
})

// `constant-id`: one target claimed by three or more distinct CLAIMANTS, counted over claimants and
// never over clusters, because a constant that welded its claimants leaves ONE cluster and a cluster
// count is silent exactly then (f096e7d, a4eea19).
// Mutation: set the threshold to 2 and every ordinary contest reports as a constant, which is the
// distinction 5.5 draws in one sentence ("two claimants is a contest, three is never right").
test('constant-id reports a uri three rows claim, and not the one two rows claim', async () => {
  const { query } = await graphReady()
  const found = await constantId(query)

  expect(found.map(anomaly => anomaly.uris.join())).toEqual(['hbo:watch'])
  expect(found[0]!.detail).toContain('3 distinct rows')
  expect(found.some(anomaly => anomaly.uris.includes('hbo:pair')), 'the control: two claimants').toBe(false)
})

// `disagreeing-ids`: two ids of one origin inside one component that are not one id at two
// precisions, plus the refused links of that reason. The component is written here through
// `acceptEveryPair`, because the guards would never let one be built: the rule has to report a weld
// that a guard missed, so its fixture is exactly what a guard refuses.
// Mutation: drop the `prefixRelated` test and the `cr:GSER` pair below reports, which is one id at
// two precisions and the single most common shape in the store.
test('disagreeing-ids reports a component holding two ids of one origin, and not a prefix pair', async () => {
  await apply({
    ...empty(),
    links: [
      { kind: 'SAME_AS', fromUri: 'anilist:20', toUri: 'kitsu:20', reason: 'test', confidence: 1, supports: [] },
      { kind: 'SAME_AS', fromUri: 'anilist:21', toUri: 'kitsu:20', reason: 'test', confidence: 1, supports: [] },
      { kind: 'SAME_AS', fromUri: 'cr:GSER', toUri: 'cr:GSER-S1', reason: 'test', confidence: 1, supports: [] },
    ],
  })

  const { query } = await graphReady()
  const found = await disagreeingIds(query)
  const components = found.filter(anomaly => anomaly.detail.includes('in one component'))

  expect(components.map(anomaly => anomaly.detail)).toEqual([
    'anilist:20 and anilist:21 are two ids of anilist in one component, and neither extends the other',
  ])
  expect(components.some(anomaly => anomaly.uris.includes('cr:GSER')), 'the control: a prefix pair is precision').toBe(false)

  await retractPlugin(FAKE)
})

// 5.5 reads what 5.2 already decided, and the ORIGIN is where the two drifted apart. `offline` does
// not issue its own ids, so two of its rows disagree only when they borrow from the same catalogue
// (`identitySpaceOf`). Measured on the recorded page 2026-09-14: reading the plain origin here made
// 18 of 21 `disagreeing-ids` offline pairs the guards accept as one row under two addresses, so the
// trace panel reported as a defect the thing the guards had just been taught to allow.
// Mutation: compare the plain origin and the first assertion reports the cross-catalogue pair.
test('disagreeing-ids reads the BORROWED source of an offline id, not the offline origin', async () => {
  await apply({
    ...empty(),
    links: [
      { kind: 'SAME_AS', fromUri: 'offline:anilist-30', toUri: 'kitsu:30', reason: 'test', confidence: 1, supports: [] },
      { kind: 'SAME_AS', fromUri: 'offline:mal-30', toUri: 'kitsu:30', reason: 'test', confidence: 1, supports: [] },
    ],
  })

  const { query } = await graphReady()
  const found = (await disagreeingIds(query)).filter(anomaly => anomaly.detail.includes('in one component'))
  expect(
    found.map(anomaly => anomaly.detail),
    'two addresses of one offline row are not two rows'
  ).toEqual([])

  await retractPlugin(FAKE)

  // THE CONTROL, and without it the case above passes for a rule that reports nothing at all: two
  // offline ids borrowed from the SAME catalogue are still two rows and still disagree.
  await apply({
    ...empty(),
    links: [
      { kind: 'SAME_AS', fromUri: 'offline:mal-30', toUri: 'kitsu:30', reason: 'test', confidence: 1, supports: [] },
      { kind: 'SAME_AS', fromUri: 'offline:mal-31', toUri: 'kitsu:30', reason: 'test', confidence: 1, supports: [] },
    ],
  })
  const sameCatalogue = (await disagreeingIds(query)).filter(anomaly => anomaly.detail.includes('in one component'))
  expect(sameCatalogue.map(anomaly => anomaly.detail)).toEqual([
    'offline:mal-30 and offline:mal-31 are two ids of offline/mal in one component, and neither extends the other',
  ])

  await retractPlugin(FAKE)
})

// THE FOUR INVARIANT QUERIES of 3.5, each FIRED and then cleared. Without the first half, all four
// would pass on an empty `MEMBER_OF` table and this file would report success unconditionally.
// Mutation: point any of the four at a table nothing writes (or add a filter that can never match)
// and the fired half below goes to zero, which is the failure mode the whole case exists to expose.
test('each invariant query counts the violation it is for, and zero once it is gone', async () => {
  const { query } = await graphReady()
  expect((await checkInvariants(query)).ok, 'the graph after a real pass holds all four').toBe(true)

  await apply({
    ...empty(),
    nodes: [{ table: 'Cluster', rows: [{ id: 'c1', scope: 'RUN' }, { id: 'c2', scope: 'RUN' }] }],
    edges: [{
      table: 'MEMBER_OF',
      rows: [
        { from: 'anilist:20', to: 'c1' },
        { from: 'kitsu:20', to: 'c1' },
        // the double membership: one row in two clusters
        { from: 'anilist:21', to: 'c1' },
        { from: 'anilist:21', to: 'c2' },
      ],
    }],
    links: [
      // a containment edge inside one cluster, both kinds
      { kind: 'INCLUDES', fromUri: 'anilist:20', toUri: 'kitsu:20', reason: 'test', confidence: 1, supports: [] },
      { kind: 'PART_OF', fromUri: 'anilist:20', toUri: 'kitsu:20', reason: 'test', confidence: 1, supports: [] },
      // and a SAME_AS across scopes, which only `acceptEveryPair` can write: guard 2 refuses it
      { kind: 'SAME_AS', fromUri: 'anilist:10', toUri: 'cr:GSER', reason: 'test', confidence: 1, supports: [] },
    ],
  })

  // the cross-scope arm needs the two scopes to actually differ, which is a profile fact
  await query('MATCH (p:MediaProfile {uri: $uri}) SET p.scope = $scope', { uri: 'cr:GSER', scope: 'CONTAINER' })

  const fired = await checkInvariants(query)
  expect(fired.counts['includes-inside'], 'an INCLUDES between two members of one cluster').toBe(1)
  expect(fired.counts['part-of-inside'], 'a PART_OF between two members of one cluster').toBe(1)
  expect(fired.counts['cross-scope-link'], 'a SAME_AS whose endpoints have different scopes').toBeGreaterThan(0)
  expect(fired.counts['double-membership'], 'one row in two clusters').toBe(1)
  expect(fired.ok).toBe(false)

  await retractPlugin(FAKE)
  await query('MATCH (p:MediaProfile {uri: $uri}) SET p.scope = $scope', { uri: 'cr:GSER', scope: 'RUN' })
  expect((await checkInvariants(query)).ok, 'and zero once the rows are retracted').toBe(true)
})
