import type { Media, MediaScope, MediaType } from './types'

import { stripTitle, titleSimilarity } from '../../sources/utils'
import { isOnlySeasonLabel, parseSeasonNumber } from '../../sources/season'
import { findAggregatedMedia, linkPartOfPairs, linkSameContainerPairs, linkSameMediaPairs } from './db'

// exported for `plugin:title` (5.4 P3), which scores a pair against the same threshold
export const SIMILARITY_THRESHOLD = 0.9
// Bounds the wasm work, and it is the square that matters: sameShow compares every kept title of one
// cluster against every kept title of the other, so a pair costs up to 36 alignments today and a year
// bucket costs that times its pairs. Eight titles would take one pair to 64, +78% on the single loop
// the whole pass spends its time in, so this is not a knob to turn without measuring the loop first.
// Exported for `plugin:title` (5.4 P3), which caps a cluster at the same six.
export const MAX_TITLES_PER_CLUSTER = 6
const MAX_CACHED_DECISIONS = 50_000

/**
 * How far apart two clusters may put a show's start before that reads as a DISAGREEMENT rather than
 * as two catalogues rounding the same premiere differently.
 *
 * 45 rather than 30, because of a coercion nothing in the payload flags. kitsu and jikan hand stub
 * whatever their API answers (kitsu/extractor.ts:135, jikan/extractor.ts:126) and both answer
 * `YYYY-MM-01` when only the month is known, so a first-of-month date is up to 30 days early and
 * reads as precise. The `startDay` guard below catches only the January ones. Measured, same anime,
 * a kitsu first-of-month the guard KEEPS against a day-precise AniList date: 198 pairs, 187 of them
 * within 30 days, exactly ONE in the 31 to 45 band a 30 day window would refuse (Aikodesho, 32 days,
 * AniList Fri, 02 Sep 1988 against kitsu 1988-08-01) and 10 beyond 45, which are real disagreements
 * no window should absorb.
 *
 * WHY 45 IS NOT CHOSEN ON THE RATIO, which is the trap this sweep sets. Printed by the probe below,
 * as (welds refused / correct merges lost / ratio), with the first-of-month guard this file ships:
 *
 *     30   84 / 101   0.83        90   65 / 41   1.59
 *     45   83 /  81   1.02       180   40 / 11   3.64
 *     60   77 /  68   1.13
 *
 * The ratio improves MONOTONICALLY as the window widens, so a reader optimising it picks 180 days.
 * That is exactly backwards: this rule exists to separate two seasons inside ONE calendar year, and
 * the owner's stated shape is season 1 in months 1 to 4 against season 2 in months 7 to 10, which is
 * about 180 days apart. A 180 day window ALLOWS the entire population the check was built for, and
 * scores a beautiful ratio by refusing almost nothing. Two consecutive cours sit about 91 days apart,
 * so the window has a hard ceiling well below that regardless of what the ratio says.
 *
 * So the ceiling is structural and the ratio only picks between the widths under it. 45 is the widest
 * that leaves a full month of clearance below a cour, and it is the constant crunchyroll/extractor.ts
 * already ships for the same question, which keeps one number in the codebase instead of two.
 *
 * Exported for `plugin:title` (5.4 P3), whose date gate is this window.
 */
export const START_DATE_WINDOW_DAYS = 45
const MS_PER_DAY = 86_400_000

/**
 * The values of `media.type` that name which WORK this is, as opposed to which medium it is.
 *
 * `mediaTypeEnum` also carries ANIME and LIVE_ACTION, which answer a different question and would
 * make two clusters disagree for saying the same thing. Only four extractors fill the field at all
 * (anilist:352, kitsu:124, jikan:84 and :174, offline/normalize.ts:98) and none of them ever emits
 * either of those two, so restricting here costs nothing today and keeps the comparison meaningful
 * if one of them starts.
 */
export const WORK_KINDS = new Set<MediaType>(['TV', 'MOVIE', 'SPECIAL', 'OVA', 'ONA'])

/**
 * The type a media presents to the MERGE, which spells a short as the TV it used to be.
 *
 * `TV_SHORT` was added so a viewer can filter for shorts, and AniList is the only source that emits
 * it. Every gate in this file was calibrated against a corpus where those same rows arrived spelled
 * `TV`, so reading the new member here would silently move two profiles at once on any cluster AniList
 * alone types: `formats` would lose its SERIES, and `types` would lose its TV. An EMPTY `types` set is
 * the dangerous half, because the companion-content veto below only fires when both sides name a work
 * kind, so a short would stop vetoing anything.
 *
 * Adding TV_SHORT to `WORK_KINDS` instead would be worse: a cluster AniList types TV_SHORT and one
 * jikan types TV would then share no work kind and veto each other, refusing a merge that is correct.
 * Folding it back keeps every profile byte-identical to before the member existed.
 */
export const mergeType = (type: MediaType | null): MediaType | null => type === 'TV_SHORT' ? 'TV' : type

/**
 * The trailing phrases that name companion content rather than a work, measured one at a time rather
 * than guessed. Each was swept alone against the pair set the companion check below is decided on,
 * and the ten kept are exactly the ones that refused at least one wrong weld there:
 *
 *   specials 19, special 8, ova 7, ona 4, episode 0 3, bonus 2, mini anime 2, picture drama 1,
 *   recap 1, trailer 1
 *
 * Fifteen more were swept and dropped for refusing none of them: picture dramas, recaps, digest,
 * ovas, omake, omakes, extra, extras, pilot, ex, short, shorts, preview, previews, pv. They cost
 * nothing either, so this is not a claim that they never occur, only that this corpus cannot say
 * they earn their place. The sweep still prints all twenty five, one row each:
 *
 *   ./node_modules/.bin/vitest run --config vitest.probe.config.ts \
 *     scripts/measure-companion-marker.probe.ts --disableConsoleIntercept --reporter=verbose
 */
export const COMPANION_MARKERS = [
  'specials', 'special', 'picture drama', 'recap', 'ova', 'ona', 'bonus', 'mini anime',
  'episode 0', 'trailer',
]

type Format = 'MOVIE' | 'SERIES'

type ClusterProfile = {
  cluster: Media[]
  key: string
  scope: MediaScope
  // The member a link is made THROUGH: the lowest uri whose scope is the profile's. `key` is the
  // lowest uri overall, and in a mixed cluster (a row unioned as a run and flipped CONTAINER since,
  // which is sticky) that can be the container member. The store answers a container uri in the
  // container space, so re-reading such a cluster by its key found a singleton show instead of the
  // run cluster, and `linkSameMediaPairs` refuses a container on either side: two runs that agreed on
  // title and year could never union. `key` stays as it is for the cache and the ordering.
  linkUri: string
  titles: string[]
  years: Set<number>
  days: Set<number>
  formats: Set<Format>
  types: Set<MediaType>
  seasons: Set<number>
  cacheKey: string
}

// shares titleSimilarity's strip. Widen only this one and the similarity path strips a title back down to its
// latin fragment, so two Vanguard seasons both reduce to "divinez" and score a perfect 1.
const normalizeTitle = (title: string) =>
  stripTitle(title)
    .replace(/\b(?:the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

// a title with no letter left is a year or a season number, never an identity, and a bad link is permanent: graph.link has no inverse
const HAS_LETTER = /\p{L}/u

// ...and neither is one that has letters but says only which season it is, which HAS_LETTER waves
// through: see isOnlySeasonLabel for the pair of shows that cost
const carriesIdentity = (title: string) => HAS_LETTER.test(title) && !isOnlySeasonLabel(title)

// Code unit order rather than localeCompare, which is locale dependent: the point of every comparator
// in this file is that two runs agree, and a collation that reads a locale off the host does not.
const compareStrings = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

const yearOf = (date: string | null) => {
  if (!date) return null
  const parsed = new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed.getUTCFullYear()
}

/**
 * The whole UTC day a media asserts it started on, or nothing when all it is really saying is which
 * year that was.
 *
 * TWO coercions are dropped, and which ones was MEASURED rather than reasoned about.
 *
 * JANUARY 1, because a year alone parses to it: the streaming catalogues write a year they know as
 * `YYYY`, and templated `YYYY-01-01` until 2026-10-17. Nothing downstream can tell one of those from
 * a show that really did premiere on New Year's Day, and the ones that mint it are the streaming catalogues, whose whole job here is to
 * attach a one-title cluster to a fat metadata cluster. Measured: keeping January 1 as a date
 * destroys 14992 of 17946 such attaches, which is the shape of rule this file already refuses once
 * (see the season check). Dropping it destroys none of them.
 *
 * THE FIRST OF ANY MONTH, because kitsu:135 emits that when the DAY is unknown, and a
 * January-only guard reads it as precise while it is up to 30 days out. Measured, same anime, a kitsu
 * first-of-month against a day-precise AniList date: 198 pairs, 187 within 30 days, and one at 32
 * days that a 30 day window would have refused outright (Aikodesho, AniList Fri 02 Sep 1988 against
 * kitsu 1988-08-01). Dropping it is strictly better on both arms of the sweep this file's probe
 * prints, at every window: at 45 days it is 83 welds refused for 81 merges lost, ratio 1.02, against
 * 86 for 98 and ratio 0.88 with the January-only guard.
 *
 * A genuine first-of-month premiere is therefore exempted from the veto. That is the safe direction:
 * an exempted pair is simply judged on the other axes, which is where it was before this existed.
 *
 * The day rather than the millisecond, so two clusters that agree land on ONE cacheKey: jikan emits
 * an offset-bearing ISO string and anilist a UTC midnight, and a difference no comparison here can
 * see must not split the decision cache.
 */
const startDay = (date: string | null) => {
  if (!date) return null
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return null
  if (parsed.getUTCDate() === 1) return null
  return Math.floor(parsed.getTime() / MS_PER_DAY)
}

/**
 * Whether one side holds a title that is a title the other side holds plus a trailing companion
 * marker, which is one catalogue naming the second thing as an appendix to the first.
 *
 * Read off the profile titles, so it sees the same six the matcher does and nothing normalizeTitle
 * already threw away: "Ore, Tsushima (ONA)" arrives here as "ore tsushima ona" and the marker is a
 * plain trailing word by then.
 *
 * Exported for `plugin:title` (5.4 P3), whose companion gate is this rule over the same six.
 */
export const namesCompanionContent = (a: string[], b: string[]) => {
  for (const [marked, plain] of [[a, b], [b, a]] as [string[], string[]][]) {
    for (const title of marked) {
      for (const marker of COMPANION_MARKERS) {
        if (title.length <= marker.length + 1 || !title.endsWith(` ${marker}`)) continue
        if (plain.includes(title.slice(0, -(marker.length + 1)).trim())) return true
      }
    }
  }
  return false
}

/**
 * The tie inside a score tier is broken by the title itself, and that choice was MEASURED rather than
 * argued, because the obvious arguments point the wrong way.
 *
 * Three arms move when the ordering changes, over the manami database (41537 records, 2026-27), and
 * no rule wins all three, so the numbers rather than a principle decide it:
 *
 *   A  two different shows sharing one junk franchise label, does it survive the slice on BOTH sides
 *      and weld them ("Star"t and Agitation! both carry "irodorimidori"): 1547 pairs, lower is better
 *   B  one show reaching the store as two clusters holding overlapping subsets of one title pool, do
 *      they keep a title in common: 6502 cases, higher is better
 *   C  a ONE-title streaming cluster meeting a fat metadata cluster, is that title among the six:
 *      12399 cases, higher is better. This is JustWatch attaching to Mushoku Tensei.
 *
 *                       A weld     B split     C attach
 *     arrival order      64.5%       94.9%        56.0%     what this replaces
 *     title ascending    69.6%       99.9%        70.0%     what this is
 *     longest first      53.8%      100.0%        19.9%     best on A and unusable on C
 *     shortest first     82.7%      100.0%        98.7%     the control, and it inverts A as predicted
 *
 * So ordering by the title costs five points on A and buys five on B and fourteen on C. Both recall
 * arms rise for the same reason: an ordering applied identically to both sides cannot drop a title one
 * side keeps, which is exactly what arrival order was doing to one split cluster in twenty.
 *
 * Two things worth knowing before changing this again. Latin code points sort below CJK ones, so this
 * does hand a tie to the english titles, and the intuition that this starves the native title and
 * costs matches is measurably wrong: C rises, because a streaming catalogue lists in latin and the
 * native title is not what it is looked up by. And A is not really the slice's job. Relying on a random
 * six to drop a third of the wrong welds is relying on luck for correctness, and it is what made the
 * same two shows merge on one load and not the next. The 255 of those 1547 where exactly one side
 * names a season ("86" against "86 Part 2", both carrying "86 不存在的战区") are a veto gap, and closing
 * it was measured afterwards and does NOT pay A back: see the season check in sameShow for the numbers.
 */
const orderWithinTier = (titles: string[]) => [...titles].sort(compareStrings)

/**
 * The titles this cluster is compared on, as a function of the SET of (title, score) pairs it holds
 * and of nothing else.
 *
 * Every title's `score` is a module constant of its SOURCE (0.9 ani.zip and jikan's English, 0.8 anilist,
 * 0.5 crunchyroll, 0.4 jikan's others, 0.3 the english metadata block, 0.25 watchmode, 0.2 the catalogues), so
 * a comparator on it returns 0 for every pair inside a tier and Array.prototype.sort leaves those in
 * insertion order. Insertion order was cluster order, which is union-find component order, which is
 * [surviving root's members..., absorbed root's members...] and therefore the order the extractors'
 * HTTP responses landed in. The same cluster then kept a different six from one run to the next, and
 * the six decide whether it merges at all: an already welded Mushoku Tensei component carries eight
 * distinct normalized titles at 0.9, and whether ani.zip's short "mushoku tensei" is among the six is
 * the whole difference between JustWatch attaching and not. With the long titles only,
 * maxPossibleSimilarity measures 0.389, 0.359 and 0.326 against them and refuses the pair before the
 * matcher even runs.
 *
 * Deduplicating through a Map keyed on the normalized title rather than sorting and then deduplicating
 * matters for the same reason: a dedup over a sorted array keeps whichever copy the sort left first,
 * and inside a tier that is again arrival order.
 */
const selectTitles = (cluster: Media[]): string[] => {
  const bestScore = new Map<string, number>()
  for (const media of cluster) {
    for (const { title, score } of media.titles ?? []) {
      const normalized = normalizeTitle(title)
      if (!carriesIdentity(normalized)) continue
      const value = score ?? -1
      const current = bestScore.get(normalized)
      if (current === undefined || value > current) bestScore.set(normalized, value)
    }
  }
  return selectByScore(bestScore)
}

/**
 * The half of the selection above that is a function of the best score per normalised title, and
 * nothing else: bucket by score, title ascending within a tier, take six.
 *
 * Split out rather than repeated because `plugin:title` selects the same six (5.4 P3) from the
 * profile's `titleKeys` instead of from `Media.titles`, and two passes that select different sixes
 * merge different clusters while every number in the comment above is about this one rule.
 */
export const selectByScore = (bestScore: Map<string, number>): string[] => {
  const byScore = new Map<number, string[]>()
  for (const [title, score] of bestScore) {
    const tier = byScore.get(score)
    if (tier) tier.push(title)
    else byScore.set(score, [title])
  }

  return [...byScore]
    .sort(([a], [b]) => b - a)
    .flatMap(([, titles]) => orderWithinTier(titles))
    .slice(0, MAX_TITLES_PER_CLUSTER)
}

/** Everything the pass reads off a cluster. Nothing here may depend on the order of `cluster`. */
export const profileCluster = (cluster: Media[]): ClusterProfile => {
  const key = cluster.map(media => media.uri).sort()[0]!
  // a cluster is a container only when every member is: a legacy mixed cluster still names a run
  const scope: MediaScope = cluster.every(media => media.scope === 'CONTAINER') ? 'CONTAINER' : 'RUN'
  const linkUri =
    cluster
      .filter(media => (media.scope === 'CONTAINER' ? 'CONTAINER' : 'RUN') === scope)
      .map(media => media.uri)
      .sort()[0] ?? key
  const titles = selectTitles(cluster)
  const years =
    new Set(
      cluster
        .map(media => yearOf(media.startDate))
        .filter((year): year is number => year !== null)
    )
  const days =
    new Set(
      cluster
        .map(media => startDay(media.startDate))
        .filter((day): day is number => day !== null)
    )
  const formats =
    new Set(
      cluster
        .flatMap(media => {
          const type = mergeType(media.type)
          // one-off specials straddle the movie/series boundary - keep them format-neutral
          return type === 'SPECIAL' || type === 'OVA' || type === 'ONA' ? []
            : [
              ...media.categories ?? [],
              ...type === 'MOVIE' ? ['MOVIE' as const] : type === 'TV' ? ['SERIES' as const] : [],
            ]
        })
        .filter((category): category is Format => category === 'MOVIE' || category === 'SERIES')
    )
  const types =
    new Set(
      cluster
        .map(media => mergeType(media.type))
        .filter((type): type is MediaType => type !== null && WORK_KINDS.has(type))
    )
  // read off the RAW titles, because normalizeTitle folds `Season 4` and `Season 40` closer together
  // and drops the delimiters `第 4 期` is allowed to carry
  const seasons =
    new Set(
      cluster
        .flatMap(media => media.titles ?? [])
        .map(({ title }) => parseSeasonNumber(title))
        .filter((season): season is number => season !== undefined)
    )
  return {
    cluster,
    key,
    scope,
    linkUri,
    titles,
    years,
    days,
    formats,
    types,
    seasons,
    // The key has to identify the SET of titles, because that is all sameShow's verdict depends on: its
    // title comparison is an existential double loop, so no ordering of the same six can change the
    // answer. Sorting here keeps one logical cluster on ONE cache entry, where joining them in
    // selection order once wrote a second entry per arrival order for a pair whose verdict could not
    // differ, re-ran every pair through the wasm loop on the pass after any merge, and counted twice
    // toward the MAX_CACHED_DECISIONS wipe that then threw away the entries still worth keeping.
    // Joining with ',' is safe only because normalizeTitle keeps nothing but letters, numbers and
    // single spaces, so no separator can survive inside a title: let punctuation through there and
    // cache keys start colliding silently. Seasons are joined numerically for legibility only, the
    // default comparator canonicalizes them correctly too ([2,10,1] and [1,10,2] both give "1,10,2").
    // Days are numerically sorted for the same reason as seasons: legibility. The default comparator
    // would be SAFE here, and an earlier draft of this comment claimed otherwise: it said epoch day
    // numbers of unequal length would canonicalize to two different keys and reopen 04d527b's bug.
    // They would not. A sort is a function of the multiset, so [9999, 10000] and [10000, 9999] both
    // spell "10000,9999" under the default and both spell "9999,10000" under this one. What the
    // default would actually cost is a key nobody can read, which is worth avoiding on its own.
    cacheKey: `${key}#${[...titles].sort(compareStrings).join(',')}#${[...formats].sort(compareStrings).join(',')}#${[...seasons].sort((a, b) => a - b).join(',')}#${[...days].sort((a, b) => a - b).join(',')}#${[...types].sort(compareStrings).join(',')}`,
  }
}

/**
 * A ceiling on `titleSimilarity` by character count, which skips the wasm alignment for a pair that
 * cannot reach the threshold. It is not exact: frizbee's flat bonuses can score a pair a little above
 * it (0.5607 against 0.56 on two Japanese titles). `npm run calibrate` counts the pairs it refuses
 * that score at or above a threshold: none at 0.9 and 70 at 0.3 on manami 2026-27 (2026-10-18).
 * Shared with the plugin contract (`PluginContext.maxPossibleSimilarity`) so every rule prices a pair
 * the same way.
 */
export const maxPossibleSimilarity = (a: string, b: string) => {
  const counts = new Map<string, number>()
  for (const char of a) counts.set(char, (counts.get(char) ?? 0) + 1)
  let common = 0
  for (const char of b) {
    const count = counts.get(char) ?? 0
    if (count > 0) {
      counts.set(char, count - 1)
      common++
    }
  }
  return common / Math.max(a.length, b.length)
}

const trailingNumber = (title: string) => {
  const match = /^(.*?)\s*(\d+)$/.exec(title)
  return match ? { stem: match[1]!, value: Number(match[2]) } : { stem: title, value: null }
}

// A trailing number is compared as a VALUE, never as characters. "yami shibai 16" and "yami shibai 17"
// are two different shows and score 0.8849, while "onii-chan!" and "oniichan" are one show and score
// 1.0000, so no threshold tells them apart: alignment charges nothing for a hyphen that is noise and
// almost nothing for a digit that is the whole identity. Both re-measured on frizbee 2026-08-29; they
// read 0.929 and 0.833 here until then, which were seal-wasm's and outlived it.
// Exported for `plugin:title` (5.4 P3), whose title gate skips a pair on the same rule.
export const differOnlyByTrailingNumber = (a: string, b: string) => {
  const left = trailingNumber(a)
  const right = trailingNumber(b)
  return left.value !== right.value && left.stem === right.stem
}

// Year equality is guaranteed by the caller's bucketing
const sameShow = async (a: ClusterProfile, b: ClusterProfile) => {
  if (a.formats.size && b.formats.size && ![...a.formats].some(format => b.formats.has(format))) return false
  // Only a DISAGREEMENT blocks. A cluster whose sources never spell the season out has to stay free to
  // merge, or the pass stops doing the job it exists for.
  //
  // Making silence itself block was MODELLED and REFUSED, over the manami database (41537 records,
  // 2026-27) driven through this file's own profileCluster and titleSimilarity. The rule tried: refuse
  // when one side declares season N>=2 and the other declares no season at all.
  //
  //   refuses  323 wrong welds
  //   costs    592 of 33188 merges where one show arrives as two overlapping subsets of its titles
  //            11415 of 181677 attaches where a ONE-title streaming cluster meets a fat metadata
  //              cluster, which is arm C above and the job this pass exists for, over 2589 shows
  //            2589 of 2824 on an adversarial split with every season-marked title on one side
  //   ratio    0.55 / 0.03 / 0.12, combined 323 refused against 12007 lost, one wrong weld stopped
  //              per 37 correct merges destroyed
  //
  // The year bucketing has already spent the separation the rule is imagined to buy: of the 373 pairs
  // where exactly one side names a season, ZERO have year sets that differ, because this pass only ever
  // compares within a year bucket, so "[Oshi no Ko]" 2023 against its 2024 second season is refused
  // before any of this runs. What is left in that 373 is same-year split cours, recaps and specials.
  // The cost is not bounded by the year at all, since both sides of a split cluster hold the same
  // record and so the same year, so the rule is paid for out of "[Oshi no Ko] 2nd Season" (2024)
  // attaching to a streaming cluster named "Oshi no Ko", and 2588 other shows. Ten narrower variants
  // were measured too. The best of them (also require the season-less side to carry no season marker in
  // ANY raw title, and the two clusters to hold a title pair that is equal once the marker is stripped
  // and unequal before) keeps 126 of the 323 for 578 lost attaches across 468 shows, ratio 0.22, and
  // still refuses that same Oshi no Ko attach. Nothing in the family reaches 1.
  //
  // WHAT THEREFORE GETS THROUGH, known rather than new: "86" and "86 Part 2", both 2021, both carrying
  // the synonym "86 -不存在的战区-", one naming a season and one not, weld on the exact-title shortcut
  // below. That is 373 of the 12674 pairs of distinct records that share a title after the slice; the
  // other 12050 have NEITHER side naming a season and are franchise-label collisions ("minna no uta" is
  // carried by 1039 records), which no season rule reaches. Pinned by the KNOWN GAP test in
  // season-separation.test.ts, so closing it fails there loudly.
  if (a.seasons.size && b.seasons.size && ![...a.seasons].some(season => b.seasons.has(season))) return false
  // Two seasons inside ONE calendar year share a year bucket, so the bucketing above never reaches
  // them, and the season check above needs BOTH sides to name a season while season 1 almost never
  // does. A start date needs neither side to say anything: "if we have mushoku tensei season 2, it
  // shouldn't get merged in with mushoku tensei s3", and seasons really do land like S1 January to
  // April, S2 July to October.
  //
  // Same shape as the season check, and for the same reason. Silence never blocks, and ONE pair of
  // dates inside the window is enough to allow the merge, so a cluster that holds both a right date
  // and a wrong one still merges on the right one. This can therefore only ever make sameShow answer
  // false more often than it did.
  //
  // MEASURED over a census of the cached AniList corpus, 21853 entries carrying a start date, on a
  // MAIN-TITLE pool: anilist english/romaji/native at 0.8 and kitsu titles.en/canonicalTitle/
  // titles.ja_jp at 0.3, which is what the extractors actually emit. Stub carries no synonyms
  // anywhere: every extractor emits its source's own titles and none of them emits a synonym list.
  // Modelling a cluster as a title PLUS its synonyms inflates every weld count severalfold, and is
  // how this axis was once justified, on a number that did not describe stub.
  //
  //   MARGINAL, not standalone. The companion-marker check below is already active when this runs,
  //   so these are what the date axis adds ON TOP of it. The companion probe reports its own numbers
  //   the same way, with this axis active. The two must NOT be added: each is measured against a
  //   baseline the other has already reduced.
  //
  //   census   577 same-year pairs of distinct entries holding titles that can reach the threshold
  //   benefit  83 of the 118 that still weld are refused, and they are pairs the season check could
  //              never reach, because a side names no season. "Bungou Stray Dogs" (7 Apr 2016)
  //              against "Bungou Stray Dogs 2nd Season" (6 Oct 2016) welds today on a shared kitsu
  //              title and is refused at 182 days.
  //   cost     81 of 15549 correct merges lost (0.52%), in the arm where one show reaches the store
  //              as two clusters, AniList's media and kitsu's, and the two catalogues genuinely
  //              disagree: kitsu dates an OVA by its home-video release, answers 12-31 for a show
  //              that has not aired, or carries the day and the month swapped (Big X, AniList
  //              Mon, 03 Aug 1964 against kitsu 1964-03-08), which no window absorbs.
  //              0 of 17946 streaming attaches lost, because a catalogue that only knows the year
  //              says January 1 and `startDay` drops it.
  //   ratio    1.02 wrong welds refused per correct merge destroyed. Modest, and it is the honest
  //              figure: the companion check carries most of the pair. What this axis buys that
  //              nothing else does is the OWNER'S case, two seasons in one year with neither side
  //              naming a season, which carries no companion marker for the other rule to see.
  //   control  the same run with January 1 believed rather than dropped destroys 14992 of the 17946
  //              attaches, ratio 0.02, back in the range of the season-label rule this file refuses
  //              just above. A second control samples 20000 same-year pairs the census did NOT select
  //              and welds 0 of them. The rig can express a catastrophic cost and can express a miss,
  //              so the 0 above is a result rather than a silence.
  //
  //   node scripts/measure-start-date-window.mjs
  //   ./node_modules/.bin/vitest run --config vitest.probe.config.ts \
  //     scripts/measure-start-date-window.probe.ts --disableConsoleIntercept --reporter=verbose
  //
  // Limiting the veto by format was measured and refused: the benefit is concentrated in exactly the
  // formats that carry the cost. Restricting it to TV reaches almost none of the welds, because the
  // single biggest class IS a TV series welding to its own SPECIAL, so a TV-only rule excludes the
  // thing it is aimed at. (That comparison was run against the pre-companion baseline; the shape of
  // the answer is what carries, not the counts, so they are not restated here.)
  //
  // THE FALSE NEGATIVE IT KNOWINGLY ACCEPTS: a source that dates a show by when IT started carrying
  // it rather than when the show aired. appletv is the one that can do this today, the only streaming
  // extractor publishing a day-precise date (appletv/extractor.ts:79) rather than a `${year}-01-01`,
  // so an Apple cluster whose date is a late western release is refused against the metadata cluster.
  // It is NOT measured: over 398 sampled anime, Apple's search returned an item carrying a release
  // date for 199 of them and an item whose normalized title matched the query for ZERO, so the arm
  // cannot be measured from that endpoint at all and is recorded here rather than estimated.
  if (
    a.days.size && b.days.size
    && ![...a.days].some(dayA => [...b.days].some(dayB => Math.abs(dayA - dayB) <= START_DATE_WINDOW_DAYS))
  ) return false
  // A show welding to its OWN companion content is what is left once the date axis above has run,
  // and it survives everything before this line for one reason: the companion entry carries the
  // parent's NATIVE title unchanged. "Vanquished Queens" and "Vanquished Queens Specials" both hold
  // ヴァンキッシュドクイーンズ, so the exact-title shortcut fires on a title neither catalogue bothered
  // to distinguish, while the latin titles that DO distinguish them are never the pair that matches.
  // Same year, and often the same day, so neither the bucketing nor the date window can reach it.
  //
  // TWO signals, and it takes both. Alone, each is the shape of rule this file already refuses:
  //
  //   the marker alone      52 of 84 refused, 77 correct merges destroyed and 59 streaming attaches,
  //                           ratio 0.382. It fires on one catalogue writing "Blade of the Immortal
  //                           ONA" where the other writes "Blade of the Immortal" for THE SAME entry,
  //                           which is a naming convention rather than a different work.
  //   the disagreement alone 63 of 84 refused, 547 correct merges destroyed, ratio 0.115, for the
  //                           same reason at larger scale: anilist and kitsu type one anime
  //                           differently often enough that the disagreement alone is mostly noise.
  //   both together         49 of 84 refused, 2 correct merges destroyed, 0 attaches, ratio 24.5.
  //
  //   Fifteen of the twenty-five markers in the list refuse nothing at all on this corpus (picture
  //   dramas, recaps, digest, ovas, omake, omakes, extra, extras, pilot, ex, short, shorts, preview,
  //   previews, pv). They are kept because a marker that fires zero times costs zero: the type
  //   disagreement has to hold first, so an unused marker cannot widen the rule on its own. The ten
  //   that do fire are led by "specials" at 22 and "special" at 10.
  //
  // The two are independent because a marker is how ONE catalogue writes a title and a type is what
  // BOTH catalogues assert about the work. A marker with no disagreement is a convention; a marker
  // with a disagreement is two catalogues independently saying these are different kinds of thing.
  //
  // MEASURED on the pool the start-date axis was decided on, main titles only (anilist
  // english/romaji/native at 0.8, kitsu titles.en/canonicalTitle/titles.ja_jp at 0.3), which is what
  // the extractors emit. Stub carries no synonyms anywhere; a title-plus-synonyms model inflates
  // every weld count severalfold and does not describe stub.
  //
  //   MARGINAL, not standalone, the same way the start-date block above is: that axis is already
  //   active when this runs, so these are what the companion check adds on top of it. Do not add the
  //   two sets of numbers together.
  //
  //   residual  84 wrong welds and 15470 correct merges survive the 45 day axis
  //   benefit   49 of the 84 refused, every one a work against its own companion entry
  //   cost       2 of 15470 correct merges, both a real double disagreement: "Blade of the Immortal
  //               ONA" against kitsu's "Blade of the Immortal", anilist ONA against kitsu TV, and
  //               "Ghost Slayers Ayashi: Inferno OVA" against kitsu's title, anilist OVA against
  //               kitsu SPECIAL. 0 of 17946 streaming attaches, because a streaming catalogue fills
  //               no `type` at all and silence never blocks.
  //   robust    adding `offline` as a third typed member of every cluster, whose manami type differs
  //               from anilist's format 916 times in 17319 (5.29%), moves neither number: 49 and 2.
  //   replicate 895 same-year pairs selected instead by manami's own `related` graph, which never
  //               looks at a title: 80 weld with the date axis off, 14 survive it, 8 of those
  //               refused, the same 57% of the residual the census arm gives.
  //
  //   node scripts/measure-start-date-window.mjs
  //   ./node_modules/.bin/vitest run --config vitest.probe.config.ts \
  //     scripts/measure-companion-marker.probe.ts --disableConsoleIntercept --reporter=verbose
  //
  // THE FORMAT NEUTRALITY ABOVE IS DELIBERATELY UNTOUCHED, and this was the first thing measured.
  // Giving SPECIAL/OVA/ONA a third format that disagrees with MOVIE and SERIES refuses 31 of the 75
  // and destroys 8808 of the 17946 attaches, because 9023 of the 21853 entries in the corpus are one
  // of those three and a streaming catalogue claims SERIES for all of them: ratio 0.003, worse than
  // any rule this file has refused. Reading that third format off `media.type` only, so an untyped
  // streaming cluster stays exempt, brings it to 31 refused for 327 destroyed, still 0.095.
  //
  // The other half of that idea, keeping neutrality only when a cluster has no other format signal,
  // is ALREADY what the code above does: neutrality is per-media, so a cluster typed SPECIAL by one
  // source and TV by another contributes SERIES through the TV member and profiles as SERIES.
  if (
    a.types.size && b.types.size && ![...a.types].some(type => b.types.has(type))
    && namesCompanionContent(a.titles, b.titles)
  ) return false
  for (const titleA of a.titles) {
    for (const titleB of b.titles) {
      if (titleA === titleB) return true
      if (differOnlyByTrailingNumber(titleA, titleB)) continue
      if (maxPossibleSimilarity(titleA, titleB) < SIMILARITY_THRESHOLD) continue
      if (await titleSimilarity(titleA, titleB) >= SIMILARITY_THRESHOLD) return true
    }
  }
  return false
}

const pairKey = (a: ClusterProfile, b: ClusterProfile) =>
  a.cacheKey < b.cacheKey ? `${a.cacheKey}|${b.cacheKey}` : `${b.cacheKey}|${a.cacheKey}`

const pairDecisions = new Map<string, boolean>()

// The cache is keyed on exactly the five fields sameShow reads plus the component's identity, so a
// reused verdict is always still a verdict about the same inputs. That is what makes it safe to ask
// again below without paying for the wasm loop twice when nothing has moved.
const decide = async (a: ClusterProfile, b: ClusterProfile) => {
  const key = pairKey(a, b)
  const cached = pairDecisions.get(key)
  if (cached !== undefined) return cached
  const match = await sameShow(a, b)
  pairDecisions.set(key, match)
  return match
}

export const fuzzyMergeMediaClusters = async (clusters: Media[][]): Promise<boolean> => {
  const profiles = clusters.filter(cluster => cluster.length).map(profileCluster)

  const byYear = new Map<number, ClusterProfile[]>()
  for (const profile of profiles) {
    if (!profile.titles.length) continue
    for (const year of profile.years) {
      const bucket = byYear.get(year)
      if (bucket) bucket.push(profile)
      else byYear.set(year, [profile])
    }
  }

  if (pairDecisions.size > MAX_CACHED_DECISIONS) pairDecisions.clear()

  const links: [string, string][] = []
  const visited = new Set<string>()
  for (const bucket of byYear.values()) {
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const a = bucket[i]!
        const b = bucket[j]!
        const key = pairKey(a, b)
        if (visited.has(key)) continue
        visited.add(key)
        // The link names the two components by their `linkUri`, the lowest uri each holds in its own
        // scope, and names them in a fixed order. Taking cluster[0] instead named them by union-find
        // component order, and the ARGUMENT order is what graph.link hands to union(), which keeps the
        // first argument's root on a rank tie (two fresh singletons, the common case) and appends the
        // absorbed members after it. So arrival order chose the link direction, the link direction
        // fixed the merged component's order, and that order chose which title the next pass sliced
        // off: the loop this pass both consumed and fed.
        if (await decide(a, b)) links.push(a.linkUri < b.linkUri ? [a.linkUri, b.linkUri] : [b.linkUri, a.linkUri])
      }
    }
  }

  // ...and the SEQUENCE of unions decides root survival just as much as their direction does, so the
  // links are applied in an order the bucket cannot influence either.
  links.sort(([leftA, leftB], [rightA, rightB]) => compareStrings(leftA, rightA) || compareStrings(leftB, rightB))

  let changed = false
  for (const [uriA, uriB] of links) {
    // Every verdict above was computed against a SNAPSHOT taken before the first await, and the pass
    // awaits the wasm matcher hundreds of times: extractor.ts flushes its DataLoader batch on a 50ms
    // timer throughout, and each flush can weld more medias into a component that has already been
    // judged. Applying a verdict about a small component to whatever that component has become is how
    // a Crunchyroll season 1 gets welded into a component that grew a season 2 while the pass ran, and
    // graph.link has no inverse. So the two components are read again as they stand NOW and put
    // through the same checks, with the link applied in the same turn as the check that allowed it.
    // This can only ever REFUSE a link the snapshot allowed - it is an AND with the original verdict,
    // never a replacement - and it costs one extra pass over the matched pairs only, which are few.
    // The check is free whenever nothing moved, because an unchanged component profiles to the same
    // cacheKey and the decision is already memoized.
    const clusterA = await findAggregatedMedia(uriA)
    const clusterB = await findAggregatedMedia(uriB)
    if (!clusterA.length || !clusterB.length) continue
    const a = profileCluster(clusterA)
    const b = profileCluster(clusterB)
    // already one component, so both profiles are the same component and there is nothing to link
    if (a.key === b.key) continue
    if (!await decide(a, b)) continue
    // The verdict is the same whatever the scopes are; what it is allowed to DO is not. Two runs or two
    // containers union in their own space. A title match between a run and a show is a guess at
    // containment, so it rides an edge, never a union: the edge can be deleted, a union cannot.
    if (a.scope !== b.scope) {
      const [run, container] = a.scope === 'RUN' ? [a.linkUri, b.linkUri] : [b.linkUri, a.linkUri]
      if (linkPartOfPairs([[run, container]])) changed = true
    } else if (a.scope === 'CONTAINER') {
      if (linkSameContainerPairs([[uriA, uriB]])) changed = true
    } else if (linkSameMediaPairs([[uriA, uriB]])) {
      changed = true
    }
  }

  return changed
}
