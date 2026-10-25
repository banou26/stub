// The evidence rules behind `similarMedia`, in ONE module every answering source goes through.
//
// A season number is a guess: no two catalogues number a show's seasons the same way (Netflix folds
// two cours into one season, JustWatch numbers by its own list, anime metadata says "Season 2 Part 2"),
// so a season-scoped id minted by ordinal is a guess wearing a precise uri, and the store unions it
// with no inverse. What may go on a union is VERIFIED sameness, and this module is where verification
// is defined: a caller describes its run, a source describes its seasons, and the pick below either
// establishes one season or refuses.
//
// The rules decide WHICH season of a show and never WHICH show: the show id the caller holds settles
// that, and it came off a PART_OF edge whose container cluster the fuzzy title pass may have unioned
// on a listing. A wrong container union upstream is trusted here, so a pick is only as right as it.
//
// Imports only the pure season helpers, `stripTitle`, `bestTitleScore` and the shared 45 day window,
// so it loads under vitest and inside every extractor alike.
import { SEASON_DATE_WINDOW } from './catalogue-gate'
import { namesADay, parseSeasonNumber } from './season'
import { bestTitleScore, stripTitle } from './utils'

/** What a caller knows about ITS run. Every field optional; `hasEvidence` says whether any is usable. */
export type RunEvidence = {
  startDate?: string | null
  titles?: readonly string[] | null
  episodeCount?: number | null
  episodeTitles?: readonly string[] | null
}

/** One season of the answering source, described with whatever that source can see without guessing. */
export type SeasonCandidate<T> = {
  season: T
  seasonNumber?: number | null
  episodeCount?: number | null
  /** the season's own premiere: an ISO string or epoch milliseconds */
  premiere?: string | number | null
  /** the season's year when that is all the source knows; read as a veto, never as a match */
  year?: number | null
  episodeTitles?: readonly string[] | null
}

export type SimilarRule = 'date' | 'episode-titles' | 'ordinal' | 'year' | 'first'
export type SimilarVerdict<T> = { season: T, rule: SimilarRule }

/** The part of an answer every caller of `similarMedia` reads: enough to build a handle and to check it. */
export type SimilarAnswerMedia = {
  uri: string
  origin: string
  id: string
  scope?: string | null
  titles?: readonly { title: string }[] | null
}
export type SimilarDeclineReason = 'not-implemented' | 'bad-show-id' | 'no-evidence' | 'ceiling' | 'timeout' | 'error'
export type SimilarRefusalReason = 'null' | 'not-a-run'
/**
 * What one ask came to. `declined` never reached the source and may be retried; `refused` did and is
 * final for that evidence.
 *
 * `containing` is a season that HOLDS the asked run without being it (4.4 of the representation
 * design): the fold, where the answerer's season covers the run's start and is longer than it. It is
 * its own outcome rather than a flag on `answered` so that nothing reading `outcome === 'answered'`
 * can mistake a container for the run, which is the weld the whole ask exists to avoid: the caller
 * that wants a season claims `PART_OF` from it, and every other caller gets nothing.
 */
export type SimilarOutcome<M extends SimilarAnswerMedia = SimilarAnswerMedia> =
  | { outcome: 'answered', media: M }
  | { outcome: 'containing', media: M }
  | { outcome: 'refused', reason: SimilarRefusalReason }
  | { outcome: 'declined', reason: SimilarDeclineReason }

/**
 * The share of a candidate season's real episode titles our run must carry to be that season.
 *
 * Measured against the CANDIDATE, so a fold of two equal cours scores 12/24 = 0.50 and a fold of 13
 * and 12 scores 0.52 or 0.48, all refused even when our count is unknown and the fold veto cannot
 * fire; a season with a four episode bonus block folded in scores 12/16 = 0.75 and is admitted, since
 * a bonus block is not a run. The recall cost of title drift between translations is unmeasured.
 */
export const EPISODE_TITLE_COVERAGE = 0.6
/** One shared title ("The Beginning", a recap name) is a coincidence; three is not. */
export const MIN_EPISODE_TITLE_MATCHES = 3

const parseTime = (date: string | number | null | undefined): number | undefined => {
  if (date == null || date === '') return undefined
  const time = typeof date === 'number' ? date : Date.parse(date)
  return Number.isNaN(time) ? undefined : time
}

const yearOf = (date: string | number | null | undefined): number | undefined => {
  const time = parseTime(date)
  return time === undefined ? undefined : new Date(time).getUTCFullYear()
}

/** Whether a caller said anything a season could be matched against. */
export const hasEvidence = ({ startDate, titles, episodeCount, episodeTitles }: RunEvidence): boolean =>
  Boolean(startDate && !Number.isNaN(Date.parse(startDate)))
  || Boolean(titles?.length)
  || episodeCount != null
  || Boolean(episodeTitles?.length)

// 'Part 2', 'Part II', 'Part Two', 'Cour 3'; '2nd Part', 'Second Cour', 'Final Part', 'Second Half'.
// AniList, MAL and kitsu spell parts with digits; synonyms and other catalogues spell them out.
const PART_NUMBERED = /\b(?:part|cour)\s*(?:\d{1,3}|[ivx]{1,4}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
const PART_ORDINAL = /\b(?:\d{1,3}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|final|last)\s+(?:part|cour|half)\b/i

/**
 * A title naming a PART or a COUR. A part number is a position inside a season and maps to no
 * catalogue's season list, which is the owner's "season 2 part 3, season 2 part 4".
 */
export const namesAPart = (title: string): boolean => PART_NUMBERED.test(title) || PART_ORDINAL.test(title)

/** Every season ordinal the titles carry. More than one means the titles disagree. */
export const seasonOrdinals = (titles: readonly string[] | null | undefined): Set<number> =>
  new Set((titles ?? []).map(parseSeasonNumber).filter((n): n is number => n != null))

/**
 * A SPLIT POINT, not a second grammar, and the same one `plugin:profile`'s `ordinalsOf` reads with.
 *
 * A title carrying both a season and a part ("Season 2 Part 3") puts the season before the part in
 * every spelling the sources use, so the head is the season's and the tail is the part's, and
 * `parseSeasonNumber` reads each side with the one parser.
 */
export const PART_MARKER = /\b(?:part|cour|half)\b/i

/**
 * Every ordinal the titles name as a SEASON: `parseSeasonNumber` over the head of each title, before
 * any part marker.
 *
 * The difference from `seasonOrdinals` is the whole of what this is for, and it is the 2026-09-13
 * Mushoku Tensei stop. `parseSeasonNumber` reads `Part 2` as 2, so "<show> Part 2" (anime season 1's
 * second cour, which lives in Netflix's season 1) and "<show> Season 2 Part 2" (which lives in
 * Netflix's season 2) both answer `{2}` there. Reading the head alone gives the first NO ordinal and
 * the second its real one, which is the only reason an ordinal is safe to place a container on.
 */
export const namedSeasonOrdinals = (titles: readonly string[] | null | undefined): Set<number> =>
  new Set((titles ?? [])
    .map(title => {
      const at = title.search(PART_MARKER)
      return at < 0 ? title : title.slice(0, at)
    })
    .map(parseSeasonNumber)
    .filter((n): n is number => n != null))

/**
 * A part that does not open the season its title names. "Season 3 Cour 1" starts where season 3 starts,
 * so the ordinal places it exactly as the bare "Season 3" beside it does: ani.zip spells The Apothecary
 * Diaries' third season that way, and its marker alone refused Netflix's season 3 (2026-10-26).
 *
 * The head before the marker has to name the very ordinal rule 3 reads off the whole title. So a first
 * part naming no season ("Final Chapters Part 1", whose only number is the part's) still counts, and so
 * does one whose season `parseSeasonNumber` tries after the part ("S2 Part 1" reads 1, "第2期 Part 1" too).
 */
const namesALaterPart = (title: string): boolean => {
  if (!namesAPart(title)) return false
  const at = title.search(PART_MARKER)
  return at < 0 || parseSeasonNumber(title.slice(0, at)) !== parseSeasonNumber(title) || parseSeasonNumber(title.slice(at)) !== 1
}

const GENERIC_EPISODE = /^(?:episode|ep|e|part|chapter|第)?\s*\d+\s*(?:話|集|화)?$/
const HAS_LETTER = /\p{L}/u

/** 'Episode 12', '第3話', '7': a title that names a position and never an episode. */
export const isGenericEpisodeTitle = (title: string): boolean => {
  const stripped = stripTitle(title)
  return !HAS_LETTER.test(stripped) || GENERIC_EPISODE.test(stripped)
}

/**
 * The date to describe a run with, out of its members' dates ordered by score descending: the first
 * one naming a DAY, else the first non-empty one. A day-precise date is worth more than a
 * higher-scored `YYYY-01-01`, since only a day can be measured against a 45 day window.
 */
export const bestRunStartDate = (dates: readonly (string | null | undefined)[]): string | undefined =>
  dates.find(date => namesADay(date)) ?? dates.find((date): date is string => Boolean(date))

/**
 * Whether an answer is a RUN of the asked origin, and never the show itself. A source answering with
 * its bare show id is refused whatever scope it stamped, because that id is every season at once.
 */
export const isRunAnswerFrom = (
  origin: string,
  showId: string,
  answer: { origin: string, id: string, scope?: string | null }
): boolean => answer.origin === origin && answer.scope !== 'CONTAINER' && answer.id !== showId

const candidateYear = <T>(candidate: SeasonCandidate<T>): number | undefined =>
  candidate.year ?? yearOf(candidate.premiere)

// A season listing ZERO episodes (announced, or a listing this region cannot see) has no length, and
// read as a length it fit under every run's count: two runs two years apart both took a crunchyroll
// season whose episodes payload was empty (2026-09-05).
const countOf = <T>(candidate: SeasonCandidate<T>): number | undefined => candidate.episodeCount || undefined

/**
 * A season holding MORE episodes than the run holds other runs too (Netflix season 2 = 25 over 13 and
 * 12). Zero tolerance, the same allowance season.ts measured as the only one worth having.
 *
 * Exported because a picker that answers on its own axes still needs it: Crunchyroll's search path
 * matches on title and premiere, and a catalogue that folds two cours into one season premieres on
 * the SAME DAY as the first of them, so neither axis can see the fold.
 */
export const foldVetoed = <T>(evidence: RunEvidence, candidate: SeasonCandidate<T>): boolean => {
  const theirs = countOf(candidate)
  return theirs != null && evidence.episodeCount != null && theirs > evidence.episodeCount
}

// A season dated another year is not our run, whatever else fits: this closes the sequel with no
// ordinal, a "Show II" of 12 episodes in 2024 that would otherwise take season 1 of 12 from 2022.
const yearVetoed = <T>(evidence: RunEvidence, candidate: SeasonCandidate<T>): boolean => {
  const theirs = candidateYear(candidate)
  const ours = yearOf(evidence.startDate)
  return theirs != null && ours != null && theirs !== ours
}

const realTitles = (titles: readonly string[] | null | undefined): string[] =>
  (titles ?? []).filter(title => !isGenericEpisodeTitle(title))

/**
 * The one season of a show that the evidence establishes as the caller's run, or undefined.
 *
 * The rules run in order; a rule that does not apply falls to the next, and a rule that applies but
 * finds nothing unambiguous REFUSES outright. Every rule picks over ALL candidates and only then
 * checks the vetoes on its pick: a vetoed pick is a refusal, never a fall-through to the next best
 * candidate, because that fall-through is precisely how season 1 of Mushoku Tensei reached Netflix
 * season 3 once season 1 was excluded. The FOLD veto applies to every rule; the YEAR veto to every
 * rule but the date, which is finer than a year and legitimately crosses a New Year.
 */
export const pickSimilarSeason = <T>(
  evidence: RunEvidence,
  candidates: readonly SeasonCandidate<T>[]
): SimilarVerdict<T> | undefined => {
  const titles = evidence.titles ?? []
  const partNamed = titles.some(namesALaterPart)
  const ordinals = seasonOrdinals(titles)
  const evidenceYear = yearOf(evidence.startDate)

  // Rule 1, DATE: a premiere within the window of a day-precise start. Zero within means the
  // catalogues disagree about when this run started; two within is two parts released together.
  const start = namesADay(evidence.startDate) ? parseTime(evidence.startDate) : undefined
  if (start !== undefined && candidates.some(candidate => parseTime(candidate.premiere) !== undefined)) {
    const within = candidates.filter(candidate => {
      const premiere = parseTime(candidate.premiere)
      return premiere !== undefined && Math.abs(premiere - start) <= SEASON_DATE_WINDOW
    })
    if (within.length !== 1 || foldVetoed(evidence, within[0]!)) return undefined
    return { season: within[0]!.season, rule: 'date' }
  }

  // Rule 2, EPISODE TITLES: decisive about the seasons it can MEASURE, and silent about the rest.
  // Two catalogues carrying three or more real episode titles each for one run agree on most of them;
  // two runs of one show share none.
  //
  // A candidate carrying fewer than `MIN_EPISODE_TITLE_MATCHES` real titles is UNMEASURABLE, and the
  // difference between unmeasurable and refuted is the whole of what this rule got wrong. It used to
  // refuse outright whenever some candidate could be measured and none passed, which reads "our run
  // is none of these seasons" off evidence that only ever spoke about some of them. Mushoku Tensei is
  // the worked example, measured live 2026-09-13 on `?store=graph`: unOGS lists Netflix season 2 with
  // 13 real titles and season 3, the right answer, with two ("Rage, Mad Dog", "Howl, Mad Dog"), so
  // season 3 was never even looked at, season 2 failed at 0 matches, and the run was refused a season
  // it had an ordinal and a count for. The same run with NO episode titles answered season 3 by
  // ordinal, which is the tell: more evidence must never establish less.
  //
  // So a measured candidate that fails is REMOVED, never fallen through to, which is strictly safer
  // than the old refusal on the fold it was written for: a 12 of 24 cover no longer merely stops this
  // rule, it takes that season out of every rule below. What is left is the seasons this rule could
  // not speak about, and rule 3 onwards decide among those on their own axes.
  let pool = candidates
  const ours = new Set(realTitles(evidence.episodeTitles).map(stripTitle))
  if (ours.size >= MIN_EPISODE_TITLE_MATCHES) {
    const measurable = candidates
      .map(candidate => ({ candidate, theirs: realTitles(candidate.episodeTitles) }))
      .filter(({ theirs }) => theirs.length >= MIN_EPISODE_TITLE_MATCHES)
    if (measurable.length) {
      const passing = measurable.filter(({ theirs }) => {
        const matched = theirs.filter(title => ours.has(stripTitle(title))).length
        return matched >= MIN_EPISODE_TITLE_MATCHES && matched / theirs.length >= EPISODE_TITLE_COVERAGE
      })
      // more than one season carrying our episode titles is a catalogue listing our run twice, and
      // there is no axis below that could tell the copies apart: that stays a refusal
      if (passing.length > 1) return undefined
      if (passing.length === 1) {
        const pick = passing[0]!.candidate
        if (foldVetoed(evidence, pick) || yearVetoed(evidence, pick)) return undefined
        return { season: pick.season, rule: 'episode-titles' }
      }
      const refuted = new Set(measurable.map(({ candidate }) => candidate))
      pool = candidates.filter(candidate => !refuted.has(candidate))
      // every season could be measured and every one of them disagreed: the run is none of them, and
      // this is the decisive refusal the rule was written for
      if (!pool.length) return undefined
    }
  }

  // Rule 3, ORDINAL WITH COUNT. Disagreeing titles refuse outright. A part marker makes the ordinal
  // unusable here, unless it is the part that opens the named season: "Season 2 Part 3" of 12
  // episodes would otherwise take the provider's season 2 whenever that happens to hold 12 or fewer.
  if (ordinals.size > 1) return undefined
  if (ordinals.size === 1 && !partNamed && evidence.episodeCount != null) {
    const [ordinal] = ordinals
    const matches = pool.filter(candidate => candidate.seasonNumber === ordinal)
    if (matches.length > 1) return undefined
    if (matches.length === 1 && countOf(matches[0]!) != null) {
      const pick = matches[0]!
      if (foldVetoed(evidence, pick) || yearVetoed(evidence, pick)) return undefined
      return { season: pick.season, rule: 'ordinal' }
    }
  }

  // Rules 4 and 5 read a run whose titles name NO season and no part, with a count. A part is a
  // position inside a season, and a title naming season N is never placed on season M by a year or by
  // being first: with a lone first season of 11 in 2021, 'Show', 'Show Part 2' and 'Show 2nd Season'
  // all answered season 1 by year (2026-09-05), three runs on one Netflix season.
  const unnumberedWithCount = ordinals.size === 0 && !partNamed && evidence.episodeCount != null

  // Rule 4, YEAR: the one season dated our year, holding no more episodes than our run. Two cours in
  // one year cannot be told apart by a year, and none in our year leaves the pick to the first-season
  // rule, whose year veto refuses. A season whose length is unknown cannot be shown not to be a fold,
  // so the one season dated our year with no count is a refusal, never a pick (Apple offers no
  // counts, JustWatch lists a season as 0 until it airs).
  if (unnumberedWithCount && evidenceYear != null && candidates.some(candidate => candidateYear(candidate) != null)) {
    const dated = pool.filter(candidate => candidateYear(candidate) === evidenceYear)
    if (dated.length === 1) {
      const pick = dated[0]!
      if (countOf(pick) == null || foldVetoed(evidence, pick)) return undefined
      return { season: pick.season, rule: 'year' }
    }
  }

  // Rule 5, FIRST: only ever the first season, so season 1 (11) against 24, 25, 11 is refused at
  // 24 !== 11 rather than finding the 11 further down. A lone season shorter than our run is a season
  // still listing (most of the homepage); with several seasons a shorter first season may be one half
  // of our run (the Fullmetal Alchemist split), so only exactness counts.
  //
  // `first` is read off the WHOLE list and never off what rule 2 left, because being first is a fact
  // about the source's season list and not about the survivors: taking the lowest-numbered SURVIVOR
  // is the fall-through that put anime season 1 on Netflix season 3 once season 1 was excluded. A
  // first season rule 2 refuted therefore refuses here rather than promoting the season behind it.
  if (unnumberedWithCount) {
    const numbered = candidates.filter(candidate => candidate.seasonNumber != null)
    const first =
      candidates.length === 1 ? candidates[0]
      : numbered.length ? numbered.reduce((lowest, candidate) => candidate.seasonNumber! < lowest.seasonNumber! ? candidate : lowest)
      : undefined
    if (!first || !pool.includes(first)) return undefined
    if (foldVetoed(evidence, first) || yearVetoed(evidence, first)) return undefined
    const theirs = countOf(first)
    const fits =
      candidates.length === 1
        ? theirs != null && theirs <= evidence.episodeCount!
        : theirs === evidence.episodeCount
    return fits ? { season: first.season, rule: 'first' } : undefined
  }

  return undefined
}

/**
 * How many runs of OUR length a season may fold and still be a fold these rules can read.
 *
 * The counting axes both rest on "the candidate is longer than our run", and for a run of one or two
 * episodes that fact is true of every season in every listing, so it carries no information at all
 * and the axis places a promotional short inside whatever season happens to fit its other clause.
 *
 * SWEPT over the recorded unOGS season corpus (`scripts/measure-unogs-season-match.mjs`, 169 runs of
 * 33 Netflix series, 2026-09-13). Seven runs are answered a container; the shares split clean:
 *
 *   0.042  1 of 24  VINLAND SAGA SEASON 2: Drowning in the Shadow (ONA)   held by season 2, which IS
 *   0.042  1 of 24  VINLAND SAGA SEASON 2: Same old story (ONA)           Vinland Saga season 2
 *   0.077  1 of 13  Overlord: Ple Ple Pleiades Tokubetsu-hen (ONA)        held by season 1, which IS Overlord
 *   0.125  3 of 24  Ponkotsuland Saga (ONA)
 *   0.500  13 of 26, 5 of 10, 5 of 10                                     the three that read as folds
 *
 * The top three are the defect named: a season handed to a short run as its CONTAINER while it is
 * another run of the same show's OWN season, which cannot both be true. Every floor from 0.1 to 0.4
 * removes all three; 1/4 sits in the middle of the gap between 0.125 and 0.500 and reads as a
 * sentence. Mushoku Tensei's four contained runs score 0.458, 0.48, 0.5 and 0.52, so the bound is not
 * near them.
 *
 * THE RECALL COST is a fold of more than four cours, 11 of 48 and the like, which nothing in the
 * corpus is and which no catalogue was observed doing.
 */
export const MAX_FOLDED_RUNS = 4

/**
 * Which axis singled a container out: the run's episode titles inside it, the season its own titles
 * name, or the year it is dated.
 */
export type ContainingRule = 'episode-titles' | 'ordinal' | 'year'

/**
 * The one season that HOLDS the run, with the two lengths that say so.
 *
 * `theirs` is the container's episode count and `ours` the run's, carried out of the pick because
 * both are read again downstream and neither is worth asking the source twice for: the claim records
 * them as its evidence (4.4) and a placement needs the container's length to know how many rows it is
 * choosing among.
 */
export type ContainingVerdict<T> = { season: T, rule: ContainingRule, theirs: number, ours: number }

/**
 * The one season of a show that HOLDS the caller's run without being it, or undefined (4.4).
 *
 * This is the other half of the fold, and it exists because `foldVetoed` is right and unhelpful on its
 * own: Netflix's season 1 of Mushoku Tensei is 24 episodes over anime's 11 and 12, so `pickSimilarSeason`
 * refuses the only season either run could match, correctly, and the run is then left with no Netflix
 * anything. A season longer than the run is not the run; it may still be where the run is.
 *
 * IT IS NEVER SAMENESS AND CANNOT BECOME IT. The first thing it does is run `pickSimilarSeason`: a run
 * that HAS a season is never also given a container, so the two answers are mutually exclusive by
 * construction rather than by the caller remembering to ask in the right order. A caller writes a
 * `containing` answer as `PART_OF` and never as `SAME_AS` (`worker/similar-consumer.ts`), which is why
 * a wrong answer here costs a badge and a hidden card where a wrong sameness welds two works.
 *
 * WHAT IT REQUIRES, and each one is a way the count alone lies.
 *
 * - BOTH COUNTS, and a candidate STRICTLY LONGER than the run. A season whose length is unknown (a
 *   truncated listing, an unaired season) could be any length at all, and one no longer than the run
 *   has no room to hold it and something else.
 * - AN ORDINAL CEILING, when the titles agree on a season number and name no part: a fold only ever
 *   compresses, so the container's own ordinal is at or below ours. This is the direction of the
 *   2026-09-05 weld, anime season 1 landing on `nf:80987039-3`, closed here rather than left to a
 *   count. A part-named run is exempt, because a part is a position INSIDE a season and its number is
 *   not a season ordinal at all: "Part 2" of anime season 1 lives in Netflix's season 1.
 * - THEN ONE OF THREE AXES, in order, each of which must single out EXACTLY ONE candidate.
 *
 * AXIS 1, EPISODE TITLES, decisive wherever it can measure: at least `MIN_EPISODE_TITLE_MATCHES` of
 * the candidate's real episode titles are ours, they cover at least `EPISODE_TITLE_COVERAGE` of OUR
 * run, and they cover LESS than `EPISODE_TITLE_COVERAGE` of the candidate. That is rule 2's own
 * measurement read from both sides at once: above the line against our run means it holds the run,
 * below the line against the candidate means it holds more than the run, and a candidate above the
 * line on both is the sameness rule 2 would already have taken. A fold of two equal cours scores
 * 12/24 = 0.50 against the candidate and 12/12 = 1.00 against the run, which is exactly the shape.
 *
 * BOTH SHARES ARE MEASURED AGAINST COUNTS, and neither against a title list, which is where this
 * differs from rule 2 and has to. Against the run, because the caller sends every title of every
 * episode in every language it holds (`runEvidence`) and a set three times the run's length would put
 * every share below any threshold. Against the CANDIDATE, because a listing names only some of a
 * season's episodes: unOGS gives Netflix's season 2 of Mushoku Tensei 14 real names over its 25
 * episodes, so the 13 an anime run matches score 13/14 = 0.93 against the names and 13/25 = 0.52
 * against the season. The first reads as identity and is how a fold gets called a match; only the
 * second is a statement about the season.
 *
 * A measured candidate that fails is REMOVED, as in rule 2: a season listing real episode titles, none
 * of which are ours, is not where our run is. What is left for axis 2 is the seasons nothing could be
 * measured about, which is the common Netflix case: `nf:80987039-1` titles all 23 of its episodes
 * `Episode N` and one `Special Episode`, so it carries ONE real title and is unmeasurable, while
 * `nf:80987039-2` carries 24 and can be both measured and refuted.
 *
 * AXIS 2, ORDINAL: the one candidate NUMBERED the season our own titles name, when it is longer than
 * our run and clears the share clause axis 3 draws. The ordinal is read with
 * `namedSeasonOrdinals`, off the head of each title before any part marker, and that is the whole
 * reason the axis is safe: `seasonOrdinals` reads `Part 2` as 2, so anime season 1's second cour and
 * anime season 2 part 2 answer the same number there and one of them lives in Netflix's season 1.
 * Reading the head gives the cour no ordinal at all, so this axis is silent for it and axis 3 places
 * it exactly as it did before.
 *
 * ONCE THE ORDINAL HAS SPOKEN, NOTHING ELSE MAY ANSWER. A named season the listing has and that
 * cannot hold us is a refusal outright, never a fall through: a run calling itself season 2 handed
 * season 1 by the year below, because season 1 is the only season unOGS dates, is the 2026-09-05 weld
 * pointing the other way.
 *
 * AXIS 3, YEAR: the one candidate dated our year, holding between `MAX_FOLDED_RUNS` runs of our
 * length and `1 / EPISODE_TITLE_COVERAGE` of one. The first half is rule 4 with the fold veto inverted, the very veto that refused the pick:
 * the one season dated our year, turned down only for being longer than the run, is the season the run
 * is in. The second half is the same constant as axis 1 with the containment premise standing in for
 * the matches it cannot make: if the container holds our run then our count IS the matched count, so
 * `ours / theirs` is the coverage against the candidate, and it has to be below the line for the same
 * reason. It is what tells a fold from a season carrying our run plus a bonus block, 12/16 = 0.75,
 * which is the shape rule 2 admits as SAMENESS when it can see the titles; with only counts to go on
 * the two are indistinguishable, so nothing is answered rather than a container that is really the run.
 *
 * AXIS 3 ALSO REQUIRES EVERY SIBLING TO CARRY A COUNT, at or below the ceiling, because "turned down
 * only for being longer" is a statement about the OTHER candidates and a season nobody measured was
 * turned down for something else. The clause and what it was measured against are on the line itself.
 *
 * The year is the weakest thing here and it is only ever offered by a source that knows what it means:
 * unOGS publishes one year for a whole title, which is its FIRST season's, and `netflixCandidates`
 * hands it to season 1 alone for that reason. So "dated our year" reads as "our run started in the
 * year this source's first season did", which is true of every cour a first season folded in.
 */
export const pickContainingSeason = <T>(
  evidence: RunEvidence,
  candidates: readonly SeasonCandidate<T>[]
): ContainingVerdict<T> | undefined => {
  if (pickSimilarSeason(evidence, candidates)) return undefined
  const ours = evidence.episodeCount
  if (ours == null || ours <= 0) return undefined
  const titles = evidence.titles ?? []
  const ordinals = seasonOrdinals(titles)
  // titles that disagree about which season this run is describe no position at all, the same
  // outright refusal rule 3 makes
  if (ordinals.size > 1) return undefined
  const ceiling = ordinals.size === 1 && !titles.some(namesAPart) ? [...ordinals][0] : undefined
  // A season numbered above ours cannot hold our run and cannot BE it either, so it is out of every
  // question below. An unnumbered season is on this side of the line, since nothing places it.
  const belowCeiling = (candidate: SeasonCandidate<T>): boolean =>
    ceiling === undefined || candidate.seasonNumber == null || candidate.seasonNumber <= ceiling
  const longer = candidates.filter(candidate => {
    const theirs = countOf(candidate)
    if (theirs == null || theirs <= ours) return false
    return belowCeiling(candidate)
  })
  if (!longer.length) return undefined

  const held = (candidate: SeasonCandidate<T>, rule: ContainingRule): ContainingVerdict<T> =>
    ({ season: candidate.season, rule, theirs: countOf(candidate)!, ours })

  // THE SHARE CLAUSE BOTH COUNTING AXES DRAW, and the only thing either of them can say about a
  // season it can neither name nor date. Below the ceiling a season barely longer than the run may BE
  // the run plus a bonus block, 12/16 = 0.75, which is the shape rule 2 admits as SAMENESS when it
  // can see the titles. Above the floor it is a fold of runs like ours; below it the candidate is so
  // much longer that "longer than us" is true of every season there is (`MAX_FOLDED_RUNS`).
  const heldShare = (candidate: SeasonCandidate<T>): boolean => {
    const theirs = countOf(candidate)!
    return ours / theirs < EPISODE_TITLE_COVERAGE && ours * MAX_FOLDED_RUNS >= theirs
  }

  let pool = longer
  const ourTitles = new Set(realTitles(evidence.episodeTitles).map(stripTitle))
  if (ourTitles.size >= MIN_EPISODE_TITLE_MATCHES) {
    const measurable = longer
      .map(candidate => ({ candidate, theirs: realTitles(candidate.episodeTitles) }))
      .filter(({ theirs }) => theirs.length >= MIN_EPISODE_TITLE_MATCHES)
    const holding = measurable.filter(({ candidate, theirs }) => {
      const matched = theirs.filter(title => ourTitles.has(stripTitle(title))).length
      return matched >= MIN_EPISODE_TITLE_MATCHES
        && matched / ours >= EPISODE_TITLE_COVERAGE
        && matched / countOf(candidate)! < EPISODE_TITLE_COVERAGE
    })
    // two seasons each holding most of our run is a catalogue listing the run twice, and no axis below
    // can tell the copies apart: the same refusal rule 2 makes
    if (holding.length > 1) return undefined
    if (holding.length === 1) return held(holding[0]!.candidate, 'episode-titles')
    const refuted = new Set(measurable.map(({ candidate }) => candidate))
    pool = longer.filter(candidate => !refuted.has(candidate))
  }

  // AXIS 2, ORDINAL. Our own titles name a season, the listing numbers exactly one season that way,
  // and it is longer than our run: that season is where the run is. Answering it is the whole of
  // what this round fixed, and refusing anything ELSE once the ordinal has spoken is the other half:
  // a run that calls itself season 2 may not be handed season 1 by the year below just because
  // season 1 is the only season the source dated.
  const named = namedSeasonOrdinals(titles)
  if (named.size === 1) {
    const [ordinal] = named
    const numbered = candidates.filter(candidate => candidate.seasonNumber === ordinal)
    // a listing numbering two seasons the same names no position at all
    if (numbered.length > 1) return undefined
    if (numbered.length === 1) {
      const pick = numbered[0]!
      // NOT LONGER THAN US, no count at all, or above the ceiling: the season we named cannot hold
      // us, and no other season may be answered in its place
      if (!longer.includes(pick)) return undefined
      // the same share clause axis 3 draws, and the ordinal cannot substitute for either half of it
      if (!heldShare(pick)) return undefined
      return held(pick, 'ordinal')
    }
  }

  // AXIS 3 NEEDS EVERY SIBLING MEASURED, and this is the clause that says so. Its premise is that the
  // season turned down ONLY for being longer is the season the run is in, and a candidate whose
  // length nobody published was turned down for a different reason: `longer` drops it silently, so it
  // is invisible to the axis while being exactly the thing that could be the run's own season. That
  // is not hypothetical. A season list that is a PREFIX and a season answered in part both publish no
  // count (`SeasonListing.truncated` and `NetflixSeason.truncated` in unogs/extractor.ts), and
  // Netflix's landing query caps the season list at ten.
  //
  // Measured 2026-09-13: a run of 12 dated 2021 against season 1 of 24 dated 2021 plus a truncated
  // season 2 took season 1 as its container, and the same listing with season 2 answered in full
  // gives that run season 2 as its own season and no container at all. Our own episode titles cannot
  // rescue it, because the seasons this axis fires on are the ones that NUMBER their episodes and so
  // can be measured about nothing.
  //
  // The recall cost is the whole containment for a show whose listing has one unmeasurable season
  // anywhere at or below the ceiling, which is the price of never naming a season the run is not in.
  // Axes 1 and 2 above are untouched: a title overlap and an ordinal are positive evidence about the
  // candidate itself, not an inference from what the other candidates were refused for.
  if (candidates.some(candidate => countOf(candidate) == null && belowCeiling(candidate))) return undefined

  const evidenceYear = yearOf(evidence.startDate)
  if (evidenceYear == null) return undefined
  const dated = pool.filter(candidate => candidateYear(candidate) === evidenceYear && heldShare(candidate))
  return dated.length === 1 ? held(dated[0]!, 'year') : undefined
}

/**
 * Whether ANY container could be established from this evidence, so a caller can decline the second
 * question instead of paying a second walk of the same show to be refused.
 *
 * It is the first line of `pickContainingSeason` read from outside: every axis there is a comparison
 * against OUR length (a candidate strictly longer, a share of our run, `ours / theirs` below the
 * line), so a run whose own length nobody published can be inside nothing and the picker refuses it
 * before looking at a single candidate. That is the whole gate; nothing about the CANDIDATES can be
 * known before the walk that fetches them, which is why this cannot be tighter.
 *
 * A source answering `containingMedia` on some other axis would need this loosened, and there is none
 * today: this module is the one place a containment is decided (`worker/extractor.ts` is the caller).
 */
export const canBeContained = (evidence: RunEvidence): boolean => (evidence.episodeCount ?? 0) > 0

const compareNumbers = (a: number, b: number) => a - b

/** The UTC day a start date names, `-` for none: the only precision the rules read a date at. */
const dayOf = (startDate: string | number | null | undefined): string => {
  const time = parseTime(startDate)
  return time === undefined ? '-' : new Date(time).toISOString().slice(0, 10)
}

/**
 * `{day:2026-07-04, count:14, ordinals:3, parts:no, titles:5, episodeTitles:12}`: the evidence as the
 * rules read it, for a log line. The day is the one `similarAskKey` reads, `-` when there is none; the
 * two lengths are of the raw lists, so the reader sees what was sent.
 */
export const describeEvidence = (evidence: RunEvidence): string => {
  const titles = evidence.titles ?? []
  const ordinals = [...seasonOrdinals(titles)].sort(compareNumbers)
  return `{day:${dayOf(evidence.startDate)}, count:${evidence.episodeCount ?? '-'}, ordinals:${ordinals.length ? ordinals.join(',') : '-'}, parts:${titles.some(namesAPart) ? 'yes' : 'no'}, titles:${titles.length}, episodeTitles:${(evidence.episodeTitles ?? []).length}}`
}

/**
 * A caller-supplied string as ONE log token: anything outside printable ASCII becomes `_`, capped at
 * 128 characters, `-` for nothing. A valid show id (`SAFE_SHOW_ID` in worker/extractor.ts) prints
 * unchanged; the two funnel lines printed BEFORE that check read a plugin's string, and a newline in
 * it would break the one-line shape scripts/check-similar-media.mjs parses.
 */
export const printableToken = (value: string | null | undefined): string =>
  (value ?? '').replace(/[^\x21-\x7e]/g, '_').slice(0, 128) || '-'

/**
 * The score at which an answer's title names OUR show. The value crunchyroll's search gate measured
 * (title-gate.test.ts): correct pairs 1.000, the nearest wrong pair 0.8135, a spin-off.
 */
export const SHOW_TITLE_THRESHOLD = 0.9

/**
 * Whether an answer is a run of the show the caller asked about, read off titles alone: the best pair
 * over our titles and theirs with season markers stripped. Decides WHICH SHOW, never which season.
 * Either side empty is a refusal, not a pass: an answer that cannot be checked is not verified.
 */
export const answerNamesOurShow = async (
  runTitles: readonly string[],
  answerTitles: readonly string[]
): Promise<{ ok: boolean, score: number }> => {
  const ours = runTitles.filter(title => title.trim())
  const theirs = answerTitles.filter(title => title.trim())
  if (!ours.length || !theirs.length) return { ok: false, score: 0 }
  const scores = await Promise.all(theirs.map(title => bestTitleScore(ours, title)))
  const score = Math.max(...scores)
  return { ok: score >= SHOW_TITLE_THRESHOLD, score }
}

/**
 * The question an ask puts, normalised, so two asks share one in-flight answer exactly when the rules
 * above would read them alike: the show, the day (kitsu's `YYYY-MM-DD`, anilist's `toUTCString` and a
 * templated `YYYY-01-01` of one day are one day), the count, the ordinals the titles agree on and
 * whether any names a part, and the real episode titles. The episode titles are IN the key because
 * Rule 2 is the only rule that tells apart two runs agreeing on all the rest (two same-year cours of
 * 12 with no ordinal): a second run joining the first's in-flight ask would take the first's season
 * with the right evidence in hand.
 */
export const similarAskKey = (origin: string, showId: string, evidence: RunEvidence): string => {
  const day = dayOf(evidence.startDate)
  const titles = evidence.titles ?? []
  const ordinals = [...seasonOrdinals(titles)].sort(compareNumbers).join(',')
  const parts = titles.some(namesAPart) ? 'p' : ''
  const episodes = [...new Set(realTitles(evidence.episodeTitles).map(stripTitle))].sort().join('\u0001')
  return [origin, showId, day, evidence.episodeCount ?? '-', ordinals, parts, episodes].join('\u0000')
}
