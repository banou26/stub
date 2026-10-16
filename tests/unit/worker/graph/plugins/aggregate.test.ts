/**
 * `plugin:aggregate` of 5.4 P5: membership, the carried ids, the run length, the slots and the JSON a
 * read looks up.
 *
 * WHAT EACH CASE IS FOR. The plugin's whole job is to turn edges into one materialized answer, so the
 * cases are the five things that answer promises: the closure is the membership (3.5), an id is
 * minted once and carried, the length is a vote with classes before tiers, a slot holds one broadcast
 * episode of THIS run, and every field of the view names the member it came from.
 *
 * Two of the rules are tested twice, as pure functions and through the graph. `carryIds` and
 * `trimsRow` decide what nothing in the graph can show once they have decided it: a cluster that kept
 * its id looks exactly like one that was minted with that id, and a trimmed row looks exactly like a
 * row that was never there. The pure case names the rule and the graph case proves it is wired.
 */
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { Episode, Media } from '../../../../../src/worker/store/types'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import {
  aggregatePlugin, alignedFillsOf, carryIds, containerMayMintSlots, runLengthOf, trimsRow,
} from '../../../../../src/worker/graph/plugins/aggregate'
import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'
import { clearReadCache, resolveMedia } from '../../../../../src/worker/graph/read'
import { resolvers as annResolvers } from '../../../../../src/sources/ann/extractor'
import { checkInvariants } from '../../../../../src/worker/graph/plugins/invariants'
import { runEpisodes, runLength } from '../../../../../src/worker/store/consensus'
import { answer, episode, media, rowsOf, title } from './fixtures'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })
const partOf = (node: Record<string, unknown>) => ({ relation: 'PART_OF', node })

const runPass = async (plugins = [profilePlugin, directPlugin, aggregatePlugin]) => {
  const report = await runPlugins(plugins, { reason: 'manual' })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
  return report
}

/** Every cluster as `MEMBER_OF` holds it: the materialized membership, and nothing else. */
const membership = async (): Promise<Map<string, string[]>> => {
  const rows = await rowsOf(
    'MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id, m.uri AS uri ORDER BY id, uri'
  )
  const clusters = new Map<string, string[]>()
  for (const row of rows) clusters.set(String(row.id), [...clusters.get(String(row.id)) ?? [], String(row.uri)])
  return clusters
}

const clusterOf = async (uri: string) => {
  const [row] = await rowsOf(
    `MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)
     RETURN c.id AS id, c.key AS key, c.scope AS scope, c.aggUri AS aggUri, c.published AS published,
       c.aliases AS aliases, c.hidden AS hidden, c.runLength AS runLength, c.runLengthTier AS tier,
       c.runLengthWitnesses AS witnesses, c.runLengthFrom AS from, c.card AS card, c.media AS media,
       c.episodes AS episodes, c.anomalies AS anomalies, c.anomalyCount AS anomalyCount`,
    { uri }
  )
  return row
}

/** The slots of one uri's cluster, with what fills each, in the order the episode list is written. */
const slotsOf = async (uri: string) => {
  const rows = await rowsOf(
    `MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster)<-[:SLOT_OF]-(s:Slot)
     OPTIONAL MATCH (e:Episode)-[f:FILLS]->(s)
     RETURN s.id AS id, s.number AS number, e.uri AS episode, f.number AS fills, f.via AS via
     ORDER BY id, episode`,
    { uri }
  )
  const slots = new Map<string, { id: string, number: number | null, fills: string[], via: string[] }>()
  for (const row of rows) {
    const id = String(row.id)
    const slot = slots.get(id) ?? { id, number: row.number === null ? null : Number(row.number), fills: [], via: [] }
    if (row.episode !== null && row.episode !== undefined) {
      slot.fills.push(String(row.episode))
      slot.via.push(String(row.via))
    }
    slots.set(id, slot)
  }
  return [...slots.values()].sort((a, b) =>
    (a.number === null ? 1 : 0) - (b.number === null ? 1 : 0) || (a.number ?? 0) - (b.number ?? 0) || (a.id < b.id ? -1 : 1))
}

const json = (value: unknown): Record<string, unknown> => JSON.parse(String(value)) as Record<string, unknown>

const provenanceOf = (media: Record<string, unknown>, field: string) =>
  (media.provenance as { field: string }[]).filter(entry => entry.field === field)

/**
 * The closure of 3.5 as an INDEPENDENT breadth-first search over the same sorted edge list, which is
 * the check 5.4 P5 asks the harness for: the plugin's union-find is one implementation and a test
 * that re-used it would be asserting a function against itself.
 */
const closureBySearch = async (): Promise<Map<string, string[]>> => {
  const edges = await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.kind = 'SAME_AS' AND l.status = 'active'
     RETURN a.uri AS fromUri, b.uri AS toUri ORDER BY fromUri, toUri`
  )
  const neighbours = new Map<string, string[]>()
  for (const edge of edges) {
    const from = String(edge.fromUri)
    const to = String(edge.toUri)
    neighbours.set(from, [...neighbours.get(from) ?? [], to])
    neighbours.set(to, [...neighbours.get(to) ?? [], from])
  }
  const closure = new Map<string, string[]>()
  for (const start of neighbours.keys()) {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length) {
      const next = queue.shift()!
      for (const neighbour of neighbours.get(next) ?? []) {
        if (seen.has(neighbour)) continue
        seen.add(neighbour)
        queue.push(neighbour)
      }
    }
    closure.set(start, [...seen].sort())
  }
  return closure
}

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    // A. THE CLOSURE: a chain of three, which no single claim joins, plus a row nothing names
    await answer('media', media('anilist:100', {
      score: 0.8, type: 'TV', categories: ['ANIME', 'SERIES'], titles: [title('en', 'Chain')],
      handles: [sameAs(media('kitsu:100', { score: 0.3 }))],
    })),
    await answer('media', media('kitsu:100', {
      score: 0.3, type: 'TV', titles: [title('en', 'Chain')],
      handles: [sameAs(media('mal:100', { score: 0.9 }))],
    })),
    await answer('media', media('mal:100', { score: 0.9, type: 'TV', titles: [title('en', 'Chain')] })),
    await answer('media', media('anilist:101', { score: 0.8, type: 'TV', titles: [title('en', 'Alone')] })),

    // B. THE RUN LENGTH of 5.4 P5's own example: anilist(0.8)=13 anizip(null)=12 kitsu(0.3)=22 mal(0.9)=12
    // the season pair sits on the LOWER-scored member on purpose: merged field by field the cluster
    // would carry SUMMER with mal's 2025, which is a pair no source ever claimed (`aggregate.ts:34-53`)
    await answer('media', media('mal:200', {
      score: 0.9, type: 'TV', episodeCount: 12, seasonYear: 2025,
      titles: [title('en', 'Counted')],
      handles: [
        sameAs(media('anilist:200', { score: 0.8 })),
        sameAs(media('anizip:200', {})),
        sameAs(media('kitsu:200', { score: 0.3 })),
      ],
    })),
    await answer('media', media('anilist:200', {
      score: 0.8, type: 'TV', episodeCount: 13, popularity: 200, status: 'FINISHED',
      season: 'SUMMER', seasonYear: 2026, titles: [title('en', 'Counted')],
    })),
    await answer('media', media('anizip:200', { type: 'TV', episodeCount: 12, titles: [title('en', 'Counted')] })),
    await answer('media', media('kitsu:200', { score: 0.3, type: 'TV', episodeCount: 22, popularity: 100, titles: [title('en', 'Counted')] })),

    // C. A DECLARED count against three list lengths, every one of them in the SAME score tier
    await answer('media', media('mal:500', {
      score: 0.9, type: 'TV', episodeCount: 12, titles: [title('en', 'Classed')],
      handles: [
        sameAs(media('tmdb:500', { score: 0.9 })),
        sameAs(media('tvmaze:500', { score: 0.9 })),
        sameAs(media('appletv:500', { score: 0.9 })),
      ],
    })),
    await answer('media', media('tmdb:500', { score: 0.9, type: 'TV', episodeCount: 24, titles: [title('en', 'Classed')] })),
    await answer('media', media('tvmaze:500', { score: 0.9, type: 'TV', episodeCount: 24, titles: [title('en', 'Classed')] })),
    await answer('media', media('appletv:500', { score: 0.9, type: 'TV', episodeCount: 24, titles: [title('en', 'Classed')] })),

    // D. THE SLOTS: two metadata sources over one run, and an unnumbered special beside them
    await answer('media', media('anilist:300', {
      score: 0.8, type: 'TV', episodeCount: 2, titles: [title('en', 'Listed')],
      handles: [sameAs(media('kitsu:300', { score: 0.3 })), sameAs(media('anizip:300', {}))],
      episodes: [
        episode('anilist:300-1', 'anilist:300', { episodeNumber: 1, titles: [title('en', 'One')] }),
        episode('anilist:300-2', 'anilist:300', { episodeNumber: 2, titles: [title('en', 'Two')] }),
      ],
    })),
    await answer('media', media('kitsu:300', {
      score: 0.3, type: 'TV', episodeCount: 2, titles: [title('en', 'Listed')],
      episodes: [
        episode('kitsu:300-1', 'kitsu:300', { episodeNumber: 1, titles: [title('en', 'One')] }),
        episode('kitsu:300-2', 'kitsu:300', { episodeNumber: 2, titles: [title('en', 'Two')] }),
      ],
    })),
    await answer('media', media('anizip:300', {
      type: 'TV', episodeCount: 2, titles: [title('en', 'Listed')],
      episodes: [
        episode('anizip:300-1', 'anizip:300', { episodeNumber: 1, titles: [title('en', 'One')] }),
        // anizip's own map key for a special, which carries no episode number at all (5.4 P0)
        episode('anizip:300-S1', 'anizip:300', { titles: [title('en', 'Special')] }),
      ],
    })),

    // E. THE TRIM: two witnesses at 12 against a lower-tier member that packages 24
    await answer('media', media('mal:400', {
      score: 0.9, type: 'TV', episodeCount: 12, titles: [title('en', 'Trimmed')],
      handles: [sameAs(media('kitsu:400', { score: 0.3 })), sameAs(media('tmdb:400', { score: 0.4 }))],
      episodes: [episode('mal:400-12', 'mal:400', { episodeNumber: 12, titles: [title('en', 'Twelve')] })],
    })),
    await answer('media', media('kitsu:400', { score: 0.3, type: 'TV', episodeCount: 12, titles: [title('en', 'Trimmed')] })),
    await answer('media', media('tmdb:400', {
      score: 0.4, type: 'TV', episodeCount: 24, titles: [title('en', 'Trimmed')],
      episodes: [
        episode('tmdb:400-12', 'tmdb:400', { episodeNumber: 12, titles: [title('en', 'Twelve')] }),
        episode('tmdb:400-13', 'tmdb:400', { episodeNumber: 13, titles: [title('en', 'Thirteen')] }),
      ],
    })),

    // F. A PLACEHOLDER nobody answered about, reached by a PART_OF: a cluster that is never a card.
    // TWO MEMBERS REACH IT, which is one hop of `PART_OF` arriving as two LINK rows: the handle list
    // drew the same badge twice until `dedupeRelated` (measured on `ag:(anilist:108465)`, whose graph
    // arm listed `PART_OF:jw:222366` twice, 2026-09-12)
    await answer('media', media('anilist:600', {
      score: 0.8, type: 'TV', titles: [title('en', 'Attached')],
      handles: [
        sameAs(media('kitsu:600', { score: 0.3 })),
        partOf({ uri: 'tvdb:55', origin: 'tvdb', id: '55', scope: 'CONTAINER', url: 'https://thetvdb.com/series/55' }),
      ],
    })),
    await answer('media', media('kitsu:600', {
      score: 0.3, type: 'TV', titles: [title('en', 'Attached')],
      handles: [partOf({ uri: 'tvdb:55', origin: 'tvdb', id: '55', scope: 'CONTAINER', url: 'https://thetvdb.com/series/55' })],
    })),

    // J. A MEMBER NOBODY DESCRIBED: AniList names the MyAnimeList id with its url, and MyAnimeList
    // never answers (api.jikan.moe timing out, 2026-10-12)
    await answer('media', media('anilist:950', {
      score: 0.8, type: 'TV', titles: [title('en', 'Named')],
      handles: [sameAs(media('mal:950', { url: 'https://myanimelist.net/anime/950' }))],
    })),

    // G. TWO IDS OF ONE ORIGIN that extend nothing: the refusal `disagreeing-ids` reports (5.5)
    await answer('media', media('nf:70000-1', {
      score: 0.2, type: 'TV', titles: [title('en', 'Netflix one')],
      handles: [sameAs(media('nf:80000-1', { score: 0.2 }))],
    })),
    await answer('media', media('nf:80000-1', { score: 0.2, type: 'TV', titles: [title('en', 'Netflix two')] })),

    // I. THE FENCE ON `own` (5.4 P5): a foreign claimer hangs ITS OWN episode on a member's uri,
    // which is the transitional lend of 4.4. The claimer is the answering origin, so Crunchyroll's
    // answer carrying a row addressed to the AniList uri is exactly that shape
    await answer('media', media('anilist:800', {
      score: 0.8, type: 'TV', episodeCount: 2, titles: [title('en', 'Lent')],
      episodes: [
        episode('anilist:800-1', 'anilist:800', { episodeNumber: 1, titles: [title('en', 'One')] }),
        episode('anilist:800-2', 'anilist:800', { episodeNumber: 2, titles: [title('en', 'Two')] }),
      ],
    })),
    await answer('media', media('cr:800', {
      score: 0.5, type: 'TV', titles: [title('en', 'Lent on 800')],
      episodes: [episode('cr:800-1', 'anilist:800', { episodeNumber: 1, titles: [title('en', 'Stream One')] })],
    })),

    // H. THE CARRY: two clusters that a later answer merges, and a later pass splits again
    await answer('media', media('anilist:700', {
      score: 0.8, type: 'TV', titles: [title('en', 'Carried')],
      handles: [sameAs(media('kitsu:700', { score: 0.3 }))],
    })),
    await answer('media', media('kitsu:700', { score: 0.3, type: 'TV', titles: [title('en', 'Carried')] })),
    await answer('media', media('mal:700', { score: 0.9, type: 'TV', titles: [title('en', 'Carried')] })),
  ])
  resetPassState()
  await runPass()
}, 120_000)

afterAll(async () => {
  await closeGraph()
})

// MEMBERSHIP IS THE CLOSURE (3.5), which is the one promise every other answer here rests on: a
// cluster that is not the closure is a page holding somebody else's data whatever the fields say.
// Mutation: union on `PART_OF` as well as `SAME_AS` in `readComponents` and `anilist:600` joins
// `tvdb:55`; drop the singleton branch and every row nothing links falls out of the membership.
test('every cluster is exactly the closure over active SAME_AS, both directions', async () => {
  const clusters = await membership()
  const search = await closureBySearch()
  const holding = new Map<string, string[]>()
  for (const members of clusters.values()) for (const uri of members) holding.set(uri, members)

  expect(holding.get('anilist:100'), 'a chain of three claims is one cluster').toEqual(['anilist:100', 'kitsu:100', 'mal:100'])
  expect(holding.get('anilist:101'), 'a row nothing names is a cluster of one').toEqual(['anilist:101'])

  // every uri the edge list touches, against the independent search
  for (const [uri, members] of search) expect(holding.get(uri), `the closure of ${uri}`).toEqual(members)

  // and the Cypher recursion of 3.5 as the spot check, one walk per uri on a small fixture
  const recursion = await rowsOf(
    `UNWIND $uris AS u
     MATCH (a:Media {uri: u})-[e:LINK*0..8 (r, _ | WHERE r.kind = 'SAME_AS' AND r.status = 'active')]-(b:Media)
     RETURN DISTINCT u AS uri, b.uri AS member ORDER BY uri, member`,
    { uris: [...holding.keys()] }
  )
  const walked = new Map<string, string[]>()
  for (const row of recursion) {
    walked.set(String(row.uri), [...walked.get(String(row.uri)) ?? [], String(row.member)])
  }
  for (const [uri, members] of walked) expect(holding.get(uri), `the recursion of ${uri}`).toEqual(members)
  expect(walked.size, 'every clustered uri was walked').toBe(holding.size)
})

// THE LENGTH IS A VOTE WITH THE CLASSES READ FIRST (5.4 P5). 5.4 P5's own example, and the witnesses
// are the column's own definition: every member whose count equals the chosen value AT ANY TIER,
// which is today's `backing` (`consensus.ts:171`) and the number the trimming bar reads.
// Mutation: drop the class split in `runLengthOf` and kitsu's 22 enters the vote; take the tier's
// members as the witnesses instead of `backing` and the count falls to mal alone, which silently
// disables every trim (the bar is two).
test('the run length reads classes before tiers: 12, tier 0.9, witnessed by mal and anizip', async () => {
  const cluster = await clusterOf('mal:200')
  expect(Number(cluster!.runLength)).toBe(12)
  expect(Number(cluster!.tier)).toBe(0.9)
  expect(cluster!.from).toEqual(['anizip:200', 'mal:200'])
  expect(Number(cluster!.witnesses)).toBe(2)
})

// THE CLASS RULE ON ITS OWN, with the tier held constant so only the class can decide: one declared
// 12 against three list lengths of 24, all four at 0.9.
// Mutation: read the tier without the class and the answer is 24, because three of them agree.
test('a declared count beats any number of listLength counts in the same tier', async () => {
  const cluster = await clusterOf('mal:500')
  expect(Number(cluster!.runLength), 'mal declares 12; tmdb, tvmaze and appletv counted a list').toBe(12)
  expect(cluster!.from).toEqual(['mal:500'])
})

// THE PORT. `tieredConsensus` is imported verbatim, and `runLengthOf` is the class-aware wrapper 5.4
// P5 puts around it, so on a SINGLE-CLASS cluster the two must answer identically or the wrapper has
// changed the rule it was supposed to carry over.
// Mutation: hand the claims over without their scores and the wrapper loses the tier, so the last
// row answers 22 (two catalogues agreeing) where `consensus.ts` answers 12 (the best score present).
test('on one class the wrapper answers exactly what consensus.runLength answers', () => {
  const cases: { members: { origin: string, score: number | null, count: number | null }[] }[] = [
    { members: [{ origin: 'mal', score: 0.9, count: 11 }, { origin: 'anilist', score: 0.8, count: 11 }] },
    { members: [{ origin: 'mal', score: 0.9, count: 14 }, { origin: 'anilist', score: 0.8, count: 14 }, { origin: 'anizip', score: null, count: 11 }] },
    { members: [{ origin: 'mal', score: 0.9, count: 12 }, { origin: 'anilist', score: 0.9, count: 13 }] },
    { members: [{ origin: 'mal', score: 0.9, count: null }, { origin: 'anilist', score: 0.8, count: 13 }] },
    // the row the TIER decides and a majority would not: two low-scored catalogues agreeing on 22
    // against one 0.9 saying 12, which is `consensus.ts:12-14`'s "nothing below the tier is consulted"
    { members: [{ origin: 'mal', score: 0.9, count: 12 }, { origin: 'kitsu', score: 0.3, count: 22 }, { origin: 'anilist', score: 0.3, count: 22 }] },
  ]
  for (const { members } of cases) {
    const mine = runLengthOf(members.map((member, index) => ({
      uri: `${member.origin}:${index}`,
      origin: member.origin,
      id: String(index),
      owned: true,
      score: member.score,
      raw: {},
      fieldSeq: {},
      scope: 'RUN' as const,
      countKind: member.count === null ? 'none' : 'declared',
      countStated: member.count,
      countDistinct: null,
    })))
    const theirs = runLength(members.map(member => ({ episodeCount: member.count, score: member.score })) as Media[])
    expect(mine?.length ?? null, JSON.stringify(members)).toBe(theirs ?? null)
  }
})

// TWO METADATA SOURCES OVER ONE RUN ARE ONE LIST, which is `mergeByEpisodeNumber`'s rule with its
// input fenced to one cluster (`db.ts:465-468`), and the unnumbered row gets its own slot listed
// last, so a special can never collide with episode 1 (5.4 P5).
// Mutation: key a slot on the episode uri instead of the number and the run draws five rows for two
// episodes; give the special `number = 0` and it sorts before episode 1 and takes a numbered slot.
test('two sources over one run give one list, and a special takes no numbered slot', async () => {
  const slots = await slotsOf('anilist:300')
  expect(slots.map(slot => slot.number), 'two numbered slots, then the special, last').toEqual([1, 2, null])
  expect(slots[0]!.fills).toEqual(['anilist:300-1', 'anizip:300-1', 'kitsu:300-1'])
  expect(slots[1]!.fills).toEqual(['anilist:300-2', 'kitsu:300-2'])
  expect(slots[2]!.id, 'the special is keyed on its own lowest uri').toMatch(/#s:anizip:300-S1$/)
  expect(slots[2]!.fills).toEqual(['anizip:300-S1'])
  expect(new Set(slots.flatMap(slot => slot.via)), 'a member hung every one of them').toEqual(new Set(['member']))

  // and the materialized list is the slots in that order, which is what the episode read returns
  const cluster = await clusterOf('anilist:300')
  const episodes = JSON.parse(String(cluster!.episodes)) as Record<string, unknown>[]
  expect(episodes.map(row => row.episodeNumber)).toEqual([1, 2, null])
  expect(episodes[0]!.mediaUri, 'every row links back to the cluster, never to its own uri').toBe(cluster!.aggUri)
  expect((episodes[0]!.handles as unknown[]).length, 'three rows are one episode').toBe(3)
})

// A MEMBER'S EPISODES ARE THE ONES ITS OWN ORIGIN HUNG (5.4 P5's fence). A season that contains this
// run, and a lend, both arrive as `HAS_EPISODE` rows on a member's uri, and neither is this run's
// numbering: the row stays in the graph as evidence and reaches a slot only through a proven pair.
// Mutation: drop `WHERE h.claimer = m.origin` from `readEpisodes` and `cr:800-1` joins slot 1 with no
// pair behind it, which is a play button placed by a number, the loan 5.4 P5 exists to refuse.
test('a HAS_EPISODE row a foreign claimer hung on a member never reaches its slots', async () => {
  const slots = await slotsOf('anilist:800')
  expect(slots.map(slot => slot.number)).toEqual([1, 2])
  expect(slots[0]!.fills, "the member's own row, and only it").toEqual(['anilist:800-1'])

  const [lent] = await rowsOf(
    `MATCH (m:Media {uri: 'anilist:800'})-[h:HAS_EPISODE]->(e:Episode {uri: 'cr:800-1'})
     OPTIONAL MATCH (e)-[f:FILLS]->(s:Slot)
     RETURN h.claimer AS claimer, count(f) AS fills`
  )
  expect(lent!.claimer, 'the row is hung on the member, by Crunchyroll').toBe('cr')
  expect(Number(lent!.fills), 'and it fills nothing at all').toBe(0)
})

// THE ALIGNED FILL AS A RULE (5.4 P5), which the graph cannot show once it has decided: a row placed
// by a pair looks exactly like a row that was never offered. Every bar is here with the control that
// must still fill, and the window bar is the one the graph cannot reach at all, since `plugin:range`
// drops an out-of-window pair before it is ever written.
// Mutation: drop the `runLength` test and the row at 12 lands on an eleven episode run; drop the
// `slot.filled.includes` test and a lent season ADDS a row no member lists; drop the `own` test and a
// member's own row is drawn twice, once by each rule.
test('an aligned fill needs a pair, the window, and a slot a member already fills', () => {
  const slots = [
    { id: 'cl:x#1', number: 1, filled: ['anizip:x-1'] },
    { id: 'cl:x#12', number: 12, filled: ['anizip:x-12'] },
    { id: 'cl:x#s:anizip:x-S1', number: null, filled: ['anizip:x-S1'] },
  ]
  const pair = (uri: string, toUri: string, toNumber: number | null) =>
    ({ uri, toUri, toNumber, supports: [`h:${uri}`, `l:${uri}`] })
  const fills = (pairs: ReturnType<typeof pair>[], runLength: number | null = 12, own = new Set<string>()) =>
    alignedFillsOf({ slots, runLength, own, pairs })

  expect(fills([pair('cr:x-13', 'anizip:x-1', 1)]), 'the control: a pair onto a filled slot, in the window')
    .toEqual([{ uri: 'cr:x-13', slotId: 'cl:x#1', number: 1, supports: ['h:cr:x-13', 'l:cr:x-13'] }])

  expect(fills([pair('cr:x-24', 'anizip:x-12', 12)], 11), 'the window is the run length, not the slot list').toEqual([])
  expect(fills([pair('cr:x-13', 'anizip:x-1', 1)], null), 'with no length, the slots are the only bound').toHaveLength(1)
  expect(fills([pair('cr:x-13', 'anizip:x-1', null)]), 'a pair with no number places nothing').toEqual([])
  expect(fills([pair('cr:x-13', 'anizip:x-1', 2)]), 'no slot at the pair number').toEqual([])
  expect(fills([pair('cr:x-13', 'cr:x-99', 1)]), 'the slot at that number holds somebody else').toEqual([])
  expect(fills([pair('anizip:x-1', 'anizip:x-1', 1)], 12, new Set(['anizip:x-1'])), 'a member fills by the member rule')
    .toEqual([])

  // two hangs of one row onto one slot is one fill, and the lowest target decides which keys it names
  const twice = fills([pair('cr:x-13', 'anizip:x-1', 1), pair('cr:x-13', 'anizip:x-1', 1)])
  expect(twice).toHaveLength(1)
})

// THE TRIM, through the graph: two witnesses at 12, tmdb at 0.4 in a strictly lower tier than 0.9,
// and the backing weight 1.2 clearing twice 0.4. Its episode 12 still fills the slot it shares, and
// only the row beyond the run's own length is kept out.
// Mutation: window on `<= length` alone and a containing season's rows below 1 stay on the page;
// drop the trim and the 12 episode run draws a thirteenth row only tmdb has.
test('a member row beyond the run length from a lower tier is kept out of the slots', async () => {
  const slots = await slotsOf('mal:400')
  expect(slots.map(slot => slot.number)).toEqual([12])
  expect(slots[0]!.fills, "the rows inside the window are still this run's").toEqual(['mal:400-12', 'tmdb:400-12'])
  const [thirteen] = await rowsOf(
    `MATCH (e:Episode {uri: 'tmdb:400-13'}) OPTIONAL MATCH (e)-[f:FILLS]->(s:Slot) RETURN count(f) AS total`
  )
  expect(Number(thirteen!.total), 'the row stays in the graph and fills nothing').toBe(0)
})

// THE THREE BARS, each with the control that must NOT trim. Every one of them is a measured figure
// from `consensus.ts` and from 5.4 P5, and each is the difference between hiding a packaging and
// hiding episodes that aired.
// Mutation: drop the witness bar and Mushoku season 2 part 1 hides a row on AniList's lone 13; drop
// the tier test and two 0.9 catalogues disagreeing delete each other's episodes; drop the margin and
// anilist's 0.8 thirteenth episode disappears against mal's 0.9.
test('trimming needs two witnesses, a strictly lower tier and twice the weight', () => {
  const run = { length: 12, tier: 0.9, witnesses: 2, from: ['mal:1', 'kitsu:1'] }
  const base = {
    run,
    reference: new Set(['mal', 'kitsu']),
    equals: new Set(['mal']),
    backingWeight: 1.2,
    member: { origin: 'tmdb', score: 0.4 },
    number: 13,
  }
  expect(trimsRow(base), 'the control: every bar cleared').toBe(true)

  expect(trimsRow({ ...base, number: 12 }), 'inside the window').toBe(false)
  expect(trimsRow({ ...base, number: 0 }), 'a window of 1 to length, not a ceiling').toBe(true)
  expect(trimsRow({ ...base, number: null }), 'a special is listed, never hidden').toBe(false)
  expect(trimsRow({ ...base, run: { ...run, witnesses: 1 } }), 'one witness hides nothing').toBe(false)
  expect(trimsRow({ ...base, member: { origin: 'kitsu', score: 0.3 } }), 'a source that agrees about the length').toBe(false)
  expect(trimsRow({ ...base, member: { origin: 'mal', score: 0.9 } }), 'an equal tier is never trimmed').toBe(false)
  expect(trimsRow({ ...base, member: { origin: 'anilist', score: 0.8 } }), 'twice the weight: 1.2 against 1.6').toBe(false)
  expect(
    trimsRow({ ...base, member: { origin: 'cr', score: 0.5 } }),
    "and the record's own case: mal 0.9 plus kitsu 0.3 against Crunchyroll's fold at 0.5"
  ).toBe(true)
  expect(
    trimsRow({ ...base, backingWeight: 0.9, member: { origin: 'cr', score: 0.5 } }),
    'while mal alone at 0.9 does not clear twice 0.5, which the witness bar had already refused'
  ).toBe(false)
})

// THE OTHER PORT. `runEpisodes` is the shipped trim and this one adds the margin of 5.4 P5, so the
// two must agree wherever the margin does not bite, and differ only where it does.
// Mutation: drop the `reference` set and this trims kitsu's thirteenth row, which the shipped rule
// keeps, so the two lists stop matching.
test('the trim answers what runEpisodes answers, except where the margin spares a row', () => {
  const cluster = [
    { uri: 'mal:1', origin: 'mal', score: 0.9, episodeCount: 12 },
    { uri: 'kitsu:1', origin: 'kitsu', score: 0.3, episodeCount: 12 },
    { uri: 'tmdb:1', origin: 'tmdb', score: 0.4, episodeCount: 24 },
  ]
  const episodes = [
    { uri: 'tmdb:1-12', origin: 'tmdb', episodeNumber: 12 },
    { uri: 'tmdb:1-13', origin: 'tmdb', episodeNumber: 13 },
    { uri: 'mal:1-1', origin: 'mal', episodeNumber: 1 },
    // a row beyond the window from a source that AGREES about the length: spared by both rules,
    // because a source describing this run is never the one under suspicion
    { uri: 'kitsu:1-13', origin: 'kitsu', episodeNumber: 13 },
  ]
  const kept = new Set(runEpisodes(cluster as Media[], episodes as Episode[]).map(row => row.uri))
  const run = { length: 12, tier: 0.9, witnesses: 2, from: ['mal:1', 'kitsu:1'] }
  const mine = episodes.filter(row => !trimsRow({
    run,
    reference: new Set(['mal', 'kitsu']),
    equals: new Set(['mal']),
    backingWeight: 1.2,
    member: { origin: row.origin, score: cluster.find(member => member.origin === row.origin)!.score },
    number: row.episodeNumber,
  }))
  expect(mine.map(row => row.uri), 'the same answer as the shipped rule').toEqual([...kept])

  // and the one deliberate difference: `runEpisodes` windows AniList's 0.8 against mal's 0.9, where
  // 5.4 P5's margin spares it, because trimming on 0.1 would hide a thirteenth episode
  const withAniList = [...episodes, { uri: 'anilist:1-13', origin: 'anilist', episodeNumber: 13 }]
  const theirs = runEpisodes(
    [...cluster, { uri: 'anilist:1', origin: 'anilist', score: 0.8, episodeCount: 13 }] as Media[],
    withAniList as Episode[]
  )
  expect(theirs.map(row => row.uri).includes('anilist:1-13'), 'the shipped rule hides it').toBe(false)
  expect(trimsRow({
    run, reference: new Set(['mal', 'kitsu']), equals: new Set(['mal']), backingWeight: 1.2,
    member: { origin: 'anilist', score: 0.8 }, number: 13,
  }), 'and 5.4 P5 does not').toBe(false)
})

// A CONTAINER MINTS NO SLOTS, with the one fence 5.4 P5 keeps open: its own episodes all in one
// season and none without one (`db.ts:319-323`, the live-action page that lost every episode).
// Mutation: drop the `some(seasonNumber === null)` test and paramount's flat list mints the longest
// season's rows for every season.
test('a container mints slots only when its own episodes are all one season', () => {
  expect(containerMayMintSlots([{ seasonNumber: 1 }, { seasonNumber: 1 }]), 'a single-season tvdb show').toBe(true)
  expect(containerMayMintSlots([{ seasonNumber: 1 }, { seasonNumber: 2 }]), 'paramount, flattened').toBe(false)
  expect(containerMayMintSlots([{ seasonNumber: 1 }, { seasonNumber: null }]), 'and one row that names none').toBe(false)
  expect(containerMayMintSlots([{ seasonNumber: null }, { seasonNumber: null }]), 'a list nobody numbered is not one season').toBe(false)
  expect(containerMayMintSlots([]), 'a container with no list at all').toBe(false)
})

// A PLACEHOLDER CLUSTER IS NEVER A CARD (5.4 P5), and it exists at all so that `ATTACHED_TO` can
// reach a `PART_OF`-only container and its badge can render from the best claimer's `node.url` (6.3).
// Mutation: skip unowned rows when grouping and the badge has no row to render from; write a card
// for it and a container nobody described appears in the listing.
test('a placeholder is a cluster of one, with no card, and its url comes from the claim', async () => {
  const cluster = await clusterOf('tvdb:55')
  expect(cluster!.card, 'never a card').toBe(null)
  expect(cluster!.scope, 'every id of a show-level origin names a container (5.4 P0)').toBe('CONTAINER')
  expect(cluster!.hidden).toBe(true)
  expect(json(cluster!.media)._id, 'it still has a view, which is what a requested uri renders').toBe(cluster!.id)

  const holder = json((await clusterOf('anilist:600'))!.media)
  const handles = holder.handles as { relation: string, via: string, node: Record<string, unknown> }[]
  const badge = handles.find(handle => handle.node.uri === 'tvdb:55')
  expect(badge!.relation).toBe('PART_OF')
  expect(badge!.node.url, 'the claimer described it, and that is where the url is').toBe('https://thetvdb.com/series/55')
})

// A MEMBER NOBODY DESCRIBED LINKS THROUGH ITS CLAIM, the same rule as a container's badge (6.3). On
// `ag:(anilist:114745,...,mal:41084,...)` the title drew MyAnimeList as a dead icon while jikan was
// not answering, because the url AniList gave it never left the claim.
// Mutation: read the claimed urls for containers only and the MyAnimeList handle carries no url.
test('a member nobody described carries the url its claimer gave it, on the view and the card', async () => {
  const cluster = (await clusterOf('anilist:950'))!
  const handles = json(cluster.media).handles as { relation: string, via: string, node: Record<string, unknown> }[]
  const mal = handles.find(handle => handle.node.uri === 'mal:950')
  expect(mal, 'a member of the cluster, though nobody answered for it').toMatchObject({ relation: 'SAME_AS', via: 'placeholder' })
  expect(mal!.node.url).toBe('https://myanimelist.net/anime/950')

  const card = json(cluster.card).handles as { node: Record<string, unknown> }[]
  expect(card.find(handle => handle.node.uri === 'mal:950')!.node.url).toBe('https://myanimelist.net/anime/950')
})

// ONE BADGE PER RELATION AND TARGET (6.3), which the narrative axis already did and this side did
// not: one hop of `PART_OF` reaches a container once per LINK, and a link is keyed on (from, to,
// kind, by), so two members claiming one show are two rows of the same badge.
// Mutation: hand `options.related` to the handle map instead of `dedupeRelated(options.related)` in
// plugins/fields.ts and `tvdb:55` is listed twice, on the card as well as on the view.
test('two members reaching one container draw ONE badge, not one per link', async () => {
  const cluster = (await clusterOf('anilist:600'))!
  const members = json(cluster.card).members as string[]
  expect(members, 'both members claim tvdb:55, which is what makes this two links').toEqual(['anilist:600', 'kitsu:600'])

  const handles = json(cluster.media).handles as { relation: string, node: Record<string, unknown> }[]
  expect(
    handles.filter(handle => handle.node.uri === 'tvdb:55').length,
    'one hop, one badge, however many links proved it'
  ).toBe(1)
  const cardHandles = json(cluster.card).handles as { relation: string, node: Record<string, unknown> }[]
  expect(cardHandles.filter(handle => handle.node.uri === 'tvdb:55').length, 'and the card reads off the view').toBe(1)
})

// THE FIELD POLICY OF 6.3: the season PAIR from one member, every other scalar first-non-null in
// score order with ties broken by URI, and the member that supplied each one recorded.
// Mutation: take the highest-scored member's value instead of the first non-null one and `popularity`
// and `status` both go null, because the 0.9 row publishes neither; merge `season` and `seasonYear`
// field by field and the cluster carries SUMMER 2025, a pair no source ever claimed.
test('the field policy: a season pair from one member, ties by uri, and provenance for each', async () => {
  const media = json((await clusterOf('mal:200'))!.media)
  expect(media.season, 'anilist is the highest-scored member NAMING a season').toBe('SUMMER')
  expect(media.seasonYear, "so the year is anilist's too, and never mal's 2025").toBe(2026)
  expect(provenanceOf(media, 'season')).toEqual([{ field: 'season', uri: 'anilist:200', rule: 'season-pair' }])

  expect(media.status, 'only anilist published one').toBe('FINISHED')
  expect(media.popularity, 'anilist and kitsu both published one; anilist scores higher').toBe(200)
  expect(provenanceOf(media, 'popularity')).toEqual([
    { field: 'popularity', uri: 'anilist:200', answerSeq: expect.any(Number), rule: 'first-non-null' },
  ])
  expect(media.episodeCount, "the length is the cluster's vote, never a member's field").toBe(12)
  expect(provenanceOf(media, 'episodeCount')).toEqual([
    { field: 'episodeCount', uris: ['anizip:200', 'mal:200'], tier: 0.9, witnesses: 2, rule: 'tiered' },
  ])

  const card = json((await clusterOf('mal:200'))!.card)
  expect(card.members).toEqual(['anilist:200', 'anizip:200', 'kitsu:200', 'mal:200'])
  expect(card.episodeCount).toBe(12)
  expect(card.uri).toBe((await clusterOf('mal:200'))!.aggUri)
})

// THE TIE ITSELF, and it is asked of the POLICY rather than of the graph: the plugin hands the
// members over already sorted by uri, so a stable sort would answer correctly with no tie-break at
// all and the graph could never show whether the rule is there. Handed the two members in the other
// order, only the comparator can put `anilist:200` first.
// Mutation: drop `|| compare(a.uri, b.uri)` from `byScoreThenUri` and the reversed input wins, which
// is `aggregate.ts:379-381`'s "non-deterministic between loads" reproduced exactly.
test('a tie inside one score tier is broken by uri, never by the order the members arrived in', () => {
  const member = (uri: string, popularity: number) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1),
    owned: true, score: 0.9, raw: { popularity }, fieldSeq: { popularity: 1 },
  })
  const cluster = {
    id: 'cl:anilist:900', aggUri: 'ag:(anilist:900,mal:900)', scope: 'RUN' as const,
    runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
  }
  const forward = aggregateFields({
    cluster, members: [member('anilist:900', 200), member('mal:900', 100)], related: [], relations: [], locationOrigin: '',
  })
  const reversed = aggregateFields({
    cluster, members: [member('mal:900', 100), member('anilist:900', 200)], related: [], relations: [], locationOrigin: '',
  })
  expect(forward.popularity, 'the lower uri supplies it').toBe(200)
  expect(reversed.popularity, 'and it still does when the members arrive the other way round').toBe(200)
  expect(JSON.stringify(reversed), 'the whole row is the same row').toBe(JSON.stringify(forward))
})

// Credits read the same sorted members as every other field: two sources at one score both voicing
// Spike in English, handed over in either order, give one row. Mutation: hand `mergeCredits` the
// members as they arrived and the reversed input takes its English cast from the other source.
test('the merged credits are the same whatever order the members arrived in', () => {
  const spike = (actor: string) => ({
    characters: [{ id: 'anilist:1', names: ['Spike Spiegel'], voiceActors: [{ language: 'en', person: { id: actor, name: actor } }] }],
    staff: [],
  })
  const member = (uri: string, credits: unknown) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1),
    owned: true, score: 0.8, raw: { credits }, fieldSeq: { credits: 1 },
  })
  const cluster = {
    id: 'cl:anilist:1', aggUri: 'ag:(anilist:1,kitsu:1)', scope: 'RUN' as const,
    runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
  }
  const members = [member('anilist:1', spike('Steven Blum')), member('kitsu:1', spike('Another Spike'))]
  const forward = aggregateFields({ cluster, members, related: [], relations: [], locationOrigin: '' })
  const reversed = aggregateFields({ cluster, members: [...members].reverse(), related: [], relations: [], locationOrigin: '' })
  expect((forward.characters as { voiceActors: { name: string }[] }[])[0]!.voiceActors.map(({ name }) => name)).toEqual(['Steven Blum'])
  expect(JSON.stringify(reversed.characters)).toBe(JSON.stringify(forward.characters))
})

const alone = (raw: Record<string, unknown>) => aggregateFields({
  cluster: {
    id: 'cl:anilist:1', aggUri: 'ag:(anilist:1)', scope: 'RUN', runLength: null, runLengthTier: null,
    runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
  },
  members: [{ uri: 'anilist:1', origin: 'anilist', id: '1', owned: true, score: 0.8, raw, fieldSeq: {} }],
  related: [],
  relations: [],
  locationOrigin: '',
})

// A handle node is the member's whole row, and every handle of an opened title would otherwise carry
// its source's full cast. Mutation: drop `credits: undefined` from `nodeOf`.
test('a handle node carries no credits', () => {
  const row = alone({ credits: { characters: [{ id: 'anilist:1', names: ['Spike Spiegel'], voiceActors: [] }], staff: [] } })
  expect(row.characters, 'the control: the row itself has them').toHaveLength(1)
  expect(JSON.stringify(row.handles)).not.toContain('Spike Spiegel')
})

// Mutation: drop `'duration', 'sourceMaterial'` from SCALARS and the page loses Episode length and Source.
test('the episode length and the source material reach the row', () => {
  const row = alone({ duration: 24, sourceMaterial: 'ORIGINAL' })
  expect(row.duration).toBe(24)
  expect(row.sourceMaterial).toBe('ORIGINAL')
})

// Anime News Network is a member of the cluster for its credits and nothing else: the row with its
// answer and the row with only its handle differ in `characters`, `staff`, the provenance naming it and
// its own handle node. Mutation: score it above AniList, or have it name a title, and the row moves.
test('an Anime News Network answer adds credits and changes no other field of the row', async () => {
  const subscribe = (annResolvers.Subscription as any).media.subscribe
  const fetch = async () => new Response(readFileSync(new URL('../../../../fixtures/credits/ann-bebop.xml', import.meta.url), 'utf8'))
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(anilist:1,ann:13)', details: true } }, { fetch } as never).next()
  const jet = { id: 'anilist:3', names: ['Jet Black'], role: 'MAIN', voiceActors: [{ language: 'ja', person: { id: 'anilist:95357', name: 'Unshou Ishizuka' } }] }
  const anilist = {
    uri: 'anilist:1', origin: 'anilist', id: '1', owned: true, score: 0.8, fieldSeq: {},
    raw: { url: 'https://anilist.co/anime/1', titles: [{ title: 'Cowboy Bebop' }], genres: ['Action'], studios: ['Sunrise'], duration: 24, credits: { characters: [jet], staff: [] } },
  }
  const row = (ann: { owned: boolean, score: number | null, raw: Record<string, unknown> }) => aggregateFields({
    cluster: {
      id: 'cl:anilist:1', aggUri: 'ag:(anilist:1,ann:13)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    members: [anilist, { uri: 'ann:13', origin: 'ann', id: '13', fieldSeq: {}, ...ann }],
    related: [],
    relations: [],
    locationOrigin: '',
  })
  const without = row({ owned: false, score: null, raw: {} })
  const withAnn = row({ owned: true, score: value.media.score, raw: value.media })
  const rest = ({ characters, staff, provenance, handles, ...fields }: Record<string, unknown>) => fields

  expect((withAnn.characters as { name: string }[]).map(({ name }) => name)).toEqual(['Jet Black', 'Spike Spiegel', 'Lin'])
  expect((withAnn.staff as { name: string }[]).map(({ name }) => name)).toEqual(['Shinichirō Watanabe'])
  expect(rest(withAnn)).toEqual(rest(without))
  expect(withAnn.handles.filter(({ node }) => node.uri !== 'ann:13')).toEqual(without.handles.filter(({ node }) => node.uri !== 'ann:13'))
})

// THE ANOMALIES OF 5.5, landed on the cluster rather than left in a fixture test: the rule fires on
// the refused link and both clusters it names carry it, with the count the trace panel reads.
// Mutation: report anomalies only for the rows a rule names as a PAIR and a standing disagreement
// inside one component reports on neither cluster.
test('an anomaly rule that fired names the clusters it is about', async () => {
  const cluster = await clusterOf('nf:70000-1')
  const anomalies = JSON.parse(String(cluster!.anomalies)) as { rule: string, detail: string }[]
  expect(anomalies.map(anomaly => anomaly.rule)).toContain('disagreeing-ids')
  expect(Number(cluster!.anomalyCount), 'the count, because size() over a JSON column is a string length').toBe(anomalies.length)
  expect(anomalies[0]!.detail).toContain('nf:80000-1')
})

// THE FOUR INVARIANT QUERIES OF 3.5, which can only be answered once `MEMBER_OF` exists: three of
// them read it, so before this plugin they reported zero because the table was empty.
// Mutation: admit `PART_OF` into the closure and `part-of-inside` counts the pair it welded.
test('the invariants of 3.5 are zero after a pass', async () => {
  const { query } = await graphReady()
  expect((await checkInvariants(query)).counts).toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })
})

// IDEMPOTENCE IS THE CONTRACT (5.1), and it is the one thing a materialized view cannot be sloppy
// about: a pass that rewrites every JSON is a re-render of every open page per flush.
// Mutation: put the pass time, or an unsorted list, in any materialized value and every pass writes
// every cluster.
test('a second pass over the same graph writes nothing', async () => {
  const again = await runPass()
  expect(again.changes).toEqual([])
})

// THE ID IS MINTED ONCE AND CARRIED (5.4 P5). The merge here is 2 members against 1, so the larger
// keeps its id whatever the union-find's own root would be, the loser becomes an `Alias` row, and the
// address grows to name all three.
// Mutation: mint from the new key every pass and every merge changes the `_id` the app caches on,
// which is a new page for the same work; drop the alias and an old `_id` resolves to nothing.
test("a merge keeps the larger cluster's id and retires the other into an Alias", async () => {
  const before = await clusterOf('anilist:700')
  expect(before!.id).toBe('cl:anilist:700')
  expect((await clusterOf('mal:700'))!.id).toBe('cl:mal:700')

  await ingestAnswers([
    await answer('media', media('anilist:700', {
      score: 0.8, type: 'TV', titles: [title('en', 'Carried')],
      handles: [sameAs(media('kitsu:700', { score: 0.3 })), sameAs(media('mal:700', { score: 0.9 }))],
    })),
    // kitsu names mal as well, so the component survives losing anilist's two links below: without
    // that the split could only ever put the old key in the LARGER fragment, where the size rule and
    // the key rule agree and neither can be told from the other
    await answer('media', media('kitsu:700', {
      score: 0.3, type: 'TV', titles: [title('en', 'Carried')],
      handles: [sameAs(media('mal:700', { score: 0.9 }))],
    })),
  ])
  await runPass()

  const merged = await clusterOf('mal:700')
  expect(merged!.id, 'two members against one').toBe('cl:anilist:700')
  expect(merged!.aliases).toEqual(['cl:mal:700'])
  expect(merged!.published).toEqual(['anilist:700', 'kitsu:700', 'mal:700'])
  expect(merged!.aggUri).toBe('ag:(anilist:700,kitsu:700,mal:700)')
  const alias = await rowsOf('MATCH (a:Alias {id: $id}) RETURN a.clusterId AS clusterId', { id: 'cl:mal:700' })
  expect(alias.map(row => row.clusterId), 'a retired id is a key lookup, not a scan').toEqual(['cl:anilist:700'])
})

// A SPLIT KEEPS THE ID ON THE FRAGMENT HOLDING THE OLD KEY, and each fragment's address names the rows
// it holds, while the old address opens the fragment holding the lowest key, here the one that kept it.
// Mutation: build the address from `published` and the kept fragment's address still names the rows
// that left; give the id to the larger fragment instead and a split moves the page the app cached.
test('a split keeps the id with the old key, and the address drops the rows that left', async () => {
  const { query } = await graphReady()
  // the SAME_AS row is retracted directly, and only the aggregate runs after it: `plugin:direct`
  // re-proposes from the claim every pass, which is the sticky rule doing its job (5.2)
  await query(
    `MATCH (a:Media {uri: 'anilist:700'})-[l:LINK]->(b:Media)
     WHERE l.kind = 'SAME_AS' AND l.status = 'active' DELETE l`
  )
  await runPass([aggregatePlugin])

  // one member against two, so only the KEY can hand the id to this side
  const kept = await clusterOf('anilist:700')
  expect(kept!.id, 'the fragment holding the previous key').toBe('cl:anilist:700')
  expect(kept!.aggUri).toBe('ag:(anilist:700)')
  expect(kept!.published, 'append only: the departed members are still published under this id').toEqual(
    ['anilist:700', 'kitsu:700', 'mal:700']
  )
  const departed = await clusterOf('mal:700')
  expect(departed!.id, 'the other fragment is new').toBe('cl:kitsu:700')
  expect(departed!.aggUri).toBe('ag:(kitsu:700,mal:700)')
  clearReadCache()
  expect((await resolveMedia('ag:(anilist:700,kitsu:700,mal:700)'))?._id, 'the old address').toBe('cl:anilist:700')
})

// THE TWO CARRY RULES AS RULES, which the graph cannot show once they have decided: a cluster that
// kept an id looks exactly like one minted with it.
// Mutation: break the size test and the merge below hands the id to the one-member side; break the
// key tie-break and two equal clusters swap ids depending on which was read first.
test('carryIds: the larger keeps its id, ties to the smaller key, a split follows the key', () => {
  const previous = {
    clusters: new Map([
      ['cl:a', { id: 'cl:a', key: 'a:1', published: [], aliases: [] }],
      ['cl:m', { id: 'cl:m', key: 'm:1', published: [], aliases: [] }],
    ]),
    memberOf: new Map([['a:1', 'cl:a'], ['a:2', 'cl:a'], ['m:1', 'cl:m']]),
    aliases: new Set<string>(),
  }

  const merged = carryIds([{ key: 'a:1', members: ['a:1', 'a:2', 'm:1'] }], previous)
  expect(merged.get('a:1')).toEqual({ id: 'cl:a', retired: ['cl:m'] })

  const tied = carryIds([{ key: 'a:1', members: ['a:1', 'm:1'] }], {
    ...previous,
    memberOf: new Map([['a:1', 'cl:a'], ['m:1', 'cl:m']]),
  })
  expect(tied.get('a:1'), 'one member each, so the smaller previous key decides').toEqual({ id: 'cl:a', retired: ['cl:m'] })

  // the old key in the SMALLER fragment, which is the only shape where the key rule and the size rule
  // can disagree: two equal fragments fall to the lowest component key and answer alike either way
  const split = carryIds([{ key: 'a:2', members: ['a:2', 'a:3'] }, { key: 'a:1', members: ['a:1'] }], {
    ...previous,
    memberOf: new Map([['a:1', 'cl:a'], ['a:2', 'cl:a'], ['a:3', 'cl:a']]),
  })
  expect(split.get('a:1'), 'the fragment holding the old key keeps the id').toEqual({ id: 'cl:a', retired: [] })
  expect(split.get('a:2')!.id, 'and the other fragment is new, whatever its size').toBe('cl:a:2')
})

// A REAL RECORDED PAGE, the only case here that meets shapes nobody chose: 800 answers, 24 sources,
// nested nodes four deep. It REPORTS its numbers rather than asserting a threshold on them, because a
// figure pinned to one walk fails on the next walk rather than on the next bug. What is asserted is
// what must hold whatever the page contains: the closure, the invariants, the audit, and a second
// pass that writes nothing.
test('the 800 recorded rows replay, cluster, slot and hold the invariants', async () => {
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

  const started = Date.now()
  const pass = await runPass()
  const passMs = Date.now() - started

  const clusters = await membership()
  const search = await closureBySearch()
  const holding = new Map<string, string[]>()
  for (const members of clusters.values()) for (const uri of members) holding.set(uri, members)
  for (const [uri, members] of search) expect(holding.get(uri), `the closure of ${uri}`).toEqual(members)

  const { query } = await graphReady()
  expect((await checkInvariants(query)).counts).toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })

  const [counted] = await rowsOf(
    `MATCH (c:Cluster) RETURN count(c) AS clusters, sum(c.anomalyCount) AS anomalies, sum(c.runLength) AS episodes`
  )
  const [slots] = await rowsOf('MATCH (s:Slot) RETURN count(s) AS total')
  const [fills] = await rowsOf('MATCH ()-[f:FILLS]->() RETURN count(f) AS total')
  const [cards] = await rowsOf('MATCH (c:Cluster) WHERE c.card IS NOT NULL RETURN count(c) AS total')
  const sizes = [...clusters.values()].map(members => members.length)
  console.info('plugin:aggregate over 800 corpus rows:', JSON.stringify({
    clusters: Number(counted!.clusters),
    cards: Number(cards!.total),
    largestCluster: Math.max(...sizes),
    singletons: sizes.filter(size => size === 1).length,
    slots: Number(slots!.total),
    fills: Number(fills!.total),
    anomalies: Number(counted!.anomalies ?? 0),
    iterations: pass.iterations,
    passMs,
    auditMs: pass.audit.ms,
    aggregateMs: pass.runs.filter(run => run.id === 'plugin:aggregate').map(run => run.ms),
  }, null, 2))

  const again = await runPass()
  expect(again.changes, 'the same page twice is the same view').toEqual([])
  console.info(`the second pass over the same graph: ${again.ms} ms, ${again.iterations} iteration(s), nothing written`)
}, 600_000)

// Themes are one source's whole list, from the first in score order that has one, never spliced.
// Mutation: drop the `themesFrom` block from `aggregateFields` and the row has none; drop
// `themes: undefined` from `nodeOf` and the AnimeThemes handle carries the list a second time.
test('the themes come whole from the first source that has them, and no handle carries them', () => {
  const theme = (title: string) => ({ kind: 'OP', sequence: 1, title, artists: [], video: null })
  const member = (uri: string, score: number, raw: Record<string, unknown>) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), owned: true, score, raw, fieldSeq: {},
  })
  const row = aggregateFields({
    cluster: {
      id: 'cl:mal:52991', aggUri: 'ag:(animethemes:4136,mal:52991,other:1)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    members: [
      member('other:1', 0.1, { themes: [theme('Haru')] }),
      member('mal:52991', 0.9, { themes: [] }),
      member('animethemes:4136', 0.5, { themes: [theme('Yuusha'), theme('Anytime Anywhere')] }),
    ],
    related: [],
    relations: [],
    locationOrigin: '',
  })
  expect((row.themes as { title: string }[]).map(({ title }) => title)).toEqual(['Yuusha', 'Anytime Anywhere'])
  expect(JSON.stringify(row.handles)).not.toContain('Yuusha')
})

// One rating per site, the first source in score order that has one: two sources' IMDb scores are one
// IMDb score, read at different times.
// Mutation: drop the `row.ratings` line from `aggregateFields` and the row has none.
test('the ratings keep one value per site, from the highest scored source that has it', () => {
  const member = (uri: string, score: number, raw: Record<string, unknown>) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), owned: true, score, raw, fieldSeq: {},
  })
  const row = aggregateFields({
    cluster: {
      id: 'cl:jw:1133934', aggUri: 'ag:(jw:1133934,omdb:tt15239678,other:1)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    members: [
      member('jw:1133934', 0.2, { ratings: [{ source: 'IMDb', value: 8.4, scale: 10 }, { source: 'Rotten Tomatoes', value: 92, scale: 100 }] }),
      member('other:1', 0.1, {}),
      member('omdb:tt15239678', 0.5, { ratings: [{ source: 'IMDb', value: 8.5, scale: 10 }] }),
    ],
    related: [],
    relations: [],
    locationOrigin: '',
  })
  expect(row.ratings).toEqual([{ source: 'IMDb', value: 8.5, scale: 10 }, { source: 'Rotten Tomatoes', value: 92, scale: 100 }])
})
