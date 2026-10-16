/**
 * `CLAIMS.provenance`, the column 3.2 puts on the claim edge and 3.3 gives its four values.
 *
 * The one under test here is `address`: a handle rebuilt from the asked uri by `buildHandlesFromUri`
 * names WHICH sources to ask and asserts nothing about how their rows relate (the owner's decision,
 * 2026-09-12). It reaches the ingest two ways, and both are cases below: the handle's own stamp, and
 * the derivation for a claim carrying none, which is every recorded answer and every remote plugin
 * source that never learns to send one.
 *
 * Against the REAL engine, like every other graph suite, because a claim is a column in a statement
 * the binder either takes or refuses. The last case replays the recorded page and reports the table.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../src/worker/graph/answers'

import { closeGraph } from '../../../../src/worker/graph/engine'
import { enableGraph } from '../../../../src/worker/graph'
import { graphReady } from '../../../../src/worker/graph/schema'
import { ingestAnswers, replayAnswers } from '../../../../src/worker/graph/ingest'
import { directPlugin } from '../../../../src/worker/graph/plugins/direct'
import { profilePlugin } from '../../../../src/worker/graph/plugins/profile'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { answer, episode, media, partOf, rowsOf, sameAs, title } from './plugins/fixtures'

const CORPUS = new URL('../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

/** A handle as `buildHandlesFromUri` mints one: the same SAME_AS, carrying the address stamp. */
const stamped = (node: Record<string, unknown>) => ({ ...sameAs(node), provenance: 'address' })

const claimsFrom = async (uri: string) =>
  (await rowsOf(
    `MATCH (a:Media {uri: $uri})-[c:CLAIMS]->(b:Media)
     RETURN b.uri AS toUri, c.kind AS kind, c.claimer AS claimer, c.provenance AS provenance ORDER BY b.uri`,
    { uri }
  )).map(row => `${String(row.toUri)} ${String(row.kind)} ${String(row.provenance)}`)

const episodeClaimsFrom = async (uri: string) =>
  (await rowsOf(
    `MATCH (a:Episode {uri: $uri})-[c:EPISODE_CLAIMS]->(b:Episode)
     RETURN b.uri AS toUri, c.provenance AS provenance ORDER BY b.uri`,
    { uri }
  )).map(row => `${String(row.toUri)} ${String(row.provenance)}`)

/** Every claim in the graph, counted by claimer, target origin, kind and provenance. */
const claimTable = async (): Promise<Map<string, number>> => {
  const table = new Map<string, number>()
  for (const row of await rowsOf(
    `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
     RETURN c.claimer AS claimer, b.origin AS toOrigin, c.kind AS kind, c.provenance AS provenance`
  )) {
    const key = `${String(row.claimer)} -> ${String(row.toOrigin)} ${String(row.kind)} ${String(row.provenance)}`
    table.set(key, (table.get(key) ?? 0) + 1)
  }
  return table
}

/** Every `plugin:direct` link touching a pair, in either direction, as one readable line each. */
const linksBetween = async (a: string, b: string) =>
  (await rowsOf(
    `MATCH (x:Media)-[l:LINK]->(y:Media)
     WHERE l.by = 'plugin:direct' AND ((x.uri = $a AND y.uri = $b) OR (x.uri = $b AND y.uri = $a))
     RETURN x.uri AS fromUri, y.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason
     ORDER BY fromUri, kind`,
    { a, b }
  )).map(row => `${String(row.fromUri)} ${String(row.toUri)} ${String(row.kind)} ${String(row.status)} ${String(row.reason)}`)

beforeAll(async () => {
  await enableGraph(true)
})

afterAll(async () => {
  await closeGraph()
})

// THE DERIVATION, which is the half that reaches recorded data. unogs answers about Netflix and
// publishes no AniList, MAL or Kitsu id anywhere, so a handle of that shape on one of its rows came
// out of the uri it was asked about: `unogs/extractor.ts:518,536` replaces the handle list wholesale
// with `buildHandlesFromUri`'s output. The control is in the same answer twice over, because without
// one this case is indistinguishable from "nf claims nothing": the Netflix SHOW it is part of is the
// same origin and stays `source`, and so does the JustWatch season claiming that Netflix id back.
// Mutation: return 'source' from the `NATIVE_ID_SPACES` branch of `provenanceOf` and the first
// expectation reads `source`. Mutation for the second, which is the table's positive direction:
// drop `'nf'` from `NATIVE_ID_SPACES.jw` and the JustWatch offer reads `address`.
test('an unstamped echo from a source that rebuilds handles is an address claim', async () => {
  await ingestAnswers([
    await answer('media', media('nf:9900700-1', {
      titles: [title('en', 'Echoed season')],
      handles: [sameAs(media('anilist:9900700')), partOf(media('nf:9900700'))],
    })),
    await answer('media', media('jw:9900700-1', {
      titles: [title('en', 'Echoed season')],
      handles: [sameAs(media('nf:9900700-1'))],
    })),
  ])

  expect(await claimsFrom('nf:9900700-1')).toEqual([
    'anilist:9900700 SAME_AS address',
    'nf:9900700 PART_OF source',
  ])
  expect(await claimsFrom('jw:9900700-1'), 'a JustWatch offer IS a Netflix id it read')
    .toEqual(['nf:9900700-1 SAME_AS source'])
})

// `ask` IS NOT A STAMP A SOURCE MAY SET. An ask claim is the app consumer's own statement about an
// answer it accepted, written by `writeAskClaim` with the `Ask` row it belongs to (4.4); a handle
// inside an answer that carries it is a source calling itself the consumer, and there is no reading
// of an answer under which that is true. Only `address` is read off the stamp, because that is the
// one class a source can honestly declare about its own handle.
//
// It matters because the two are not weighed alike everywhere: `plugin:direct` refuses to consume an
// `address` claim at all, so a source that wanted its claim consumed whatever the ingest derived
// would have exactly this to reach for.
//
// Mutation: read `ask` off the stamp in `provenanceOf` (`if (textOf(handle.provenance) === 'ask')
// return 'ask'`) and the first assertion reddens.
test('a handle stamping itself an ask claim is still a source claim', async () => {
  await ingestAnswers([
    await answer('media', media('anizip:9900710', {
      titles: [title('en', 'Claims to be an ask')],
      handles: [{ ...sameAs(media('mal:9900710')), provenance: 'ask' }],
    })),
    await answer('media', media('anizip:9900711', {
      titles: [title('en', 'Stamped an address')], handles: [stamped(media('mal:9900711'))],
    })),
  ])

  expect(await claimsFrom('anizip:9900710')).toEqual(['mal:9900710 SAME_AS source'])
  // the control: the stamp IS read, so the case above is a refusal rather than a stamp nobody reads
  expect(await claimsFrom('anizip:9900711')).toEqual(['mal:9900711 SAME_AS address'])
})

// THE STAMP WINS over the table, which is what makes the table a fallback rather than the rule. The
// claimer here is the strongest case against: ani.zip's whole payload is a mapping onto mal and
// anilist ids (`anizip/extractor.ts:23,28`), so the derivation would call this a source claim, and
// the stamp says it was rebuilt from the address.
// Mutation: drop the `handle.provenance` test in `provenanceOf` and the stamped claim reads `source`.
test('a stamped handle is an address claim even from an origin whose own data names that space', async () => {
  await ingestAnswers([
    await answer('media', media('anizip:9900701', {
      titles: [title('en', 'Stamped')], handles: [stamped(media('mal:9900701'))],
    })),
    await answer('media', media('anizip:9900702', {
      titles: [title('en', 'Unstamped')], handles: [sameAs(media('mal:9900702'))],
    })),
  ])

  expect(await claimsFrom('anizip:9900701')).toEqual(['mal:9900701 SAME_AS address'])
  expect(await claimsFrom('anizip:9900702'), 'the control: the same claim with no stamp')
    .toEqual(['mal:9900702 SAME_AS source'])
})

// A CLAIMER THAT NEVER READS THE ADDRESS KEEPS EVERY CLAIM, which is the gate that makes the
// derivation an inference rather than a guess. Kitsu publishes the mal and anilist ids of a record in
// its `mappings` relationship (`kitsu/extractor.ts:70-71`) and never calls `buildHandlesFromUri`, so
// even a target its own data cannot carry is a mapping path nobody read rather than a rebroadcast.
// `tvmaze` is exactly that target: nothing in kitsu's response names one.
// Mutation: drop the `ADDRESS_ECHOING_ORIGINS` test in `provenanceOf` and the tvmaze claim reads
// `address`.
test('a claimer that never rebuilds from the address keeps its claims, whatever it names', async () => {
  await ingestAnswers([
    await answer('media', media('kitsu:9900703', {
      titles: [title('en', 'Mapped')],
      handles: [sameAs(media('mal:9900703')), sameAs(media('tvmaze:9900703'))],
    })),
  ])

  expect(await claimsFrom('kitsu:9900703')).toEqual([
    'mal:9900703 SAME_AS source',
    'tvmaze:9900703 SAME_AS source',
  ])
})

// AN ORIGIN ABSENT FROM THE TABLE IS TRUSTED, which is every remote plugin source and anything nobody
// read. The fallback can only narrow origins whose extractor was read line by line, and the safe
// direction is the one that keeps a claim.
// Mutation: default the lookup to an empty set (`NATIVE_ID_SPACES[claimer] ?? new Set()`) and, with
// `nyaa` in `ADDRESS_ECHOING_ORIGINS`, every claim an unread source makes reads `address`.
test('an origin nobody read is trusted', async () => {
  await ingestAnswers([
    await answer('media', media('nyaa:9900704', {
      titles: [title('en', 'Remote')], handles: [sameAs(media('anilist:9900704'))],
    })),
  ])

  expect(await claimsFrom('nyaa:9900704')).toEqual(['anilist:9900704 SAME_AS source'])
})

// THE SEED RULE IS READ FIRST and is unchanged: the offline source's identity handles are `seed`, and
// a container handle claims containment rather than identity and stays `source`.
// Mutation: swap the first two rules in `provenanceOf` and the stamped identity below reads
// `address`, taking a seeded row out of the closure. The second stamped handle is there for exactly
// that: the offline source stamps none of its handles, so nothing else would fix the order.
test('the seed keeps its own provenance, before either address rule', async () => {
  await ingestAnswers([
    await answer('media', media('offline:9900705', {
      titles: [title('en', 'Seeded')],
      handles: [sameAs(media('mal:9900705')), stamped(media('nf:9900705-1')), partOf(media('cr:9900705'))],
    })),
  ])

  expect(await claimsFrom('offline:9900705')).toEqual([
    'cr:9900705 PART_OF source',
    'mal:9900705 SAME_AS seed',
    'nf:9900705-1 SAME_AS seed',
  ])
})

// AN EPISODE CLAIM IS UNTOUCHED, which is a decision rather than an oversight. `buildHandlesFromUri`
// mints MEDIA handles only, so no episode handle can carry the stamp, and `NATIVE_ID_SPACES` is about
// which media id spaces a source republishes, which says nothing about whose episode rows it names.
// This case is what makes that visible: the same claimer and the same target origins that read
// `address` above read `source` on an episode.
// Mutation: call `provenanceOf` from `visitEpisode` instead of `episodeProvenanceOf` and the first
// line reads `address`.
test('an episode claim keeps the seed rule only, whatever the origins are', async () => {
  await ingestAnswers([
    await answer('media', media('nf:9900706-1', {
      titles: [title('en', 'With episodes')],
      episodes: [
        episode('nf:9900706-1-e1', 'nf:9900706-1', {
          episodeNumber: 1,
          handles: [sameAs(episode('anizip:9900706-e1', 'anizip:9900706'))],
        }),
      ],
    })),
  ])

  expect(await episodeClaimsFrom('nf:9900706-1-e1')).toEqual(['anizip:9900706-e1 source'])
})

// END TO END, through the two plugins that read the column: `plugin:profile` gives both endpoints an
// effective scope and `plugin:direct` consumes the claim. An echoed Netflix SAME_AS writes NO link at
// all, not a refused one, because the address asserts nothing to refuse (5.2 guard 3 and `direct.ts`'s
// table row); the row stays in the graph and still renders as a badge (6.2). The kitsu claim beside it
// is the control: same shape, same scopes, one link.
// Mutation: return 'source' from the `NATIVE_ID_SPACES` branch of `provenanceOf` and the Netflix pair
// gains an active SAME_AS, which is the weld this whole change exists to stop.
test('an echoed Netflix claim yields no link, and a kitsu claim beside it yields one', async () => {
  await ingestAnswers([
    await answer('media', media('anilist:9900710', {
      score: 0.8, type: 'TV', episodeCount: 12, startDate: '2026-07-14', titles: [title('en', 'End to end')],
    })),
    await answer('media', media('nf:9900710-1', {
      score: 0.2, type: 'TV', episodeCount: 12, titles: [title('en', 'End to end')],
      handles: [sameAs(media('anilist:9900710'))],
    })),
    await answer('media', media('kitsu:9900710', {
      score: 0.3, type: 'TV', episodeCount: 12, titles: [title('en', 'End to end')],
      handles: [sameAs(media('anilist:9900710'))],
    })),
  ])

  resetPassState()
  const report = await runPlugins([profilePlugin, directPlugin], { reason: 'manual' })
  expect(report.anomalies.filter(anomaly => anomaly.rule === 'plugin-failed')).toEqual([])

  expect(await linksBetween('nf:9900710-1', 'anilist:9900710'), 'a pointer proposes nothing').toEqual([])
  expect(await linksBetween('kitsu:9900710', 'anilist:9900710'))
    .toEqual(['kitsu:9900710 anilist:9900710 SAME_AS active asserted'])
  expect(
    (await rowsOf('MATCH (m:Media {uri: $uri}) RETURN m.uri AS uri', { uri: 'nf:9900710-1' })).length,
    'the row is still there to render'
  ).toBe(1)
})

// THE MEASUREMENT, on the 800 recorded rows the sibling suites replay: what the rule actually does to
// data nobody wrote for it. Skipped when the recording is absent, since raw source data never enters
// git (`npm run corpus:walk` records one).
test('the recorded page: every Netflix and Crunchyroll echo is an address claim', async () => {
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

  // the cases above are already in the graph, so the table is reported as a DELTA: a total would read
  // as the corpus's and be wrong by whatever this file ingested first
  const baseline = await claimTable()

  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])

  const claims = (await rowsOf(
    `MATCH (a:Media)-[c:CLAIMS]->(b:Media)
     RETURN c.claimer AS claimer, b.origin AS toOrigin, c.kind AS kind, c.provenance AS provenance`
  )).map(row => ({
    claimer: String(row.claimer), toOrigin: String(row.toOrigin),
    kind: String(row.kind), provenance: String(row.provenance),
  }))

  // the metadata origins a streaming catalogue can only be echoing: none of the four publishes one
  const METADATA = new Set(['anilist', 'kitsu', 'mal', 'anizip', 'offline'])
  const leaked = claims.filter(claim =>
    ['nf', 'cr'].includes(claim.claimer) && claim.kind === 'SAME_AS'
    && METADATA.has(claim.toOrigin) && claim.provenance !== 'address')
  expect(leaked, 'every Netflix and Crunchyroll SAME_AS into a metadata id space is a pointer').toEqual([])

  const echoed = claims.filter(claim =>
    ['nf', 'cr'].includes(claim.claimer) && METADATA.has(claim.toOrigin) && claim.provenance === 'address')
  expect(echoed.length, 'and there are real ones to find, or this case proves nothing').toBeGreaterThan(0)

  const kitsuMal = claims.filter(claim => claim.claimer === 'kitsu' && claim.toOrigin === 'mal')
  expect(kitsuMal.length, 'kitsu publishes mal ids in its own mappings').toBeGreaterThan(0)
  expect(kitsuMal.filter(claim => claim.provenance !== 'source'), 'and every one of them is consumed').toEqual([])

  const table = await claimTable()
  console.info('claims by claimer, target origin and provenance over 800 corpus rows:')
  for (const [key, total] of [...table].map(([key, total]) => [key, total - (baseline.get(key) ?? 0)] as const)
    .filter(([, total]) => total > 0).sort((a, b) => b[1] - a[1])) {
    console.info(`  ${String(total).padStart(5)} ${key}`)
  }
})
