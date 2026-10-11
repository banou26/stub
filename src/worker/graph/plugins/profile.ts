/**
 * `plugin:profile`, P0 of 5.4: one `MediaProfile` per `Media` row and one `EpisodeProfile` per
 * `Episode` row, plus the `TitleKey` nodes and `HAS_KEY` edges that make exact title agreement a join
 * rather than a pairwise loop.
 *
 * EVERY RULE HERE IS A DERIVATION FROM THE RECORD, and none of them is a merge decision: nothing in
 * this file compares two rows, proposes a link or reads another plugin's output. That is what lets
 * every later plugin read one row instead of re-deriving the same reading of `raw` five times, and it
 * is why this plugin is `after: []` and first in the pass.
 *
 * WHAT IT PROMISES. Same graph, same scope, same output: every derivation is a pure function of the
 * row, its `Answer` log, the claims stamped on it and the episodes its own origin hung on it. No
 * clock, no random, no ordering dependence (a title tie is broken by the key itself, ascending).
 *
 * THREE READINGS ARE NOT THE ROW'S OWN and are read off the tables in `./origins.ts`: whether the
 * origin folds cours into seasons, whether it commissions its own episode titles, and whether every
 * one of its ids names a container. A source that declares the field wins over the table (4.6); none
 * of them declares one today, which is stated there rather than repeated here.
 *
 * WHAT IS DELIBERATELY SILENT. A rule with nothing to say writes NULL and never a zero: `NULL = the
 * titles name no season` is a different fact from `season 0`, and 284 of 4,159 real titles end in a
 * bare number that names no season at all (2026-08-11). Every column below that can be silent says so
 * where it is derived.
 */
import type { MediaType } from '../../store/types'
import type { Plugin, PluginContext, PluginOutput, PluginRow } from './contract'

import { isOnlySeasonLabel, parseSeasonNumber } from '../../../sources/season'
import { namesAPart, PART_MARKER } from '../../../sources/similar'
import { stripTitle } from '../../../sources/utils'
import { COMPANION_MARKERS, mergeType, WORK_KINDS } from '../../store/fuzzy-merge'
import {
  DECLARED_COUNT_ORIGINS, FOLDING_ORIGINS, NUMBER_SPACE_ORIGINS, RETRANSLATING_ORIGINS, SHOW_LEVEL_ORIGINS,
} from './origins'

/** The version of 5.1: bumped when a rule below changes, which retracts and recomputes every row. */
export const PROFILE_VERSION = 2

const MS_PER_DAY = 86_400_000

// A key with no letter is a year or a season number and never an identity: 1,321 of 1,430 wrong pairs
// merged on a key with no letter (2026-08-11). `carriesIdentity` (`fuzzy-merge.ts:132`) is the same
// test, one line above `isOnlySeasonLabel`, which catches the ones this waves through.
const HAS_LETTER = /\p{L}/u

// `YYYY-MM-DD` is the one shape whose day MEANS a day rather than an instant (`release-date.ts`), and
// 50 of 439 seed dates are written that way (2026-09-08).
const NAMED_DAY = /^\d{4}-\d{2}-\d{2}$/

/** One title key with the score, language and class of the title it came from (2.2, `titleKeys`). */
export type TitleKeyEntry = { key: string, score: number | null, language: string | null, class: string }

type RawTitle = { title?: unknown, language?: unknown, score?: unknown, class?: unknown }

const parseJson = (value: unknown): unknown => {
  if (typeof value !== 'string' || !value) return undefined
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A field the SOURCE declared, when it declared one as a string. The 4.6 fields arrive this way. */
const declaredText = (raw: Record<string, unknown>, field: string): string | undefined =>
  typeof raw[field] === 'string' && raw[field] ? raw[field] as string : undefined

/**
 * The title keys of one row: main titles stripped to letters, numbers and spaces, lower cased.
 *
 * Dropped when the key carries no letter, and when the title is only a season label: "Season 3" is
 * how Crunchyroll titles a great many seasons, and two unrelated shows both carrying it are identical
 * to any comparison made on titles alone (`season.ts:113-129`). Only `titles` is read, never a
 * synonym field: `minna no uta` sits on 23 unrelated shows (2026-08-29).
 *
 * MAIN is the only class any extractor emits today (`MediaTitle` carries no `class` at all, 4.6), so
 * a title with no class is MAIN and one that declares another class is dropped.
 */
export const titleKeysOf = (titles: unknown): TitleKeyEntry[] => {
  const entries = new Map<string, TitleKeyEntry>()
  for (const entry of Array.isArray(titles) ? titles as RawTitle[] : []) {
    if (!entry || typeof entry.title !== 'string') continue
    const titleClass = typeof entry.class === 'string' && entry.class ? entry.class : 'MAIN'
    if (titleClass !== 'MAIN') continue
    const key = stripTitle(entry.title)
    if (!key || !HAS_LETTER.test(key) || isOnlySeasonLabel(key)) continue
    const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null
    const language = typeof entry.language === 'string' ? entry.language : null
    const existing = entries.get(key)
    // best score per normalised title, which is what the six-title selection is measured on
    // (`fuzzy-merge.ts:215-219`, 69.6 / 99.9 / 70.0 against arrival order's 64.5 / 94.9 / 56.0)
    if (existing && (existing.score ?? -1) >= (score ?? -1)) continue
    entries.set(key, { key, score, language, class: titleClass })
  }
  return [...entries.values()].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * The same keys after NFD with combining marks removed, so `jôzu` reads as `jozu`.
 *
 * Produced now and consumed only behind `foldDiacritics`, which is off until the 150-season arm runs
 * (`CONFIDENT_TITLE_THRESHOLD`'s documented regression, 2026-09-09).
 */
export const foldedKeysOf = (keys: TitleKeyEntry[]): TitleKeyEntry[] => {
  const folded = new Map<string, TitleKeyEntry>()
  for (const entry of keys) {
    const key = entry.key.normalize('NFD').replace(/\p{M}/gu, '')
    const existing = folded.get(key)
    if (existing && (existing.score ?? -1) >= (entry.score ?? -1)) continue
    folded.set(key, { ...entry, key })
  }
  return [...folded.values()]
}

/**
 * The words a synopsis reduction drops because they sit in every synopsis ever written.
 *
 * Function words only, and every one of them four letters or longer, because `MIN_SYNOPSIS_TOKEN`
 * already drops everything shorter: `the`, `and`, `of`, `to` and the rest of the short half never
 * reach this set and are not listed in it. Nothing here names a person, a place or an event, which
 * is the whole test for membership: a word that could tell two episodes of one show apart is not a
 * stopword however often it appears.
 */
export const SYNOPSIS_STOPWORDS = new Set([
  'with', 'from', 'into', 'were', 'been', 'they', 'them', 'their', 'this', 'that',
  'when', 'then', 'than', 'what', 'which', 'while', 'where', 'after', 'before', 'have', 'over',
  'will', 'would', 'could', 'should', 'there', 'about', 'also', 'only', 'more', 'most', 'some',
  'such', 'very', 'just', 'these', 'those', 'upon', 'onto', 'because', 'through', 'during',
  'against', 'between', 'again', 'once', 'both', 'each',
])

/**
 * The shortest token a synopsis key keeps: 4.
 *
 * Measured 2026-09-13 over Mushoku Tensei's three Netflix seasons against TMDB's episode overviews
 * (61 rows of theirs, 61 of ours), scored and gated exactly as `plugin:range` rule 3 does it. The
 * three cuts either side, run through the shipped rule, as anchors PROPOSED, the count that
 * disagrees with the majority offset, and the anchors KEPT after the consensus gate:
 *
 * | cut | season 1 | season 2 | season 3 | kept in all |
 * | --- | --- | --- | --- | --- |
 * | 3 | 8, 1 wrong, 7 kept | 6, 0, 6 | 6, 1, 5 | 18 |
 * | 4 | 10, 1 wrong, 9 kept | 9, 2, 7 | 9, 1, 8 | 24 |
 * | 5 | 10, 0 wrong, 10 kept | 12, 7, NONE | 7, 0, 7 | 17 |
 *
 * FIVE IS NOT SAFER THAN FOUR, which is what the wrong column looks like it says. Season 2 at 5
 * splits 5 of 12 onto the true offset and the other 7 onto seven different wrong ones, which is a
 * bare PLURALITY and not a majority, so the consensus gate refuses the whole season and it keeps
 * nothing at all: the cut throws away `eris`, `paul` and `roxy`, the four letter tokens that
 * identify an episode of this show, and what is left is the vocabulary every synopsis shares. Three
 * costs recall for nothing, 18 anchors kept against 24, since consensus already removes every wrong
 * anchor at 4.
 *
 * WHAT IS AND IS NOT CORPUS-BACKED, said plainly because the rest of this rule now is. The FLOOR and
 * the MARGIN rule 3 anchors at were swept on 2026-09-13 over 63 shows, 189 Netflix seasons and 1037
 * true pairs (`SYNOPSIS_ANCHOR_FLOOR`, `scripts/calibrate-episode-anchors.test.ts`). THIS CUT was
 * not: the table above is still three seasons of one show, and the corpus sweep runs at the shipped
 * cut rather than across it. It is the weakest-evidenced constant on the synopsis path, and a sweep
 * of it is the obvious next measurement rather than a gap that has been argued away.
 */
export const MIN_SYNOPSIS_TOKEN = 4

/**
 * The fewest content words a synopsis key may carry and still be worth scoring: 5.
 *
 * A guard rather than a measurement, and it costs nothing measured: across the same 61 plus 61 rows
 * every non-empty key carries at least 6 content words, and the one key it refuses is empty (Netflix
 * season 3 episode 12, whose `contextualSynopsis` is a single space). It exists because token Dice
 * over two short keys is a coincidence rather than a similarity: two three-word keys sharing one
 * word score 0.333, which clears the 0.20 floor rule 3 anchors at while saying nothing at all.
 */
export const MIN_SYNOPSIS_KEY_TOKENS = 5

/**
 * One synopsis as a KEY: its content words, deduplicated, sorted, joined by a space.
 *
 * Sorted because a key is a bag of words and never a sentence: token Dice reads it as a set, so the
 * order carries no information, and a canonical order is what makes the column byte-stable across
 * passes and greppable in a trace. Empty when the text has fewer than `MIN_SYNOPSIS_KEY_TOKENS`
 * content words, so a caller never has to re-apply that bar.
 */
export const synopsisKeyOf = (text: string): string => {
  const tokens = [...new Set(
    stripTitle(text).split(' ').filter(token => token.length >= MIN_SYNOPSIS_TOKEN && !SYNOPSIS_STOPWORDS.has(token))
  )].sort()
  return tokens.length >= MIN_SYNOPSIS_KEY_TOKENS ? tokens.join(' ') : ''
}

/** One synopsis key with the score and language of the description it came from (`synopsisKeys`). */
export type SynopsisKeyEntry = { key: string, score: number | null, language: string | null }

type RawDescription = { description?: unknown, shortDescription?: unknown, language?: unknown, score?: unknown }

/**
 * The synopsis keys of one episode, off `descriptions` and `shortDescriptions` alike.
 *
 * BOTH FIELDS, because a source that has one synopsis writes it to both: `desc` (`utils.ts:153`)
 * emits the same text as a `description` and as a `shortDescription`, so reading one of the two
 * would silently halve the population for no reason anyone could find later. Identical texts
 * collapse to one key, which is what dedupe by key is for.
 *
 * Best score per distinct key, then key ascending, exactly as `titleKeysOf` orders its own, so two
 * passes over one row produce the same column in the same order.
 */
export const synopsisKeysOf = (descriptions: unknown, shortDescriptions: unknown): SynopsisKeyEntry[] => {
  const entries = new Map<string, SynopsisKeyEntry>()
  const read = (value: unknown, field: 'description' | 'shortDescription') => {
    for (const entry of Array.isArray(value) ? value as RawDescription[] : []) {
      if (!entry || typeof entry[field] !== 'string') continue
      const key = synopsisKeyOf(entry[field] as string)
      if (!key) continue
      const score = typeof entry.score === 'number' && Number.isFinite(entry.score) ? entry.score : null
      const language = typeof entry.language === 'string' ? entry.language : null
      const existing = entries.get(key)
      if (existing && (existing.score ?? -1) >= (score ?? -1)) continue
      entries.set(key, { key, score, language })
    }
  }
  read(descriptions, 'description')
  read(shortDescriptions, 'shortDescription')
  return [...entries.values()].sort((a, b) =>
    (b.score ?? -1) - (a.score ?? -1) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** What the titles say about which season and which part this row is (NULL when they are silent). */
export type Ordinals = { seasonOrdinal: number | null, partOrdinal: number | null, ordinalFrom: string | null }

/**
 * The season and part ordinals, read off the RAW titles.
 *
 * Raw rather than normalised, because `normalizeTitle` folds `Season 4` and `Season 40` closer
 * together and drops the delimiters `第 4 期` is allowed to carry (`fuzzy-merge.ts:324-325`).
 */
export const ordinalsOf = (titles: unknown): Ordinals => {
  const result: Ordinals = { seasonOrdinal: null, partOrdinal: null, ordinalFrom: null }
  for (const entry of Array.isArray(titles) ? titles as RawTitle[] : []) {
    if (!entry || typeof entry.title !== 'string') continue
    const title = entry.title
    const at = title.search(PART_MARKER)
    const head = at < 0 ? title : title.slice(0, at)
    const season = parseSeasonNumber(head)
    if (season !== undefined && result.seasonOrdinal === null) {
      result.seasonOrdinal = season
      result.ordinalFrom = title
    }
    if (at < 0 || !namesAPart(title)) continue
    const part = parseSeasonNumber(title.slice(at))
    if (part !== undefined && result.partOrdinal === null) {
      result.partOrdinal = part
      result.ordinalFrom ??= title
    }
  }
  return result
}

/** What a row's start date is worth: the precision, the day when it has one, and the year. */
export type DateReading = {
  datePrecision: 'day' | 'month-or-year' | 'none'
  startDay: number | null
  year: number | null
  dateDerivation: 'published' | 'coerced' | 'declared' | null
}

/**
 * The date reading of 5.4 P0, derived from the PARSED value and never from the string shape.
 *
 * A parsed `startDate` whose UTC day-of-month is 1 is `month-or-year` for every origin until that
 * origin declares `startDatePrecision`: AniList emits `toUTCString()` for every branch including its
 * year-only coercion (`aired-date.ts:33,44,50`) and jikan an offset-bearing ISO string, so a shape
 * test would admit both coerced dates to the 45 day veto. This is the shipped `startDay` rule
 * (`fuzzy-merge.ts:163-179`): 83 refused for 81 lost, ratio 1.02, and keeping January 1 as a day
 * would destroy 14,992 of 17,946 streaming attaches (`:150-156`, 2026-08-31). A declared precision
 * overrides, which is how a genuine January 1 premiere (4.91% of AniList's dated entries, 0.52% of
 * correct merges) becomes visible.
 *
 * The year survives a coercion, because a coerced date is still evidence of WHICH YEAR: only the day
 * is thrown away. With no parsable date at all every field is silent, `dateDerivation` included:
 * there is no derivation to name.
 */
export const dateReadingOf = (startDate: unknown, declaredPrecision?: string, declaredDerivation?: string): DateReading => {
  if (typeof startDate !== 'string' || !startDate) {
    return { datePrecision: 'none', startDay: null, year: null, dateDerivation: null }
  }
  const parsed = new Date(startDate)
  if (Number.isNaN(parsed.getTime())) return { datePrecision: 'none', startDay: null, year: null, dateDerivation: null }
  const year = parsed.getUTCFullYear()
  const coerced = parsed.getUTCDate() === 1
  const precision = declaredPrecision === 'day' || declaredPrecision === 'month-or-year' || declaredPrecision === 'none'
    ? declaredPrecision
    : coerced ? 'month-or-year' : 'day'
  const derivation = declaredDerivation === 'published' || declaredDerivation === 'coerced' || declaredDerivation === 'declared'
    ? declaredDerivation
    : declaredPrecision ? 'declared' : coerced ? 'coerced' : 'published'
  return {
    datePrecision: precision,
    startDay: precision === 'day' ? Math.floor(parsed.getTime() / MS_PER_DAY) : null,
    year,
    dateDerivation: derivation,
  }
}

/**
 * MOVIE or SERIES, as `profileCluster` derives it (`fuzzy-merge.ts:309`), for ONE row.
 *
 * A one-off special straddles the boundary and stays format-neutral. A row whose own categories and
 * type disagree (MOVIE beside SERIES) is silent rather than picking one: the disagreement is the
 * `kind-disagrees` anomaly of 5.5, and a guess here would hide it.
 *
 * A ROW THAT NAMES NO `type` OF ITS OWN NAMES NO FORMAT, whatever its categories say, and that is the
 * one place this differs from `profileCluster`. `categories` is the shelf a source files its rows
 * under, and at least one extractor stamps a CONSTANT on every row it mints: `anizip/extractor.ts:20`
 * puts `['ANIME', 'SERIES']` on a film as readily as on a series, and ani.zip publishes no `type` at
 * all. Read as a format, that constant is the source's default asserted as a fact about the work, and
 * guard 9 (`kind-mismatch`, 5.2) then refuses a first-party id claim on it: measured over the corpus
 * on 2026-09-12, EIGHT film clusters that mal, AniList, kitsu and offline all agree about lost their
 * anizip row to exactly that. The shipped store never saw it, because its format veto reads a whole
 * cluster the claims have already joined (`fuzzy-merge.ts:305-316`) and only ever blocks a candidate
 * from entering; the guard weighs the claim itself.
 */
export const formatOf = (type: unknown, categories: unknown): 'MOVIE' | 'SERIES' | null => {
  const kind = mergeType(typeof type === 'string' ? type as MediaType : null)
  if (kind === 'SPECIAL' || kind === 'OVA' || kind === 'ONA') return null
  if (!kind) return null
  const formats = new Set<string>()
  for (const category of Array.isArray(categories) ? categories : []) {
    if (category === 'MOVIE' || category === 'SERIES') formats.add(category)
  }
  if (kind === 'MOVIE') formats.add('MOVIE')
  if (kind === 'TV') formats.add('SERIES')
  return formats.size === 1 ? [...formats][0] as 'MOVIE' | 'SERIES' : null
}

/** The WORK this is, with TV_SHORT folded back to TV (`fuzzy-merge.ts:58,74`). */
export const workKindOf = (type: unknown): string | null => {
  const kind = mergeType(typeof type === 'string' ? type as MediaType : null)
  return kind && WORK_KINDS.has(kind) ? kind : null
}

/**
 * Whether this row's own titles name COMPANION CONTENT: a title ending in one of the ten measured
 * markers (`fuzzy-merge.ts:92-95`).
 *
 * The row-level flag records the MARKER and nothing else. The pairwise half of the rule, that the
 * other side holds the same title without the marker, needs two rows and belongs to the guard that
 * weighs the pair (5.2); this column is what that guard reads instead of re-stripping every title.
 */
export const companionOf = (titles: unknown): boolean => {
  for (const entry of Array.isArray(titles) ? titles as RawTitle[] : []) {
    if (!entry || typeof entry.title !== 'string') continue
    const stripped = stripTitle(entry.title)
    for (const marker of COMPANION_MARKERS) {
      if (stripped.length > marker.length + 1 && stripped.endsWith(` ${marker}`)) return true
    }
  }
  return false
}

/**
 * The same-origin id this one extends by `-<suffix>`, or nothing.
 *
 * Specificity is PREFIX EXTENSION, never length (`src/utils/uri.ts:23-34`): `cr:<series>-<season>`,
 * `nf:<title>-<n>`, `jw:<object>-<seasonObject>` and `<id>-s<n>` for tmdb, tvmaze and appletv are all
 * built that way. The caller keeps the answer only when the parent node EXISTS, which is what stops
 * `offline:mal-59193` from extending a nonexistent `offline:mal`.
 */
export const idParentCandidate = (uri: string): string | undefined => {
  const colon = uri.indexOf(':')
  if (colon <= 0) return undefined
  const id = uri.slice(colon + 1)
  const dash = id.lastIndexOf('-')
  if (dash <= 0 || dash === id.length - 1) return undefined
  return `${uri.slice(0, colon + 1)}${id.slice(0, dash)}`
}

/** The effective scope and the witnesses that said CONTAINER. */
export type ScopeReading = { scope: 'RUN' | 'CONTAINER' | null, scopeFrom: string[] }

type ClaimStamp = { kind?: unknown, targetScope?: unknown, claimer?: unknown, provenance?: unknown }

/**
 * The scope ratchet, computed as a VIEW over every answer and every claim stamp (5.4 P0).
 *
 * CONTAINER when any answer about this uri said CONTAINER, when any `source` or `ask` claim stamped
 * the target CONTAINER, or when the origin is show level; else RUN when the row is owned or any claim
 * stamped RUN; else NULL, and a NULL scope is what the `unknown-scope` guard waits on (`db.ts:113-123`).
 * A `seed` or an `address` stamp never counts, in either direction: the seed asserts identity rather
 * than scope, and an address is a pointer (`db.ts:142-146`, `db.ts:99-103`).
 *
 * Computed rather than stored, which is the whole point: a later RUN answer cannot flip a row that
 * one answer already described as a container, and nothing is overwritten to make that true.
 */
export const scopeReadingOf = (subject: {
  owned: boolean
  stamp: string | null
  showLevel: boolean
  claims: ClaimStamp[]
  answersSaid: { origin: string, said: string | null }[]
}): ScopeReading => {
  const scopeFrom: string[] = []
  if (subject.showLevel) scopeFrom.push('showLevelOrigin')
  for (const answer of subject.answersSaid) {
    if (answer.said === 'CONTAINER') scopeFrom.push(`answer:${answer.origin}`)
  }
  // the row's own stamp counts only when the row is OWNED: on a placeholder it is a copy of the
  // stamp the claim carried (4.3), and weighing it here would admit the `seed` and `address`
  // provenances the rule below excludes
  if (subject.owned && subject.stamp === 'CONTAINER') scopeFrom.push('row')
  let run = subject.owned
  for (const claim of subject.claims) {
    if (claim.provenance !== 'source' && claim.provenance !== 'ask') continue
    if (claim.targetScope === 'CONTAINER') scopeFrom.push(`claim:${String(claim.claimer)}`)
    if (claim.targetScope === 'RUN') run = true
  }
  const witnesses = [...new Set(scopeFrom)].sort()
  if (witnesses.length) return { scope: 'CONTAINER', scopeFrom: witnesses }
  return { scope: run ? 'RUN' : null, scopeFrom: [] }
}

/** The count reading: what the source stated, how it came by it, and what the graph actually holds. */
export type CountReading = {
  countKind: 'declared' | 'listLength' | 'none'
  countStated: number | null
  countDistinct: number | null
}

/**
 * The counts of 5.4 P0.
 *
 * `countStated` is the source's own figure and `countDistinct` is `count(DISTINCT HAS_EPISODE
 * targets hung by the row's own origin)`, which is what tells 14 rows over 10 distinct epids from a
 * season of 14 (netflixid 80198505 season 3, 2026-09-10). An empty list is `none`, never 0.
 */
export const countReadingOf = (
  origin: string,
  stated: unknown,
  ownEpisodes: number,
  declaredKind?: string
): CountReading => {
  const countStated = typeof stated === 'number' && Number.isSafeInteger(stated) ? stated : null
  const countDistinct = ownEpisodes > 0 ? ownEpisodes : null
  const kind = declaredKind === 'declared' || declaredKind === 'listLength' || declaredKind === 'none'
    ? declaredKind
    : countStated === null ? 'none'
    : DECLARED_COUNT_ORIGINS.has(origin) ? 'declared'
    : 'listLength'
  return { countKind: kind, countStated, countDistinct }
}

/** An episode's release date as a day, and how precisely it was named. */
export type DayReading = { day: number | null, dayPrecision: 'instant' | 'day' | 'none' }

/**
 * The episode day of 5.4 P0: an instant floored to its UTC day, a named `YYYY-MM-DD` taken as that
 * day, and nothing else (`consensus.ts:85-88`, `src/utils/release-date.ts`).
 */
export const dayReadingOf = (releaseDate: unknown): DayReading => {
  if (typeof releaseDate !== 'string' || !releaseDate) return { day: null, dayPrecision: 'none' }
  const at = Date.parse(releaseDate)
  if (!Number.isFinite(at)) return { day: null, dayPrecision: 'none' }
  return { day: Math.floor(at / MS_PER_DAY), dayPrecision: NAMED_DAY.test(releaseDate) ? 'day' : 'instant' }
}

// `json_extract` hands a JSON string back WITH its quotes ("RUN"), measured 2026-09-12 on 0.20.4.
const unquote = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value || value === 'null') return null
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

type MediaRow = {
  uri: string
  raw: string | null
  owned: boolean
  scope: string | null
  origin: string
  id: string
  type: string | null
  startDate: string | null
  episodeCount: number | null
  titles: string | null
  categories: string[] | null
}

type EpisodeRow = {
  uri: string
  origin: string
  releaseDate: string | null
  titles: string | null
  raw: string | null
}

/**
 * The candidate scan of 5.4 P0: one statement per subject, joined in JS on uri.
 *
 * Three `OPTIONAL MATCH`es off one row would multiply claims by answers by episodes before
 * aggregating (20 x 10 x 24 is 4,800 intermediate rows for one uri), so each relation is its own
 * statement and the rows meet in a Map.
 */
const scan = async (ctx: PluginContext, uris: string[] | undefined) => {
  const scoped = uris !== undefined
  const params = scoped ? { uris } : undefined
  // an empty `UNWIND` list dies at runtime on this engine, so an empty scope asks nothing
  const nothing = scoped && !uris.length
  const form = (subject: string, rest: string, tail: string) =>
    scoped
      ? `UNWIND $uris AS u MATCH (${subject} {uri: u})${rest} ${tail}`
      : `MATCH (${subject})${rest} ${tail}`

  const media = nothing ? [] : await ctx.query<MediaRow>(
    form('m:Media', '', `RETURN m.uri AS uri, m.raw AS raw, m.owned AS owned, m.scope AS scope, m.origin AS origin,
      m.id AS id, m.type AS type, m.startDate AS startDate, m.episodeCount AS episodeCount,
      m.titles AS titles, m.categories AS categories`),
    params
  )
  const claims = nothing ? [] : await ctx.query<{ uri: string, claims: ClaimStamp[] }>(
    form('m:Media', '<-[c:CLAIMS]-(:Media)',
      `RETURN m.uri AS uri, collect(DISTINCT {kind: c.kind, targetScope: c.targetScope, claimer: c.claimer, provenance: c.provenance}) AS claims`),
    params
  )
  const said = nothing ? [] : await ctx.query<{ uri: string, said: { origin: string, said: string }[] }>(
    form('m:Media', '<-[:ABOUT]-(a:Answer)',
      `RETURN m.uri AS uri, collect(DISTINCT {origin: a.origin, said: json_extract(a.raw, 'scope')}) AS said`),
    params
  )
  const owns = nothing ? [] : await ctx.query<{ uri: string, ownEpisodes: number }>(
    form('m:Media', '-[h:HAS_EPISODE]->(e:Episode)',
      `WHERE h.claimer = m.origin RETURN m.uri AS uri, count(DISTINCT e.uri) AS ownEpisodes`),
    params
  )
  const episodes = nothing ? [] : await ctx.query<EpisodeRow>(
    form('e:Episode', '', 'RETURN e.uri AS uri, e.origin AS origin, e.releaseDate AS releaseDate, e.titles AS titles, e.raw AS raw'),
    params
  )
  return { media, claims, said, owns, episodes }
}

/**
 * Both ends of every claim in `delta.claims`, as uris.
 *
 * The one thing a delta of claim keys cannot state, and the two plugins that scope themselves both
 * need it: a claim is written between two rows that may not have moved themselves, and a scan looks
 * a row up by uri. One keyed statement, which is the scan shape 5.3 allows. Exported because
 * `plugin:direct` asks the same question about the same list, and two spellings of it could disagree
 * about which end of a claim is a subject.
 */
export const claimEndpoints = async (ctx: PluginContext, keys: string[]): Promise<string[]> => {
  // an empty `UNWIND` list dies at runtime on this engine
  if (!keys.length) return []
  const rows = await ctx.query<{ fromUri: string, toUri: string }>(
    `UNWIND $keys AS k MATCH (a:Media)-[c:CLAIMS {key: k}]->(b:Media)
     RETURN a.uri AS fromUri, b.uri AS toUri`,
    { keys }
  )
  return [...new Set(rows.flatMap(row => [row.fromUri, row.toUri]))]
}

/**
 * The uris a scoped run recomputes: the delta's own rows, plus both ends of every claim in it.
 *
 * A profile reads the claims INTO its subject (the effective scope vote of 5.4 P0 is partly a vote of
 * who claimed it), so a new claim about a row that did not otherwise move is a delta for that row.
 */
const subjectsOf = async (ctx: PluginContext): Promise<string[]> =>
  [...new Set([...ctx.delta.media, ...ctx.delta.episodes, ...await claimEndpoints(ctx, ctx.delta.claims)])]

/** The `MediaProfile` row for one subject: every rule of 5.4 P0, in the order the table lists them. */
const mediaProfileRow = (
  row: MediaRow,
  claims: ClaimStamp[],
  said: { origin: string, said: string | null }[],
  ownEpisodes: number
): { profile: PluginRow, keys: TitleKeyEntry[] } => {
  const raw = asRecord(parseJson(row.raw))
  const titles = parseJson(row.titles) ?? raw.titles
  const showLevel = SHOW_LEVEL_ORIGINS.has(row.origin)
  const format = formatOf(row.type ?? raw.type, row.categories ?? raw.categories)
  const { scope, scopeFrom } = scopeReadingOf({
    owned: row.owned,
    stamp: row.scope,
    showLevel,
    claims,
    answersSaid: said,
  })
  const keys = titleKeysOf(titles)
  const ordinals = ordinalsOf(titles)
  const date = dateReadingOf(
    row.startDate ?? raw.startDate,
    declaredText(raw, 'startDatePrecision'),
    declaredText(raw, 'startDateDerivation')
  )
  const counts = countReadingOf(row.origin, row.episodeCount, ownEpisodes, declaredText(raw, 'episodeCountKind'))
  // a declared subject first; else the effective scope decides, so a container row's 2021-01-01 never
  // buckets a year (5.4 P0, and the source-side protection of 912227f is what it eventually replaces)
  const dateSubject = declaredText(raw, 'startDateSubject') ?? (scope === 'RUN' ? 'run' : 'container')
  return {
    keys,
    profile: {
      uri: row.uri,
      scope,
      scopeFrom,
      dateSubject,
      titleKeys: keys,
      titleKeysFolded: foldedKeysOf(keys),
      seasonOrdinal: ordinals.seasonOrdinal,
      partOrdinal: ordinals.partOrdinal,
      ordinalFrom: ordinals.ordinalFrom,
      year: date.year,
      startDay: date.startDay,
      datePrecision: date.datePrecision,
      dateDerivation: date.dateDerivation,
      format,
      workKind: workKindOf(row.type ?? raw.type),
      companion: companionOf(titles),
      countKind: counts.countKind,
      countStated: counts.countStated,
      countDistinct: counts.countDistinct,
      // a film has no cours to fold
      folding: FOLDING_ORIGINS.has(row.origin) && format !== 'MOVIE',
      retranslates: RETRANSLATING_ORIGINS.has(row.origin),
      showLevelOrigin: showLevel,
      idParent: null,
    },
  }
}

/** The `EpisodeProfile` row for one episode. */
const episodeProfileRow = (row: EpisodeRow, ctx: PluginContext): PluginRow => {
  const raw = asRecord(parseJson(row.raw))
  const titles = parseJson(row.titles) ?? raw.titles
  const list = Array.isArray(titles) ? titles as RawTitle[] : []
  const day = dayReadingOf(row.releaseDate ?? raw.releaseDate)
  const declaredSpace = declaredText(raw, 'episodeNumberSpace')
  return {
    uri: row.uri,
    day: day.day,
    dayPrecision: day.dayPrecision,
    numberSpace: declaredSpace ?? NUMBER_SPACE_ORIGINS[row.origin] ?? 'season',
    // an episode's keys carry no score tier of their own to defend, so they are the same strip rule
    // with the generic titles dropped: 'Episode 13' carries no identity (`similar.ts:104`)
    titleKeys: titleKeysOf(titles).filter(entry => !ctx.isGenericEpisodeTitle(entry.key)),
    // the synopsis as a bag of content words, which is the third thing rule 3 may anchor on (5.4 P4).
    // `Episode` carries no description column of its own, so the only place the text exists is `raw`
    synopsisKeys: synopsisKeysOf(raw.descriptions, raw.shortDescriptions),
    // a row with no title at all is as anonymous as one titled by its own number
    generic: !list.length || list.every(entry => typeof entry.title !== 'string' || ctx.isGenericEpisodeTitle(entry.title)),
  }
}

/**
 * `plugin:profile`, P0 of 5.4.
 *
 * Consumes `Media`, `Episode`, `Answer`, `ABOUT`, `CLAIMS` and `HAS_EPISODE`; produces
 * `MediaProfile`, `EpisodeProfile`, `PROFILE_OF`, `TitleKey` and `HAS_KEY`; `after: []`, so it is
 * first in every pass and every other plugin reads its output rather than `raw`.
 */
export const profilePlugin: Plugin = {
  id: 'plugin:profile',
  consumes: { nodes: ['Media', 'Episode', 'Answer'], edges: ['ABOUT', 'CLAIMS', 'HAS_EPISODE'] },
  produces: { nodes: ['MediaProfile', 'EpisodeProfile', 'TitleKey'], edges: ['PROFILE_OF', 'HAS_KEY'] },
  after: [],
  version: PROFILE_VERSION,
  run: async (ctx: PluginContext): Promise<PluginOutput> => {
    const subjects = ctx.delta.full ? undefined : await subjectsOf(ctx)
    const { media, claims, said, owns, episodes } = await scan(ctx, subjects)

    const claimsByUri = new Map(claims.map(row => [row.uri, row.claims ?? []]))
    const saidByUri = new Map(said.map(row => [row.uri, (row.said ?? []).map(entry => ({ origin: entry.origin, said: unquote(entry.said) }))]))
    const ownsByUri = new Map(owns.map(row => [row.uri, Number(row.ownEpisodes ?? 0)]))

    const profiles: PluginRow[] = []
    const hasKey: PluginRow[] = []
    const keyNodes = new Map<string, PluginRow>()
    const parents = new Map<string, string>()
    for (const row of media) {
      const { profile, keys } = mediaProfileRow(row, claimsByUri.get(row.uri) ?? [], saidByUri.get(row.uri) ?? [], ownsByUri.get(row.uri) ?? 0)
      profiles.push(profile)
      const candidate = idParentCandidate(row.uri)
      if (candidate) parents.set(row.uri, candidate)
      for (const entry of keys) {
        keyNodes.set(entry.key, { key: entry.key })
        hasKey.push({ from: row.uri, to: entry.key, key: entry.key, score: entry.score, language: entry.language, class: entry.class })
      }
    }

    // the id parent exists only when its NODE does, which is the whole guard: `offline:mal-59193`
    // proposes `offline:mal` and no such row was ever named
    if (parents.size) {
      const found = new Set((await ctx.query<{ uri: string }>(
        'UNWIND $uris AS u MATCH (m:Media {uri: u}) RETURN m.uri AS uri',
        { uris: [...new Set(parents.values())] }
      )).map(row => row.uri))
      for (const profile of profiles) {
        const candidate = parents.get(profile.uri as string)
        if (candidate && found.has(candidate)) profile.idParent = candidate
      }
    }

    const episodeProfiles = episodes.map(row => episodeProfileRow(row, ctx))

    return {
      scope: subjects === undefined ? { full: true } : { full: false, uris: subjects, clusters: [], pairs: [] },
      nodes: [
        { table: 'MediaProfile', rows: profiles },
        { table: 'EpisodeProfile', rows: episodeProfiles },
        { table: 'TitleKey', rows: [...keyNodes.values()] },
      ],
      edges: [
        {
          table: 'PROFILE_OF',
          rows: [
            ...profiles.map(profile => ({ from: profile.uri as string, to: profile.uri as string })),
            ...episodeProfiles.map(profile => ({ from: profile.uri as string, to: profile.uri as string })),
          ],
        },
        { table: 'HAS_KEY', rows: hasKey },
      ],
      links: [],
      episodeLinks: [],
    }
  },
}
