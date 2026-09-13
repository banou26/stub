// Season identity for sources that model a SHOW where stub models a season.
//
// TMDB, JustWatch, IMDb and TVmaze all describe a series as one entity with seasons hanging off it.
// Stub has no such entity - every media here is one season - so a source that hands back the show's id
// hands the same id back for every season, and clustering union-finds them into a single media. That
// is what merged all three Mushoku Tensei seasons, and what made picking season 2 out of search open
// season 3.
//
// Split into its own module with NO imports so it can be tested: an extractor pulls in the source
// barrel and, through it, a CommonJS `require('react')` that cannot load outside a browser.

/**
 * The four broadcast seasons, indexed by calendar quarter.
 *
 * Every catalogue that models a season agrees on this split (Jan to Mar is winter, and so on), so a
 * source only has to spell the names differently, never the boundaries.
 */
export const ANIME_SEASONS = ['winter', 'spring', 'summer', 'fall'] as const
export type AnimeSeason = (typeof ANIME_SEASONS)[number]

/**
 * Which season a date falls in. Shared rather than per-extractor so a new seasonal source cannot
 * quietly disagree with the others about which season "now" is, which would show two different
 * catalogues on one page for the three months they disagreed.
 */
export const animeSeasonOf = (date = new Date()): { season: AnimeSeason, year: number } => ({
  season: ANIME_SEASONS[Math.floor(date.getMonth() / 3)]!,
  year: date.getFullYear()
})

/**
 * The same four seasons in the spelling the graphql schema uses.
 *
 * Two spellings exist because two vocabularies do: the catalogues this file was written for name a
 * season in lower case, and every enum in the schema is upper. Rather than let a third appear, both
 * live here with the two functions below as the ONLY bridge, so a consumer converts instead of
 * re-deriving. `mediaSeasonEnum` in worker/store/types.ts mirrors this list, the same way that file
 * mirrors every other schema enum.
 */
export const MEDIA_SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
export type MediaSeasonName = (typeof MEDIA_SEASONS)[number]

/** A lower-case season name as the schema spells it. */
export const upperSeason = (season: AnimeSeason): MediaSeasonName =>
  season.toUpperCase() as MediaSeasonName

/** A schema season name as this file's catalogues spell it, or nothing when it names no season. */
export const lowerSeason = (season: string): AnimeSeason | undefined =>
  ANIME_SEASONS.find(candidate => candidate === season.toLowerCase())

/** The season the clock is in, in the schema's spelling. */
export const mediaSeasonNow = (date = new Date()): { season: MediaSeasonName, year: number } => {
  const { season, year } = animeSeasonOf(date)
  return { season: upperSeason(season), year }
}

const CJK_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }

// 十 is a multiplier, not a digit: 十二 is 12, 二十 is 20, 二十一 is 21.
const cjkNumber = (text: string): number | undefined => {
  if (/^\d+$/.test(text)) return Number(text)
  let total = 0
  let current = 0
  for (const char of text) {
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
      continue
    }
    const digit = CJK_DIGITS[char]
    if (digit === undefined) return undefined
    current = digit
  }
  return total + current || undefined
}

// Every season spelling the metadata sources actually use, counted over 4159 real AniList and ani.zip
// titles: `Season N` 176, `Nth Season` 81, `第N季` 62, `第N期` 43, `Part N` 31, `S<N>` 27, `シーズンN` 11,
// `Cour N` 6, `N기` 1. Only the first and the sixth used to parse, so half of every catalogue looked
// season-less and a show could not be told apart from its own next season.
//
// 話 and 集 are deliberately absent: those count episodes.
//
// The ordinal form is tried FIRST because the prefix form can read straight through it: the number
// after the word in `4th Season 2-nensei-hen Ichi Gakki` belongs to the subtitle, and matching
// `Season 2` there called the 4th season the 2nd. Nothing is lost by the order, since `Season 4`
// carries no ordinal for the first pattern to find.
const SEASON_PATTERNS = [
  /\b(\d{1,3})(?:st|nd|rd|th)\s+(?:season|part|cour)\b/i,
  /\b(?:season|part|cour)\s*(\d{1,3})\b/i,
  /シーズン\s*(\d{1,3})/,
  /第\s*([\d〇零一二三四五六七八九十]{1,4})\s*[期季]/,
  /(\d{1,3})\s*[期기]/,
  /\bS(\d{1,2})\b/,
]

/**
 * The same grammar as a REMOVAL, for building a shorter search query out of a title.
 *
 * Deliberately narrower than SEASON_PATTERNS, because reading a number and deleting text carry
 * different risks. `\bS\d\b` is left out: it reads a season fine but deleting a bare `S2` out of a
 * title that merely contains one costs more than the query it would buy. The word ordinals are here
 * and not above for the mirror reason, they only ever appear as a season and there is nothing to
 * read off them that the catalogue query needs.
 *
 * Global, so a title carrying both `Season 2` and `Part 2` loses both.
 *
 * `pt.` IS `part`, and leaving the abbreviation out cost a whole source. Measured 2026-09-14 on
 * Re:Zero's 2026 run: one member carried the title `Season 2, Pt. 2`, which `isOnlySeasonLabel` let
 * through because the residue `, Pt. 2` still has letters in it. That title then put a second season
 * ORDINAL on the run's evidence, `seasonOrdinals` read 2 and 4, and `pickContainingSeason` refuses
 * outright when the titles disagree about which season the run is (`similar.ts`). So Netflix answered
 * nothing for that page: 0 episode links against 52 with the abbreviation known.
 */
export const SEASON_MARKER: readonly RegExp[] = [
  /\s*\b(?:(?:season|part|pt\.?|cour)\s*\d{1,3}|\d{1,3}(?:st|nd|rd|th)\s+(?:season|part|pt\.?|cour)|(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:season|part|pt\.?|cour))\b/gi,
  /\s*(?:シーズン\s*\d{1,3}|第\s*[\d〇零一二三四五六七八九十]{1,4}\s*[期季])/g,
]

const HAS_LETTER = /\p{L}/u

/**
 * A title that is nothing but a season label, so it names a POSITION and never a show.
 *
 * Crunchyroll titles a season the way its catalogue does, which for a great many series is the literal
 * string "Season 3", and that title reaches the store as the media's own. Two unrelated shows both
 * carrying it are then identical to any comparison made on titles alone: it is what merged
 * "Grand Blue Dreaming Season 3" into "Mushoku Tensei Season 3", measured on the exact-title shortcut
 * in the fuzzy merge, and it merged a different pair on almost every run because it only needs two
 * shows on their third season to be on screen together.
 *
 * `\p{L}` alone does not catch these: "season 3" is full of letters. What makes it empty is that
 * removing the season markers leaves nothing behind.
 */
export const isOnlySeasonLabel = (title: string): boolean =>
  !HAS_LETTER.test(SEASON_MARKER.reduce((text, marker) => text.replace(marker, ' '), title))

/** 'Mushoku Tensei Season 3', '... 2nd Season', '転生したら剣でした 第2期', '幼女战记 第二季' -> the number. */
export const parseSeasonNumber = (title: string): number | undefined => {
  for (const pattern of SEASON_PATTERNS) {
    const match = pattern.exec(title)
    if (match) {
      const value = cjkNumber(match[1]!)
      if (value !== undefined) return value
    }
  }
  return undefined
}

/**
 * The ONE season holding exactly this many episodes, or nothing.
 *
 * The fallback for when nothing in the title says, so it is only ever reached after the title has been
 * tried, and it returns nothing when there is only one season because then there is nothing to choose.
 *
 * IT USED TO TAKE THE NEAREST SEASON AT ANY DISTANCE AND BREAK A TIE BY TAKING THE FIRST, which is two
 * guesses wearing one function. The result is a season-scoped id, and a season-scoped id is an
 * identity claim: two of our runs handed the same one are unioned by `upsertMedia` with no inverse.
 * So a wrong answer here is not a wrong row, it is two shows permanently welded for the session.
 *
 * MEASURED 2026-09-01 over 33 real multi-season Netflix series and the 105 anime runs that clear the
 * source's own title gate, by `scripts/measure-unogs-season-match.probe.ts`. A weld is one of our runs
 * landing on a season another run already holds:
 *
 *   rule                                   welds   assigned   refused
 *   nearest at any distance, first on tie      51        105         0     what this replaces
 *   nearest, refusing a tie                    22         57        48
 *   exact and unique                           11         49        56     this
 *
 * The tolerance in between was swept rather than guessed, floor 0 to 3 episodes against a share of 0
 * to 1 of the run's length, and it buys assignments at about 1.6 per extra weld the whole way. That
 * exchange rate is not worth taking when one side is permanent and the other is a missing streaming
 * row, so the allowance is zero. 48 of those 105 runs hit a tie on count alone, which is why the
 * title has to be tried first and why this refuses so much: the axis is genuinely ambiguous for
 * nearly half the population.
 *
 * WHAT IT CANNOT DO. A run can match one season exactly and uniquely while three OTHER runs of the
 * same show match it too, and this function sees one run at a time. That residue (11 of 105) is the
 * same one catalogue-gate.ts records: a source matching a season cluster to a catalogue that models
 * shows has no view of the other clusters, and it cannot be closed here.
 */
export const pickSeasonByEpisodeCount = (
  seasons: { seasonNumber: number, episodeCount: number }[],
  targetCount: number
): number | undefined => {
  if (seasons.length <= 1) return undefined
  const exact = seasons.filter(season => season.episodeCount === targetCount)
  return exact.length === 1 ? exact[0]!.seasonNumber : undefined
}

// The '-s<n>' suffix, which is what TMDB's own episode ids already use ('94664-s3e1'). Keeping the
// media on the same convention means the two read as one id space rather than two.
const SEASON_SCOPED = /^(.+)-s(\d{1,3})$/

/** A show id scoped to one season. The only id shape a season-scoped media may carry. */
export const seasonScopedId = (id: string | number, seasonNumber: number) => `${id}-s${seasonNumber}`

/** Reverse of seasonScopedId: the show to ask for, and the season the uri pinned. */
export const splitSeasonScopedId = (id: string): { showId: string, seasonNumber?: number } => {
  const match = SEASON_SCOPED.exec(id)
  return match ? { showId: match[1]!, seasonNumber: Number(match[2]) } : { showId: id }
}

/**
 * Whether a start date is precise enough to pick a RUN with, as opposed to naming a year.
 *
 * Seven extractors BUILD a date out of a bare year and template it as January 1: justwatch, omdb,
 * tmdb, tvdb, unogs (twice) and crunchyroll's own show-level media all do it, and nothing downstream
 * can tell one of those from a show that really did premiere on New Year's Day. kitsu and jikan do
 * the softer version, answering `YYYY-MM-01` whenever only the month is known, which is up to 30 days
 * out while reading as exact.
 *
 * Against a 45 day window that is not a rounding error, it is the difference between naming a cour
 * and naming a year, so a coerced date has to be refused rather than matched. Refusing costs a source
 * its link; accepting welds it to whichever run happens to sit nearest a date nobody asserted.
 *
 * This is the same reasoning, and the same two shapes, that `startDay` in worker/store/fuzzy-merge.ts
 * drops before comparing two clusters. It lives here rather than there because this module imports
 * nothing, so an extractor can read it without dragging the store in.
 *
 * A genuine first-of-month premiere is refused too. That is the safe direction: the caller simply
 * does not get a season-scoped handle, which is where it was before it asked.
 *
 * READS THE UTC DAY, so hand it a UTC or ISO string. A date built with `new Date(y, m, d)` is LOCAL
 * midnight, and anilist/extractor.ts builds exactly that before calling `.toUTCString()`, so east of
 * UTC a local January 1 is December 31 in UTC and would slip past this check. Everything that reaches
 * here today is an upstream `YYYY-MM-DD` or an ISO string, which parses as UTC; the trap is worth
 * knowing before this is pointed at a locally-constructed date.
 */
export const namesADay = (date: string | null | undefined): boolean => {
  if (!date) return false
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return false
  return parsed.getUTCDate() !== 1
}
