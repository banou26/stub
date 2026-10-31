/**
 * `plugin:range`, P4 of 5.4: which rows of a longer packaging are THIS run's episodes, proven one
 * episode at a time.
 *
 * WHAT IT REPLACES, AND WHAT IT KEEPS. `alignmentOffset` (`consensus.ts:113-155`) read a single
 * OFFSET off the dates two sources share and shifted a whole list by it. The evidence survives here
 * verbatim (distinct numbers per UTC day, a day of slack for the Tokyo boundary, a day naming two
 * reference numbers disqualified, `MIN_ALIGNED` or nothing) and the conclusion does not: what is
 * written is one `EPISODE_LINK` per episode, so an inserted special costs one episode its link
 * rather than shifting every later one (3.4). The title-vote offset that put 13 of 25 Blue Exorcist
 * rows on the wrong Netflix episode (2026-09-10) has no successor: there is no offset anywhere.
 *
 * RULE 1 IS NOT THE LAST WORD ON THE ROWS IT COULD NOT DATE (2026-09-13). A verdict used to be the
 * whole of a candidate, so a row the days refused as ambiguous, or reached nothing at all, was lost
 * even where an exact title equality named it. One wrong upstream date costs two rows that way, and
 * ani.zip supplies exactly one on Mushoku Tensei cour 2: `closeDatesWithTitles` is what gives those
 * rows rule 3's anchor bar and the dates a veto over the answer.
 *
 * IT MINTS NO `SAME_AS` BETWEEN MEDIA. The "every episode paired, therefore the same thing" upgrade
 * was deleted from 5.4 P4, along with the rule that carried it, which is why the sequence rule below
 * is a NEW rule 3 and not the restored one: a season that holds this run is a container whatever
 * share of it pairs, and 8.4 is the case that says so, five Netflix seasons each `PART_OF` one run
 * with no upgrade at any coverage. The `PART_OF` that reached a candidate stays exactly as it was in
 * every branch below, including the one that mints a range.
 *
 * RULE 3 IS ALLOWED WHERE RULE 2 IS REFUSED, `retranslates` INCLUDED, and 3.4a gives the argument:
 * rule 2 is refused for a retranslating origin because it mints on a COVERAGE SCORE, and a score can
 * be wrong while looking strong (Netflix, 4 exact of 25, the best wrong pair outscoring the true one,
 * 2026-09-10). Rule 3 reads titles to ANCHOR and never to place: an anchor is exact, unique,
 * non-generic equality, or, only where those cannot bracket at all, a scored similarity that clears
 * `SCORED_ANCHOR_FLOOR` by `SCORED_ANCHOR_MARGIN` over its own runner-up (2026-09-13), or, on the
 * same terms, a SYNOPSIS similarity that clears `SYNOPSIS_ANCHOR_FLOOR` and then agrees with the
 * offset a majority of its fellows reached (`MIN_CONSENSUS_ANCHORS`, 2026-09-13). Every pair beyond
 * the anchors is placed by ORDER: no row is ever paired by comparing its own title or its own
 * synopsis to anything, and the gate mints nothing unless order placed a row inside the run.
 *
 * BE PRECISE ABOUT WHAT THAT DOES NOT SAY, because the first version of this header said the stronger
 * thing and an executed probe disproved it. A weld WRITES ITS OWN ANCHOR PAIR, exactly as an exact
 * match does, and where no exact anchor survives, the offset the bracket counts in came from scores
 * alone. So the distinction from the failure this file was written against is not "a score places
 * nothing": it is that the title-vote offset fitted ONE global offset out of title votes, a minority
 * of which could carry it, and placed every row by it, where here an offset no equality corroborates
 * needs `MIN_SCORED_ANCHORS` welds that agree on it, each weld has to clear the floor and the margin
 * and take a number nothing else reached, every bracket has to count the same number of rows on each
 * side, and `scheduleSkew` is asked about the answer.
 *
 * PAIRS ARE ONLY EVER ONTO AN EXISTING MEMBER EPISODE, inside `1..runLength`. That is what lets a
 * date pair skip the two-witness bar a count-based loan needed (`consensus.ts:171,234`): the loan was
 * placed BY NUMBER onto a row that might not exist, and a pair is placed by a shared day onto a row
 * the run's own sources already list. The bar still applies to the window, which is P5's.
 *
 * WHAT IT PROMISES. Same graph, same scope, same output: every scan is ordered, every candidate is
 * decided by a pure function of the two episode lists and the cluster's length, and the one place
 * two rows could be picked from (several reference rows carrying one number on one day) resolves on
 * the lowest uri rather than on arrival order.
 *
 * THE 2C HOOK. `delta` is not built, so `ctx.delta.full` is always true and every scan below reads
 * the whole graph rather than the run clusters in `delta.clusters`. The statements are the anchored
 * ones of 5.4 P4 with the `UNWIND $clusters` head removed, which is also what keeps an empty graph
 * from meeting the empty-`UNWIND` runtime death (2026-09-12).
 *
 * THREE SPELLING CHOICES the spec's own Cypher does not fix, each made for a stated reason:
 * - The class 1 scan is UNDIRECTED, because a `PART_OF` points from the shorter side to the longer
 *   and 8.4's five seasons therefore point INTO the run. The reason is beside the statement.
 * - The scans return FLAT ROWS and are grouped in JS, where 5.4 P4 collects a struct per candidate. A
 *   struct field is typed from the first row of a list and a JSON column inside one is unmeasured on
 *   0.20.4, and the failure mode of getting that wrong is a whole statement dying at runtime after
 *   the binder passed it (`00-engine-facts.md`, step 1b).
 * - The candidate scan's uncertain set carries `asserted` from a FOLDING origin beside the six
 *   reasons 5.4 P4 lists. A Crunchyroll season reached by a source claim rather than by an `ask`
 *   lands as `asserted` (`plugin:direct`'s table), and 8.1 is exactly that row until a source ships
 *   `containing` (4.4).
 *
 * THE FOURTH INPUT, `EPISODE_CLAIMS`, is the one rule here that weighs no evidence of its own: a
 * source said two episodes are the same, and all this plugin decides is whether the two rows are
 * anywhere near each other in the graph. Inside one RUN cluster, or across an active attachment, it
 * is an `asserted` pair; anywhere else it is written REFUSED `foreign-episode`, which is
 * `db.ts:410`'s union with the guards it never had ("accepts a uri that was never set"). It is the
 * only reader that table has. The refusal is a row rather than a silence because the claim edge is
 * already there to hang it off, which is the same test the lend and member classes fail below: a
 * plugin may not invent an edge to carry its own silence.
 */
import type { EpisodeLinkProposal, LinkProposal, Plugin, PluginContext, PluginOutput } from './contract'

import { EPISODE_TITLE_COVERAGE, isGenericEpisodeTitle, MIN_EPISODE_TITLE_MATCHES } from '../../../sources/similar'
import { stripTitle } from '../../../sources/utils'
import { RETRANSLATING_ORIGINS } from './origins'
import { synopsisKeyOf } from './profile'

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const RANGE_VERSION = 7

/**
 * Two pairs or nothing (`consensus.ts:111`).
 *
 * One shared date is a coincidence: a twelve episode run and a twenty-four episode season share a
 * weekday, and any two lists dated a week apart share their first day about one time in seven.
 */
export const MIN_ALIGNED = 2

/**
 * A day either side, because one broadcast is two dates (`consensus.ts:136-140`).
 *
 * ani.zip stamps `2021-01-10T15:00:00Z`, which is the 11th in Tokyo, and Crunchyroll publishes the
 * Tokyo date. Episodes are a week apart, so a day of slack cannot reach the neighbour, and the
 * ambiguity refusal still applies across the whole window.
 */
export const DAY_SLACK = 1

/**
 * Why nothing was minted for a candidate, written onto its refused `LINK` row so it is queryable.
 *
 * `no-anchors` and `unequal-gap` are rule 3's own two, and they say which half of the alignment
 * failed: no anchor to bracket from, both fallbacks included, so it names a candidate no title
 * reached exactly, none scored clear of its neighbours, and whose synopses met no offset majority
 * (Netflix's season 1, 24 placeholder titles, 3.4a point 4); or anchors whose bracket counted a
 * different number of rows on each side.
 *
 * `no-reference` is the only one that is not about the candidate at all: the RUN carries no numbered
 * episode to measure against, so no rule here was ever asked a question. It outranks every other
 * reason for that reason, and it exists because without it the refusal reads `retranslates`, which
 * names the candidate's origin for a silence the run owns (`referenceEpisodes`, 2026-09-13).
 */
export type RangeRefusal =
  'no-dates' | 'ambiguous-day' | 'retranslates' | 'no-titles' | 'date-skew' | 'no-anchors' | 'unequal-gap'
  | 'no-reference'

/** One episode of either side, as both rules read it. */
export type SideEpisode = {
  uri: string
  /** The origin that NUMBERED it, which is the episode's own and not the row it hangs off (4.4). */
  origin: string
  number: number | null
  /** The UTC day of its release date, or NULL when it carries none (5.4 P0, `consensus.ts:85-88`). */
  day: number | null
  /** `EpisodeProfile.titleKeys`, which are already stripped and already free of generic titles. */
  keys: string[]
  /**
   * `EpisodeProfile.synopsisKeys`: the episode's synopsis as a sorted bag of content words.
   *
   * Empty for every origin that ships no episode description, which is most of them, and empty for a
   * row whose synopsis carries too few content words to say anything (`MIN_SYNOPSIS_KEY_TOKENS`).
   * Rule 3's third anchor source reads it and nothing else does: no rule PLACES a pair by comparing
   * two synopses, exactly as no rule places one by comparing two titles.
   */
  synopsis: string[]
  /** The `HAS_EPISODE` key it hangs by, which every edge derived from it names in `supports`. */
  hung: string
}

/**
 * HOW one pair was placed, which is the whole of a trace's answer to "why is this button here" (3.2).
 *
 * One shape per way of placing a row, and rule 3 carries five of them because it places a row five
 * different ways. `day` and `slack` are rule 1's own, `gap` is its GAP CLOSURE (the exact anchor key
 * that placed a row no day could reach, `closeDatesWithTitles`), `key` is rule 2's exact title match,
 * `anchor` is rule 3's exact one (the key that anchored it), `scored` is rule 3's SCORED anchor
 * (their key, our key, and the token Dice between them, so a trace can tell a weld from an equality
 * at a glance), `synopsisScore` is rule 3's SYNOPSIS anchor, `between` names the two anchors whose
 * equal-gap bracket forced a row that no title reached, and `closed` names the specials whose
 * location closed the alignment (3.4a), which is empty for nothing, since a closure needs at least
 * one.
 *
 * THE SYNOPSIS SHAPE CARRIES NO KEYS, where the scored one carries two. A synopsis key is a whole
 * paragraph reduced to content words, so two of them per anchor would put a kilobyte of prose on
 * `evidence` for one season and duplicate a column that is already on the row: a trace that wants
 * the text reads `EpisodeProfile.synopsisKeys` by uri. What it cannot read anywhere else is the
 * score this anchor reached and the offset it had to agree with, so those are what the shape holds.
 */
export type PairEvidence =
  | { day: number, slack: number }
  | { gap: string }
  | { key: string }
  | { anchor: string }
  | { scored: string, onto: string, score: number }
  | { synopsisScore: number, consensus: number }
  | { between: [string, string] }
  | { closed: string[] }

/** One proven pair: their row, our row, and what proved it. */
export type Pair = {
  from: SideEpisode
  to: SideEpisode
  fromNumber: number
  toNumber: number
  evidence: PairEvidence
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const byUri = (a: SideEpisode, b: SideEpisode): number => compare(a.uri, b.uri)

/**
 * Rule 1 of 5.4 P4, by DATE: every candidate row a single reference number is reachable from.
 *
 * `runByDay` holds DISTINCT NUMBERS per day rather than rows per day, which is the whole of
 * `consensus.ts:118-127`: several sources describing one run all saying that this day is episode 1 is
 * the opposite of an ambiguity, and what disqualifies a day is the RUN using it for two different
 * episodes. The candidate's own day, then the day before, then the day after: the number is unique
 * across the three or the row is refused, and `ambiguous` counts the rows refused that way so the
 * verdict can say `ambiguous-day` rather than `no-dates`.
 *
 * The row a pair NAMES is the dated reference row that proved it, never merely a row carrying that
 * number: a Kitsu episode 1 with no date is the same broadcast, but it is not the evidence, and the
 * trace prints what was measured. Ties inside that (two reference rows on one day with one number)
 * go to the lowest uri, so the output does not depend on the scan's order.
 */
export const pairsByDay = (
  reference: readonly SideEpisode[],
  theirs: readonly SideEpisode[]
): { pairs: Pair[], ambiguous: number } => {
  const byDay = new Map<number, Map<number, SideEpisode>>()
  for (const episode of [...reference].sort(byUri)) {
    if (episode.day === null || episode.number === null) continue
    const numbers = byDay.get(episode.day) ?? new Map<number, SideEpisode>()
    if (!numbers.has(episode.number)) numbers.set(episode.number, episode)
    byDay.set(episode.day, numbers)
  }
  if (!byDay.size) return { pairs: [], ambiguous: 0 }

  const pairs: Pair[] = []
  let ambiguous = 0
  for (const episode of [...theirs].sort(byUri)) {
    if (episode.day === null || episode.number === null) continue
    // the exact day first, so a number reachable on two of the three days is taken from the one the
    // candidate itself published and the recorded slack is the smallest true one
    const reachable = new Map<number, SideEpisode>()
    for (const day of [episode.day, episode.day - DAY_SLACK, episode.day + DAY_SLACK]) {
      for (const [number, row] of byDay.get(day) ?? []) {
        if (!reachable.has(number)) reachable.set(number, row)
      }
    }
    if (!reachable.size) continue
    if (reachable.size > 1) {
      ambiguous += 1
      continue
    }
    const [target] = [...reachable.values()]
    pairs.push({
      from: episode,
      to: target!,
      fromNumber: episode.number,
      toNumber: target!.number!,
      evidence: { day: episode.day, slack: episode.day - target!.day! },
    })
  }
  return { pairs, ambiguous }
}

/**
 * Rule 1's guard: a constant offset the candidate's OWN numbering cannot absorb is a SCHEDULE SKEW.
 *
 * Crunchyroll publishes the streaming schedule and ani.zip the broadcast one, and the two can run a
 * few days apart. When they do, Crunchyroll's episode N+1 lands inside the day of slack around
 * ani.zip's episode N while Crunchyroll's own N lands nowhere near it, so rule 1 pairs the whole list
 * one late and `plugin:aggregate` then fills slot 1 from episode 2: the user opens episode 1 and
 * watches episode 2. Measured on `anilist:208044` in the summer 2026 corpus, eleven pairs
 * `fromNumber N+1 toNumber N`, both lists numbered 1 to 12 with identical titles at the same number.
 *
 * WHAT MAKES IT A SKEW RATHER THAN A RENUMBERING, which is the whole of this function:
 *
 * - every in-window pair shares ONE offset. A per-episode disagreement is real date evidence, and a
 *   specials-shifted list (8.3) is piecewise rather than constant, so neither is touched here.
 * - the candidate numbers from 1 and fits inside the run (`min === 1`, `max <= runLength`), so it is
 *   numbering THIS run from the top rather than a segment of a longer whole. The Elusive Samurai
 *   (8.2) is the case this clause keeps out: rows 13 to 20 against a run of 12 start nowhere near 1,
 *   and their offset of -12 is a genuine renumbering onto 1 to 8.
 * - the offset would carry one of the candidate's own rows OFF the run, so it cannot be read as that
 *   candidate's numbering of this run at all. 8.4 is the case this clause keeps out, and it is the
 *   reason the clause exists: Fullmetal's Crunchyroll season 2 numbers its rows 1 to 13 inside a run
 *   of 64 and its pairs carry a constant +13, which every clause above admits and which IS a
 *   renumbering, because 14 to 26 are rows of that run and nothing is pushed off either end.
 *
 * An offset of ZERO needs no clause of its own: a candidate that reaches the last two is numbered
 * inside the run, so it absorbs zero by construction and the dates are agreeing with the numbering.
 *
 * Returns the offset when the pairing is a skew, so a refusal can print what it saw, and `null` when
 * rule 1 stands.
 */
export const scheduleSkew = (options: {
  runLength: number
  episodes: readonly SideEpisode[]
  pairs: readonly Pair[]
}): number | null => {
  const { runLength, episodes, pairs } = options
  if (!pairs.length) return null
  const offset = pairs[0]!.toNumber - pairs[0]!.fromNumber
  if (pairs.some(pair => pair.toNumber - pair.fromNumber !== offset)) return null

  // no numbers at all makes `Math.min` Infinity, which the clause below refuses on its own
  const numbers = episodes.map(episode => episode.number).filter((number): number is number => number !== null)
  if (Math.min(...numbers) !== 1 || Math.max(...numbers) > runLength) return null
  return numbers.every(number => number + offset >= 1 && number + offset <= runLength) ? null : offset
}

/**
 * Rule 1's GAP CLOSURE: the rows a standing date alignment could not reach, each placed by an exact
 * anchor equality, by nothing else, and only where it sits in ORDER with every pair the days proved.
 *
 * WHY IT EXISTS, measured on `ag:(anilist:127720)` (Mushoku Tensei cour 2) on 2026-09-13. ani.zip
 * publishes episode 12 with EPISODE 1's air date (`airDate 2021-10-04` on both, confirmed against
 * `api.ani.zip/mappings?anidb_id=15954` that day), and it is the run's only dated origin: Kitsu ships
 * neither dates nor titles here. So one reference day names two episode numbers, and rule 1 loses two
 * rows to that one bad date, at opposite ends of the run:
 *
 * - Crunchyroll's row 12 is dated 2021-10-04 and reaches the doubled day, where `{1, 12}` is reachable
 *   and the row is refused as `ambiguous`;
 * - Crunchyroll's row 23 is dated 2021-12-20 and reaches NOTHING, because the reference row that
 *   carries number 12 is stamped in October.
 *
 * Ten of twelve paired, and the verdict is the whole of the candidate, so the two rows were never
 * offered to any rule below rule 1. The user saw no Crunchyroll button on the FIRST and LAST episode
 * of that season, on the graph store only, since the old store shifts a whole list by one offset and
 * therefore places them by position.
 *
 * WHAT IT IS NOT. It is not that old offset and it is not rule 2. Nothing here is placed by position,
 * by a count or by a coverage score: the only thing that places a row is an equality between two
 * titles that are exact, non-generic, and carried once on each side, which is rule 3's ANCHOR bar
 * (3.4a) rather than rule 2's minting bar. What the dates then do is VETO, and ONE test carries all
 * of it: a closing pair must be strictly MONOTONE against every pair the days proved.
 *
 * THAT ONE TEST SAYS THREE THINGS, because it counts a tie as a crossing. An equality restating a row
 * the days already paired shares that pair's `fromNumber`; an equality onto a reference row, or onto
 * a reference number, the days already filled shares its `toNumber`; and either makes the product
 * zero. So the days may not be restated, may not be overwritten and may not be crossed, on one line.
 * The membership sets an earlier draft carried for the first two were provably dead code: a candidate
 * deduplicates both sides by uri before it is built, so a restatement always ties on a number, and
 * neither set could be mutated red. A guard that cannot be reddened is a guard nothing is checking.
 *
 * Where the survivors cross EACH OTHER, none of them is taken, which is this file's rule everywhere:
 * nothing rather than a guess (`consensus.ts:105-110`).
 *
 * It runs only where rule 1 already stands, so it can add rows to an alignment and can never create
 * one: with fewer than `MIN_ALIGNED` date pairs there is nothing to be monotone against, and rules 2
 * and 3 decide the candidate exactly as they do today.
 */
export const closeDatesWithTitles = (options: {
  reference: readonly SideEpisode[]
  theirs: readonly SideEpisode[]
  /** The pairs rule 1 proved, which this closure may extend and may never contradict. */
  pairs: readonly Pair[]
}): Pair[] => {
  const { reference, theirs, pairs } = options
  if (!pairs.length) return []

  const ours = uniqueKeys(reference, anchorKeysOf)
  const mine = uniqueKeys(theirs, anchorKeysOf)

  const proposed: Pair[] = []
  for (const episode of [...theirs].sort(byUri)) {
    if (episode.number === null) continue
    const matched = new Map<string, { target: SideEpisode, key: string }>()
    for (const key of anchorKeysOf(episode)) {
      // a key their own side carries twice says nothing about which of their rows is meant
      if (mine.get(key) !== episode) continue
      const target = ours.get(key)
      if (!target || target.number === null) continue
      if (!matched.has(target.uri)) matched.set(target.uri, { target, key })
    }
    // two different reference rows reached through two keys is an ambiguity, not two matches
    if (matched.size !== 1) continue
    const [match] = [...matched.values()]
    const target = match!.target
    proposed.push({
      from: episode,
      to: target,
      fromNumber: episode.number,
      toNumber: target.number!,
      evidence: { gap: match!.key },
    })
  }

  // ZERO COUNTS AS A CROSSING, and that is the whole veto: the product is zero exactly when the two
  // pairs agree on one side, which is a restatement, an overwrite, or two rows carrying one number
  const crosses = (a: Pair, b: Pair): boolean =>
    (a.fromNumber - b.fromNumber) * (a.toNumber - b.toNumber) <= 0
  const kept = proposed.filter(pair => pairs.every(dated => !crosses(pair, dated)))
  const tangled = kept.some((pair, index) =>
    kept.some((other, otherIndex) => otherIndex > index && crosses(pair, other)))
  return tangled ? [] : kept
}

/** A key present more than once on a side carries no identity there, so it is dropped rather than guessed. */
const uniqueKeys = (
  episodes: readonly SideEpisode[],
  keysFor: (episode: SideEpisode) => string[] = keysOf
): Map<string, SideEpisode | null> => {
  const index = new Map<string, SideEpisode | null>()
  for (const episode of [...episodes].sort(byUri)) {
    for (const key of keysFor(episode)) {
      if (index.has(key)) index.set(key, null)
      else index.set(key, episode)
    }
  }
  return index
}

/**
 * The keys of one row, through `stripTitle` again.
 *
 * `EpisodeProfile.titleKeys` is already stripped and already free of generic titles (5.4 P0), so this
 * is idempotent today. It is applied anyway because the equality below IS the strip: reading it off
 * the column would make rule 2 depend on the profile having normalised the same way, which is the
 * kind of agreement that holds until one of the two changes.
 */
const keysOf = (episode: SideEpisode): string[] =>
  [...new Set(episode.keys.map(stripTitle).filter(Boolean))].sort(compare)

/**
 * Rule 2 of 5.4 P4, by TITLE: exact key equality, both sides non-generic, nothing ambiguous.
 *
 * The bar to mint anything is `MIN_EPISODE_TITLE_MATCHES = 3` and coverage `>= 0.6` of the
 * CANDIDATE's non-generic titles (`similar.ts:59-69`), so a fold of two equal cours scores 12/24 and
 * mints nothing while a season with a four episode bonus block scores 12/16 and is admitted. Only the
 * date rule can prove a fold, which is the point of measuring coverage against the candidate.
 *
 * `coverage` is reported whatever the verdict, so a refusal can say which half of the bar it missed.
 */
export const pairsByTitle = (
  reference: readonly SideEpisode[],
  theirs: readonly SideEpisode[]
): { pairs: Pair[], titled: number, coverage: number } => {
  const ours = uniqueKeys(reference)
  const mine = uniqueKeys(theirs)
  const titled = theirs.filter(episode => keysOf(episode).length).length

  const pairs: Pair[] = []
  for (const episode of [...theirs].sort(byUri)) {
    if (episode.number === null) continue
    const matched = new Map<string, { target: SideEpisode, key: string }>()
    for (const key of keysOf(episode)) {
      // a key this side carries twice says nothing about which of its own rows is meant
      if (mine.get(key) !== episode) continue
      const target = ours.get(key)
      if (!target || target.number === null) continue
      if (!matched.has(target.uri)) matched.set(target.uri, { target, key })
    }
    // two different reference rows reached through two keys is an ambiguity, not two matches
    if (matched.size !== 1) continue
    const [match] = [...matched.values()]
    pairs.push({
      from: episode,
      to: match!.target,
      fromNumber: episode.number,
      toNumber: match!.target.number!,
      evidence: { key: match!.key },
    })
  }
  return { pairs, titled, coverage: titled ? pairs.length / titled : 0 }
}

// ---------------------------------------------------------------------------------------------
// Rule 3 of 5.4 P4, by SEQUENCE, and its closure (3.4a). Three pure steps: the anchors, the rows an
// equal-gap bracket forces between two of them, and the specials that close what is left.

/**
 * The keys rule 3 may anchor on: one row's, non-generic, stripped, deduplicated and ordered.
 *
 * The generic filter is applied HERE and not read off `EpisodeProfile.generic`, for `keysOf`'s own
 * reason: 3.4a's anchor is defined as non-generic, so the rule that needs the property is the rule
 * that has to check it. It is idempotent against today's column, which already drops them
 * (`profile.ts`, `similar.ts:104`), and without it Netflix's season 1 of 24 rows titled `Episode N`
 * would anchor all 24 of them onto ours.
 */
const anchorKeysOf = (episode: SideEpisode): string[] =>
  keysOf(episode).filter(key => !isGenericEpisodeTitle(key))

/** One episode of the run as rule 3 counts it: a number, and every reference row that carries it. */
export type CanonicalEpisode = {
  number: number
  /**
   * Every reference row at this number, lowest uri first. Several origins describe one broadcast, so
   * the same title on anizip's row 5 and kitsu's row 5 is ONE episode rather than a duplicated key,
   * which is the difference between rule 3's index and rule 2's (`uniqueKeys` would drop both).
   */
  rows: SideEpisode[]
}

/** One ANCHOR: their row and our number, joined by a key that is exact, or scored above a floor. */
export type Anchor = {
  from: SideEpisode
  /** The reference row whose title carried the key, which is the row the pair NAMES. */
  to: SideEpisode
  /** Position in the alignment's own two lists. Order, and nothing else, places every other pair. */
  fromIndex: number
  toIndex: number
  /** Their key. On an exact anchor it is ours as well, which is what `scored` being absent says. */
  key: string
  /** Present only on a SCORED anchor: OUR key it beat the field with, and the token Dice it reached. */
  scored?: { onto: string, score: number }
  /**
   * Present only on a SYNOPSIS anchor: the token Dice it reached, and the consensus offset it agrees
   * with. Both are set at once, because a synopsis anchor that disagrees with the consensus is not
   * an anchor at all and never reaches this type.
   */
  synopsis?: { score: number, consensus: number }
}

/** The two ordered lists rule 3 reads, the anchors it found in them, and the run's specials. */
export type Alignment = {
  /** Their NUMBERED rows, ascending: an unnumbered row of theirs is in no sequence at all. */
  theirs: SideEpisode[]
  /** The run's own numbering, ascending, one entry per distinct number. */
  canonical: CanonicalEpisode[]
  /** The run's rows with NO number: 3.4a's insertions, and never a pair of their own. */
  specials: SideEpisode[]
  anchors: Anchor[]
  /** Exact unique matches before the monotone filter, so a crossing one is countable rather than silent. */
  matches: number
  /**
   * How many of `anchors` were SCORED rather than exact, which is 0 on every alignment the exact
   * anchors could bracket by themselves. It rides the `INCLUDES` evidence: a range proven off welded
   * anchors is a different claim from one proven off equalities, and a query has to be able to ask.
   */
  scored: number
  /** How many of `anchors` came from a SYNOPSIS, for `scored`'s reason: it is a weaker claim again. */
  synopsis: number
  /** The offset the synopsis anchors agreed on, or NULL where none was asked for or none was found. */
  consensus: number | null
}

const pairOnto = (from: SideEpisode, slot: CanonicalEpisode, evidence: PairEvidence): Pair => ({
  from,
  to: slot.rows[0]!,
  fromNumber: from.number!,
  toNumber: slot.number,
  evidence,
})

/**
 * The longest strictly increasing run of matches, which is the monotone alignment of rule 3.
 *
 * Patience by binary search over the matches in THEIR order, reconstructed through parent pointers,
 * so a crossing match is dropped rather than allowed to bend the alignment around it: two matches
 * that cross leave a run of one, which is below the two-anchor minimum and mints nothing.
 */
const longestMonotone = (matches: readonly Anchor[]): Anchor[] => {
  const tails: number[] = []
  const parent: number[] = []
  matches.forEach((match, index) => {
    let low = 0
    let high = tails.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (matches[tails[mid]!]!.toIndex < match.toIndex) low = mid + 1
      else high = mid
    }
    parent[index] = low > 0 ? tails[low - 1]! : -1
    tails[low] = index
  })
  const anchors: Anchor[] = []
  for (let index = tails.length ? tails[tails.length - 1]! : -1; index >= 0; index = parent[index]!) {
    anchors.push(matches[index]!)
  }
  return anchors.reverse()
}

/**
 * TOKEN DICE over two `stripTitle` keys: twice the tokens they share, over the two token counts.
 *
 * WHY THIS SCORER AND NOT THE REPO'S OWN. Two were measured against the episode-pair labels of
 * `tests/corpus/cases` on 2026-09-13, over 190 oriented list pairs and 1624 exact anchors, 91 cells
 * each. Dice CONTRADICTED a label at none of its 91 cells, margin 0 included; `titleSimilarity`
 * (frizbee) contradicted 5, every one of them a single-token romaji key against an English one
 * (`kaisan` onto `sea` at 0.293, `unmei` onto `might be fun` at 0.200), which is the shape an
 * episode title takes far more often than a show title does. Dice scores all five of those pairs 0.
 * `bestTitleScore` was ruled out outright: over 400 distinct Netflix episode titles its
 * `franchiseTitle` pass rewrites 36 and COLLAPSES 19 onto another title of the same show
 * (`The Nijimura Brothers, Part 1` == `Part 2` == `Part 3`), deleting the only thing separating two
 * episodes.
 *
 * It is also the only one of the three that keeps this file's promise above: pure, synchronous, a
 * function of the two lists alone. frizbee is an async wasm init.
 */
export const titleDice = (a: string, b: string): number => {
  const left = new Set(a.split(' ').filter(Boolean))
  const right = new Set(b.split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return (2 * shared) / (left.size + right.size)
}

/**
 * The token Dice a key pair must REACH to propose a scored anchor: 0.6, calibrated 2026-09-13.
 *
 * WHAT IT RESTS ON. A live sweep over retranslating sources (Netflix unOGS titles against ani.zip
 * canonical): 65 seasons across 33 shows, 1109 truth row pairs derived without any scorer, 68
 * same-show hard negatives, 790 pairings, 98 cells. Plus the corpus sweep above, 190 list pairs over
 * 59 labelled cases. Both are reproduced by
 * `scripts/calibrate-episode-anchors.test.ts` and `scripts/calibrate-anchor-corpus.test.ts`; every
 * figure below was re-read off a run whose TRUTH is derived by an exact-only matcher inside the
 * harness rather than through this function, which is the only way these numbers mean anything now
 * that `alignByTitle` welds (the first version of this comment quoted a run that had read its own
 * output as ground truth, and four of its headline figures moved when that was fixed).
 *
 * THE CURVE EITHER SIDE, from the live sweep. Below, the cliff is on the NEGATIVES and not on the
 * truth set: floor 0.55 or lower with margin 0.05 or lower lets up to 3 wrong pairings speak and
 * mints up to 28 wrong pairs (Sword Art Online season 3 welded onto the season 1 run, 2 anchors and
 * 2 rows placed, at 0.50/0.05), while floor 0.60 or more is 0 wrong at every margin tried. Above, the
 * cliff is recall: novel anchor recall 60.6% at 0.60, 56.7% at 0.70, 50.6% at 0.80, 27.7% at 0.90,
 * 2.2% at 0.95. Truth-set precision is 100% from floor 0.40 up at every margin, so precision alone
 * would have picked a much lower floor and the negatives are what forbid it.
 *
 * AND IT IS NOW MEASURED ON THIS SCORER, which it was not when the constant was chosen. The grid
 * above ran on frizbee `titleSimilarity` and 0.60 was carried across by a hazard-curve coincidence,
 * which was an inference. The same 98 cells were then swept on token Dice over the same truth set
 * and the same 68 negatives: Dice is the SAFER of the two by a wide margin, with 0 wrong anchors and
 * 0 negatives speaking at every cell whose margin is 0.05 or more, the only damage anywhere being
 * margin 0 at floors 0.35 and 0.40 (one wrong pairing, 6 wrong pairs: Food Wars season 3 welded onto
 * the Second Plate run). At the shipped cell: 1000 anchors proposed, 0 wrong, novel anchor recall
 * 57.1% of the 231 truth pairs no exact anchor reaches, 0 of 68 negatives speaking. So 0.60/0.15
 * sits well inside Dice's clean region rather than on its edge, and the margin below is the guard
 * that carries the low-floor cells rather than the floor.
 *
 * The hazard table that licensed the transfer is still worth keeping, because it is the only thing
 * measured on BOTH scorers: the share of the recorded page's 2416 titled episode rows whose own
 * NEIGHBOUR clears the floor is Dice 18.5% at 0.50, 10.6% at 0.60 and 4.8% at 0.70, against
 * frizbee's 16.6%, 10.0% and 4.9%. It is also why a floor near the owner's hand-measured 0.34 was
 * refused: 21.8% of rows have a neighbour that clears it, and 42% of the Netflix ones do, Netflix
 * being the most internally confusable source on the page by a factor of two.
 */
export const SCORED_ANCHOR_FLOOR = 0.6

/**
 * How far a scored anchor must BEAT its own runner-up: 0.15, calibrated 2026-09-13.
 *
 * THE MARGIN REFUSES AMBIGUITY RATHER THAN RESOLVING IT. A row whose best two candidate numbers sit
 * within 0.15 of each other is no anchor at all, and order then places it if a bracket reaches it, so
 * an ambiguity costs a pair nothing. Mushoku Tensei's Netflix season 3 is the case that fixes the
 * figure: `Rage, Mad Dog` scores 0.667 against our `Howl, Mad Dog` and 0.571 against our
 * `Burn Bright, Mad Dog`, a gap of 0.095, and without a margin the tie-break took the wrong
 * neighbour. 0.05 would not have caught it.
 *
 * WHY A SECOND GUARD AT ALL, when floor 0.60 already shows 0 wrong on both axes: a wrong weld is
 * permanent, since union-find has no unlink, and the two guards fail independently. On the live
 * sweep margin 0.15 or more is 0 wrong pairings at EVERY floor, including the ones the floor alone
 * cannot save (0.50/0.05 welds SAO season 3 onto the season 1 run; 0.50/0.15 does not). 0.15 and not
 * 0.10: margin 0.10 still lets one wrong pairing speak and mints 7 wrong pairs at floors 0.30, 0.35
 * and 0.40. This comment said 0.10 until 2026-09-13, which the corrected run disproved.
 *
 * WHAT IT COSTS, measured on the corpus axis: at margin 0.15 a scored rule loses 23 of 1600 exact
 * agreements, because the margin refuses a row whose true slot is an exact match with a near-tied
 * neighbour (`The Knight's Festival of the Hunt (Part 1)` against `(Part 2)`, Dice 0.857, gap
 * 0.143). NONE of that cost is paid here: exact equality never consults the floor or the margin, so
 * the loss the corpus sweep measured is a property of the replacement it swept and not of this
 * fallback.
 */
export const SCORED_ANCHOR_MARGIN = 0.15

/**
 * How many anchors an alignment that NO exact equality holds down needs before it may mint: 3.
 *
 * WHAT THIS GUARD IS FOR, and it is the one the first version of this change did not have. A row
 * strictly between two anchors is placed by ORDER, which reads no title at all, but the OFFSET that
 * order works in comes from the anchors. Where every anchor is a weld, that offset came from scores
 * alone, and two votes for one offset is not a measurement: with zero exact anchors, two welds at
 * one offset and an equal gap between them, the rule minted four `EPISODE_LINK` rows off two
 * similarities (executed 2026-09-13, `The Black Swordsman Returns` onto `The Black Swordsman` at
 * 0.857 and `The Red Nosed Reindeer Again` onto `The Red Nosed Reindeer` at 0.889, on a season that
 * belongs to another run). That is the shape this file was written against, refitted from two votes
 * instead of one global one.
 *
 * WHY THREE, AND WHY IT IS FREE HERE. Three is rule 2's own bar for a title claim
 * (`MIN_EPISODE_TITLE_MATCHES`, `similar.ts:59`) and the bar the calibration's conservative closure
 * demanded before it would trust an offset at all. It costs nothing measurable: on the live corpus
 * (63 shows, 189 Netflix seasons, 790 pairings, 2026-09-13) the fallback unlocks five pairings the
 * exact rule cannot bracket, and all five stand under this bar, four of them on welds alone with 20,
 * 9, 8 and 6 anchors agreeing on one offset.
 *
 * ONE EXACT ANCHOR IS ENOUGH TO DROP BACK TO `MIN_ALIGNED`, which is why this reads
 * `anchors.length > scored` rather than a flat three. An equality corroborates the offset the welds
 * agree on, and the fifth unlocked pairing is exactly that shape (Blue Exorcist season 3 onto the
 * Shimane Illuminati Saga: one exact anchor, one weld, one row forced between them).
 */
export const MIN_SCORED_ANCHORS = 3

/**
 * The token Dice a SYNOPSIS pair must REACH to propose an anchor: 0.20, calibrated 2026-09-13.
 *
 * A TENTH OF THE TITLE FLOOR, and that is not a relaxation of the same test: it is a different test.
 * Two spellings of one episode title share most of their words, so 0.60 there is a near-equality.
 * Two independently written paragraphs about one episode share the names and the events and nothing
 * else, so the true pairs land between 0.20 and 0.50 and a floor anywhere near 0.60 accepts none of
 * them. Measured over Mushoku Tensei's three Netflix seasons against TMDB's episode overviews
 * (2026-09-13): the 24 true pairs this floor accepts score 0.200 to 0.500, median 0.276.
 *
 * THE FLOOR AND THE MARGIN ARE NOT THE GATE HERE, which is the whole difference from
 * `SCORED_ANCHOR_FLOOR` and the reason `offsetConsensus` below exists. At 0.20 with a margin of 0.05
 * the three seasons propose 10, 9 and 9 anchors of which 1, 2 and 1 are WRONG, so a rule that minted
 * on the two of them would put a play button on the wrong episode about one time in seven. The
 * consensus is what takes that to zero.
 *
 * AND IT SURVIVED A REAL CORPUS, which the first version of this constant did not have: three
 * seasons of one show scored against TMDB was all of it, and both calibration harnesses were running
 * the rule on an empty synopsis column, so their hard negatives could not speak to it. Swept
 * 2026-09-13 over 63 shows, 189 Netflix seasons, 65 closed pairings and 1037 true pairs, Netflix's
 * own `contextualSynopsis` against ani.zip's `overview` (`scripts/calibrate-episode-anchors.test.ts`,
 * the STANDALONE arm, which asks this source to align the two lists by itself):
 *
 * | floor | kept at m0.05 | precision | recall | wrong BEFORE the gate at m0 | negatives fired |
 * | --- | --- | --- | --- | --- | --- |
 * | 0.10 | 491 | 100.0% | 47.3% | 356 | 1 of 68 same-show, at m0 and m0.02 |
 * | 0.15 | 485 | 100.0% | 46.8% | 235 | 0 |
 * | 0.20 | 466 | 100.0% | 44.9% | 116 | 0 |
 * | 0.30 | 368 | 100.0% | 35.5% | 14 | 0 |
 * | 0.45 | 304 | 100.0% | 29.3% | 0 | 0 |
 *
 * PRECISION IS 100% AT EVERY ONE OF THE 48 CELLS, which is a statement about the CONSENSUS and not
 * about the floor: the wrong column above is what the score proposes, and `offsetConsensus` with
 * `MIN_CONSENSUS_GAP` removes all of it everywhere, including the 356 wrong proposals at the loosest
 * cell. So the floor is not what keeps a wrong anchor out, and this constant should not be read as
 * if it were.
 *
 * WHAT THE FLOOR IS FOR, then, and why 0.20 rather than 0.15. Across all 48 cells, each run against
 * 68 same-show and 195 cross-show negatives, exactly ONE negative fires anywhere: floor 0.10 at
 * margin 0 and 0.02, which mints 9 wrong pairs. 0.15 is already clean and 0.20 is two floors clear
 * of the only shape that has ever fired, for 1.9 points of recall. That distance is the whole
 * argument, and it is worth saying that the corpus cannot distinguish 0.15 from 0.20 on anything
 * else: both are 100% precise and neither lets a negative speak.
 *
 * WHAT THIS DOES NOT SAY, because the harness's own bias is stated rather than averaged away: truth
 * there is closed from EXACT TITLE anchors, so a season Netflix titles `Episode N` can never enter
 * it however well a synopsis would do, and the precision above is measured on seasons where the
 * titles happen to agree. The synopsis scores were never consulted in building that truth, which is
 * what makes the precision informative; the population it is measured over is not the population
 * this source exists for, and the Mushoku Tensei seasons remain the case for that.
 */
export const SYNOPSIS_ANCHOR_FLOOR = 0.20

/**
 * How far a synopsis pair must BEAT its own runner-up: 0.05, calibrated 2026-09-13.
 *
 * Same job as `SCORED_ANCHOR_MARGIN` and a much smaller figure, because the scores themselves are
 * much smaller: at a median true score of 0.276 a margin of 0.15 would refuse nearly every true pair
 * the floor admits. It still does real work at this size. Season 1's `11 onto 13` is the case, and
 * it is the wrong pairing that this file's consensus was written against: Netflix's episode 11
 * synopsis scores 0.188 against TMDB's episode 13 and 0.188 against TMDB's episode 19, a gap of
 * exactly zero, so the margin refuses it outright and the floor would have refused it anyway.
 *
 * THE CORPUS SWEEP IS WHAT MAKES IT MORE THAN A STORY ABOUT ONE ROW, and it moves the evidence one
 * cell away from where it ships. At floor 0.20 the margin changes nothing that can be measured: 495
 * anchors kept at m0 against 466 at m0.05, 0 wrong either way, so it costs 2.8 points of recall for
 * no visible gain there. Its work is at floor 0.10, where the ONE negative that fires anywhere in
 * the 48-cell grid fires at m0 and at m0.02 and is REFUSED at m0.05, taking 9 wrong minted pairs
 * with it. It also halves what the score proposes wrongly for the vote to clean up, 116 down to 46
 * at the shipped floor. Keeping it is buying the same two floors of distance the floor itself buys
 * (2026-09-13, 63 shows, 189 Netflix seasons, 1037 true pairs).
 */
export const SYNOPSIS_ANCHOR_MARGIN = 0.05

/**
 * How many synopsis anchors must AGREE ON ONE OFFSET before any of them may anchor anything: 3.
 *
 * WHY CONSENSUS IS THE GATE, and why neither the floor nor the margin can be. Scored over Mushoku
 * Tensei's three Netflix seasons against TMDB's episode overviews (2026-09-13), accepting at
 * `SYNOPSIS_ANCHOR_FLOOR` with `SYNOPSIS_ANCHOR_MARGIN`, then keeping only the anchors that agree
 * with the majority offset:
 *
 * | season | proposed | offsets seen | consensus | truth | wrong before | kept | wrong after |
 * | --- | --- | --- | --- | --- | --- | --- | --- |
 * | 1 | 10 | `{0: 9, -6: 1}` | 0 | 0 | 1 | 9 | 0 |
 * | 2 | 9 | `{-1: 7, -7: 1, -2: 1}` | -1 | -1 | 2 | 7 | 0 |
 * | 3 | 9 | `{0: 8, +5: 1}` | 0 | 0 | 1 | 8 | 0 |
 *
 * What that is worth downstream, through the whole of rule 3 and against a run of the reference's
 * own length: 20, 23 and 10 pairs, where the exact and the scored anchor alone reach none of them
 * (Netflix titles these seasons `Episode N` or retranslates them, which is why this source exists).
 *
 * ON THOSE THREE SEASONS the outliers are a minority of one and never agree with each other, and the
 * property that would make that a rule is a real one: a synopsis that reads like the wrong episode
 * reads like a DIFFERENT wrong episode each time, where the true pairs all shift by the same amount
 * because they are the same sequence. IT IS NOT AN INVARIANT, and this file claimed it was until
 * 2026-09-13. Four outliers that do agree beat three true anchors under a bare majority, which is
 * executed rather than imagined; the answer is `MIN_CONSENSUS_GAP`, and the corpus that made the
 * question answerable is the one that constant carries.
 *
 * A MONOTONE FILTER IS NOT A SUBSTITUTE, and this is the trap. `longestMonotone` keeps the longest
 * increasing chain, so it drops an outlier that CROSSES the true ones and keeps one that happens to
 * interleave with them. Season 1's `11 onto 13` is exactly that: 13 sits between the true anchors
 * `10 onto 10` and `14 onto 14`, so it extends the chain rather than conflicting with it and every
 * longest chain contains it. It reads as a real pair because Netflix's episode 11 synopsis opens on
 * `Roxy arrives ... a notice from Paul`, which is TMDB's episode 13, and closes on a monster, which
 * is TMDB's episode 11. Only the offset test sees it: +2 where nine others say 0.
 *
 * SAY WHAT THE THREE SEASONS DO AND DO NOT PROVE, because the paragraph above is the argument and
 * not the measurement. That `11 onto 13` was recorded on 2026-09-13 at a COARSER content-word cut
 * than this file ships; at `MIN_SYNOPSIS_TOKEN` it scores 0.188 against episode 13 and 0.188 against
 * episode 19, so the floor and the margin refuse it here and it never reaches a filter. Of the four
 * wrong anchors the three seasons do propose, every one CROSSES the true chain, so a monotone filter
 * would have reached the same anchor set consensus reaches. What consensus demonstrably buys on
 * measured data is the ORDER note in `synopsisAnchors`: it removes a wrong anchor before the
 * one-row-per-number filter can charge a true anchor for it, which is worth 3 of 24 anchors across
 * the three seasons. The reason it is the gate rather than a second monotone pass is the shape
 * above, which a monotone pass cannot see by construction.
 *
 * WHY THREE. Two votes for one offset is not a measurement, which is `MIN_SCORED_ANCHORS`' own
 * argument one screen up, and three is rule 2's bar for a title claim (`MIN_EPISODE_TITLE_MATCHES`,
 * `similar.ts:59`). It costs nothing measured: the smallest majority in the table above is 7, so
 * every season this rule has been measured on clears three by a factor of two, and what three
 * refuses is a season carrying less evidence than any of them.
 */
export const MIN_CONSENSUS_ANCHORS = 3

/**
 * The anchor minimum THIS alignment has to clear: `MIN_ALIGNED`, or `MIN_SCORED_ANCHORS` where no
 * anchor is an exact equality. The comparison is "at least one exact anchor survives", and a
 * synopsis anchor counts as inexact for the same reason a weld does: the offset the brackets then
 * count in came from a score rather than from an equality.
 */
const minAnchorsFor = (alignment: Alignment): number =>
  alignment.anchors.length > alignment.scored + alignment.synopsis ? MIN_ALIGNED : MIN_SCORED_ANCHORS

/**
 * The best token Dice between any key of their row and any key of one canonical episode.
 *
 * It returns the winning reference ROW as well as the two keys, because `Anchor.to` is documented as
 * the row whose title carried the key and that is the row the pair NAMES: several origins describe
 * one number, and the key that won can belong to any of them.
 */
const bestAgainst = (
  keys: readonly string[],
  slot: readonly { row: SideEpisode, keys: readonly string[] }[]
): { score: number, key: string, onto: string, row: SideEpisode | null } => {
  let best: { score: number, key: string, onto: string, row: SideEpisode | null } =
    { score: 0, key: '', onto: '', row: null }
  for (const key of keys) {
    for (const our of slot) {
      for (const onto of our.keys) {
        const score = titleDice(key, onto)
        // strictly greater, over lists that are already sorted, so a tie keeps the lowest key pair
        // and the evidence does not depend on the scan's order
        if (score > best.score) best = { score, key, onto, row: our.row }
      }
    }
  }
  return best
}

/**
 * Whether a proposed match sits on ONE side of every exact anchor in both of its indices.
 *
 * This is what makes "an exact match is an anchor at any margin" structural rather than hoped for. A
 * proposal that crosses an exact anchor could be picked over it by the monotone filter, which would
 * REMOVE an anchor the shipped rule holds; filtered here, every longest increasing chain of the union
 * contains every exact anchor, because any chain missing one can be extended by it.
 */
const clearsAnchors = (match: Anchor, anchors: readonly Anchor[]): boolean =>
  anchors.every(anchor =>
    (match.fromIndex < anchor.fromIndex && match.toIndex < anchor.toIndex)
    || (match.fromIndex > anchor.fromIndex && match.toIndex > anchor.toIndex))

/**
 * Rule 3's SCORED anchors, which is the one place a similarity is consulted (3.4a).
 *
 * Every one of their unanchored rows is scored against EVERY canonical number, and it proposes an
 * anchor only when all five of these hold. Each refusal is an identity question a score cannot
 * answer, and the first two are the calibrated pair:
 *
 * - the best score clears `SCORED_ANCHOR_FLOOR`;
 * - it beats the runner-up by `SCORED_ANCHOR_MARGIN`. The runner-up is taken over ALL numbers,
 *   sub-floor ones included, because ambiguity is about separation and not about how many candidates
 *   happened to clear a bar;
 * - the best number is not one an EXACT match already reached. A row whose own best is a taken
 *   number is refused outright rather than moved down to its runner-up, which is the displacement
 *   the corpus sweep measured: a looser test reaching a slot a correct anchor owns kills BOTH under
 *   the one-claim-per-number rule below, so 15 exact agreements were lost at margin 0 with no wrong
 *   placement anywhere near it;
 * - the number is reached by ONE of their rows, exactly as an exact match must be;
 * - it crosses no exact anchor (`clearsAnchors`).
 */
const scoredAnchors = (options: {
  ordered: readonly SideEpisode[]
  canonical: readonly CanonicalEpisode[]
  matches: readonly Anchor[]
  anchors: readonly Anchor[]
}): Anchor[] => {
  const { ordered, canonical, matches, anchors } = options
  const takenRows = new Set(matches.map(match => match.from.uri))
  const takenSlots = new Set(matches.map(match => match.toIndex))
  // one key list per canonical row, built once: inside the loops below it would be re-stripped
  // `their rows x their keys` times, which measured 109 ms on a 220 number run described by three
  // origins against 100 rows
  const slots = canonical.map(slot => slot.rows.map(row => ({ row, keys: anchorKeysOf(row) })))

  const proposed: Anchor[] = []
  ordered.forEach((row, fromIndex) => {
    if (takenRows.has(row.uri)) return
    const keys = anchorKeysOf(row)
    let best = { index: -1, score: 0, key: '', onto: '', row: null as SideEpisode | null }
    let second = 0
    slots.forEach((slot, index) => {
      const found = bestAgainst(keys, slot)
      if (found.score > best.score) {
        second = best.score
        best = { index, score: found.score, key: found.key, onto: found.onto, row: found.row }
      } else if (found.score > second) second = found.score
    })
    // `best.row` is set by any score above zero, and the floor is above zero
    if (best.score < SCORED_ANCHOR_FLOOR || !best.row) return
    if (best.score - second < SCORED_ANCHOR_MARGIN) return
    if (takenSlots.has(best.index)) return
    const match: Anchor = {
      from: row,
      to: best.row,
      fromIndex,
      toIndex: best.index,
      key: best.key,
      // rounded for the trace it ends up in, and only AFTER both comparisons above: the floor and
      // the margin read the full value, and a rounded one is what stays byte-stable across passes
      scored: { onto: best.onto, score: Math.round(best.score * 1000) / 1000 },
    }
    if (clearsAnchors(match, anchors)) proposed.push(match)
  })
  const claims = new Map<number, number>()
  for (const match of proposed) claims.set(match.toIndex, (claims.get(match.toIndex) ?? 0) + 1)
  return proposed.filter(match => claims.get(match.toIndex) === 1)
}

/**
 * The synopsis keys of one row, through `synopsisKeyOf` again.
 *
 * `keysOf`'s reason, verbatim: the reduction below IS the comparison, so reading the column raw would
 * make rule 3 depend on `plugin:profile` having reduced the same way. It is idempotent against
 * today's column, since a key is already a sorted bag of content words and every token in it clears
 * the length and the stopword tests by construction.
 */
const synopsisKeysOf = (episode: SideEpisode): string[] =>
  [...new Set(episode.synopsis.map(synopsisKeyOf).filter(Boolean))].sort(compare)

/**
 * How far the winning offset must OUTNUMBER the runner-up offset: 3, calibrated 2026-09-13.
 *
 * A MAJORITY IS A HEURISTIC AND NOT A CORRECTNESS PROOF, which is what this constant exists to say
 * out loud. `offsetConsensus` below keeps the offset most anchors agree on; nothing in that makes
 * the majority right. Four wrong anchors that happen to agree beat three right ones and the rule
 * then mints the four: executed 2026-09-13, an anchor set of four at `+5` against three at `0`
 * returned `offset 5, kept 4` under a bare majority. This file's earlier argument, that the outliers
 * are always a minority of one and never agree with each other, was an observation on three seasons
 * of one show and not something the code enforced.
 *
 * WHAT THE GAP COSTS, measured over the live corpus (63 shows, 189 Netflix seasons, 65 closed
 * pairings, 1037 true pairs, 2026-09-13, `scripts/calibrate-episode-anchors.test.ts`, the synopsis
 * grid at the shipped floor 0.20 and margin 0.05):
 *
 * | gap | pairings speaking | anchors kept | wrong |
 * | --- | --- | --- | --- |
 * | 0 (bare majority) to 3 | 21 | 466 | 0 |
 * | 4 | 18 | 455 | 0 |
 * | 5 | 15 | 436 | 0 |
 *
 * NOTHING, UP TO AND INCLUDING 3. The vote shape is why: of the 21 pairings that reach a consensus
 * at the shipped cell, the smallest margin of victory is 3 and the distribution runs 3, 4, 6, 7, 9,
 * 10 and up to 30. A gap of 4 is the first that costs anything, and it costs three pairings.
 *
 * WHAT IT BUYS, at the loosest cell in the grid (floor 0.10, margin 0), which is where a wrong
 * anchor survives the vote at all:
 *
 * | gap | pairings speaking | anchors kept | wrong |
 * | --- | --- | --- | --- |
 * | 0 to 2 | 18 | 509 | 4 |
 * | 3 | 17 | 505 | 0 |
 * | 4 | 16 | 500 | 0 |
 *
 * So 3 is the smallest gap that removes every wrong anchor a majority keeps ANYWHERE in the grid,
 * and it is free at the cell that ships. Below 3 it is measurably worse and above 3 it is measurably
 * more expensive, which is the whole argument for the number.
 *
 * IT IS A GAP AND NOT A RATIO because the populations are small. A ratio of two refuses `3 against
 * 2` and accepts `8 against 4`, where the second is the shakier of the two; a flat gap asks the same
 * question of a season with 5 anchors as of one with 30.
 */
export const MIN_CONSENSUS_GAP = 3

/**
 * The OFFSET CONSENSUS of 5.4 P4 rule 3: the shift a set of anchors agrees on, or nothing.
 *
 * Every anchor implies an offset, `our number - their number`. The majority offset is taken and every
 * anchor that disagrees with it is DISCARDED, which is what removes the one or two wrong anchors a
 * synopsis score accepts per season (`MIN_CONSENSUS_ANCHORS` carries the table).
 *
 * THE VOTE IS A HEURISTIC. It says what most of these anchors think, never what is true, and where
 * the scorer is wrong the same way several times over it is wrong with them (`MIN_CONSENSUS_GAP`
 * carries the executed case and what the gap recovers). Everything downstream of it is still order
 * placed inside a bracket, which is the safety argument rule 3 actually rests on.
 *
 * Four refusals, and each one is a season that mints nothing rather than a season that mints on the
 * best guess available:
 *
 * - fewer than `MIN_CONSENSUS_ANCHORS` anchors in total, so there is no population to take a
 *   majority of;
 * - fewer than `MIN_CONSENSUS_ANCHORS` agreeing on the top offset, however many anchors there are;
 * - a bare PLURALITY: the top offset must be held by strictly more than half of the anchors. Five of
 *   twelve is the shape this refuses, and it is a real one (the same three seasons scored with a
 *   five letter token cut split season 2 that way, `MIN_SYNOPSIS_TOKEN`);
 * - a CONTESTED majority: the winner must outnumber the runner-up by `MIN_CONSENSUS_GAP`. This is
 *   the refusal a bare majority does not have, and the one that turns four wrong anchors agreeing
 *   against three right ones into nothing minted rather than four wrong pairs.
 *
 * MONOTONICITY IS NOT TESTED HERE, AND THAT IS NOT AN OMISSION EITHER. Every kept anchor shares one
 * offset, so `to.number = from.number + offset` for all of them; the caller builds the proposal in
 * ascending `from.number` and the reference slots are in ascending number, so the kept set is
 * already increasing in both indices. A monotone filter over one offset can only ever return its
 * input, which `range.test.ts` pins rather than leaves as an argument. The same goes for asking the
 * kept anchors to cover a CONTIGUOUS span: a real season anchors 8 rows of 24 and the span between
 * them is exactly what order is for, so the test would refuse every true season measured.
 *
 * THERE IS NO TIE CLAUSE. A tie for the top means two offsets hold k anchors each out of at least
 * 2k, so `top * 2 <= anchors.length` is true and the majority test has already refused it: a
 * separate tie test would be a branch nothing can reach. Ties are still broken toward the lowest
 * offset when the counts are ranked, so the offset named in a refusal that never happens does not
 * depend on which offset the map held first.
 *
 * REFUSES AN ANCHOR WITH NO NUMBER on either side rather than reading one as `NaN`. Inside
 * `alignByTitle` both lists are number-filtered and the case cannot arise; an external caller gets a
 * refusal, where the earlier `to.number!` gave every unnumbered anchor the one `NaN` offset key and
 * then filtered them all back out, answering `consensus: NaN`.
 *
 * `gap` and `floor` are the calibration's knobs, defaulted to the shipped constants: the sweep in
 * `scripts/calibrate-episode-anchors.test.ts` drives THIS function at every cell of its grid rather
 * than a copy of it, which is the only way a grid can speak about what ships.
 */
export const offsetConsensus = (
  anchors: readonly Anchor[],
  options: { gap?: number, floor?: number } = {}
): { offset: number, anchors: Anchor[] } | null => {
  const floor = options.floor ?? MIN_CONSENSUS_ANCHORS
  const gap = options.gap ?? MIN_CONSENSUS_GAP
  const numbered = anchors.filter(anchor => anchor.to.number !== null && anchor.from.number !== null)
  if (numbered.length < floor) return null
  const offsetOf = (anchor: Anchor): number => anchor.to.number! - anchor.from.number!
  const votes = new Map<number, number>()
  for (const anchor of numbered) votes.set(offsetOf(anchor), (votes.get(offsetOf(anchor)) ?? 0) + 1)
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const [offset, top] = ranked[0]!
  if (top < floor) return null
  if (top * 2 <= numbered.length) return null
  if (top - (ranked[1]?.[1] ?? 0) < gap) return null
  return { offset, anchors: numbered.filter(anchor => offsetOf(anchor) === offset) }
}

/**
 * Rule 3's SYNOPSIS anchors: the third and weakest anchor source, and the only one behind a consensus.
 *
 * Every test `scoredAnchors` applies is applied here too, on the synopsis keys instead of the title
 * keys and at `SYNOPSIS_ANCHOR_FLOOR` and `SYNOPSIS_ANCHOR_MARGIN`: the best score clears the floor,
 * it beats the runner-up taken over ALL numbers, the number is not one an exact match or a weld
 * already reached, the number is reached by one of their rows alone, and it crosses no exact anchor.
 * Then, and this is the part that is new to this file, `offsetConsensus` throws away every anchor
 * that disagrees with the majority shift and refuses the whole set when there is no majority to
 * disagree with.
 *
 * `taken` is the rows and numbers the exact matches and the welds already hold, passed in rather than
 * recomputed, because a synopsis reaching a number a stronger test already reached is the
 * displacement `scoredAnchors` documents: it would kill both under the one-claim-per-number filter.
 *
 * `proposed` is returned beside the answer because the two are different claims and a case that
 * cannot see both cannot tell a gate that removed an outlier from a scorer that never proposed one.
 *
 * `floor`, `margin` and `gap` default to the shipped constants and exist so the calibration grid in
 * `scripts/calibrate-episode-anchors.test.ts` can sweep THIS function rather than a copy of it. A
 * grid swept over a re-implementation measures the re-implementation, which is how the first version
 * of this rule shipped with no negative control at all.
 */
export const synopsisAnchors = (options: {
  ordered: readonly SideEpisode[]
  canonical: readonly CanonicalEpisode[]
  taken: readonly Anchor[]
  anchors: readonly Anchor[]
  floor?: number
  margin?: number
  gap?: number
}): { proposed: Anchor[], anchors: Anchor[], consensus: number | null } => {
  const { ordered, canonical, taken, anchors } = options
  const floor = options.floor ?? SYNOPSIS_ANCHOR_FLOOR
  const margin = options.margin ?? SYNOPSIS_ANCHOR_MARGIN
  const takenRows = new Set(taken.map(match => match.from.uri))
  const takenSlots = new Set(taken.map(match => match.toIndex))
  const slots = canonical.map(slot => slot.rows.map(row => ({ row, keys: synopsisKeysOf(row) })))
  const nothing = { proposed: [], anchors: [], consensus: null }
  if (slots.every(slot => slot.every(entry => !entry.keys.length))) return nothing

  const proposed: Anchor[] = []
  ordered.forEach((row, fromIndex) => {
    if (takenRows.has(row.uri)) return
    const keys = synopsisKeysOf(row)
    if (!keys.length) return
    let best = { index: -1, score: 0, key: '', row: null as SideEpisode | null }
    let second = 0
    slots.forEach((slot, index) => {
      const found = bestAgainst(keys, slot)
      if (found.score > best.score) {
        second = best.score
        best = { index, score: found.score, key: found.key, row: found.row }
      } else if (found.score > second) second = found.score
    })
    if (best.score < floor || !best.row) return
    if (best.score - second < margin) return
    if (takenSlots.has(best.index)) return
    const match: Anchor = {
      from: row,
      to: best.row,
      fromIndex,
      toIndex: best.index,
      key: best.key,
      // the consensus is not known yet, so it is stamped below once the majority is taken; rounded
      // for the trace, and only after both comparisons above, which read the full value
      synopsis: { score: Math.round(best.score * 1000) / 1000, consensus: 0 },
    }
    if (clearsAnchors(match, anchors)) proposed.push(match)
  })
  // CONSENSUS FIRST, THEN one row per number, where `scoredAnchors` above does only the second. The
  // order is worth three anchors of the 24 these three seasons reach, because the two filters
  // DISAGREE about what a collision means: a wrong anchor landing on a number a true one also
  // reached is two claims on one number, so the uniqueness filter drops BOTH and the true anchor
  // pays for the wrong one (season 1 loses `18 onto 18` to `24 onto 18`, season 2 `21 onto 20` to
  // `22 onto 20`, season 3 `9 onto 9` to `4 onto 9`; measured 2026-09-13). Consensus removes the
  // wrong one on the evidence of every other anchor, so the number is uncontested by the time
  // uniqueness reads it. It is safe in that order only because consensus itself is a majority over
  // offsets rather than a decision about one number: it cannot pick between two claims, it can only
  // throw away the claims that disagree with the season
  const agreed = offsetConsensus(proposed, { gap: options.gap })
  if (!agreed) return { ...nothing, proposed }
  const claims = new Map<number, number>()
  for (const match of agreed.anchors) claims.set(match.toIndex, (claims.get(match.toIndex) ?? 0) + 1)
  return {
    proposed,
    anchors: agreed.anchors
      .filter(match => claims.get(match.toIndex) === 1)
      .map(match => ({ ...match, synopsis: { ...match.synopsis!, consensus: agreed.offset } })),
    consensus: agreed.offset,
  }
}

/**
 * Rule 3's first step: the ANCHORS, and the two ordered lists they sit in.
 *
 * An anchor is exact `stripTitle` equality, non-generic, and unique on each side, then MONOTONE: the
 * anchors are the longest increasing subsequence of those matches, so an alignment never crosses
 * itself. Three ways a match is dropped, each of them an identity question order cannot answer:
 *
 * - a key their side carries twice, exactly as rule 2 drops it;
 * - a key naming two different numbers of OURS (a key several rows of one number carry is that
 *   number's, however many origins spell it);
 * - a canonical number two of their rows reach, which is one row too many for one episode.
 *
 * THEN, AND ONLY WHERE THOSE CANNOT BRACKET AT ALL, the scored anchors of `scoredAnchors` are added,
 * and after them the synopsis anchors of `synopsisAnchors` (2026-09-13). Both are FALLBACKS and
 * neither is a replacement, and the live sweep is why: as a replacement
 * at these constants the anchor recall rises from 66.0% to 86.5% and rule 3's OWN contribution falls
 * by two thirds, 250 rows placed by order becoming 87, 46 of 65 pairings speaking becoming 17, 810
 * pairs minted becoming 367. Every extra anchor consumes a row a bracket would otherwise have
 * forced, and it is bought with no precision at all, since the exact rule is already at 0 wrong. As a
 * fallback the same sweep keeps all 43 truth pairings the exact rule speaks on, adds 0 certainly
 * wrong, and unlocks 5 pairings the exact rule cannot bracket at all.
 *
 * WHAT IT BUYS, measured on THIS CODE rather than on an emulation of it (2026-09-13, the whole 790
 * pairing cross product, `alignByTitle` against an exact-only alignment over the same two lists,
 * both through the gate). On the 65 truth pairings and the 68 hard negatives the two are IDENTICAL:
 * 43 speaking, 162 rows placed, 769 pairs, 0 wrong, and 0 of the negatives speaking either way. The
 * whole of the difference is 5 pairings the exact rule cannot bracket at all, and 78 pairs on them:
 * Attack on Titan season 1 onto anilist 16498 (20 welds agreeing on offset 0, 25 pairs), Naruto
 * season 6 and season 8 onto anilist 20 (offset 135 and 186, 21 and 18 pairs), Mob Psycho 100 season
 * 3 onto 140439 (11), Blue Exorcist season 3 onto 158931 (3). None is a hard negative, and all five
 * are corroborated by the one judge that reads no title at all: the offset each one produces closes
 * the count surplus exactly and covers every surplus row with a dated special. Two of the five
 * carry NO exact anchor, which is the population neither sweep could certify, so the count closure
 * is the strongest thing said about them.
 *
 * So below `MIN_ALIGNED` exact anchors, which is exactly where the shipped rule mints NOTHING, the
 * scores are consulted; at or above it this function returns what it always returned, byte for byte.
 * That is what makes both changes purely additive: no pair the exact rule minted can be lost.
 *
 * THE THREE SOURCES ARE ORDERED BY STRENGTH AND EACH ONE IS OFFERED WHAT THE LAST DID NOT TAKE. An
 * exact equality holds its row and its number against both scores, a weld holds its own against the
 * synopsis, and the synopsis is never asked about a row or a number that is already spoken for. The
 * union goes through `longestMonotone` exactly as it did, so a crossing anchor from any source is
 * dropped rather than allowed to bend the alignment.
 *
 * CONSENSUS GATES THE SYNOPSIS ANCHORS AND NOT THE WELDS, deliberately, and the two sweeps in
 * `SCORED_ANCHOR_FLOOR` and `MIN_CONSENSUS_ANCHORS` are the whole argument. The weld is a
 * near-equality: at floor 0.60 with margin 0.15 it proposed 1000 anchors on the live sweep with 0
 * wrong and 0 of 68 hard negatives speaking, so a consensus over it would gate a population with no
 * measured errors in it and could only cost recall. It would cost a specific pairing, too: the fifth
 * pairing the weld unlocks is Blue Exorcist season 3 onto the Shimane Illuminati Saga, which has ONE
 * exact anchor and ONE weld, and a three-vote consensus kills it. The synopsis is the opposite
 * population: at floor 0.20 it is wrong 1 to 2 times per season BEFORE the gate, which is what a
 * weak test looks like, and consensus is the price of admitting one at all.
 *
 * Every list is sorted before it is read (their rows by number then uri, ours by number, the
 * specials by uri), so the alignment is a function of the two lists and not of the scan's order.
 */
export const alignByTitle = (
  reference: readonly SideEpisode[],
  theirs: readonly SideEpisode[]
): Alignment => {
  const ordered = [...theirs]
    .filter(episode => episode.number !== null)
    .sort((a, b) => a.number! - b.number! || compare(a.uri, b.uri))

  const byNumber = new Map<number, SideEpisode[]>()
  for (const row of [...reference].sort(byUri)) {
    if (row.number === null) continue
    byNumber.set(row.number, [...byNumber.get(row.number) ?? [], row])
  }
  const canonical: CanonicalEpisode[] = [...byNumber.keys()]
    .sort((a, b) => a - b)
    .map(number => ({ number, rows: byNumber.get(number)! }))
  const specials = [...reference].filter(episode => episode.number === null).sort(byUri)

  const ourKey = new Map<string, { index: number, row: SideEpisode } | null>()
  canonical.forEach((entry, index) => {
    for (const row of entry.rows) {
      for (const key of anchorKeysOf(row)) {
        const held = ourKey.get(key)
        if (held === undefined) ourKey.set(key, { index, row })
        else if (held && held.index !== index) ourKey.set(key, null)
      }
    }
  })
  const theirKey = new Map<string, SideEpisode | null>()
  for (const row of ordered) {
    for (const key of anchorKeysOf(row)) {
      if (theirKey.has(key)) theirKey.set(key, null)
      else theirKey.set(key, row)
    }
  }

  const matches: Anchor[] = []
  ordered.forEach((row, fromIndex) => {
    const reached = new Map<number, { row: SideEpisode, key: string }>()
    for (const key of anchorKeysOf(row)) {
      if (theirKey.get(key) !== row) continue
      const ours = ourKey.get(key)
      if (!ours) continue
      if (!reached.has(ours.index)) reached.set(ours.index, { row: ours.row, key: key })
    }
    // two different numbers of ours through two keys is an ambiguity, not two matches
    if (reached.size !== 1) return
    const entry = [...reached.entries()][0]!
    matches.push({ from: row, to: entry[1].row, fromIndex, toIndex: entry[0], key: entry[1].key })
  })
  const claims = new Map<number, number>()
  for (const match of matches) claims.set(match.toIndex, (claims.get(match.toIndex) ?? 0) + 1)
  const single = matches.filter(match => claims.get(match.toIndex) === 1)
  const exact = longestMonotone(single)
  const found = { theirs: ordered, canonical, specials, matches: single.length }
  if (exact.length >= MIN_ALIGNED) {
    return { ...found, anchors: exact, scored: 0, synopsis: 0, consensus: null }
  }

  // THE FALLBACK. `single` rather than `exact` decides what is taken, so a match the monotone filter
  // dropped still holds its row and its number against the score: it is an exact equality, and the
  // reason it is not an anchor is that it crosses another one, which is not a licence to weld it
  const scored = scoredAnchors({ ordered, canonical, matches: single, anchors: exact })
  // and the synopsis is offered what the two title tests did not take, in their order of strength
  const synopsis = synopsisAnchors({ ordered, canonical, taken: [...single, ...scored], anchors: exact })
  const union = [...exact, ...scored, ...synopsis.anchors].sort((a, b) => a.fromIndex - b.fromIndex)
  const anchors = longestMonotone(union)
  return {
    ...found,
    anchors,
    scored: anchors.filter(anchor => anchor.scored).length,
    synopsis: anchors.filter(anchor => anchor.synopsis).length,
    consensus: synopsis.consensus,
  }
}

/**
 * Rule 3's second step: the rows an EQUAL-GAP BRACKET forces between two anchors.
 *
 * A row strictly between two anchors is forced when the number of rows between them is the same on
 * both sides, because order then permits exactly one bijection and no title evidence is consulted
 * for it. That is where the three Mushoku pairs no title rule could reach come from (`Unwilling to
 * Die` onto `I Don't Want to Die`, `This Feeling` onto `These Feelings`, and one accent difference,
 * measured 2026-09-12).
 *
 * ROWS ARE COUNTED, NEVER NUMBERS. A pair needs two rows, so a side that skips a number has one row
 * fewer to place and not one gap more; counting the numbers instead would refuse a region over a
 * hole that has no row in it.
 *
 * An unequal gap refuses ITS OWN REGION and keeps its anchors: one side carries a row the other does
 * not, and which row that is is exactly what order cannot say. `unequal` counts those regions so a
 * refusal can name what it saw.
 */
export const forcedByBracket = (alignment: Alignment): { pairs: Pair[], unequal: number } => {
  const { anchors, theirs, canonical } = alignment
  if (anchors.length < 2) return { pairs: [], unequal: 0 }
  const pairs: Pair[] = []
  let unequal = 0
  for (let index = 1; index < anchors.length; index += 1) {
    const lower = anchors[index - 1]!
    const upper = anchors[index]!
    const rows = theirs.slice(lower.fromIndex + 1, upper.fromIndex)
    const slots = canonical.slice(lower.toIndex + 1, upper.toIndex)
    if (!rows.length && !slots.length) continue
    if (rows.length !== slots.length) {
      unequal += 1
      continue
    }
    const between: [string, string] = [lower.from.uri, upper.from.uri]
    rows.forEach((row, offset) => pairs.push(pairOnto(row, slots[offset]!, { between })))
  }
  return { pairs, unequal }
}

/**
 * The token level match of 3.4a, and the ONE place rule 3 does not demand exact equality.
 *
 * A retranslating origin REORDERS words: Netflix's `Fitz the Guardian` against ani.zip's special
 * `Guardian Fitz` (`S1`, aired 2023-07-03, a week before canonical episode 1). So the smaller token
 * set must be CONTAINED in the larger and carry at least two tokens. A one word title decides
 * nothing and is refused rather than guessed, which is also what keeps `Recap` off every special a
 * run has.
 *
 * It is admitted here and nowhere else because a located insertion places NO pair of its own: it
 * only has to account for a surplus the anchors already measured, and the closure it enables is then
 * checked against those anchors.
 */
const MIN_SPECIAL_TOKENS = 2

const tokenSetsOf = (episode: SideEpisode): Set<string>[] =>
  anchorKeysOf(episode).map(key => new Set(key.split(' ').filter(Boolean)))

const tokensMatch = (a: SideEpisode, b: SideEpisode): boolean =>
  tokenSetsOf(a).some(left => tokenSetsOf(b).some(right => {
    const [small, large] = left.size <= right.size ? [left, right] : [right, left]
    if (small.size < MIN_SPECIAL_TOKENS) return false
    return [...small].every(token => large.has(token))
  }))

/** One insertion LOCATED (3.4a point 2): their unanchored row, and the special that explains it. */
export type LocatedSpecial = { from: SideEpisode, special: SideEpisode }

const dayRank = (episode: SideEpisode): number => episode.day ?? Number.MAX_SAFE_INTEGER

/**
 * Which of their rows are insertions the run's own specials explain.
 *
 * A special carries its own air date, so where two specials could both explain a row the EARLIER
 * DATE decides; two on one day decide nothing and the whole location is refused (`ambiguous`). A
 * special two different rows reach names neither of them, for the same reason a duplicated title is
 * no anchor.
 */
const locateInsertions = (
  rows: readonly SideEpisode[],
  specials: readonly SideEpisode[]
): { located: LocatedSpecial[], ambiguous: boolean } => {
  const reach = rows.map(row => ({ row, matched: specials.filter(special => tokensMatch(row, special)) }))
  const claims = new Map<string, number>()
  for (const entry of reach) {
    for (const special of entry.matched) claims.set(special.uri, (claims.get(special.uri) ?? 0) + 1)
  }
  const located: LocatedSpecial[] = []
  let ambiguous = false
  for (const entry of reach) {
    const reachable = entry.matched.filter(special => claims.get(special.uri) === 1)
    if (reachable.length !== entry.matched.length) ambiguous = true
    if (!reachable.length) continue
    const ordered = [...reachable].sort((a, b) => dayRank(a) - dayRank(b) || compare(a.uri, b.uri))
    if (ordered.length > 1 && dayRank(ordered[0]!) === dayRank(ordered[1]!)) {
      ambiguous = true
      continue
    }
    located.push({ from: entry.row, special: ordered[0]! })
  }
  return { located, ambiguous }
}

/**
 * Rule 3's third step, 3.4a: CLOSING the alignment with the specials list.
 *
 * Nothing outside the outermost anchors is paired unless this closes, and it closes only when the
 * alignment PROVES ITSELF: every region between anchors has an equal gap, the surplus is at least
 * one row, the located insertions account for it EXACTLY, and each of the head and the tail balances
 * once its own insertions are removed. Measured on Mushoku Tensei's Netflix season 2 (2026-09-12):
 * locating one special at row 1 forces rows 2 to 25 onto canonical 1 to 24, and the four anchors
 * then sit where the closure predicts.
 *
 * A SURPLUS OF ZERO CLOSES NOTHING, and that is the load bearing refusal rather than a shortcut.
 * With no surplus there is no insertion to locate, so the only thing left saying the tail lines up is
 * that the two counts agree, and "there is no rule by COUNT" (5.4 P4): a count-exact season with no
 * other evidence is the Demon Slayer shape, two runs of eleven under `nf:81091393-3` which no count
 * axis can separate (2026-09-04). So the anchors keep whatever their brackets forced and the ends
 * stay unpaired.
 *
 * `unequal` is `forcedByBracket`'s count, passed in rather than recomputed: a region the bracket
 * refused is a row one side carries and the other does not, which is the same surplus the closure is
 * trying to account for, and accounting for it twice is how an extrapolation gets in.
 */
export const closeWithSpecials = (options: {
  alignment: Alignment
  unequal: number
}): { pairs: Pair[], located: LocatedSpecial[], closed: boolean } => {
  const { alignment, unequal } = options
  const { anchors, theirs, canonical, specials } = alignment
  const refused = { pairs: [], located: [], closed: false }
  if (anchors.length < 2 || unequal) return refused
  const surplus = theirs.length - canonical.length
  if (surplus < 1) return refused

  const first = anchors[0]!
  const last = anchors[anchors.length - 1]!
  const regions = [
    { rows: theirs.slice(0, first.fromIndex), slots: canonical.slice(0, first.toIndex) },
    { rows: theirs.slice(last.fromIndex + 1), slots: canonical.slice(last.toIndex + 1) },
  ]

  const located: LocatedSpecial[] = []
  const forced: { row: SideEpisode, slot: CanonicalEpisode }[] = []
  for (const region of regions) {
    const extra = region.rows.length - region.slots.length
    if (extra < 0) return refused
    const spent = new Set(located.map(entry => entry.special.uri))
    const found = locateInsertions(region.rows, specials.filter(special => !spent.has(special.uri)))
    if (found.ambiguous || found.located.length !== extra) return refused
    located.push(...found.located)
    const inserted = new Set(found.located.map(entry => entry.from.uri))
    const remaining = region.rows.filter(row => !inserted.has(row.uri))
    remaining.forEach((row, offset) => forced.push({ row, slot: region.slots[offset]! }))
  }
  // the surplus of 3.4a point 1, stated again over the whole alignment rather than region by region:
  // the two are equal while every inner gap is equal, and this is the sentence the rule promises
  if (located.length !== surplus) return refused

  const closed = located.map(entry => entry.special.uri).sort(compare)
  return { pairs: forced.map(entry => pairOnto(entry.row, entry.slot, { closed })), located, closed: true }
}

/** What rule 3 came to: the pairs, and every count a refusal or a trace needs to explain them. */
export type SequencePairing = {
  alignment: Alignment
  /** One pair per anchor, in their own order. Empty below the two anchor minimum, since one brackets nothing. */
  anchored: Pair[]
  /** The rows an equal-gap bracket forced between two anchors. */
  forced: Pair[]
  /** The rows 3.4a's closure forced outside the outermost anchors. */
  closure: Pair[]
  /** Regions between two anchors whose row counts disagreed: each keeps its anchors and pairs nothing. */
  unequal: number
  located: LocatedSpecial[]
  closed: boolean
  /** `anchored`, `forced` and `closure` together, ordered, or NOTHING when order placed no row. */
  pairs: Pair[]
}

/**
 * Rule 3 of 5.4 P4, by SEQUENCE: anchors, the rows their brackets force, and 3.4a's closure.
 *
 * RULE 3 SPEAKS ONLY WHEN ORDER PLACES A ROW. With two or more anchors and nothing forced, every
 * pair it could write is an exact title match and nothing else, which is rule 2's evidence and is
 * governed by rule 2's bar (three matches and 0.6 coverage of the candidate, `similar.ts:59-69`).
 * That bar is what makes "a fold of two equal cours at 12/24 mints no title pairs and only the date
 * rule can prove a fold" true, and a rule 3 that minted its anchors alone would repeal it for every
 * fold whose titles happen to be shared. So the anchors ride out with the forced rows or not at all:
 * what rule 3 adds, and the only thing it adds, is the rows no title reaches.
 *
 * WHAT THE GATE DOES AND DOES NOT DO FOR A SCORED ANCHOR (2026-09-13, corrected the same day). It
 * mints nothing unless ORDER placed at least one row, so a weld can never ride out alone on its own
 * similarity, and no row is ever paired by comparing its own title to anything. It does NOT make a
 * weld pairless: a weld writes its own anchor pair exactly as an exact match writes one, and where
 * every anchor is a weld the offset the bracket then counts in came from scores. So the guards
 * against a wrong weld are the calibrated floor and margin, `MIN_SCORED_ANCHORS` above (three
 * agreeing welds where no equality corroborates the offset), the one-row-per-number filters, the
 * equal-gap arithmetic, and `scheduleSkew` over the result. The gate is a necessary condition, not
 * the safety argument, and this comment said otherwise until an executed probe minted four rows off
 * two score votes.
 *
 * The three steps are separate exported functions because each is a different kind of claim: the
 * anchors are a title measurement, the brackets are arithmetic over one order, and the closure is an
 * argument about a surplus. `reference` is the run's own rows, exactly as rules 1 and 2 read them,
 * and the specials come out of it: a row of the run with no number is an insertion candidate and a
 * pair target never, since there is no slot for it inside `1..runLength` (5.4 P5).
 */
export const pairsBySequence = (
  reference: readonly SideEpisode[],
  theirs: readonly SideEpisode[]
): SequencePairing => {
  const alignment = alignByTitle(reference, theirs)
  const anchored = alignment.anchors.length < minAnchorsFor(alignment)
    ? []
    : alignment.anchors.map(anchor => ({
      from: anchor.from,
      to: anchor.to,
      fromNumber: anchor.from.number!,
      toNumber: anchor.to.number!,
      evidence: anchor.synopsis
        ? { synopsisScore: anchor.synopsis.score, consensus: anchor.synopsis.consensus }
        : anchor.scored
          ? { scored: anchor.key, onto: anchor.scored.onto, score: anchor.scored.score }
          : { anchor: anchor.key },
    } satisfies Pair))
  const bracket = forcedByBracket(alignment)
  const closure = closeWithSpecials({ alignment, unequal: bracket.unequal })
  const placed = [...bracket.pairs, ...closure.pairs]
  const pairs = anchored.length && placed.length
    ? [...anchored, ...placed].sort((a, b) => a.fromNumber - b.fromNumber || compare(a.from.uri, b.from.uri))
    : []
  return {
    alignment,
    anchored,
    forced: bracket.pairs,
    closure: closure.pairs,
    unequal: bracket.unequal,
    located: closure.located,
    closed: closure.closed,
    pairs,
  }
}

/** One thing to be proven against one run: a season row, a lend, or a member that numbers differently. */
export type Candidate = {
  clusterId: string
  /**
   * `season`: a row attached by an uncertain `PART_OF` (class 1). `lend`: episodes a foreign claimer
   * hung on a member, with no row of their own (class 2, 4.4). `member`: a member of this very
   * cluster whose numbering does not fit `1..runLength` (class 3, the Elusive Samurai shape).
   */
  kind: 'season' | 'lend' | 'member'
  /** The row the `INCLUDES` and the refusal hang off, which only a `season` candidate has. */
  seasonUri: string | null
  /** The member the `INCLUDES` points at: the one the `PART_OF` was claimed from. */
  memberUri: string | null
  /** The `LINK` keys the candidate was reached through, which every edge derived from it names. */
  via: string[]
  /** `coalesce(countDistinct, countStated)` of the candidate, which is `total` on a range (3.4). */
  theirCount: number | null
  retranslates: boolean
  episodes: SideEpisode[]
}

/** What one candidate came to: the pairs and the rule that proved them, or the reason for nothing. */
export type Verdict =
  | {
    ok: true
    rule: 'dates' | 'titles' | 'sequence'
    pairs: Pair[]
    coverage: number
    /**
     * How many of `pairs` rule 1's GAP CLOSURE placed rather than the days, and absent for the two
     * rules that have no closure. Zero is a real answer and means the days reached every row an
     * equality could have added, which is the usual case.
     */
    gaps?: number
    /**
     * The shape of rule 3's alignment, for the `INCLUDES` evidence, and absent for the other rules.
     *
     * Counted BEFORE the window, where `pairs` is counted after it: the numbers describe what the
     * alignment found, and `Hull.aligned` is what was minted out of it.
     */
    sequence?: {
      anchors: number
      /** How many of `anchors` were SCORED rather than exact equalities, which a trace has to know. */
      scored: number
      /** How many came from a SYNOPSIS, and the offset those agreed on (NULL when none was taken). */
      synopsis: number
      consensus: number | null
      forced: number
      closure: number
      unequal: number
      closed: boolean
    }
  }
  | { ok: false, reason: RangeRefusal }

/**
 * The decision rules of 5.4 P4 in order, each refusing on ambiguity rather than falling through.
 *
 * | outcome | when |
 * | --- | --- |
 * | `dates` | rule 1 left at least `MIN_ALIGNED` pairs inside the window and they are not a skew, plus whatever `closeDatesWithTitles` could close on top of them |
 * | `titles` | rule 1 did not, the candidate's origin does not retranslate, and rule 2 cleared both halves of its bar |
 * | `sequence` | neither did, and rule 3's alignment placed a row by ORDER: `minAnchorsFor` anchors, at least one row forced by a bracket or by 3.4a's closure AND still inside the window, `MIN_ALIGNED` pairs inside the window, and not the same offset rule 1 refused as a skew |
 * | `no-reference` | the run carries no numbered episode of its own, so no rule was asked anything (2026-09-13) |
 * | `retranslates` | nothing was proven and rule 2 was refused outright (Netflix, 4 exact of 25, the best wrong pair above the true one, 2026-09-10) |
 * | `date-skew` | rule 1's pairs were a constant offset the candidate's own numbering cannot absorb (`scheduleSkew`) and neither rule 2 nor rule 3 minted |
 * | `ambiguous-day` | rule 1 reached reference days and a day named two reference numbers |
 * | `unequal-gap` | rule 3 anchored and a bracket counted a different number of rows on each side, so order placed nothing |
 * | `no-anchors` | both sides carry non-generic titles or synopses and rule 3 found fewer anchors than `minAnchorsFor` asks of it, which is two, or three where no exact equality holds the alignment down (Netflix's season 1, 3.4a point 4), a synopsis set that met no offset majority included |
 * | `no-titles` | both sides carry that material, rule 2 missed its bar, and rule 3 anchored with nothing to force, or nothing it forced landed inside the window |
 * | `no-dates` | everything else: the date rule could not run or its days met nothing, and the title rules had no material either |
 *
 * RULE 3 RUNS THIRD, and where rule 2 is REFUSED rather than merely short of its bar. Two things fix
 * that position. It is the weakest evidence of the three, since a bracket consults no evidence at all
 * for the row it forces, and the rules are ordered by what they measure. And it is the only one that
 * may read a retranslating origin's titles, because it reads them to ANCHOR and never to place (see
 * the header), so putting it before rule 2 would let an alignment answer where a coverage that
 * cleared both halves of its bar was available. A scored anchor does not move it: rule 2 mints ON a
 * score, where rule 3 mints only what order places, and that is the whole difference between them.
 *
 * A PAIRING RULE 1 REFUSED AS A SKEW IS NOT RESURRECTED BY RULE 3. `scheduleSkew` is asked again
 * about rule 3's own pairs: an alignment that reproduces the offset the dates were refused for is
 * refused for the same reason, and one that disagrees with it (the usual case, since the anchors are
 * exact titles) stands. A candidate longer than the run reaches that guard's last clause and is never
 * a skew, which is why the Netflix season of 25 against a run of 24 is admitted.
 *
 * THE WINDOW IS APPLIED BEFORE THE BAR. A pair whose `toNumber` falls outside `1..runLength` is
 * dropped rather than counted (`consensus.ts:185-191`): a season containing this run brings episodes
 * on both sides of it, the previous cour lands at zero and below and the next above the length, and
 * counting those toward `MIN_ALIGNED` would let a neighbouring cour carry a fold over the bar.
 */
export const decideCandidate = (options: {
  runLength: number
  reference: readonly SideEpisode[]
  candidate: Pick<Candidate, 'retranslates' | 'episodes'>
}): Verdict => {
  const { runLength, reference, candidate } = options
  // FIRST, and above `retranslates`: with no numbered row on our side there is nothing for any rule
  // below to be refused ON, and a reason naming the candidate would be a statement about a comparison
  // that never happened
  if (!reference.some(episode => episode.number !== null)) return { ok: false, reason: 'no-reference' }
  const inWindow = (pairs: Pair[]) => pairs.filter(pair => pair.toNumber >= 1 && pair.toNumber <= runLength)

  const dates = pairsByDay(reference, candidate.episodes)
  const dated = inWindow(dates.pairs)
  // rule 1 stands unless the pairing it found is a schedule skew, in which case it is evidence that
  // the two lists are the same sequence and NOT evidence of a renumbering, so rule 2 decides
  const skew = dated.length >= MIN_ALIGNED
    ? scheduleSkew({ runLength, episodes: candidate.episodes, pairs: dated })
    : null
  if (skew === null && dated.length >= MIN_ALIGNED) {
    // THE GAP CLOSURE runs on the pairs the window already kept, and its own output goes through the
    // window again: a row an equality reaches beyond `1..runLength` is the neighbouring cour's and is
    // dropped exactly as a dated one is
    const gaps = inWindow(closeDatesWithTitles({ reference, theirs: candidate.episodes, pairs: dated }))
    return { ok: true, rule: 'dates', pairs: [...dated, ...gaps], coverage: 1, gaps: gaps.length }
  }

  // rule 2, refused OUTRIGHT for a retranslating origin, where rule 3 below is not (3.4a)
  const titles = candidate.retranslates ? null : pairsByTitle(reference, candidate.episodes)
  if (titles) {
    const titled = inWindow(titles.pairs)
    if (titled.length >= MIN_EPISODE_TITLE_MATCHES && titles.coverage >= EPISODE_TITLE_COVERAGE) {
      return { ok: true, rule: 'titles', pairs: titled, coverage: titles.coverage }
    }
  }

  const sequence = pairsBySequence(reference, candidate.episodes)
  const sequenced = inWindow(sequence.pairs)
  // THE GATE AGAIN, THIS TIME AFTER THE WINDOW, because `pairsBySequence` counts before it. Where
  // every row order placed falls outside `1..runLength` the pairs left standing are the anchors
  // alone, which for a welded alignment is a set of similarities and nothing else (executed
  // 2026-09-13: two welds inside the window, a closure of three rows all above `runLength`, two
  // pairs written on score evidence with no order-placed row surviving). Reachable because
  // `reference` is filtered by origin membership and only its COUNT is checked against the run's
  // length, never its numbering, so two reference origins that number differently put a canonical
  // number above `runLength`
  const placedInWindow = inWindow([...sequence.forced, ...sequence.closure]).length
  const sequenceSkew = sequenced.length >= MIN_ALIGNED && placedInWindow
    ? scheduleSkew({ runLength, episodes: candidate.episodes, pairs: sequenced })
    : null
  if (sequenceSkew === null && sequenced.length >= MIN_ALIGNED && placedInWindow) {
    return {
      ok: true,
      rule: 'sequence',
      pairs: sequenced,
      // NOT A SCORE, deliberately, and still not one now that an anchor can be scored: every pair
      // here is placed by ORDER, so there is no ratio to report, and a coverage would be the one
      // thing 3.4a says not to trust. What the score did is reported as `sequence.scored` instead,
      // where it is a count of welds rather than a confidence
      coverage: 1,
      sequence: {
        anchors: sequence.anchored.length,
        scored: sequence.alignment.scored,
        synopsis: sequence.alignment.synopsis,
        consensus: sequence.alignment.consensus,
        forced: sequence.forced.length,
        closure: sequence.closure.length,
        unequal: sequence.unequal,
        closed: sequence.closed,
      },
    }
  }

  // `retranslates` stays the most specific refusal for the origin it names, above the skew it
  // outranked before rule 3 existed: rule 2 was refused before it was weighed, which is a fact about
  // the source rather than about this candidate's dates
  if (candidate.retranslates) return { ok: false, reason: 'retranslates' }
  // the skew is the most specific thing that happened to the DATES, and the only refusal that says
  // they did meet: nothing rather than a guess, with what was seen written down (`consensus.ts:105-110`)
  if (skew !== null) return { ok: false, reason: 'date-skew' }
  if (dates.ambiguous) return { ok: false, reason: 'ambiguous-day' }
  // rule 3's own two, in the same most-specific-first order: a bracket that counted two different
  // numbers of rows is a measurement, where a missing anchor is an absence
  if (sequence.unequal) return { ok: false, reason: 'unequal-gap' }
  // `no-titles` says the title rule had material on both sides and missed its bar, which is the more
  // specific of the two; `no-dates` is the fallback, and it covers both "one side carries no day" and
  // "the days met nothing", since neither rule then had anything to be refused ON.
  //
  // A SYNOPSIS IS MATERIAL TOO, since 2026-09-13. Rule 3 anchors on one, so a candidate whose rows
  // carry synopses and no titles at all (Netflix seasons titled `Episode N`) did have something to
  // be refused on, and calling that `no-dates` would name the one axis that was never consulted
  const material = (episode: SideEpisode): boolean => Boolean(keysOf(episode).length || episode.synopsis.length)
  const bothSides = reference.some(material) && candidate.episodes.some(material)
  if (!bothSides) return { ok: false, reason: 'no-dates' }
  return {
    ok: false,
    reason: sequence.alignment.anchors.length < minAnchorsFor(sequence.alignment) ? 'no-anchors' : 'no-titles',
  }
}

/**
 * Which rule placed ONE pair, which is the verdict's own for every pair except a gap closure.
 *
 * Read off the evidence rather than off a field, because the evidence IS the rule here: a shape
 * carrying `gap` was placed by an anchor equality under a standing date alignment and by nothing
 * else, and the two can never disagree because only `closeDatesWithTitles` writes that shape.
 */
export const ruleOfPair = (pair: Pair, rule: 'dates' | 'titles' | 'sequence'): string =>
  'gap' in pair.evidence ? 'dates-gap' : rule

/** The `INCLUDES` range of 3.4, as literal properties: the hull of the pairs on both sides. */
export type Hull = {
  fromStart: number, fromEnd: number, toStart: number, toEnd: number
  contiguous: boolean, aligned: number, total: number
}

/**
 * The hull of a set of pairs.
 *
 * `contiguous` is a statement about the pairs rather than about the span: a range covering every
 * number between its ends on both sides is contiguous, and the piecewise mapping an inserted special
 * produces (1 to 13 onto 1 to 13, then 15 to 26 onto 14 to 25, 8.3) is one range that is not, which
 * is exactly what the column exists to say.
 */
export const hullOf = (pairs: readonly Pair[], total: number): Hull | null => {
  if (!pairs.length) return null
  const from = pairs.map(pair => pair.fromNumber)
  const to = pairs.map(pair => pair.toNumber)
  const fromStart = Math.min(...from)
  const fromEnd = Math.max(...from)
  const toStart = Math.min(...to)
  const toEnd = Math.max(...to)
  return {
    fromStart,
    fromEnd,
    toStart,
    toEnd,
    contiguous: fromEnd - fromStart + 1 === pairs.length && toEnd - toStart + 1 === pairs.length,
    aligned: pairs.length,
    total,
  }
}

// ---------------------------------------------------------------------------------------------
// The candidate scan of 5.4 P4, one statement per class, joined in JS on the cluster id.

/** The run clusters, and the length every window and every reference set is read against. */
const CLUSTER_SCAN =
  `MATCH (c:Cluster)
   WHERE c.scope = 'RUN' AND c.runLength IS NOT NULL
   RETURN c.id AS id, c.runLength AS runLength, c.runLengthFrom AS runLengthFrom
   ORDER BY id`

/** Who is in each run cluster, so a candidate that is already a member cannot be given a range (3.5). */
const MEMBER_SCAN =
  `MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster)
   WHERE c.scope = 'RUN'
   RETURN c.id AS id, m.uri AS uri
   ORDER BY id, uri`

/** `ours`: the run's own episodes, hung by their own origin. The reference set is chosen in JS. */
const OURS_SCAN =
  `MATCH (c:Cluster)<-[:MEMBER_OF]-(o:Media)-[oh:HAS_EPISODE]->(oe:Episode)<-[:EPISODE_PROFILE_OF]-(poe:EpisodeProfile)
   WHERE c.scope = 'RUN' AND oh.claimer = o.origin AND oe.origin = o.origin
   RETURN c.id AS runCluster, o.uri AS memberUri, oe.uri AS uri, oe.origin AS origin,
     oe.episodeNumber AS number, poe.day AS day, poe.titleKeys AS keys,
     poe.synopsisKeys AS synopsis, oh.key AS hung
   ORDER BY runCluster, uri`

/**
 * Class 1: a season attached to a run by an uncertain `PART_OF`.
 *
 * Any origin with a season row, since appletv and tvmaze can answer `containing` as well as the
 * folding three (4.4); `folding` gates the count guards and, here, only the `asserted` reason, which
 * is what a source claim rather than an `ask` leaves behind.
 *
 * UNDIRECTED, where 5.4 P4's own spelling reads the run to season direction only. A `PART_OF` points
 * from the SHORTER side to the longer (`guards.ts`'s `downgradeTo`), so a fold of 24 against a run of
 * 11 lands as run to season while the five Netflix seasons of a 64 episode run land as season to run
 * (8.4, "downgrade to `PART_OF(season, run)` reason `count-mismatch`"), and a directed scan sees one
 * of the two. Nothing about the verdict changes: a range is minted only when the candidate is LONGER
 * than the run, which is the second row of the table, so a season reached the other way is proven
 * episode by episode and labels nothing.
 */
const SEASON_SCAN =
  `MATCH (c:Cluster)<-[:MEMBER_OF]-(r:Media)-[l:LINK]-(s:Media)<-[:PROFILE_OF]-(ps:MediaProfile)
   WHERE c.scope = 'RUN' AND l.kind = 'PART_OF' AND l.status = 'active' AND s.uri <> r.uri
     AND (l.reason IN ['count-mismatch', 'no-length', 'span', 'containing', 'contested', 'cross-scope']
       OR (l.reason = 'asserted' AND ps.folding))
   MATCH (s)-[h:HAS_EPISODE]->(se:Episode)<-[:EPISODE_PROFILE_OF]-(pse:EpisodeProfile)
   WHERE h.claimer = s.origin
   RETURN c.id AS runCluster, r.uri AS memberUri, s.uri AS seasonUri, l.key AS via,
     coalesce(ps.countDistinct, ps.countStated) AS theirCount, ps.retranslates AS retranslates,
     se.uri AS uri, se.origin AS origin, se.episodeNumber AS number,
     pse.day AS day, pse.titleKeys AS keys, pse.synopsisKeys AS synopsis, h.key AS hung
   ORDER BY runCluster, seasonUri, uri, memberUri, via`

/**
 * Class 2, the transitional lend: episodes a FOREIGN claimer hung on a member (4.4).
 *
 * `cr:` rows on an `anilist:` uri, grouped by claimer, with no season uri and no count. They are in
 * the graph and in no other collection, and they are evidence here and a slot nowhere.
 */
const LEND_SCAN =
  `MATCH (c:Cluster)<-[:MEMBER_OF]-(m:Media)-[h:HAS_EPISODE]->(e:Episode)<-[:EPISODE_PROFILE_OF]-(pe:EpisodeProfile)
   WHERE c.scope = 'RUN' AND h.claimer <> m.origin
   RETURN c.id AS runCluster, m.uri AS memberUri, h.claimer AS claimer, e.uri AS uri, e.origin AS origin,
     e.episodeNumber AS number, pe.day AS day, pe.titleKeys AS keys,
     pe.synopsisKeys AS synopsis, h.key AS hung
   ORDER BY runCluster, claimer, uri, hung`

/** The fourth input: every episode `SAME_AS` a source stated, which is the only reader that table has. */
const EPISODE_CLAIM_SCAN =
  `MATCH (a:Episode)-[c:EPISODE_CLAIMS]->(b:Episode)
   WHERE c.kind = 'SAME_AS'
   RETURN a.uri AS fromUri, b.uri AS toUri, c.key AS claimKey,
     a.episodeNumber AS fromNumber, b.episodeNumber AS toNumber
   ORDER BY fromUri, toUri, claimKey`

/**
 * Where a claimed episode SITS: the run clusters whose members hang it, by whatever claimer (4.4).
 *
 * Unlike `OURS_SCAN` this asks nothing about the claimer, because the question here is not whose
 * numbering to trust but whether the two rows of a claim are describing one run at all.
 */
const MEMBER_EPISODE_SCAN =
  `MATCH (c:Cluster)<-[:MEMBER_OF]-(m:Media)-[:HAS_EPISODE]->(e:Episode)
   WHERE c.scope = 'RUN'
   RETURN c.id AS clusterId, e.uri AS uri
   ORDER BY clusterId, uri`

/**
 * The other side of the same question: episodes of a season ATTACHED to a run by an active
 * `PART_OF`, which is the one hop a claim may cross (5.4 P4).
 *
 * Undirected for `SEASON_SCAN`'s reason: a downgrade points from the shorter side to the longer, so a
 * directed scan sees one of the two directions a containment can take. Any reason counts here, where
 * the candidate scan takes only the uncertain ones: a claim is not being PROVEN, it is being placed.
 */
const ATTACHED_EPISODE_SCAN =
  `MATCH (c:Cluster)<-[:MEMBER_OF]-(r:Media)-[l:LINK]-(s:Media)-[h:HAS_EPISODE]->(e:Episode)
   WHERE c.scope = 'RUN' AND l.kind = 'PART_OF' AND l.status = 'active' AND s.uri <> r.uri
     AND h.claimer = s.origin
   RETURN c.id AS clusterId, e.uri AS uri
   ORDER BY clusterId, uri`

const asText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const asNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null

/** An empty `STRING[]` reads back as NULL on this engine (2026-09-12), so the list is normalised here. */
const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []

/**
 * A profile key column as the keys alone, off a JSON column.
 *
 * Both columns it reads are lists of objects carrying a `key`: `titleKeys` is
 * `[{key, score, language, class}]` and `synopsisKeys` is `[{key, score, language}]`, so one reader
 * serves both and a column that arrives as anything else reads as no keys rather than as a throw.
 */
const keyListOf = (value: unknown): string[] => {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(entry => (entry && typeof entry === 'object' ? (entry as { key?: unknown }).key : undefined))
      .filter((key): key is string => typeof key === 'string' && Boolean(key))
  } catch {
    return []
  }
}

const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))

const episodeOf = (row: Record<string, unknown>): SideEpisode => ({
  uri: String(row.uri),
  origin: asText(row.origin) ?? originOf(String(row.uri)),
  number: asNumber(row.number),
  day: asNumber(row.day),
  keys: keyListOf(row.keys),
  synopsis: keyListOf(row.synopsis),
  hung: String(row.hung ?? ''),
})

/** Where one claimed episode sits: the run clusters that hold it, as a member's row or as a season's. */
export type Placement = { members: readonly string[], attached: readonly string[] }

/**
 * Whether an `EPISODE_CLAIMS` row may become an `asserted` pair (5.4 P4).
 *
 * The claim is admitted when both rows hang on members of ONE run cluster, or when one hangs on a
 * member and the other on a season attached to that same cluster by an active `PART_OF`. Two rows
 * that only share an ATTACHMENT are refused: two seasons hanging off one run is exactly the fold
 * this file exists to prove episode by episode, and a source asserting across it is asserting the
 * thing a pair is supposed to demonstrate.
 */
export const placesClaim = (from: Placement, to: Placement): boolean => {
  const shares = (a: readonly string[], b: readonly string[]): boolean => a.some(id => b.includes(id))
  return shares(from.members, to.members) || shares(from.members, to.attached) || shares(from.attached, to.members)
}

/**
 * Class 3, in JS: a member ORIGIN whose own numbering does not fit `1..runLength`.
 *
 * Grouped by origin and never by the row an episode hangs off, for `alignRunEpisodes`' own reason
 * (`consensus.ts:265-273`): the origin is the thing that numbers. A reference origin is never a
 * candidate against itself, and an origin that already starts at 1 and stays inside the length has
 * nothing to renumber, so Crunchyroll's 13 to 20 against a run of 12 is the whole of what this finds.
 */
export const numbersOutsideRun = (episodes: readonly SideEpisode[], runLength: number): boolean => {
  const numbers = episodes.map(episode => episode.number).filter((number): number is number => number !== null)
  if (!numbers.length) return false
  return Math.min(...numbers) !== 1 || Math.max(...numbers) > runLength
}

/**
 * The run's own episodes, which are the left hand side of every rule below.
 *
 * THE VOTE'S WINNERS FIRST, which is `runLengthFrom` and is what this was until 2026-09-13. Then the
 * one thing it never covered: a member may STATE a count without LISTING an episode, so a length
 * carried by such a member alone leaves this set empty, and an empty reference is not a weak
 * comparison but no comparison at all. Every rule then reaches nothing, every candidate is refused,
 * and the refusal names the CANDIDATE's origin (`retranslates` for Netflix) for a silence that is the
 * run's own.
 *
 * Measured that day on `ag:(anilist:146065)`, Mushoku Tensei season 2 cour 1: `runLength 13 from
 * anilist:146065, tier 0.8, witnesses 1`, and AniList lists no episode row anywhere in the graph. The
 * 12 rows the cluster draws are anizip's and kitsu's, neither of which states 13, so the reference was
 * empty and the route placed NOTHING from anybody: Netflix refused `retranslates` and Crunchyroll's
 * lend refused in silence. Its neighbour `ag:(anilist:166873)` has `12 from anilist, anizip, kitsu`,
 * witnesses 3, and places 22 pairs against the same two containers.
 *
 * THE FALLBACK TAKES ONLY AN ORIGIN THAT NUMBERS IN THE RUN'S OWN SPACE, which is `numbersOutsideRun`
 * read the other way round, so nothing can be a reference here and a class 3 candidate at the same
 * time, and a pair still lands on `1..runLength` where the window expects it. It is not a lowered bar:
 * every threshold inside `decideCandidate` is untouched, and this only supplies the side of the
 * comparison that was missing. An origin carrying no numbered row at all is not one of these, since a
 * list of specials can anchor nothing.
 *
 * It is consulted ONLY when the vote's own members list nothing, never to widen a reference that
 * exists: a run whose length came from a member that does list episodes keeps exactly the reference it
 * had, which is what leaves the four working routes byte identical.
 */
export const referenceEpisodes = (options: {
  episodes: readonly SideEpisode[]
  runLengthFrom: readonly string[]
  runLength: number
}): { reference: SideEpisode[], origins: Set<string> } => {
  const { episodes, runLengthFrom, runLength } = options
  const voted = new Set(runLengthFrom.map(originOf))
  const byVote = episodes.filter(episode => voted.has(episode.origin))
  if (byVote.length) return { reference: byVote, origins: voted }

  const byOrigin = new Map<string, SideEpisode[]>()
  for (const episode of episodes) byOrigin.set(episode.origin, [...byOrigin.get(episode.origin) ?? [], episode])
  const origins = new Set<string>()
  for (const origin of [...byOrigin.keys()].sort(compare)) {
    const own = byOrigin.get(origin)!
    if (!own.some(episode => episode.number !== null)) continue
    if (numbersOutsideRun(own, runLength)) continue
    origins.add(origin)
  }
  return { reference: episodes.filter(episode => origins.has(episode.origin)), origins }
}

/**
 * `plugin:range`, P4 of 5.4.
 *
 * Consumes `Cluster`, `MEMBER_OF`, `LINK` (`PART_OF`), `HAS_EPISODE`, `Episode`, `EpisodeProfile` and
 * `MediaProfile`; produces `EPISODE_LINK` `SAME_AS` and `LINK` `INCLUDES`; `after: [plugin:aggregate,
 * plugin:containment]`, because the run length, the membership and the `span` reason it scans for are
 * all written by those two.
 */
export const rangePlugin: Plugin = {
  id: 'plugin:range',
  consumes: {
    nodes: ['Cluster', 'Episode', 'EpisodeProfile', 'MediaProfile'],
    edges: ['MEMBER_OF', 'LINK', 'HAS_EPISODE', 'EPISODE_CLAIMS'],
    kinds: ['PART_OF'],
  },
  produces: { nodes: [], edges: ['LINK', 'EPISODE_LINK'], kinds: ['INCLUDES'] },
  after: ['plugin:aggregate', 'plugin:containment'],
  version: RANGE_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    type Row = Record<string, unknown>
    const [clusterRows, memberRows, ourRows, seasonRows, lendRows, claimRows, placedRows, attachedRows] = await Promise.all([
      ctx.query<Row>(CLUSTER_SCAN),
      ctx.query<Row>(MEMBER_SCAN),
      ctx.query<Row>(OURS_SCAN),
      ctx.query<Row>(SEASON_SCAN),
      ctx.query<Row>(LEND_SCAN),
      ctx.query<Row>(EPISODE_CLAIM_SCAN),
      ctx.query<Row>(MEMBER_EPISODE_SCAN),
      ctx.query<Row>(ATTACHED_EPISODE_SCAN),
    ])

    const members = new Map<string, Set<string>>()
    for (const row of memberRows) {
      const id = String(row.id)
      members.set(id, (members.get(id) ?? new Set<string>()).add(String(row.uri)))
    }

    const ours = new Map<string, SideEpisode[]>()
    for (const row of ourRows) {
      const id = String(row.runCluster)
      ours.set(id, [...ours.get(id) ?? [], episodeOf(row)])
    }

    // CLASS 1, grouped by (cluster, season): two members of one run claiming the same season is one
    // candidate reached twice, and the `INCLUDES` it may mint is one edge whatever the claims say
    const seasons = new Map<string, Candidate>()
    for (const row of seasonRows) {
      const key = `${String(row.runCluster)}\u0000${String(row.seasonUri)}`
      const candidate = seasons.get(key) ?? {
        clusterId: String(row.runCluster),
        kind: 'season' as const,
        seasonUri: String(row.seasonUri),
        memberUri: String(row.memberUri),
        via: [],
        theirCount: asNumber(row.theirCount),
        retranslates: row.retranslates === true,
        episodes: [],
      }
      const via = asText(row.via)
      if (via && !candidate.via.includes(via)) candidate.via.push(via)
      // the `INCLUDES` points at the member the claim came from, and the lowest uri when several did
      if (compare(String(row.memberUri), candidate.memberUri ?? '') < 0) candidate.memberUri = String(row.memberUri)
      if (!candidate.episodes.some(episode => episode.uri === String(row.uri))) candidate.episodes.push(episodeOf(row))
      seasons.set(key, candidate)
    }
    // SORTED, and this is not a tidy-up. Two `PART_OF` rows can reach one season (`plugin:direct`'s
    // `asserted` and `plugin:containment`'s `span`), the scan returns a row per link per episode, and
    // the engine's order inside one ORDER BY tie is not stable between passes. Unsorted, `supports`
    // then flips between two spellings of the same list and the writer rewrites every edge derived
    // from it on every iteration, which the pass reports as `fixed-point-cap` (measured 2026-09-12:
    // 11 `EPISODE_LINK` rows rewritten per iteration, on about half of the runs)
    for (const candidate of seasons.values()) candidate.via.sort(compare)

    // CLASS 2, grouped by (cluster, claimer): a lend has no row of its own to key on
    const lends = new Map<string, Candidate>()
    for (const row of lendRows) {
      const key = `${String(row.runCluster)}\u0000${String(row.claimer)}`
      const candidate = lends.get(key) ?? {
        clusterId: String(row.runCluster),
        kind: 'lend' as const,
        seasonUri: null,
        memberUri: String(row.memberUri),
        via: [],
        theirCount: null,
        retranslates: RETRANSLATING_ORIGINS.has(String(row.claimer)),
        episodes: [],
      }
      if (!candidate.episodes.some(episode => episode.uri === String(row.uri))) candidate.episodes.push(episodeOf(row))
      lends.set(key, candidate)
    }

    const links: LinkProposal[] = []
    const episodeLinks: EpisodeLinkProposal[] = []
    let dated = 0
    let titled = 0
    let sequenced = 0
    let refused = 0

    for (const cluster of clusterRows) {
      const clusterId = String(cluster.id)
      const runLength = asNumber(cluster.runLength)
      if (runLength === null || runLength < 1) continue
      const inside = members.get(clusterId) ?? new Set<string>()
      const episodes = ours.get(clusterId) ?? []
      // the reference is the members whose own count equals the length, which is the set
      // `plugin:aggregate` already wrote as `runLengthFrom` (`consensus.ts:265-273`, 5.4 P5), and,
      // where not one of those lists an episode, the members that do (`referenceEpisodes`)
      const { reference, origins: referenceOrigins } =
        referenceEpisodes({ episodes, runLengthFrom: listOf(cluster.runLengthFrom), runLength })

      const candidates: Candidate[] = []
      for (const candidate of seasons.values()) {
        if (candidate.clusterId !== clusterId) continue
        // a candidate that is a MEMBER is class 3's business: an `INCLUDES` between two rows of one
        // cluster is the invariant of 3.5 rather than a range
        if (candidate.seasonUri && inside.has(candidate.seasonUri)) continue
        candidates.push(candidate)
      }
      for (const candidate of lends.values()) {
        if (candidate.clusterId === clusterId) candidates.push(candidate)
      }
      // CLASS 3: every member origin that is not a reference and does not number 1 to runLength
      const byOrigin = new Map<string, SideEpisode[]>()
      for (const episode of episodes) {
        if (referenceOrigins.has(episode.origin)) continue
        byOrigin.set(episode.origin, [...byOrigin.get(episode.origin) ?? [], episode])
      }
      for (const origin of [...byOrigin.keys()].sort(compare)) {
        const own = byOrigin.get(origin)!
        if (!numbersOutsideRun(own, runLength)) continue
        candidates.push({
          clusterId,
          kind: 'member',
          seasonUri: null,
          memberUri: null,
          via: [],
          theirCount: own.length,
          retranslates: RETRANSLATING_ORIGINS.has(origin),
          episodes: own,
        })
      }

      for (const candidate of candidates.sort((a, b) =>
        compare(a.kind, b.kind) || compare(a.seasonUri ?? '', b.seasonUri ?? '')
        || compare(a.episodes[0]?.uri ?? '', b.episodes[0]?.uri ?? ''))) {
        const verdict = decideCandidate({ runLength, reference, candidate })
        if (!verdict.ok) {
          refused += 1
          ctx.log({
            level: 'info',
            rule: `range:${verdict.reason}`,
            detail: `${candidate.kind} candidate of ${clusterId} proved nothing`,
            uris: candidate.seasonUri ? [candidate.seasonUri] : candidate.episodes.slice(0, 1).map(episode => episode.uri),
          })
          // the refusal rides the `LINK` that reached the candidate, so "why no Netflix" is a query
          // (5.4 P4). A lend and a member candidate have no such row, and neither gets one: a plugin
          // may not invent an edge to carry its own silence
          if (candidate.kind !== 'season' || !candidate.seasonUri || !candidate.memberUri) continue
          links.push({
            kind: 'INCLUDES',
            fromUri: candidate.seasonUri,
            toUri: candidate.memberUri,
            status: 'refused',
            reason: verdict.reason,
            confidence: 1,
            evidence: { reason: verdict.reason, theirs: candidate.theirCount, ours: runLength },
            supports: candidate.via,
          })
          continue
        }

        if (verdict.rule === 'dates') dated += verdict.pairs.length - (verdict.gaps ?? 0)
        else if (verdict.rule === 'titles') titled += verdict.pairs.length
        else sequenced += verdict.pairs.length
        titled += verdict.gaps ?? 0
        for (const pair of verdict.pairs) {
          episodeLinks.push({
            fromUri: pair.from.uri,
            toUri: pair.to.uri,
            // THE ROW SAYS WHICH RULE PLACED IT, not which rule decided the candidate. A gap closure
            // rides a `dates` verdict and is proven by an equality, so a trace that read the verdict
            // alone would print `dates` over a row no date reached (3.2)
            reason: ruleOfPair(pair, verdict.rule),
            confidence: verdict.rule === 'dates' ? 1 : verdict.coverage,
            evidence: pair.evidence,
            fromNumber: pair.fromNumber,
            toNumber: pair.toNumber,
            supports: [pair.from.hung, pair.to.hung, ...candidate.via].filter(Boolean),
          })
        }

        // THE RANGE, and only when the candidate is a row that is LONGER than the run: a season of
        // eight inside a run of twelve is proven episode by episode and labels nothing (8.2), and a
        // lend has no row to hang a label off at all (4.4)
        const total = candidate.theirCount ?? candidate.episodes.length
        if (candidate.kind !== 'season' || !candidate.seasonUri || !candidate.memberUri) continue
        if (total <= runLength) continue
        const hull = hullOf(verdict.pairs, total)
        if (!hull) continue
        links.push({
          kind: 'INCLUDES',
          fromUri: candidate.seasonUri,
          toUri: candidate.memberUri,
          reason: verdict.rule,
          confidence: verdict.rule === 'dates' ? 1 : verdict.coverage,
          // a sequence range carries the SHAPE of its alignment, since "why these rows" is a
          // different question from "how many", and the two counts behind it are what answer it
          evidence: { rule: verdict.rule, theirs: total, ours: runLength, ...verdict.sequence ?? {} },
          supports: candidate.via,
          range: hull,
        })
      }
    }

    // THE FOURTH INPUT (5.4 P4): a source's own episode `SAME_AS`, PLACED rather than proven. It runs
    // after the rules because a pair the dates or the titles demonstrated is the stronger row and
    // keys identically (`from`, `to`, `by`): an assertion may not overwrite a proof.
    const placementOf = (rows: Row[]): Map<string, string[]> => {
      const places = new Map<string, string[]>()
      for (const row of rows) {
        const uri = String(row.uri)
        const clusterId = String(row.clusterId)
        const held = places.get(uri) ?? []
        if (!held.includes(clusterId)) places.set(uri, [...held, clusterId])
      }
      return places
    }
    const placed = placementOf(placedRows)
    const attached = placementOf(attachedRows)
    const placeOf = (uri: string): Placement => ({ members: placed.get(uri) ?? [], attached: attached.get(uri) ?? [] })

    // grouped by PAIR, because two sources can claim one pair of rows and the edge is one edge; its
    // `supports` then names both claims, sorted for the reason the candidate scan sorts its own
    const claims = new Map<string, { fromUri: string, toUri: string, fromNumber: number | null, toNumber: number | null, keys: string[] }>()
    const proven = new Set(episodeLinks.map(link => `${link.fromUri} ${link.toUri}`))
    for (const row of claimRows) {
      const fromUri = String(row.fromUri)
      const toUri = String(row.toUri)
      // a row is not a pair with itself, which is guard `self` of 5.2 at episode scale (`db.ts:283-286`)
      if (fromUri === toUri) continue
      const key = `${fromUri} ${toUri}`
      if (proven.has(key)) continue
      const claim = claims.get(key) ?? {
        fromUri, toUri, fromNumber: asNumber(row.fromNumber), toNumber: asNumber(row.toNumber), keys: [],
      }
      const claimKey = asText(row.claimKey)
      if (claimKey && !claim.keys.includes(claimKey)) claim.keys.push(claimKey)
      claims.set(key, claim)
    }

    let asserted = 0
    let foreign = 0
    for (const claim of [...claims.values()].sort((a, b) => compare(a.fromUri, b.fromUri) || compare(a.toUri, b.toUri))) {
      const ok = placesClaim(placeOf(claim.fromUri), placeOf(claim.toUri))
      if (ok) asserted += 1
      else foreign += 1
      episodeLinks.push({
        fromUri: claim.fromUri,
        toUri: claim.toUri,
        status: ok ? 'active' : 'refused',
        reason: ok ? 'asserted' : 'foreign-episode',
        confidence: 1,
        fromNumber: claim.fromNumber,
        toNumber: claim.toNumber,
        supports: [...claim.keys].sort(compare),
      })
    }

    if (dated || titled || sequenced || refused || asserted || foreign) {
      ctx.log({
        level: 'info',
        rule: 'range',
        detail: `${dated} pairs by date, ${titled} by title, ${sequenced} by sequence, `
          + `${refused} candidates refused, ${asserted} claims asserted, ${foreign} refused as foreign`,
      })
    }

    return {
      // THE 2C HOOK: with no `delta` there is no dirty set of run clusters, so the scan is the whole
      // graph and the scope is what it recomputed, which is all of it
      scope: { full: true },
      nodes: [],
      edges: [],
      links,
      episodeLinks,
    }
  },
}
