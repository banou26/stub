import type { ExtractorServerContext } from '../worker/extractor'
import type { Media as GQLMedia, Episode as GQLEpisode, MediaHandle as GQLMediaHandle, EpisodeHandle as GQLEpisodeHandle } from '../generated/schema/types.generated'

import initFrizbee, { Matcher } from 'frizbee'
import initSacha, { parse as parseMediaName } from 'sacha'
import { fromAggregatedUri, toUri } from '../utils/uri'
import { extendsId } from './offline/seed-gate'
import { SEASON_MARKER } from './season'

/**
 * A handle, or the media to make a SAME_AS handle out of.
 *
 * `makeMedia({ handles: [media] })` still means what it always meant, because SAME_AS is what all 49
 * producer sites were already asserting. Only a producer that means something else has to say so, with
 * `partOf(...)`. The BREAKING half of this refactor is deliberately on the reading side, where a
 * missed site shows nothing rather than throwing.
 */
export type MediaHandleInput = GQLMedia | GQLMediaHandle
export type EpisodeHandleInput = GQLEpisode | GQLEpisodeHandle

const isMediaHandle = (handle: MediaHandleInput): handle is GQLMediaHandle => 'node' in handle
const isEpisodeHandle = (handle: EpisodeHandleInput): handle is GQLEpisodeHandle => 'node' in handle

/**
 * This handle names THIS run. Unions the cluster, permanently, with no inverse. The default, and the
 * only relation any producer asserted before 2026-09-04.
 */
export const sameAs = (node: GQLMedia): GQLMediaHandle => ({ node, relation: 'SAME_AS' })

/**
 * This media is one PART of what the handle names: a run of that show, a film published under that
 * series. Carries the url without claiming to be it, and never unions.
 *
 * Use it wherever the honest answer used to be to drop the link: a show-level id from a source with no
 * season concept, an IMDb id, a Crunchyroll /series/ url on a film.
 *
 * THIS IS THE SCOPE STAMP. A PART_OF target is by definition a container of this run, so the node goes
 * out as a copy scoped CONTAINER whatever it said, and the store then keeps it out of every run's
 * identity space for good (scope is sticky toward CONTAINER there). The input is left untouched.
 */
export const partOf = (node: GQLMedia): GQLMediaHandle => ({ node: { ...node, scope: 'CONTAINER' }, relation: 'PART_OF' })

/** The episode forms of the above. Episodes share `MediaHandleRelation`; see the schema for why. */
export const episodeSameAs = (node: GQLEpisode): GQLEpisodeHandle => ({ node, relation: 'SAME_AS' })
export const episodePartOf = (node: GQLEpisode): GQLEpisodeHandle => ({ node, relation: 'PART_OF' })

/** Every node a handle list points at, whatever each one claims. For storage, never for merging. */
export const handleNodes = (handles: GQLMediaHandle[]): GQLMedia[] => handles.map(handle => handle.node)

/**
 * Only the nodes this media claims to BE.
 *
 * The filter that has to be applied anywhere sameness is assumed: episode lists, title and cover
 * merging, cluster membership. Reading a PART_OF node as though it were this media is the original bug
 * in a new hiding place, and its episode list is every run's at once.
 */
export const sameAsNodes = (handles: GQLMediaHandle[]): GQLMedia[] =>
  handles.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node)

export const makeMedia = ({ origin, id, handles, ...fields }: { origin: string, id: string, handles?: MediaHandleInput[] } & Omit<Partial<GQLMedia>, 'handles'>): GQLMedia => ({
  _id: crypto.randomUUID(),
  uri: toUri({ origin, id }),
  origin,
  id,
  url: undefined,
  scope: 'RUN',
  handles: (handles ?? []).map(handle => isMediaHandle(handle) ? handle : sameAs(handle)),
  // Narrative edges, and empty unless a source names some. Separate from `handles` on purpose: see
  // `MediaRelation` in worker/resolvers/media/schema.gql for why the two axes never mix.
  relations: [],
  categories: [],
  genres: [],
  tags: [],
  titles: [],
  descriptions: [],
  shortDescriptions: [],
  covers: [],
  banners: [],
  episodes: [],
  trailers: [],
  ...fields
})

export const makeEpisode = ({ origin, id, mediaUri, handles, ...fields }: { origin: string, id: string, mediaUri: string, handles?: EpisodeHandleInput[] } & Omit<Partial<GQLEpisode>, 'handles'>): GQLEpisode => ({
  _id: crypto.randomUUID(),
  uri: toUri({ origin, id }),
  origin,
  id,
  url: undefined,
  mediaUri,
  handles: (handles ?? []).map(handle => isEpisodeHandle(handle) ? handle : episodeSameAs(handle)),
  titles: [],
  descriptions: [],
  shortDescriptions: [],
  thumbnails: [],
  ...fields
})

// the episode id suffixes the media id to match the toUriEpisodeId convention in utils/uri, and episodeNumber must stay 1: the media episodes resolver drops every episode with a null episodeNumber
/**
 * A movie is modelled as a one episode series so it can reuse the episode keyed
 * playback path, which is the only path the watch route and the source selector
 * understand. The episode id suffixes the media id, so the uri comes out as
 * `${media.uri}-1`, matching the toUriEpisodeId convention in utils/uri.
 *
 * episodeNumber must stay 1 rather than null: the media episodes resolver drops
 * every episode with a null episodeNumber, and groups the rest by that number,
 * which is what merges one movie's per-source episodes into a single row.
 */
export const makeMovieEpisode = (
  media: GQLMedia,
  overrides: Partial<GQLEpisode> = {}
): GQLEpisode =>
  makeEpisode({
    origin: media.origin,
    id: `${media.id}-1`,
    mediaUri: media.uri,
    url: media.url,
    score: media.score ?? undefined,
    titles: (media.titles ?? []).map(({ language, title, score }) => ({ language, title, score })),
    descriptions: (media.descriptions ?? []).map(({ language, description, score }) => ({ language, description, score })),
    shortDescriptions: (media.shortDescriptions ?? []).map(({ language, shortDescription, score }) => ({ language, shortDescription, score })),
    thumbnails: (media.covers ?? []).map(({ url, score }) => ({ url, score })),
    episodeNumber: 1,
    ...overrides
  })

export const isMovie = (media: { categories?: readonly string[] | null }) =>
  Boolean(media.categories?.includes('MOVIE'))

/**
 * Normalize a page of upstream records, dropping only the ones that fail.
 *
 * A page resolver is all-or-nothing by default: a plain `.map` throws and a `Promise.all` rejects
 * as soon as one record is malformed, so the source yields nothing and one bad entry costs the
 * whole page. That is what turns a single odd upstream record into an empty feed, and it defeats
 * the point of having several sources, since the surviving source goes dark too.
 */
export const normalizePage = async <T, R>(
  items: readonly T[],
  normalize: (item: T) => R | Promise<R>,
  label: string
): Promise<R[]> => {
  const settled = await Promise.allSettled(items.map(async item => normalize(item)))
  const kept: R[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') kept.push(result.value)
    else console.error(`${label}: dropped a record that failed to normalize`, result.reason)
  }
  return kept
}

export const desc = (description?: string | null, score?: number) =>
  description
    ? {
      descriptions: [{
        language: 'en',
        description: description,
        score
      }],
      shortDescriptions: [{
        language: 'en',
        shortDescription: description,
        score
      }]
    }
    : {}

export const img = (url?: string | null, score?: number) =>
  url
    ? [{ url, score }]
    : []

export const getFirstTitle = (media: { titles?: { title: string }[] } | undefined) =>
  media?.titles?.[0]?.title

/**
 * The episode count an aggregated media DECLARES, and undefined when it declares none.
 *
 * The count a run's sources agree on, never a list length: `aggregateMedia` emits `episodes: []` on
 * every cluster (the episodes are a separate resolver's), so `media.episodes.length` read as a count
 * is 0 for every cluster, and 0 is a count rather than an absence. `foldVetoed` then reads a run of
 * zero episodes and refuses every candidate season longer than it, which is all of them.
 */
export const declaredEpisodeCount = (media: { episodeCount?: number | null } | null | undefined): number | undefined =>
  media?.episodeCount ?? undefined

// keeps letters of every script. Stripping to [a-z0-9] erased a japanese title down to its ascii digits, so
// ani.zip's "転生したらスライムだった件 (2026)" was the literal string "2026" and was equal to every other 2026 show.
export const stripTitle = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * Both wasm modules initialise once, lazily, because only the matching paths need them and the
 * settings page deliberately stays clear of this module for that reason (see built-in.ts).
 */
let frizbeeReady: Promise<unknown> | undefined
const readyFrizbee = () => (frizbeeReady ??= initFrizbee())
/**
 * sacha ships no node entry the way frizbee does, so its default init builds a `file:` URL and
 * fetches it, which node cannot do. That belongs in the test setup, NOT here: naming `node:fs` in
 * this module, even inside a branch the browser never takes, makes vite fail to resolve it and serve
 * `src/sources/utils.ts` as a 500, which takes the whole extractor worker down with it.
 *
 * `vitest.setup.ts` calls sacha's `initSync` with the bytes, and both of sacha's entry points return
 * early once the module is live, so this stays a no-op there.
 */
let sachaReady: Promise<unknown> | undefined
const readySacha = () => (sachaReady ??= initSacha())

/**
 * `maxTypos: Infinity` is what turns frizbee from a FILTER into a SCORER.
 *
 * At its default of 0 it answers "does the needle appear in this haystack, in order", so
 * ("grand blue dreaming", "grand blue") scores a flat 0 rather than "mostly". Every non-containment
 * pair collapses to zero and no threshold can be placed. With typos unlimited it scores every pair,
 * which is what a similarity needs.
 */
const MATCH_CONFIG = { maxTypos: Infinity, casing: 'ignore', unicode: 'always' } as const

// one matcher for the module's lifetime: setPattern keeps the config and skips identical patterns, so
// the O(n^2) cluster comparison in fuzzy-merge does not allocate a wasm object per pair
let matcher: Matcher | undefined
const alignScore = (needle: string, haystack: string): number => {
  if (!matcher) matcher = new Matcher(needle, MATCH_CONFIG)
  else matcher.setPattern(needle)
  return matcher.matchOne(haystack, 0)?.score ?? 0
}

// separate matcher because the mode is part of the config, and switching it per call would thrash the
// one above; substring requires the needle as a contiguous run, which is exactly "does this contain it"
let substringMatcher: Matcher | undefined
const containsNeedle = (needle: string, haystack: string): boolean => {
  const config = { ...MATCH_CONFIG, maxTypos: 0, matching: 'substring' } as const
  if (!substringMatcher) substringMatcher = new Matcher(needle, config)
  else substringMatcher.setPattern(needle)
  return (substringMatcher.matchOne(haystack, 0)?.score ?? 0) > 0
}

// a string's score against itself is its ceiling, and it is asked for repeatedly across a merge pass
const selfScores = new Map<string, number>()
const selfScore = (text: string): number => {
  const cached = selfScores.get(text)
  if (cached !== undefined) return cached
  const score = alignScore(text, text)
  selfScores.set(text, score)
  return score
}

/**
 * Symmetric 0..1 similarity: how much of each string the other accounts for, taking the WEAKER
 * direction.
 *
 * frizbee scores a needle against a haystack, which is directional and unbounded, so a short title
 * fully contained in a longer one scores near its own ceiling one way round and much lower the other.
 * Taking the minimum is what stops containment reading as identity: "Attack on Titan" is entirely
 * inside "Attack on Titan: Junior High" and still only reaches 0.513 here, which is the whole point.
 */
export const titleSimilarity = async (a: string, b: string): Promise<number> => {
  const normalA = stripTitle(a)
  const normalB = stripTitle(b)
  if (!normalA || !normalB) return 0
  await readyFrizbee()
  const ceilingA = selfScore(normalA)
  const ceilingB = selfScore(normalB)
  if (!ceilingA || !ceilingB) return 0
  return Math.min(alignScore(normalA, normalB) / ceilingA, alignScore(normalB, normalA) / ceilingB)
}

// Normalized by the QUERY length, unlike titleSimilarity which normalizes by the longer string, so this
// measures containment and saturates: every title holding the query scores 1 and popularity breaks the tie.
// It shares titleSimilarity's strip because the ascii-only one left "Aランクパーティを離脱した俺は..." as the single
// letter "a", which then scored 1.0 against 841 of 903 shows, while 587 of them could not be found by their
// own native title at all.
export const searchScore = async (query: string, title: string): Promise<number> => {
  const q = stripTitle(query)
  const t = stripTitle(title)
  if (!q || !t) return 0
  await readyFrizbee()
  // Containment saturates, which is the property the ranking is built on: every title holding the
  // query scores 1 so popularity breaks the tie rather than title length. It needs asserting
  // separately here because frizbee pays a positional bonus the query only collects at position 0,
  // so "frieren" inside "sousou no frieren" reaches 116 of its own 132 rather than all of it.
  if (containsNeedle(q, t)) return 1
  const ceiling = selfScore(q)
  if (!ceiling) return 0
  return Math.min(1, alignScore(q, t) / ceiling)
}

export const searchRelevance = async (query: string, titles: string[]): Promise<number> =>
  titles.length ? Math.max(...await Promise.all(titles.map(title => searchScore(query, title)))) : 0

// A catalogue search ranks a free-text query over the WHOLE catalogue, so results[0] is whatever came
// back, and linking it asserts identity permanently: graph.link has no inverse. Measured against 62 live
// unOGS queries, taking results[0] unchecked welded the wrong title 14 times, among them "Demon Slayer"
// onto "Woochi - The Demon Slayer", a 2009 korean movie.
//
// Netflix lists a show under the concatenation of the two names our sources carry separately, so a
// CORRECT hit covers only about half the query, which pins the threshold from ABOVE. Re-measured on
// frizbee, which scores these containment-shaped pairs lower than seal-wasm did:
//
//   0.552  "Kimetsu no Yaiba"  vs  "Demon Slayer: Kimetsu no Yaiba"   (was 0.552)
//   0.505  "Cowboy Bebop"      vs  "Cowboy Bebop: The Movie"          (was 0.545)
//   0.447  "One Piece"         vs  "One Piece Film: Red"              (was 0.500)
//
// The last is the binding one and it is a correct match, so the bound is inclusive and 0.44 is where
// 0.5 used to sit. The ordering is unchanged; only the scale moved.
//
// Re-measured 2026-08-29 against the whole manami database rather than the 62 live unOGS queries the
// original 0.5 came from: 243194 synonym pairs as correct matches, 139507 relatedAnime pairs as the
// sequels and spin-offs that must be refused, run through this exact function. `npm run calibrate`.
//
// KEEP 0.44. Every 0.01 step upward from it refuses fewer wrong links than the correct matches it
// loses, ratio 0.76 to 0.97 the whole way to 0.50, so there is nothing above it to move to. Below it
// the wrong-link arm climbs without the correct arm following.
//
// Two things that reading the table would otherwise get wrong, both cost a full sweep to learn:
//
//   - The anchor this number is pinned on is NOT reachable. simplifyTitle('One Piece Film: Red') is
//     ['One Piece Film'], never 'One Piece', so the 0.447 pair below can only arise in the orientation
//     that would be a WRONG link. The lowest anchor that is genuinely a correct match here is Cowboy
//     Bebop at 0.505, which 0.44 and the old 0.5 both admit. The number survives its own justification
//     failing, but do not defend it with that line again.
//   - Sampling the two arms to equal COUNTS inverts the answer. The populations differ (243194 against
//     139507), so equal counts make the wrong-link arm 1.743x denser and the ratio above reads 1.19 to
//     1.93, which argues for 0.50. Same code, same line, opposite conclusion. The harness now runs full
//     populations by default and says so in its header when an env var caps it.
//
// What this threshold does NOT do, measured, so nobody credits it: it does not refuse
// "Demon Slayer" against "Woochi - The Demon Slayer", the wrong weld named below. That scores 0.5200
// and passes at 0.44 and at 0.5 alike. The category veto in pickTitleMatch is what refuses it.
export const TITLE_MATCH_THRESHOLD = 0.44

/**
 * How well a candidate names the same FRANCHISE as any title a media already carries.
 *
 * Every known title is tried and the best wins, because catalogues disagree about which name is the
 * canonical one and a correct hit often matches exactly one of them. AniList carries "Kimetsu no Yaiba"
 * as romaji and "Demon Slayer: Kimetsu no Yaiba" as english; a catalogue listing the latter scores 0.41
 * against the former and 1.0 against the latter, and taking the max is the difference between finding
 * the show and refusing it.
 */
export const bestTitleScore = async (
  knownTitles: readonly string[],
  candidateTitle: string
): Promise<number> => {
  const candidate = await franchiseTitle(candidateTitle)
  const scores = await Promise.all(
    knownTitles
      .filter(title => Boolean(title?.trim()))
      .map(async title => titleSimilarity(await franchiseTitle(title), candidate))
  )
  return scores.length ? Math.max(...scores) : 0
}

export type TitleCandidate = { title: string, categories?: readonly string[] | null }

/** The catalogue hit that actually names this media, or nothing. */
export const pickTitleMatch = async <T extends TitleCandidate>(
  query: string,
  candidates: readonly T[],
  categories?: readonly string[] | null
): Promise<T | undefined> => {
  let best: { candidate: T, score: number } | undefined
  for (const candidate of candidates) {
    // Only a DISAGREEMENT blocks, the same rule the fuzzy merge uses for format: an absent category is
    // unknown, not a veto. This is what separates "One Piece Film: Red" from a series cluster at 0.500,
    // the one score the title alone cannot judge.
    if (
      categories?.length && candidate.categories?.length &&
      !categories.some(category => candidate.categories!.includes(category))
    ) continue
    const score = await titleSimilarity(query, candidate.title)
    if (score < TITLE_MATCH_THRESHOLD) continue
    if (!best || score > best.score) best = { candidate, score }
  }
  return best?.candidate
}

// `-Arise from the Shadow-`, `~Stairway to Adulthood~`: the decoration a japanese title hangs a
// subtitle in, which upstream catalogues generally drop. Both delimiters must be the same character,
// and the inner text may not contain one, so a hyphen inside a word cannot open a match. The dashes
// are written as escapes because the wider ones are not allowed to appear literally in this repo.
const DASHES = '\\u002d\\u2013\\u2014\\u007e\\uff5e\\u301c'
const DECORATED_SUFFIX = new RegExp(`(?:^|\\s)([${DASHES}])\\s*[^${DASHES}]{2,}\\s*\\1\\s*$`)

const ARTICLES = /\b(?:the|a|an)\b/gi

const squash = (title: string) => title.replace(/\s+/g, ' ').trim()

const withoutDecoratedSuffix = (title: string) => {
  const match = DECORATED_SUFFIX.exec(title)
  return match ? squash(title.slice(0, match.index)) : title
}
const withoutSeason = (title: string) =>
  squash(SEASON_MARKER.reduce((text, marker) => text.replace(marker, ' '), title))

/**
 * The franchise a title names, with the season it names dropped.
 *
 * sacha parses a media name the way anitomy does, so it separates "Mushoku Tensei: Jobless
 * Reincarnation" from "Season 3", and it does the same for `2nd Season` and for `第2期`, which the
 * regex here handles less well and only because each form was added to it by hand.
 *
 * A catalogue that models a show as one series with several seasons names it once, without the
 * season, while our sources name the individual season. Comparing those directly charges a correct
 * match for the difference, and the season is not what a title identifies well anyway: a date is.
 */
export const franchiseTitle = async (title: string): Promise<string> => {
  if (!title.trim()) return title
  await readySacha()
  try {
    return parseMediaName(title).titles?.[0] ?? title
  } catch {
    // the parser throws rather than declining on input it cannot read, and a title it chokes on must
    // cost that one comparison its season stripping, never the whole match
    return title
  }
}
const withoutArticles = (title: string) => squash(title.replace(ARTICLES, ' '))
const beforeColon = (title: string) => {
  const idx = title.indexOf(':')
  return idx > 2 ? title.slice(0, idx).trim() : title
}

/**
 * Shorter queries to try when the full title finds nothing, most specific first.
 *
 * The steps are CUMULATIVE, so each rung is strictly shorter than the one above it and the first hit
 * is the most specific one a catalogue actually carries. The season used to be stripped only at the
 * very end of the string, which a trailing decorated subtitle put out of reach: `Solo Leveling Season 2
 * -Arise from the Shadow-` never got to ask Netflix for `Solo Leveling`, and neither did
 * `Ace of the Diamond act II -Second Season-`, which needs the articles gone as well to clear the
 * match gate against Netflix's `Ace of Diamond`. Those are the two links this recovers, measured over
 * 68 live unOGS queries with no other result changing.
 *
 * Cost is only paid on a miss, since the caller returns on the first query that produces a gated match.
 */
export const simplifyTitle = (title: string): string[] => {
  const seen = new Set([title])
  const queries: string[] = []
  let current = title
  for (const step of [withoutDecoratedSuffix, withoutSeason, withoutArticles, beforeColon]) {
    current = step(current)
    if (current.length < 3 || seen.has(current)) continue
    seen.add(current)
    queries.push(current)
  }
  return queries
}

/**
 * Every handle an aggregated uri names, as SAME_AS, minus the caller's own origin, each stamped
 * `provenance: 'address'`.
 *
 * THE STAMP IS THE WHOLE POINT, and it is what a relation used to be asked to carry. The address
 * names WHICH sources to ask and asserts nothing about how their rows relate (the owner's decision,
 * 2026-09-12). So a handle from here is a POINTER: it routes a re-ask, the row it names still renders
 * as a badge carrying that row's own url, and it enters no cluster, whatever the claimer. Every
 * relation between the rows an address names is re-derived from what those sources answer.
 *
 * SAME_AS therefore stays, and is now honest rather than tolerated. It used to be the only relation
 * that contributed anything at all: `makeMedia` defaults `url: undefined`, so a handle rebuilt here
 * carries NO url, and demoting it to PART_OF would have left it contributing nothing. The stamp is
 * the third option that reading said did not exist, and it is the one the store reads.
 *
 * WHAT IT COSTS WITHOUT THE STAMP, measured on the recorded season corpus (2026-09-12): of the `media`
 * answers carrying handles, 89 of Netflix's 156 and 31 of Crunchyroll's 52 were pure echoes of the
 * asked address, and 184 of 454 corpus lines were a run welded with or attached to such a row.
 *
 * A rebuilt sibling is a BARE node, and carries no scope of the caller's. The caller has read nothing
 * about those ids, so a stamp here was a claim about rows it never saw, written onto them: a CONTAINER
 * caller flipped every run sibling to CONTAINER for good (scope is sticky that way in the store) and
 * welded them in the container space, and a RUN caller minted a RUN row for a show whose own row was
 * still in flight and unioned with it. The store holds a claim naming a bare node until the node's
 * own source describes it, so the uri contributes the claim and nothing else, in every direction.
 *
 * It REFUSES an origin the uri names twice, minting neither id, unless the two are the same id at
 * different precision.
 */
export const buildHandlesFromUri = (aggregatedUri: string, excludeOrigin: string): GQLMediaHandle[] => {
  const parsed = fromAggregatedUri(aggregatedUri as Parameters<typeof fromAggregatedUri>[0])
  if (!parsed) return []

  const byOrigin = new Map<string, string[]>()
  for (const { origin, id } of parsed.handleUrisValues) {
    if (origin === excludeOrigin) continue
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), id])
  }

  const handles: GQLMediaHandle[] = []
  for (const [origin, ids] of byOrigin) {
    // `disagreeingIds`' rule, one-way as it reads it: only the ids nothing else extends survive, so
    // `A` beside `A-1` keeps the season and two unrelated ids both survive and are refused. An address
    // names sources; which of two ids of ONE source is the run is a question it has not settled, and
    // minting both makes this source assert it. The JustWatch season jw:531130-580247 stamped SAME_AS
    // to mal:64683 and mal:63225 at once that way on the recorded season corpus, one of the three
    // manifest addresses carrying two mal ids (2026-09-12).
    const [id, ...rest] = [...new Set(ids)].filter(id => !ids.some(other => extendsId(other, id) && other.startsWith(`${id}-`)))
    if (!id || rest.length) continue
    handles.push({ ...sameAs(makeMedia({ origin, id })), provenance: 'address' })
  }
  return handles
}

/**
 * Add the handles an aggregated uri names to a media, for origins it does not already carry.
 *
 * Dedupes by ORIGIN and by RELATION together. Origin alone was enough while every handle meant the
 * same thing; it is not now. A media already carrying `partOf(imdb:tt123)` would otherwise block the
 * uri from contributing a SAME_AS for imdb, or the reverse, depending only on which arrived first.
 *
 * Every handle it adds carries `provenance: 'address'` from `buildHandlesFromUri`, unchanged: what it
 * appends is a pointer at a source to ask, never a claim that the caller's row and that row are the
 * same. The source's OWN handles are left exactly as the source built them, stamp-free, so this is
 * the merge that keeps the two kinds apart rather than the one that flattens them.
 */
export const mergeHandles = (media: GQLMedia, aggregatedUri: string) => {
  const extra = buildHandlesFromUri(aggregatedUri, media.origin)
  const existing = new Set(media.handles.map(handle => `${handle.node.origin}\0${handle.relation}`))
  media.handles = [
    ...media.handles,
    ...extra.filter(handle => !existing.has(`${handle.node.origin}\0${handle.relation}`))
  ]
}

export const waitForMedia = async <T>(
  uri: string,
  ctx: ExtractorServerContext,
  extract: (media: any) => T | undefined,
  timeoutMs = 15_000
): Promise<T | undefined> => {
  const result = extract(await ctx.findAggregatedMedia(uri))
  if (result) return result
  const ac = new AbortController()
  const timeout = setTimeout(() => ac.abort(), timeoutMs)
  try {
    for await (const _ of ctx.listenForMediaChanges({ uri }, { abortSignal: ac.signal })) {
      const r = extract(await ctx.findAggregatedMedia(uri))
      if (r) return r
    }
  } finally {
    clearTimeout(timeout)
    ac.abort()
  }
  return undefined
}
