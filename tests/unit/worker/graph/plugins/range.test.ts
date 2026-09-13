/**
 * `plugin:range` of 5.4 P4: the episode pairs that place a play button, and the ranges of 3.4.
 *
 * WHAT EACH CASE IS FOR. The plugin has exactly two ways to be wrong and both are expensive, so the
 * cases are built around them. It can mint a pair that is NOT the same broadcast, which puts a
 * playable url on the wrong row (the title-vote offset put 13 of 25 Blue Exorcist rows wrong,
 * 2026-09-10); or it can refuse a pair it could have proven, which costs a run its buttons silently.
 * So every walkthrough of section 8 is here with its own numbers, each refusal is a case of its own,
 * and the rule that mints nothing at all (Netflix) is asserted as hard as the ones that mint.
 *
 * Every case names the mutation that reddens it. A rule whose whole output is "nothing was proven" is
 * the kind that passes while doing nothing, and three of the cases below assert exactly that.
 */
import { afterAll, beforeAll, expect, test } from 'vitest'

import { existsSync, readFileSync } from 'node:fs'

import type { AnswerRow } from '../../../../../src/worker/graph/answers'
import type { SideEpisode } from '../../../../../src/worker/graph/plugins/range'

import { enableGraph } from '../../../../../src/worker/graph'
import { closeGraph } from '../../../../../src/worker/graph/engine'
import { ingestAnswers, replayAnswers } from '../../../../../src/worker/graph/ingest'
import { graphReady } from '../../../../../src/worker/graph/schema'
import { resetPassState, runPlugins } from '../../../../../src/worker/graph/plugins/runner'
import { profilePlugin } from '../../../../../src/worker/graph/plugins/profile'
import { directPlugin } from '../../../../../src/worker/graph/plugins/direct'
import { aggregatePlugin } from '../../../../../src/worker/graph/plugins/aggregate'
import { containmentPlugin } from '../../../../../src/worker/graph/plugins/containment'
import {
  alignByTitle, closeDatesWithTitles, closeWithSpecials, decideCandidate, forcedByBracket, hullOf, MIN_ALIGNED,
  numbersOutsideRun, MIN_CONSENSUS_ANCHORS, MIN_CONSENSUS_GAP, MIN_SCORED_ANCHORS, offsetConsensus, pairsByDay,
  pairsBySequence, pairsByTitle, placesClaim, rangePlugin, referenceEpisodes, ruleOfPair, scheduleSkew,
  SCORED_ANCHOR_FLOOR, SCORED_ANCHOR_MARGIN, synopsisAnchors, titleDice, SYNOPSIS_ANCHOR_FLOOR } from '../../../../../src/worker/graph/plugins/range'
import { stripTitle } from '../../../../../src/sources/utils'
import { checkInvariants } from '../../../../../src/worker/graph/plugins/invariants'
import { alignmentOffset } from '../../../../../src/worker/store/consensus'
import type { Episode } from '../../../../../src/worker/store/types'
import { answer, episode, media, rowsOf, title } from './fixtures'
import { MUSHOKU_SYNOPSES } from './synopses'

const CORPUS = new URL('../../../../../corpus/season/summer-2026/answers.jsonl', import.meta.url).pathname

const MS_PER_DAY = 86_400_000
const dayOf = (date: string): number => Math.floor(Date.parse(date) / MS_PER_DAY)

/**
 * What a REPORTING case prints, and never `console`.
 *
 * vitest 4 intercepts `console` and its default reporter drops every line a PASSING test wrote
 * (measured 2026-09-12: a `console.info` in a green case is invisible with the default reporter and
 * stays invisible under `--silent=false`, while a `process.stdout.write` from the same case shows).
 * The corpus case below exists to report numbers, so a reporting channel the reporter hides makes it
 * a case that runs and says nothing.
 */
const report = (line: string): void => void process.stdout.write(`${line}\n`)

/** `count` weekly days from `from`, as `YYYY-MM-DD`: the shape a named day arrives in (5.4 P0). */
const weekly = (from: string, count: number, skip = 0): string[] =>
  Array.from({ length: count }, (_, index) =>
    new Date(Date.parse(from) + (skip + index) * 7 * MS_PER_DAY).toISOString().slice(0, 10))

/** ani.zip's own stamp: `2021-01-10T15:00:00Z` is the 11th in Tokyo and the 10th in UTC (`consensus.ts:136-140`). */
const anizipDay = (day: string): string => `${day}T15:00:00.000Z`

const sameAs = (node: Record<string, unknown>) => ({ relation: 'SAME_AS', node })
/** A `PART_OF` handle onto a season row, which does NOT stamp a scope: the target's answer decides. */
const partOf = (node: Record<string, unknown>) => ({ relation: 'PART_OF', node })

const PLUGINS = [profilePlugin, directPlugin, aggregatePlugin, containmentPlugin, rangePlugin]

const runPass = async (plugins = PLUGINS) => {
  const report = await runPlugins(plugins, { reason: 'manual' })
  expect(report.audit.ok, report.audit.differences.join('; ')).toBe(true)
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
  // A PASS THAT HIT THE CAP HAS NOT REACHED A FIXED POINT (5.3). This plugin feeds `plugin:aggregate`
  // (a pair renumbers a row, which moves a slot) and is fed by it (the run length), so a rule that
  // depended on its own output would oscillate rather than throw
  expect(report.anomalies.map(anomaly => anomaly.rule).filter(rule => rule === 'fixed-point-cap')).toEqual([])
  return report
}

/** Every `EPISODE_LINK` this plugin wrote out of one media's episodes, in the pairing order. */
const pairsFrom = async (mediaUri: string) => rowsOf(
  `MATCH (m:Media {uri: $uri})-[:HAS_EPISODE]->(a:Episode)-[l:EPISODE_LINK]->(b:Episode)
   WHERE l.by = 'plugin:range'
   RETURN a.uri AS fromUri, b.uri AS toUri, l.fromNumber AS fromNumber, l.toNumber AS toNumber,
     l.kind AS kind, l.status AS status, l.reason AS reason, l.confidence AS confidence,
     l.evidence AS evidence, l.supports AS supports
   ORDER BY l.fromNumber, b.uri`,
  { uri: mediaUri }
)

/** Every `LINK` this plugin wrote, active and refused alike. */
const rangeLinks = async () => rowsOf(
  `MATCH (a:Media)-[l:LINK]->(b:Media)
   WHERE l.by = 'plugin:range'
   RETURN a.uri AS fromUri, b.uri AS toUri, l.kind AS kind, l.status AS status, l.reason AS reason,
     l.fromStart AS fromStart, l.fromEnd AS fromEnd, l.toStart AS toStart, l.toEnd AS toEnd,
     l.contiguous AS contiguous, l.aligned AS aligned, l.total AS total, l.evidence AS evidence,
     l.supports AS supports
   ORDER BY fromUri, toUri`
)

const linksBetween = async (fromUri: string, toUri: string) => rowsOf(
  `MATCH (a:Media {uri: $fromUri})-[l:LINK]-(b:Media {uri: $toUri})
   RETURN l.kind AS kind, l.status AS status, l.reason AS reason, l.by AS by
   ORDER BY by, kind, reason`,
  { fromUri, toUri }
)

/** Every slot the episodes of one uri space fill, which is what a pair is FOR (5.4 P5, 8.1). */
const fillsFrom = async (prefix: string) => {
  const rows = await rowsOf(
    `MATCH (e:Episode)-[f:FILLS]->(s:Slot)
     WHERE e.uri STARTS WITH $prefix
     RETURN e.uri AS uri, s.id AS slot, s.number AS slotNumber, f.number AS number, f.via AS via,
       f.supports AS supports
     ORDER BY uri, slot`,
    { prefix }
  )
  return rows.map(row => ({
    uri: String(row.uri),
    slot: String(row.slot),
    slotNumber: row.slotNumber === null ? null : Number(row.slotNumber),
    number: row.number === null ? null : Number(row.number),
    via: String(row.via),
    supports: row.supports as string[],
  }))
}

/** The cluster one uri sits in, which is what a slot id is prefixed with. */
const clusterIdOf = async (uri: string): Promise<string> => {
  const [row] = await rowsOf('MATCH (m:Media {uri: $uri})-[:MEMBER_OF]->(c:Cluster) RETURN c.id AS id', { uri })
  return String(row!.id)
}

/** Every episode pair between two uri spaces, refused ones included: the row a refusal lives on. */
const pairsBetween = async (fromPrefix: string, toPrefix: string) => rowsOf(
  `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
   WHERE a.uri STARTS WITH $fromPrefix AND b.uri STARTS WITH $toPrefix
   RETURN a.uri AS fromUri, b.uri AS toUri, l.status AS status, l.reason AS reason, l.by AS by,
     l.key AS key, l.fromNumber AS fromNumber, l.toNumber AS toNumber, l.confidence AS confidence,
     l.supports AS supports
   ORDER BY fromUri, toUri`,
  { fromPrefix, toPrefix }
)

const evidenceOf = (row: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(String(row.evidence ?? '{}')) as Record<string, unknown>

// ---------------------------------------------------------------------------------------------
// The fixtures. Every uri and every number is the record's where the record has one, and says so
// where it does not (8.1 to 8.4, `consensus.test.ts:284-288`).

// 8.1: eleven weekly slots from the real premiere, ani.zip stamping the UTC day and Crunchyroll the
// Tokyo one, which is the day of slack the rule exists for
const MUSHOKU_C1 = weekly('2021-01-10', 11)
const MUSHOKU_C1_TOKYO = weekly('2021-01-11', 11)
const MUSHOKU_C2 = weekly('2021-10-03', 12)
const MUSHOKU_C2_TOKYO = weekly('2021-10-04', 12)

// 8.2: twelve weekly slots, Crunchyroll numbering 13 to 20 on the first eight of the SAME days
const SAMURAI = weekly('2026-07-17', 12)

// 8.3: 25 episodes our side, 26 rows on Netflix's with a special inserted at position 14
const EXORCIST = weekly('2011-04-17', 25)

// 8.4: 64 episodes in five seasons of 13, 13, 13, 13 and 12
const FMA = weekly('2009-04-05', 64)

const mushokuAnswers = async () => [
  await answer('media', media('anilist:108465', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 11, startDate: MUSHOKU_C1[0],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation')],
    handles: [
      sameAs(media('mal:39535', { score: 0.9 })),
      sameAs(media('anizip:14758', {})),
      partOf(media('cr:G24H1N3MP-G609CX3J4', { score: 0.5 })),
    ],
  })),
  await answer('media', media('mal:39535', {
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 11, startDate: MUSHOKU_C1[0],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation')],
  })),
  await answer('media', media('anizip:14758', {
    type: 'TV', episodeCount: 11, titles: [title('en', 'Mushoku Tensei Jobless Reincarnation')],
    episodes: MUSHOKU_C1.map((day, index) => episode(`anizip:14758-${index + 1}`, 'anizip:14758', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Cour One ${index + 1}`)],
    })),
  })),
  // cour 2. Its own anidb id is not in the record (8.1), so the fixture names one
  await answer('media', media('anilist:127720', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12, startDate: MUSHOKU_C2[0],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Part 2')],
    handles: [sameAs(media('anizip:14759', {})), partOf(media('cr:G24H1N3MP-G609CX3J4', { score: 0.5 }))],
  })),
  await answer('media', media('anizip:14759', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Part 2')],
    episodes: MUSHOKU_C2.map((day, index) => episode(`anizip:14759-${index + 1}`, 'anizip:14759', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Cour Two ${index + 1}`)],
    })),
  })),
  // Crunchyroll's season 1: 23 episodes plus a special, listLength 24, dated per episode and with no
  // season start date of its own (8.1). Its titles are its own, so only the dates can prove the fold
  await answer('media', media('cr:G24H1N3MP-G609CX3J4', {
    score: 0.5, type: 'TV', status: 'FINISHED', episodeCount: 24,
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Season 1')],
    episodes: [
      ...MUSHOKU_C1_TOKYO.map((day, index) => episode(`cr:G609CX3J4-${index + 1}`, 'cr:G24H1N3MP-G609CX3J4', {
        episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Crunchyroll ${index + 1}`)],
      })),
      ...MUSHOKU_C2_TOKYO.map((day, index) => episode(`cr:G609CX3J4-${index + 12}`, 'cr:G24H1N3MP-G609CX3J4', {
        episodeNumber: index + 12, releaseDate: day, titles: [title('en', `Crunchyroll ${index + 12}`)],
      })),
      episode('cr:G609CX3J4-24', 'cr:G24H1N3MP-G609CX3J4', {
        episodeNumber: 24, releaseDate: '2021-05-01', titles: [title('en', 'Eris the Special')],
      }),
    ],
  })),
]

const samuraiAnswers = async () => [
  await answer('media', media('anilist:182616', {
    score: 0.8, type: 'TV', status: 'RELEASING', episodeCount: 12, startDate: SAMURAI[0],
    titles: [title('en', 'The Elusive Samurai')],
    handles: [
      sameAs(media('mal:60059', { score: 0.9 })),
      sameAs(media('anizip:18903', {})),
      sameAs(media('kitsu:49265', { score: 0.3 })),
      sameAs(media('cr:GQWH0M19X-GS00366034', { score: 0.5 })),
    ],
  })),
  await answer('media', media('mal:60059', {
    score: 0.9, type: 'TV', status: 'RELEASING', episodeCount: 12, startDate: SAMURAI[0],
    titles: [title('en', 'The Elusive Samurai')],
  })),
  await answer('media', media('anizip:18903', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'The Elusive Samurai')],
    episodes: SAMURAI.map((day, index) => episode(`anizip:18903-${index + 1}`, 'anizip:18903', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Samurai ${index + 1}`)],
    })),
  })),
  // kitsu agrees about the length and is therefore a REFERENCE member, with numbers and no dates: it
  // is the row a pair must NOT name, since the day is what proved the pair
  await answer('media', media('kitsu:49265', {
    score: 0.3, type: 'TV', status: 'RELEASING', episodeCount: 12, titles: [title('en', 'The Elusive Samurai')],
    episodes: SAMURAI.map((day, index) => episode(`kitsu:49265-${index + 1}`, 'kitsu:49265', {
      episodeNumber: index + 1, titles: [title('en', `Samurai ${index + 1}`)],
    })),
  })),
  // eight aired when the seed was taken, numbered 13 to 20 on the same days: a MEMBER as shipped,
  // because guard 7 is silent in the SHORTER direction while the run is RELEASING (8.2)
  await answer('media', media('cr:GQWH0M19X-GS00366034', {
    score: 0.5, type: 'TV', status: 'RELEASING', episodeCount: 8, titles: [title('en', 'The Elusive Samurai')],
    episodes: SAMURAI.slice(0, 8).map((day, index) => episode(`cr:GS00366034-${index + 13}`, 'cr:GQWH0M19X-GS00366034', {
      episodeNumber: index + 13, releaseDate: day, titles: [title('en', `Samurai ${index + 1}`)],
    })),
  })),
]

// 8.3. The catalogue run's ids are not in the record, so the fixture names them; the Netflix title
// and the epid at position 14 are the record's. Netflix's rows carry OUR titles here, which is the
// only way the `retranslates` refusal can be shown to be what stops rule 2 rather than the data
const exorcistAnswers = async () => [
  await answer('media', media('anilist:6702', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 25, startDate: EXORCIST[0],
    titles: [title('en', 'Blue Exorcist')],
    handles: [sameAs(media('anizip:8351', {})), partOf(media('nf:70304252-1', { score: 0.2 }))],
  })),
  await answer('media', media('anizip:8351', {
    type: 'TV', episodeCount: 25, titles: [title('en', 'Blue Exorcist')],
    episodes: EXORCIST.map((day, index) => episode(`anizip:8351-${index + 1}`, 'anizip:8351', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Exorcist Chapter ${index + 1}`)],
    })),
  })),
  await answer('media', media('nf:70304252-1', {
    score: 0.2, type: 'TV', status: 'FINISHED', episodeCount: 26, titles: [title('en', 'Blue Exorcist Season 1')],
    episodes: Array.from({ length: 26 }, (_, index) => {
      const position = index + 1
      // position 14 is epid 80005451 "Runaway Kuro", a special that aired after the run ended
      const own = position === 14 ? 'Runaway Kuro' : `Exorcist Chapter ${position < 14 ? position : position - 1}`
      return episode(`nf:80005${400 + position}`, 'nf:70304252-1', {
        episodeNumber: position, titles: [title('en', own)],
      })
    }),
  })),
]

// 8.4. `mal:5114` is the record's; the AniList and ani.zip ids are not, so they carry a name. The
// record's five seasons are NETFLIX's and carry no date at any level, which is 8.3's outcome; they
// are dated under a folding catalogue here to reach the row of the verdict table Netflix can never
// reach: pairs found, the container NOT longer, so pairs only and no range
const fmaAnswers = async () => [
  await answer('media', media('mal:5114', {
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 64, startDate: FMA[0],
    titles: [title('en', 'Fullmetal Alchemist Brotherhood')],
    handles: [
      sameAs(media('anizip:fma', {})),
      ...Array.from({ length: 5 }, (_, index) => sameAs(media(`cr:FMA-S${index + 1}`, { score: 0.5 }))),
    ],
  })),
  await answer('media', media('anizip:fma', {
    type: 'TV', episodeCount: 64, titles: [title('en', 'Fullmetal Alchemist Brotherhood')],
    episodes: FMA.map((day, index) => episode(`anizip:fma-${index + 1}`, 'anizip:fma', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Alchemist ${index + 1}`)],
    })),
  })),
  ...await Promise.all(Array.from({ length: 5 }, (_, season) => {
    const length = season === 4 ? 12 : 13
    const days = FMA.slice(season * 13, season * 13 + length)
    return answer('media', media(`cr:FMA-S${season + 1}`, {
      score: 0.5, type: 'TV', status: 'FINISHED', episodeCount: length,
      titles: [title('en', `Fullmetal Alchemist Brotherhood Season ${season + 1}`)],
      episodes: days.map((day, index) => episode(`cr:FMA-S${season + 1}-${index + 1}`, `cr:FMA-S${season + 1}`, {
        episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Crunchyroll ${season + 1}x${index + 1}`)],
      })),
    }))
  })),
]

// THE WINDOW. A reference member that LISTS one more row than the run's sources agree the run is
// long: the twelfth pair is outside `1..11` and is dropped rather than counted (`consensus.ts:185-191`)
const WINDOW = weekly('2022-01-05', 12)
const windowAnswers = async () => [
  await answer('media', media('anilist:900', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 11, startDate: WINDOW[0],
    titles: [title('en', 'Windowed')],
    handles: [sameAs(media('anizip:900', {})), partOf(media('cr:900', { score: 0.5 }))],
  })),
  await answer('media', media('anizip:900', {
    type: 'TV', episodeCount: 11, titles: [title('en', 'Windowed')],
    episodes: WINDOW.map((day, index) => episode(`anizip:900-${index + 1}`, 'anizip:900', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Windowed ${index + 1}`)],
    })),
  })),
  await answer('media', media('cr:900', {
    score: 0.5, type: 'TV', status: 'FINISHED', episodeCount: 12, titles: [title('en', 'Windowed Season 1')],
    episodes: WINDOW.map((day, index) => episode(`cr:900-${index + 1}`, 'cr:900', {
      episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Windowed Stream ${index + 1}`)],
    })),
  })),
]

// THE TRANSITIONAL LEND of 4.4: Crunchyroll's season 1 of 24 re-pointed at the asking run, so the
// rows arrive as `HAS_EPISODE {claimer: 'cr'}` from an `anilist:` uri with no season row to hang a
// label off. Mushoku Tensei season 2 part 2, as `consensus.test.ts` holds it
const LEND_Cour1 = weekly('2023-07-09', 12)
const LEND_CouR2 = weekly('2024-04-07', 12)
const lendAnswers = async () => [
  await answer('media', media('anilist:166873', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12, startDate: LEND_CouR2[0],
    titles: [title('en', 'Mushoku Tensei Season 2 Part 2')],
    handles: [sameAs(media('mal:55888', { score: 0.9 })), sameAs(media('anizip:18104', {}))],
  })),
  await answer('media', media('mal:55888', {
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 12, titles: [title('en', 'Mushoku Tensei Season 2 Part 2')],
  })),
  await answer('media', media('anizip:18104', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'Mushoku Tensei Season 2 Part 2')],
    episodes: LEND_CouR2.map((day, index) => episode(`anizip:18104-${index + 1}`, 'anizip:18104', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Part Two ${index + 1}`)],
    })),
  })),
  await answer('media', media('cr:GSP1', {
    score: 0.5, type: 'TV', status: 'FINISHED', titles: [title('en', 'Mushoku Tensei Season 2')],
    episodes: [...LEND_Cour1, ...LEND_CouR2].map((day, index) => episode(`cr:GSP1-${index + 1}`, 'anilist:166873', {
      episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Crunchyroll Season Two ${index + 1}`)],
    })),
  })),
]

// THE SCHEDULE SKEW, `anilist-208044` of the summer 2026 corpus. Crunchyroll publishes the STREAMING
// schedule from a Thursday and ani.zip the BROADCAST one from the following Wednesday at 15:00Z, so
// Crunchyroll's episode N+1 falls one day after ani.zip's episode N, inside the day of slack, while
// its own N falls six days before it. Both lists number 1 to 12, the run is 12 long, and the title at
// each number is the same on both sides. The ids are the record's; the record names the first and the
// last episode title, so the ten between them carry a name.
const SKEW_STREAM = weekly('2026-06-25', 12)
const SKEW_BROADCAST = weekly('2026-07-01', 12)
const SKEW_TITLES = [
  'Prologue', 'Lost Technology', 'The Buried City', 'A Borrowed Name', 'The Long March',
  'Ashes of the Keep', 'The Third Seal', 'Hollow Crown', 'The River Gate', 'What the Archive Kept',
  'The Last Convoy', 'I Am Eftal',
]
const skewAnswers = async () => [
  await answer('media', media('anilist:208044', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12, startDate: SKEW_BROADCAST[0],
    titles: [title('en', 'The Eftal Record')],
    handles: [sameAs(media('anizip:19896', {}))],
  })),
  await answer('media', media('anizip:19896', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'The Eftal Record')],
    episodes: SKEW_BROADCAST.map((day, index) => episode(`anizip:19896-${index + 1}`, 'anizip:19896', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', SKEW_TITLES[index]!)],
    })),
  })),
  // the lend: twelve `cr:` rows hung on the `anilist:` member, with no season row of their own (4.4)
  await answer('media', media('cr:GE00379300', {
    score: 0.5, type: 'TV', status: 'FINISHED', titles: [title('en', 'The Eftal Record')],
    episodes: SKEW_STREAM.map((day, index) => episode(`cr:GE003793${String(index + 2).padStart(2, '0')}JAJP`, 'anilist:208044', {
      episodeNumber: index + 1, releaseDate: day, titles: [title('en', SKEW_TITLES[index]!)],
    })),
  })),
]

// THE SAME SKEW ON A CLASS 1 CANDIDATE, which is the shape the corpus has no example of and the code
// reaches identically: a season row attached by an uncertain `PART_OF`, numbered 1 to 12 against a run
// of 12, on the streaming schedule. Its titles are its own, so rule 2 has nothing to fall back on and
// the skew becomes a WRITTEN refusal on the `LINK` rather than eleven pairs one late.
const SKEW_S_STREAM = weekly('2026-04-02', 12)
const SKEW_S_BROADCAST = weekly('2026-04-08', 12)
const skewSeasonAnswers = async () => [
  await answer('media', media('anilist:910', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12, startDate: SKEW_S_BROADCAST[0],
    titles: [title('en', 'Skewed Season')],
    handles: [sameAs(media('anizip:910', {})), partOf(media('cr:910', { score: 0.5 }))],
  })),
  await answer('media', media('anizip:910', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'Skewed Season')],
    episodes: SKEW_S_BROADCAST.map((day, index) => episode(`anizip:910-${index + 1}`, 'anizip:910', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Skewed ${index + 1}`)],
    })),
  })),
  await answer('media', media('cr:910', {
    score: 0.5, type: 'TV', status: 'FINISHED', episodeCount: 12, titles: [title('en', 'Skewed Season One')],
    episodes: SKEW_S_STREAM.map((day, index) => episode(`cr:910-${index + 1}`, 'cr:910', {
      episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Skewed Stream ${index + 1}`)],
    })),
  })),
]

// THE FOURTH INPUT of 5.4 P4: an episode `SAME_AS` a source stated. Two shapes, and the whole rule
// is which of the two it is: both rows inside one run cluster, or two runs nothing joins.
const CLAIMED = weekly('2026-01-06', 2)
const claimAnswers = async () => [
  await answer('media', media('anilist:950', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 2, startDate: CLAIMED[0],
    titles: [title('en', 'Asserted')],
    handles: [sameAs(media('mal:950', { score: 0.9 }))],
    episodes: [
      episode('anilist:950-1', 'anilist:950', {
        episodeNumber: 1, releaseDate: CLAIMED[0], titles: [title('en', 'Asserted One')],
        handles: [sameAs(episode('mal:950-1', 'mal:950', { episodeNumber: 1 }))],
      }),
    ],
  })),
  await answer('media', media('mal:950', {
    score: 0.9, type: 'TV', status: 'FINISHED', episodeCount: 2, titles: [title('en', 'Asserted')],
    episodes: [episode('mal:950-1', 'mal:950', { episodeNumber: 1, titles: [title('en', 'Asserted One')] })],
  })),
  // and the same claim across two runs nothing joins. Two ORIGINS, because two ids of one origin in
  // one component is guard 4's refusal (5.2) and this pair has to be weldable later
  await answer('media', media('anilist:960', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 2, startDate: CLAIMED[0],
    titles: [title('en', 'Foreign Left')],
    episodes: [
      episode('anilist:960-1', 'anilist:960', {
        episodeNumber: 1, releaseDate: CLAIMED[0], titles: [title('en', 'Foreign One')],
        handles: [sameAs(episode('kitsu:970-1', 'kitsu:970', { episodeNumber: 1 }))],
      }),
    ],
  })),
  await answer('media', media('kitsu:970', {
    score: 0.3, type: 'TV', status: 'FINISHED', episodeCount: 2, startDate: CLAIMED[0],
    titles: [title('en', 'Foreign Right')],
    episodes: [episode('kitsu:970-1', 'kitsu:970', { episodeNumber: 1, titles: [title('en', 'Foreign One')] })],
  })),
]

// RULE 3, BY SEQUENCE, AND 3.4a's CLOSURE, measured live on 2026-09-12 against Mushoku Tensei's
// Netflix season 2: 25 Netflix rows against 24 canonical episodes, 14 of the Netflix rows carrying a
// real title, 4 anchors, 3 rows forced by an equal-gap bracket, 0 regions refused, and 18 rows
// outside the outermost anchors (5 before the first, 13 after the last). With ani.zip's special `S1`
// located at Netflix's row 1 the surplus of one is accounted and rows 2 to 25 are forced onto
// canonical 1 to 24, which is the closure.
//
// The seven titles the measurement names are verbatim; the rows it does not name carry an invented
// title, so that the count of titled rows is the measured 14 and none of the unnamed ones matches
// anything on the other side. The canonical side is ani.zip's own 1 to 24 across S2's two parts
// (8.1's table: part 2's rows carry `episodeNumber` 13 to 24), which is the numbering the 25 Netflix
// rows were measured against.

/** ani.zip's titles by canonical number. 5 to 11 are the record's; 1 to 4 and 12 to 24 are invented. */
const CANON_S2 = [
  'Turning Point Four', 'The Water God Festival', 'A Sisters Reunion', 'The Labyrinth City of Rapan',
  // 5, an anchor
  'Ranoa University of Magic',
  // 6, forced: Netflix says `Unwilling to Die`, which no title rule can reach
  'I Don\'t Want to Die',
  // 7, an anchor
  'The Kidnapping and Confinement of Beast Girls',
  // 8, forced: Netflix drops the accent, so the keys differ by one letter
  'The Fiancé of Despair',
  // 9, an anchor
  'The White Mask',
  // 10, forced: Netflix says `This Feeling`
  'These Feelings',
  // 11, an anchor
  'To You',
  ...Array.from({ length: 13 }, (_, index) => `Canonical Chapter ${index + 12}`),
]

/** Netflix's rows by position. NULL is the placeholder `Episode N`, which anchors nothing (3.4a). */
const NETFLIX_S2: (string | null)[] = [
  // 1, the insertion: ani.zip's special `S1` reads `Guardian Fitz`, the same words reordered
  'Fitz the Guardian',
  'A Letter From Home', 'The Ruins of Rapan', 'Two Sisters', 'The Magic City',
  'Ranoa University of Magic',
  'Unwilling to Die',
  'The Kidnapping and Confinement of Beast Girls',
  'The Fiance of Despair',
  'The White Mask',
  'This Feeling',
  'To You',
  'The Doldia Village', 'A Quiet Homecoming',
  ...Array.from({ length: 11 }, () => null),
]

/** The special's own title, and its own air date: 2023-07-03, a week before canonical episode 1. */
const SPECIAL_S2 = 'Guardian Fitz'
const SPECIAL_DAY = '2023-07-03'

const SEQUENCE_DAYS = weekly('2023-07-09', 24)
const sequenceAnswers = async () => [
  await answer('media', media('anilist:146065', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 24, startDate: SEQUENCE_DAYS[0],
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Season 2')],
    handles: [sameAs(media('anizip:18103', {})), partOf(media('nf:80987039-2', { score: 0.2 }))],
  })),
  await answer('media', media('anizip:18103', {
    type: 'TV', episodeCount: 24, titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Season 2')],
    episodes: [
      ...CANON_S2.map((name, index) => episode(`anizip:18103-${index + 1}`, 'anizip:18103', {
        episodeNumber: index + 1, releaseDate: anizipDay(SEQUENCE_DAYS[index]!), titles: [title('en', name)],
      })),
      // the special, keyed `S1` and NUMBERED BY NOBODY, which is how ani.zip's `specials=1` fetch
      // reaches the graph (3.4a): it is an insertion candidate and a pair target never
      episode('anizip:18103-S1', 'anizip:18103', {
        releaseDate: anizipDay(SPECIAL_DAY), titles: [title('en', SPECIAL_S2)],
      }),
    ],
  })),
  // Netflix's season 2: 25 positional rows, no date at any level, its own translations
  await answer('media', media('nf:80987039-2', {
    score: 0.2, type: 'TV', status: 'FINISHED', episodeCount: 25,
    titles: [title('en', 'Mushoku Tensei Jobless Reincarnation Season 2')],
    episodes: NETFLIX_S2.map((name, index) => episode(`nf:80987039-2-${index + 1}`, 'nf:80987039-2', {
      episodeNumber: index + 1, titles: [title('en', name ?? `Episode ${index + 1}`)],
    })),
  })),
]

// RULE 3'S TWO OWN REFUSALS, on an origin whose titles rule 2 is NOT refused for, since a
// retranslating origin reports `retranslates` before either of them is reached. JustWatch publishes
// titles and a year (`justwatch/extractor.ts:387`), so rule 1 has nothing on their side and the
// verdict is rule 3's.
const REFUSAL_DAYS = weekly('2026-04-08', 8)
const refusalAnswers = async () => [
  await answer('media', media('anilist:930', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 8, startDate: REFUSAL_DAYS[0],
    titles: [title('en', 'Refused Alignment')],
    handles: [
      sameAs(media('anizip:930', {})),
      partOf(media('jw:930-770001', { score: 0.4 })),
      partOf(media('jw:930-770002', { score: 0.4 })),
    ],
  })),
  await answer('media', media('anizip:930', {
    type: 'TV', episodeCount: 8, titles: [title('en', 'Refused Alignment')],
    episodes: REFUSAL_DAYS.map((day, index) => episode(`anizip:930-${index + 1}`, 'anizip:930', {
      episodeNumber: index + 1, releaseDate: anizipDay(day), titles: [title('en', `Refused ${index + 1}`)],
    })),
  })),
  // nine rows, nine titles, not one of them ours: titles on both sides and no anchor at all
  await answer('media', media('jw:930-770001', {
    score: 0.4, type: 'TV', status: 'FINISHED', episodeCount: 9, titles: [title('en', 'Refused Alignment Season 1')],
    episodes: Array.from({ length: 9 }, (_, index) => episode(`jw:930-770001-${index + 1}`, 'jw:930-770001', {
      episodeNumber: index + 1, titles: [title('en', `Provider Cut ${index + 1}`)],
    })),
  })),
  // two anchors, and SEVEN rows between them where ours has six: one side carries a row the other
  // does not, and which row that is is exactly what order cannot say
  await answer('media', media('jw:930-770002', {
    score: 0.4, type: 'TV', status: 'FINISHED', episodeCount: 9, titles: [title('en', 'Refused Alignment Season 1 Again')],
    episodes: Array.from({ length: 9 }, (_, index) => episode(`jw:930-770002-${index + 1}`, 'jw:930-770002', {
      episodeNumber: index + 1,
      titles: [title('en', index === 0 ? 'Refused 1' : index === 8 ? 'Refused 8' : `Provider Take ${index + 1}`)],
    })),
  })),
]

// ONE WRONG UPSTREAM DATE, AND THE TWO ROWS IT COSTS. Measured on `ag:(anilist:127720)` (Mushoku
// Tensei cour 2) on 2026-09-13, through the trace panel and then against ani.zip itself: ani.zip
// publishes episode 12 with EPISODE 1's air date (`airDate 2021-10-04` on both rows of
// `api.ani.zip/mappings?anidb_id=15954`), and it is the run's ONLY dated origin, because Kitsu ships
// neither a date nor a title for any of its twelve. Crunchyroll's season carries all 24 rows with the
// right dates and the run's own titles.
//
// Rule 1 then loses the FIRST and LAST row of the run to that one date, two different ways: their row
// 12 reaches the doubled day, where `{1, 12}` is reachable and the row is refused as ambiguous, and
// their row 23 reaches nothing at all, because the reference row numbered 12 is stamped in October.
// Ten of twelve paired, and on the page that is no Crunchyroll button on episode 1 or episode 12.
const GAP_COUR1 = weekly('2021-01-11', 11)
const GAP_COUR2 = weekly('2021-10-04', 12)
const GAP_BROADCAST = weekly('2021-10-03', 12)
const GAP_TITLES = [
  'The Woman with the Demon Eyes', 'Missed Connections', 'No Such Thing As a Free Lunch',
  'Slow Life in the Doldia Village', 'Family Squabble', 'Reunion', 'Separate Journeys',
  'Route Selection', 'The Birth of My Little Sister the Maid', 'Turning Point 2',
  'Dreams and Reality', 'Wake Up and Take a Step',
]
const gapAnswers = async () => [
  await answer('media', media('anilist:940', {
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 12, startDate: GAP_BROADCAST[0],
    titles: [title('en', 'One Bad Date Part 2')],
    handles: [sameAs(media('anizip:940', {})), sameAs(media('kitsu:940', {}))],
  })),
  await answer('media', media('anizip:940', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'One Bad Date Part 2')],
    episodes: GAP_BROADCAST.map((day, index) => episode(`anizip:940-${index + 1}`, 'anizip:940', {
      episodeNumber: index + 1,
      // THE BAD ROW, verbatim: the last episode carries the first one's day
      releaseDate: anizipDay(index === 11 ? GAP_BROADCAST[0]! : day),
      titles: [title('en', GAP_TITLES[index]!)],
    })),
  })),
  // Kitsu's real answer on this run: twelve rows, no date and no title on any of them, so it can
  // neither break the doubled day nor supply the missing one
  await answer('media', media('kitsu:940', {
    score: 0.7, type: 'TV', status: 'FINISHED', episodeCount: 12, titles: [title('en', 'One Bad Date Part 2')],
    episodes: Array.from({ length: 12 }, (_, index) =>
      episode(`kitsu:940-${index + 1}`, 'kitsu:940', { episodeNumber: index + 1 })),
  })),
  // the lend: one Crunchyroll season of 24, its rows 12 to 23 being this run's 1 to 12, plus an OVA
  await answer('media', media('cr:G940', {
    score: 0.5, type: 'TV', status: 'FINISHED', titles: [title('en', 'One Bad Date')],
    episodes: [
      ...GAP_COUR1.map((day, index) => episode(`cr:G940-${index + 1}`, 'anilist:940', {
        episodeNumber: index + 1, releaseDate: day, titles: [title('en', `Cour One ${index + 1} of the Same Show`)],
      })),
      ...GAP_COUR2.map((day, index) => episode(`cr:G940-${index + 12}`, 'anilist:940', {
        episodeNumber: index + 12, releaseDate: day, titles: [title('en', GAP_TITLES[index]!)],
      })),
      episode('cr:G940-24', 'anilist:940', {
        episodeNumber: 24, releaseDate: '2022-03-16', titles: [title('en', 'Eris the Goblin Slayer')],
      }),
    ],
  })),
]

// THE RUN WHOSE LENGTH CAME FROM A MEMBER THAT LISTS NOTHING. Measured on `ag:(anilist:146065)`,
// Mushoku Tensei season 2 cour 1, 2026-09-13: the panel reads `run length 13 from anilist:146065,
// tier 0.8, witnesses 1`, AniList publishes a count and no episode row, and the twelve rows the
// cluster draws are ani.zip's and Kitsu's, neither of which states 13. So `runLengthFrom` named the
// one member with no list, the reference was EMPTY, and the route placed nothing from anybody:
// Netflix refused `retranslates` and Crunchyroll's lend refused in silence. Its neighbour
// `ag:(anilist:166873)` reads `12 from anilist, anizip, kitsu`, witnesses 3, and places 22 pairs
// against the same two containers, which is the contrast that named the cause.
//
// The numbers here are that shape and not that show's titles: 13 declared against twelve listed, one
// catalogue at 0.8 alone at its tier, and a retranslating season of 25 over it.
const COUNT_ONLY_DAYS = weekly('2023-07-09', 12)
const countOnlyAnswers = async () => [
  await answer('media', media('anilist:980', {
    // NO `episodes` KEY AT ALL, which is the whole case: a catalogue that states a count and lists
    // nothing can win the vote and can never be a reference
    score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 13, startDate: COUNT_ONLY_DAYS[0],
    titles: [title('en', 'Counted But Never Listed')],
    handles: [
      sameAs(media('anizip:980', {})),
      sameAs(media('kitsu:980', {})),
      partOf(media('nf:80999970-2', { score: 0.2 })),
    ],
  })),
  await answer('media', media('anizip:980', {
    type: 'TV', episodeCount: 12, titles: [title('en', 'Counted But Never Listed')],
    episodes: CANON_S2.slice(0, 12).map((name, index) => episode(`anizip:980-${index + 1}`, 'anizip:980', {
      episodeNumber: index + 1, releaseDate: anizipDay(COUNT_ONLY_DAYS[index]!), titles: [title('en', name)],
    })),
  })),
  // Kitsu's twelve, dateless and titleless, exactly as it answers on the live route: it numbers in the
  // run's own space and therefore stands beside ani.zip in the reference, and it anchors nothing
  await answer('media', media('kitsu:980', {
    score: 0.3, type: 'TV', status: 'FINISHED', episodeCount: 12, titles: [title('en', 'Counted But Never Listed')],
    episodes: Array.from({ length: 12 }, (_, index) =>
      episode(`kitsu:980-${index + 1}`, 'kitsu:980', { episodeNumber: index + 1 })),
  })),
  await answer('media', media('nf:80999970-2', {
    score: 0.2, type: 'TV', status: 'FINISHED', episodeCount: 25,
    titles: [title('en', 'Counted But Never Listed')],
    episodes: NETFLIX_S2.map((name, index) => episode(`nf:80999970-2-${index + 1}`, 'nf:80999970-2', {
      episodeNumber: index + 1, titles: [title('en', name ?? `Episode ${index + 1}`)],
    })),
  })),
]

beforeAll(async () => {
  await enableGraph(true)
  await ingestAnswers([
    ...await mushokuAnswers(),
    ...await samuraiAnswers(),
    ...await exorcistAnswers(),
    ...await fmaAnswers(),
    ...await windowAnswers(),
    ...await lendAnswers(),
    ...await skewAnswers(),
    ...await skewSeasonAnswers(),
    ...await claimAnswers(),
    ...await sequenceAnswers(),
    ...await refusalAnswers(),
    ...await gapAnswers(),
    ...await countOnlyAnswers(),
  ])
  resetPassState()
  await runPass()
}, 300_000)

afterAll(async () => {
  await closeGraph()
})

// ---------------------------------------------------------------------------------------------
// 8.1, the fold end to end.

// ONE SEASON, TWO COURS, TWO RANGES, TWENTY-THREE PAIRS. Crunchyroll's 1 to 11 are cour 1's and its
// 12 to 23 are cour 2's, and the only thing that says so is the day both sides published.
// Mutation: drop `DAY_SLACK` to 0 (the Tokyo day is one day later than ani.zip's stamp) and every one
// of the 23 pairs disappears, which is the whole fold going unproven.
test('8.1 Crunchyroll season 1 pairs eleven rows onto cour 1 and twelve onto cour 2', async () => {
  const pairs = await pairsFrom('cr:G24H1N3MP-G609CX3J4')
  expect(pairs).toHaveLength(23)

  const cour1 = pairs.filter(row => String(row.toUri).startsWith('anizip:14758'))
  expect(cour1.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual(
    Array.from({ length: 11 }, (_, index) => [index + 1, index + 1])
  )
  const cour2 = pairs.filter(row => String(row.toUri).startsWith('anizip:14759'))
  expect(cour2.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual(
    Array.from({ length: 12 }, (_, index) => [index + 12, index + 1])
  )

  // the evidence of 3.4, verbatim: the day the candidate published and how far it sits from ours
  expect(evidenceOf(cour1[0]!)).toEqual({ day: dayOf(MUSHOKU_C1_TOKYO[0]!), slack: 1 })
  expect(cour1.every(row => row.reason === 'dates' && Number(row.confidence) === 1)).toBe(true)
  // a trace descends by `supports`: their hang, our hang, and the `PART_OF` it was reached through
  expect((cour1[0]!.supports as string[]).length).toBeGreaterThanOrEqual(3)
})

// A BUTTON IS A PAIR, NEVER AN OFFSET (3.4): the special at position 24 costs ITSELF its link and
// nothing else, where an offset would have shifted every row after it.
// Mutation: pair a row whose day reaches no reference number onto its own number and the special
// lands on cour 1's non-existent episode 24, or on cour 2's 12 if an offset is applied instead.
test('8.1 the special at 24 pairs with nothing, and costs no other row its pair', async () => {
  const pairs = await pairsFrom('cr:G24H1N3MP-G609CX3J4')
  expect(pairs.some(row => Number(row.fromNumber) === 24)).toBe(false)
  expect(new Set(pairs.map(row => row.fromUri)).size, 'one edge per episode').toBe(23)
})

// THE RANGE OF 3.4, as literal properties, one per cour, with the `PART_OF` untouched under it.
// Mutation: take the hull from the candidate's own count (1 to 24) instead of from the pairs and cour
// 1's range reads `fromEnd: 24`, which labels the page "episodes 1 to 24" for an eleven episode run.
test('8.1 two INCLUDES rows carry the two ranges, and the PART_OF stays', async () => {
  const links = await rangeLinks()
  const cour1 = links.find(row => row.toUri === 'anilist:108465')
  const cour2 = links.find(row => row.toUri === 'anilist:127720')

  expect({
    kind: cour1?.kind, status: cour1?.status, reason: cour1?.reason,
    fromStart: Number(cour1?.fromStart), fromEnd: Number(cour1?.fromEnd),
    toStart: Number(cour1?.toStart), toEnd: Number(cour1?.toEnd),
    contiguous: cour1?.contiguous, aligned: Number(cour1?.aligned), total: Number(cour1?.total),
  }).toEqual({
    kind: 'INCLUDES', status: 'active', reason: 'dates',
    fromStart: 1, fromEnd: 11, toStart: 1, toEnd: 11, contiguous: true, aligned: 11, total: 24,
  })
  expect({
    fromStart: Number(cour2?.fromStart), fromEnd: Number(cour2?.fromEnd),
    toStart: Number(cour2?.toStart), toEnd: Number(cour2?.toEnd),
    contiguous: cour2?.contiguous, aligned: Number(cour2?.aligned), total: Number(cour2?.total),
  }).toEqual({ fromStart: 12, fromEnd: 23, toStart: 1, toEnd: 12, contiguous: true, aligned: 12, total: 24 })

  const claimed = await linksBetween('anilist:108465', 'cr:G24H1N3MP-G609CX3J4')
  const partOfRow = claimed.find(row => row.kind === 'PART_OF' && row.by === 'plugin:direct')
  expect({ status: partOfRow?.status, reason: partOfRow?.reason }).toEqual({ status: 'active', reason: 'asserted' })
})

// TWO `PART_OF` ROWS REACH ONE SEASON HERE (`plugin:direct`'s `asserted` and `plugin:containment`'s
// `span` on cour 2), the scan returns a row per link per episode, and the engine's order inside an
// ORDER BY tie is not stable between passes. Unsorted, `supports` flips between two spellings of one
// list and every edge derived from it is rewritten on every iteration.
// Mutation: drop `candidate.via.sort(compare)` and this reddens on the runs where the engine hands
// the two links over the other way, and the pass then reports `fixed-point-cap` (measured 2026-09-12:
// 11 rewritten `EPISODE_LINK` rows per iteration, on about half the runs).
test('the keys a pair was derived from are in a stable order', async () => {
  const reached = await linksBetween('anilist:127720', 'cr:G24H1N3MP-G609CX3J4')
  expect(reached.filter(row => row.kind === 'PART_OF' && row.status === 'active').map(row => row.reason).sort())
    .toEqual(['asserted', 'span'])

  const pairs = await pairsFrom('cr:G24H1N3MP-G609CX3J4')
  const cour2 = pairs.filter(row => String(row.toUri).startsWith('anizip:14759'))
  for (const row of cour2) {
    // their hang, our hang, then the `LINK` keys, which are the part that has to be ordered
    const supports = row.supports as string[]
    expect(supports).toHaveLength(4)
    expect(supports.slice(2)).toEqual([...supports.slice(2)].sort())
  }
  const range = (await rangeLinks()).find(row => row.toUri === 'anilist:127720')
  expect(range!.supports as string[]).toEqual([...(range!.supports as string[])].sort())
})

// ---------------------------------------------------------------------------------------------
// 8.2, the renumbering.

// THE ALIGNMENT AMONG MEMBERS is the same rule with a second member in place of the season, and it
// mints no `SAME_AS` because the row is already a member.
// Mutation: drop class 3 (a member origin whose numbering does not fit `1..runLength`) and the eight
// Crunchyroll rows keep 13 to 20, which is the twenty-row page `consensus.ts:93-97` records.
test('8.2 Crunchyroll 13 to 20 pairs with the run 1 to 8, and no range is drawn', async () => {
  const pairs = await pairsFrom('cr:GQWH0M19X-GS00366034')
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual(
    Array.from({ length: 8 }, (_, index) => [index + 13, index + 1])
  )
  // the pair names the row whose DAY proved it, never Kitsu's undated row of the same number
  expect(pairs.every(row => String(row.toUri).startsWith('anizip:18903'))).toBe(true)
  expect(evidenceOf(pairs[0]!)).toEqual({ day: dayOf(SAMURAI[0]!), slack: 0 })

  const links = await rangeLinks()
  expect(links.filter(row => row.fromUri === 'cr:GQWH0M19X-GS00366034'), 'a member is given no range').toEqual([])
})

// WHAT THE PAIRS ARE FOR (5.4 P5): a season row is in NO cluster, so its episodes reach the page
// only through them, at the pair's `toNumber` and marked `aligned by dates` in the trace. Eleven rows
// on cour 1 and twelve on cour 2, each naming its own hang and the pair beside it.
// Mutation: return an empty list from `alignedFillsOf` and 8.1's page loses every play button while
// the twenty-three pairs still sit in the graph proving nothing, which is what the store did before
// this step: a pair with no fill behind it is a measurement nobody reads.
test('8.1 the Crunchyroll rows fill both cours by their pairs, and the special fills nothing', async () => {
  const own = (uri: string): number => Number(uri.slice(uri.lastIndexOf('-') + 1))
  const all = (await fillsFrom('cr:G609CX3J4-')).sort((a, b) => own(a.uri) - own(b.uri))
  // the season row is a RUN cluster of its own and draws its own 24 rows there, which is the page a
  // season uri resolves to; the two cours are the clusters a pair had to reach
  const inCluster = (id: string) => all.filter(fill => fill.slot.startsWith(`${id}#`))
  const cour1 = inCluster(await clusterIdOf('anilist:108465'))
  const cour2 = inCluster(await clusterIdOf('anilist:127720'))
  expect([...cour1, ...cour2].every(fill => fill.via === 'aligned'), 'no member of either cour hung one of these')
    .toBe(true)

  expect(cour1.map(fill => [own(fill.uri), fill.number]), 'their 1 to 11 onto the run 1 to 11').toEqual(
    Array.from({ length: 11 }, (_, index) => [index + 1, index + 1])
  )
  // cour 2: their 12 to 23 land on slots 1 to 12, which is the renumbering the user sees
  expect(cour2.map(fill => [own(fill.uri), fill.number])).toEqual(
    Array.from({ length: 12 }, (_, index) => [index + 12, index + 1])
  )
  expect(new Set(cour1.map(fill => fill.slot)).size, 'eleven distinct slots').toBe(11)
  expect(new Set(cour2.map(fill => fill.slot)).size, 'and twelve more, in the other cluster').toBe(12)
  expect([...cour1, ...cour2].some(fill => fill.uri === 'cr:G609CX3J4-24'),
    'the special pairs with nothing and reaches neither cour').toBe(false)

  // A TRACE DESCENDS FROM THE BUTTON TO THE CLAIM (3.2): the row's own hang and the pair that placed it
  const [pair] = await rowsOf(
    `MATCH (a:Episode {uri: 'cr:G609CX3J4-1'})-[l:EPISODE_LINK]->(b:Episode {uri: 'anizip:14758-1'})
     RETURN l.key AS key`
  )
  const first = cour1.find(fill => fill.uri === 'cr:G609CX3J4-1')!
  expect(first.supports, 'the hang and the pair, and nothing invented').toHaveLength(2)
  expect(first.supports, 'the pair is named by its key').toContain(String(pair!.key))

  // AND THE VIEW SAYS SO (6.4): the materialized row carries `via` per handle, which is what draws
  // "aligned by dates" under the play button rather than a badge nobody can explain
  const [cluster] = await rowsOf(
    "MATCH (m:Media {uri: 'anilist:108465'})-[:MEMBER_OF]->(c:Cluster) RETURN c.episodes AS episodes"
  )
  const episodes = JSON.parse(String(cluster!.episodes)) as { handles: { via: string, node: { uri: string } }[] }[]
  const handles = episodes[0]!.handles
  expect(handles.find(handle => handle.node.uri === 'cr:G609CX3J4-1')?.via).toBe('aligned')
  expect(handles.find(handle => handle.node.uri === 'anizip:14758-1')?.via).toBe('member')
})

// A FOREIGN ROW WITH NO PAIR FILLS NOTHING (4.4, 5.4 P5). The lent season's first twelve rows are the
// PREVIOUS cour's: they are hung on this run's member, they carry dates and numbers, and the only
// thing that keeps them off the page is that no day of theirs met a reference day.
// Mutation: pair every episode with every row carrying the same number (drop the `EPISODE_LINK` join
// from `readAlignedRows` and take `b.episodeNumber` as the target) and all twenty-four land on cour
// 2's twelve rows, which is the positional loan verbatim: cour 1's episodes under cour 2's urls.
test('a lent row that pairs with nothing reaches no slot, while its paired neighbours do', async () => {
  const fills = await fillsFrom('cr:GSP1-')
  const numbered = fills.map(fill => Number(fill.uri.split('-')[1])).sort((a, b) => a - b)
  expect(numbered, 'only the twelve that paired').toEqual(Array.from({ length: 12 }, (_, index) => index + 13))
  expect(fills.every(fill => fill.via === 'aligned')).toBe(true)
  expect(fills.map(fill => fill.number).sort((a, b) => (a ?? 0) - (b ?? 0)))
    .toEqual(Array.from({ length: 12 }, (_, index) => index + 1))
  expect(fills.every(fill => fill.supports.length === 2), 'the hang and the pair').toBe(true)
})

// 8.2 THROUGH THE VIEW: the Crunchyroll rows are MEMBERS here, so they fill by the member rule, and
// the number they fill at is the pair's (`consensus.ts:247-251`, "the stored node keeps Crunchyroll's
// own number"). `via` says where the number came from (3.2), which is the pair and not the row.
// Mutation: drop the `renumber` lookup in `slotsOf`'s `numberOf` and the eight rows sit at 13 to 20,
// which is the twenty-row page; keep the renumbering and stamp `member` and the trace claims
// Crunchyroll numbered them 1 to 8 itself.
test('8.2 the renumbered member rows fill 1 to 8, and say a pair put them there', async () => {
  const fills = await fillsFrom('cr:GS00366034-')
  expect(fills.map(fill => [Number(fill.uri.split('-')[1]), fill.number])).toEqual(
    Array.from({ length: 8 }, (_, index) => [index + 13, index + 1])
  )
  expect(fills.every(fill => fill.via === 'aligned')).toBe(true)
  expect(fills.every(fill => fill.slotNumber === fill.number), 'each shares the slot it renumbered onto').toBe(true)
  expect(fills.every(fill => fill.supports.length === 2), 'its own hang and the pair').toBe(true)

  // and the slot it joined is anizip's, which is what makes it one row rather than twenty
  const [slot] = await rowsOf(
    `MATCH (e:Episode {uri: 'cr:GS00366034-13'})-[:FILLS]->(s:Slot)<-[:FILLS]-(o:Episode)
     RETURN collect(o.uri) AS uris`
  )
  expect((slot!.uris as string[]).sort()).toEqual(['anizip:18903-1', 'cr:GS00366034-13', 'kitsu:49265-1'])
})

// ---------------------------------------------------------------------------------------------
// 8.3, the special that broke the offset vote.

// NETFLIX MINTS NOTHING, and the refusal is a row rather than a silence. The rows here carry OUR
// titles, so 25 of 26 would match exactly and rule 2 would fire at 0.96 coverage: the only thing
// stopping it is `retranslates`, measured at 4 exact of 25 with the best wrong pair above the true
// one (2026-09-10).
// Mutation: delete the `retranslates` branch of `decideCandidate` and 25 pairs appear, 13 of them on
// the wrong row, which is exactly the failure 8.3 records.
test('8.3 Netflix pairs nothing and writes why: retranslates', async () => {
  const pairs = await pairsFrom('nf:70304252-1')
  expect(pairs).toEqual([])

  const refusedRow = (await rangeLinks()).find(row => row.fromUri === 'nf:70304252-1')
  expect({ kind: refusedRow?.kind, status: refusedRow?.status, reason: refusedRow?.reason }).toEqual({
    kind: 'INCLUDES', status: 'refused', reason: 'retranslates',
  })
  expect(evidenceOf(refusedRow!)).toEqual({ reason: 'retranslates', theirs: 26, ours: 25 })

  const claimed = await linksBetween('anilist:6702', 'nf:70304252-1')
  expect(claimed.find(row => row.by === 'plugin:direct' && row.kind === 'PART_OF')?.status).toBe('active')
})

// ---------------------------------------------------------------------------------------------
// 8.4, 64 episodes in five seasons.

// PAIRS FOUND AND THE CONTAINER NOT LONGER: pairs only, and the `PART_OF` stays. Every one of season
// 1's thirteen rows pairs, which under the deleted rule 3 would have made it the same thing as a run
// of 64.
// Mutation: restore "every episode paired, therefore SAME_AS" and a 13 episode season welds into a 64
// episode run, which is the BAKI weld (2026-09-10) by another route. Mutation for the range half:
// emit the hull whenever pairs are found, whatever the candidate's length, and five seasons label a
// run they are pieces of, which also stops the pass reaching a fixed point (measured 2026-09-12).
test('8.4 five seasons pair by date, none is given a range, and none becomes a SAME_AS', async () => {
  const paired = await Promise.all([1, 2, 3, 4, 5].map(season => pairsFrom(`cr:FMA-S${season}`)))
  expect(paired.map(pairs => pairs.length)).toEqual([13, 13, 13, 13, 12])
  // season 2 numbers its own rows 1 to 13 and they are the run's 14 to 26: there is no offset
  // anywhere, only pairs, so a season's own numbering never reaches the page
  expect(paired[1]!.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual(
    Array.from({ length: 13 }, (_, index) => [index + 1, index + 14])
  )

  const links = await rangeLinks()
  expect(links.filter(row => String(row.fromUri).startsWith('cr:FMA-')), 'a shorter season labels nothing').toEqual([])
  const sameAsRows = await rowsOf(
    `MATCH (a:Media)-[l:LINK]->(b:Media)
     WHERE l.kind = 'SAME_AS' AND l.status = 'active' AND b.uri STARTS WITH 'cr:FMA-'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.by AS by`
  )
  expect(sameAsRows, 'no upgrade to SAME_AS at any coverage').toEqual([])
})

// NO PLUGIN MINTS A MEDIA `SAME_AS` HERE, anywhere in the graph, whatever the pairs prove (rule 3 was
// deleted from 5.4 P4).
// Mutation: propose one `SAME_AS` from a proven candidate and this case names it.
test('plugin:range never mints a SAME_AS between media', async () => {
  const minted = await rowsOf(
    "MATCH (a:Media)-[l:LINK]->(b:Media) WHERE l.by = 'plugin:range' AND l.kind <> 'INCLUDES' RETURN l.kind AS kind"
  )
  expect(minted).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// Rule 3, by SEQUENCE, and 3.4a's closure, through the graph.

// THE CLOSURE OF 3.4a, END TO END, on the measured Netflix season 2: no date on their side and
// retranslated titles, so rule 1 cannot fire and rule 2 is refused outright, and what places all
// twenty-four buttons is four exact titles, three equal-gap brackets and ONE located special.
// Mutation: drop the `closeWithSpecials` call from `pairsBySequence` and this falls to the seven
// pairs the anchors and their brackets prove, with rows 2 to 5 and 13 to 25 unpaired; compare the
// special's title EXACTLY rather than by tokens and `Fitz the Guardian` stops locating `Guardian
// Fitz`, so the surplus is unaccounted and the same seven are all that is left.
test('3.4a the located special closes the alignment, and the anchors agree with the closure', async () => {
  const pairs = await pairsFrom('nf:80987039-2')
  expect(pairs).toHaveLength(24)
  // rows 2 to 25 onto canonical 1 to 24: the whole packaging, one row late, proven rather than shifted
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)]))
    .toEqual(Array.from({ length: 24 }, (_, index) => [index + 2, index + 1]))
  expect(pairs.every(row => row.reason === 'sequence' && row.status === 'active')).toBe(true)
  expect(pairs.every(row => Number(row.confidence) === 1), 'order is not a score').toBe(true)
  // the insertion itself pairs with NOTHING: a special has no number, so no slot admits it (5.4 P5)
  expect(pairs.some(row => Number(row.fromNumber) === 1)).toBe(false)

  // THE FOUR ANCHORS SIT WHERE THE CLOSURE PREDICTS, which is the alignment proving itself
  const anchors = pairs.filter(row => 'anchor' in evidenceOf(row))
  expect(anchors.map(row => [Number(row.fromNumber), Number(row.toNumber)]))
    .toEqual([[6, 5], [8, 7], [10, 9], [12, 11]])
  expect(evidenceOf(anchors[0]!)).toEqual({ anchor: stripTitle('Ranoa University of Magic') })
  // the three an equal-gap bracket forced, each naming the two anchors it sits between
  const forced = pairs.filter(row => 'between' in evidenceOf(row))
  expect(forced.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual([[7, 6], [9, 8], [11, 10]])
  expect(evidenceOf(forced[0]!)).toEqual({ between: ['nf:80987039-2-6', 'nf:80987039-2-8'] })
  // and the seventeen the closure placed, each naming the special that accounted for the surplus
  const closure = pairs.filter(row => 'closed' in evidenceOf(row))
  expect(closure).toHaveLength(17)
  expect(evidenceOf(closure[0]!)).toEqual({ closed: ['anizip:18103-S1'] })
  expect(closure.map(row => Number(row.fromNumber)), 'the head and the untitled tail alike')
    .toEqual([2, 3, 4, 5, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25])

  // THE RANGE OF 3.4, with the shape of the alignment written beside it
  const range = (await rangeLinks()).find(row => row.fromUri === 'nf:80987039-2')
  expect({
    kind: range?.kind, status: range?.status, reason: range?.reason,
    fromStart: Number(range?.fromStart), fromEnd: Number(range?.fromEnd),
    toStart: Number(range?.toStart), toEnd: Number(range?.toEnd),
    contiguous: range?.contiguous, aligned: Number(range?.aligned), total: Number(range?.total),
  }).toEqual({
    kind: 'INCLUDES', status: 'active', reason: 'sequence',
    fromStart: 2, fromEnd: 25, toStart: 1, toEnd: 24, contiguous: true, aligned: 24, total: 25,
  })
  // `scored: 0` and `synopsis: 0` are the whole of what the two 2026-09-13 anchor changes did to this
  // walkthrough: four exact anchors bracket it, so neither fallback was consulted and the range is an
  // equality's. `consensus: null` says the synopsis anchors were never asked for an offset
  expect(evidenceOf(range!)).toEqual({
    rule: 'sequence', theirs: 25, ours: 24, anchors: 4, scored: 0, synopsis: 0, consensus: null,
    forced: 3, closure: 17, unequal: 0, closed: true,
  })
  // the `PART_OF` that reached it is untouched, in this branch as in every other
  expect((await linksBetween('anilist:146065', 'nf:80987039-2'))
    .some(row => row.kind === 'PART_OF' && row.status === 'active')).toBe(true)

  // WHAT THE PAIRS ARE FOR (5.4 P5): twenty-four Netflix buttons on the run's own rows, and none on
  // a row the run does not have
  // the season row is a RUN cluster of its own and draws its own 25 rows there, so the fills are
  // filtered to the run's cluster, and sorted by position because `-10` sorts before `-2` by uri
  const position = (uri: string): number => Number(uri.slice('nf:80987039-2-'.length))
  const cluster = await clusterIdOf('anilist:146065')
  const fills = (await fillsFrom('nf:80987039-2-'))
    .filter(fill => fill.slot.startsWith(`${cluster}#`))
    .sort((a, b) => position(a.uri) - position(b.uri))
  expect(fills).toHaveLength(24)
  expect(fills.every(fill => fill.via === 'aligned')).toBe(true)
  expect(fills.map(fill => [position(fill.uri), fill.number]))
    .toEqual(Array.from({ length: 24 }, (_, index) => [index + 2, index + 1]))
  expect(fills.every(fill => fill.supports.length === 2), 'its own hang and the pair').toBe(true)
})

// RULE 3'S TWO REFUSALS ARE ROWS, not silences, on the `LINK` that reached the candidate.
// Mutation: drop the `unequal-gap` branch of `decideCandidate` and the second one reads `no-titles`,
// which says the titles missed a bar rather than that the counting refused; force a region whatever
// its gap and it mints seven pairs instead; mint the anchors whenever there are two of them and it
// mints its two, which is an exact title placing a button with rule 2's bar unmet.
test('rule 3 writes down which half of its alignment failed', async () => {
  const links = await rangeLinks()
  const noAnchor = links.find(row => row.fromUri === 'jw:930-770001')
  expect({ kind: noAnchor?.kind, status: noAnchor?.status, reason: noAnchor?.reason })
    .toEqual({ kind: 'INCLUDES', status: 'refused', reason: 'no-anchors' })
  expect(evidenceOf(noAnchor!)).toEqual({ reason: 'no-anchors', theirs: 9, ours: 8 })

  const unequal = links.find(row => row.fromUri === 'jw:930-770002')
  expect({ kind: unequal?.kind, status: unequal?.status, reason: unequal?.reason })
    .toEqual({ kind: 'INCLUDES', status: 'refused', reason: 'unequal-gap' })
  expect(evidenceOf(unequal!)).toEqual({ reason: 'unequal-gap', theirs: 9, ours: 8 })

  // and NEITHER pairs anything: the two anchors of the second one are kept as anchors and minted as
  // nothing, since order placed no row and an exact title is rule 2's evidence, held to rule 2's bar
  expect(await pairsFrom('jw:930-770001')).toEqual([])
  expect(await pairsFrom('jw:930-770002')).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// The window, the lend, and the pass.

// A PAIR ONTO A ROW OUTSIDE `1..runLength` IS DROPPED (`consensus.ts:185-191`). ani.zip lists twelve
// rows for a run its own sources say is eleven long, so the twelfth pair would put a playable url on
// a row the run does not have.
// Mutation: apply the window after the `MIN_ALIGNED` test instead of before it, or drop it, and the
// twelfth pair survives and the range reads `aligned: 12, toEnd: 12` for an eleven episode run.
test('a pair whose toNumber falls outside the run is dropped, and the range shrinks with it', async () => {
  const pairs = await pairsFrom('cr:900')
  expect(pairs.map(row => Number(row.toNumber))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

  const range = (await rangeLinks()).find(row => row.fromUri === 'cr:900')
  expect({ toEnd: Number(range?.toEnd), aligned: Number(range?.aligned), total: Number(range?.total) })
    .toEqual({ toEnd: 11, aligned: 11, total: 12 })
})

// THE TRANSITIONAL LEND (4.4): rows a FOREIGN claimer hung on a member are evidence and never a slot.
// The season's first twelve are the PREVIOUS cour's and pair with nothing, which is the positional
// loan's whole defect: it put cour 1's episodes on cour 2's page with playable urls.
// Mutation: drop the class 2 scan and the twelve provable buttons disappear; accept the lend by
// NUMBER instead of by day and cour 1's twelve land on cour 2's rows 1 to 12.
test('a lent season is paired by day and given no range', async () => {
  const pairs = await rowsOf(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     WHERE l.by = 'plugin:range' AND a.uri STARTS WITH 'cr:GSP1-'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.fromNumber AS fromNumber, l.toNumber AS toNumber
     ORDER BY l.fromNumber`
  )
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)])).toEqual(
    Array.from({ length: 12 }, (_, index) => [index + 13, index + 1])
  )
  expect(pairs.every(row => String(row.toUri).startsWith('anizip:18104'))).toBe(true)
  expect((await rangeLinks()).filter(row => row.fromUri === 'cr:GSP1'), 'no season row, no label').toEqual([])
})

// THE SAME SHAPE THROUGH THE WHOLE PLUGIN, which is where a pair becomes a play button. This is the
// page-visible half of the defect: on `?store=graph` the first and last episode of the season carried
// no Crunchyroll handle while every episode between them did (2026-09-13, both stores measured).
// Mutation: return `[]` from `closeDatesWithTitles` and the twelve rows become ten, slots 1 and 12
// lose their `aligned` fill, and the reason column loses both `dates-gap` rows.
test('the two rows a bad upstream date cost are paired, labelled and filled', async () => {
  const pairs = await rowsOf(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     WHERE l.by = 'plugin:range' AND a.uri STARTS WITH 'cr:G940-'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.fromNumber AS fromNumber, l.toNumber AS toNumber,
       l.reason AS reason, l.status AS status, l.evidence AS evidence
     ORDER BY l.toNumber`
  )
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)]))
    .toEqual(Array.from({ length: 12 }, (_, index) => [index + 12, index + 1]))
  expect(pairs.map(row => String(row.reason)))
    .toEqual(['dates-gap', ...Array.from({ length: 10 }, () => 'dates'), 'dates-gap'])
  expect(pairs.every(row => String(row.status) === 'active')).toBe(true)
  expect(evidenceOf(pairs[0]!)).toEqual({ gap: stripTitle(GAP_TITLES[0]!) })
  expect(evidenceOf(pairs[11]!)).toEqual({ gap: stripTitle(GAP_TITLES[11]!) })
  // the eleven cour 1 rows and the OVA are reached by nothing, which is the right answer for them
  expect(pairs).toHaveLength(12)

  // WHAT THE PAIR IS FOR: every slot of the run carries the Crunchyroll row, the ends included
  const fills = await fillsFrom('cr:G940-')
  expect(fills.map(fill => [fill.uri, fill.number, fill.via]))
    .toEqual(Array.from({ length: 12 }, (_, index) => [`cr:G940-${index + 12}`, index + 1, 'aligned']))
})

// THE RUN THAT PLACED NOTHING FROM ANYBODY, end to end through the engine. `ag:(anilist:146065)` on
// 2026-09-13: the container attaches (`nf | PART_OF | active | containing`), the length is 13 from
// AniList alone, and one plugin later `nf | INCLUDES | refused | retranslates` with `EPISODE_LINK 0`
// in the counts. The cause is neither the container nor the titles: AniList lists no episode, so the
// side every rule measures against was empty.
// Mutation: return `{ reference: byVote, origins: voted }` unconditionally from `referenceEpisodes`
// and this case reads ZERO pairs and a refused `INCLUDES` (`no-reference` now, and `retranslates`
// again once the early return in `decideCandidate` goes too, which is the live panel verbatim).
// Mutate the run length in the first assertion instead and nothing here moves, which is the point:
// 13 is what the record says and it is not what was wrong.
test('a run whose length came from a member that lists nothing still places its episodes', async () => {
  const [length] = await rowsOf(
    `MATCH (m:Media {uri: 'anilist:980'})-[:MEMBER_OF]->(c:Cluster)
     RETURN c.runLength AS runLength, c.runLengthFrom AS runLengthFrom, c.runLengthWitnesses AS witnesses`
  )
  expect({
    runLength: Number(length?.runLength),
    from: length?.runLengthFrom as string[],
    witnesses: Number(length?.witnesses),
  }).toEqual({ runLength: 13, from: ['anilist:980'], witnesses: 1 })

  const pairs = await pairsFrom('nf:80999970-2')
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)]))
    .toEqual([[6, 5], [7, 6], [8, 7], [9, 8], [10, 9], [11, 10], [12, 11]])
  expect(pairs.every(row => String(row.toUri).startsWith('anizip:980-') && String(row.status) === 'active'))
    .toBe(true)
  expect(pairs.map(row => String(row.reason))).toEqual(Array.from({ length: 7 }, () => 'sequence'))

  // and the range the season now carries, where a refusal sat
  const range = (await rangeLinks()).find(row => row.fromUri === 'nf:80999970-2')
  expect({ status: range?.status, reason: range?.reason, total: Number(range?.total) })
    .toEqual({ status: 'active', reason: 'sequence', total: 25 })

  // WHAT A READER SEES: seven of the run's twelve slots carry a Netflix row, and none of the five the
  // alignment could not reach carries one anyway. Filtered to the RUN's own cluster, since the season
  // is a cluster of its own and every one of its rows fills a slot there under its own number
  const runCluster = await clusterIdOf('anilist:980')
  const fills = (await fillsFrom('nf:80999970-2-'))
    .filter(fill => fill.slot.startsWith(`${runCluster}#`))
    // by slot and not by uri, which `fillsFrom` orders on and which puts `-10` before `-6`
    .sort((a, b) => (a.slotNumber ?? 0) - (b.slotNumber ?? 0))
  expect(fills.map(fill => [fill.uri, fill.slotNumber]))
    .toEqual(Array.from({ length: 7 }, (_, index) => [`nf:80999970-2-${index + 6}`, index + 5]))
})

// THE SCHEDULE SKEW, AND THE VIDEO IT PUT ON THE WRONG ROW. Crunchyroll streams from a Thursday and
// ani.zip broadcasts from the Wednesday six days later, so Crunchyroll's N+1 falls one day after
// ani.zip's N: rule 1 minted eleven pairs `N+1` to `N`, Crunchyroll's "Prologue" paired with nothing,
// and `plugin:aggregate` filled slot 1 from episode 2. Both lists number 1 to 12 and the titles agree
// at each number, so rule 2 was right and rule 1 ran first (`anilist-208044`, summer 2026 corpus).
// Mutation: delete the `scheduleSkew` call from `decideCandidate` and the twelve pairs become eleven
// reading `[2,1] [3,2] ... [12,11]` by `dates`, with slot 1 carrying the second video.
test('a streaming schedule a few days off the broadcast one does not renumber the lend', async () => {
  const pairs = await rowsOf(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)
     WHERE l.by = 'plugin:range' AND a.uri STARTS WITH 'cr:GE003793'
     RETURN a.uri AS fromUri, b.uri AS toUri, l.fromNumber AS fromNumber, l.toNumber AS toNumber,
       l.reason AS reason, l.status AS status
     ORDER BY l.fromNumber`
  )
  expect(pairs.map(row => [Number(row.fromNumber), Number(row.toNumber)]))
    .toEqual(Array.from({ length: 12 }, (_, index) => [index + 1, index + 1]))
  expect(pairs.map(row => [String(row.reason), String(row.status)]))
    .toEqual(pairs.map(() => ['titles', 'active']))
  expect(pairs[0]!.fromUri, 'Crunchyroll\'s own first row').toBe('cr:GE00379302JAJP')
  expect(pairs[0]!.toUri, 'and ani.zip\'s first, not its second').toBe('anizip:19896-1')

  // WHAT THE BUG COST: the slot the user opens first. A pair one late puts episode 2's video here
  const fills = await fillsFrom('cr:GE003793')
  expect(fills.map(fill => [fill.uri, fill.number]))
    .toEqual(SKEW_TITLES.map((_, index) => [`cr:GE003793${String(index + 2).padStart(2, '0')}JAJP`, index + 1]))
  expect(fills.every(fill => fill.via === 'aligned'), 'a pair placed every one of them').toBe(true)
  const [slotOne] = await rowsOf(
    `MATCH (e:Episode {uri: 'cr:GE00379302JAJP'})-[:FILLS]->(s:Slot)<-[:FILLS]-(o:Episode)
     RETURN s.number AS number, collect(o.uri) AS uris`
  )
  expect(Number(slotOne!.number)).toBe(1)
  expect((slotOne!.uris as string[]).sort()).toEqual(['anizip:19896-1', 'cr:GE00379302JAJP'])
})

// THE SAME SKEW REACHES CLASS 1, and there the candidate has a row to write the refusal on. Nothing
// in `decideCandidate` knows which class asked it, which is why the guard lives in the rule and not
// in the candidate scan: a season attached by an uncertain `PART_OF` is renumbered by exactly the
// same eleven pairs. Its titles are its own, so rule 2 cannot rescue it and the honest answer is none.
// Mutation: delete the `scheduleSkew` call and eleven `dates` pairs appear reading `[2,1] ... [12,11]`
// with no refusal at all. Replace the guard with a `numbersOutsideRun` test on the class 2 scan, which
// is the shape of fix a lend-only reading suggests, and this case is renumbered exactly as before
// while the lend above loses all twelve of its pairs instead of getting the right ones (measured).
test('the skew reaches a season candidate too, and is refused in writing', async () => {
  expect(await pairsBetween('cr:910-', 'anizip:910-'), 'nothing rather than a guess').toEqual([])
  const refusal = (await rangeLinks()).filter(row => row.fromUri === 'cr:910')
  expect(refusal.map(row => [String(row.kind), String(row.status), String(row.reason)]))
    .toEqual([['INCLUDES', 'refused', 'date-skew']])
  expect(evidenceOf(refusal[0]!)).toMatchObject({ reason: 'date-skew', theirs: 12, ours: 12 })
  // and the `PART_OF` that reached it is untouched, in this branch as in every other
  expect((await linksBetween('anilist:910', 'cr:910')).some(row => row.kind === 'PART_OF' && row.status === 'active'))
    .toBe(true)
})

// THE SAME GRAPH TWICE IS THE SAME VIEW (5.1): the output is a desired set, so a second pass that
// wrote anything would mean the rule read something other than the graph.
// Mutation: key a pair on the arrival order of the scan (drop the `ORDER BY`, or the lowest-uri
// tie-break in `pairsByDay`) and a second pass rewrites edges.
test('a second pass over the same graph writes nothing', async () => {
  const again = await runPass()
  expect(again.changes).toEqual([])
  const { query } = await graphReady()
  expect((await checkInvariants(query)).counts).toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })
})

// ---------------------------------------------------------------------------------------------
// The fourth input: `EPISODE_CLAIMS`, placed rather than proven.

// A CLAIM INSIDE ONE RUN IS A PAIR, AND A CLAIM ACROSS TWO RUNS IS A REFUSAL WRITTEN DOWN. That is
// `db.ts:410`'s union with the guards it never had ("accepts a uri that was never set"), and the
// refused row is what makes "why is there no button here" a query rather than a silence.
// Mutation: return true from `placesClaim` and the foreign claim welds two runs' episodes, which is
// the union that had no guard; drop `status` from the writer's `EPISODE_LINK` row and the refusal is
// written ACTIVE, so a source's word alone places a play button.
test('an episode claim inside one cluster is asserted, and one across two runs is refused', async () => {
  const [asserted] = await pairsBetween('anilist:950-1', 'mal:950-1')
  expect({ status: asserted?.status, reason: asserted?.reason, by: asserted?.by }).toEqual({
    status: 'active', reason: 'asserted', by: 'plugin:range',
  })
  expect(Number(asserted?.confidence)).toBe(1)
  expect([Number(asserted?.fromNumber), Number(asserted?.toNumber)], "the two rows' own numbers").toEqual([1, 1])

  // `supports` names the claim, which is what a trace descends to the Answer through (3.2)
  const [claim] = await rowsOf(
    `MATCH (a:Episode {uri: 'anilist:950-1'})-[c:EPISODE_CLAIMS]->(b:Episode {uri: 'mal:950-1'})
     RETURN c.key AS key, c.kind AS kind, c.claimer AS claimer`
  )
  expect(claim!.kind).toBe('SAME_AS')
  expect(asserted?.supports).toEqual([String(claim!.key)])

  const [foreign] = await pairsBetween('anilist:960-1', 'kitsu:970-1')
  expect({ status: foreign?.status, reason: foreign?.reason }).toEqual({
    status: 'refused', reason: 'foreign-episode',
  })

  // and the refusal places nothing: a refused pair is not read by the view (5.4 P5)
  const fills = await fillsFrom('anilist:960-1')
  expect(fills.map(fill => fill.via), 'its own slot as a member, and no slot of the other run').toEqual(['member'])
})

// THE REFUSAL IS RE-DECIDED EVERY PASS, because its premise is the membership and nothing else: the
// two rows becoming one cluster flips it to active, and the cluster splitting flips it back. The row
// is UPDATED in place rather than deleted and re-created, which is the writer's diff on a property
// that moved (5.2) and what keeps a trace's key stable across the flip.
// Mutation: place a claimed row by the MEDIA it hangs on rather than by that media's CLUSTER (return
// `m.uri` from `MEMBER_EPISODE_SCAN`) and the weld places nothing, because two members of one cluster
// are then two different places, which is the union-by-uri this rule replaces.
test('a refused episode claim flips to active when the two rows become one cluster, and back', async () => {
  const statusOf = async () => (await pairsBetween('anilist:960-1', 'kitsu:970-1'))[0]
  const before = await statusOf()
  expect(before?.status).toBe('refused')

  // the weld: a source claim joining the two runs, which is `plugin:direct`'s class 0
  await ingestAnswers([
    await answer('media', media('anilist:960', {
      score: 0.8, type: 'TV', status: 'FINISHED', episodeCount: 2, startDate: CLAIMED[0],
      titles: [title('en', 'Foreign Left')],
      handles: [sameAs(media('kitsu:970', { score: 0.3 }))],
    })),
  ])
  await runPass()
  const welded = await statusOf()
  expect({ status: welded?.status, reason: welded?.reason }).toEqual({ status: 'active', reason: 'asserted' })
  expect(welded?.key, 'the same edge, updated in place').toBe(before?.key)

  // and the split, with only the two plugins that read membership: `plugin:direct` re-proposes from
  // the claim every pass, which is the sticky rule doing its job (5.2)
  const { query } = await graphReady()
  await query(
    `MATCH (a:Media {uri: 'anilist:960'})-[l:LINK]->(b:Media {uri: 'kitsu:970'})
     WHERE l.kind = 'SAME_AS' AND l.status = 'active' DELETE l`
  )
  await runPlugins([aggregatePlugin, rangePlugin], { reason: 'manual' })
  const split = await statusOf()
  expect({ status: split?.status, reason: split?.reason }).toEqual({ status: 'refused', reason: 'foreign-episode' })

  // back to the fixed point the cases after this one read
  await runPass()
  expect((await statusOf())?.status).toBe('active')
  // three full passes, which is over the 5 s default when the suites run side by side
}, 300_000)

// ---------------------------------------------------------------------------------------------
// The rules themselves, without an engine: every refusal `consensus.ts:105-110` records, and the two
// halves of rule 2's bar.

const side = (uri: string, number: number | null, day: string | null, keys: string[] = [], synopsis: string[] = []): SideEpisode =>
  ({ uri, origin: uri.slice(0, uri.indexOf(':')), number, day: day === null ? null : dayOf(day), keys, synopsis, hung: `h:${uri}` })

const listed = (prefix: string, from: number, days: string[]): SideEpisode[] =>
  days.map((day, index) => side(`${prefix}-${from + index}`, from + index, day))

// NOTHING RATHER THAN A GUESS, in every ambiguous case (`consensus.ts:105-110`).
// Mutation: drop the `reachable.size > 1` refusal and the doubled day pairs on whichever number the
// map happened to hold first; drop the `MIN_ALIGNED` bar and one shared day carries a whole season.
test('rule 1 refuses one shared day, a day naming two references, and an undated side', () => {
  const reference = listed('anizip:1', 1, weekly('2026-07-17', 12))

  const alone = pairsByDay(reference, listed('cr:1', 13, ['2026-07-17']))
  expect(alone.pairs).toHaveLength(1)
  expect(decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: alone.pairs.map(pair => pair.from) } }).ok)
    .toBe(false)
  expect(alone.pairs.length < MIN_ALIGNED, 'one shared date is a coincidence').toBe(true)

  // Hana-Kimi season 2 has episodes 1 and 2 both dated 2026-07-01, and Mushoku season 3 aired its
  // first two on one day: a day the run uses twice cannot say which episode a date belongs to
  const twice = [side('anizip:2-1', 1, '2026-07-01'), side('anizip:2-2', 2, '2026-07-01')]
  const doubled = pairsByDay(twice, [side('cr:2-5', 5, '2026-07-01'), side('cr:2-6', 6, '2026-07-01')])
  expect(doubled.pairs).toEqual([])
  expect(doubled.ambiguous, 'and it is reported as an ambiguity rather than as an absence').toBe(2)
  expect(decideCandidate({ runLength: 12, reference: twice, candidate: { retranslates: false, episodes: [side('cr:2-5', 5, '2026-07-01')] } }))
    .toEqual({ ok: false, reason: 'ambiguous-day' })

  const undated = [side('cr:3-13', 13, null)]
  expect(pairsByDay(reference, undated).pairs).toEqual([])
  expect(pairsByDay(undated, listed('cr:3', 1, weekly('2026-07-17', 3))).pairs).toEqual([])
  // OUR SIDE IS NUMBERED AND DATELESS, which is what `no-dates` is about. It was `reference: []` until
  // 2026-09-13, where the reason now reads `no-reference`, and the two are different findings
  const dateless = [side('anizip:3-1', 1, null), side('anizip:3-2', 2, null)]
  expect(decideCandidate({ runLength: 12, reference: dateless, candidate: { retranslates: false, episodes: undated } }))
    .toEqual({ ok: false, reason: 'no-dates' })
})

// THE DAY OF SLACK IS THE TOKYO BOUNDARY (`consensus.ts:136-140`), and it is accepted in both
// directions while the neighbour a week away stays out of reach.
// Mutation: set `DAY_SLACK` to 0 and the Crunchyroll pairing of 8.1 stops entirely; set it to 3 and
// two weekly episodes become reachable from one day, which the ambiguity refusal then eats.
test('rule 1 accepts a day of slack and records which way it went', () => {
  const reference = listed('anizip:4', 1, weekly('2021-01-10', 4))
  const tokyo = pairsByDay(reference, listed('cr:4', 1, weekly('2021-01-11', 4)))
  expect(tokyo.pairs.map(pair => [pair.fromNumber, pair.toNumber, (pair.evidence as { slack: number }).slack]))
    .toEqual([[1, 1, 1], [2, 2, 1], [3, 3, 1], [4, 4, 1]])

  const early = pairsByDay(reference, [side('cr:5-1', 1, '2021-01-09')])
  expect((early.pairs[0]!.evidence as { slack: number }).slack, 'a day early is a day of slack too').toBe(-1)
})

// RULE 2'S BAR IS TWO HALVES, and both are the measured constants (`similar.ts:59-69`).
// Mutation: lower `MIN_EPISODE_TITLE_MATCHES` to 2 and two shared recap names mint a season; drop the
// coverage half and a fold of two equal cours at 12/24 mints the fold the date rule is there to prove.
test('rule 2 needs three exact matches and 0.6 coverage of the candidate', () => {
  const reference = Array.from({ length: 24 }, (_, index) => side(`anizip:6-${index + 1}`, index + 1, null, [`title ${index + 1}`]))

  const two = Array.from({ length: 3 }, (_, index) => side(`cr:6-${index + 1}`, index + 1, null, index < 2 ? [`title ${index + 1}`] : ['unshared']))
  expect(pairsByTitle(reference, two).pairs).toHaveLength(2)
  expect(decideCandidate({ runLength: 24, reference, candidate: { retranslates: false, episodes: two } }))
    .toEqual({ ok: false, reason: 'no-titles' })

  const three = Array.from({ length: 3 }, (_, index) => side(`cr:7-${index + 1}`, index + 1, null, [`title ${index + 1}`]))
  const verdict = decideCandidate({ runLength: 24, reference, candidate: { retranslates: false, episodes: three } })
  expect(verdict.ok && verdict.rule).toBe('titles')
  expect(verdict.ok && verdict.pairs.map(pair => pair.toNumber)).toEqual([1, 2, 3])

  // THE FOLD'S SIGNATURE: twelve of a 24 row season match, which is 0.50 and refused, while a season
  // with a four episode bonus block scores 12/16 = 0.75 and is admitted (`similar.ts:60-66`)
  const fold = Array.from({ length: 24 }, (_, index) => side(`cr:8-${index + 1}`, index + 1, null, [`title ${index + 1}`]))
    .map((row, index) => (index < 12 ? row : side(row.uri, row.number, null, [`bonus ${index}`])))
  expect(pairsByTitle(reference, fold).coverage).toBeCloseTo(0.5, 5)
  expect(decideCandidate({ runLength: 24, reference, candidate: { retranslates: false, episodes: fold } }))
    .toEqual({ ok: false, reason: 'no-titles' })

  const bonus = fold.slice(0, 16)
  expect(pairsByTitle(reference, bonus).coverage).toBeCloseTo(0.75, 5)
  expect(decideCandidate({ runLength: 24, reference, candidate: { retranslates: false, episodes: bonus } }).ok).toBe(true)
})

// A KEY PRESENT TWICE ON EITHER SIDE CARRIES NO IDENTITY THERE, so it is skipped rather than guessed
// at, and a candidate reaching two different reference rows through two keys is an ambiguity.
// Mutation: keep the first row a duplicated key names and "Recap" pairs with whichever of the two
// rows the scan reached first, which is an arrival-order answer to an identity question.
test('rule 2 skips a key present twice, on either side', () => {
  const reference = [
    side('anizip:9-1', 1, null, ['recap']), side('anizip:9-2', 2, null, ['recap']),
    side('anizip:9-3', 3, null, ['third']), side('anizip:9-4', 4, null, ['fourth']),
  ]
  const theirs = [
    side('cr:9-1', 1, null, ['recap']), side('cr:9-2', 2, null, ['third']),
    side('cr:9-3', 3, null, ['fourth']), side('cr:9-4', 4, null, ['third', 'fourth']),
  ]
  const { pairs } = pairsByTitle(reference, theirs)
  // 'recap' is twice on ours, and 'third'/'fourth' are each twice on theirs once cr:9-4 carries both
  expect(pairs.map(pair => [pair.from.uri, pair.to.uri])).toEqual([])
})

// ---------------------------------------------------------------------------------------------
// RULE 1'S GAP CLOSURE. The shape below is the measured one, built from `SideEpisode` rows so the
// rule is asked directly rather than through a graph: ten pairs the days proved, and the two rows at
// the ENDS of the run that one wrong upstream date put out of the days' reach.

/** The measured Mushoku cour 2 shape: ours dated, with episode 12 carrying episode 1's day. */
const gapReference = (): SideEpisode[] =>
  GAP_BROADCAST.map((day, index) =>
    side(`anizip:940-${index + 1}`, index + 1, index === 11 ? GAP_BROADCAST[0]! : day, [GAP_TITLES[index]!]))

/** Their side: a season of 24 whose rows 12 to 23 are this run's 1 to 12, with the run's own titles. */
const gapTheirs = (): SideEpisode[] => [
  ...GAP_COUR1.map((day, index) =>
    side(`cr:G940-${index + 1}`, index + 1, day, [`Cour One ${index + 1} of the Same Show`])),
  ...GAP_COUR2.map((day, index) => side(`cr:G940-${index + 12}`, index + 12, day, [GAP_TITLES[index]!])),
  side('cr:G940-24', 24, '2022-03-16', ['Eris the Goblin Slayer']),
]

// Mutation: return `[]` from `closeDatesWithTitles` and the verdict drops to ten pairs with `gaps`
// gone, which is the defect this case was written from. Mutation: drop the `inWindow` around the
// closure in `decideCandidate` and nothing here moves, because every equality it takes is inside the
// run already; the window is proven by its own case below.
test('rule 1 closes the two rows one wrong upstream date cost it, and says which rule placed them', () => {
  const reference = gapReference()
  const theirs = gapTheirs()

  const dates = pairsByDay(reference, theirs)
  expect(dates.pairs.map(pair => [pair.fromNumber, pair.toNumber]),
    'the days reach ten of twelve, and neither end of the run')
    .toEqual(Array.from({ length: 10 }, (_, index) => [index + 13, index + 2]))
  expect(dates.ambiguous, 'their row 12 is refused on the doubled day rather than missed').toBe(1)

  const verdict = decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: theirs } })
  expect(verdict.ok && verdict.rule).toBe('dates')
  expect(verdict.ok && verdict.gaps, 'two rows placed by an equality and not by a day').toBe(2)
  expect(verdict.ok && verdict.pairs.map(pair => [pair.fromNumber, pair.toNumber]).sort((a, b) => a[0]! - b[0]!))
    .toEqual(Array.from({ length: 12 }, (_, index) => [index + 12, index + 1]))

  const closed = closeDatesWithTitles({ reference, theirs, pairs: dates.pairs })
  expect(closed.map(pair => [pair.from.uri, pair.to.uri, (pair.evidence as { gap: string }).gap]))
    .toEqual([
      ['cr:G940-12', 'anizip:940-1', stripTitle(GAP_TITLES[0]!)],
      ['cr:G940-23', 'anizip:940-12', stripTitle(GAP_TITLES[11]!)],
    ])
  // and the trace says so per ROW, since the verdict that carries them is the date rule's
  expect(closed.map(pair => ruleOfPair(pair, 'dates'))).toEqual(['dates-gap', 'dates-gap'])
  expect(dates.pairs.map(pair => ruleOfPair(pair, 'dates'))).toEqual(dates.pairs.map(() => 'dates'))
})

// THE DATES KEEP A VETO OVER THE ANSWER, and one monotone test carries all of it because a TIE is a
// crossing: a restatement ties on `fromNumber`, an overwrite ties on `toNumber`, and an out-of-order
// equality crosses outright. Each of the three is the difference between adding a row and moving a
// proven one.
// Mutation: relax `crosses` from `<= 0` to `< 0` and the first two assertions go red, which is the
// tie half of the guard; delete the `crosses` filter outright and the third goes red with them; drop
// the `tangled` clause and the last one takes two equalities that cross each other.
test('the gap closure may not restate, overwrite or cross a pair the days proved', () => {
  const NAMES = [
    'first of the run', 'second of the run', 'third of the run', 'fourth of the run',
    'fifth of the run', 'sixth of the run', 'seventh of the run', 'eighth of the run',
  ]
  const days = weekly('2026-07-01', 8)
  const reference = NAMES.map((name, index) => side(`anizip:941-${index + 1}`, index + 1, days[index]!, [name]))
  const dated = [
    side('cr:941-4', 4, days[3]!, [NAMES[3]!]),
    side('cr:941-5', 5, days[4]!, [NAMES[4]!]),
  ]
  const pairs = pairsByDay(reference, dated).pairs
  expect(pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[4, 4], [5, 5]])

  // A RESTATEMENT ties on `fromNumber`: their row 4 is the days' own, whatever else its title says
  const restating = side('cr:941-4', 4, days[3]!, [NAMES[7]!])
  expect(closeDatesWithTitles({ reference, theirs: [...dated, restating], pairs })).toEqual([])

  // AN OVERWRITE ties on `toNumber`: our row 5 is the days' own, and a second claimant is refused
  const doubling = side('cr:941-9', 9, null, [NAMES[4]!])
  expect(closeDatesWithTitles({ reference, theirs: [...dated, doubling], pairs })).toEqual([])

  // A CROSSING is out of sequence outright: their 3 is before their 4, so it cannot land on our 8
  const crossing = side('cr:941-3', 3, null, [NAMES[7]!])
  expect(closeDatesWithTitles({ reference, theirs: [...dated, crossing], pairs })).toEqual([])

  // TWO EQUALITIES THAT CROSS EACH OTHER take neither, even though both agree with the days: nothing
  // rather than a guess about which of the two is the real one
  const agreeing = [side('cr:941-6', 6, null, [NAMES[5]!]), side('cr:941-7', 7, null, [NAMES[6]!])]
  expect(closeDatesWithTitles({ reference, theirs: [...dated, ...agreeing], pairs })
    .map(pair => [pair.fromNumber, pair.toNumber]), 'the control: the same two rows, in sequence')
    .toEqual([[6, 6], [7, 7]])
  const swapped = [side('cr:941-6', 6, null, [NAMES[6]!]), side('cr:941-7', 7, null, [NAMES[5]!])]
  expect(closeDatesWithTitles({ reference, theirs: [...dated, ...swapped], pairs })).toEqual([])
})

// THE ANCHOR BAR IS RULE 3'S, NOT RULE 2'S: exact, non-generic and carried once on each side.
// Nothing here is placed by a coverage score, by a count or by a position.
// Mutation: replace all three `anchorKeysOf` in `closeDatesWithTitles` with `keysOf` and the generic
// pair is taken (the index alone is not enough: the loop reads the keys, so both have to move). Drop
// `if (mine.get(key) !== episode)` and the row their side names twice is placed on whichever of the
// two happened to survive the crossing test. Drop `if (matched.size !== 1)` and a row reaching two of
// our rows is placed on the lower uri. Make `uniqueKeys` keep the FIRST row rather than nulling a
// repeated key and the key ours carries twice is placed too, plus rule 2's own case goes red.
test('the gap closure anchors on an exact non-generic key carried once on each side', () => {
  const NAMES = [
    'a first of its own', 'a second of its own', 'a third of its own', 'a fourth of its own',
    'a fifth of its own', 'a sixth of its own', 'a seventh of its own', 'an eighth of its own',
  ]
  const days = weekly('2026-07-01', 8)
  const reference = NAMES.map((name, index) => side(`anizip:942-${index + 1}`, index + 1, days[index]!, [name]))
  const dated = [
    side('cr:942-4', 4, days[3]!, [NAMES[3]!]),
    side('cr:942-5', 5, days[4]!, [NAMES[4]!]),
  ]
  const pairs = pairsByDay(reference, dated).pairs
  expect(pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[4, 4], [5, 5]])
  const close = (theirs: SideEpisode[]) => closeDatesWithTitles({ reference, theirs: [...dated, ...theirs], pairs })

  // THE CONTROL, and it has to come first: the same shape with an ordinary title IS taken, so every
  // empty list below is a refusal rather than a rule that never reached anything
  expect(close([side('cr:942-7', 7, null, [NAMES[6]!])]).map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[7, 7]])

  // A GENERIC TITLE anchors nothing, even exact and unique on both sides: Netflix's `Episode N` rows
  // would otherwise close a whole season onto ours (3.4a point 4)
  const generic = [...reference]
  generic[6] = side('anizip:942-7', 7, days[6]!, ['episode 7'])
  expect(closeDatesWithTitles({
    reference: generic, pairs, theirs: [...dated, side('cr:942-7', 7, null, ['episode 7'])],
  })).toEqual([])

  // A KEY THEIR SIDE CARRIES TWICE says nothing about which of their rows is meant, and the point is
  // that one of the two would otherwise survive alone: their row 1 crosses a proven pair on the way
  // to our 7 and is dropped, leaving their row 7 to be placed on a key that names two rows
  expect(close([side('cr:942-1', 1, null, [NAMES[6]!]), side('cr:942-7', 7, null, [NAMES[6]!])])).toEqual([])

  // A KEY OUR SIDE CARRIES TWICE is dropped for the same reason, on our side
  const repeated = [...reference]
  repeated[7] = side('anizip:942-8', 8, days[7]!, [NAMES[6]!])
  expect(closeDatesWithTitles({
    reference: repeated, pairs, theirs: [...dated, side('cr:942-7', 7, null, [NAMES[6]!])],
  })).toEqual([])

  // AND A ROW REACHING TWO OF OUR ROWS through two different keys is an ambiguity, not two matches
  expect(close([side('cr:942-7', 7, null, [NAMES[6]!, NAMES[7]!])])).toEqual([])
})

// IT CLOSES A STANDING ALIGNMENT AND CAN NEVER CREATE ONE, and the window still bounds what it adds.
// Mutation: delete the `if (!pairs.length) return []` head and the first assertion places two rows on
// a candidate the days never spoke about; drop the `inWindow` around the closure in `decideCandidate`
// and the second assertion gains a pair onto our number 13.
test('the gap closure needs a standing date alignment, and its rows go through the window too', () => {
  const reference = [
    side('anizip:943-1', 1, '2026-07-01', ['first of the run']),
    side('anizip:943-2', 2, '2026-07-08', ['second of the run']),
  ]
  const theirs = [
    side('cr:943-1', 1, null, ['first of the run']),
    side('cr:943-2', 2, null, ['second of the run']),
  ]
  expect(pairsByDay(reference, theirs).pairs, 'their side carries no day at all').toEqual([])
  expect(closeDatesWithTitles({ reference, theirs, pairs: [] })).toEqual([])
  expect(decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: theirs } }).ok,
    'rule 2 and rule 3 decide it exactly as they did before')
    .toBe(false)

  // and a row an equality reaches OUTSIDE `1..runLength` is dropped exactly as a dated one is
  const wide = [
    side('anizip:944-1', 1, '2026-07-01', ['a first']), side('anizip:944-2', 2, '2026-07-08', ['a second']),
    side('anizip:944-3', 3, '2026-07-15', ['a third']), side('anizip:944-13', 13, '2026-09-23', ['a thirteenth']),
  ]
  const reaching = [
    side('cr:944-1', 1, '2026-07-01', ['a first']), side('cr:944-2', 2, '2026-07-08', ['a second']),
    side('cr:944-13', 13, null, ['a thirteenth']),
  ]
  const verdict = decideCandidate({ runLength: 3, reference: wide, candidate: { retranslates: false, episodes: reaching } })
  expect(verdict.ok && verdict.pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[1, 1], [2, 2]])
  expect(verdict.ok && verdict.gaps, 'the equality onto our 13 was found and then windowed out').toBe(0)
})

// THE PORTED RULE AND THE ONE IT REPLACES AGREE WHEREVER THE OLD ONE ANSWERS (`consensus.test.ts`'s
// own fixtures), and differ in exactly one place, on purpose.
// Mutation: change the day window or the distinct-numbers-per-day map and the first assertion fails
// on the Elusive Samurai fixture, which is the case the offset rule was written for.
test('rule 1 and alignmentOffset agree on every fixture the old rule answers', () => {
  const WEEKLY = weekly('2026-07-17', 12)
  const asEpisode = (row: SideEpisode): Episode => ({
    uri: row.uri,
    origin: row.origin,
    mediaUri: row.origin,
    episodeNumber: row.number,
    releaseDate: row.day === null ? undefined : new Date(row.day * MS_PER_DAY).toISOString(),
  } as unknown as Episode)

  const agrees = (reference: SideEpisode[], theirs: SideEpisode[]) => {
    const offset = alignmentOffset(reference.map(asEpisode), theirs.map(asEpisode))
    const { pairs } = pairsByDay(reference, theirs)
    return { offset, offsets: new Set(pairs.map(pair => pair.fromNumber - pair.toNumber)), pairs: pairs.length }
  }

  // the renumbering the offset rule exists for: one offset, and every pair carries it
  const samurai = agrees(listed('anizip:18903', 1, WEEKLY), listed('cr:GS00366034', 13, WEEKLY.slice(0, 8)))
  expect(samurai.offset).toBe(12)
  expect([...samurai.offsets]).toEqual([12])
  expect(samurai.pairs).toBe(8)

  // a source already counting the same way
  const zero = agrees(listed('anizip:a', 1, WEEKLY), listed('cr:a', 1, WEEKLY))
  expect(zero.offset).toBe(0)
  expect([...zero.offsets]).toEqual([0])

  // and every refusal the old rule makes for a PER-DAY reason is a refusal here too
  const doubled = agrees(
    [side('anizip:b-1', 1, '2026-07-01'), side('anizip:b-2', 2, '2026-07-01')],
    [side('cr:b-5', 5, '2026-07-01'), side('cr:b-6', 6, '2026-07-01')]
  )
  expect(doubled.offset).toBeUndefined()
  expect(doubled.pairs).toBe(0)

  const once = agrees(listed('anizip:c', 1, WEEKLY), listed('cr:c', 13, [WEEKLY[0]!]))
  expect(once.offset).toBeUndefined()
  expect(once.pairs, 'one pair, which is under MIN_ALIGNED and mints nothing').toBe(1)

  // THE ONE DELIBERATE DIFFERENCE. Two offsets explaining one set of dates is a refusal for the OLD
  // rule, because it had to pick one number for the whole list. Here it is two runs of pairs and no
  // number at all, which is the piecewise mapping of 3.4 and what 8.3 asks for
  const split = agrees(
    listed('anizip:d', 1, weekly('2026-07-01', 4)),
    [...listed('cr:d', 5, weekly('2026-07-01', 2)), ...listed('cr:d', 9, weekly('2026-07-15', 2))]
  )
  expect(split.offset, 'offset 4 twice and offset 6 twice').toBeUndefined()
  expect(split.pairs).toBe(4)
  expect([...split.offsets].sort((a, b) => a - b)).toEqual([4, 6])
})

// THE HULL IS A STATEMENT ABOUT THE PAIRS, not about the span: a range with a hole in it says so.
// Mutation: hard-code `contiguous: true` and the piecewise mapping an inserted special produces
// reads as a solid block, which is the claim 8.3 exists to refuse.
test('the hull reports a gap rather than smoothing it', () => {
  const reference = listed('anizip:e', 1, weekly('2011-04-17', 25))
  const theirs = [
    ...listed('cr:e', 1, weekly('2011-04-17', 13)),
    side('cr:e-14', 14, '2012-01-01'),
    ...listed('cr:e', 15, weekly('2011-07-17', 12)),
  ]
  const { pairs } = pairsByDay(reference, theirs)
  const hull = hullOf(pairs, 26)!
  expect(hull.aligned).toBe(25)
  expect(hull.contiguous, 'position 14 pairs with nothing, so the range is not solid').toBe(false)
  // and the first of the two runs of pairs, taken alone, IS solid: the piecewise mapping of 8.3
  expect(hullOf(pairs.filter(pair => pair.fromNumber <= 13), 26))
    .toMatchObject({ fromStart: 1, fromEnd: 13, toStart: 1, toEnd: 13, contiguous: true })
})

// PLACING A CLAIM IS THREE CASES AND A REFUSAL, and the refusal is the interesting one: two rows that
// only share an ATTACHMENT are two seasons hanging off one run, which is the fold this file proves
// episode by episode. A source asserting across it is asserting the thing a pair demonstrates.
// Mutation: admit two attached rows as well and a Crunchyroll season's episode pairs with a Netflix
// season's on nothing but both being `PART_OF` the same run; drop the member-to-attached case and
// 8.1's season rows can never be claimed onto the run at all.
test('a claim is placed inside one cluster, or across one attachment, and nowhere else', () => {
  const place = (members: string[], attached: string[] = []) => ({ members, attached })
  expect(placesClaim(place(['cl:a']), place(['cl:a'])), 'both rows on members of one cluster').toBe(true)
  expect(placesClaim(place(['cl:a']), place([], ['cl:a'])), 'a member and a season attached to it').toBe(true)
  expect(placesClaim(place([], ['cl:a']), place(['cl:a'])), 'and the same the other way round').toBe(true)
  expect(placesClaim(place([], ['cl:a']), place([], ['cl:a'])), 'two seasons attached to one run').toBe(false)
  expect(placesClaim(place(['cl:a']), place(['cl:b'])), 'two runs nothing joins').toBe(false)
  expect(placesClaim(place([]), place([])), 'a row in no cluster at all').toBe(false)
  expect(placesClaim(place(['cl:a', 'cl:b']), place(['cl:b'])), 'one shared cluster is enough').toBe(true)
})

// CLASS 3 IS SELECTED BY NUMBER, and an origin that already fits has nothing to renumber.
// Mutation: make `numbersOutsideRun` true for everything and every member is paired against every
// other, which is a cartesian product over a cluster rather than a repair.
test('a member is a candidate only when its numbering does not fit the run', () => {
  const fits = listed('kitsu:f', 1, weekly('2026-07-17', 8))
  expect(numbersOutsideRun(fits, 12)).toBe(false)
  expect(numbersOutsideRun(listed('cr:f', 13, weekly('2026-07-17', 8)), 12)).toBe(true)
  expect(numbersOutsideRun(listed('cr:g', 1, weekly('2026-07-17', 14)), 12), 'and a list past the end is one too').toBe(true)
  expect(numbersOutsideRun([], 12)).toBe(false)
})

// A CONSTANT OFFSET IS TWO DIFFERENT FACTS, and the candidate's own numbering is what tells them
// apart. A list that numbers this run from 1 and fits inside it cannot be renumbered by an offset
// that would carry one of its rows off the end: that offset is the two sources publishing on
// different schedules. A list that starts at 13, or one that numbers a segment of a longer run, can.
// Mutation: drop the `absorbed` clause and 8.4 goes red, because Fullmetal's season 2 numbers 1 to 13
// inside a run of 64 at a constant +13 and that IS a renumbering; drop `min === 1` and a list that
// starts at 2 stops being renumbered; drop `max > runLength` and the lend of 8.1 goes red; drop the
// one-offset test and a single disagreeing row carries the whole list; drop the empty-pairs return
// and the function throws on a candidate that paired with nothing.
test('a constant offset a candidate cannot absorb is a skew, and every other one is a renumbering', () => {
  const skewOf = (runLength: number, reference: SideEpisode[], theirs: SideEpisode[]) =>
    scheduleSkew({ runLength, episodes: theirs, pairs: pairsByDay(reference, theirs).pairs })

  // the bug: twelve rows numbered 1 to 12 against a run of 12, streamed six days before the broadcast
  const broadcast = listed('anizip:s', 1, weekly('2026-07-01', 12).map(anizipDay))
  expect(skewOf(12, broadcast, listed('cr:s', 1, weekly('2026-06-25', 12))), 'one late, and row 1 has nowhere to go').toBe(-1)

  // 8.2: Crunchyroll's 13 to 20 on the run's own days. The offset is -12 and it is a real renumbering
  const samurai = listed('anizip:t', 1, weekly('2026-07-17', 12).map(anizipDay))
  const elusive = listed('cr:t', 13, weekly('2026-07-17', 8))
  expect(skewOf(12, samurai, elusive), 'a list that starts at 13 is numbering something else').toBe(null)
  expect(decideCandidate({ runLength: 12, reference: samurai, candidate: { retranslates: false, episodes: elusive } }))
    .toMatchObject({ ok: true, rule: 'dates' })
  expect(pairsByDay(samurai, elusive).pairs.map(pair => [pair.fromNumber, pair.toNumber]),
    '8.2 still renumbers 13 to 20 onto 1 to 8')
    .toEqual(Array.from({ length: 8 }, (_, index) => [index + 13, index + 1]))

  // 8.4: Crunchyroll's season 2 numbers 1 to 13 inside a run of 64, at a constant +13. Every row it
  // renumbers lands on a row of that run, so the offset is absorbed and rule 1 is right
  const fma = listed('anizip:u', 1, weekly('2009-04-05', 64).map(anizipDay))
  expect(skewOf(64, fma, listed('cr:u', 1, weekly('2009-04-05', 13, 13))), 'rows 14 to 26 are rows of that run').toBe(null)

  // the mirror of the bug, to show the clause is about the offset and not about its sign: a stream
  // six days AHEAD of the broadcast pairs its 1 to 11 onto 2 to 12, and its own 12 has nowhere to go
  expect(skewOf(12, broadcast, listed('cr:v', 1, weekly('2026-07-07', 12))), 'one early').toBe(1)

  // a list that does not START at 1 has not claimed this run's numbering, so the dates decide even
  // when its offset is unabsorbable: 2 to 9 against a run of 12, pairing 3 to 9 onto 1 to 7 at -2.
  // This is 8.2's principle stated generally, and it is the whole of the `min === 1` clause, which
  // 8.2 itself never reaches because 13 to 20 is already past a run of 12
  expect(skewOf(12, broadcast, listed('cr:p', 2, weekly('2026-06-24', 8))), 'and 2 is not 1').toBe(null)

  // ONE ROW THAT DOES NOT SHARE THE OFFSET is enough: a list that is one late everywhere except in
  // one place is not a schedule, and rule 1 is then the per-episode evidence it always was
  const late = listed('cr:w', 1, weekly('2026-06-25', 12))
  const bent = pairsByDay(broadcast, late).pairs
  expect(scheduleSkew({ runLength: 12, episodes: late, pairs: bent }), 'the control: all of them at -1').toBe(-1)
  expect(scheduleSkew({
    runLength: 12,
    episodes: late,
    pairs: [...bent.slice(1), { ...bent[0]!, toNumber: bent[0]!.toNumber + 1 }],
  })).toBe(null)

  expect(skewOf(12, broadcast, listed('cr:x', 1, weekly('2026-07-01', 12))), 'an offset of zero is agreement').toBe(null)
  expect(scheduleSkew({ runLength: 12, episodes: late, pairs: [] }), 'and a candidate that paired with nothing').toBe(null)

  // CLASS 3 CAN NEVER REACH THIS GUARD: its entry test is `numbersOutsideRun`, which is the exact
  // negation of this guard's own numbering clause, so the two select disjoint sets of candidates
  for (const own of [elusive, listed('cr:y', 1, weekly('2026-07-17', 14)), listed('cr:z', 2, weekly('2026-07-17', 6))]) {
    expect(numbersOutsideRun(own, 12)).toBe(true)
    expect(skewOf(12, samurai, own)).toBe(null)
  }
})

// WHEN THE TWO RULES DISAGREE, the numbering decides which one was measuring the right thing. A
// candidate numbered 1 to 12 against a run of 12 is placed by its own numbering, so the dates are a
// skew and rule 2 answers; a candidate numbered 13 to 20 is not, so rule 1 answers and rule 2 never
// runs, which is the order 5.4 P4 states.
// Mutation: return the skew offset from `scheduleSkew` unconditionally and the second half flips to
// `titles` at 5 to 12, which is 8.2 renumbered by the wrong eight rows.
test('date evidence and title evidence that disagree are settled by the candidate\'s own numbering', () => {
  const days = weekly('2026-07-01', 12)
  const named = (uri: string, number: number, day: string | null, name: string): SideEpisode =>
    side(uri, number, day, [name])
  const reference = days.map((day, index) => named(`anizip:d-${index + 1}`, index + 1, anizipDay(day), `chapter ${index + 1}`))

  // the dates say N+1 to N and the titles say N to N: the titles are right, and the guard is what
  // lets them be heard at all
  const skewed = weekly('2026-06-25', 12).map((day, index) => named(`cr:d-${index + 1}`, index + 1, day, `chapter ${index + 1}`))
  expect(pairsByDay(reference, skewed).pairs.map(pair => [pair.fromNumber, pair.toNumber])
    .sort((a, b) => a[0]! - b[0]!), 'what rule 1 alone says')
    .toEqual(Array.from({ length: 11 }, (_, index) => [index + 2, index + 1]))
  const settled = decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: skewed } })
  expect(settled.ok && settled.rule).toBe('titles')
  expect(settled.ok && settled.pairs.map(pair => [pair.fromNumber, pair.toNumber]).sort((a, b) => a[0]! - b[0]!))
    .toEqual(Array.from({ length: 12 }, (_, index) => [index + 1, index + 1]))

  // and the same disagreement on 8.2's numbering: rule 1 runs first and rule 2 is never consulted
  const renumbered = days.slice(0, 8).map((day, index) => named(`cr:e-${index + 13}`, index + 13, day, `chapter ${index + 5}`))
  const byDates = decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: renumbered } })
  expect(byDates.ok && byDates.rule).toBe('dates')
  expect(byDates.ok && byDates.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual(Array.from({ length: 8 }, (_, index) => [index + 13, index + 1]))
  expect(pairsByTitle(reference, renumbered).pairs.map(pair => [pair.fromNumber, pair.toNumber])[0], 'what rule 2 would have said')
    .toEqual([13, 5])
})

// A SKEW WITH NOTHING TO FALL BACK ON IS A WRITTEN REFUSAL, not a silence and not a guess.
// Mutation: return `no-dates` instead of `date-skew` and "why is this button missing" stops
// distinguishing a schedule that never met from one that met and was refused.
test('a skew whose titles cannot rescue it refuses date-skew', () => {
  const reference = listed('anizip:g', 1, weekly('2026-07-01', 12).map(anizipDay))
  const theirs = listed('cr:g', 1, weekly('2026-06-25', 12))
  expect(decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'date-skew' })
  // and a retranslating origin is still refused for the older reason, which is the more specific one
  expect(decideCandidate({ runLength: 12, reference, candidate: { retranslates: true, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'retranslates' })
})

// ---------------------------------------------------------------------------------------------
// Rule 3 itself, without an engine: the measured alignment, and each way it refuses.

/** The two sides of the measured fixture, with the run's special list present or absent. */
const mushokuSides = (options: { special?: boolean } = {}) => ({
  reference: [
    ...CANON_S2.map((name, index) => side(`anizip:18103-${index + 1}`, index + 1, null, [name])),
    ...options.special ? [side('anizip:18103-S1', null, SPECIAL_DAY, [SPECIAL_S2])] : [],
  ],
  theirs: NETFLIX_S2.map((name, index) => side(
    `nf:80987039-2-${index + 1}`,
    index + 1,
    null,
    [name ?? `Episode ${index + 1}`]
  )),
})

// THE MEASURED ALIGNMENT (2026-09-12): 4 anchors, 3 rows forced by an equal-gap bracket, 0 regions
// refused, and 18 rows outside the outermost anchors that are NOT extrapolated. Netflix
// `retranslates`, so this is also the case that proves rule 3 runs where rule 2 is refused (3.4a).
// Mutation: refuse a `retranslates` candidate before rule 3 runs (rule 2's own refusal, moved back
// above it) and the verdict below reads `retranslates` with no pairs at all, which is the whole of
// Netflix's lane; return no pairs from `forcedByBracket` and the three rows no title reaches are lost
// and the four anchors ride out with them, since rule 3 speaks only when order places a row.
test('rule 3 anchors the four Netflix rows the titles prove and forces exactly the three between them', () => {
  const { reference, theirs } = mushokuSides()
  const sequence = pairsBySequence(reference, theirs)

  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, anchor.key])).toEqual([
    [6, 5, stripTitle('Ranoa University of Magic')],
    [8, 7, stripTitle('The Kidnapping and Confinement of Beast Girls')],
    [10, 9, stripTitle('The White Mask')],
    [12, 11, stripTitle('To You')],
  ])
  // the three the record names, none of which any title rule could reach: `Unwilling to Die` onto
  // `I Don't Want to Die`, one accent difference, and `This Feeling` onto `These Feelings`
  expect(sequence.forced.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[7, 6], [9, 8], [11, 10]])
  expect(sequence.forced.map(pair => pair.evidence)).toEqual([
    { between: ['nf:80987039-2-6', 'nf:80987039-2-8'] },
    { between: ['nf:80987039-2-8', 'nf:80987039-2-10'] },
    { between: ['nf:80987039-2-10', 'nf:80987039-2-12'] },
  ])
  expect(sequence.unequal, 'no region disagreed').toBe(0)
  // WITHOUT the run's special list the surplus of one is unaccounted, so the closure refuses and the
  // 18 rows outside the outermost anchors stay unpaired: 5 before the first, 13 after the last
  expect({ closed: sequence.closed, located: sequence.located, closure: sequence.closure })
    .toEqual({ closed: false, located: [], closure: [] })
  expect(sequence.pairs.map(pair => pair.fromNumber)).toEqual([6, 7, 8, 9, 10, 11, 12])

  const verdict = decideCandidate({ runLength: 24, reference, candidate: { retranslates: true, episodes: theirs } })
  expect(verdict.ok && verdict.rule, 'rule 3 runs where rule 2 is refused outright').toBe('sequence')
  expect(verdict.ok && verdict.pairs).toHaveLength(7)
  expect(verdict.ok && verdict.sequence)
    .toEqual({
      anchors: 4, scored: 0, synopsis: 0, consensus: null, forced: 3, closure: 0, unequal: 0, closed: false,
    })
  // AND THE SCORE WAS NEVER CONSULTED, because four exact anchors bracket this season by themselves
  // (2026-09-13). Mutation: run the scored fallback unconditionally and their row 9
  // `The Fiance of Despair` welds onto our 8 `The Fiancé of Despair` at Dice 0.75, which turns a row
  // ORDER forced into a row a score placed and drops `forced` from 3 to 2
  expect(sequence.alignment.scored).toBe(0)
  expect(sequence.alignment.anchors.every(anchor => anchor.scored === undefined)).toBe(true)
})

// THE CLOSURE, at the level the specials rule lives at: the same two sides plus ani.zip's `S1`.
// Mutation: compare the special's title EXACTLY rather than by tokens and `Fitz the Guardian` stops
// locating `Guardian Fitz`, so the surplus is unaccounted and the closure refuses; drop the
// `located.length !== extra` test and a region closes on a special that explains nothing.
test('3.4a locating one special accounts for the surplus and forces every remaining row', () => {
  const { reference, theirs } = mushokuSides({ special: true })
  const sequence = pairsBySequence(reference, theirs)

  expect(sequence.closed).toBe(true)
  expect(sequence.located.map(entry => [entry.from.uri, entry.special.uri]))
    .toEqual([['nf:80987039-2-1', 'anizip:18103-S1']])
  // rows 2 to 25 onto canonical 1 to 24, the untitled tail included
  expect(sequence.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual(Array.from({ length: 24 }, (_, index) => [index + 2, index + 1]))
  // and the four anchors sit exactly where that counting predicts, which is the alignment proving
  // itself rather than being trusted
  expect(sequence.alignment.anchors.every(anchor => anchor.from.number! - 1 === anchor.to.number!)).toBe(true)
  expect(sequence.closure).toHaveLength(17)
  expect(sequence.located).toHaveLength(1)
  // the located row itself pairs with NOTHING: the special carries no number and no slot admits it
  expect(sequence.pairs.some(pair => pair.from.uri === 'nf:80987039-2-1')).toBe(false)
  expect(sequence.pairs.some(pair => pair.to.uri === 'anizip:18103-S1')).toBe(false)

  // THE SURPLUS IS DERIVED FROM THE FIRST ANCHOR (3.4a point 1): their row 6 against our 5 states
  // that exactly one extra row sits in the first six, and one is what was located
  const first = sequence.alignment.anchors[0]!
  expect(first.fromIndex - first.toIndex).toBe(1)
  expect(sequence.located).toHaveLength(first.fromIndex - first.toIndex)
})

// A SURPLUS OF ZERO CLOSES NOTHING, because the only thing left saying the ends line up is that the
// two counts agree, and there is no rule by COUNT (5.4 P4, the Demon Slayer shape).
// Mutation: admit `surplus === 0` in `closeWithSpecials` and a 24 row season with two anchors is
// paired end to end on its count, which is exactly what "a fold of two equal cours mints no title
// pairs" forbids.
test('a count that merely agrees closes no alignment', () => {
  const reference = Array.from({ length: 8 }, (_, index) => side(`anizip:c-${index + 1}`, index + 1, null, [`real ${index + 1}`]))
  const theirs = Array.from({ length: 8 }, (_, index) =>
    side(`jw:c-${index + 1}`, index + 1, null, [index === 2 || index === 4 ? `real ${index + 1}` : `their ${index + 1}`]))
  const sequence = pairsBySequence(reference, theirs)

  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number])).toEqual([[3, 3], [5, 5]])
  expect(sequence.closed).toBe(false)
  // the row between the two anchors IS forced, since a bracket needs no surplus accounted
  expect(sequence.forced.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[4, 4]])
  expect(sequence.pairs.map(pair => pair.fromNumber), 'and the ends stay unpaired').toEqual([3, 4, 5])
})

// ZERO ANCHORS MINTS NOTHING AT ALL (3.4a point 4): Netflix's season 1 of the same show, 24 rows
// titled `Episode N`, which is the correct outcome and the reason no positional fallback exists here.
// OUR side carries a placeholder too, at number 13, because ani.zip does that for a row nobody has
// titled yet: it is the same string on both sides at the same number, and the only thing refusing it
// is that a position is not a title.
// Mutation: drop the `isGenericEpisodeTitle` filter in `anchorKeysOf` and row 13 anchors on a number
// spelled the same way twice; make the last refusal unconditionally `no-titles` and "why no button"
// stops distinguishing titles that missed a bar from titles that carried no identity at all.
test('Netflix season 1 placeholders anchor nothing, and the refusal says so', () => {
  const reference = CANON_S2.map((name, index) =>
    side(`anizip:s1-${index + 1}`, index + 1, null, [index === 12 ? 'Episode 13' : name]))
  const theirs = Array.from({ length: 24 }, (_, index) =>
    side(`nf:80987039-1-${index + 1}`, index + 1, null, [`Episode ${index + 1}`]))

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors).toEqual([])
  expect(sequence.pairs).toEqual([])
  expect(decideCandidate({ runLength: 24, reference, candidate: { retranslates: true, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'retranslates' })
  // the same rows from an origin rule 2 is not refused for name rule 3's own reason
  expect(decideCandidate({ runLength: 24, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-anchors' })

  // THE CONTROL: one real title in the same position on both sides, and this rig anchors it
  const titled = [...theirs]
  titled[4] = side('nf:80987039-1-5', 5, null, [CANON_S2[4]!])
  expect(alignByTitle(reference, titled).anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[5, 5]])
})

// A GENERIC TITLE IS NEVER AN ANCHOR, even where both sides spell the position identically, which is
// the case the control above cannot make (there our side carries no placeholder at all).
// Mutation: drop the `isGenericEpisodeTitle` filter in `anchorKeysOf` and all six anchor.
test('a generic title is never an anchor, however exactly it matches', () => {
  const reference = Array.from({ length: 6 }, (_, index) => side(`anizip:p-${index + 1}`, index + 1, null, [`Episode ${index + 1}`]))
  const theirs = Array.from({ length: 6 }, (_, index) => side(`nf:p-${index + 1}`, index + 1, null, [`Episode ${index + 1}`]))
  expect(alignByTitle(reference, theirs).anchors).toEqual([])
  expect(alignByTitle(reference, theirs).matches).toBe(0)

  // and the control, the same six rows with one real title each at the same number
  const real = (prefix: string) => Array.from({ length: 6 }, (_, index) =>
    side(`${prefix}-${index + 1}`, index + 1, null, [`Chapter of the Deep ${index + 1}`]))
  expect(alignByTitle(real('anizip:q'), real('nf:q')).anchors).toHaveLength(6)
})

// ONE ANCHOR BRACKETS NOTHING, so it mints nothing: the minimum is two, and rule 3 adds only what
// ORDER places, never an exact title on its own (that is rule 2's evidence, held to rule 2's bar).
// Mutation: mint the anchors whenever there are two or more of them and a fold of two equal cours at
// 12/24 pairs its twelve, which is what only the date rule may prove (5.4 P4 rule 2).
test('a single anchor forces nothing', () => {
  const reference = Array.from({ length: 6 }, (_, index) => side(`anizip:o-${index + 1}`, index + 1, null, [`real ${index + 1}`]))
  const theirs = Array.from({ length: 6 }, (_, index) =>
    side(`jw:o-${index + 1}`, index + 1, null, [index === 2 ? 'real 3' : `their ${index + 1}`]))

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors).toHaveLength(1)
  expect(sequence.anchored, 'below the two anchor minimum, so not even the anchor is a pair').toEqual([])
  expect(sequence.pairs).toEqual([])
  expect(decideCandidate({ runLength: 6, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-anchors' })
})

// AN UNEQUAL GAP REFUSES ITS OWN REGION AND KEEPS ITS ANCHORS. One side carries a row the other does
// not, and which row that is is exactly what order cannot say.
// Mutation: force a region whose gaps differ by pairing its rows in order and the three rows between
// anchors 4 and 8 land on canonical 5, 6 and 7 while our 5 is the only slot there.
test('an unequal gap refuses its own region and keeps its anchors', () => {
  const reference = Array.from({ length: 6 }, (_, index) => side(`anizip:u-${index + 1}`, index + 1, null, [`real ${index + 1}`]))
  // their 1 = ours 1, two rows and two slots between it and their 4 = ours 4, then THREE rows against
  // one slot before their 8 = ours 6
  const name = (position: number): string =>
    position === 1 ? 'real 1' : position === 4 ? 'real 4' : position === 8 ? 'real 6' : `their ${position}`
  const theirs = Array.from({ length: 8 }, (_, index) => side(`jw:u-${index + 1}`, index + 1, null, [name(index + 1)]))

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[1, 1], [4, 4], [8, 6]])
  expect(sequence.unequal).toBe(1)
  expect(sequence.forced.map(pair => [pair.fromNumber, pair.toNumber]), 'the equal region only')
    .toEqual([[2, 2], [3, 3]])
  expect(sequence.pairs.map(pair => [pair.fromNumber, pair.toNumber]), 'three anchors and two forced rows')
    .toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [8, 6]])
  expect(sequence.pairs.some(pair => [5, 6, 7].includes(pair.fromNumber)), 'the refused region pairs nothing')
    .toBe(false)
  expect(sequence.closed, 'and an unequal gap refuses the closure with it').toBe(false)
  const verdict = decideCandidate({ runLength: 6, reference, candidate: { retranslates: false, episodes: theirs } })
  expect(verdict.ok && verdict.rule).toBe('sequence')

  // WHERE THE UNEQUAL REGION IS THE ONLY ONE, order places nothing and the refusal names it
  const two = [
    side('jw:v-1', 1, null, ['real 1']), side('jw:v-2', 2, null, ['their 2']),
    side('jw:v-3', 3, null, ['their 3']), side('jw:v-4', 4, null, ['real 6']),
  ]
  const alone = pairsBySequence(reference, two)
  expect(alone.alignment.anchors).toHaveLength(2)
  expect(alone.pairs).toEqual([])
  expect(decideCandidate({ runLength: 6, reference, candidate: { retranslates: false, episodes: two } }))
    .toEqual({ ok: false, reason: 'unequal-gap' })
})

// AN ALIGNMENT NEVER CROSSES ITSELF. Two matches that cross leave a monotone run of one, which
// brackets nothing, so a swapped pair of titles costs both of them rather than bending the sequence
// around them.
// Mutation: take every candidate match as an anchor rather than the longest increasing subsequence,
// and the crossing pair mints two pairs whose order contradicts each other, plus a region between
// them whose row counts happen to agree.
test('two candidate matches that cross cannot bend the alignment', () => {
  const reference = Array.from({ length: 6 }, (_, index) => side(`anizip:x-${index + 1}`, index + 1, null, [`real ${index + 1}`]))
  const crossed = Array.from({ length: 6 }, (_, index) =>
    side(`jw:x-${index + 1}`, index + 1, null, [index === 1 ? 'real 5' : index === 4 ? 'real 2' : `their ${index + 1}`]))

  const sequence = pairsBySequence(reference, crossed)
  expect(sequence.alignment.matches, 'two exact unique matches, and they disagree about the order').toBe(2)
  expect(sequence.alignment.anchors).toHaveLength(1)
  expect(sequence.pairs).toEqual([])

  // THE CONTROL: the same two titles the other way round, which do not cross, and the rows between
  // them are forced
  const straight = Array.from({ length: 6 }, (_, index) =>
    side(`jw:y-${index + 1}`, index + 1, null, [index === 1 ? 'real 2' : index === 4 ? 'real 5' : `their ${index + 1}`]))
  const ordered = pairsBySequence(reference, straight)
  expect(ordered.alignment.anchors).toHaveLength(2)
  expect(ordered.pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[2, 2], [3, 3], [4, 4], [5, 5]])
})

// A TITLE PRESENT TWICE ON EITHER SIDE IS NO ANCHOR, and a canonical number two of their rows reach
// is one row too many for one episode.
// Mutation: keep the first row a duplicated key names and `Recap` anchors whichever of the two the
// scan reached first, which is an arrival-order answer to an identity question.
test('a duplicated title anchors nothing, on either side', () => {
  // ours: numbers 2 and 5 are both titled `recap`; theirs: rows 3 and 6 are both titled `twin`
  const reference = [
    side('anizip:d-1', 1, null, ['first']), side('anizip:d-2', 2, null, ['recap']),
    side('anizip:d-3', 3, null, ['twin']), side('anizip:d-4', 4, null, ['alpha', 'beta']),
    side('anizip:d-5', 5, null, ['recap']), side('anizip:d-6', 6, null, ['last']),
  ]
  const theirs = [
    side('jw:d-1', 1, null, ['recap']), side('jw:d-2', 2, null, ['alpha']),
    side('jw:d-3', 3, null, ['twin']), side('jw:d-4', 4, null, ['beta']),
    side('jw:d-5', 5, null, ['twin']), side('jw:d-6', 6, null, ['unshared']),
  ]
  // `recap` is twice on ours, `twin` twice on theirs, and `alpha` and `beta` reach one number of ours
  // from two different rows of theirs
  expect(alignByTitle(reference, theirs).anchors).toEqual([])
  expect(alignByTitle(reference, theirs).matches).toBe(0)

  // THE CONTROL: the same shape with each title carried once, which anchors both
  const once = [
    side('jw:e-1', 1, null, ['first']), side('jw:e-2', 2, null, ['unshared']),
    side('jw:e-3', 3, null, ['last']),
  ]
  expect(alignByTitle(reference, once).anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[1, 1], [3, 6]])
})

// A PAIRING RULE 1 REFUSED AS A SKEW IS NOT RESURRECTED BY RULE 3, which is the guard's whole point:
// the anchors can reproduce the very offset the dates were refused for, and an alignment is not
// better evidence about a schedule than the schedule was.
// Mutation: drop the `scheduleSkew` call on rule 3's own pairs and the five pairs below are minted
// one late, which is the video on the wrong row that guard was written for (`anilist:208044`).
test('rule 3 does not resurrect a pairing rule 1 refused as a skew', () => {
  // `Broadcast N` rather than `Chapter N`, because `chapter 3` is a GENERIC episode title
  // (`similar.ts:104`) and rule 3 drops every generic key before it anchors anything
  const broadcast = weekly('2026-07-01', 12).map(anizipDay)
  const reference = broadcast.map((day, index) =>
    side(`anizip:k-${index + 1}`, index + 1, day, [`Broadcast ${index + 1}`]))
  // streamed six days early, and only TWO of its titles match, so rule 2 misses its bar and rule 3
  // reaches an alignment. Both anchors carry the skew's own offset, and so do the three rows their
  // bracket forces
  const skewed = weekly('2026-06-25', 12).map((day, index) => side(
    `cr:k-${index + 1}`,
    index + 1,
    day,
    [index === 3 ? 'Broadcast 3' : index === 7 ? 'Broadcast 7' : `Stream ${index + 1}`]
  ))

  const sequence = pairsBySequence(reference, skewed)
  expect(sequence.pairs.map(pair => [pair.fromNumber, pair.toNumber]), 'rule 3 DID find them, one late')
    .toEqual([[4, 3], [5, 4], [6, 5], [7, 6], [8, 7]])
  expect(decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: skewed } }))
    .toEqual({ ok: false, reason: 'date-skew' })

  // THE CONTROL: the same two sides with the anchors at the offset the numbering claims, which
  // disagrees with the skew, and rule 3 stands
  const agreeing = skewed.map((row, index) => side(
    row.uri,
    row.number,
    weekly('2026-06-25', 12)[index]!,
    [index === 3 ? 'Broadcast 4' : index === 7 ? 'Broadcast 8' : `Stream ${index + 1}`]
  ))
  const verdict = decideCandidate({ runLength: 12, reference, candidate: { retranslates: false, episodes: agreeing } })
  expect(verdict.ok && verdict.rule).toBe('sequence')
  expect(verdict.ok && verdict.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[4, 4], [5, 5], [6, 6], [7, 7], [8, 8]])
})

// THE THREE STEPS COMPOSE, and each is a different kind of claim: a title measurement, arithmetic
// over one order, and an argument about a surplus. Asked separately they agree with the whole.
// Mutation: make `closeWithSpecials` ignore its `unequal` argument and a region the bracket refused
// stops refusing the closure, so the same surplus is accounted twice.
test('the alignment, the bracket and the closure are three separate claims', () => {
  const { reference, theirs } = mushokuSides({ special: true })
  const alignment = alignByTitle(reference, theirs)
  expect(alignment.theirs).toHaveLength(25)
  expect(alignment.canonical).toHaveLength(24)
  expect(alignment.specials.map(special => special.uri)).toEqual(['anizip:18103-S1'])

  const bracket = forcedByBracket(alignment)
  expect(bracket.pairs.map(pair => pair.fromNumber)).toEqual([7, 9, 11])
  expect(bracket.unequal).toBe(0)

  expect(closeWithSpecials({ alignment, unequal: bracket.unequal }).closed).toBe(true)
  expect(closeWithSpecials({ alignment, unequal: 1 }), 'a refused region refuses the closure')
    .toEqual({ pairs: [], located: [], closed: false })
})

// ---------------------------------------------------------------------------------------------
// THE REFERENCE ITSELF (2026-09-13): the side every rule above measures against, and the one way it
// came up empty on a real route.

/** The live `ag:(anilist:146065)` shape: two origins list, and neither of them won the length vote. */
const countOnlySides = (): SideEpisode[] => [
  ...CANON_S2.slice(0, 12).map((name, index) =>
    side(`anizip:980-${index + 1}`, index + 1, COUNT_ONLY_DAYS[index]!, [name])),
  // ani.zip's `specials=1` rows, which carry no number and can be no reference on their own
  side('anizip:980-S2', null, '2023-07-03'),
  ...Array.from({ length: 12 }, (_, index) => side(`kitsu:980-${index + 1}`, index + 1, null)),
]

// A MEMBER MAY STATE A COUNT AND LIST NOTHING, and a length carried by such a member alone left the
// reference EMPTY, which is no comparison rather than a weak one. Measured on `ag:(anilist:146065)`:
// `13 from anilist:146065`, witnesses 1, twelve rows drawn from ani.zip and Kitsu, zero episodes
// placed from ANY origin.
// Mutation: return `{ reference: byVote, origins: voted }` unconditionally from `referenceEpisodes`
// (the fallback branch deleted) and the first assertion below reads an empty list, which is the live
// failure exactly; keep the fallback but drop its `numbersOutsideRun` guard and the Crunchyroll lend
// numbered 13 to 24 becomes the run's own reference in the third.
test('a length stated by a member that lists nothing still leaves a reference', () => {
  const episodes = countOnlySides()

  const voted = referenceEpisodes({ episodes, runLengthFrom: ['anilist:980'], runLength: 13 })
  expect(voted.reference.length, 'AniList states 13 and lists nothing, so the vote names no lister').toBe(25)
  expect([...voted.origins].sort()).toEqual(['anizip', 'kitsu'])

  // AND IT IS NEVER A WIDENING. `ag:(anilist:166873)` reads `12 from anilist, anizip, kitsu`, so the
  // vote already names a lister and the reference is exactly that set, AniList's silence included
  const listing = referenceEpisodes({
    episodes, runLengthFrom: ['anilist:980', 'anizip:980'], runLength: 13,
  })
  expect(listing.reference.map(episode => episode.origin).every(origin => origin === 'anizip')).toBe(true)
  expect(listing.reference).toHaveLength(13)

  // A LEND NUMBERS OUTSIDE THE RUN, which is what makes it a candidate, and it may never be promoted
  // into the reference by this fallback: that would leave an origin proving itself
  const lent = Array.from({ length: 12 }, (_, index) => side(`cr:G980-${index + 13}`, index + 13, null))
  expect(numbersOutsideRun(lent, 13), 'the class 3 test, read the other way round').toBe(true)
  expect(referenceEpisodes({ episodes: lent, runLengthFrom: ['anilist:980'], runLength: 13 }).reference)
    .toEqual([])
  // nor may a list of specials, which carries no number to anchor on
  expect(referenceEpisodes({
    episodes: [side('anizip:980-S2', null, '2023-07-03')], runLengthFrom: ['anilist:980'], runLength: 13,
  }).reference).toEqual([])
})

// A REFUSAL THAT NAMES THE WRONG SIDE IS WHAT HID THIS. With no numbered row of our own, `retranslates`
// is a statement about a comparison that never happened, and it sent every reading of the trace at
// Netflix's titles.
// Mutation: delete the `no-reference` early return from `decideCandidate` and the first verdict below
// reads `retranslates`, which is what the live panel said for the whole session.
test('an empty reference refuses as no-reference, and a filled one places the seven rows', () => {
  const { theirs } = mushokuSides()
  expect(decideCandidate({ runLength: 13, reference: [], candidate: { retranslates: true, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-reference' })
  // a reference of specials alone is the same finding: rows, and not one number among them
  expect(decideCandidate({
    runLength: 13,
    reference: [side('anizip:980-S2', null, '2023-07-03', ['Advance Screening Event'])],
    candidate: { retranslates: true, episodes: theirs },
  })).toEqual({ ok: false, reason: 'no-reference' })

  // and the same candidate against the reference the fallback recovers: ours 1 to 12 under a run of
  // 13, theirs 25, so the closure's surplus of 13 is unaccounted and only the anchors and the rows
  // their brackets force ride out
  const reference = referenceEpisodes({
    episodes: countOnlySides(), runLengthFrom: ['anilist:980'], runLength: 13,
  }).reference
  const verdict = decideCandidate({ runLength: 13, reference, candidate: { retranslates: true, episodes: theirs } })
  expect(verdict.ok && verdict.rule).toBe('sequence')
  expect(verdict.ok && verdict.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[6, 5], [7, 6], [8, 7], [9, 8], [10, 9], [11, 10], [12, 11]])
  // every pair NAMES ani.zip's row and never Kitsu's, which carries the same number and no title
  expect(verdict.ok && verdict.pairs.every(pair => pair.to.uri.startsWith('anizip:980-'))).toBe(true)
})

// ---------------------------------------------------------------------------------------------
// THE SCORED ANCHOR (2026-09-13), and the four guards that keep it from becoming a second title
// rule. Every case here is about the ANCHOR test, and every one of them asserts that the placement
// is still order's: the score can add a weld and can never add a pair.

/** One side numbered 1 to N and titled by position, which is how every fixture below is built. */
const titledSide = (prefix: string, titles: readonly string[]): SideEpisode[] =>
  titles.map((name, index) => side(`${prefix}-${index + 1}`, index + 1, null, [name]))

// A SCORE NEVER PLACES A ROW, which is the whole safety argument. Two scored anchors sit next to each
// other, so no bracket has anything between them and the surplus is zero, and rule 3 mints NOTHING:
// the anchors ride out with the rows order placed or not at all.
// Mutation: mint on `anchored.length` alone in `pairsBySequence` and these two welds become two
// pairs on a similarity score, which is the Blue Exorcist shape and exactly what rule 2 is refused
// for on a retranslating origin.
test('a scored anchor proposes and never places: two of them with nothing between mint nothing', () => {
  const reference = titledSide('anizip:sc', ['Alpha Beta Gamma', 'Delta Epsilon Zeta', 'Eta Theta Iota', 'Kappa Lambda Mu'])
  const theirs = titledSide('nf:sc', ['Alpha Beta Gamma Extra', 'Delta Epsilon Zeta Extra', 'Unrelated Three', 'Unrelated Four'])

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, anchor.scored?.score]))
    .toEqual([[1, 1, 0.857], [2, 2, 0.857]])
  expect(sequence.alignment.scored, 'both anchors are welds, and the exact rule found none').toBe(2)
  expect(sequence.alignment.matches).toBe(0)
  expect(sequence.forced, 'adjacent anchors bracket nothing').toEqual([])
  expect(sequence.closure, 'and a surplus of zero closes nothing').toEqual([])
  expect(sequence.pairs, 'so order placed no row and rule 3 says nothing at all').toEqual([])
  expect(decideCandidate({ runLength: 4, reference, candidate: { retranslates: true, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'retranslates' })
  // `no-anchors` rather than `no-titles`: two welds and no equality is BELOW the anchor minimum, so
  // the refusal names the absence rather than a bar that was weighed (`minAnchorsFor`)
  expect(decideCandidate({ runLength: 4, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-anchors' })

  // THE CONTROL: the same two sides with one more row between the anchors on each side, which IS a
  // bracket, and a third weld so the alignment clears `MIN_SCORED_ANCHORS`. The anchors then ride
  // out with the row order placed.
  const wider = titledSide('anizip:sd', ['Alpha Beta Gamma', 'Middle Slot', 'Delta Epsilon Zeta', 'Eta Theta Iota'])
  const theirsWider = titledSide('nf:sd', [
    'Alpha Beta Gamma Extra', 'Their Own Middle', 'Delta Epsilon Zeta Extra', 'Eta Theta Iota Extra',
  ])
  const bracketed = pairsBySequence(wider, theirsWider)
  expect(bracketed.forced.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[2, 2]])
  expect(bracketed.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
  expect(bracketed.pairs.map(pair => pair.evidence)).toEqual([
    { scored: stripTitle('Alpha Beta Gamma Extra'), onto: stripTitle('Alpha Beta Gamma'), score: 0.857 },
    { between: ['nf:sd-1', 'nf:sd-3'] },
    { scored: stripTitle('Delta Epsilon Zeta Extra'), onto: stripTitle('Delta Epsilon Zeta'), score: 0.857 },
    { scored: stripTitle('Eta Theta Iota Extra'), onto: stripTitle('Eta Theta Iota'), score: 0.857 },
  ])
})

// THREE WELDS, NOT TWO, WHERE NO EQUALITY HOLDS THE ALIGNMENT DOWN (`MIN_SCORED_ANCHORS`).
// The input is the probe that disproved this file's first claim: with zero exact anchors, two welds
// at one offset and an equal gap between them, rule 3 minted FOUR pairs, two of them the welds
// themselves and two of them forced by an offset that came only from those two similarities. The
// bracket reads no title, but the offset it counts in is the anchors', so two votes for one offset
// is not a measurement.
// Mutation: `minAnchorsFor` returning `MIN_ALIGNED` unconditionally and the first alignment below
// mints [[1,2],[2,3],[3,4],[4,5]], which is the Blue Exorcist shape refitted from two votes.
test('an offset no exact equality corroborates needs three welds, not two', () => {
  expect([MIN_ALIGNED, MIN_SCORED_ANCHORS], 'the two minimums, and the second is the one under test')
    .toEqual([2, 3])
  const reference = titledSide('anizip:mn', [
    'Alpha Report Filed', 'The Black Swordsman', 'Filler Number Three', 'Filler Number Four',
    'The Red Nosed Reindeer', 'Omega Report Filed',
  ])
  const theirs = titledSide('nf:mn', [
    'The Black Swordsman Returns', 'Their Own Second Row', 'Their Own Third Row', 'The Red Nosed Reindeer Again',
  ])

  // the two welds are real, the bracket between them counts two rows on each side, and the gate
  // still mints nothing, which is the whole of the fix
  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, anchor.scored?.score]))
    .toEqual([[1, 2, 0.857], [4, 5, 0.889]])
  expect([sequence.alignment.scored, sequence.alignment.matches]).toEqual([2, 0])
  expect(sequence.forced.map(pair => [pair.fromNumber, pair.toNumber]),
    'the bracket did force rows, so this is the gate refusing and not an empty bracket')
    .toEqual([[2, 3], [3, 4]])
  expect(sequence.pairs, 'two welds and no equality: below MIN_SCORED_ANCHORS, so nothing is minted').toEqual([])
  expect(decideCandidate({ runLength: 6, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-anchors' })

  // THE CONTROL, so the bar is a bar and not a switch: one more weldable row, three welds agreeing
  // on the same offset, and the same alignment mints
  const third = titledSide('nf:mo', [
    'The Black Swordsman Returns', 'Their Own Second Row', 'Filler Number Four Extra', 'The Red Nosed Reindeer Again',
  ])
  const passes = pairsBySequence(reference, third)
  expect(passes.alignment.scored).toBe(3)
  expect(passes.pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[1, 2], [2, 3], [3, 4], [4, 5]])

  // AND ONE EXACT ANCHOR IS ENOUGH TO DROP BACK TO TWO, which is the fifth pairing the live corpus
  // unlocks (Blue Exorcist season 3: one exact anchor, one weld, one row forced between them)
  const withExact = titledSide('nf:mp', [
    'The Black Swordsman Returns', 'Their Own Second Row', 'Filler Number Four', 'Their Own Fourth Row',
  ])
  const corroborated = pairsBySequence(reference, withExact)
  expect(corroborated.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, Boolean(anchor.scored)]))
    .toEqual([[1, 2, true], [3, 4, false]])
  expect(corroborated.pairs.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[1, 2], [2, 3], [3, 4]])
})

// THE WINDOW IS PART OF THE GATE, because `pairsBySequence` counts before it and `decideCandidate`
// applies it after. The probe: two welds inside `1..runLength` and every row the closure placed
// above it, so the pairs left standing were the two similarities and nothing order placed.
// Mutation: drop `placedInWindow` from the two conditions in `decideCandidate` and this returns
// `ok: 'sequence'` with the two weld pairs, on an alignment where order placed nothing that counts.
test('an order-placed row outside the run is not a row order placed', () => {
  // our own numbering runs past `runLength`, which is reachable: `reference` is filtered by origin
  // membership and only its COUNT is checked against the run, never its numbering
  const reference = [
    ...titledSide('anizip:wd', [
      'Alpha Beta Gamma', 'Delta Epsilon Zeta', 'Eta Theta Iota', 'Kappa Lambda Mu', 'Nu Xi Omicron',
    ]),
    side('anizip:wd-s1', null, '2026-07-10', ['Guardian Fitz']),
  ]
  const theirs = titledSide('nf:wd', [
    'Alpha Beta Gamma Extra', 'Delta Epsilon Zeta Extra', 'Eta Theta Iota Extra', 'Fitz the Guardian',
    'Their Own Fifth Row', 'Their Own Sixth Row',
  ])

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.scored, 'three welds, so MIN_SCORED_ANCHORS is not what refuses here').toBe(3)
  expect(sequence.closure.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[5, 4], [6, 5]])
  expect(sequence.pairs.map(pair => [pair.fromNumber, pair.toNumber]),
    'before the window, order placed two rows and rule 3 speaks')
    .toEqual([[1, 1], [2, 2], [3, 3], [5, 4], [6, 5]])

  // runLength 3 puts both rows the closure placed outside the run, leaving three welds inside it
  expect(decideCandidate({ runLength: 3, reference, candidate: { retranslates: true, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'retranslates' })
  expect(decideCandidate({ runLength: 3, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-titles' })

  // THE CONTROL: the same two sides against the whole run, where those rows are inside the window
  // and rule 3 speaks, so the rig can express the verdict it refuses above
  const verdict = decideCandidate({ runLength: 5, reference, candidate: { retranslates: true, episodes: theirs } })
  expect(verdict.ok && verdict.rule).toBe('sequence')
  expect(verdict.ok && verdict.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[1, 1], [2, 2], [3, 3], [5, 4], [6, 5]])
  expect(verdict.ok && verdict.sequence?.scored).toBe(3)
})

// A WELD NAMES THE ROW WHOSE TITLE CARRIED THE KEY, which is what `Anchor.to` is documented as and
// what 3.2 traces show. Several origins describe one number, so the key that won the score can
// belong to any of them.
// Mutation: `to: canonical[best.index]!.rows[0]!` in `scoredAnchors` and the anchor names
// `anizip:tn-2`, whose only title shares no token with the evidence's `onto`.
test('a scored anchor names the reference row whose title carried the key', () => {
  const reference = [
    side('anizip:tn-1', 1, null, ['Alpha One Marker']),
    // two origins at number 2, and the winning key belongs to the SECOND of them by uri
    side('anizip:tn-2', 2, null, ['Totally Different Words Here']),
    side('kitsu:tn-2', 2, null, ['The Black Swordsman']),
    side('anizip:tn-3', 3, null, ['Omega Three Marker']),
  ]
  const theirs = titledSide('nf:tn', ['Unshared One', 'The Black Swordsman Returns', 'Unshared Three'])

  const anchors = alignByTitle(reference, theirs).anchors
  expect(anchors.map(anchor => [anchor.from.uri, anchor.to.uri, anchor.to.number]))
    .toEqual([['nf:tn-2', 'kitsu:tn-2', 2]])
  expect(anchors[0]!.scored).toEqual({ onto: stripTitle('The Black Swordsman'), score: 0.857 })
  // the key the evidence names is a key of the row the anchor names, which is the property
  expect(anchors[0]!.to.keys.map(stripTitle)).toContain(anchors[0]!.scored!.onto)
})

// THE MARGIN REFUSES AMBIGUITY RATHER THAN RESOLVING IT, pinned on the case the constant was
// measured from: Mushoku Tensei's Netflix season 3, where `Rage, Mad Dog` scores 0.667 against our
// `Howl, Mad Dog` and 0.571 against our `Burn Bright, Mad Dog`. Truth is N onto N, so the higher
// score is the WRONG neighbour, and the margin refuses the row rather than picking between the two.
// Order then places it anyway through the bracket, so the ambiguity costs the pairing nothing.
// Mutation: drop the margin test in `scoredAnchors` and their row 4 welds onto our 3, which mints
// the wrong pair [4, 3], loses the two rows the bracket forced, and leaves two regions refused.
test('the margin refuses the Mushoku season 3 ambiguity, and order places the row anyway', () => {
  const reference = titledSide('anizip:md', [
    'The Search for Nanahoshi', 'Rudeus Returns', 'Howl, Mad Dog', 'Burn Bright, Mad Dog',
    'The Labyrinth of Teleportation', 'The Water God\'s Wrath',
  ])
  const theirs = titledSide('nf:md', [
    'Nanahoshi Search', 'Rudeus Returns', 'A Quiet Night', 'Rage, Mad Dog',
    'Teleportation Labyrinth', 'Wrath of the Water God',
  ])

  // THE PREMISE, measured rather than asserted: the two candidates are 0.095 apart, which no floor
  // can separate and the margin refuses outright
  const best = titleDice(stripTitle('Rage, Mad Dog'), stripTitle('Howl, Mad Dog'))
  const second = titleDice(stripTitle('Rage, Mad Dog'), stripTitle('Burn Bright, Mad Dog'))
  expect([Math.round(best * 1000) / 1000, Math.round(second * 1000) / 1000]).toEqual([0.667, 0.571])
  expect(best, 'the wrong neighbour clears the floor on its own').toBeGreaterThan(SCORED_ANCHOR_FLOOR)
  expect(best - second, 'and is not clear of the true one').toBeLessThan(SCORED_ANCHOR_MARGIN)

  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[1, 1], [2, 2], [5, 5], [6, 6]])
  expect(sequence.alignment.anchors.filter(anchor => !anchor.scored).map(anchor => anchor.from.number),
    'one exact anchor, which is why the fallback ran at all').toEqual([2])
  expect(sequence.alignment.anchors.some(anchor => anchor.from.number === 4),
    '`Rage, Mad Dog` is no anchor').toBe(false)
  // and the row is placed by ORDER, onto the true slot the score ranked second
  expect(sequence.forced.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[3, 3], [4, 4]])
  expect(sequence.forced[1]!.evidence).toEqual({ between: ['nf:md-2', 'nf:md-5'] })
  expect(sequence.unequal).toBe(0)
  expect(sequence.pairs.map(pair => [pair.fromNumber, pair.toNumber]))
    .toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])
})

// AN EXACT MATCH IS AN ANCHOR AT ANY MARGIN, so the change can only ADD anchors. Two ways a looser
// test could take one away, and neither is allowed: the margin never reads an exact match, and a
// scored proposal that CROSSES an exact anchor is dropped before the monotone filter could prefer it.
// Mutation: apply the floor and the margin to the exact matches too and the near-tied `(Part 1)`
// anchor below is refused, which is the 23 of 1600 exact agreements the corpus sweep measured losing;
// drop `clearsAnchors` and the two crossing welds below beat the exact anchor 2 to 1 on length and
// the anchor the shipped rule holds is GONE.
test('an exact match is an anchor at any margin, and no score displaces one', () => {
  // the near tie, from the corpus sweep: `(Part 1)` and `(Part 2)` are 0.857 apart by Dice, a gap of
  // 0.143, which is inside the margin
  const parts = titledSide('anizip:pt', [
    'Zeta Nine Marker', 'The Knight\'s Festival of the Hunt (Part 1)',
    'The Knight\'s Festival of the Hunt (Part 2)', 'Omega Twelve Marker',
  ])
  const theirPart = titledSide('jw:pt', ['Unshared One', 'The Knight\'s Festival of the Hunt (Part 1)'])
  const nearTie = titleDice(
    stripTitle('The Knight\'s Festival of the Hunt (Part 1)'),
    stripTitle('The Knight\'s Festival of the Hunt (Part 2)')
  )
  expect(Math.round(nearTie * 1000) / 1000).toBe(0.857)
  expect(1 - nearTie, 'an exact match with a neighbour inside the margin').toBeLessThan(SCORED_ANCHOR_MARGIN)
  const held = alignByTitle(parts, theirPart)
  expect(held.anchors.map(anchor => [anchor.from.number, anchor.to.number, Boolean(anchor.scored)]))
    .toEqual([[2, 2, false]])

  // THE CROSSING WELDS: two rows of theirs score high onto our 5 and 6 while an exact anchor sits at
  // our 2, so a chain of the two welds is LONGER than the chain holding the anchor
  const reference = titledSide('anizip:cr', [
    'Alpha Beta Gamma', 'Delta Epsilon Zeta', 'Eta Theta Iota', 'Kappa Lambda Mu', 'Nu Xi Omicron', 'Pi Rho Sigma',
  ])
  const crossing = titledSide('nf:cr', ['Nu Xi Omicron Extra', 'Pi Rho Sigma Extra', 'Delta Epsilon Zeta'])
  const alignment = alignByTitle(reference, crossing)
  expect(alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, Boolean(anchor.scored)]),
    'the exact anchor, and neither weld').toEqual([[3, 2, false]])
  expect(alignment.scored).toBe(0)
  expect(pairsBySequence(reference, crossing).pairs, 'one anchor brackets nothing').toEqual([])

  // THE CONTROL: the same two welds the other way round, which cross nothing, and they are admitted
  const straight = titledSide('nf:cs', ['Delta Epsilon Zeta', 'Nu Xi Omicron Extra', 'Pi Rho Sigma Extra'])
  expect(alignByTitle(reference, straight).anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[1, 2], [2, 5], [3, 6]])
})

// ONE NUMBER, ONE ROW, for a score exactly as for an exact title, and the interesting case is a
// number an exact match reached and the MONOTONE FILTER then dropped. `single` rather than the
// surviving anchors decides what is taken, so an equality that lost to a crossing one still holds its
// number against a weld: the reason it is not an anchor is that it crosses, which is no licence.
// Mutation: drop the `takenSlots` test and the third row below welds onto our 5, which their row 1
// proved exactly, giving two anchors where the shipped rule has one and a refused region where it has
// none. `clearsAnchors` cannot catch this one: the anchor it would displace is not in the set it
// checks against, which is exactly why both guards exist.
test('a number an exact title reached is no anchor for a score, even a dropped one', () => {
  const reference = titledSide('anizip:tk', [
    'Alpha One Marker', 'Delta Epsilon Zeta', 'Eta Theta Iota', 'Kappa Lambda Mu', 'Nu Xi Omicron', 'Pi Rho Sigma',
  ])
  // their 1 and 2 are exact and CROSS, so one of the two matches survives the monotone filter and the
  // other is dropped while still owning its number
  const theirs = titledSide('cr:tk', ['Nu Xi Omicron', 'Delta Epsilon Zeta', 'Nu Xi Omicron Extra'])

  const alignment = alignByTitle(reference, theirs)
  expect(alignment.matches, 'two exact unique matches, which disagree about the order').toBe(2)
  expect(alignment.anchors.map(anchor => [anchor.from.number, anchor.to.number, Boolean(anchor.scored)]))
    .toEqual([[2, 2, false]])
  expect(alignment.scored).toBe(0)
  expect(pairsBySequence(reference, theirs).unequal, 'and no region was even reached').toBe(0)

  // THE CONTROL: the same weld with the exact matches gone, which is admitted, so the rig can express
  // the anchor it refuses above
  const alone = titledSide('cr:tl', ['Unshared One', 'Unshared Two', 'Nu Xi Omicron Extra'])
  expect(alignByTitle(reference, alone).anchors.map(anchor => [anchor.from.number, anchor.to.number, anchor.scored?.score]))
    .toEqual([[3, 5, 0.857]])

  // TWO SCORED ROWS ONTO ONE NUMBER: both clear the floor and both are clear of their own runner-up,
  // and the number they share names neither.
  // Mutation: drop the claims filter over the proposals and it anchors whichever row the scan reached
  // first, which is an arrival-order answer to an identity question.
  const shared = titledSide('anizip:nk', ['Unshared One', 'Alpha Beta Gamma', 'Kappa Lambda'])
  const doubled = titledSide('nf:nk', ['Alpha Beta Gamma Delta', 'Alpha Beta Gamma Epsilon', 'Distinct Third Row'])
  expect(alignByTitle(shared, doubled).anchors).toEqual([])
  expect(alignByTitle(shared, doubled).scored).toBe(0)

  // THE CONTROL: one of the two rows alone, which anchors
  expect(alignByTitle(shared, [doubled[0]!, doubled[2]!]).anchors.map(anchor => [anchor.from.number, anchor.to.number]))
    .toEqual([[1, 2]])
})

// THE CONSTANTS THEMSELVES, and the measurements they were chosen from, so a scorer swap or a moved
// threshold reddens a case rather than quietly changing what welds. Every number here was measured
// on 2026-09-13; the calibration behind them is in the constants' own doc comments.
// Mutation: swap `titleDice` for any other scorer and the five values below change; move either
// constant and one of the four comparisons flips.
test('the floor and the margin are the calibrated pair, on token Dice', () => {
  expect([SCORED_ANCHOR_FLOOR, SCORED_ANCHOR_MARGIN]).toEqual([0.6, 0.15])
  const dice = (a: string, b: string): number =>
    Math.round(titleDice(stripTitle(a), stripTitle(b)) * 1000) / 1000
  // ORDER IS FREE, which is the retranslation shape 3.4a's own token match was written for
  expect(dice('Guardian Fitz', 'Fitz Guardian')).toBe(1)
  // and the real pair off that season, where Netflix also carries an article ani.zip does not
  expect(dice('Fitz the Guardian', 'Guardian Fitz')).toBe(0.8)
  // one word of four replaced, which is what the floor admits
  expect(dice('The Nijimura Brothers, Part 2', 'The Nijimura Brothers, Part 1')).toBe(0.8)
  // a genuine retranslation of the same episode, which it does NOT admit: `Unwilling to Die` against
  // `I Don't Want to Die` is 0.5, and that row is placed by the bracket instead
  expect(dice('Unwilling to Die', 'I Don\'t Want to Die')).toBe(0.5)
  // two unrelated episodes of one season, which is the hazard the floor is set against: 21.8% of the
  // recorded page's titled rows have a NEIGHBOUR clearing 0.34, and 42% of the Netflix ones do
  expect(dice('A Quiet Night', 'The Water God\'s Wrath')).toBe(0)
  expect(dice('This Feeling', 'These Feelings'), 'and Dice is a TOKEN measure, so a plural is a miss').toBe(0)

  // AND THE FLOOR REFUSES, rather than merely scoring low: the 0.5 pair anchors NOTHING, which is
  // what leaves it to the bracket in the measured season above.
  // Mutation: drop the floor test in `scoredAnchors` and the retranslated row welds on 0.5, which is
  // a score placing a row against a field it never cleared
  const reference = titledSide('anizip:fl', ['Alpha One Marker', 'I Don\'t Want to Die', 'Omega Nine Marker'])
  const under = titledSide('nf:fl', ['Unshared One', 'Unwilling to Die', 'Unshared Three'])
  expect(alignByTitle(reference, under).anchors).toEqual([])
  // THE CONTROL: the same row rewritten to clear the floor, which welds
  const over = titledSide('nf:fm', ['Unshared One', 'I Do Not Want to Die', 'Unshared Three'])
  expect(alignByTitle(reference, over).anchors.map(anchor => [anchor.from.number, anchor.to.number, anchor.scored?.score]))
    .toEqual([[2, 2, 0.727]])
})

// ---------------------------------------------------------------------------------------------
// Rule 3's THIRD anchor source: the episode SYNOPSIS, and the offset consensus that gates it.

/**
 * One side of a measured season, as it arrives from `plugin:profile`.
 *
 * TITLES ARE DELIBERATELY ABSENT on both sides, which is not a convenience: it is the population the
 * source exists for. Netflix titles season 1 and season 3 `Episode N`, which `anchorKeysOf` drops as
 * generic, and retranslates season 2, so the exact and the scored anchors reach nothing on any of
 * the three and every anchor below is a synopsis anchor. A case that let a title through would be
 * measuring the title rules with extra steps.
 */
const synopsisSide = (prefix: string, keys: readonly string[]): SideEpisode[] =>
  keys.map((key, index) => side(`${prefix}-${index + 1}`, index + 1, null, [], key ? [key] : []))

const measuredSeason = (name: keyof typeof MUSHOKU_SYNOPSES) => ({
  reference: synopsisSide(`anizip:mt-${name}`, MUSHOKU_SYNOPSES[name].ours),
  theirs: synopsisSide(`nf:mt-${name}`, MUSHOKU_SYNOPSES[name].theirs),
})

/** The offsets a set of anchors implies, as `{offset: count}`, which is what the consensus votes on. */
const offsetsOf = (anchors: readonly { from: SideEpisode, to: SideEpisode }[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const anchor of anchors) {
    const offset = String(anchor.to.number! - anchor.from.number!)
    counts[offset] = (counts[offset] ?? 0) + 1
  }
  return counts
}

// THE HEADLINE MEASUREMENT (2026-09-13), reproduced from the recorded rows of all three seasons: the
// floor and the margin propose 10, 9 and 9 anchors carrying 1, 2 and 1 WRONG ones, and the consensus
// leaves 9, 7 and 8 with none wrong. The truth offsets are 0, -1 and 0, season 2's because Netflix
// numbers a special as its episode 1.
// Mutation: return `{ offset, anchors: [...anchors] }` from `offsetConsensus` rather than filtering,
// and each season keeps its outliers: season 1 anchors `24 onto 18`, season 2 `12 onto 5` and
// `22 onto 20`, season 3 `4 onto 9`, which is a play button on the wrong episode.
test('the three measured seasons propose the same anchors and agree on the true offset', () => {
  const measured = {
    s1: { proposed: 10, offsets: { '0': 9, '-6': 1 }, consensus: 0, kept: 9 },
    s2: { proposed: 9, offsets: { '-1': 7, '-7': 1, '-2': 1 }, consensus: -1, kept: 7 },
    s3: { proposed: 9, offsets: { '0': 8, '5': 1 }, consensus: 0, kept: 8 },
  } as const

  for (const name of ['s1', 's2', 's3'] as const) {
    const { reference, theirs } = measuredSeason(name)
    const alignment = alignByTitle(reference, theirs)
    expect(alignment.anchors.length - alignment.synopsis, `${name}: no title reaches this season`).toBe(0)
    const proposal = synopsisAnchors({
      ordered: alignment.theirs, canonical: alignment.canonical, taken: [], anchors: [],
    })
    expect({
      proposed: proposal.proposed.length,
      offsets: offsetsOf(proposal.proposed),
      consensus: proposal.consensus,
      kept: proposal.anchors.length,
    }, name).toEqual(measured[name])
    // and what survives is EXACTLY the consensus offset, which is the sentence the gate promises
    expect(offsetsOf(proposal.anchors), name).toEqual({ [String(measured[name].consensus)]: measured[name].kept })
    expect(proposal.anchors.every(anchor => anchor.synopsis!.consensus === measured[name].consensus), name).toBe(true)
  }
})

// WHAT THE WHOLE RULE THEN MINTS, which is the reason the source was added: three Netflix seasons
// that reach rule 1 with no dates, rule 2 refused for retranslating, and rule 3's two title anchors
// with nothing to bracket. Season 3 is the one the app shows zero sources on today.
// Mutation: drop `synopsisAnchors` from `alignByTitle`'s union and all three seasons refuse
// `no-anchors` with no pairs at all.
test('the synopsis anchors carry all three measured seasons through rule 3', () => {
  const minted = { s1: { anchors: 9, forced: 11, pairs: 20 }, s2: { anchors: 7, forced: 16, pairs: 23 }, s3: { anchors: 8, forced: 2, pairs: 10 } } as const
  for (const name of ['s1', 's2', 's3'] as const) {
    const { reference, theirs } = measuredSeason(name)
    const sequence = pairsBySequence(reference, theirs)
    expect({
      anchors: sequence.anchored.length, forced: sequence.forced.length, pairs: sequence.pairs.length,
    }, name).toEqual(minted[name])
    expect(sequence.unequal, `${name}: no region disagreed`).toBe(0)
    // every pair sits on the consensus offset, anchors and bracket-forced rows alike
    const offset = sequence.alignment.consensus!
    expect(sequence.pairs.every(pair => pair.toNumber - pair.fromNumber === offset), name).toBe(true)

    const verdict = decideCandidate({
      runLength: reference.length, reference, candidate: { retranslates: true, episodes: theirs },
    })
    expect(verdict.ok && verdict.rule, `${name}: rule 3 runs where rule 2 is refused`).toBe('sequence')
    expect(verdict.ok && verdict.sequence?.synopsis, name).toBe(minted[name].anchors)
    expect(verdict.ok && verdict.sequence?.consensus, name).toBe(offset)
  }
  // and the evidence names the score and the offset rather than two paragraphs of prose
  const { reference, theirs } = measuredSeason('s3')
  expect(pairsBySequence(reference, theirs).anchored[0]!.evidence).toEqual({ synopsisScore: 0.286, consensus: 0 })
})

// THE MONOTONE-BUT-WRONG SHAPE, which is the whole reason the gate is a consensus and not a second
// monotone pass. Season 1's `11 onto 13` INTERLEAVES with the true anchors instead of crossing them,
// so every longest increasing chain of the set contains it and an LIS-only filter keeps it.
//
// IT IS SEEDED RATHER THAN SCORED, and that is stated in `MIN_CONSENSUS_ANCHORS` too: the shape was
// recorded on 2026-09-13 at a coarser content-word cut, and at the cut this file ships Netflix's
// episode 11 scores 0.188 against TMDB's 13 and 0.188 against its 19, so the margin and the floor
// both refuse it. What is asserted here is therefore the GATE and not the scorer.
// Mutation: replace `offsetConsensus`'s body with the longest-increasing-subsequence filter below and
// the wrong anchor survives, with nine correct anchors standing behind it.
test('an outlier that is monotone against the true anchors is caught by consensus and not by LIS', () => {
  const anchor = (from: number, to: number) => ({
    from: side(`nf:s1-${from}`, from, null), to: side(`anizip:s1-${to}`, to, null),
    fromIndex: from - 1, toIndex: to - 1, key: `k${from}`, synopsis: { score: 0.2, consensus: 0 },
  })
  // season 1's nine true anchors, plus the one that reads Netflix's episode 11 as TMDB's episode 13
  const truthful = [3, 7, 8, 10, 14, 17, 18, 19, 22].map(number => anchor(number, number))
  const anchors = [...truthful, anchor(11, 13)].sort((a, b) => a.fromIndex - b.fromIndex)

  // THE CONTROL, and it must pass or this case proves nothing: a longest increasing subsequence over
  // the same ten anchors keeps all ten, because 11 onto 13 sits strictly inside 10 onto 10 and
  // 14 onto 14 in BOTH indices and therefore extends the chain
  const lis = (input: readonly { fromIndex: number, toIndex: number }[]) => {
    const best: number[] = []
    for (const entry of input) {
      let at = best.findIndex(value => value >= entry.toIndex)
      if (at < 0) at = best.length
      best[at] = entry.toIndex
    }
    return best.length
  }
  expect(lis(anchors), 'LIS keeps the wrong anchor').toBe(10)
  expect(lis(truthful), 'and the true chain alone is nine').toBe(9)

  const agreed = offsetConsensus(anchors)
  expect(agreed?.offset).toBe(0)
  expect(agreed?.anchors.map(entry => [entry.from.number, entry.to.number]))
    .toEqual(truthful.map(entry => [entry.from.number, entry.to.number]))
  expect(agreed!.anchors.some(entry => entry.from.number === 11), 'the +2 anchor is gone').toBe(false)
})

// NO MAJORITY MEANS NOTHING IS MINTED, in each of the three shapes that can fail to be one. A rule
// that took the best offset available would mint on all three.
// Mutation: drop the `top * 2 <= anchors.length` clause and the plurality case below anchors on
// 4 of 11 votes and the TIE below anchors on 4 of 8; drop the `top < MIN_CONSENSUS_ANCHORS` clause
// and two agreeing anchors out of three carry a season.
test('a season with no majority of one offset mints nothing', () => {
  const anchor = (from: number, to: number) => ({
    from: side(`nf:n-${from}`, from, null), to: side(`anizip:n-${to}`, to, null),
    fromIndex: from - 1, toIndex: to - 1, key: `k${from}`, synopsis: { score: 0.2, consensus: 0 },
  })
  const at = (offset: number, count: number, base = 0) =>
    Array.from({ length: count }, (_, index) => anchor(base + index + 1, base + index + 1 + offset))

  // too few anchors to take a majority of, however unanimous they are
  expect(offsetConsensus(at(0, MIN_CONSENSUS_ANCHORS - 1))).toBe(null)
  expect(offsetConsensus(at(0, MIN_CONSENSUS_ANCHORS))?.offset, 'the control: one more agrees').toBe(0)
  // a TIE names no majority: four and four. It needs no clause of its own, and that is worth
  // asserting rather than assuming: two offsets tied at the top hold k of at least 2k anchors, so
  // the majority test below refuses every tie there can be
  expect(offsetConsensus([...at(0, 4), ...at(3, 4, 10)])).toBe(null)
  // three against two is a majority and is REFUSED anyway, because it does not clear
  // `MIN_CONSENSUS_GAP`: this line read `?.offset).toBe(0)` until 2026-09-13
  expect(offsetConsensus([...at(0, 3), ...at(3, 2, 10)])).toBe(null)
  // the smallest set a majority admits is the one nothing contests
  expect(offsetConsensus(at(0, MIN_CONSENSUS_ANCHORS))?.offset).toBe(0)
  // while two agreeing is not a measurement however lonely the other one is
  expect(offsetConsensus([...at(0, 2), ...at(3, 1, 10)])).toBe(null)
  // a bare PLURALITY is not a majority either: 4 of 11, which is the shape a five letter token cut
  // makes of season 2 (`MIN_SYNOPSIS_TOKEN`)
  expect(offsetConsensus([...at(0, 4), ...at(3, 3, 10), ...at(-5, 2, 20), ...at(7, 2, 30)])).toBe(null)
  // THE CONTROL, one vote moved across so the top offset holds more than half AND clears the gap
  expect(offsetConsensus([...at(0, 6), ...at(3, 3, 10), ...at(-5, 2, 20)])?.offset).toBe(0)

  // and a season whose synopses meet no majority anchors NOTHING and refuses in writing, rather than
  // anchoring on the best offset it saw
  const noise = ['alpha bravo charlie delta echo foxtrot', 'golf hotel india juliet kilo lima',
    'mike november oscar papa quebec romeo', 'sierra tango uniform victor whisky xray']
  const reference = synopsisSide('anizip:q', noise)
  const theirs = synopsisSide('nf:q', [...noise].reverse())
  const alignment = alignByTitle(reference, theirs)
  expect({ synopsis: alignment.synopsis, consensus: alignment.consensus }).toEqual({ synopsis: 0, consensus: null })
  // `retranslates: false`, because that refusal is about the ORIGIN and outranks every rule 3 one
  expect(decideCandidate({ runLength: 4, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-anchors' })
})

// A MAJORITY IS NOT A CORRECTNESS PROOF, and this is the shape that proves it: four anchors agreeing
// on a WRONG offset against three agreeing on the right one. Every clause the rule had before
// 2026-09-13 passes it (7 anchors, top holds 4, 4 * 2 > 7), so a bare majority answers `offset 5`
// and mints four wrong pairs. `MIN_CONSENSUS_GAP` is the clause that refuses it.
// Mutation: delete the `top - (ranked[1]?.[1] ?? 0) < gap` line and the first expectation below
// answers `{ offset: 5, anchors: 4 }` instead of null.
test('a wrong offset that outnumbers the right one is refused, not minted', () => {
  const anchor = (from: number, to: number) => ({
    from: side(`nf:g-${from}`, from, null), to: side(`anizip:g-${to}`, to, null),
    fromIndex: from - 1, toIndex: to - 1, key: `k${from}`, synopsis: { score: 0.2, consensus: 0 },
  })
  const wrong = [1, 2, 3, 4].map(number => anchor(number, number + 5))
  const right = [10, 11, 12].map(number => anchor(number, number))
  expect(offsetConsensus([...wrong, ...right])).toBe(null)
  // THE CONTROL, and it has to pass or the case proves only that the function can return null: two
  // more anchors on the wrong offset and the gap is met, so the vote answers again AND ANSWERS
  // WRONG. The rule is a heuristic either way, which is what the doc on `MIN_CONSENSUS_GAP` says out
  // loud: the gap buys distance from the shapes that have been seen, never correctness
  const decisive = offsetConsensus([...wrong, anchor(5, 10), anchor(6, 11), ...right])
  expect({ offset: decisive?.offset, kept: decisive?.anchors.length }).toEqual({ offset: 5, kept: 6 })
  // and the mirror image, the majority on the RIGHT offset, is kept: the refusal above is about the
  // vote's shape and not about these particular rows
  const other = [10, 11, 12, 13, 14, 15].map(number => anchor(number, number))
  expect(offsetConsensus([...[1, 2, 3].map(number => anchor(number, number + 5)), ...other])?.offset).toBe(0)
})

// TWO CLAIMS THE DOC ON `offsetConsensus` MAKES, pinned rather than left as an argument, because the
// reviewer asked for a monotone filter and a contiguity test on top of the vote and the answer is
// that the first is already implied and the second would refuse every real season.
// Mutation: none is possible for the monotone half, and that is the point: it is a property of one
// offset, so no line can be deleted to break it. The contiguity half fails if a span test is added.
test('a kept consensus set is already monotone, and is never contiguous', () => {
  const anchor = (from: number, to: number) => ({
    from: side(`nf:m-${from}`, from, null), to: side(`anizip:m-${to}`, to, null),
    fromIndex: from - 1, toIndex: to - 1, key: `k${from}`, synopsis: { score: 0.2, consensus: 0 },
  })
  // deliberately scrambled, and carrying two outliers that a monotone filter would have to judge
  const scrambled = [
    anchor(7, 7), anchor(2, 9), anchor(1, 1), anchor(12, 12), anchor(4, 4), anchor(9, 3), anchor(3, 3),
  ]
  const agreed = offsetConsensus(scrambled)!
  expect(agreed.offset).toBe(0)
  const kept = agreed.anchors
  expect(kept.map(entry => entry.from.number)).toEqual([7, 1, 12, 4, 3])
  // MONOTONE IN VALUE, whatever order the input arrived in: one offset means to = from + offset, so
  // sorting by `from` sorts by `to` as well and a longest increasing subsequence returns everything
  const byFrom = [...kept].sort((a, b) => a.from.number! - b.from.number!)
  expect(byFrom.map(entry => entry.to.number)).toEqual([1, 3, 4, 7, 12])
  expect(byFrom.every((entry, index) => index === 0 || entry.to.number! > byFrom[index - 1]!.to.number!)).toBe(true)
  // AND NOT CONTIGUOUS: 5 anchors spanning rows 1 to 12. The seven rows between them are exactly
  // what order places, so a rule demanding a contiguous span would refuse this and every season the
  // corpus measured (2026-09-13: 466 anchors over 216 order-placed rows on 21 pairings)
  expect(byFrom[byFrom.length - 1]!.from.number! - byFrom[0]!.from.number! + 1).toBe(12)
  expect(kept).toHaveLength(5)
})

// AN ANCHOR WITH NO NUMBER IS REFUSED RATHER THAN READ AS NaN. Inside `alignByTitle` both lists are
// number filtered and this cannot arise; `offsetConsensus` is exported, so an external caller used to
// get `to.number!` on a null and every unnumbered anchor collapsed onto the one NaN key.
// Mutation: drop the `numbered` filter and the first expectation answers `{ offset: NaN }`.
test('offsetConsensus refuses an anchor with no number instead of answering NaN', () => {
  const anchor = (from: number | null, to: number | null, index: number) => ({
    from: side(`nf:u-${index}`, from, null), to: side(`anizip:u-${index}`, to, null),
    fromIndex: index, toIndex: index, key: `k${index}`, synopsis: { score: 0.2, consensus: 0 },
  })
  expect(offsetConsensus([anchor(null, 1, 0), anchor(null, 2, 1), anchor(null, 3, 2)])).toBe(null)
  expect(offsetConsensus([anchor(1, null, 0), anchor(2, null, 1), anchor(3, null, 2)])).toBe(null)
  // THE CONTROL: the same three anchors with numbers answer, so the refusal is the null and not the
  // count. And an unnumbered anchor mixed into a real set is dropped rather than counted
  expect(offsetConsensus([anchor(1, 1, 0), anchor(2, 2, 1), anchor(3, 3, 2)])?.offset).toBe(0)
  const mixed = offsetConsensus([anchor(1, 1, 0), anchor(2, 2, 1), anchor(3, 3, 2), anchor(null, 9, 3)])
  expect({ offset: mixed?.offset, kept: mixed?.anchors.length }).toEqual({ offset: 0, kept: 3 })
})

// RULE 3'S STANDING PROPERTY, restated for the new source: an anchor PROPOSES and order PLACES, so a
// set of synopsis anchors with nothing between them mints nothing at all. This is the same case the
// scored anchor has one screen up, and it is repeated because the gate is a property of the rule
// rather than of one anchor source.
// Mutation: return `[...anchored, ...placed]` unconditionally from `pairsBySequence` and the three
// anchors below ride out as three pairs proven by a synopsis similarity and by nothing else.
test('a synopsis anchor alone never places a row', () => {
  const keys = MUSHOKU_SYNOPSES.s3.ours.slice(0, 3)
  const reference = synopsisSide('anizip:a', keys)
  const theirs = synopsisSide('nf:a', keys)
  const sequence = pairsBySequence(reference, theirs)
  expect(sequence.alignment.synopsis, 'all three rows anchor on their own synopsis').toBe(3)
  expect(sequence.alignment.consensus).toBe(0)
  expect({ forced: sequence.forced, closure: sequence.closure, pairs: sequence.pairs })
    .toEqual({ forced: [], closure: [], pairs: [] })
  expect(decideCandidate({ runLength: 3, reference, candidate: { retranslates: false, episodes: theirs } }))
    .toEqual({ ok: false, reason: 'no-titles' })
  // THE CONTROL: a fourth row, with one row of theirs left unanchored BETWEEN two anchors so order
  // can place it, and the three surviving anchors then ride out with it. Four rather than three
  // because `minAnchorsFor` asks three anchors of an alignment no equality holds down, so an
  // unanchored row has to be paid for with one more anchor
  const wider = MUSHOKU_SYNOPSES.s3.ours.slice(0, 4)
  const widerReference = synopsisSide('anizip:b', wider)
  const gapped = synopsisSide('nf:b', [wider[0]!, 'entirely unrelated words nobody ever wrote', wider[2]!, wider[3]!])
  const placed = pairsBySequence(widerReference, gapped)
  expect(placed.alignment.synopsis, 'rows 1, 3 and 4 anchor').toBe(3)
  expect(placed.forced.map(pair => [pair.fromNumber, pair.toNumber])).toEqual([[2, 2]])
  expect(placed.pairs).toHaveLength(4)
})

// THE SYNOPSIS IS THE WEAKEST SOURCE AND IS OFFERED LAST, so a row or a number a title already
// reached is never scored against a paragraph. `taken` carries EVERY exact match, including one the
// monotone filter dropped, which is why it is asked for rather than read off `anchors`.
// Mutation: drop the `takenRows.has(row.uri)` return in `synopsisAnchors` and row 4 proposes again;
// drop the `takenSlots.has(best.index)` return and row 5 proposes onto the number row 4's title
// already holds, which the one-claim-per-number filter would then charge to whichever row kept it.
test('a synopsis never takes a row or a number a title already reached', () => {
  const keys = MUSHOKU_SYNOPSES.s1.ours.slice(0, 6)
  const sides = (prefix: string) => keys.map((key, index) => side(`${prefix}-${index + 1}`, index + 1, null, [], [key]))
  const reference = sides('anizip:t')
  const theirs = sides('nf:t')
  const alignment = alignByTitle(reference, theirs)
  const propose = (taken: Parameters<typeof synopsisAnchors>[0]['taken']) =>
    synopsisAnchors({ ordered: alignment.theirs, canonical: alignment.canonical, taken, anchors: [] })
      .proposed.map(anchor => [anchor.from.number, anchor.to.number])

  // THE CONTROL: with nothing taken all six rows propose, one onto its own number
  expect(propose([])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]])

  // their row 4 matched our number 4 exactly, so neither the row nor the number is on offer: row 4
  // is not scored at all, and row 5 may not be given number 4 either
  const held = {
    from: theirs[3]!, to: reference[3]!, fromIndex: 3, toIndex: 3, key: 'the shared marker title',
  }
  expect(propose([held])).toEqual([[1, 1], [2, 2], [3, 3], [5, 5], [6, 6]])
  // and the number is refused even when the row that holds it is elsewhere: an equality on their
  // row 6 taking our number 4 leaves our 4 unavailable and their 6 unscored
  const crossed = {
    from: theirs[5]!, to: reference[3]!, fromIndex: 5, toIndex: 3, key: 'the shared marker title',
  }
  expect(propose([crossed])).toEqual([[1, 1], [2, 2], [3, 3], [5, 5]])
})

// ---------------------------------------------------------------------------------------------

// A REAL RECORDED PAGE, the only case here that meets shapes nobody chose. It REPORTS its numbers
// rather than asserting a threshold on them, because a figure pinned to one walk fails on the next
// walk rather than on the next bug. What is asserted is what must hold whatever the page contains:
// the invariants, no `SAME_AS` from this plugin, and every pair inside its run's window.
test('the 800 recorded rows pair, refuse and hold the invariants', async () => {
  if (!existsSync(CORPUS)) {
    report(`no corpus at ${CORPUS}: run \`npm run corpus:walk\` to record one. This case did not run.`)
    return
  }
  const rows: AnswerRow[] = []
  for (const line of readFileSync(CORPUS, 'utf-8').split('\n')) {
    if (rows.length >= 800) break
    if (!line.trim()) continue
    rows.push(JSON.parse(line) as AnswerRow)
  }
  expect(rows.length, 'a recorded page is about 800 rows (2026-09-12)').toBeGreaterThan(100)

  // THE FIXTURES ARE ALREADY IN THIS GRAPH, so the totals below are the whole store and only the
  // DELTA is the page's. Reporting the total alone would credit the recorded page with 118 pairs the
  // cases above built by hand, which is the shape of a number that proves nothing
  const countOf = async (cypher: string) => Number((await rowsOf(cypher))[0]!.total)
  const PAIRS = "MATCH ()-[l:EPISODE_LINK]->() WHERE l.by = 'plugin:range' RETURN count(l) AS total"
  const ACTIVE_PAIRS =
    "MATCH ()-[l:EPISODE_LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'active' RETURN count(l) AS total"
  const REFUSED_PAIRS =
    "MATCH ()-[l:EPISODE_LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'refused' RETURN count(l) AS total"
  // what the pairs are FOR: the rows they place on a slot a member already fills (5.4 P5)
  const ALIGNED = "MATCH ()-[f:FILLS]->() WHERE f.via = 'aligned' RETURN count(f) AS total"
  const RANGES = "MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'active' RETURN count(l) AS total"
  const REFUSED = "MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'refused' RETURN count(l) AS total"
  const seeded = {
    pairs: await countOf(PAIRS), activePairs: await countOf(ACTIVE_PAIRS),
    refusedPairs: await countOf(REFUSED_PAIRS), alignedFills: await countOf(ALIGNED),
    ranges: await countOf(RANGES), refusals: await countOf(REFUSED),
  }

  const ingested = await replayAnswers(rows)
  expect(ingested.quarantined).toEqual([])

  const started = Date.now()
  const pass = await runPass()
  const passMs = Date.now() - started

  const { query } = await graphReady()
  expect((await checkInvariants(query)).counts).toEqual({
    'includes-inside': 0, 'part-of-inside': 0, 'cross-scope-link': 0, 'double-membership': 0,
  })

  const byRule = await rowsOf(
    `MATCH ()-[l:EPISODE_LINK]->() WHERE l.by = 'plugin:range'
     RETURN l.reason AS reason, l.status AS status, count(l) AS total ORDER BY reason, status`
  )
  const ranges = await rowsOf(
    `MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'active'
     RETURN l.kind AS kind, count(l) AS total ORDER BY kind`
  )
  const refusals = await rowsOf(
    `MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:range' AND l.status = 'refused'
     RETURN l.reason AS reason, count(l) AS total ORDER BY reason`
  )
  const [minted] = await rowsOf(
    "MATCH ()-[l:LINK]->() WHERE l.by = 'plugin:range' AND l.kind <> 'INCLUDES' RETURN count(l) AS total"
  )
  expect(Number(minted!.total), 'no media SAME_AS, on a page nobody chose either').toBe(0)

  // EVERY PAIR IS INSIDE ITS RUN'S WINDOW, which is the one property a recorded page can check that a
  // fixture cannot: it holds whatever the page contains, and a window applied to the wrong cluster
  // would show up here rather than in a case built to pass
  const outside = await rowsOf(
    `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode)<-[h:HAS_EPISODE]-(m:Media)-[:MEMBER_OF]->(c:Cluster)
     WHERE l.by = 'plugin:range' AND h.claimer = m.origin AND c.runLength IS NOT NULL
       AND (l.toNumber < 1 OR l.toNumber > c.runLength)
     RETURN a.uri AS fromUri, b.uri AS toUri, l.toNumber AS toNumber, c.runLength AS runLength`
  )
  expect(outside).toEqual([])

  report('plugin:range over 800 corpus rows: ' + JSON.stringify({
    pairsByRule: Object.fromEntries(byRule.map(row => [`${String(row.reason)} ${String(row.status)}`, Number(row.total)])),
    ranges: Object.fromEntries(ranges.map(row => [String(row.kind), Number(row.total)])),
    refusals: Object.fromEntries(refusals.map(row => [String(row.reason), Number(row.total)])),
    seeded,
    // which side proved which, since on a page with no `containing` answer yet (4.4) class 1 is
    // nearly empty and the transitional lend is what carries the pairs
    byOrigin: (await rowsOf(
      `MATCH (a:Episode)-[l:EPISODE_LINK]->(b:Episode) WHERE l.by = 'plugin:range'
       RETURN a.origin AS fromOrigin, b.origin AS toOrigin, count(l) AS total
       ORDER BY fromOrigin, toOrigin`
    )).map(row => `${row.fromOrigin} to ${row.toOrigin}: ${Number(row.total)}`),
    fromTheRecordedPage: {
      pairs: await countOf(PAIRS) - seeded.pairs,
      activePairs: await countOf(ACTIVE_PAIRS) - seeded.activePairs,
      refusedPairs: await countOf(REFUSED_PAIRS) - seeded.refusedPairs,
      alignedFills: await countOf(ALIGNED) - seeded.alignedFills,
      ranges: await countOf(RANGES) - seeded.ranges,
      refusals: await countOf(REFUSED) - seeded.refusals,
    },
    // what the plugin itself said it did, which is the only place a refused candidate with no `LINK`
    // to write on (a lend, a member) is counted at all
    // what the page GIVES the three classes, since a plugin that finds nothing and a page that
    // carries nothing look identical in a count of pairs
    material: {
      hasEpisode: await countOf('MATCH ()-[h:HAS_EPISODE]->() RETURN count(h) AS total'),
      // the lend measured WITHOUT the membership join, so a count of zero is a fact about what the
      // ingest wrote rather than about what the aggregate clustered
      lentAnywhere: await countOf(
        "MATCH (m:Media)-[h:HAS_EPISODE]->(:Episode) WHERE h.claimer <> m.origin RETURN count(h) AS total"
      ),
      lentOntoMembers: await countOf(
        `MATCH (c:Cluster)<-[:MEMBER_OF]-(m:Media)-[h:HAS_EPISODE]->(:Episode)
         WHERE c.scope = 'RUN' AND h.claimer <> m.origin RETURN count(h) AS total`
      ),
      episodeClaims: await countOf('MATCH ()-[c:EPISODE_CLAIMS]->() RETURN count(c) AS total'),
    },
    log: pass.logs.filter(event => event.rule === 'range').map(event => event.detail),
    iterations: pass.iterations,
    passMs,
    rangeMs: pass.runs.filter(run => run.id === 'plugin:range').map(run => run.ms),
  }, null, 2))

  const again = await runPass()
  expect(again.changes, 'the same page twice is the same view').toEqual([])
  report(`the second pass over the same graph: ${again.ms} ms, ${again.iterations} iteration(s), nothing written`)
}, 600_000)

// THE TWO SYNOPSIS GUARDS, ON INVENTED SHOWS.
//
// Both guards were calibrated on Mushoku Tensei's three Netflix seasons and, until 2026-09-13, every
// case that reddened when either was deleted was a Mushoku fixture. The 63-show harness that would
// have caught it lives outside `vitest.config.ts`'s include list AND fetches its corpus from Netflix
// live, so it cannot be a CI gate without making the gate depend on a third party and on which
// country the runner egresses from. This is the part that CAN run on every push: what the floor and
// the margin REFUSE, stated with no real show anywhere in it.
//
// The scores are measured here rather than written down, so the fixture cannot drift away from what
// `titleDice` actually returns and quietly stop exercising the branch it is named for.
test('the synopsis floor refuses a best match too weak to mean anything', () => {
  // TEN content words a side sharing exactly ONE, which is 2*1/(10+10) = 0.1. The keys have to be
  // this long: the comparison is over WORDS, so with five words a side a single shared word scores
  // exactly the floor and there is no room between zero and it to put a fixture in.
  const theirs = side('nf:1', null, null, [],
    ['lighthouse keeper repaints crimson lantern winter storms harbour beacon gantry'])
  // a WEAK overlap rather than none: at zero the branch never reaches the floor, it returns on
  // "no row matched at all", so a fixture scoring 0 would pass this test while testing nothing.
  // Both sides need five words of four characters or more, or `synopsisKeysOf` drops the row and the
  // whole read returns early without consulting either guard.
  const slot = side('anizip:1', 1, null, [], ['zebra quilt vault fjord copper anvil ledger marble thicket gantry'])
  const score = titleDice(theirs.synopsis[0]!, slot.synopsis[0]!)
  expect(score, 'the fixture has to sit BELOW the floor or it tests nothing').toBeLessThan(SYNOPSIS_ANCHOR_FLOOR)
  expect(score, 'and ABOVE zero, or the floor is not what refuses it').toBeGreaterThan(0)

  const ask = (floor?: number) => synopsisAnchors({
    ordered: [theirs], canonical: [{ number: 1, rows: [slot] }], taken: [], anchors: [], floor,
  }).proposed.length

  expect(ask(), 'at the shipped floor it proposes nothing').toBe(0)
  expect(ask(0), 'and with the floor lifted the same pair is proposed, so the floor is what stopped it').toBe(1)
})

// MUTATED: delete `if (best.score - second < margin) return` and the first expectation reads 1: the
// candidate anchors onto whichever of two equally good slots happened to be scanned first, which is a
// coin flip that puts a play button on the wrong episode.
test('the synopsis margin refuses a best match its runner up ties', () => {
  // one candidate against two slots carrying the SAME text: whatever it scores, it scores twice
  const shared = 'the courier crosses the frozen river at dawn'
  const theirs = side('nf:2', null, null, [], ['the courier crosses the frozen river at dusk'])
  const first = side('anizip:1', 1, null, [], [shared])
  const second = side('anizip:2', 2, null, [], [shared])
  const score = titleDice(theirs.synopsis[0]!, shared)
  expect(score, 'well clear of the floor, so ONLY the margin can refuse it').toBeGreaterThan(SYNOPSIS_ANCHOR_FLOOR)

  const ask = (margin?: number) => synopsisAnchors({
    ordered: [theirs],
    canonical: [{ number: 1, rows: [first] }, { number: 2, rows: [second] }],
    taken: [], anchors: [], margin,
  }).proposed.length

  expect(ask(), 'a tie is refused rather than guessed').toBe(0)
  expect(ask(0), 'and with the margin lifted it picks one, which is the guess the margin exists to prevent').toBe(1)
})
