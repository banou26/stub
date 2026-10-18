/**
 * Threshold calibration for every title matching gate in this repo, measured against the manami
 * anime-offline-database rather than against hand-picked examples.
 *
 * WHY THIS EXISTS. The matching engine was swapped from seal-wasm to frizbee in b8ee54c. frizbee
 * scores containment-shaped pairs LOWER than seal did, and only one of the thresholds riding that
 * scale was migrated (TITLE_MATCH_THRESHOLD in src/sources/utils.ts, 0.5 to 0.44). The rest still
 * hold numbers calibrated against the old engine. A number that was measured once and then had the
 * ground move under it is worse than no number, because it still reads as measured.
 *
 * HOW TO RUN IT. It is deliberately NOT in vitest.config.ts's include list, which covers src/worker,
 * src/sources and src/utils only, so `npm run test:unit` does not pay for it:
 *
 *   ./node_modules/.bin/vitest run --config vitest.calibration.config.ts \
 *     --disableConsoleIntercept --reporter=verbose
 *
 * `--disableConsoleIntercept` is not optional. Without it vitest swallows console output and the run
 * passes while printing nothing, which is a rig that reports success while measuring nothing.
 * `npx vitest` fails on this machine with EBADDEVENGINES; call the binary directly.
 *
 * WHAT IT ASSUMES ABOUT ITS OWN CORRECTNESS: nothing. A check that reports absence is first a claim
 * about the check, so the controls assert that the scorer is live (an identical pair reaches 1.0, an
 * unrelated pair stays near 0, sacha's season stripping actually strips), that the sweep SEPARATES
 * the two arms, and that the separation detector itself rejects a deliberately inert scorer.
 *
 * THE CONTROLS ARE CALIBRATED BY MUTATION, not by argument. Each production function this file leans
 * on is mocked to a pass-through in turn and the run must go RED. Ten mutations, and the list is the
 * specification of what the controls have to catch:
 *
 *   titleSimilarity -> 0 / 0.5 / 1     the dead-wasm case and the two constant-scorer cases
 *   bestTitleScore  -> 0 / 1           the franchise scoring path alone
 *   franchiseTitle  -> identity        a sacha that loads and then declines every title
 *   stripTitle      -> identity        the LABELLER, not the scorer: it decides what the arms are
 *   simplifyTitle   -> []              the rung models silently become the no-rung model
 *   profileCluster  -> empty profile   every fuzzy-merge veto refuses everything
 *
 * The last three were added because they PASSED. An earlier version of this file reported 16 of 16
 * green under all three while every number in the report moved, which is the exact failure mode the
 * paragraph above claims to protect against. What a control suite covers is a measurement, and until
 * the mutation is run it is a hope. Re-run the battery after changing anything here.
 *
 * THE COST ASYMMETRY THE WHOLE FILE IS BUILT AROUND. A false positive welds two unrelated shows
 * together permanently: the store's union-find has no unlink, and a merged cluster then goes on to
 * weld a third. A false negative means one streaming source does not show up for one show. So the
 * objective reported here is maximum recall subject to essentially zero false positives on HARD
 * negatives, never best F1. F1 would trade a permanent lie for a recoverable nuisance at par.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it } from 'vite-plus/test'

import {
  bestTitleScore,
  franchiseTitle,
  searchRelevance,
  simplifyTitle,
  stripTitle,
  titleSimilarity,
} from '../src/sources/utils'
import { SEASON_MARKER } from '../src/sources/season'
import { profileCluster } from '../src/worker/store/fuzzy-merge'

/* ------------------------------------------------------------------------------------------------
 * Corpus
 * ---------------------------------------------------------------------------------------------- */

// node_modules/.cache is where scripts/build-anime-data.mjs already keeps its manami extract, so the
// corpus and the report land beside it: gitignored, survives between runs, and cleared by the same
// `rm -rf node_modules` everything else is.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const CORPUS_PATH = process.env.CORPUS_PATH ?? resolve(ROOT, 'node_modules/.cache/manami-titles.json')
const OUT_DIR = process.env.CALIBRATION_OUT ?? resolve(ROOT, 'node_modules/.cache/calibration')

type Record_ = {
  sources: string[]
  title: string
  synonyms: string[]
  type: string
  year: number | null
  season: string | null
  episodes: number | null
  related: string[]
}

type Corpus = { tag: string, updated: string, records: Record_[] }

// A missing corpus must never read as "nothing to calibrate". It is the exact shape of a rig that
// reports success unconditionally, so this throws with the command that produces the file rather
// than skipping, and the message names the generator that lives beside this harness.
const loadCorpus = (): Corpus => {
  if (!existsSync(CORPUS_PATH)) {
    throw new Error(
      `no corpus at ${CORPUS_PATH}\n`
      + `Regenerate it with:\n`
      + `  node scripts/fetch-title-corpus.mjs ${CORPUS_PATH}\n`
      + `or point CORPUS_PATH at an existing copy:\n`
      + `  CORPUS_PATH=/path/to/manami-titles.json ./node_modules/.bin/vitest run `
      + `--config vitest.calibration.config.ts --disableConsoleIntercept --reporter=verbose`
    )
  }
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as Corpus
  if (!Array.isArray(corpus.records) || corpus.records.length < 30_000) {
    throw new Error(
      `corpus at ${CORPUS_PATH} holds ${corpus.records?.length ?? 0} records, expected 30000 or more. `
      + `A truncated download must not pass as a corpus.`
    )
  }
  return corpus
}

/* ------------------------------------------------------------------------------------------------
 * Seeded sampling
 * ---------------------------------------------------------------------------------------------- */

/**
 * mulberry32. Written out rather than pulled in so the sample is reproducible across runs, machines
 * and dependency versions: a calibration nobody else can reproduce is worth nothing, and Math.random
 * would make every rerun disagree with the report it is being compared against.
 */
const mulberry32 = (seed: number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = Number(process.env.CALIBRATION_SEED ?? 20260829)

// partial Fisher-Yates: only the prefix that is actually taken is shuffled, so sampling 30k out of
// 243k costs 30k swaps rather than a full permutation
const sample = <T>(items: readonly T[], count: number, rand: () => number): T[] => {
  const pool = items.slice()
  const take = Math.min(count, pool.length)
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rand() * (pool.length - i))
    const tmp = pool[i]!
    pool[i] = pool[j]!
    pool[j] = tmp
  }
  return pool.slice(0, take)
}

/* ------------------------------------------------------------------------------------------------
 * The fuzzy-merge model, driven through the REAL profileCluster
 *
 * This section used to be four hand-copied mirrors of unexported fuzzy-merge internals, with a header
 * conceding that "a mirror that has fallen behind still scores every pair and still prints a table"
 * and that no control could catch it. It does not have to be that way: `profileCluster` IS exported,
 * and importing `src/worker/store/fuzzy-merge.ts` under this config costs nothing (it reaches
 * `./db` -> `./graph` + `./events`, and no further, so none of the browser-only surface the extractors
 * drag in is on the path). Measured: the module imports and profiles a cluster in ~130ms here.
 *
 * ONE DEPENDENCY TO KNOW ABOUT: `profileCluster` is module-private at 54aedd4 and public only in the
 * working tree, where the re-check-before-linking pass needs it at two call sites. This file is
 * therefore calibrated against the working tree rather than against the last commit, which is the
 * right target (the point is to calibrate what will ship), but the import breaks outright if that
 * export is reverted, and it will break loudly rather than quietly. Nothing else here reaches into
 * fuzzy-merge, so re-privatising it costs exactly this one import.
 *
 * So the year, format, season and identity vetoes below are now the production ones, obtained by
 * profiling a cluster rather than by re-deriving what profiling would have said. What that removed,
 * and it was not cosmetic in either case:
 *
 *   - the season mirror read `parseSeasonNumber` off the two PRIMARY titles only, where production
 *     reads it off EVERY raw title the cluster holds. The mirror's season veto was therefore weaker
 *     than the shipped one, in the direction that lets more hard negatives through.
 *   - the format mirror read manami's `type` alone, where production reads `media.categories` as well
 *     and keeps SPECIAL, OVA and ONA format-neutral. The two agreed here only because the mirror
 *     duplicated the neutrality rule correctly, which is exactly the agreement a copy stops making
 *     the first time production moves.
 *
 * Two copies survive below, `maxPossibleSimilarity` and `differOnlyByTrailingNumber`, because
 * fuzzy-merge exports neither. Both are covered: the bound-violation scan at the bottom of this file
 * is a live drift detector for the first (it asserts the scan can produce a non-zero count, so a
 * count of zero at the shipped threshold is readable), and the anchors block pins the second to the
 * two pairs fuzzy-merge.ts's own comment measures.
 * ---------------------------------------------------------------------------------------------- */

/**
 * A corpus record as the store actually holds it.
 *
 * These are exactly the fields src/sources/offline/normalize.ts:98-109 puts on a manami media, which
 * is what makes handing the profile the corpus `type` verbatim correct rather than lucky: manami's
 * type strings ARE the MediaType values ('TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL'), so production's own
 * `media.type === 'SPECIAL' || 'OVA' || 'ONA'` neutrality reads them without a translation step.
 * The corpus carries a year and no month, and profileCluster only ever takes the UTC year back off
 * `startDate`, so January 1st is not an approximation here.
 */
const asMedia = (uri: string, titles: readonly string[], type: string, year: number | null) =>
  ({
    uri,
    origin: 'offline',
    type,
    categories: type === 'MOVIE' ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES'],
    startDate: year === null ? null : `${year}-01-01`,
    titles: titles.filter(title => Boolean(title?.trim())).map(title => ({ title, score: 0.9 })),
  }) as unknown as Parameters<typeof profileCluster>[0][number]

/**
 * The store's own normalizeTitle AND its own carriesIdentity filter, read off a one-title cluster.
 *
 * `undefined` means the title does not carry an identity, which is production's answer too:
 * selectTitles drops it and the cluster then compares on the titles that are left. Cached because the
 * same title is profiled once per gate per sweep.
 */
const normalizedForMerge = new Map<string, string | undefined>()
const normalizeForMerge = (title: string): string | undefined => {
  if (normalizedForMerge.has(title)) return normalizedForMerge.get(title)
  const value = profileCluster([asMedia('offline:probe', [title], 'TV', 2000)]).titles[0]
  normalizedForMerge.set(title, value)
  return value
}

/** The year, format and season sets one side of a pair contributes, as the store would compute them. */
type MergeProfile = Pick<ReturnType<typeof profileCluster>, 'years' | 'formats' | 'seasons'>
const mergeProfiles = new Map<string, MergeProfile>()
const mergeProfile = (
  title: string,
  others: readonly string[],
  type: string,
  year: number | null
): MergeProfile => {
  const key = JSON.stringify([title, others, type, year])
  const cached = mergeProfiles.get(key)
  if (cached) return cached
  const { years, formats, seasons } = profileCluster([asMedia('offline:probe', [title, ...others], type, year)])
  const value = { years, formats, seasons }
  mergeProfiles.set(key, value)
  return value
}

// mirror of maxPossibleSimilarity in src/worker/store/fuzzy-merge.ts. Under frizbee it is not an exact
// upper bound on titleSimilarity, because it is a character count ratio and cannot account for the
// flat prefix bonus of 12 and exact bonus of 8. The sweep below reports how often that matters.
const maxPossibleSimilarity = (a: string, b: string) => {
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

// mirror of trailingNumber + differOnlyByTrailingNumber, src/worker/store/fuzzy-merge.ts:109-121
const trailingNumber = (title: string) => {
  const match = /^(.*?)\s*(\d+)$/.exec(title)
  return match ? { stem: match[1]!, value: Number(match[2]) } : { stem: title, value: null }
}
const differOnlyByTrailingNumber = (a: string, b: string) => {
  const left = trailingNumber(a)
  const right = trailingNumber(b)
  return left.value !== right.value && left.stem === right.stem
}

// mirror of the categories offline/normalize.ts:103 attaches, and of the ['MOVIE'] / ['SERIES'] pair
// unogs/extractor.ts:257 attaches to a search hit. The gate at utils.ts:285-288 vetoes only on a
// DISAGREEMENT, so both sides must be modelled or the veto looks stricter than it is.
const ourCategories = (type: string) => (type === 'MOVIE' ? ['ANIME', 'MOVIE'] : ['ANIME', 'SERIES'])
const catalogueCategories = (type: string) => (type === 'MOVIE' ? ['MOVIE'] : ['SERIES'])

/* ------------------------------------------------------------------------------------------------
 * Ground truth labelling
 * ---------------------------------------------------------------------------------------------- */

/**
 * THE POLARITY TRAP, and the reason this function exists.
 *
 * The same corpus pair has OPPOSITE ground truth at different gates. ("Mushoku Tensei Season 2",
 * "Mushoku Tensei") is a POSITIVE at justwatch, appletv, unogs and crunchyroll, because those
 * catalogues model one show entity per franchise and the extractor resolves the season on a separate
 * axis afterwards, so linking show-level to our season-level media is the intended behaviour. The
 * identical pair is a HARD NEGATIVE at fuzzy-merge, where both sides are OUR OWN season-level
 * clusters and merging them is the exact failure the year, format and season vetoes exist to stop.
 *
 * manami's `related` does not distinguish "another season of this show" from "a spin-off", so the
 * split has to come from somewhere. It must NOT come from franchiseTitle: that is the very function
 * the crunchyroll gate runs, and labelling ground truth with the thing under test measures the test
 * against itself. So the split is made lexically here, with SEASON_MARKER, which is a plain regex
 * list in src/sources/season.ts with no dependency on sacha or on frizbee.
 *
 * Worked: "Attack on Titan Season 3 Part 2" and "Attack on Titan" both reduce to "attack on titan",
 * so SAME_SHOW. "Attack on Titan" and "Attack on Titan: Junior High" reduce to "attack on titan" and
 * "attack on titan junior high", so DIFFERENT_ENTRY, and so do Gaiden and "Steins;Gate 0".
 */
const seasonless = (title: string) =>
  stripTitle(SEASON_MARKER.reduce((text, marker) => text.replace(marker, ' '), title))

const relationOf = (a: string, b: string): 'same-show' | 'different-entry' =>
  seasonless(a) === seasonless(b) && seasonless(a) !== '' ? 'same-show' : 'different-entry'

/* ------------------------------------------------------------------------------------------------
 * Structural buckets for the positive set
 *
 * The synonym lists are NOISY: record "!NVADE SHOW!" carries the synonym "RAISE A SUILEN", which is
 * the band the special belongs to, not another name for it. A naive "every synonym pair must pass"
 * objective drags any threshold to the floor chasing pairs no character matcher can ever reach.
 *
 * These buckets are computed from the STRINGS ALONE, never from a score, so they cannot manufacture
 * the answer they are used to explain. The unfiltered curve is reported first and in full; the bucket
 * split is reported beside it as an explanation of the ceiling, not as a substitute for it.
 * ---------------------------------------------------------------------------------------------- */

const SCRIPT_TESTS: [string, RegExp][] = [
  ['latin', /\p{Script=Latin}/u],
  ['han', /\p{Script=Han}/u],
  ['kana', /\p{Script=Hiragana}|\p{Script=Katakana}/u],
  ['hangul', /\p{Script=Hangul}/u],
  ['cyrillic', /\p{Script=Cyrillic}/u],
  ['arabic', /\p{Script=Arabic}/u],
  ['thai', /\p{Script=Thai}/u],
]

const scriptsOf = (text: string) => new Set(SCRIPT_TESTS.filter(([, re]) => re.test(text)).map(([name]) => name))

const tokensOf = (title: string) => new Set(stripTitle(title).split(' ').filter(Boolean))

type PositiveBucket = 'cross-script' | 'no-token-overlap' | 'token-overlap'

const bucketOf = (a: string, b: string): PositiveBucket => {
  const scriptsA = scriptsOf(a)
  const scriptsB = scriptsOf(b)
  if (scriptsA.size && scriptsB.size && ![...scriptsA].some(script => scriptsB.has(script))) return 'cross-script'
  const tokensA = tokensOf(a)
  const tokensB = tokensOf(b)
  if ([...tokensA].some(token => tokensB.has(token))) return 'token-overlap'
  return 'no-token-overlap'
}

/* ------------------------------------------------------------------------------------------------
 * Pairs
 * ---------------------------------------------------------------------------------------------- */

type PairKind = 'synonym' | 'related-same-show' | 'related-different-entry' | 'random'

type Pair = {
  kind: PairKind
  /** our side: the title the store's cluster carries */
  left: string
  /** the rest of our cluster's titles, for the gates whose left side is a LIST and takes the max */
  leftOthers: string[]
  /** the catalogue side, or the other cluster at fuzzy-merge */
  right: string
  /**
   * the rest of the RIGHT cluster's titles. Only fuzzy-merge has one: there both sides are clusters of
   * ours, so both sides carry a name set and both sides' season and format vetoes read the whole set.
   * At every streaming gate the right side is one catalogue search result and there is nothing else to
   * put here, which is why this is empty for a synonym pair: the other cluster is being modelled as
   * knowing that one name.
   */
  rightOthers: string[]
  leftType: string
  rightType: string
  leftYear: number | null
  rightYear: number | null
  /**
   * manami's `animeSeason.season`: WINTER, SPRING, SUMMER, FALL or UNDEFINED. Carried because it is
   * the FINEST date resolution this corpus has, and the justwatch/appletv date-axis models below are
   * the only thing that reads it. There is no day in the corpus at all, so a 45-day window is not
   * expressible here and the quarter models say so in their own names rather than pretending.
   */
  leftSeason: string | null
  rightSeason: string | null
  /**
   * THE DATES THE CATALOGUE ENTRY ITSELF COVERS, which is not the same thing as the date of the one
   * record on the right, and the distinction decides the whole justwatch design.
   *
   * justwatch and appletv both model a franchise as ONE show entity carrying several seasons. Our media
   * is one season. So there are two completely different date checks available and they have opposite
   * recall behaviour:
   *
   *   SHOW-LEVEL. Compare our start year against the show's `content.originalReleaseYear`, which is the
   *   FIRST season's year. For a media that is season 3 of anything, this refuses a correct match for a
   *   structural reason, and season sequels are exactly what this change exists to recover. The
   *   `SAME YEAR` and `SAME QUARTER` gates model this, because they compare our record's date against
   *   the ONE record on the other side.
   *
   *   SEASON-LEVEL. Ask whether ANY season of the show carries our year. justwatch's NODE_QUERY already
   *   requests `seasons { content { originalReleaseYear } }` at extractor.ts:174 and the details call is
   *   already made at extractor.ts:416 BEFORE the gate, so this costs no extra request; only the
   *   `JWSeason` interface at extractor.ts:249 omits the field, so the data arrives and TypeScript drops
   *   it. appletv reaches the same thing through `AppleEpisode.releaseDate`, which `fetchEpisodes`
   *   already pulls per season.
   *
   * These two fields model the season-level check. The set is the right-hand record plus every record
   * manami relates to it that `relationOf` calls same-show, which is the closest this corpus gets to
   * "the seasons a catalogue would file under one show". A correct match then always contains our own
   * year, so the season-level check costs recall only on records manami never dated, while a wrong
   * candidate still has to share a year with a franchise it does not belong to.
   */
  rightShowYears: number[]
  rightShowQuarters: number[]
}

/* ------------------------------------------------------------------------------------------------
 * The DATE axis, at the two resolutions the two catalogues can actually supply
 *
 * WHAT THE CORPUS HAS, and it decides what can honestly be claimed. manami carries `animeSeason` as
 * {year, season} and NOTHING finer: 41537 records, 39980 with a year, and 6486 whose season is the
 * literal string 'UNDEFINED'. There is no month and no day anywhere in it. So the 45-day window
 * crunchyroll ships (extractor.ts:302) CANNOT be measured on this corpus, and any row claiming to be
 * one would be a quarter row wearing a different label.
 *
 * What is measurable is a ladder of buckets, and one rung of it is a genuine BOUND rather than an
 * approximation:
 *
 *   SAME YEAR          365 days wide, and the coarsest thing justwatch's originalReleaseYear can
 *                      support. This is not an approximation of anything, it IS justwatch's axis.
 *   YEAR +/- 1         two years wide. Modelled because a show premiering in late December sits in a
 *                      different calendar year from the catalogue's release year for it, and an exact
 *                      year match refuses that correct pair for a rounding reason.
 *   SAME QUARTER       ~91 days. Neither a lower nor an upper bound on a 45-day window: two dates 30
 *                      days apart straddling New Year are in different quarters, and two dates in one
 *                      quarter can be 89 days apart. Reported because it is the closest single bucket.
 *   ADJACENT QUARTER   ~182 days, and a STRICT SUPERSET of "within 45 days": two dates 45 days apart
 *                      are necessarily in the same or neighbouring quarter, so every pair a 45-day
 *                      window admits is admitted here too. Its hard-negative pass rate is therefore an
 *                      upper bound on the 45-day window's, which is the direction a safety claim needs,
 *                      and its recall is an upper bound too, which is the direction a recall claim must
 *                      NOT be read in.
 *
 * MISSING IS A REFUSAL, never a guess, which is the rule crunchyroll's own header states at
 * extractor.ts:296-299. A null year or an UNDEFINED season on either side fails every predicate here.
 * That costs recall on records manami never dated, and the diagnostics block below reports that cost
 * separately so it is not misread as the date logic being strict.
 *
 * THE ONE THING THIS MODEL FLATTERS, stated here because no number below repeats it. Both sides of a
 * SYNONYM pair are two names off ONE manami record, so they carry one year and one season between
 * them and no date predicate can ever refuse a synonym positive. Production has no such guarantee:
 * our media's startDate comes from AniList and the catalogue's year comes from the catalogue, and they
 * disagree for regional releases and for December premieres. So the date axis's recall cost is
 * measurable here ONLY on the related-same-show arm, where it is real and large, and every aggregate
 * recall number in a date-vetoed row is an OVERSTATEMENT by exactly the amount the synonym arm gets
 * for free.
 * ---------------------------------------------------------------------------------------------- */

const QUARTER_INDEX: Record<string, number> = { WINTER: 0, SPRING: 1, SUMMER: 2, FALL: 3 }

/** A quarter number on one axis, so adjacency across a year boundary is a subtraction, not a case. */
const quarterOf = (year: number | null, season: string | null): number | null => {
  if (year === null) return null
  const offset = season === null ? undefined : QUARTER_INDEX[season]
  return offset === undefined ? null : year * 4 + offset
}

const yearWithin = (pair: Pair, slack: number) =>
  pair.leftYear !== null && pair.rightYear !== null && Math.abs(pair.leftYear - pair.rightYear) <= slack

const quarterWithin = (pair: Pair, slack: number) => {
  const left = quarterOf(pair.leftYear, pair.leftSeason)
  const right = quarterOf(pair.rightYear, pair.rightSeason)
  return left !== null && right !== null && Math.abs(left - right) <= slack
}

/** the season-level checks: does ANY season the catalogue files under this show carry our date */
const yearInShow = (pair: Pair) =>
  pair.leftYear !== null && pair.rightShowYears.includes(pair.leftYear)

const quarterInShow = (pair: Pair, slack: number) => {
  const left = quarterOf(pair.leftYear, pair.leftSeason)
  return left !== null && pair.rightShowQuarters.some(quarter => Math.abs(quarter - left) <= slack)
}

/** the whole cluster's name set, which is what `media.titles` is at every one of these call sites */
const wholeList = (pair: Pair) => [pair.left, ...pair.leftOthers]

/* ------------------------------------------------------------------------------------------------
 * Gate models
 *
 * One entry per real gate, each reproducing what that call site actually compares. Getting this wrong
 * is the cheapest way to produce a confident number about nothing, so every model names its line.
 * ---------------------------------------------------------------------------------------------- */

type GateArm = 'positive' | 'hard-negative' | 'easy-negative'

type Gate = {
  name: string
  site: string
  /** how this gate reads each kind of corpus pair. The polarity differs per gate, deliberately. */
  arm: (kind: PairKind) => GateArm
  current: number
  /** the reported sweep window for this gate, per the family its threshold belongs to */
  grid: readonly number[]
  /** false when the pair never reaches the score because a veto refused it first */
  reaches: (pair: Pair) => boolean
  score: (pair: Pair) => Promise<number>
  /** fuzzy-merge only: the character-count prefilter that can refuse a pair before the wasm runs */
  bound?: (pair: Pair) => number
  /**
   * Set where a passing hard negative is NOT an error at this gate, which is true at exactly one of
   * them. Nothing is linked on the search path, so a related entry showing up in a search list is the
   * behaviour a user wants, not a weld. The column is still measured and still printed, because the
   * shape of the curve is the same question; only the sign of the cost differs, and stating that in
   * the gate rather than in a footnote keeps the recommendation from being read off the wrong column.
   */
  hardNegativesAreAcceptable?: string
}

const STREAMING_ARM = (kind: PairKind): GateArm =>
  kind === 'synonym' || kind === 'related-same-show' ? 'positive'
  : kind === 'related-different-entry' ? 'hard-negative'
  : 'easy-negative'

const MERGE_ARM = (kind: PairKind): GateArm =>
  kind === 'synonym' ? 'positive'
  : kind === 'random' ? 'easy-negative'
  : 'hard-negative'

const gates = (): Gate[] => [
  {
    name: 'fuzzy-merge',
    site: 'src/worker/store/fuzzy-merge.ts:131/133/134 SIMILARITY_THRESHOLD (declared :7)',
    arm: MERGE_ARM,
    current: 0.9,
    grid: HIGH_GRID,
    // every veto the pair has to survive before sameShow ever computes a score, all of them read off
    // the PRODUCTION profile: the caller's year bucketing, then format, then season, then the
    // trailing-number rule, then selectTitles' carriesIdentity filter on both titles
    reaches: pair => {
      const a = mergeProfile(pair.left, pair.leftOthers, pair.leftType, pair.leftYear)
      const b = mergeProfile(pair.right, pair.rightOthers, pair.rightType, pair.rightYear)
      // fuzzyMergeMediaClusters buckets by year and only compares within a bucket, so two clusters
      // that share no year are never put in front of sameShow at all
      if (![...a.years].some(year => b.years.has(year))) return false
      if (a.formats.size && b.formats.size && ![...a.formats].some(format => b.formats.has(format))) return false
      if (a.seasons.size && b.seasons.size && ![...a.seasons].some(season => b.seasons.has(season))) return false
      const left = normalizeForMerge(pair.left)
      const right = normalizeForMerge(pair.right)
      if (left === undefined || right === undefined) return false
      if (differOnlyByTrailingNumber(left, right)) return false
      return true
    },
    // the `titleA === titleB` shortcut at :131 is an implicit similarity of 1.0 and bypasses both the
    // prefilter and the wasm, so it is modelled as a score of exactly 1
    score: async pair => {
      const a = normalizeForMerge(pair.left)
      const b = normalizeForMerge(pair.right)
      if (a === undefined || b === undefined) return 0
      if (a === b) return 1
      return titleSimilarity(a, b)
    },
    bound: pair => {
      const a = normalizeForMerge(pair.left)
      const b = normalizeForMerge(pair.right)
      if (a === undefined || b === undefined) return 0
      return a === b ? 1 : maxPossibleSimilarity(a, b)
    },
  },
  {
    name: 'unogs-pickTitleMatch',
    site: 'src/sources/utils.ts:290 TITLE_MATCH_THRESHOLD (declared :248)',
    arm: STREAMING_ARM,
    current: 0.44,
    grid: LOW_GRID,
    // the category DISAGREEMENT veto at utils.ts:285-288, which runs BEFORE the score. It is what
    // separates "One Piece Film: Red" from a series cluster, and scoring the gate without it makes
    // 0.44 look far more dangerous than it is.
    reaches: pair => {
      const ours = ourCategories(pair.leftType)
      const theirs = catalogueCategories(pair.rightType)
      return ours.some(category => theirs.includes(category))
    },
    // unogs passes the CURRENT RUNG of the simplify loop to pickTitleMatch, not the original title, so
    // a fair model asks whether ANY rung clears. This is the one gate whose left side moves.
    score: async pair => {
      let best = 0
      for (const rung of [pair.left, ...simplifyTitle(pair.left)]) {
        const score = await titleSimilarity(rung, pair.right)
        if (score > best) best = score
      }
      return best
    },
  },
  {
    name: 'justwatch/appletv AS SHIPPED',
    site: 'src/sources/justwatch/extractor.ts:421 (declared :408), src/sources/appletv/extractor.ts:137 (bare literal)',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: LOW_GRID,
    reaches: () => true,
    // Both loops iterate the simplifyTitle rungs and then score the ORIGINAL title, so the rung buys a
    // better search hit and is thrown away at the gate. The score therefore does not depend on the
    // rung at all, which is what this model reproduces.
    score: pair => titleSimilarity(pair.left, pair.right),
  },
  {
    name: 'justwatch/appletv WITH THE RUNG',
    site: 'hypothetical: score the rung that found the hit, the way unogs already does',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: LOW_GRID,
    reaches: () => true,
    score: async pair => {
      let best = 0
      for (const rung of [pair.left, ...simplifyTitle(pair.left)]) {
        const score = await titleSimilarity(rung, pair.right)
        if (score > best) best = score
      }
      return best
    },
  },
  {
    name: 'justwatch/appletv WITH franchiseTitle',
    site: 'hypothetical: season-strip both sides, the way bestTitleScore already does',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: LOW_GRID,
    reaches: () => true,
    score: pair => bestTitleScore([pair.left], pair.right),
  },
  /**
   * THE 2x2 DECOMPOSITION of crunchyroll's 0.4000 margin, applied to justwatch and appletv.
   *
   * crunchyroll's gate differs from the justwatch/appletv one on TWO axes at once, and reading the two
   * rows against each other attributes the whole difference to whichever axis the reader had in mind:
   *
   *                          | primary title only            | the cluster's WHOLE title list
   *   ----------------------- ------------------------------- ---------------------------------------
   *   raw titleSimilarity     | 'AS SHIPPED', above           | 'WHOLE LIST no franchiseTitle', below
   *   franchiseTitle on both  | 'WITH franchiseTitle', above  | IS 'crunchyroll-bestTitleScore', below
   *
   * The fourth cell is not added as a row because it already exists: `bestTitleScore(whole list,
   * candidate)` IS the crunchyroll model, byte for byte, and the distinctness control would (rightly)
   * refuse two gates producing an identical sweep. So the decomposition is three new numbers against
   * one existing one, and the block that prints it names the cell it is borrowing.
   *
   * Only the third cell is new, and it is the one that answers the question: whole list WITHOUT the
   * season stripping. Against 'AS SHIPPED' it isolates the list; against crunchyroll it isolates
   * franchiseTitle.
   */
  {
    name: 'jw/atv WHOLE LIST no franchiseTitle',
    site: 'hypothetical: score every title the cluster knows, the way crunchyroll does, but WITHOUT sacha',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: () => true,
    score: async pair => {
      const scores = await Promise.all(wholeList(pair).map(title => titleSimilarity(title, pair.right)))
      return scores.length ? Math.max(...scores) : 0
    },
  },
  /**
   * THE DATE AXIS, four resolutions, all on the crunchyroll title model.
   *
   * Each of these is `bestTitleScore(whole list, candidate)` (the crunchyroll title axis, unchanged)
   * with a date predicate as the `reaches` veto, so the difference between any of them and the
   * `crunchyroll-bestTitleScore` row is the DATE and nothing else. That is what makes the floor column
   * readable: the floor is the hard negatives that survive at a threshold of 1.00, which is exactly the
   * set the date axis exists to clean up, and comparing floors across these rows says how much of it
   * each resolution actually removes.
   *
   * WHICH SOURCE EACH ONE IS FOR, since the two catalogues supply different resolutions:
   *
   *   justwatch supplies a YEAR. `node.content.originalReleaseYear` (extractor.ts:368) is a year, and
   *   so is the per-season `seasons.content.originalReleaseYear` the NODE_QUERY already asks for at
   *   extractor.ts:174. Both SAME YEAR and YEAR +/- 1 are expressible there and nothing finer is.
   *
   *   appletv supplies a TIMESTAMP. `content.releaseDate` (extractor.ts:79) is milliseconds, and so is
   *   the per-episode `AppleEpisode.releaseDate` the episodes call already returns. A real 45-day
   *   window is expressible there, so ADJACENT QUARTER is carried as its upper bound and SAME QUARTER
   *   as the nearest single bucket. Neither is the window itself; the corpus has no day.
   */
  {
    name: 'jw/atv WHOLE LIST + franchise + SAME YEAR',
    site: 'hypothetical justwatch: crunchyroll title axis + originalReleaseYear equality (extractor.ts:174/368)',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => yearWithin(pair, 0),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  {
    name: 'jw/atv WHOLE LIST + franchise + YEAR +/-1',
    site: 'hypothetical justwatch: the same axis with one year of slack for a December premiere',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => yearWithin(pair, 1),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  {
    name: 'jw/atv WHOLE LIST + franchise + SAME QUARTER',
    site: 'hypothetical appletv: crunchyroll title axis + a ~91 day bucket (releaseDate, extractor.ts:79)',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => quarterWithin(pair, 0),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  {
    name: 'jw/atv WHOLE LIST + franchise + ADJACENT QUARTER',
    site: 'hypothetical appletv: a STRICT SUPERSET of a 45 day window, so its hard-negative rate bounds it',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => quarterWithin(pair, 1),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  /**
   * THE SEASON-LEVEL DATE CHECKS, which are the ones that would actually ship.
   *
   * Same title scoring again, and the only change from the two rows above is WHICH date the catalogue
   * side contributes: the show's own (its first season's) against every season the show carries. Read
   * the pair of rows together and the difference is the entire cost of gating a season-level media
   * against a show-level date, which is the mistake this pair exists to make visible before it is
   * written into an extractor.
   *
   * Neither costs an extra request. justwatch already has the per-season years in the details response
   * it fetches before the gate (NODE_QUERY at extractor.ts:174, dropped by the JWSeason interface at
   * extractor.ts:249); appletv already pulls per-episode releaseDate in fetchEpisodes.
   */
  {
    name: 'jw/atv WHOLE LIST + franchise + YEAR IN SHOW',
    site: 'hypothetical justwatch: any season of the hit carries our year (seasons.content.originalReleaseYear)',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => yearInShow(pair),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  {
    name: 'jw/atv WHOLE LIST + franchise + QUARTER IN SHOW +/-1',
    site: 'hypothetical appletv: an episode of the hit within a quarter of ours, bounding a 45 day window',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => quarterInShow(pair, 1),
    score: pair => bestTitleScore(wholeList(pair), pair.right),
  },
  /**
   * Is the date axis a SUBSTITUTE for the whole title list, or does it only stack with it?
   *
   * Worth its own row because it is the cheapest possible change: keep reading getFirstTitle, add a
   * year check. If this row's margin approaches the whole-list rows, the list is not the lever after
   * all and the smaller change ships. If it does not, the answer is that the two axes are independent
   * and both are needed, which is what crunchyroll's own header claims about ITS two axes.
   */
  {
    name: 'jw/atv PRIMARY + franchise + SAME YEAR',
    site: 'hypothetical: the cheapest change, getFirstTitle kept and a year check added',
    arm: STREAMING_ARM,
    current: 0.5,
    grid: WIDE_GRID,
    reaches: pair => yearWithin(pair, 0),
    score: pair => bestTitleScore([pair.left], pair.right),
  },
  {
    name: 'crunchyroll-bestTitleScore',
    site: 'src/sources/crunchyroll/extractor.ts:336 CONFIDENT_TITLE_THRESHOLD (declared :301)',
    arm: STREAMING_ARM,
    current: 0.9,
    grid: HIGH_GRID,
    reaches: () => true,
    // The left side is the cluster's WHOLE title list and bestTitleScore takes the max over it, so
    // modelling it as one string makes the gate look stricter than it is.
    //
    // And the list is UNCAPPED. crunchyroll/extractor.ts:319 builds it as
    // `(known.titles ?? []).map(title => title.title).filter(Boolean)` and hands all of it to
    // bestTitleScore; the only caps on that path are MAX_SERIES_CANDIDATES and MAX_SEARCH_QUERIES,
    // neither of which touches the title list. This model used to slice it to 6, which is
    // fuzzy-merge's MAX_TITLES_PER_CLUSTER: that constant bounds a different gate's O(n^2) loop and
    // has nothing to say here. The corpus carries 14 synonyms at p90 and 124 at the maximum, so the
    // slice was truncating the list on a real fraction of records, and it truncated it in the
    // dangerous direction: fewer names tried is both less recall AND fewer chances to weld, so the
    // gate came out looking safer than the one that ships.
    score: pair => bestTitleScore([pair.left, ...pair.leftOthers], pair.right),
  },
  /**
   * SEARCH_RELEVANCE_THRESHOLD, which the briefed list of five thresholds left out and which is a real
   * gate on the same wasm.
   *
   * Two models, because the production left side has no single faithful stand-in. The query is a user
   * fragment ('frieren', 'aot'), and the corpus holds no queries. The nearest corpus-grounded thing is
   * a name the show is actually known by that this media's own title list does NOT contain, which is
   * exactly a synonym pair, so the query is modelled as the synonym and the media as the record.
   *
   * WHOLE LIST is production-faithful: media.titles carries every name every source supplied, and
   * searchRelevance takes the max over all of them. PRIMARY ONLY is the worst case, a media that ended
   * up carrying one name, and it is the model that says what the threshold does when the list cannot
   * rescue the query. Both are reported because the answer differs between them and the difference is
   * the point.
   *
   * The scale is NOT titleSimilarity's. searchScore normalizes by the QUERY length and short-circuits
   * to a flat 1.0 on contiguous containment, so it saturates instead of penalising a long title. A
   * number from this gate cannot be compared with a number from any other gate here.
   */
  {
    name: 'search-relevance WHOLE LIST',
    site: 'src/worker/resolvers/media/index.ts:230 SEARCH_RELEVANCE_THRESHOLD (declared src/sources/utils.ts:317)',
    arm: STREAMING_ARM,
    current: 0.7,
    grid: SEARCH_GRID,
    reaches: () => true,
    hardNegativesAreAcceptable:
      'nothing is linked on this path. A related entry passing is a related entry LISTED, which is what '
      + 'a user searching a franchise name wants. The column to read here is the easy negatives.',
    score: pair => searchRelevance(pair.right, [pair.left, ...pair.leftOthers]),
  },
  {
    name: 'search-relevance PRIMARY ONLY',
    site: 'src/worker/resolvers/media/index.ts:136, worst case: a media carrying one title',
    arm: STREAMING_ARM,
    current: 0.7,
    grid: SEARCH_GRID,
    reaches: () => true,
    hardNegativesAreAcceptable:
      'same as the whole-list model: this path links nothing and is fully reversible.',
    score: pair => searchRelevance(pair.right, [pair.left]),
  },
]

/* ------------------------------------------------------------------------------------------------
 * Sweep
 * ---------------------------------------------------------------------------------------------- */

type Scored = { pair: Pair, arm: GateArm, score: number, reached: boolean, bound: number }

type Row = {
  threshold: number
  positive: { passed: number, total: number }
  hardNegative: { passed: number, total: number }
  easyNegative: { passed: number, total: number }
}

/**
 * The reported sweep window is PER GATE, because the two families of threshold sit on the same scale
 * but in different parts of it and a shared grid wastes its resolution.
 *
 * A step of 0.01 rather than 0.02 is not cosmetic here. The gap this whole exercise exists to close is
 * 0.447 to 0.500, which is five hundredths wide: on a 0.02 grid the binding row for that question does
 * not exist, and the answer has to be interpolated from the two rows either side of it.
 *
 * FULL_GRID is separate and is never rendered. It exists so the irreducible floor (the hard negatives
 * that pass at a threshold of 1.00 and therefore at every threshold) is read off a row that actually
 * holds 1.00, rather than off whichever row happens to end the reported window. A window ending at
 * 0.70 would otherwise report its own top row's rate as the floor and every saturation point computed
 * from it would be wrong in the direction that looks safe.
 */
const gridOf = (from: number, to: number, step: number) =>
  Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(2)))

/** the 0.44 and 0.5 family: unogs, justwatch, appletv */
const LOW_GRID = gridOf(0.30, 0.70, 0.01)
/**
 * The proposed justwatch/appletv models, which straddle both families and so cannot use either window.
 *
 * They are compared against the 0.50 those two sites ship today, which is in the LOW family, and their
 * recommendation is expected to land near crunchyroll's 0.90, which is in the HIGH one. A window
 * covering only one of the two would make the shipped row or the recommended row unprintable, and the
 * fallback for a recommendation outside the window is `saturationFull`, which is correct but arrives
 * with no table under it to argue with.
 */
const WIDE_GRID = gridOf(0.30, 0.99, 0.01)
/** the 0.9 family: crunchyroll's CONFIDENT_TITLE_THRESHOLD and fuzzy-merge's SIMILARITY_THRESHOLD */
const HIGH_GRID = gridOf(0.75, 0.99, 0.01)
/** the search gate sits at 0.7 on a saturating scale of its own, so it gets the whole range */
const SEARCH_GRID = gridOf(0.30, 0.99, 0.01)
const FULL_GRID = gridOf(0, 1, 0.01)

const passes = (entry: Scored, threshold: number, gate: Gate) => {
  if (!entry.reached) return false
  // fuzzy-merge skips the wasm when the character-count bound cannot reach the threshold, so a pair
  // the bound refuses never merges even if frizbee would have scored it above the line
  if (gate.bound && entry.score !== 1 && entry.bound < threshold) return false
  return entry.score >= threshold
}

const sweep = (entries: Scored[], gate: Gate, thresholds: readonly number[]): Row[] =>
  thresholds.map(threshold => {
    const row: Row = {
      threshold,
      positive: { passed: 0, total: 0 },
      hardNegative: { passed: 0, total: 0 },
      easyNegative: { passed: 0, total: 0 },
    }
    for (const entry of entries) {
      const bucket =
        entry.arm === 'positive' ? row.positive
        : entry.arm === 'hard-negative' ? row.hardNegative
        : row.easyNegative
      bucket.total++
      if (passes(entry, threshold, gate)) bucket.passed++
    }
    return row
  })

const rate = (bucket: { passed: number, total: number }) => (bucket.total ? bucket.passed / bucket.total : 0)

const pct = (value: number) => `${(value * 100).toFixed(3)}%`
const pad = (text: string, width: number) => text.padStart(width)

const renderTable = (rows: Row[], current: number, recommended: number) => {
  const lines = [
    '  thr    positives passed        hard negatives passed     easy negatives passed',
    '  ----------------------------------------------------------------------------------',
  ]
  for (const row of rows) {
    const marker = row.threshold === current ? ' <- shipped' : row.threshold === recommended ? ' <- recommended' : ''
    lines.push(
      `  ${row.threshold.toFixed(2)}  `
      + `${pad(`${row.positive.passed}/${row.positive.total}`, 13)} ${pad(pct(rate(row.positive)), 9)}   `
      + `${pad(`${row.hardNegative.passed}/${row.hardNegative.total}`, 13)} ${pad(pct(rate(row.hardNegative)), 9)}   `
      + `${pad(`${row.easyNegative.passed}/${row.easyNegative.total}`, 13)} ${pad(pct(rate(row.easyNegative)), 9)}`
      + marker
    )
  }
  return lines.join('\n')
}

/**
 * The recommendation rule, written down so it can be argued with rather than inferred from the number.
 *
 * The naive rule is "lowest threshold whose hard-negative pass rate is inside the budget", and it is
 * reported as `budget`. On its own it is misleading, because several of these gates have an
 * IRREDUCIBLE FLOOR: hard negatives that pass at a threshold of 1.00 and therefore pass at every
 * threshold. Two manami records related to each other and carrying the SAME title are the clearest
 * case, and no number placed on a similarity scale refuses them. Against a floor above the budget the
 * naive rule reports "none in range", which reads as "this gate is hopeless" when what it means is
 * "the threshold is not the lever".
 *
 * So the recommended value is `saturation`: the LOWEST threshold at which the hard-negative rate has
 * come down to the floor plus the budget. Below it, raising the number still buys safety. Above it,
 * raising the number only costs recall, because everything still getting through is something the
 * scale cannot see. Lowest rather than highest because recall is the cheap axis: a false negative is
 * one missing streaming row, a false positive is a permanent weld with no unlink.
 */
const HARD_NEGATIVE_BUDGET = 0.001

/**
 * `rows` is the reported window; `fullRows` runs to 1.00 and supplies the floor.
 *
 * Reading the floor off the window's own top row was safe only while every window ended at 1.00. It
 * does not any more, and the failure would have been silent: at a window ending in 0.70 the "floor"
 * would be the 0.70 rate, `floor + budget` would then be satisfied by the 0.70 row itself, and every
 * gate would report its own window ceiling as the recommendation with a straight face.
 */
const analyse = (rows: Row[], fullRows: Row[]) => {
  const top = fullRows[fullRows.length - 1]!
  const floor = rate(top.hardNegative)
  const best = rows.reduce((a, b) =>
    rate(b.positive) - rate(b.hardNegative) > rate(a.positive) - rate(a.hardNegative) ? b : a)
  const saturation = rows.find(row => rate(row.hardNegative) <= floor + HARD_NEGATIVE_BUDGET)
  return {
    floor,
    floorCount: top.hardNegative.passed,
    budget: rows.find(row => rate(row.hardNegative) <= HARD_NEGATIVE_BUDGET)?.threshold ?? null,
    zeroFp: rows.find(row => row.hardNegative.passed === 0)?.threshold ?? null,
    // null means the window does not reach saturation, which is a statement about the window and has
    // to stay distinguishable from "saturates at the top row"
    saturation: saturation?.threshold ?? null,
    saturationInWindow: saturation !== undefined,
    // the same search over the FULL range, so a window that stops short still reports where the gate
    // would have saturated rather than reporting nothing
    saturationFull: fullRows.find(row => rate(row.hardNegative) <= floor + HARD_NEGATIVE_BUDGET)!.threshold,
    bestMargin: rate(best.positive) - rate(best.hardNegative),
    bestMarginThreshold: best.threshold,
  }
}

/* ------------------------------------------------------------------------------------------------
 * Run
 * ---------------------------------------------------------------------------------------------- */

/**
 * Every arm runs at FULL population by default, and that is load bearing rather than thoroughness.
 *
 * These used to be equal counts, 30000 each. The populations are not equal: 243194 synonym pairs
 * against 139507 different-entry ones, so equal counts sample the two arms at 12.336% and 21.504%,
 * making the negative arm 1.743x denser than the positive one. Every statistic that divides one arm
 * by the other then carries that factor, and the exchange ratio this harness exists to produce is
 * exactly such a statistic: on the equal-count sample it read 1.51 wrong links per correct one
 * recovered, and on the full populations, same code and same line, it reads the other side of 1.0.
 * A calibration that inverts on a sample-size choice nobody thought was a modelling decision is worse
 * than no calibration, because it comes with a table.
 *
 * The env vars stay, for a quick pass while iterating on the harness itself. Anything that will be
 * quoted has to run at the default, and a capped run says so in its own header.
 */
const ALL = Number.POSITIVE_INFINITY
const SAMPLE_SYNONYM = Number(process.env.CALIBRATION_SYNONYMS ?? ALL)
const SAMPLE_RELATED_DIFFERENT = Number(process.env.CALIBRATION_HARD_NEGATIVES ?? ALL)
const SAMPLE_RELATED_SAME = Number(process.env.CALIBRATION_SAME_SHOW ?? ALL)
/**
 * The one arm that cannot be "full", and therefore the one arm no cross-arm ratio may be built on.
 *
 * Easy negatives are GENERATED by drawing two unrelated records, so their population is every pair of
 * records that exists, about 862 million, and any count here is arbitrary. It reports a rate, never a
 * count against another arm's count. Sized to the different-entry arm so the two read on one scale.
 */
const SAMPLE_RANDOM = Number(process.env.CALIBRATION_EASY_NEGATIVES ?? 139_507)
const SAMPLED = [SAMPLE_SYNONYM, SAMPLE_RELATED_DIFFERENT, SAMPLE_RELATED_SAME].some(n => n !== ALL)

const report: string[] = []
const say = (line = '') => {
  report.push(line)
  console.log(line)
}

type GateResult = {
  gate: Gate
  entries: Scored[]
  /** the reported window, at the resolution this gate's family is being calibrated at */
  rows: Row[]
  /** 0.00 to 1.00 at 0.01, never rendered: the floor comes off it, and so does the distinctness control */
  fullRows: Row[]
  analysis: ReturnType<typeof analyse>
}

const results: GateResult[] = []
let corpusMeta = { tag: '', updated: '', records: 0 }
let counts = { synonym: 0, sameShow: 0, differentEntry: 0, random: 0 }
let buckets: Record<PositiveBucket, number> = { 'cross-script': 0, 'no-token-overlap': 0, 'token-overlap': 0 }
let bucketExamples: Record<PositiveBucket, Pair[]> = { 'cross-script': [], 'no-token-overlap': [], 'token-overlap': [] }
let pairs: Pair[] = []
let boundViolations: { pair: Pair, score: number, bound: number }[] = []

beforeAll(async () => {
  const started = Date.now()
  const corpus = loadCorpus()
  corpusMeta = { tag: corpus.tag, updated: corpus.updated, records: corpus.records.length }

  // URL to record, so `related` resolves to real records rather than to a bare catalogue link. Both
  // `sources` and `related` are the same URL space, which is the only reason this works.
  const byUrl = new Map<string, Record_>()
  for (const record of corpus.records) for (const url of record.sources) byUrl.set(url, record)

  const rand = mulberry32(SEED)

  /**
   * The dates one CATALOGUE SHOW covers: the record itself plus every same-show relation of it.
   *
   * A catalogue that models a franchise as one entity with several seasons carries a date per season,
   * so a candidate's date set is not one date. Built once per record here rather than per pair, since
   * the same record appears on the right of thousands of pairs and resolving its relations again for
   * each of them is the difference between a pass that finishes and one that does not.
   *
   * `relationOf` is what decides which relations count as seasons of the same show, and it is the same
   * lexical split the ground-truth labelling uses, so this cannot smuggle in a judgement the arms do
   * not already make. It is an approximation of how a catalogue bundles: manami has no season graph.
   */
  const showYears = new Map<Record_, number[]>()
  const showQuarters = new Map<Record_, number[]>()
  for (const record of corpus.records) {
    const years = new Set<number>()
    const quarters = new Set<number>()
    const add = (entry: Record_) => {
      if (entry.year !== null) years.add(entry.year)
      const quarter = quarterOf(entry.year, entry.season)
      if (quarter !== null) quarters.add(quarter)
    }
    add(record)
    for (const url of record.related) {
      const other = byUrl.get(url)
      if (other && other !== record && relationOf(record.title, other.title) === 'same-show') add(other)
    }
    showYears.set(record, [...years])
    showQuarters.set(record, [...quarters])
  }

  const synonymPairs: Pair[] = []
  for (const record of corpus.records) {
    for (const synonym of record.synonyms) {
      if (!synonym?.trim()) continue
      synonymPairs.push({
        kind: 'synonym',
        left: record.title,
        leftOthers: record.synonyms.filter(other => other !== synonym),
        right: synonym,
        // deliberately empty: at fuzzy-merge this pair models two clusters of the SAME show that have
        // not been linked by id, and the whole reason they have not is that each holds a different
        // name for it. Handing the right-hand cluster the left-hand one's synonyms would let its
        // season and format sets be computed from titles it does not have.
        rightOthers: [],
        leftType: record.type,
        rightType: record.type,
        leftYear: record.year,
        rightYear: record.year,
        // one record, so one date between the two sides. Every date predicate passes here by
        // construction, which is the flattery the date-axis header warns about.
        leftSeason: record.season,
        rightSeason: record.season,
        rightShowYears: showYears.get(record)!,
        rightShowQuarters: showQuarters.get(record)!,
      })
    }
  }

  const sameShowPairs: Pair[] = []
  const differentEntryPairs: Pair[] = []
  for (const record of corpus.records) {
    const seen = new Set<Record_>()
    for (const url of record.related) {
      const other = byUrl.get(url)
      if (!other || other === record || seen.has(other)) continue
      seen.add(other)
      const pair: Pair = {
        kind: 'random',
        left: record.title,
        leftOthers: record.synonyms,
        right: other.title,
        // two genuinely distinct records, so the right-hand cluster really does hold its own name set
        rightOthers: other.synonyms,
        leftType: record.type,
        rightType: other.type,
        leftYear: record.year,
        rightYear: other.year,
        leftSeason: record.season,
        rightSeason: other.season,
        rightShowYears: showYears.get(other)!,
        rightShowQuarters: showQuarters.get(other)!,
      }
      if (relationOf(record.title, other.title) === 'same-show') {
        sameShowPairs.push({ ...pair, kind: 'related-same-show' })
      } else {
        differentEntryPairs.push({ ...pair, kind: 'related-different-entry' })
      }
    }
  }

  // easy negatives: two records with no shared catalogue id and no relation between them
  const relatedUrls = new Map<Record_, Set<string>>()
  for (const record of corpus.records) relatedUrls.set(record, new Set(record.related))
  const randomPairs: Pair[] = []
  while (randomPairs.length < SAMPLE_RANDOM) {
    const a = corpus.records[Math.floor(rand() * corpus.records.length)]!
    const b = corpus.records[Math.floor(rand() * corpus.records.length)]!
    if (a === b) continue
    if (b.sources.some(url => relatedUrls.get(a)!.has(url))) continue
    if (a.sources.some(url => relatedUrls.get(b)!.has(url))) continue
    randomPairs.push({
      kind: 'random',
      left: a.title,
      leftOthers: a.synonyms,
      right: b.title,
      rightOthers: b.synonyms,
      leftType: a.type,
      rightType: b.type,
      leftYear: a.year,
      rightYear: b.year,
      leftSeason: a.season,
      rightSeason: b.season,
      rightShowYears: showYears.get(b)!,
      rightShowQuarters: showQuarters.get(b)!,
    })
  }

  pairs = [
    ...sample(synonymPairs, SAMPLE_SYNONYM, rand),
    ...sample(differentEntryPairs, SAMPLE_RELATED_DIFFERENT, rand),
    ...sample(sameShowPairs, SAMPLE_RELATED_SAME, rand),
    ...randomPairs,
  ]

  counts = {
    synonym: pairs.filter(pair => pair.kind === 'synonym').length,
    sameShow: pairs.filter(pair => pair.kind === 'related-same-show').length,
    differentEntry: pairs.filter(pair => pair.kind === 'related-different-entry').length,
    random: pairs.filter(pair => pair.kind === 'random').length,
  }

  buckets = { 'cross-script': 0, 'no-token-overlap': 0, 'token-overlap': 0 }
  bucketExamples = { 'cross-script': [], 'no-token-overlap': [], 'token-overlap': [] }
  for (const pair of pairs) {
    if (pair.kind !== 'synonym') continue
    const bucket = bucketOf(pair.left, pair.right)
    buckets[bucket]++
    if (bucketExamples[bucket].length < 10) bucketExamples[bucket].push(pair)
  }

  say('='.repeat(100))
  say('TITLE MATCHING THRESHOLD CALIBRATION')
  say('='.repeat(100))
  say(`corpus        ${CORPUS_PATH}`)
  say(`              manami ${corpusMeta.tag}, cut ${corpusMeta.updated}, ${corpusMeta.records} records`)
  say(`seed          mulberry32(${SEED})`)
  if (SAMPLED) {
    say(`CAPPED RUN    an arm was capped by a CALIBRATION_* env var, so the arms are at DIFFERENT`)
    say(`              densities and no ratio between two arms in this run may be quoted. Re-run with`)
    say(`              no env var before believing any number that divides one arm by another.`)
  }
  say(`sample        ${counts.synonym} synonym pairs`)
  say(`              ${counts.sameShow} related pairs labelled same-show (positive at the streaming gates, `
    + `hard negative at fuzzy-merge)`)
  say(`              ${counts.differentEntry} related pairs labelled different-entry (hard negative everywhere)`)
  say(`              ${counts.random} random cross-record pairs (easy negatives)`)
  say(`              available before sampling: ${synonymPairs.length} synonym, ${sameShowPairs.length} same-show, `
    + `${differentEntryPairs.length} different-entry`)
  say()

  for (const gate of gates()) {
    const entries: Scored[] = []
    for (const pair of pairs) {
      const reached = gate.reaches(pair)
      const score = reached ? await gate.score(pair) : 0
      entries.push({ pair, arm: gate.arm(pair.kind), score, reached, bound: gate.bound ? gate.bound(pair) : 1 })
    }
    const rows = sweep(entries, gate, gate.grid)
    const fullRows = sweep(entries, gate, FULL_GRID)
    results.push({ gate, entries, rows, fullRows, analysis: analyse(rows, fullRows) })
  }

  // the bound-violation scan the fuzzy-merge prefilter comment invites: pairs frizbee scores at or
  // above the shipped threshold that the character-count bound refuses before the wasm ever runs
  const merge = results.find(result => result.gate.name === 'fuzzy-merge')!
  boundViolations = merge.entries
    .filter(entry => entry.reached && entry.score !== 1 && entry.score >= merge.gate.current && entry.bound < merge.gate.current)
    .map(entry => ({ pair: entry.pair, score: entry.score, bound: entry.bound }))
    .sort((a, b) => b.score - a.score)

  say(`scored ${pairs.length} pairs across ${results.length} gate models in ${((Date.now() - started) / 1000).toFixed(1)}s`)
  say()
}, 900_000)

/* ------------------------------------------------------------------------------------------------
 * Controls
 *
 * These come first on purpose. Everything below them is a table, and a table produced by an inert
 * scorer looks exactly like a table produced by a working one.
 * ---------------------------------------------------------------------------------------------- */

describe('control: the scorer is live', () => {
  it('scores an identical pair at exactly 1.0', async () => {
    expect(await titleSimilarity('Cowboy Bebop', 'Cowboy Bebop')).toBe(1)
    expect(await titleSimilarity('葬送のフリーレン', '葬送のフリーレン')).toBe(1)
  })

  it('scores an unrelated pair near 0', async () => {
    // measured: 0.1786 and 0.0237. The bar is 0.25 rather than something tighter because stripTitle
    // leaves short latin titles sharing common letters, which is a property of the scale, not a fault.
    expect(await titleSimilarity('Cowboy Bebop', 'Yuru Camp')).toBeLessThan(0.25)
    expect(await titleSimilarity("Frieren: Beyond Journey's End", 'Gintama')).toBeLessThan(0.25)
  })

  it('has a LIVE sacha: franchiseTitle actually strips the season', async () => {
    // franchiseTitle swallows a PARSER throw and returns the input unchanged, so a sacha that loads
    // and then declines every title is indistinguishable from a working one unless this is asserted.
    // Without it, every franchise-path number in this file would silently become a raw
    // titleSimilarity number and the crunchyroll column would be measuring fuzzy-merge's scale.
    //
    // Measured: dropping setupFiles instead fails the whole run at `readySacha` with
    // `TypeError: fetch failed / not implemented... yet...`, so the INIT failure is already loud. It
    // is the quiet half this covers.
    expect(await franchiseTitle('Mushoku Tensei: Jobless Reincarnation Season 2'))
      .toBe('Mushoku Tensei: Jobless Reincarnation')
    expect(await franchiseTitle('Solo Leveling Season 2 -Arise from the Shadow-')).toBe('Solo Leveling')
    expect(await bestTitleScore(['Solo Leveling Season 2 -Arise from the Shadow-'], 'Solo Leveling')).toBe(1)
  })

  /**
   * stripTitle and simplifyTitle are not merely scored WITH. They decide what the arms ARE, and
   * neutering either one left the old control suite reporting 16 of 16 green while every number in
   * the report moved. Both were measured by mocking the export to a pass-through:
   *
   *   stripTitle -> identity      the same-show arm collapsed from 4322 pairs to 1946, the positive
   *                               composition table moved 7 points from token-overlap to
   *                               no-token-overlap, and every gate's shipped hard-negative rate
   *                               changed (unogs 35.940% -> 36.853%). It labels the ground truth
   *                               (`relationOf`), buckets the positive set (`tokensOf`) and reports
   *                               the survivor shapes, and none of that stops working when it stops
   *                               doing anything: a pass-through still returns a string.
   *
   *   simplifyTitle -> []         `unogs-pickTitleMatch` and `justwatch/appletv WITH THE RUNG` both
   *                               silently degenerated into `justwatch/appletv AS SHIPPED`. The rung
   *                               models became byte-identical to the no-rung model (0.1450 margin at
   *                               0.74, 34.759% recall, 28.960% hard negatives) and unogs' reported
   *                               irreducible floor fell from 1.940% to 0.000%, while the comparison
   *                               block went on telling the reader that the difference between the
   *                               three rows was attributable to the preprocessing.
   *
   * A control that only covers the scorer covers the cheapest failure and not the likeliest one.
   */
  it('has a LIVE stripTitle: it normalizes rather than passing the string through', () => {
    expect(stripTitle('Attack on Titan: Junior High!')).toBe('attack on titan junior high')
    expect(stripTitle('  Steins;Gate  0 ')).toBe('steinsgate 0')
    // and the labelling it drives still splits the two cases the polarity comment works through
    expect(relationOf('Attack on Titan Season 3 Part 2', 'Attack on Titan')).toBe('same-show')
    expect(relationOf('Attack on Titan', 'Attack on Titan: Junior High')).toBe('different-entry')
  })

  it('has a LIVE simplifyTitle: the rung models see rungs', () => {
    expect(simplifyTitle('One Piece Film: Red')).toEqual(['One Piece Film'])
    expect(simplifyTitle('Mushoku Tensei: Jobless Reincarnation Season 2'))
      .toEqual(['Mushoku Tensei: Jobless Reincarnation', 'Mushoku Tensei'])
  })

  it('has a LIVE profileCluster: the fuzzy-merge vetoes come from the store, not from a copy', () => {
    // This file used to hand-copy normalizeTitle, carriesIdentity and the format mapping out of
    // fuzzy-merge.ts. It now profiles a cluster instead, so the assertion worth making is that the
    // imported thing behaves: an article dropped, a season read off a title that is NOT the primary
    // one (the copy read only the primary and was therefore weaker than the shipped veto), and a
    // format that stays neutral for an OVA.
    expect(normalizeForMerge('The Attack on Titan!')).toBe('attack on titan')
    expect(normalizeForMerge('Season 2')).toBeUndefined()
    expect([...mergeProfile('Mushoku Tensei', ['Mushoku Tensei 2nd Season'], 'TV', 2021).seasons]).toEqual([2])
    expect([...mergeProfile('Some OVA', [], 'OVA', 2021).formats]).toEqual([])
    expect([...mergeProfile('Some Movie', [], 'MOVIE', 2021).formats]).toEqual(['MOVIE'])
  })

  /**
   * The date predicates, mutation-checked the way the scorers are.
   *
   * Two failure shapes and the existing controls only catch one of them. A predicate stuck at TRUE
   * makes its gate byte-identical to `crunchyroll-bestTitleScore`, which the distinctness control
   * refuses, so that one is covered. A predicate stuck at FALSE zeroes every arm, which
   * `assertNotInert` refuses, so that one is covered too. What neither catches is a predicate that is
   * live and WRONG: an off-by-one in the quarter index, or an adjacency test that does not cross a year
   * boundary, both of which leave a plausible curve. Those are what this pins, on constructed pairs
   * whose answers are arithmetic rather than corpus facts.
   */
  it('has LIVE date predicates: each resolution admits and refuses the pairs it should', () => {
    const at = (leftYear: number | null, leftSeason: string | null, rightYear: number | null, rightSeason: string | null) =>
      ({
        kind: 'synonym', left: 'a', leftOthers: [], right: 'b', rightOthers: [],
        leftType: 'TV', rightType: 'TV',
        leftYear, rightYear, leftSeason, rightSeason,
        rightShowYears: rightYear === null ? [] : [rightYear],
        rightShowQuarters: (() => { const q = quarterOf(rightYear, rightSeason); return q === null ? [] : [q] })(),
      }) as Pair

    expect(yearWithin(at(2019, 'FALL', 2019, 'WINTER'), 0)).toBe(true)
    expect(yearWithin(at(2019, 'FALL', 2020, 'WINTER'), 0)).toBe(false)
    expect(yearWithin(at(2019, 'FALL', 2020, 'WINTER'), 1)).toBe(true)
    // missing is a refusal, never a guess: crunchyroll/extractor.ts:296-299
    expect(yearWithin(at(null, 'FALL', 2019, 'FALL'), 1)).toBe(false)
    expect(quarterWithin(at(2019, 'FALL', 2019, 'FALL'), 0)).toBe(true)
    expect(quarterWithin(at(2019, 'FALL', 2019, 'SUMMER'), 0)).toBe(false)
    // the adjacency that has to cross a year boundary, which is the off-by-one the bound depends on:
    // a show airing in December and one airing the following January are 45 days apart
    expect(quarterWithin(at(2019, 'FALL', 2020, 'WINTER'), 1)).toBe(true)
    expect(quarterWithin(at(2019, 'SPRING', 2020, 'WINTER'), 1)).toBe(false)
    // 'UNDEFINED' is not a quarter, so it refuses rather than defaulting to one
    expect(quarterWithin(at(2019, 'UNDEFINED', 2019, 'UNDEFINED'), 1)).toBe(false)
    expect(quarterOf(2019, 'UNDEFINED')).toBeNull()

    // the season-level checks read the SHOW's date set, so a season-3 media matches a show entity dated
    // by its season 1, which is the whole point of having them
    const seasonLevel = { ...at(2019, 'FALL', 2013, 'SPRING'), rightShowYears: [2013, 2017, 2019] } as Pair
    expect(yearInShow(seasonLevel)).toBe(true)
    expect(yearWithin(seasonLevel, 1)).toBe(false)
    expect(yearInShow({ ...seasonLevel, rightShowYears: [2013, 2017] } as Pair)).toBe(false)
    expect(quarterInShow({ ...at(2019, 'FALL', 2013, 'SPRING'), rightShowQuarters: [2019 * 4 + 2] } as Pair, 1)).toBe(true)
    expect(quarterInShow({ ...at(2019, 'FALL', 2013, 'SPRING'), rightShowQuarters: [2019 * 4 + 1] } as Pair, 1)).toBe(false)
  })

  it('has a non-degenerate corpus: every arm is populated and the arms are different sets', () => {
    expect(counts.synonym).toBeGreaterThanOrEqual(20_000)
    expect(counts.differentEntry).toBeGreaterThanOrEqual(20_000)
    expect(counts.random).toBeGreaterThanOrEqual(20_000)
    expect(counts.sameShow).toBeGreaterThan(0)
    // JSON rather than a joined string: a title may hold any character, so any literal separator
    // can appear inside one and collapse two different pairs onto a single key
    const identity = (pair: Pair) => JSON.stringify([pair.left, pair.right])
    const positives = new Set(pairs.filter(pair => pair.kind === 'synonym').map(identity))
    const negatives = pairs.filter(pair => pair.kind === 'related-different-entry')
    expect(negatives.some(pair => !positives.has(identity(pair)))).toBe(true)
  })
})

/**
 * The separation detector, and then the proof that it can fail.
 *
 * A sweep whose arms have the same pass rate at every threshold is not a calibration, it is a scorer
 * that ignores its inputs printing a plausible table. So the detector is written as a standalone
 * function and then run against three deliberately inert scorers, which it MUST reject. Without that
 * second half the detector is itself unverified, and an unverified detector reports success
 * unconditionally.
 *
 * WHAT IT IS A CLAIM ABOUT, and this distinction cost a run to learn. The first version asserted that
 * positives outscore HARD negatives at every gate, and the unogs gate failed it with a margin of
 * 0.1546. That was not a broken harness: it is the finding, that the simplify loop drives the left
 * side onto a parent title so a child entry scores 1.000 against its parent's catalogue name, and no
 * threshold refuses it. An assertion that cannot tell "my rig is dead" from "this gate is weak"
 * converts a result into a failure and hides it.
 *
 * So the assertion is made on the axis where a LIVE scorer cannot fail: positives against EASY
 * negatives, two randomly paired shows. Any scorer that reads its inputs separates those by a mile,
 * and every inert scorer separates them by nothing. The hard-negative margin is then reported as
 * DATA, per gate, because it is the thing being measured.
 */
const margin = (rows: Row[], arm: 'hardNegative' | 'easyNegative') =>
  Math.max(...rows.map(row => rate(row.positive) - rate(row[arm])))

const assertNotInert = (name: string, rows: Row[]) => {
  const identical = rows.every(row =>
    Math.abs(rate(row.positive) - rate(row.easyNegative)) < 1e-9
    && Math.abs(rate(row.positive) - rate(row.hardNegative)) < 1e-9)
  if (identical) {
    throw new Error(`${name}: every arm has an identical pass rate at every threshold. The scorer is not reading its inputs.`)
  }
  const best = margin(rows, 'easyNegative')
  if (best <= 0.2) {
    throw new Error(
      `${name}: the sweep does not separate positives from RANDOM pairs (best margin ${best.toFixed(4)}). `
      + `A live scorer cannot fail this, so either the scorer is inert or the arms are mislabelled. `
      + `Refusing to report a table.`
    )
  }
  return best
}

const inertEntries = (score: (index: number) => number): Scored[] =>
  pairs.map((pair, index) => ({ pair, arm: STREAMING_ARM(pair.kind), score: score(index), reached: true, bound: 1 }))

const inertGate: Gate = {
  name: 'inert', site: 'control', arm: STREAMING_ARM, current: 0.5, grid: FULL_GRID,
  reaches: () => true, score: async () => 0.5,
}

describe('control: the separation detector can express failure', () => {
  it('rejects a scorer stuck at a constant in the middle of the range', () => {
    expect(() => assertNotInert('constant-0.5', sweep(inertEntries(() => 0.5), inertGate, FULL_GRID)))
      .toThrow(/identical pass rate|does not separate/)
  })

  it('rejects a scorer stuck at a constant 1.0, which passes everything', () => {
    expect(() => assertNotInert('constant-1.0', sweep(inertEntries(() => 1), inertGate, FULL_GRID)))
      .toThrow(/identical pass rate|does not separate/)
  })

  // the subtle inert shape: a scorer whose output VARIES, so no two rows look alike and the table
  // reads as a real measurement, but varies with the pair's position rather than with its content
  it('rejects a scorer that varies but ignores the pair', () => {
    const noise = mulberry32(1)
    const values = pairs.map(() => noise())
    expect(() => assertNotInert('index-noise', sweep(inertEntries(index => values[index]!), inertGate, FULL_GRID)))
      .toThrow(/does not separate/)
  })

  // on fullRows, not on the reported window: a window that does not contain the separating region
  // would fail this for a reason that has nothing to do with the scorer being live
  it('accepts the real sweep at every gate', () => {
    for (const result of results) {
      expect(assertNotInert(result.gate.name, result.fullRows)).toBeGreaterThan(0.2)
    }
  })

  /**
   * The six gate models must be six DIFFERENT measurements.
   *
   * The comparison block at the bottom of this file tells the reader to read the three
   * justwatch/appletv rows together and attribute the difference between them to the preprocessing
   * alone. That reading is only available while the three rows are actually three. When simplifyTitle
   * was mocked to return no rungs as a control, `WITH THE RUNG` came out byte-identical to
   * `AS SHIPPED` and the block kept making the invitation, which is a comparison of a thing with
   * itself presented as a finding about preprocessing.
   *
   * Comparing the SWEEPS rather than the summary numbers, because two models can agree on a headline
   * and differ underneath, and it is the curve the recommendation is read off.
   */
  it('keeps the gate models distinct: no two produce the same sweep', () => {
    // fullRows, so the comparison is over the SAME grid for every gate. Comparing the per-gate windows
    // would make two identical models look distinct purely because their windows differ, which is the
    // control passing for a reason unrelated to what it checks.
    const shape = (result: GateResult) =>
      JSON.stringify(result.fullRows.map(row => [row.positive.passed, row.hardNegative.passed, row.easyNegative.passed]))
    const seen = new Map<string, string>()
    for (const result of results) {
      const key = shape(result)
      const twin = seen.get(key)
      expect(
        twin === undefined
          ? undefined
          : `"${result.gate.name}" and "${twin}" produce an identical sweep, so one of them is not `
            + `measuring what its name says. Two models that differ only in a preprocessing step have `
            + `collapsed onto each other, which is what an inert helper looks like from here.`
      ).toBeUndefined()
      seen.set(key, result.gate.name)
    }
  })

  // the hard-negative margin is a RESULT, not a control, but at least one gate has to manage it or the
  // hard-negative arm is mislabelled wholesale rather than merely difficult
  it('has at least one gate that separates positives from HARD negatives', () => {
    const margins = results.map(result => ({ name: result.gate.name, value: margin(result.fullRows, 'hardNegative') }))
    expect(Math.max(...margins.map(entry => entry.value))).toBeGreaterThan(0.2)
  })
})

/* ------------------------------------------------------------------------------------------------
 * Anchors, tables, binding cases
 * ---------------------------------------------------------------------------------------------- */

const ANCHORS: [string, string, string][] = [
  ['utils.ts:248', 'Kimetsu no Yaiba', 'Demon Slayer: Kimetsu no Yaiba'],
  ['utils.ts:248', 'Cowboy Bebop', 'Cowboy Bebop: The Movie'],
  ['utils.ts:248', 'One Piece', 'One Piece Film: Red'],
  ['title-gate.test.ts:15', 'Mushoku Tensei: Jobless Reincarnation', 'Mushoku Tensei: Jobless Reincarnation Gaiden'],
  ['title-gate.test.ts:16', 'Steins;Gate', 'Steins;Gate 0'],
  ['fuzzy-merge.ts:114', 'yami shibai 16', 'yami shibai 17'],
  ['fuzzy-merge.ts:115', 'onii-chan!', 'oniichan'],
  ['utils.ts:203', 'Attack on Titan', 'Attack on Titan: Junior High'],
]

describe('calibration', () => {
  it('re-measures the documented anchors', async () => {
    say('-'.repeat(100))
    say('ANCHORS  raw = titleSimilarity as fuzzy-merge/justwatch/appletv/unogs see it')
    say('         franchise = bestTitleScore, which season-strips both sides, as crunchyroll sees it')
    say('-'.repeat(100))
    const measured: Record<string, { raw: number, franchise: number }> = {}
    for (const [site, a, b] of ANCHORS) {
      const raw = await titleSimilarity(a, b)
      const franchise = await bestTitleScore([a], b)
      measured[`${a} | ${b}`] = { raw, franchise }
      say(`  raw ${raw.toFixed(4)}   franchise ${franchise.toFixed(4)}   ${a}  vs  ${b}   [${site}]`)
    }
    say()

    // The three anchors the comment above TITLE_MATCH_THRESHOLD records, asserted to the digit. If
    // frizbee or its config ever moves, this fails here rather than silently rescaling every table
    // below it.
    expect(measured['Kimetsu no Yaiba | Demon Slayer: Kimetsu no Yaiba']!.raw).toBeCloseTo(0.552, 3)
    expect(measured['Cowboy Bebop | Cowboy Bebop: The Movie']!.raw).toBeCloseTo(0.5052, 3)
    expect(measured['One Piece | One Piece Film: Red']!.raw).toBeCloseTo(0.4469, 3)
    expect(measured['Mushoku Tensei: Jobless Reincarnation | Mushoku Tensei: Jobless Reincarnation Gaiden']!.franchise)
      .toBeCloseTo(0.814, 2)
    expect(measured['Steins;Gate | Steins;Gate 0']!.franchise).toBeCloseTo(0.7685, 3)
  })

  /**
   * Whether the anchor that PINS 0.44 is a correct match at the call site it pins.
   *
   * The three anchors in utils.ts's comment are all (short title, longer catalogue title), and the
   * comment reads the third, "One Piece" vs "One Piece Film: Red" at 0.447, as "the binding one and it
   * is a correct match". Binding it certainly is: 0.44 is exactly the largest two-decimal value that
   * admits 0.447. Whether it is a correct match depends on which side our media is, and the two
   * readings do not agree:
   *
   *   SAME WORK, different catalogue naming. "Kimetsu no Yaiba" and "Demon Slayer: Kimetsu no Yaiba"
   *   are one show under two catalogues' names, so our media carries the short one and the query is
   *   that string at rung 0. Correct match, genuinely binding from above, nothing more to check.
   *
   *   DIFFERENT WORKS in one franchise. The One Piece series and One Piece Film: Red are two manami
   *   records. The pair is a correct match only when our media is the FILM, and then our media's title
   *   is "One Piece Film: Red" and the query is a rung of THAT, so the question is whether the loop
   *   derives "One Piece" from it. It does not: the rungs are ["One Piece Film: Red", "One Piece Film"].
   *   The pair can therefore only arise with our media being the SERIES and the catalogue having
   *   returned the film, which is the wrong-link case, and the category veto three lines above the
   *   threshold is what refuses it.
   *
   * Both halves are properties of pure functions on fixed strings, so they are checkable rather than
   * arguable. Cowboy Bebop is printed alongside as the contrast: same shape, and the loop DOES reach
   * it, so that anchor survives the objection the One Piece one does not.
   */
  it('checks whether the simplify loop can reach each anchor left side from the anchor right side', () => {
    say('-'.repeat(100))
    say('ANCHOR REACHABILITY  for an anchor whose two sides are DIFFERENT WORKS in one franchise, the')
    say('                     pair is a correct match only when our media is the LONGER-titled one. The')
    say('                     query is then a rung of the long title, so the short side has to be one of')
    say('                     those rungs. Where it is not, the pair only ever arises in the orientation')
    say('                     that is a wrong link. Anchors whose two sides are the SAME work (Kimetsu')
    say('                     no Yaiba) are not subject to this and are listed for completeness only.')
    say('-'.repeat(100))
    const reach: Record<string, boolean> = {}
    for (const [site, short, long] of ANCHORS) {
      const rungs = [long, ...simplifyTitle(long)]
      const reachable = rungs.some(rung => stripTitle(rung) === stripTitle(short))
      reach[short] = reachable
      say(`  ${reachable ? 'REACHABLE    ' : 'NOT REACHABLE'}  "${short}"  from  "${long}"   [${site}]`)
      say(`                   rungs of the long side: ${JSON.stringify(rungs)}`)
    }
    say()
    say('  The binding anchor for 0.44 is "One Piece" vs "One Piece Film: Red" at 0.447, and it is NOT')
    say('  reachable. "Cowboy Bebop" vs "Cowboy Bebop: The Movie" at 0.505 has the same shape and IS')
    say('  reachable, so the lowest anchor that survives as a correct match at this call site is 0.505,')
    say('  which 0.44 and the pre-frizbee 0.5 both admit.')
    say()

    // Pinned, because this is the load-bearing half of the finding and a change to simplifyTitle would
    // otherwise move it silently.
    expect(reach['Cowboy Bebop']).toBe(true)
    expect(reach['One Piece']).toBe(false)
    expect(simplifyTitle('One Piece Film: Red')).toEqual(['One Piece Film'])
  })

  it('reports the positive set is partly unreachable, before reporting any recall number', () => {
    const total = counts.synonym
    say('-'.repeat(100))
    say('POSITIVE SET COMPOSITION  computed from the STRINGS ALONE, never from a score')
    say('-'.repeat(100))
    say(`  ${pad(String(buckets['token-overlap']), 6)}  ${pct(buckets['token-overlap'] / total)}  token-overlap`
      + `      at least one shared word: the only bucket a character matcher can judge`)
    say(`  ${pad(String(buckets['cross-script']), 6)}  ${pct(buckets['cross-script'] / total)}  cross-script`
      + `       disjoint writing systems: scores 0 structurally, no threshold reaches them`)
    say(`  ${pad(String(buckets['no-token-overlap']), 6)}  ${pct(buckets['no-token-overlap'] / total)}  no-token-overlap`
      + `   zero shared words in one script`)
    say()
    say('  no-token-overlap MIXES two things and no threshold separates them. Both of these are in it:')
    say('  a genuine translation the matcher cannot reach, and a franchise label that is not a title at all.')
    for (const pair of bucketExamples['no-token-overlap']) say(`    "${pair.left}"   vs   "${pair.right}"`)
    say()
    say('  cross-script examples:')
    for (const pair of bucketExamples['cross-script'].slice(0, 6)) say(`    "${pair.left}"   vs   "${pair.right}"`)
    say()
    say('  Every recall number below is reported over the UNFILTERED positive set first. The reachable')
    say('  subset is reported beside it as an explanation of the ceiling, not as a replacement for it:')
    say(`  no gate can exceed ${pct(buckets['token-overlap'] / total)} recall on this corpus whatever its threshold.`)
    say()

    expect(buckets['token-overlap'] + buckets['cross-script'] + buckets['no-token-overlap']).toBe(total)
    expect(buckets['token-overlap']).toBeGreaterThan(0)
  })

  it('states what the arms are made of and what the model does not capture', () => {
    say('-'.repeat(100))
    say('HARD NEGATIVE ARM  what the related-different-entry pairs actually are, by manami type')
    say('-'.repeat(100))
    const byType = new Map<string, number>()
    for (const pair of pairs) {
      if (pair.kind !== 'related-different-entry') continue
      const key = `${pair.leftType} vs ${pair.rightType}`
      byType.set(key, (byType.get(key) ?? 0) + 1)
    }
    for (const [key, count] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      say(`  ${pad(String(count), 6)}  ${pct(count / counts.differentEntry)}  ${key}`)
    }
    say()
    say('KNOWN LIMITS OF THE MODEL, so a number from this file is not read as more than it is:')
    say('  1. fuzzy-merge recall here is an ATOMIC PAIR rate. Production compares up to 6 titles per')
    say('     cluster against up to 6 of the other and merges if ANY pair clears, so the cluster-level')
    say('     recall is strictly higher than the number in that table. The false-positive column is')
    say('     unaffected in the same direction: more pairs tried is more chances to weld, so the')
    say('     hard-negative rate here is a LOWER bound and the recall is a LOWER bound too.')
    say('  2. The streaming gates are scored against ONE candidate per query. justwatch really does')
    say('     score only results[0] (extractor.ts:416), so that is faithful there; appletv loops every')
    say('     result and takes the FIRST that clears, which this model does not reproduce, and unogs')
    say('     takes the BEST over all candidates. Both of those see more candidates than one, so their')
    say('     real false-positive rate is at or above the number here.')
    say('  3. crunchyroll is calibrated on the TITLE axis alone. The shipped gate also requires the')
    say('     candidate season to have aired within 45 days of our start date, and the header comment')
    say('     at extractor.ts:274-299 is explicit that neither axis is sufficient alone. A hard')
    say('     negative passing the title column here is not yet a link.')
    say('  4. manami relations are symmetric and unlabelled, so "related-different-entry" mixes')
    say('     spin-offs, recaps, PVs and shorts. The type table above is there so that mix is visible')
    say('     rather than assumed. Measured on this corpus: 89.34% of the resolved relations also')
    say('     appear reversed, so the arm holds each relation about twice, once per orientation. That')
    say('     is deliberate at the gates whose scoring is ASYMMETRIC (unogs and the rung model apply')
    say('     simplifyTitle to the left side only; crunchyroll takes the max over the left cluster\'s')
    say('     whole name set), but it does mean the arm holds about half as many INDEPENDENT relations')
    say('     as its count suggests, so a hard-negative rate is not a sample of 30000 free draws.')
    say('  5. At fuzzy-merge the positive arm CANNOT fail the year veto, by construction rather than')
    say('     by measurement: both sides of a synonym pair are two names off ONE manami record, so they')
    say('     carry one `year` field between them. Measured on this corpus only 10.58% of related pairs')
    say('     share a year, so the veto removes about 90% of the hard-negative arm and about 2% of the')
    say('     positive one. Production has no such guarantee: two clusters of the same show can carry')
    say('     different start dates and then never meet in a bucket at all. So the fuzzy-merge margin')
    say('     is an OVERSTATEMENT of what the pass achieves, and the "of the pairs that REACH the')
    say('     score" line printed with each gate is the number to read when asking what the THRESHOLD')
    say('     itself is buying.')
    say()
    expect(byType.size).toBeGreaterThan(0)
  })

  it('sweeps every gate and names the binding cases', () => {
    for (const result of results) {
      const { gate, rows, fullRows, entries, analysis } = result
      const chosen = analysis.saturation ?? analysis.saturationFull
      const shipped = rows.find(row => Math.abs(row.threshold - gate.current) < 1e-9)
      const atChosen = (analysis.saturation === null ? fullRows : rows).find(row => row.threshold === chosen)!
      const vetoed = {
        positive: entries.filter(entry => entry.arm === 'positive' && !entry.reached).length,
        hard: entries.filter(entry => entry.arm === 'hard-negative' && !entry.reached).length,
        easy: entries.filter(entry => entry.arm === 'easy-negative' && !entry.reached).length,
      }

      say('='.repeat(100))
      say(`GATE  ${gate.name}`)
      say(`      ${gate.site}`)
      say(`      swept ${gate.grid[0]!.toFixed(2)} to ${gate.grid[gate.grid.length - 1]!.toFixed(2)} step 0.01`)
      say(`      shipped                       ${gate.current.toFixed(2)}`)
      say(`      RECOMMENDED (saturation)      ${chosen.toFixed(2)}   `
        + `recall ${pct(rate(atChosen.positive))}, hard-negative pass ${pct(rate(atChosen.hardNegative))}`
        + `${analysis.saturation === null ? '   [OUTSIDE the swept window]' : ''}`)
      if (gate.hardNegativesAreAcceptable) {
        say(`      COST POLARITY DIFFERS AT THIS GATE: ${gate.hardNegativesAreAcceptable}`)
      }
      say(`      irreducible hard-negative floor ${pct(analysis.floor)} (${analysis.floorCount} pairs pass even at 1.00)`)
      say(`      lowest threshold inside the flat ${pct(HARD_NEGATIVE_BUDGET)} budget: `
        + `${analysis.budget === null ? 'NONE, the floor is above the budget' : analysis.budget.toFixed(2)}`)
      say(`      lowest threshold with ZERO hard-negative passes: `
        + `${analysis.zeroFp === null ? 'NONE in range' : analysis.zeroFp.toFixed(2)}`)
      say(`      best recall-minus-hard-negative margin ${analysis.bestMargin.toFixed(4)} at `
        + `${analysis.bestMarginThreshold.toFixed(2)}`)
      if (analysis.bestMargin <= 0.2) {
        say(`      NOTE: no threshold in range separates the arms by more than ${analysis.bestMargin.toFixed(4)}.`)
        say(`      At this gate the number is not the lever. Moving it trades recall for almost nothing.`)
      }
      say(`      vetoed before scoring: ${vetoed.positive} positives, ${vetoed.hard} hard negatives, `
        + `${vetoed.easy} easy negatives`)
      // Every rate in the table below is over the WHOLE arm, vetoed pairs included, which is the right
      // denominator for "what does this gate do to the traffic it sees". It is the wrong one for
      // "what is the threshold buying", and at fuzzy-merge the two are wildly different: the year
      // bucket alone removes about 90% of the hard-negative arm and about 2% of the positive one, so
      // the margin statistic subtracts a barely-diluted number from a heavily-diluted one. The
      // threshold only ever sees the pairs that REACHED it, so those rates are reported too.
      const reachedOnly = (arm: GateArm, threshold: number) => {
        const arms = entries.filter(entry => entry.arm === arm && entry.reached)
        return arms.length
          ? `${arms.filter(entry => passes(entry, threshold, gate)).length}/${arms.length} `
            + `${pct(arms.filter(entry => passes(entry, threshold, gate)).length / arms.length)}`
          : 'none reached'
      }
      say(`      of the pairs that REACH the score, at ${chosen.toFixed(2)}: `
        + `positives ${reachedOnly('positive', chosen)}, hard negatives ${reachedOnly('hard-negative', chosen)}`)
      say('='.repeat(100))
      say(renderTable(rows, gate.current, chosen))
      say()

      // recall on the reachable subset, so the ceiling the composition table established is visible
      // against the same threshold rather than only in the aggregate
      const reachable = entries.filter(entry =>
        entry.arm === 'positive' && entry.pair.kind === 'synonym' && bucketOf(entry.pair.left, entry.pair.right) === 'token-overlap')
      const reachablePassed = reachable.filter(entry => passes(entry, chosen, gate)).length
      say(`  at ${chosen.toFixed(2)}: recall over token-overlap synonym positives `
        + `${reachablePassed}/${reachable.length} ${pct(reachable.length ? reachablePassed / reachable.length : 0)}`)
      if (shipped) {
        say(`  at the SHIPPED ${gate.current.toFixed(2)}: recall ${pct(rate(shipped.positive))}, `
          + `hard-negative pass ${pct(rate(shipped.hardNegative))} (${shipped.hardNegative.passed} pairs)`)
      }
      say()

      // WHY the survivors survive, which decides whether a threshold could ever have refused them
      const admitted = entries
        .filter(entry => entry.arm === 'hard-negative' && passes(entry, chosen, gate))
        .sort((a, b) => b.score - a.score)
      const exactAfterStrip = admitted.filter(entry => stripTitle(entry.pair.left) === stripTitle(entry.pair.right)).length
      const containment = admitted.filter(entry => {
        const left = stripTitle(entry.pair.left)
        const right = stripTitle(entry.pair.right)
        return left !== right && (left.includes(right) || right.includes(left))
      }).length
      say(`  SHAPE of the ${admitted.length} hard negatives still passing at ${chosen.toFixed(2)}:`)
      say(`    ${exactAfterStrip} are the SAME STRING after stripTitle, so no similarity number refuses them`)
      say(`    ${containment} are one title contained whole inside the other`)
      say(`    ${admitted.length - exactAfterStrip - containment} are something else`)
      say()

      say(`  BINDING CASES at ${chosen.toFixed(2)}`)
      say(`    highest-scoring HARD NEGATIVES that still pass (${admitted.length ? 'the expensive errors' : 'none'}):`)
      for (const entry of admitted.slice(0, 12)) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`)
      }
      const refused = entries
        .filter(entry => entry.arm === 'positive' && !passes(entry, chosen, gate))
        .sort((a, b) => b.score - a.score)
        .slice(0, 12)
      say(`    highest-scoring POSITIVES that are refused (the recall left on the table):`)
      for (const entry of refused) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`
          + `${entry.reached ? '' : '   [vetoed before scoring]'}`)
      }
      say()
    }
    expect(results.length).toBeGreaterThan(0)
  })

  /**
   * TWO INSTRUMENTS THE SATURATION RULE NEEDS BESIDE IT, because on this corpus it degenerates.
   *
   * `saturation` is "the lowest threshold at which the hard-negative rate has come down to its
   * irreducible floor". That is the right rule at a gate whose arms separate: the rate falls, flattens,
   * and the flattening point is the answer. At the 0.44/0.5 family the rate never flattens. It falls
   * smoothly from 62% at 0.30 to 7.9% at 0.70 and keeps falling, so the rule keeps raising and lands at
   * 0.96, where the sweep says it would refuse 8675 hard negatives at a cost of 9945 positives. That is
   * a losing trade reported as a recommendation, and it is the exact shape of a rule that returns an
   * answer whether or not the question has one.
   *
   * So two more instruments, both reported per gate:
   *
   * BUDGET LADDER: the lowest threshold reaching a given absolute hard-negative pass rate, and the
   * recall it buys there. This is the task's criterion stated literally, and its most useful output is
   * NOT a number: it is that several of these gates never reach a small budget at all, which is a fact
   * about the gate rather than about the threshold.
   *
   * EXCHANGE RATE: per 0.01 step, hard negatives refused divided by positives lost. This is the number
   * the cost asymmetry actually acts on. A false positive is a permanent weld and a false negative is
   * one missing streaming row, so a step that refuses more wrong links than it loses correct ones is
   * worth taking and a step below 1.0 is not, whatever the absolute rates are. It also cannot be gamed
   * by an arm's size, because it is a ratio of two deltas measured on the same step.
   */
  it('reports the budget ladder and the marginal exchange rate at every gate', () => {
    const BUDGETS = [0.10, 0.05, 0.02, 0.01, 0.005, 0.002, 0.001]

    say('='.repeat(100))
    say('BUDGET LADDER AND EXCHANGE RATE')
    say('='.repeat(100))
    say('  ladder     lowest threshold whose hard-negative pass rate is at or under the budget, over the')
    say('             FULL 0.00-1.00 range, with the recall it buys. "none" means the gate never gets')
    say('             there, which is a statement about the gate and not about the number.')
    say('  exchange   per 0.01 step inside the reported window: hard negatives refused / positives lost.')
    say('             Above 1.0 the step refuses more wrong links than it loses correct ones. The cost')
    say('             asymmetry says take those steps and stop when the ratio falls through 1.0.')
    say()

    for (const result of results) {
      const { gate, rows, fullRows, analysis } = result
      say(`  ${gate.name}   shipped ${gate.current.toFixed(2)}, irreducible floor ${pct(analysis.floor)}`)
      for (const budget of BUDGETS) {
        const hit = fullRows.find(row => rate(row.hardNegative) <= budget)
        say(`    hard-negative <= ${pad(pct(budget), 8)}  ->  `
          + (hit
            ? `${hit.threshold.toFixed(2)}   recall ${pct(rate(hit.positive))} (${hit.positive.passed}/${hit.positive.total})`
            : 'none in 0.00-1.00'))
      }
      // the exchange rate around the shipped value, which is where the decision is actually made
      const window = rows.filter(row => Math.abs(row.threshold - gate.current) <= 0.06 + 1e-9)
      say(`    exchange rate per 0.01 step near the shipped value:`)
      for (let index = 1; index < window.length; index++) {
        const from = window[index - 1]!
        const to = window[index]!
        const lost = from.positive.passed - to.positive.passed
        const refused = from.hardNegative.passed - to.hardNegative.passed
        say(`      ${from.threshold.toFixed(2)} -> ${to.threshold.toFixed(2)}   `
          + `loses ${pad(String(lost), 5)} positives, refuses ${pad(String(refused), 5)} hard negatives   `
          + `ratio ${lost ? (refused / lost).toFixed(2) : 'inf'}`
          + `${Math.abs(to.threshold - gate.current) < 1e-9 ? '   <- lands on shipped' : ''}`)
      }
      say()
    }
    expect(results.length).toBeGreaterThan(0)
  })

  /**
   * What a MOVE costs and buys, named pair by pair.
   *
   * A recommendation to change a threshold is only defensible if it can name the correct matches it
   * recovers and the wrong ones it admits, so this is the block that has to exist before any number is
   * proposed. It is computed as a set difference between two passes of the same scored entries, never
   * from the rate columns: two rates differing by 0.4 points says nothing about WHICH pairs moved.
   */
  it('names what each candidate move recovers and what it admits', () => {
    // the pairs that CHANGE verdict between two thresholds, in the direction the move goes. Both
    // directions are one subtraction: `to` looser than `from` gains pairs, `to` stricter loses them.
    const changed = (result: GateResult, arm: GateArm, from: number, to: number) => {
      const looser = Math.min(from, to)
      const stricter = Math.max(from, to)
      return result.entries
        .filter(entry => entry.arm === arm && passes(entry, looser, result.gate) && !passes(entry, stricter, result.gate))
        .sort((a, b) => b.score - a.score)
    }

    say('='.repeat(100))
    say('MOVE LEDGER  shipped value -> recommended value, pair by pair')
    say('='.repeat(100))
    say('  Computed as a set difference between two passes over the SAME scored entries, never from the')
    say('  rate columns: two rates differing by half a point say nothing about WHICH pairs moved, and a')
    say('  recommendation has to name them.')
    say()

    for (const result of results) {
      const { gate, analysis } = result
      const chosen = analysis.saturation ?? analysis.saturationFull
      if (Math.abs(chosen - gate.current) < 1e-9) {
        say(`  ${gate.name}: saturation IS the shipped ${gate.current.toFixed(2)}. Nothing moves. STAY.`)
        say()
        continue
      }
      const lowering = chosen < gate.current
      const positives = changed(result, 'positive', gate.current, chosen)
      const hard = changed(result, 'hard-negative', gate.current, chosen)
      const easy = changed(result, 'easy-negative', gate.current, chosen)
      say(`  ${gate.name}: ${lowering ? 'LOWER' : 'RAISE'} ${gate.current.toFixed(2)} -> ${chosen.toFixed(2)}`)
      say(lowering
        ? `    recovers ${positives.length} positives, admits ${hard.length} hard negatives and ${easy.length} easy negatives`
        : `    refuses ${hard.length} hard negatives and ${easy.length} easy negatives, at the cost of ${positives.length} positives`)
      say(`    positives that change verdict:`)
      for (const entry of positives.slice(0, 8)) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`)
      }
      say(`    hard negatives that change verdict:`)
      for (const entry of hard.slice(0, 8)) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`)
      }
      say()
    }
    expect(results.length).toBeGreaterThan(0)
  })

  /**
   * The question the migration left open, answered as a count rather than as an argument.
   *
   * Under seal, a correct match scoring exactly 0.500 passed a gate of 0.5. Under frizbee the same
   * containment-shaped pair scores 0.447. utils.ts moved its gate to 0.44 to preserve that; justwatch
   * and appletv did not move, so every positive whose frizbee score lands in [0.44, 0.50) is a match
   * those two sites used to make and no longer make.
   *
   * The band is measured on the AS-SHIPPED model because that is the code that runs: both sites score
   * the ORIGINAL title, not the rung. Reporting it against the rung model would answer a question
   * about code that does not exist.
   */
  it('counts what the two un-migrated 0.5 gates are refusing that 0.44 would take', () => {
    const shippedModel = results.find(result => result.gate.name === 'justwatch/appletv AS SHIPPED')!
    const rungModel = results.find(result => result.gate.name === 'justwatch/appletv WITH THE RUNG')!
    // unogs is in this block too, because the SAME band is the one a move from 0.44 back to 0.50 gives
    // up there. One band, two opposite questions: what the un-migrated gates are losing by holding 0.5,
    // and what the migrated one would lose by returning to it.
    const unogsModel = results.find(result => result.gate.name === 'unogs-pickTitleMatch')!

    say('='.repeat(100))
    say('THE UNMIGRATED 0.5 GATES  justwatch/extractor.ts:421 and appletv/extractor.ts:137')
    say('='.repeat(100))
    say('  Both still hold the pre-frizbee 0.5. utils.ts moved to 0.44 to keep the anchors it had')
    say('  measured under seal. These two did not, so the band [0.44, 0.50) is the set of pairs they')
    say('  used to link and now refuse. Counted on the corpus, on the AS-SHIPPED model, because that')
    say('  is what those two files actually do.')
    say()

    for (const [label, result] of [
      ['AS SHIPPED', shippedModel],
      ['WITH THE RUNG', rungModel],
      ['unogs, WHICH ALREADY MOVED: the same band, read as what returning to 0.50 gives up', unogsModel],
    ] as const) {
      const inBand = (arm: GateArm) =>
        result.entries.filter(entry => entry.arm === arm && entry.reached && entry.score >= 0.44 && entry.score < 0.5)
      const positives = inBand('positive')
      const hard = inBand('hard-negative')
      const easy = inBand('easy-negative')
      const positiveTotal = result.entries.filter(entry => entry.arm === 'positive').length
      const hardTotal = result.entries.filter(entry => entry.arm === 'hard-negative').length
      // the reachable subset, so the band is also reported against the ceiling rather than only
      // against an arm a quarter of which no character matcher can score at all
      const reachableTotal = result.entries.filter(entry =>
        entry.arm === 'positive' && entry.pair.kind === 'synonym'
        && bucketOf(entry.pair.left, entry.pair.right) === 'token-overlap').length
      const reachableInBand = positives.filter(entry =>
        entry.pair.kind === 'synonym' && bucketOf(entry.pair.left, entry.pair.right) === 'token-overlap').length
      // the CONTAINMENT shape the three anchors in utils.ts are all examples of: one stripped title
      // sitting whole inside the other. It is the shape the migration argument was built on, so how
      // much of the band actually has it decides whether the anchors generalise.
      const containment = (entry: Scored) => {
        const left = stripTitle(entry.pair.left)
        const right = stripTitle(entry.pair.right)
        return left !== right && (left.includes(right) || right.includes(left))
      }
      say(`  ${label}`)
      say(`    positives in [0.44, 0.50): ${positives.length} of ${positiveTotal} `
        + `(${pct(positives.length / positiveTotal)} of the positive arm)`)
      say(`      of those, ${reachableInBand} are token-overlap synonyms, `
        + `${pct(reachableInBand / Math.max(1, reachableTotal))} of the ${reachableTotal} reachable positives`)
      say(`      of those, ${positives.filter(containment).length} have the CONTAINMENT shape the three `
        + `anchors in utils.ts all have`)
      say(`    hard negatives in the same band: ${hard.length} of ${hardTotal} (${pct(hard.length / hardTotal)})`)
      say(`      of those, ${hard.filter(containment).length} have the same containment shape`)
      say(`    easy negatives in the same band: ${easy.length}`)
      say(`    so lowering these two to 0.44 trades ${positives.length} recovered links against `
        + `${hard.length} new welds, a ratio of ${(positives.length / Math.max(1, hard.length)).toFixed(2)} to 1`)
      say(`    the correct matches recovered, highest first:`)
      for (const entry of positives.sort((a, b) => b.score - a.score).slice(0, 12)) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`)
      }
      say(`    the wrong ones admitted with them, highest first:`)
      for (const entry of hard.sort((a, b) => b.score - a.score).slice(0, 12)) {
        say(`      ${entry.score.toFixed(4)}  "${entry.pair.left}"   vs   "${entry.pair.right}"`)
      }
      say()
    }
    expect(shippedModel.entries.length).toBeGreaterThan(0)
  })

  /**
   * The decision table the recommendation is read off, and the anchor ceiling that bounds it.
   *
   * Two separate things get printed here and they answer different halves of the question.
   *
   * ANCHOR CEILING: the largest two-decimal threshold that still admits each anchor. This is where the
   * shipped numbers came from in the first place, so it is the constraint any new number inherits, and
   * it is the half the corpus cannot supply: an anchor is a pair somebody verified by hand. Read
   * together with the reachability block above, it says which anchors a candidate value has to clear.
   *
   * CANDIDATES: recall, hard-negative rate and the exchange ratio for the move, at a handful of values
   * per gate rather than at every row of the sweep. The sweep table is the evidence; this is the
   * shortlist, and it exists so a recommendation is a row somebody can point at rather than a number
   * interpolated out of forty.
   */
  it('prints the anchor ceiling and a decision table of candidate values', async () => {
    say('='.repeat(100))
    say('ANCHOR CEILING  the largest two-decimal threshold that still admits each documented anchor')
    say('='.repeat(100))
    for (const [site, a, b] of ANCHORS) {
      const raw = await titleSimilarity(a, b)
      const franchise = await bestTitleScore([a], b)
      say(`  raw ${raw.toFixed(4)} -> ceiling ${(Math.floor(raw * 100) / 100).toFixed(2)}   `
        + `franchise ${franchise.toFixed(4)} -> ceiling ${(Math.floor(franchise * 100) / 100).toFixed(2)}   `
        + `"${a}"  vs  "${b}"   [${site}]`)
    }
    say()

    const CANDIDATES: Record<string, number[]> = {
      'fuzzy-merge': [0.85, 0.88, 0.90, 0.93],
      'unogs-pickTitleMatch': [0.44, 0.50, 0.55, 0.60, 0.70],
      'justwatch/appletv AS SHIPPED': [0.44, 0.50, 0.55, 0.60, 0.70],
      'justwatch/appletv WITH THE RUNG': [0.44, 0.50, 0.55, 0.60, 0.70],
      'justwatch/appletv WITH franchiseTitle': [0.44, 0.50, 0.55, 0.60, 0.70],
      'jw/atv WHOLE LIST no franchiseTitle': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + SAME YEAR': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + YEAR +/-1': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + SAME QUARTER': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + ADJACENT QUARTER': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + YEAR IN SHOW': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv WHOLE LIST + franchise + QUARTER IN SHOW +/-1': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'jw/atv PRIMARY + franchise + SAME YEAR': [0.50, 0.70, 0.85, 0.90, 0.95, 1.00],
      'crunchyroll-bestTitleScore': [0.85, 0.90, 0.93, 0.96],
      'search-relevance WHOLE LIST': [0.60, 0.70, 0.78, 0.85],
      'search-relevance PRIMARY ONLY': [0.60, 0.70, 0.78, 0.85],
    }

    say('='.repeat(100))
    say('DECISION TABLE  every candidate against the SHIPPED value of the same gate')
    say('='.repeat(100))
    say('  ratio = hard negatives refused / positives lost for the move from shipped to the candidate.')
    say('  Above 1.0 the move refuses more wrong links than it loses correct ones even before the cost')
    say('  asymmetry is applied, and the asymmetry only makes such a move more attractive.')
    say()
    for (const result of results) {
      const { gate, fullRows } = result
      const shipped = fullRows.find(row => Math.abs(row.threshold - gate.current) < 1e-9)!
      say(`  ${gate.name}   shipped ${gate.current.toFixed(2)}`)
      say('    cand   recall            hard-neg          vs shipped: positives   hard negatives   ratio')
      for (const candidate of CANDIDATES[gate.name] ?? []) {
        const row = fullRows.find(entry => Math.abs(entry.threshold - candidate) < 1e-9)!
        const positiveDelta = row.positive.passed - shipped.positive.passed
        const hardDelta = row.hardNegative.passed - shipped.hardNegative.passed
        const ratio =
          positiveDelta === 0 ? 'n/a'
          : Math.abs(hardDelta / positiveDelta).toFixed(2)
        say(`    ${candidate.toFixed(2)}   ${pad(`${row.positive.passed}/${row.positive.total}`, 12)} `
          + `${pad(pct(rate(row.positive)), 8)}  ${pad(`${row.hardNegative.passed}/${row.hardNegative.total}`, 12)} `
          + `${pad(pct(rate(row.hardNegative)), 8)}  ${pad(positiveDelta > 0 ? `+${positiveDelta}` : String(positiveDelta), 12)} `
          + `${pad(hardDelta > 0 ? `+${hardDelta}` : String(hardDelta), 14)}   ${ratio}`
          + `${Math.abs(candidate - gate.current) < 1e-9 ? '   <- shipped' : ''}`)
      }
      say()
    }
    expect(results.length).toBeGreaterThan(0)
  })

  it('reports whether the fuzzy-merge character-count prefilter discards merges', () => {
    const merge = results.find(result => result.gate.name === 'fuzzy-merge')!
    say('-'.repeat(100))
    say('FUZZY-MERGE PREFILTER  maxPossibleSimilarity is not an exact upper bound on titleSimilarity')
    say('                       under frizbee: it is a character-count ratio and cannot account for')
    say('                       the flat prefix bonus of 12 or exact bonus of 8.')
    say('                       A pair the bound refuses is never scored and never merges.')
    say('-'.repeat(100))
    say(`  pairs frizbee scores at or above ${merge.gate.current} that the bound refuses first: ${boundViolations.length}`)
    for (const violation of boundViolations.slice(0, 10)) {
      say(`    frizbee ${violation.score.toFixed(4)}  bound ${violation.bound.toFixed(4)}  `
        + `"${violation.pair.left}"   vs   "${violation.pair.right}"`)
    }
    // The scan is only worth reading if it can find something, so the same scan is run against a
    // threshold low enough that violations are known to exist. A count of zero at 0.9 means nothing
    // unless the scan can produce a non-zero count somewhere.
    const lowered = merge.entries.filter(entry =>
      entry.reached && entry.score !== 1 && entry.score >= 0.3 && entry.bound < 0.3).length
    say(`  the same scan at a threshold of 0.30 finds ${lowered}, which is what makes the count above readable`)
    say()
    expect(lowered).toBeGreaterThan(0)
  })

  /**
   * QUESTION 1, decomposed rather than assumed: how much of crunchyroll's margin is the WHOLE LIST and
   * how much is franchiseTitle?
   *
   * The four cells are the same corpus pairs under four preprocessings, so every difference between
   * two cells is attributable to the one step that differs. The comparison is made on MARGIN (best
   * recall-minus-hard-negative over the full 0.00-1.00 range) rather than at a fixed threshold, because
   * the four cells do not share a scale: franchiseTitle raises a season sequel's score to 1.0 against
   * its parent, so a number that is loose on one cell is strict on another and a fixed-threshold
   * comparison would mostly be measuring that shift.
   */
  it('decomposes the crunchyroll margin into the whole list and franchiseTitle', () => {
    const cell = (name: string) => {
      const result = results.find(entry => entry.gate.name === name)!
      const value = margin(result.fullRows, 'hardNegative')
      const at = result.fullRows.reduce((a, b) =>
        rate(b.positive) - rate(b.hardNegative) > rate(a.positive) - rate(a.hardNegative) ? b : a)
      return { value, threshold: at.threshold, recall: rate(at.positive), hard: rate(at.hardNegative) }
    }

    const primaryRaw = cell('justwatch/appletv AS SHIPPED')
    const primaryFranchise = cell('justwatch/appletv WITH franchiseTitle')
    const listRaw = cell('jw/atv WHOLE LIST no franchiseTitle')
    const listFranchise = cell('crunchyroll-bestTitleScore')

    say('='.repeat(100))
    say('DECOMPOSITION  what buys crunchyroll its margin, cell by cell')
    say('='.repeat(100))
    say('  The bottom-right cell is NOT a new measurement. bestTitleScore(whole list, candidate) IS the')
    say('  crunchyroll gate, so adding it as a second row would produce an identical sweep and the')
    say('  distinctness control would refuse it. It is borrowed from that row and labelled as borrowed.')
    say()
    say('                            margin   at     recall     hard-neg')
    say('  ' + '-'.repeat(70))
    for (const [label, value] of [
      ['primary title, raw          ', primaryRaw],
      ['primary title, franchise    ', primaryFranchise],
      ['WHOLE LIST, raw             ', listRaw],
      ['WHOLE LIST, franchise       ', listFranchise],
    ] as const) {
      say(`  ${label}${pad(value.value.toFixed(4), 7)}  ${value.threshold.toFixed(2)}   `
        + `${pad(pct(value.recall), 9)}  ${pad(pct(value.hard), 9)}`)
    }
    say()
    say('  THE TWO SINGLE-STEP DELTAS, each holding the other axis fixed:')
    say(`    franchiseTitle alone, on the primary title   ${(primaryFranchise.value - primaryRaw.value >= 0 ? '+' : '')}`
      + `${(primaryFranchise.value - primaryRaw.value).toFixed(4)}`)
    say(`    franchiseTitle alone, on the whole list      ${(listFranchise.value - listRaw.value >= 0 ? '+' : '')}`
      + `${(listFranchise.value - listRaw.value).toFixed(4)}`)
    say(`    the whole list alone, raw scoring            ${(listRaw.value - primaryRaw.value >= 0 ? '+' : '')}`
      + `${(listRaw.value - primaryRaw.value).toFixed(4)}`)
    say(`    the whole list alone, franchise scoring      ${(listFranchise.value - primaryFranchise.value >= 0 ? '+' : '')}`
      + `${(listFranchise.value - primaryFranchise.value).toFixed(4)}`)
    say(`    both together                                ${(listFranchise.value - primaryRaw.value >= 0 ? '+' : '')}`
      + `${(listFranchise.value - primaryRaw.value).toFixed(4)}`)
    say()
    say('  A step whose delta depends on the state of the other axis is an INTERACTION, not an')
    say('  additive contribution, and the two franchiseTitle deltas above are the test for it.')
    say()
    expect(listFranchise.value).toBeGreaterThan(0)
  })

  /**
   * QUESTION 3, and the block that decides whether this design is safe at all.
   *
   * The floor is the whole reason the date axis is on the table: franchiseTitle collapses a sequel onto
   * its parent, so a title-only gate has hard negatives that pass at a threshold of 1.00 and no number
   * refuses them. What a date resolution is worth is exactly how much of that floor it removes, and
   * that is a subtraction between the floors of two rows that differ only in the veto.
   *
   * The recall side is reported per SUB-ARM because the aggregate is flattered. A synonym pair carries
   * one manami record's date on both sides, so no date predicate can refuse it, and the synonym arm is
   * 98% of the positive count. The related-same-show arm is the only place the date axis's real cost
   * is visible, and it is the arm that holds "Solo Leveling Season 2" against "Solo Leveling", which is
   * the exact pair this change exists to recover.
   */
  it('reports what each date resolution removes from the floor and what it costs per arm', () => {
    const DATED = [
      'crunchyroll-bestTitleScore',
      'jw/atv WHOLE LIST + franchise + YEAR IN SHOW',
      'jw/atv WHOLE LIST + franchise + QUARTER IN SHOW +/-1',
      'jw/atv WHOLE LIST + franchise + YEAR +/-1',
      'jw/atv WHOLE LIST + franchise + SAME YEAR',
      'jw/atv WHOLE LIST + franchise + ADJACENT QUARTER',
      'jw/atv WHOLE LIST + franchise + SAME QUARTER',
    ]

    say('='.repeat(100))
    say('DATE AXIS  what each resolution buys, measured as floor removed rather than as margin')
    say('='.repeat(100))
    say('  The first row has NO date veto and is the baseline every other row is a subtraction from.')
    say('  Every row below it is the same title scoring with one predicate added, so the difference is')
    say('  the date and nothing else.')
    say()
    say('  NO ROW HERE IS A 45-DAY WINDOW. The corpus carries {year, season} and no day, so the finest')
    say('  bucket available is a quarter. ADJACENT QUARTER is a strict superset of a 45-day window (two')
    say('  dates 45 days apart are in the same or neighbouring quarter), so its hard-negative rate is an')
    say('  UPPER BOUND on what a real 45-day window admits, and its recall is an upper bound too.')
    say()

    const sub = (result: GateResult, kind: PairKind, threshold: number) => {
      const arm = result.entries.filter(entry => entry.pair.kind === kind)
      const passed = arm.filter(entry => passes(entry, threshold, result.gate)).length
      return arm.length ? `${passed}/${arm.length} ${pct(passed / arm.length)}` : 'empty'
    }

    for (const name of DATED) {
      const result = results.find(entry => entry.gate.name === name)!
      const chosen = result.analysis.saturation ?? result.analysis.saturationFull
      const missing = (arm: GateArm) => {
        const entries = result.entries.filter(entry => entry.arm === arm)
        const refused = entries.filter(entry => !entry.reached)
        // a pair the corpus never dated, as distinct from one whose dates disagree. The first is a
        // property of manami, the second is the veto doing its job, and charging the veto for both
        // overstates its recall cost.
        const undated = refused.filter(entry =>
          entry.pair.leftYear === null || entry.pair.rightYear === null
          || quarterOf(entry.pair.leftYear, entry.pair.leftSeason) === null
          || quarterOf(entry.pair.rightYear, entry.pair.rightSeason) === null).length
        return entries.length
          ? `${refused.length}/${entries.length} ${pct(refused.length / entries.length)} `
            + `(${undated} of them undated in the corpus)`
          : 'empty'
      }
      say(`  ${result.gate.name}`)
      say(`    irreducible floor            ${pct(result.analysis.floor)} (${result.analysis.floorCount} hard negatives pass at 1.00)`)
      say(`    recommended (saturation)     ${chosen.toFixed(2)}`)
      say(`    vetoed before scoring        positives ${missing('positive')}`)
      say(`                                 hard negs ${missing('hard-negative')}`)
      say(`    recall at ${chosen.toFixed(2)}, by sub-arm:`)
      say(`      synonym            ${sub(result, 'synonym', chosen)}   <- carries ONE date on both sides, so the veto is free here`)
      say(`      related-same-show  ${sub(result, 'related-same-show', chosen)}   <- the arm the date axis actually costs`)
      say(`      hard negatives     ${sub(result, 'related-different-entry', chosen)}`)
      say()
    }

    const floorOf = (name: string) => results.find(entry => entry.gate.name === name)!.analysis
    const base = floorOf('crunchyroll-bestTitleScore')
    say('  FLOOR REMOVED, against the undated title-only baseline:')
    for (const name of DATED.slice(1)) {
      const analysis = floorOf(name)
      say(`    ${name.padEnd(52)} ${pct(base.floor)} -> ${pct(analysis.floor)}   `
        + `removes ${base.floorCount - analysis.floorCount} of ${base.floorCount} welds `
        + `(${pct(1 - analysis.floorCount / Math.max(1, base.floorCount))})`)
    }
    say()
    say('  Read the SAME YEAR row against the ADJACENT QUARTER row: the gap between them is the whole')
    say('  cost of justwatch supplying a year where appletv supplies a timestamp.')
    say()
    expect(base.floorCount).toBeGreaterThan(0)
  })

  /**
   * QUESTION 4: appletv returns the FIRST candidate over the line, not the best one.
   *
   * appletv/extractor.ts:136-142 loops the search results and returns on the first that clears 0.5, so
   * a weak early hit wins over a strong later one. unogs already takes the best (utils.ts:311) and
   * crunchyroll sorts by score before spending a request (extractor.ts:337). This block measures what
   * the difference is worth.
   *
   * THE CANDIDATE SET is built from the corpus rather than from a live search, and that is the model's
   * weakest joint, so it is stated rather than buried. For one media (one manami record) the candidates
   * a search could plausibly return are: the names the record itself is known by (positives), and the
   * franchise siblings manami links it to (hard negatives). Random unrelated records are excluded,
   * because a catalogue search for "Attack on Titan" does not return "Yuru Camp" and counting it as a
   * candidate would make every policy look good.
   *
   * THE ORDER IS UNKNOWN, and that is the honest limit. appletv's shelves are ranked by apple's own
   * relevance, which this corpus cannot reproduce. So FIRST is reported as a uniform draw among the
   * passing candidates, which is the neutral assumption, and the two extremes are printed beside it:
   * if apple always ranks the correct entry first, FIRST never errs on a contested set; if it always
   * ranks it last, FIRST errs on every contested set. BEST is not an assumption at all: it is a
   * measured argmax, and it is the only one of the three that does not depend on the ordering.
   */
  it('measures taking the BEST candidate against the FIRST one that passes', () => {
    say('='.repeat(100))
    say('CANDIDATE POLICY  appletv/extractor.ts:136 returns the FIRST result over the line')
    say('='.repeat(100))
    say('  contested = a media for which BOTH a correct candidate and a wrong one clear the threshold.')
    say('  It is the only situation in which the policy can matter: with no passing wrong candidate')
    say('  every policy is right, and with no passing correct one every policy is wrong and the fault is')
    say('  the threshold\'s.')
    say()

    const MODELS: [string, number][] = [
      ['justwatch/appletv AS SHIPPED', 0.50],
      ['jw/atv WHOLE LIST no franchiseTitle', 0.90],
      ['crunchyroll-bestTitleScore', 0.90],
      ['jw/atv WHOLE LIST + franchise + YEAR IN SHOW', 0.90],
      ['jw/atv WHOLE LIST + franchise + QUARTER IN SHOW +/-1', 0.90],
    ]

    for (const [name, threshold] of MODELS) {
      const result = results.find(entry => entry.gate.name === name)
      if (!result) continue
      // group by the CLUSTER, not by the title: two manami records can carry the same primary title and
      // are different media, so keying on the title alone would pool two shows' candidate lists into one
      const groups = new Map<string, { positive: Scored[], hard: Scored[] }>()
      for (const entry of result.entries) {
        if (entry.arm === 'easy-negative') continue
        const key = JSON.stringify([entry.pair.left, entry.pair.leftOthers])
        let group = groups.get(key)
        if (!group) groups.set(key, (group = { positive: [], hard: [] }))
        if (entry.arm === 'positive') group.positive.push(entry)
        else group.hard.push(entry)
      }

      let contested = 0
      let bestErrs = 0
      let firstExpected = 0
      let bothWrong = 0
      const examples: string[] = []
      for (const group of groups.values()) {
        const passing = (entries: Scored[]) => entries.filter(entry => passes(entry, threshold, result.gate))
        const positives = passing(group.positive)
        const hard = passing(group.hard)
        if (!hard.length) continue
        if (!positives.length) { bothWrong++; continue }
        contested++
        const topPositive = Math.max(...positives.map(entry => entry.score))
        const topHard = Math.max(...hard.map(entry => entry.score))
        firstExpected += hard.length / (hard.length + positives.length)
        if (topHard > topPositive) {
          bestErrs++
          if (examples.length < 6) {
            const worst = hard.reduce((a, b) => (b.score > a.score ? b : a))
            examples.push(`      ${worst.score.toFixed(4)} wrong  "${worst.pair.left}"  ->  "${worst.pair.right}"   `
              + `(best correct candidate ${topPositive.toFixed(4)})`)
          }
        }
      }

      say(`  ${name}  at ${threshold.toFixed(2)}`)
      say(`    media with a passing WRONG candidate and no passing correct one: ${bothWrong}`)
      say(`      every policy welds these; the threshold and the date axis are what move them, not the policy`)
      say(`    contested media: ${contested}`)
      if (contested) {
        say(`      BEST  (argmax, measured)            welds ${bestErrs} `
          + `${pct(bestErrs / contested)} of contested`)
        say(`      FIRST (uniform order, modelled)     welds ${firstExpected.toFixed(1)} `
          + `${pct(firstExpected / contested)} of contested, in expectation`)
        say(`      FIRST worst case (correct ranked last)  welds ${contested} 100.000% of contested`)
        say(`      FIRST best case  (correct ranked first) welds 0 0.000% of contested`)
        say(`      so switching to BEST removes at least ${Math.max(0, Math.round(firstExpected) - bestErrs)} welds `
          + `on the neutral ordering assumption and at most ${contested - bestErrs} on the worst one`)
        if (examples.length) {
          say(`      contested media BEST still gets wrong (a wrong candidate outscores every correct one):`)
          for (const example of examples) say(example)
        }
      }
      say()
    }
    expect(results.length).toBeGreaterThan(0)
  })

  it('puts the gates side by side', () => {
    say('='.repeat(100))
    say('GATE COMPARISON')
    say('='.repeat(100))
    say('  margin = the best recall-minus-hard-negative-pass any threshold in range achieves. It is the')
    say('  honest summary of what a NUMBER can buy at a gate, because it is the best case over every')
    say('  number. A low margin means the two arms overlap and no threshold separates them.')
    say()
    say('  gate                                                  margin   at    shipped  recall   hard-neg   floor    rec.')
    say('  ' + '-'.repeat(112))
    for (const result of results) {
      const shipped = result.rows.find(row => Math.abs(row.threshold - result.gate.current) < 1e-9)
      const chosen = result.analysis.saturation ?? result.analysis.saturationFull
      say(`  ${result.gate.name.padEnd(52)}${pad(margin(result.fullRows, 'hardNegative').toFixed(4), 7)}  `
        + `${result.analysis.bestMarginThreshold.toFixed(2)}   ${result.gate.current.toFixed(2)}     `
        + `${pad(shipped ? pct(rate(shipped.positive)) : 'n/a', 8)} ${pad(shipped ? pct(rate(shipped.hardNegative)) : 'n/a', 9)}  `
        + `${pad(pct(result.analysis.floor), 8)} ${chosen.toFixed(2)}`)
    }
    say()
    say('  Read the three justwatch/appletv rows together: they are the SAME corpus pairs under three')
    say('  different preprocessings, so the difference between them is attributable to the')
    say('  preprocessing alone and to nothing else. The same is true of the two search-relevance rows.')
    say()
    say('  The margin column is computed over the FULL 0.00-1.00 range, not over each gate\'s reported')
    say('  window, so it stays comparable between a gate swept 0.30-0.70 and one swept 0.75-0.99.')
    say()
    expect(results.length).toBe(16)
  })

  it('writes the report where a later agent can read it without rerunning', () => {
    mkdirSync(OUT_DIR, { recursive: true })
    const reportPath = join(OUT_DIR, 'calibration-report.txt')
    const jsonPath = join(OUT_DIR, 'calibration-summary.json')
    writeFileSync(reportPath, `${report.join('\n')}\n`)
    writeFileSync(jsonPath, `${JSON.stringify({
      corpus: { path: CORPUS_PATH, ...corpusMeta },
      seed: SEED,
      counts,
      positiveComposition: buckets,
      hardNegativeBudget: HARD_NEGATIVE_BUDGET,
      gates: results.map(result => ({
        name: result.gate.name,
        site: result.gate.site,
        shipped: result.gate.current,
        window: [result.gate.grid[0], result.gate.grid[result.gate.grid.length - 1], 0.01],
        recommended: result.analysis.saturation ?? result.analysis.saturationFull,
        analysis: result.analysis,
        hardNegativeMargin: margin(result.fullRows, 'hardNegative'),
        sweep: result.rows.map(row => ({
          threshold: row.threshold,
          positiveRate: rate(row.positive),
          hardNegativeRate: rate(row.hardNegative),
          easyNegativeRate: rate(row.easyNegative),
          positive: row.positive,
          hardNegative: row.hardNegative,
          easyNegative: row.easyNegative,
        })),
        // the whole 0.00-1.00 range at 0.01, so a later reader can recompute a budget ladder or an
        // exchange rate anywhere without rerunning the 33-second scoring pass
        sweepFull: result.fullRows.map(row => ({
          threshold: row.threshold,
          positive: row.positive.passed,
          hardNegative: row.hardNegative.passed,
          easyNegative: row.easyNegative.passed,
        })),
      })),
      boundViolationsAtShipped: boundViolations.length,
    }, null, 2)}\n`)
    console.log(`\nwrote ${reportPath}`)
    console.log(`wrote ${jsonPath}`)
    expect(existsSync(reportPath)).toBe(true)
  })
})
