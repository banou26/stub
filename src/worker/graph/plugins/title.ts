/**
 * `plugin:title`, P3 of 5.4: two clusters that agree on a title, and what that agreement is allowed
 * to do.
 *
 * IT IS THE FUZZY PASS MOVED, NOT REWRITTEN. Every threshold, the tier selection, the trailing-number
 * rule, the companion rule and the similarity call come from `src/worker/store/fuzzy-merge.ts` and
 * `src/sources/utils.ts` BY IMPORT, so while both passes exist they cannot disagree about what 0.9
 * means. What is NEW is the record: the old pass returned a boolean and left nothing behind, and this
 * one writes the verdict, the four gate outcomes and the evidence onto the `LINK` row (2.2, 5.2), so
 * "why are these one card" and "why are these two" are both queries.
 *
 * WHAT IT PROPOSES, AND WHAT IT NEVER DECIDES. It proposes `SAME_AS` and nothing else. A verdict
 * between a run cluster and a container cluster is proposed exactly the same way, and the WRITER
 * downgrades it to `PART_OF` reason `cross-scope` (5.2): "a title match between a run and a show is a
 * guess at containment, so it rides an edge, never a union: the edge can be deleted, a union cannot"
 * (`fuzzy-merge.ts:660-666`). Whether a proposal becomes an edge is the guards' call, which is what
 * lets them add what the fuzzy pass never had (disagreeing ids, the count veto, the contained check),
 * except the two refusals between two shows that `refusedJoins` writes before they are asked.
 *
 * WHAT IT PROMISES. Same graph, same scope, same output: every scan is ordered, every set the gates
 * read is a function of the cluster's members rather than of their arrival order, the six titles are
 * selected by the measured rule (`fuzzy-merge.ts:215-219`), and the pair is ordered before it is
 * compared so the evidence names the same two titles whichever side the scan reached first.
 *
 * THE STICKY HALF, and the reason it is not optional here. An active `SAME_AS` this plugin wrote has
 * already been spent: `plugin:aggregate` closed over it, so its two clusters ARE one cluster by the
 * next iteration and the pair it was derived from no longer exists to be re-derived. The writer's
 * desired set is the whole of what this plugin owns, so a link it does not re-propose is DELETED,
 * the clusters split, the pair reappears, and the pass oscillates until the cap. So every active
 * `SAME_AS` this plugin owns is re-proposed from the row it already wrote, with its own evidence and
 * gates, and the guards weigh it again: "an active SAME_AS is re-checked against guards 2 and 4 to 9
 * and retracted only when a guard now fails... Profile drift never retracts: a title link whose pair
 * no longer clears 0.9 after a member's titles changed stays active" (5.2, the sticky rule).
 *
 * THE DELTA. A run decides only the pairs a cluster is in whose profile moved since the last run, and
 * keeps every other pair's verdict from that run (`lastRun`). A verdict reads its two profiles and
 * nothing else, so a pair whose two profiles stand has the verdict it had. The output is still the
 * whole desired set, every match decided or kept, so the scope stays full and the writer's diff is
 * unchanged. The exact scan is the anchored one of 5.4 P3 with `$clusters` being the moved ids.
 *
 * THE SECOND CANDIDATE AXIS, and the only thing here that does not go through a year bucket. A
 * catalogue's show row carries the SHOW's title and the SHOW's date, and a show's date is its FIRST
 * run's, so every later run of every multi-run show sat in a different bucket from its own show and
 * attached to no streaming container at all. `containerKeyOf` reads the show title out of a run title
 * that carries a season marker of 2 or more, and gate 3 goes silent for exactly that pair, because a
 * show's debut and a second season's premiere are two different runs' dates and the 45 days were
 * never a figure about those. Both are narrow on purpose and both are measured
 * (`scripts/calibrate-container-ordinal.test.ts`).
 *
 * THE KNOWN GAP SURVIVES, deliberately. Both silent-side vetoes only ever block on a DISAGREEMENT, so
 * `86` and `86 Part 2`, one naming a season and one not, both dated by a year alone, still weld on
 * their shared label. Closing it costs one wrong weld stopped per 37 correct merges destroyed
 * (`fuzzy-merge.ts:405-427`), and the broadcast-quarter veto that would reach 583 of 1,095 such pairs
 * is unmeasured for cost. It is pinned as a gap in `tests/unit/worker/graph/plugins/title.test.ts`.
 */
import type { Gate, LinkProposal, Plugin, PluginContext, PluginOutput } from './contract'

import { parseSeasonNumber, SEASON_MARKER } from '../../../sources/season'
import { stripTitle } from '../../../sources/utils'
import {
  differOnlyByTrailingNumber, namesCompanionContent, selectByScore,
  SIMILARITY_THRESHOLD, START_DATE_WINDOW_DAYS,
} from '../../store/fuzzy-merge'
import { disagree } from './guards'

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const TITLE_VERSION = 3

/** The ordinal at which a run stops being the one a show's own date is about. Two, and never one. */
export const LATER_RUN_ORDINAL = 2

/**
 * The ORDINAL AXIS: the container title a run key names, or nothing when the key names no later run.
 *
 * WHAT IT IS FOR. A catalogue's show row carries the SHOW's title and the SHOW's date, and the show's
 * date is its FIRST run's. So `jw:222366` is "Mushoku Tensei: Jobless Reincarnation", dated
 * 2021-01-11, and every later run of that show sits in a different year bucket from it and 903 days
 * away from it. The year bucket of gate 0 never pairs them and gate 3 would refuse them if it did, so
 * the second, third and fourth run of EVERY multi-run show attached to no JustWatch, no Netflix and
 * no Disney row at all. This is the second axis the same cause needed, `pickContainingSeason`'s
 * ordinal reading being the first (5.4 P5).
 *
 * THREE CONDITIONS, each priced separately over the manami database (41537 records, 2026-27,
 * `scripts/calibrate-container-ordinal.test.ts`):
 * - the key reads an ordinal of 2 or more, so a first run never takes this route and keeps the year
 *   bucket as its only one. Dropping the floor to 1 raises the cross-franchise count 360 to 370 while
 *   buying nothing the bucket does not already pair.
 * - removing the season markers has to CHANGE the key. This one buys NOTHING measurable there, and
 *   the harness says so: allowing it adds 16 pairs and 0 cross-franchise pairs. It is kept because
 *   the pairs it admits are a key naming ITSELF, which is a run and a container agreeing on a title
 *   ACROSS two year buckets, and manami holds no container rows for that shape to be priced against.
 *   The keys that reach it are a bare `N期` or `N기`, which `parseSeasonNumber` reads and
 *   `SEASON_MARKER` deliberately declines to delete.
 * - what is left is not empty, since a title that is nothing but a season label names a POSITION and
 *   never a show (`isOnlySeasonLabel`, and it is what welded Grand Blue into Mushoku Tensei once).
 *
 * WHAT IT COSTS, under one identical non-lexical label (manami's `related` graph, unioned over shared
 * source urls, which has no title in it anywhere): 5,946 pairs of which 360 cross a franchise, 6.05%.
 * The exact-key route this store already ships scores 71.58% on the same corpus under the same label
 * and the same route with the year bucket removed scores 97.54%, so the axis is an order of magnitude
 * cleaner than the mechanism it sits beside rather than a widening of it. The corpus model is wider
 * than production in both directions that matter (every synonym is a key where a cluster ships six,
 * and every record is an available container where a real container is one show-level row out of a
 * handful of catalogues), so 6.05% is an upper bound.
 */
export const containerKeyOf = (key: string): string | undefined => {
  const ordinal = parseSeasonNumber(key)
  if (ordinal === undefined || ordinal < LATER_RUN_ORDINAL) return undefined
  const stripped = stripTitle(SEASON_MARKER.reduce((text, marker) => text.replace(marker, ' '), key))
  if (!stripped || stripped === key) return undefined
  return stripped
}

/** One title key of one member, as `plugin:profile` wrote it into the JSON `titleKeys` (2.2). */
type TitleKeyEntry = { key: string, score: number | null, class: string }

/** One member of one cluster: its cluster, and the profile columns the gates read (5.4 P3). */
export type TitleMemberRow = {
  cluster: string
  clusterScope: string
  uri: string
  memberScope: string | null
  dateSubject: string | null
  titleKeys: unknown
  year: number | null
  startDay: number | null
  format: string | null
  workKind: string | null
  seasonOrdinal: number | null
  partOrdinal: number | null
  companion: boolean | null
}

/**
 * Everything the decision reads off one cluster, and nothing that depends on the order of its members.
 *
 * The five sets are the fuzzy pass's `ClusterProfile` fields under their new names (`titles`,
 * `formats`, `seasons`, `days`, `types`), read off `MediaProfile` instead of off `Media.raw`.
 */
export type ClusterTitleProfile = {
  id: string
  scope: 'RUN' | 'CONTAINER'
  /**
   * The member a link is made THROUGH: the lowest uri whose own scope is the cluster's. A cluster
   * holding a row that was unioned as a run and has flipped CONTAINER since is scoped RUN, and
   * linking through its container member is how two runs that agreed on title and year could never
   * union (`fuzzy-merge.ts:103-109`).
   */
  linkUri: string
  /** The six of `MAX_TITLES_PER_CLUSTER`, by score descending then title ascending within a tier. */
  titles: string[]
  keys: Set<string>
  years: Set<number>
  days: Set<number>
  formats: Set<string>
  workKinds: Set<string>
  seasons: Set<number>
  /** Whether any member title ends in a companion marker: the cheap half of gate 4's premise. */
  companion: boolean
  /**
   * The container titles this cluster's own titles name, by `containerKeyOf`: empty for a container
   * cluster, and empty for a run that declares no ordinal of 2 or more in any of its six titles.
   */
  containerKeys: Set<string>
  /**
   * Whether this cluster says it is the show's second run or later, which is the premise gate 3 needs
   * and the only thing that makes a container's date incomparable rather than merely distant.
   */
  laterRun: boolean
}

/**
 * What a verdict or a pairing reads off one cluster, which is the whole profile, every set in one order
 * whatever order the members filled it in: two runs that see the same fingerprints for both clusters
 * of a pair reach the same verdict about it (`lastRun`).
 */
export const fingerprintOf = (profile: ClusterTitleProfile): string =>
  JSON.stringify(profile, (_, value: unknown) => (value instanceof Set ? [...value].map(String).sort() : value))

/** The four gates 2.2 keeps on the row, in the order 5.4 P3 lists them. */
export type TitleGates = { format: Gate, season: Gate, date: Gate, companion: Gate }

/** Which gate refused, if one did: the `reason` a refused row is written with. */
export type TitleGateName = keyof TitleGates

/**
 * The two titles a pair matched on, what they scored, and WHICH ROUTE agreed.
 *
 * `via` is `title` for the two the fuzzy pass has always had, an identical key or a 0.9 alignment, and
 * `ordinal` when `titleA`'s season marker had to come off before the two keys were identical, which
 * is a run naming its own show (`containerKeyOf`). A reader of the row can tell the two apart, and so
 * can the confidence: an ordinal match is an EXACT agreement on the stripped key, never an alignment.
 */
export type TitleMatch = {
  titleA: string
  titleB: string
  similarity: number
  exact: boolean
  via?: 'title' | 'ordinal'
}

/** One pair's verdict, exactly as it is kept and as it is emitted. */
export type TitleDecision = {
  gates: TitleGates
  refusedBy: TitleGateName | null
  match: TitleMatch | undefined
  year: number | null
  daysDelta: number | null
}

const GATE_ORDER: TitleGateName[] = ['format', 'season', 'date', 'companion']

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

const asText = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)
const asNumber = (value: unknown): number | null =>
  value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

/** The MAIN keys of one member, off the JSON column. Only MAIN exists today, and only MAIN is read. */
const keysOf = (value: unknown): TitleKeyEntry[] => {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed)) return []
  const entries: TitleKeyEntry[] = []
  for (const entry of parsed as Record<string, unknown>[]) {
    const key = asText(entry?.key)
    if (!key) continue
    const entryClass = asText(entry?.class) ?? 'MAIN'
    if (entryClass !== 'MAIN') continue
    entries.push({ key, score: asNumber(entry?.score), class: entryClass })
  }
  return entries
}

/**
 * The clusters as the decision reads them, grouped from one ordered scan.
 *
 * YEARS AND DAYS COME FROM THE MEMBERS THE DATES ARE ABOUT, which is `dateSubject` (5.4 P0): a RUN
 * cluster reads its run-subject members, so a container member's premiere never buckets a run, and a
 * CONTAINER cluster reads its container-subject members, which are the only dates it has. 5.4 P3
 * states the first half ("from RUN-scoped members only"); reading nothing at all for a container
 * cluster would delete the run-to-show attach the record requires and the container badges it feeds
 * (`linkPartOfPairs`, `fuzzy-merge.ts:656-666`), so the rule is stated here as the subject rather
 * than as the scope.
 *
 * Every other set is read from EVERY member, exactly as `profileCluster` reads them.
 */
export const profileClusters = (rows: TitleMemberRow[]): Map<string, ClusterTitleProfile> => {
  const grouped = new Map<string, TitleMemberRow[]>()
  for (const row of rows) {
    const members = grouped.get(row.cluster)
    if (members) members.push(row)
    else grouped.set(row.cluster, [row])
  }

  const profiles = new Map<string, ClusterTitleProfile>()
  for (const [id, members] of grouped) {
    const scope = members.every(member => member.clusterScope === 'CONTAINER') ? 'CONTAINER' : 'RUN'
    const subject = scope === 'CONTAINER' ? 'container' : 'run'
    const bestScore = new Map<string, number>()
    const years = new Set<number>()
    const days = new Set<number>()
    const formats = new Set<string>()
    const workKinds = new Set<string>()
    const seasons = new Set<number>()
    let companion = false
    for (const member of members) {
      for (const entry of keysOf(member.titleKeys)) {
        const score = entry.score ?? -1
        const current = bestScore.get(entry.key)
        if (current === undefined || score > current) bestScore.set(entry.key, score)
      }
      if (member.dateSubject === subject) {
        const year = asNumber(member.year)
        const day = asNumber(member.startDay)
        if (year !== null) years.add(year)
        if (day !== null) days.add(day)
      }
      const format = asText(member.format)
      const workKind = asText(member.workKind)
      // ONE ordinal per member, the season when the titles named one and the part otherwise. The
      // fuzzy pass has a single set built by `parseSeasonNumber` over every raw title, which reads
      // "Part 2" as 2 exactly as it reads "Season 2" (`fuzzy-merge.ts:326-332`), and 5.4 P0 split
      // that one reading into two columns; taking the season first is the leftmost match the one
      // parser made, and falling back to the part is what keeps "Mushoku Tensei Part 2" an ordinal
      // rather than a silence, which is the whole of the gate's benefit on split cours
      const season = asNumber(member.seasonOrdinal) ?? asNumber(member.partOrdinal)
      if (format) formats.add(format)
      if (workKind) workKinds.add(workKind)
      if (season !== null) seasons.add(season)
      if (member.companion === true) companion = true
    }
    const titles = selectByScore(bestScore)
    // THE ORDINAL AXIS is read off the SIX, never off every key the cluster holds, because the six are
    // what every other rule here compares and a seventh title naming a container nothing else can see
    // would make the pair depend on a title the evidence never names
    const containerKeys = new Set<string>()
    if (scope === 'RUN') {
      for (const title of titles) {
        const container = containerKeyOf(title)
        if (container) containerKeys.add(container)
      }
    }
    const uris = members.map(member => member.uri).sort(compare)
    const linkUri =
      members
        .filter(member => (member.memberScope === 'CONTAINER' ? 'CONTAINER' : 'RUN') === scope)
        .map(member => member.uri)
        .sort(compare)[0] ?? uris[0]!
    profiles.set(id, {
      id,
      scope,
      linkUri,
      titles,
      keys: new Set(titles),
      years,
      days,
      formats,
      workKinds,
      seasons,
      companion,
      containerKeys,
      laterRun: [...seasons].some(season => season >= LATER_RUN_ORDINAL),
    })
  }
  return profiles
}

const disjoint = <T>(a: Set<T>, b: Set<T>): boolean => ![...a].some(entry => b.has(entry))

/**
 * The RUN of a run-against-container pair whose two dates are about DIFFERENT RUNS, or nothing.
 *
 * A container's start day is its first run's premiere, because that is the only date a show-level row
 * has: `jw:222366` is dated 2021-01-11, which is when Mushoku Tensei's FIRST season started. Against a
 * cluster that says it is the show's second run or later, the 45 day window is therefore being asked
 * to compare two different runs' premieres, which is a question it was never calibrated on: the 45
 * days are `measure-start-date-window`'s figure for how far apart two sources place ONE run.
 *
 * So gate 3's PREMISE fails there and the gate is silent, which is this file's own reading of silence
 * ("a gate whose rule needs both sides to say something and meets a side that says nothing has
 * NOTHING TO SAY"). It is not a widened window: every other pair, a first run included, still meets
 * the 45 days unchanged, and a first run's date and its show's date are the same date anyway.
 *
 * THE RUN HAS TO NAME THAT CONTAINER, and the premise above is why rather than a tightening bolted on
 * top of it: "a container's start day is its first run's premiere" is a fact about THE CONTAINER THE
 * RUN BELONGS TO, and says nothing about a container the run merely shares a year bucket with. Keyed
 * on the run alone the gate fell silent for every container a later run could reach, so a cluster
 * declaring season 2 had the 45 days lifted against an unrelated show it reached at 0.9, and one
 * ordinal on a title neither gate reads was the whole difference between `refused date` and a weld.
 * Measured as `negative-control.probe.ts` NC3: 181 days apart, similarity 0.908, and the run names
 * `totally other show`. The naming test is `ordinalMatch`'s, so the gate is silent over exactly the
 * pairs the ordinal axis is willing to propose.
 */
export const laterRunAgainstContainer = (
  a: ClusterTitleProfile,
  b: ClusterTitleProfile
): ClusterTitleProfile | undefined => {
  const names = (run: ClusterTitleProfile, container: ClusterTitleProfile) =>
    [...run.containerKeys].some(key => container.keys.has(key))
  if (a.scope === 'RUN' && b.scope === 'CONTAINER' && a.laterRun && names(a, b)) return a
  if (b.scope === 'RUN' && a.scope === 'CONTAINER' && b.laterRun && names(b, a)) return b
  return undefined
}

/**
 * The four gates of 5.4 P3 that are recorded, each as `passed`, `refused` or `silent`.
 *
 * SILENCE IS THE PREMISE FAILING, never a verdict: a gate whose rule needs both sides to say
 * something and meets a side that says nothing has NOTHING TO SAY, and saying it is what keeps
 * "silence never blocks" readable off the row instead of inferable from its absence. Making silence
 * block was modelled and refused at 323 wrong welds against 12,007 correct merges, one per 37
 * (`fuzzy-merge.ts:405-427`).
 *
 * `passed` therefore covers both "they agree" and "they disagree and the rule does not fire on a
 * disagreement alone", which is gate 4: the marker alone destroys 77 correct merges and the type
 * disagreement alone 547, while the two together refuse 49 of 84 for 2 (`fuzzy-merge.ts:507-518`).
 */
export const gatesFor = (a: ClusterTitleProfile, b: ClusterTitleProfile): TitleGates => ({
  format:
    a.formats.size && b.formats.size ? (disjoint(a.formats, b.formats) ? 'refused' : 'passed') : 'silent',
  season:
    a.seasons.size && b.seasons.size ? (disjoint(a.seasons, b.seasons) ? 'refused' : 'passed') : 'silent',
  date:
    a.days.size && b.days.size && !laterRunAgainstContainer(a, b)
      ? ([...a.days].some(dayA => [...b.days].some(dayB => Math.abs(dayA - dayB) <= START_DATE_WINDOW_DAYS))
        ? 'passed'
        : 'refused')
      : 'silent',
  companion:
    a.workKinds.size && b.workKinds.size
      ? (disjoint(a.workKinds, b.workKinds) && (a.companion || b.companion)
        && namesCompanionContent(a.titles, b.titles)
        ? 'refused'
        : 'passed')
      : 'silent',
})

/**
 * Gate 5, the title itself: the first pair of the two sixes that agrees, in one fixed order.
 *
 * Two skips before the wasm call, both measured. A trailing number is compared as a VALUE, because
 * `yami shibai 16` against `17` scores 0.8849 while `onii-chan!` against `oniichan` scores 1.0 and no
 * threshold tells them apart (`differOnlyByTrailingNumber`). `maxPossibleSimilarity` is a ceiling by
 * character count, so a pair that cannot reach 0.9 never pays for an alignment (measured, not exact:
 * see its doc).
 *
 * The scorers come from the context rather than from an import, which is the contract's rule: every
 * plugin prices a pair the way the record measured it (`PluginContext.titleSimilarity`).
 */
export const titleMatch = async (
  a: ClusterTitleProfile,
  b: ClusterTitleProfile,
  ctx: Pick<PluginContext, 'titleSimilarity' | 'maxPossibleSimilarity'>
): Promise<TitleMatch | undefined> => {
  for (const titleA of a.titles) {
    for (const titleB of b.titles) {
      if (titleA === titleB) return { titleA, titleB, similarity: 1, exact: true }
      if (differOnlyByTrailingNumber(titleA, titleB)) continue
      if (ctx.maxPossibleSimilarity(titleA, titleB) < SIMILARITY_THRESHOLD) continue
      const similarity = await ctx.titleSimilarity(titleA, titleB)
      if (similarity >= SIMILARITY_THRESHOLD) return { titleA, titleB, similarity, exact: false }
    }
  }
  return ordinalMatch(a, b)
}

/**
 * The ordinal route, tried only once the two loops above have found nothing.
 *
 * LAST rather than first, and that ordering is the whole of its safety: a pair the fuzzy pass already
 * answers keeps the answer it had, byte for byte, so this can only ever ADD a match where there was
 * none. It fires for a RUN against a CONTAINER and for nothing else, since a run naming its own show
 * is the only relation `containerKeyOf` states, and it reads the run's titles in the cluster's own
 * order so the pair has one answer whichever side the scan reached first.
 *
 * WHAT SURVIVES ONTO THE ROW, which is less than what is returned here, and deliberately. A run
 * against a container is guard 2's `cross-scope` every time, so the writer's downgrade replaces both
 * the reason and the evidence with the guard's (`sameness.ts` `rowsForVerdict`) and the `PART_OF` it
 * writes reads `cross-scope`, exactly as a 0.9 alignment between the same two would. What IS on the
 * row is the `gates` column, where the date reads `silent`, and the confidence of 1. So the route is
 * read off `proposalFor` in a test rather than off the table, and that is what its case asserts.
 */
const ordinalMatch = (a: ClusterTitleProfile, b: ClusterTitleProfile): TitleMatch | undefined => {
  const run = a.scope === 'RUN' && b.scope === 'CONTAINER' ? a
    : b.scope === 'RUN' && a.scope === 'CONTAINER' ? b
      : undefined
  if (!run || !run.containerKeys.size) return undefined
  const container = run === a ? b : a
  for (const titleA of run.titles) {
    const stripped = containerKeyOf(titleA)
    if (!stripped || !container.keys.has(stripped)) continue
    return { titleA, titleB: stripped, similarity: 1, exact: false, via: 'ordinal' }
  }
  return undefined
}

/**
 * The pair in the one order everything downstream reads it in.
 *
 * A run before a container, so the proposal the writer downgrades already points from the run to the
 * show; otherwise the lower `linkUri` first, which is the fuzzy pass's own link ordering and the
 * reason it is not the bucket's (`fuzzy-merge.ts:623-633`, "the SEQUENCE of unions decides root
 * survival"). The title loop, the evidence and the cache key all read this order, so a pair has one
 * verdict however the scan reached it.
 */
export const orderPair = (
  a: ClusterTitleProfile,
  b: ClusterTitleProfile
): [ClusterTitleProfile, ClusterTitleProfile] => {
  if (a.scope !== b.scope) return a.scope === 'RUN' ? [a, b] : [b, a]
  return compare(a.linkUri, b.linkUri) <= 0 ? [a, b] : [b, a]
}

/** The lowest year both clusters carry, which is the bucket the pair was compared in (gate 0). */
const sharedYear = (a: ClusterTitleProfile, b: ClusterTitleProfile): number | null => {
  let lowest: number | null = null
  for (const year of a.years) {
    if (!b.years.has(year)) continue
    if (lowest === null || year < lowest) lowest = year
  }
  return lowest
}

/** How far apart the two closest start days are, or nothing when either side named none (gate 3). */
const daysApart = (a: ClusterTitleProfile, b: ClusterTitleProfile): number | null => {
  let closest: number | null = null
  for (const dayA of a.days) {
    for (const dayB of b.days) {
      const delta = Math.abs(dayA - dayB)
      if (closest === null || delta < closest) closest = delta
    }
  }
  return closest
}

/**
 * One pair's verdict: the four gates, the title, and the two numbers the evidence carries.
 *
 * It reads the two profiles and the shared scorers and nothing else, which is what lets a run keep
 * the verdict of a pair whose two fingerprints did not move instead of deciding it again.
 */
export const decide = async (
  first: ClusterTitleProfile,
  second: ClusterTitleProfile,
  ctx: Pick<PluginContext, 'titleSimilarity' | 'maxPossibleSimilarity'>
): Promise<TitleDecision> => {
  const gates = gatesFor(first, second)
  // EVERY gate is evaluated even once one has refused, because all four are recorded and they are set
  // operations on sets this pass already holds. The title is evaluated too, and that is the one place
  // the cost argument of `fuzzy-merge.ts:8-11` is weighed again: a veto that blocked a pair whose
  // titles never matched refused NOTHING, and writing it as a refusal would fill the table with pairs
  // that share a year and nothing else. Only the pairs a veto actually saved are written, and the two
  // skips above keep the wasm call for the few whose titles could reach 0.9 anyway.
  return {
    gates,
    refusedBy: GATE_ORDER.find(gate => gates[gate] === 'refused') ?? null,
    match: await titleMatch(first, second, ctx),
    year: sharedYear(first, second),
    daysDelta: daysApart(first, second),
  }
}

/** One proposal as 5.4 P3 emits it: the evidence, the gates, the confidence and the two keys. */
export const proposalFor = (
  first: ClusterTitleProfile,
  second: ClusterTitleProfile,
  decision: TitleDecision
): LinkProposal | undefined => {
  if (!decision.match) return undefined
  const { titleA, titleB, similarity, exact, via } = decision.match
  return {
    kind: 'SAME_AS',
    fromUri: first.linkUri,
    toUri: second.linkUri,
    ...decision.refusedBy ? { status: 'refused' as const } : {},
    reason: decision.refusedBy ?? (via === 'ordinal' ? 'ordinal' : exact ? 'exact' : 'similar'),
    confidence: similarity,
    // `via` is written only for the ORDINAL route, so every evidence blob the fuzzy route has ever
    // written stays byte identical and a diff of this table shows the new axis alone
    evidence: {
      titleA, titleB, similarity, ...via === 'ordinal' ? { via } : {},
      year: decision.year, daysDelta: decision.daysDelta,
    },
    gates: decision.gates,
    // the two `HAS_KEY` keys, which for this edge table IS the title (`plugin:profile` keys a
    // `HAS_KEY` row on the key itself), so a trace descends from the link to the two rows that hold it
    supports: [titleA, titleB],
  }
}

const originOf = (uri: string): string => uri.slice(0, uri.indexOf(':'))
const noParent = () => null

/**
 * The title matches between two SHOWS that are written refused before the guards weigh them, by pair
 * key, with the reason. Only a match no gate refused is weighed. A title names no id, so:
 * - `disagreeing-ids`: the two shows already hold two ids of one space that are not one id. Guard 4
 *   cannot be left to refuse it, because its cut of a contested row excuses the very link that would
 *   contest the row: once Watchmode tied `tmdb:90282`, title-joined to Apple TV's The Morning Show, to
 *   IMDb tt7203552, Apple's link to tt10323334 went through and tore tt7203552's show in three.
 * - `ambiguous`: one show matches two shows whose ids disagree. Weighed one link at a time the guards
 *   let the arrival order pick, so it joins neither, unless one of the two is known to every
 *   catalogue that knows the other and to at least one more, and then it joins that one. Both are
 *   read as the clusters stand when the pass runs, and a link let through stays by the sticky rule
 *   whatever lands after it (pinned as a gap in `tests/unit/worker/graph/morning-show.test.ts`).
 *
 * Never between two runs: there the guards' downgrade is what hangs a folding season under each run it
 * holds, or a refused run on its rival, as a badge (5.2), and a refusal here would write none.
 */
export const refusedJoins = (
  matches: Map<string, { a: string, b: string, decision: TitleDecision }>,
  scopeOf: (cluster: string) => string,
  membersOf: (cluster: string) => string[]
): Map<string, 'disagreeing-ids' | 'ambiguous'> => {
  const clash = (left: string, right: string) =>
    membersOf(left).some(a => membersOf(right).some(b => disagree(a, b, noParent)))
  const outranks = (cluster: string, rival: string) => {
    const own = new Set(membersOf(cluster).map(originOf))
    const theirs = new Set(membersOf(rival).map(originOf))
    return own.size > theirs.size && [...theirs].every(origin => own.has(origin))
  }
  const refused = new Map<string, 'disagreeing-ids' | 'ambiguous'>()
  const candidates = new Map<string, string[]>()
  const joins: [string, string, string][] = []
  for (const [key, { a, b, decision }] of matches) {
    if (decision.refusedBy || scopeOf(a) !== 'CONTAINER' || scopeOf(b) !== 'CONTAINER') continue
    if (clash(a, b)) {
      refused.set(key, 'disagreeing-ids')
      continue
    }
    joins.push([key, a, b])
    candidates.set(a, [...candidates.get(a) ?? [], b])
    candidates.set(b, [...candidates.get(b) ?? [], a])
  }
  const contested = (hub: string, candidate: string) => (candidates.get(hub) ?? []).some(rival =>
    rival !== candidate && clash(candidate, rival) && !outranks(candidate, rival))
  for (const [key, a, b] of joins) if (contested(a, b) || contested(b, a)) refused.set(key, 'ambiguous')
  return refused
}

/** The one read of the clusters: every member, with the profile columns the gates read. */
export const MEMBER_SCAN =
  `MATCH (m:Media)-[:MEMBER_OF]->(c:Cluster)
   MATCH (p:MediaProfile)-[:PROFILE_OF]->(m)
   RETURN c.id AS cluster, c.scope AS clusterScope, m.uri AS uri, p.scope AS memberScope,
     p.dateSubject AS dateSubject, p.titleKeys AS titleKeys, p.year AS year, p.startDay AS startDay,
     p.format AS format, p.workKind AS workKind, p.seasonOrdinal AS seasonOrdinal,
     p.partOrdinal AS partOrdinal, p.companion AS companion
   ORDER BY cluster, uri`

/**
 * Candidate scan A of 5.4 P3, exact agreement: which clusters share a MAIN key inside one year bucket.
 *
 * One join through one `TitleKey` node rather than a pairwise loop, which is what `TitleKey` and
 * `HAS_KEY` exist for (2.2). Anchored on `$clusters` rather than self-joined over every `HAS_KEY`,
 * so it is a key lookup per moved cluster.
 *
 * The date subject is spelled out rather than fixed to `run` for the reason `profileClusters` gives:
 * the two forms have to agree about which members carry a cluster's year, or the exact scan and the
 * bucket would disagree about what a bucket is.
 */
export const EXACT_SCAN =
  `UNWIND $clusters AS cid
   MATCH (ca:Cluster {id: cid})<-[:MEMBER_OF]-(a:Media)-[:HAS_KEY {class: 'MAIN'}]->(t:TitleKey)<-[:HAS_KEY {class: 'MAIN'}]-(b:Media)-[:MEMBER_OF]->(cb:Cluster)
   WHERE cb.id <> ca.id
   MATCH (pa:MediaProfile)-[:PROFILE_OF]->(:Media)-[:MEMBER_OF]->(ca),
     (pb:MediaProfile)-[:PROFILE_OF]->(:Media)-[:MEMBER_OF]->(cb)
   WHERE pa.year IS NOT NULL AND pb.year = pa.year
     AND ((ca.scope = 'CONTAINER' AND pa.dateSubject = 'container') OR (ca.scope <> 'CONTAINER' AND pa.dateSubject = 'run'))
     AND ((cb.scope = 'CONTAINER' AND pb.dateSubject = 'container') OR (cb.scope <> 'CONTAINER' AND pb.dateSubject = 'run'))
   RETURN DISTINCT ca.id AS fromCluster, cb.id AS toCluster, t.key AS shared, pa.year AS year
   ORDER BY fromCluster, toCluster, shared`

/** The active `SAME_AS` rows this plugin already wrote: the sticky half, read back as proposals. */
const CARRY_SCAN =
  `MATCH (a:Media)-[l:LINK]->(b:Media)
   WHERE l.by = $by AND l.kind = 'SAME_AS' AND l.status = 'active'
   RETURN a.uri AS fromUri, b.uri AS toUri, l.reason AS reason, l.confidence AS confidence,
     l.evidence AS evidence, l.gates AS gates, l.supports AS supports
   ORDER BY fromUri, toUri`

const pairKey = (a: string, b: string): string => (compare(a, b) <= 0 ? `${a} ${b}` : `${b} ${a}`)

/**
 * What the last run saw and found: every cluster's fingerprint, and every pair whose titles matched.
 *
 * Whether two clusters are a pair at all (a shared year, or a run naming a container) is read off the
 * same two profiles as the verdict, so a pair whose two fingerprints are the ones held here was a pair
 * last run and has the verdict held here. A pair that matched nothing proposes nothing, so only the
 * matches are kept: a few hundred on a season page that holds 55,000 to 83,000 pairs.
 */
let lastRun = {
  fingerprints: new Map<string, string>(),
  matches: new Map<string, { a: string, b: string, decision: TitleDecision }>(),
}

/**
 * `plugin:title`, P3 of 5.4.
 *
 * Consumes `Cluster`, `MEMBER_OF`, `MediaProfile`, `TitleKey` and `HAS_KEY`; produces `LINK` of kind
 * `SAME_AS`, and `PART_OF` because that is what the writer's downgrade writes under this plugin's own
 * id (5.2). `after: [plugin:aggregate, plugin:containment]`: a cluster is what it compares, and the
 * containment edges are what guard 6 refuses it on.
 */
export const titlePlugin: Plugin = {
  id: 'plugin:title',
  consumes: { nodes: ['Cluster', 'MediaProfile', 'TitleKey'], edges: ['MEMBER_OF', 'HAS_KEY'] },
  produces: { nodes: [], edges: ['LINK'], kinds: ['SAME_AS', 'PART_OF'] },
  after: ['plugin:aggregate', 'plugin:containment'],
  version: TITLE_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    const rows = await ctx.query<TitleMemberRow>(MEMBER_SCAN)
    const profiles = profileClusters(rows)
    const members = new Map<string, string[]>()
    for (const row of rows) {
      const uris = members.get(row.cluster)
      if (uris) uris.push(row.uri)
      else members.set(row.cluster, [row.uri])
    }

    // THE DELTA, read off the profiles rather than off `ctx.delta`: that names what the iteration
    // before applied, and misses what `plugin:profile` and `plugin:aggregate` wrote earlier in this one
    const fingerprints = new Map([...profiles].map(([id, profile]) => [id, fingerprintOf(profile)]))
    const moved = new Set([...fingerprints.keys()].filter(id => lastRun.fingerprints.get(id) !== fingerprints.get(id)))
    const touches = (a: string, b: string) => moved.has(a) || moved.has(b)

    // THE YEAR BUCKETS of gate 0, built from the profiles this pass already holds rather than by
    // asking the engine for the same rows a second time. A cluster with no title is skipped, and a
    // cluster whose members all carry first-of-month dates still has a year and is bucketed, since
    // the year survives a coercion while `startDay` does not (5.4 P0)
    const buckets = new Map<number, string[]>()
    for (const profile of profiles.values()) {
      if (!profile.titles.length) continue
      for (const year of profile.years) {
        const bucket = buckets.get(year)
        if (bucket) bucket.push(profile.id)
        else buckets.set(year, [profile.id])
      }
    }

    // THE ORDINAL AXIS of `containerKeyOf`, which is the one thing here that does NOT go through a
    // year bucket. A container carries its first run's date, so a show and its later runs never share
    // a bucket and the bucket is not the right index for them: this one is keyed on the container
    // title a run names, so a run reaches the show it says it belongs to whatever year either carries
    const containerByKey = new Map<string, string[]>()
    for (const profile of profiles.values()) {
      if (profile.scope !== 'CONTAINER') continue
      for (const key of profile.keys) {
        const holders = containerByKey.get(key)
        if (holders) holders.push(profile.id)
        else containerByKey.set(key, [profile.id])
      }
    }

    const pairs = new Map<string, [string, string]>()
    for (const year of [...buckets.keys()].sort((a, b) => a - b)) {
      const bucket = [...buckets.get(year)!].sort(compare)
      for (let i = 0; i < bucket.length; i += 1) {
        for (let j = i + 1; j < bucket.length; j += 1) {
          if (touches(bucket[i]!, bucket[j]!)) pairs.set(pairKey(bucket[i]!, bucket[j]!), [bucket[i]!, bucket[j]!])
        }
      }
    }

    // counted as what the axis ADDED, never as what it proposed: a run can share a year bucket with
    // the very container it names, and a count including those would price the axis at pairs the
    // shipped pass was already making. It is also the only auditable number the axis has, because a
    // run against a container is guard 2's `cross-scope` every time and the downgrade replaces the
    // proposal's evidence with the guard's, so `via: 'ordinal'` never reaches the link table. Counted
    // over every cluster rather than off `pairs`, which holds only the pairs a moved cluster is in: a
    // pair the buckets make is two clusters that share a year
    const ordinalPairs = new Set<string>()
    for (const id of [...profiles.keys()].sort(compare)) {
      const profile = profiles.get(id)!
      if (!profile.containerKeys.size) continue
      for (const key of [...profile.containerKeys].sort(compare)) {
        for (const container of containerByKey.get(key) ?? []) {
          if (container === profile.id) continue
          const pair = pairKey(profile.id, container)
          if (![...profile.years].some(year => profiles.get(container)!.years.has(year))) ordinalPairs.add(pair)
          if (touches(profile.id, container)) pairs.set(pair, [profile.id, container])
        }
      }
    }

    // SCAN A, the exact shortcut. It is a strict subset of the buckets above, and it is run anyway for
    // two reasons: it is the anchor an incremental pass keeps (5.4 P3), and the cap has to be applied
    // to it in JS or the exact path would be a WIDER arm than the one that was measured, since the
    // shipped shortcut reads the capped six (`fuzzy-merge.ts:215-219`)
    const clusters = [...moved].sort(compare)
    let exactPairs = 0
    // an empty `UNWIND` list dies at runtime on this engine, so a run with nothing moved asks nothing
    const exact = clusters.length
      ? await ctx.query<{ fromCluster: string, toCluster: string, shared: string }>(EXACT_SCAN, { clusters })
      : []
    for (const row of exact) {
      const a = profiles.get(String(row.fromCluster))
      const b = profiles.get(String(row.toCluster))
      if (!a || !b) continue
      const shared = String(row.shared)
      if (!a.keys.has(shared) || !b.keys.has(shared)) continue
      exactPairs += 1
      pairs.set(pairKey(a.id, b.id), [a.id, b.id])
    }

    const matches: typeof lastRun.matches = new Map()
    for (const [key, match] of lastRun.matches) {
      if (profiles.has(match.a) && profiles.has(match.b) && !touches(match.a, match.b)) matches.set(key, match)
    }
    for (const [key, [a, b]] of pairs) {
      const [first, second] = orderPair(profiles.get(a)!, profiles.get(b)!)
      const decision = await decide(first, second, ctx)
      if (decision.match) matches.set(key, { a, b, decision })
    }
    lastRun = { fingerprints, matches }
    const refusedJoin = refusedJoins(matches, id => profiles.get(id)!.scope, id => members.get(id) ?? [])

    const links: LinkProposal[] = []
    const proposed = new Set<string>()
    let refusals = 0
    for (const key of [...matches.keys()].sort(compare)) {
      const { a, b, decision } = matches.get(key)!
      const [first, second] = orderPair(profiles.get(a)!, profiles.get(b)!)
      const proposal = proposalFor(first, second, decision)!
      if (decision.refusedBy) refusals += 1
      proposed.add(pairKey(proposal.fromUri, proposal.toUri))
      const reason = refusedJoin.get(key)
      links.push(reason ? { ...proposal, status: 'refused', reason } : proposal)
    }

    // THE STICKY HALF: an active link of this plugin's has already been spent on a merge, so its pair
    // is one cluster now and cannot be re-derived. It is re-proposed as it stands and the guards weigh
    // it again, which is the only thing that may retract it (5.2, the sticky rule)
    let carried = 0
    for (const row of await ctx.query<Record<string, unknown>>(CARRY_SCAN, { by: ctx.id })) {
      const fromUri = String(row.fromUri)
      const toUri = String(row.toUri)
      if (proposed.has(pairKey(fromUri, toUri))) continue
      carried += 1
      links.push({
        kind: 'SAME_AS',
        fromUri,
        toUri,
        reason: asText(row.reason) ?? 'exact',
        confidence: asNumber(row.confidence) ?? 1,
        evidence: parseJson(row.evidence) ?? null,
        gates: parseJson(row.gates) as TitleGates | undefined,
        // an empty STRING[] reads back as NULL on this engine, so the list is normalized here
        supports: Array.isArray(row.supports) ? row.supports.map(String) : [],
      })
    }

    ctx.log({
      level: 'info',
      rule: 'title-scan',
      detail: `${profiles.size} clusters of which ${moved.size} moved, ${buckets.size} year buckets, ${pairs.size} pairs decided (${exactPairs} through the exact key), ${ordinalPairs.size} through the ordinal axis, ${links.length - carried} proposals of which ${refusals} refused by a gate and ${refusedJoin.size} between two shows, ${carried} carried`,
    })

    // every match is in the output, decided or kept, so the scope is every row this plugin owns
    // and the diff is over the whole of its output
    return { scope: { full: true }, nodes: [], edges: [], links, episodeLinks: [] }
  },
}
