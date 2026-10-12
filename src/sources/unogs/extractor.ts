import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, SimilarMediaInput } from '../../generated/schema/types.generated'
import { extractAggregatedUriOrigin, isAggregatedUri, isUri, toUri } from '../../utils/uri'
import { makeMedia, makeEpisode, makeMovieEpisode, isMovie, desc, img, getFirstTitle, simplifyTitle, buildHandlesFromUri, waitForMedia, pickTitleMatch, declaredEpisodeCount } from '../utils'
import { pickContainingSeason, pickSimilarSeason, type SeasonCandidate } from '../similar'
import { yearAppearsInShow } from '../catalogue-gate'
import { percentScore } from '../average-score'
import { fetchNetflixSeasonEpisodes, fetchNetflixTitle, NETFLIX_EMPTY_FACT, NETFLIX_FAILURE_FACT, type NetflixEpisode, type NetflixTitle } from './netflix'

const SCORE = 0.2

export const icon = 'https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2023.ico'
export const originUrl = 'https://www.netflix.com'
export const categories = ['SERIES', 'MOVIE'] as const
export const name = 'Netflix'
export const origin = 'nf'
export const official = false
export const metadataOnly = true
export const isApiOnly = false
export const supportedUris = ['nf']

let _token: string | undefined
let _tokenExpiry: number = 0
let _tokenPromise: Promise<string> | undefined

/**
 * Whose failure a rejected unOGS call is evidence of, which decides whether it may stop EVERY title.
 *
 * - `upstream`: the token call failed, or the request never arrived. That is about unOGS itself and
 *   says nothing about the id, so it is the only thing that arms the module-global cooldown.
 * - `title`: unOGS answered and the answer is about this one id (a non-success status, a body this
 *   source cannot read). unOGS answers HTTP 200 with `{}` for any id it cannot parse, including the
 *   season-suffixed ids this app mints itself (measured 2026-09-12), so one such id arming a global
 *   gate would send every Netflix row to the truncated fallback for a minute for no reason at all.
 */
type UnogsFailureScope = 'upstream' | 'title'

/** A failed unOGS call, carrying whose failure it is. Thrown by `api` and read by `unogsSeasons`. */
class UnogsCallError extends Error {
  scope: UnogsFailureScope
  constructor(message: string, scope: UnogsFailureScope) {
    super(message)
    this.name = 'UnogsCallError'
    this.scope = scope
  }
}

// An error nobody classified is NOT read as an outage: the cooldown stops every title, so arming it
// takes positive evidence about the upstream rather than the absence of evidence about the title.
const failureScope = (error: unknown): UnogsFailureScope =>
  error instanceof UnogsCallError ? error.scope : 'title'

const upstreamFailure = (error: unknown): never => {
  throw error instanceof UnogsCallError ? error : new UnogsCallError(String(error), 'upstream')
}

const getToken = async (ctx: ExtractorServerContext): Promise<string> => {
  if (_token && Date.now() < _tokenExpiry) return _token
  if (_tokenPromise) return _tokenPromise
  _tokenPromise = (async () => {
    const res = await ctx.fetch('https://unogs.com/api/user', {
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: 'user_name=anonymous',
      method: 'POST',
      mode: 'cors',
      credentials: 'include'
    }).then(r => r.json())
    if (!res.token?.access_token) throw new UnogsCallError(`uNoGS token fetch failed: ${JSON.stringify(res)}`, 'upstream')
    _tokenExpiry = Date.now() + 12 * 60 * 60 * 1000
    return (_token = res.token.access_token)
  })().finally(() => { _tokenPromise = undefined })
  return _tokenPromise
}

/**
 * Forget the cached token, so the next call mints a fresh one.
 *
 * The cache is 12 h against a token whose measured lifetime is 24 h, so it is not expiry that this
 * guards: a REVOKED token is answered HTTP 500 (`{"message": "Internal Server Error"}`, measured
 * 2026-09-12), and a cache that kept serving it would hold the whole source on the truncated fallback
 * for half a day while nothing ever looked stale.
 */
const forgetToken = () => {
  _token = undefined
  _tokenExpiry = 0
}

const _inflight = new Map<string, Promise<unknown>>()

/**
 * One in-flight call per key, so several rows asking about ONE title cost one request.
 *
 * The entry is dropped the moment the call settles, so this collapses a burst and never caches an
 * answer. Keyed by url for the unOGS endpoints and by `netflix:<id>` for the fallback, which was
 * outside it: measured 2026-09-12, five concurrent asks for one title made ONE unOGS episodes call
 * and FIVE Netflix POSTs. A page showing several seasons of one Netflix title is exactly that shape,
 * since every one of those `Media.episodes` asks resolves to the same show id.
 *
 * Callers SHARE the resolved value, so nothing downstream may mutate what it is handed. Nothing does:
 * `netflixSeasons`, `parseUnogsSeasons` and `normalizeEpisode` all build fresh objects, and
 * `netflixCandidates` sorts a copy.
 */
const dedupe = <T>(key: string, call: () => Promise<T>): Promise<T> => {
  const existing = _inflight.get(key)
  if (existing) return existing as Promise<T>
  const promise = call()
  _inflight.set(key, promise)
  // the `.finally` chain is a SECOND promise, and a rejected one nobody reads is an unhandled
  // rejection that fails a whole vitest run. It only became reachable when a failure here became
  // something a caller handles rather than something that took the resolver down with it.
  promise.finally(() => _inflight.delete(key)).catch(() => {})
  return promise
}

/**
 * `requireOk` turns a non-success status into a throw, and ONLY the episodes path asks for it, because
 * only it has somewhere to fall back to. Applied to every endpoint it would change the meaning of a
 * 404 for an unknown title from "no such title" (an empty detail array, which `getMedia` already reads
 * as undefined) into a rejected resolver.
 */
const api = <T>(url: string, ctx: ExtractorServerContext, { requireOk = false } = {}): Promise<T> =>
  dedupe(url, () => getToken(ctx).catch(upstreamFailure).then(token =>
    ctx.fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        REFERRER: 'http://unogs.com',
        referer: 'http://unogs.com'
      },
      mode: 'cors',
      credentials: 'include'
    }).catch(upstreamFailure).then(r => {
      // a stubbed Response may omit `ok`, and an absent field is not a claim that the call failed
      if (requireOk && r.ok === false) {
        // a revoked token is answered 500, and the 12 h cache would otherwise keep serving it
        forgetToken()
        throw new UnogsCallError(`uNoGS answered ${r.status} for ${url}`, 'title')
      }
      return r.json() as T
    })
  ))

interface UnogsTitle {
  netflixid: number
  title: string
  synopsis: string
  vtype: string
  img: string
  lgimg: string
  nfdate: string
  year: number | null
  imdbid: string | null
  imdbrating: number | null
}

interface UnogsSearchResult {
  title: string
  nfid: number
  synopsis: string
  img: string
  vtype?: string
  year?: number | null
  imdbid?: string | null
}

interface UnogsBgImages {
  bo166x236: { url: string }[]
  bo342x192: { url: string }[]
  bo665x375: { url: string }[]
  bg: { url: string }[]
}

/**
 * One episode as unOGS republishes it. Every field here is Netflix's own, forwarded.
 *
 * `seasid` and `epnum` arrived on this payload all along and were declared nowhere, so they were read
 * off the wire and dropped. Both are optional because the payload is not ours: unOGS can stop sending
 * either without warning, and a fallback built from Netflix's own endpoint fills them from a different
 * place, so nothing downstream may require them.
 */
interface UnogsEpisode {
  epid: number
  /**
   * The Netflix SEASON id, verified identical to Netflix's own `seasons.edges[].node.videoId`
   * (measured 2026-09-12: unOGS `seasid` 81392609 for Mushoku Tensei season 1, which is exactly what
   * netflix.com's own endpoint answers). A REAL id, where the season uri this source mints is an
   * ordinal; see `assembleMedia` for what changing that would cost.
   */
  seasid?: number
  /**
   * Netflix's own episode number inside its own season.
   *
   * NEVER THE CANONICAL EPISODE NUMBER. Measured shifted by one against canonical numbering on at
   * least one season, and Netflix disagrees with anime about where a season begins at all. It is read
   * here as evidence about NETFLIX'S OWN ORDER and nothing else, which is the one thing it is
   * authoritative about.
   */
  epnum?: number
  seasnum: number
  synopsis: string
  title: string
  img: string
  /**
   * The episode's length in SECONDS, when the upstream that answered published one.
   *
   * unOGS publishes no runtime at any level, so this is only ever set by Netflix's own season
   * endpoint. `normalizeEpisode` converts it, because the schema's `runtime` is in minutes.
   */
  runtimeSec?: number
}

/**
 * One season of a Netflix title, however it was answered: unOGS is the primary and Netflix's own
 * endpoint is the fallback, and both are parsed into this.
 */
type NetflixSeason = {
  season: number
  episodes: UnogsEpisode[]
  /**
   * The Netflix SEASON id, when the upstream that answered published one.
   *
   * IT IS WHAT THE EPISODE CALL IS MADE WITH: Netflix's season endpoint is keyed by this and nothing
   * else, so a season that reaches `withNetflixEpisodes` without one keeps unOGS' episodes.
   *
   * It is still NOT what this source's season uri is built from: that stays an ordinal, because
   * switching to `nf:<seasid>` is a store migration rather than an edit (`assembleMedia` carries the
   * cost), and this is the id that migration would need, next to the ordinal it would replace.
   */
  seasonId?: number
  /**
   * True when `episodes` is a PREFIX of the season rather than the season. unOGS never sets it, since
   * it pages nothing; Netflix's LANDING query always does past ten, because it caps a season at ten
   * episodes and takes no pagination variable. `withNetflixEpisodes` is the one thing that CLEARS it:
   * the season endpoint pages, so a season it answered in full is a season, and one it could not
   * finish says so. A truncated season's length is not an episode count and must never be offered as
   * one (`netflixCandidates`, `assembleMedia`).
   */
  truncated?: boolean
}

/**
 * Every season one upstream could answer for a title, and whether that LIST is itself a prefix.
 *
 * The list being a prefix is a different claim from a season being one, and it has to travel with the
 * seasons because a caller asking about season 15 of a ten-season prefix is asking about a season
 * nobody looked at. Netflix's own endpoint pages the season list at ten exactly as it pages episodes:
 * One Piece answers `totalCount: 40` with ten edges (measured 2026-09-12), where unOGS answers all
 * forty. Only the Netflix fallback can set it; unOGS pages nothing and answers whole titles.
 */
type SeasonListing = {
  seasons: NetflixSeason[]
  truncated: boolean
}

const UNOGS = 'https://unogs.com/api'

const fetchDetail = (id: string, ctx: ExtractorServerContext) =>
  api<UnogsTitle[]>(`${UNOGS}/title/detail?netflixid=${id}`, ctx)

const fetchBgImages = (id: string, ctx: ExtractorServerContext) =>
  api<UnogsBgImages>(`${UNOGS}/title/bgimages?netflixid=${id}`, ctx)

/**
 * unOGS' episodes payload as this source reads it, or undefined when the body is not that payload.
 *
 * Exported for tests/unit/sources/unogs/netflix-fallback.test.ts; nothing else imports it.
 *
 * Every field is copied by name rather than the object being passed through, so what this source
 * carries is written down in one place: `seasid` and `epnum` are here because they arrive and were
 * being discarded, and a field that stops arriving becomes undefined instead of poisoning a record.
 * An entry that is not an object, and an episode carrying no `epid`, are DROPPED rather than thrown
 * on or published: this function never throws, because a throw here is read as unOGS being down.
 *
 * Undefined MEANS "unOGS did not answer this question", which is what makes the Netflix fallback
 * possible at all: a body that is not an array of `{season, episodes}` is a failure of the upstream,
 * where an array of seasons holding no episodes is a claim about the TITLE. The two are answered
 * differently in `fetchEpisodes`.
 *
 * Episodes are ordered by `epnum` when every episode in the season declares a distinct one, because
 * that is Netflix's own order and it is the only thing `epnum` is authoritative about. The number this
 * source publishes is still the POSITION in the list (see `assembleMedia`), so a season whose payload
 * already arrives in order is unchanged by this, which is every season measured so far.
 */
export const parseUnogsSeasons = (body: unknown): NetflixSeason[] | undefined => {
  if (!Array.isArray(body)) return undefined
  const seasons: NetflixSeason[] = []
  for (const raw of body) {
    const season = raw as { season?: unknown, episodes?: unknown }
    if (typeof season?.season !== 'number' || !Array.isArray(season.episodes)) return undefined
    const episodes = season.episodes
      .map((entry: unknown): UnogsEpisode | undefined => {
        // UNDEFINED RATHER THAN A THROW, on both counts, because this function's promise is that a
        // body it cannot read comes back as undefined: an entry that is not an object threw a
        // TypeError out of the one place that decides whether unOGS answered at all.
        if (typeof entry !== 'object' || entry === null) return undefined
        const fields = entry as Record<string, unknown>
        // AN EPISODE WITH NO ID IS DROPPED. `normalizeEpisode` stringifies whatever this is, so an
        // absent one publishes `nf:undefined` at netflix.com/watch/undefined, and the episode uri is
        // not scoped by its media: two id-less episodes from two different titles would union onto
        // that one node. Nothing on the wire has ever missed it; this is the gate that says so.
        if (fields.epid == null || fields.epid === '') return undefined
        return {
          // passed through untouched rather than coerced: every measured payload numbers it, and
          // `normalizeEpisode` stringifies whatever this is, where a coerced NaN would name nothing
          epid: fields.epid as number,
          seasid: typeof fields.seasid === 'number' ? fields.seasid : undefined,
          epnum: typeof fields.epnum === 'number' ? fields.epnum : undefined,
          seasnum: typeof fields.seasnum === 'number' ? fields.seasnum : season.season as number,
          synopsis: typeof fields.synopsis === 'string' ? fields.synopsis : '',
          title: typeof fields.title === 'string' ? fields.title : '',
          img: typeof fields.img === 'string' ? fields.img : ''
        }
      })
      .filter((episode): episode is UnogsEpisode => Boolean(episode))
    seasons.push({
      season: season.season,
      seasonId: episodes.find(episode => episode.seasid != null)?.seasid,
      episodes: inNetflixOrder(episodes)
    })
  }
  return seasons
}

const inNetflixOrder = (episodes: UnogsEpisode[]): UnogsEpisode[] => {
  const numbers = new Set(episodes.map(episode => episode.epnum))
  if (numbers.has(undefined) || numbers.size !== episodes.length) return episodes
  return [...episodes].sort((a, b) => a.epnum! - b.epnum!)
}

/**
 * The ordinal each of Netflix's season blocks is published under, one per block and ALL DISTINCT.
 *
 * Netflix labels seasons rather than numbering them, so an unlabelled block takes its POSITION, which
 * is the ordinal scheme unOGS' `seasnum` and this source's uri suffix already use. Two blocks can
 * therefore derive the SAME ordinal (an unlabelled "Specials" at position 1 next to a labelled
 * "Season 1"), and `assembleMedia` selects a season by that ordinal, so a collision would publish two
 * different seasons as one media holding both their episode lists.
 *
 * A colliding block takes the next free ordinal instead of merging, and the LABELLED blocks claim
 * theirs first so an unlabelled one can never displace a season that named its own number. Not
 * observed on the wire (nine shows probed 2026-09-12, every block labelled "Season N" or "Part N"),
 * so this is insurance rather than a repair.
 */
const derivedOrdinals = (seasons: NetflixTitle['seasons']): number[] => {
  const taken = new Set<number>()
  const claim = (wanted: number): number => {
    let ordinal = wanted
    while (taken.has(ordinal)) ordinal += 1
    taken.add(ordinal)
    return ordinal
  }
  const ordinals: number[] = []
  seasons.forEach((season, index) => { if (season.number != null) ordinals[index] = claim(season.number) })
  seasons.forEach((season, index) => { if (season.number == null) ordinals[index] = claim(index + 1) })
  return ordinals
}

/** The Netflix fallback's seasons in this source's shape, carrying the truncation Netflix declared. */
const netflixSeasons = (title: NetflixTitle): SeasonListing => {
  const ordinals = derivedOrdinals(title.seasons)
  return {
    truncated: title.seasonsTruncated,
    seasons: title.seasons.map((season, index) => {
      const seasnum = ordinals[index]!
      return {
        season: seasnum,
        seasonId: season.videoId,
        truncated: season.truncated,
        episodes: season.episodes.map((episode): UnogsEpisode => ({
          epid: episode.videoId,
          seasid: season.videoId,
          epnum: episode.number,
          seasnum,
          synopsis: episode.synopsis ?? '',
          title: episode.title,
          img: episode.thumbnail ?? ''
        }))
      }
    })
  }
}

/**
 * How long unOGS is left alone after IT failed, as opposed to after one title's ask failed.
 *
 * A page opening several Netflix rows asks this source many times within a second or two. Without a
 * memory, every one of those pays a failing episodes call before reaching the fallback, which is the
 * worst possible behaviour toward an upstream that is already unwell. (The token is cached for 12 h
 * and the detail and artwork calls are not gated by this, so what the window saves is the episodes
 * call alone.) One minute is short enough that a blip costs one skipped attempt and long enough to
 * collapse a burst.
 *
 * IT IS MODULE GLOBAL, so only a failure that is evidence about unOGS may arm it: see
 * `UnogsFailureScope`, and finding 3 of the review that split them apart.
 */
const UNOGS_COOLDOWN_MS = 60_000
let _unogsDownUntil = 0

/**
 * Forget the token, the in-flight calls and the unOGS cooldown. Exported for tests, which need a
 * clean module between cases; nothing in the app calls it.
 */
export const resetUnogsCaches = () => {
  forgetToken()
  _unogsDownUntil = 0
  _inflight.clear()
}

/**
 * WHAT COUNTS AS "unOGS CANNOT ANSWER" for this one title, the whole list:
 *
 *  - the token call failed or returned no `access_token` (it throws, and is caught here)
 *  - the request never arrived, or the endpoint answered a non-success status (`requireOk`)
 *  - the body is not an array of `{season, episodes}` (`parseUnogsSeasons` returns undefined)
 *
 * An array of seasons is an ANSWER even when it is empty, and it is never read as a failure: that is a
 * claim about the title, and treating it as an outage would put every film and every unlisted title
 * into the cooldown and send the whole source to the fallback.
 *
 * WHAT COUNTS AS "unOGS IS DOWN" is a SHORTER list, and that is the whole point of the split: only a
 * failure scoped `upstream` arms the cooldown every other title then pays. A 200 carrying `{}` for one
 * id is the upstream working and this app asking a question it cannot parse, which is exactly what a
 * season-suffixed id does.
 */
const unogsSeasons = async (id: string, ctx: ExtractorServerContext): Promise<NetflixSeason[] | undefined> => {
  if (Date.now() < _unogsDownUntil) return undefined
  try {
    const seasons = parseUnogsSeasons(await api<unknown>(`${UNOGS}/title/episodes?netflixid=${id}`, ctx, { requireOk: true }))
    if (!seasons) console.error(`uNoGS episodes for ${id} came back in a shape this source cannot read`)
    return seasons
  } catch (error) {
    if (failureScope(error) === 'upstream') _unogsDownUntil = Date.now() + UNOGS_COOLDOWN_MS
    console.error(`uNoGS episodes for ${id} failed`, error)
    return undefined
  }
}

/** Netflix's own endpoint, asked only when unOGS could not answer. A failure here is loud and empty. */
const netflixFallbackSeasons = (id: string, ctx: ExtractorServerContext): Promise<SeasonListing | undefined> =>
  dedupe(`netflix:${id}`, async () => {
    const result = await fetchNetflixTitle(id, ctx)
    if (!result.ok) {
      // A stale persisted query is logged rather than thrown: it is a real, actionable failure, and it
      // is also the one thing that would otherwise take this source down entirely on the path where
      // unOGS answered an empty list quite legitimately.
      console.error(`Netflix fallback for ${id} failed (${result.failure}): ${result.message}`)
      return undefined
    }
    return result.title && netflixSeasons(result.title)
  })

/**
 * WHICH SEASONS a Netflix title has, from unOGS when it can answer and from Netflix's landing query
 * when it cannot. The INDEX, not the episode data: `withNetflixEpisodes` replaces the episodes of the
 * season being published. Never throws: a title nobody can answer for has no seasons, which every
 * caller already handles, and a throw here would take the whole subscription with it.
 *
 * UNOGS STAYS PRIMARY FOR THE INDEX. It answers every season of a title in one 1.2 to 1.8 s call that
 * pages nothing, it carries the real `seasid` the episode call is made with, and it is the only one of
 * the two that can SEARCH. Netflix's landing query caps the SEASON list at ten (see
 * `NetflixTitle.seasonsTruncated`), so as an index it is a floor and never a replacement.
 *
 * The fallback also runs when unOGS answers an empty list for a title, because an empty list is
 * exactly what a caller cannot act on, and a second opinion that costs half a second is worth having
 * before concluding a show has no episodes. That path does NOT mark unOGS down.
 */
const fetchSeasonIndex = async (id: string, ctx: ExtractorServerContext): Promise<SeasonListing> => {
  const seasons = await unogsSeasons(id, ctx)
  // unOGS pages nothing: an answer from it is the whole title's season list, never a prefix
  if (seasons?.some(season => season.episodes.length)) return { seasons, truncated: false }
  return await netflixFallbackSeasons(id, ctx) ?? { seasons: seasons ?? [], truncated: false }
}

/** A title Netflix numbers rather than names: no title at all, spelled the way this payload spells one. */
const PLACEHOLDER_EPISODE_TITLE = /^episode\s+\d+$/i

/**
 * Netflix's own episodes in this source's shape, with the unOGS season they replace as a cross-check.
 *
 * Every field is Netflix's except one. The TITLE keeps unOGS' when Netflix numbers the episode rather
 * than naming it and unOGS has a real name for the same id: Netflix answers "Episode 1" through
 * "Episode 24" for Mushoku Tensei season 1 and real names for season 2 (measured 2026-09-13), and a
 * replacement that lost a name it already had would be a regression on the only axis unOGS is not
 * worse on. Matched by episode id, which both sides spell as Netflix's own video id.
 */
const netflixEpisodes = (episodes: NetflixEpisode[], season: NetflixSeason): UnogsEpisode[] => {
  const known = new Map(season.episodes.map(episode => [String(episode.epid), episode]))
  return episodes.map((episode, index): UnogsEpisode => {
    const named = known.get(String(episode.videoId))?.title
    return {
      epid: episode.videoId,
      seasid: season.seasonId,
      epnum: episode.number ?? index + 1,
      seasnum: season.season,
      synopsis: episode.synopsis ?? '',
      title: PLACEHOLDER_EPISODE_TITLE.test(episode.title) && named && !PLACEHOLDER_EPISODE_TITLE.test(named)
        ? named
        : episode.title,
      img: episode.thumbnail ?? '',
      runtimeSec: episode.runtimeSec
    }
  })
}

/**
 * The listing with ONE season's episodes taken from Netflix instead of unOGS, when Netflix can answer.
 *
 * WHY NETFLIX AND NOT UNOGS, for the episodes alone: unOGS republishes one placeholder image repeated
 * across a whole season (231 of its 276 image pairs near-identical for Mushoku Tensei season 1,
 * against 0 of 45 for Netflix's own) and 4 synopses of 24 where Netflix answers 24 of 24. The synopsis
 * is what the episode anchor scores against, so a season of 4 is not a weak anchor, it is no anchor.
 *
 * WHY UNOGS STILL ANSWERS FIRST, so this is a replacement and never a search: unOGS is the only one of
 * the two that can SEARCH, and its episodes call answers the WHOLE title, every season, in one request
 * that pages nothing, where Netflix's own season index caps at ten seasons (One Piece answers ten of
 * its forty). That call is what supplies the season ordinals and the real `seasid` this asks with.
 *
 * ONE SEASON, never the title. Netflix's endpoint is per season, so enriching a title costs one
 * request per season, and the only season whose episodes are published is the one the caller named.
 * The season picker is deliberately left on unOGS' lists (`matchNetflixSeason`): it reads counts and
 * titles across EVERY season, which unOGS answers correctly in the one request already made.
 *
 * NEVER DESTRUCTIVE. A failure, a season nobody can match to an id, and an empty answer all return the
 * listing untouched, so the worst case is exactly what this source published before.
 */
const withNetflixEpisodes = async (
  listing: SeasonListing,
  seasonNumber: number | undefined,
  ctx: ExtractorServerContext
): Promise<SeasonListing> => {
  if (seasonNumber == null) return listing
  const target = listing.seasons.find(season => season.season === seasonNumber)
  const seasonId = target?.seasonId
  // SAID OUT LOUD, because this is the one exit that used to be silent. A failure logs, an empty
  // answer is visible as no episodes, but a season unOGS answered with no `seasid` skipped the whole
  // Netflix slice with nothing to read anywhere: the page then carries unOGS' 4 synopses of 24 and its
  // one repeated placeholder still, and looks exactly like a Netflix call that was never worth making.
  // Which of the two conditions fired is named, since "no such season in this listing" and "this
  // season carries no Netflix id" are different faults with different fixes, and BOTH ARE OURS: the
  // sentence says so, because every silent exit in this function was read as Netflix's once already.
  if (!target || seasonId == null) {
    console.warn(`Netflix episodes for season ${seasonNumber} skipped (ours, off unOGS' own listing: ${target ? 'the listing carries no seasid for it' : `no season ${seasonNumber} in a listing of ${listing.seasons.length}`}); unOGS' own episodes stand`)
    return listing
  }
  const answer = await dedupe(`netflix-season:${seasonId}`, () => fetchNetflixSeasonEpisodes(seasonId, ctx))
  if (!answer.ok) {
    // logged rather than thrown, the same as the title fallback: a stale persisted query is real and
    // actionable, and it must not take down a season unOGS already answered perfectly well
    console.error(`Netflix episodes for season ${seasonId} failed (${answer.failure}, whose fact: ${NETFLIX_FAILURE_FACT[answer.failure]}): ${answer.message}`)
    return listing
  }
  if (!answer.episodes.length) {
    // NOT A FAILURE: Netflix answers 200 with a well formed, EMPTY season. `empty` names which of the
    // three shapes it was (`NetflixSeasonEmpty`) and the line says whose fact that is, because every
    // one of them is a fact about ONE COUNTRY. This exit is where the whole slice sat on every page
    // load until 2026-09-13, printing `no-episodes-listed` about requests that left from Hong Kong
    // while the viewer was in Tokyo; `src/worker/direct-fetch.ts` is what moved them, and
    // `not-in-this-catalogue` is what would have said so on day one.
    console.warn(`Netflix episodes for season ${seasonId} answered no episodes (${answer.empty ?? 'unstated'}, whose fact: ${answer.empty ? NETFLIX_EMPTY_FACT[answer.empty] : 'unstated, which is this file having lost track of a shape'}); unOGS' own ${target.episodes.length} episode(s) stand`)
    return listing
  }
  const episodes = netflixEpisodes(answer.episodes, target)
  // THE SLICE SAYS WHAT IT PUBLISHED, on one line, which is the whole of 1d. Every other exit above
  // is a fault with a name; this one is the success, and without it the difference between "Netflix
  // answered a whole described season" and "the call never happened" is invisible on a page carrying
  // no synopsis, which is exactly the state that was read as a Netflix failure for a day.
  console.warn(`Netflix episodes for season ${seasonId} published ${episodes.length} episode(s), ${episodes.filter(episode => episode.synopsis.trim()).length} with a synopsis${answer.truncated ? ' (truncated)' : ''} (whose fact: Netflix's, answered to this browser's own address)`)
  const replaced: NetflixSeason = { ...target, episodes, truncated: answer.truncated }
  return { ...listing, seasons: listing.seasons.map(season => season === target ? replaced : season) }
}

/**
 * Every season of a Netflix title, with the named season's episodes from Netflix's own endpoint.
 *
 * `seasonNumber` is the season being PUBLISHED, not a filter: the whole listing comes back either way,
 * because the season picker reads every season. Passing nothing asks for the index alone, which is one
 * request; passing a season adds one more.
 */
const fetchEpisodes = async (id: string, ctx: ExtractorServerContext, seasonNumber?: number): Promise<SeasonListing> =>
  withNetflixEpisodes(await fetchSeasonIndex(id, ctx), seasonNumber, ctx)

const searchApi = (query: string, ctx: ExtractorServerContext) =>
  api<{ results: UnogsSearchResult[] }>(
    `${UNOGS}/search?limit=50&offset=0&query=${encodeURIComponent(query)}&countrylist=&country_andorunique=&start_year=&end_year=&start_rating=&end_rating=&genrelist=&type=&audio=&subtitle=&audiosubtitle_andor=&person=&personid=&filterby=&orderby=`,
    ctx
  )

const decode = (str: string): string =>
  str
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")

const httpsUrl = (url: string) => url.replace(/^http:/, 'https:')

// A bare `nf:<netflixid>` is the whole Netflix TITLE: exact for a film, every season at once for a
// series. Only the season rewrite in `getMedia` turns a series id into a run. The type is what tells the
// graph's guards a film is a film, which a category alone does not.
const kindOf = (vtype: string | undefined): Pick<GQLMedia, 'type' | 'categories' | 'scope'> =>
  vtype === 'movie' ? { type: 'MOVIE', categories: ['MOVIE'], scope: 'RUN' } : { categories: ['SERIES'], scope: 'CONTAINER' }

const normalizeTitle = (title: UnogsTitle, bgImages?: UnogsBgImages): GQLMedia => {
  const covers: { url: string, score: number }[] = []
  const banners: { url: string, score: number }[] = []
  if (title.img) covers.push({ url: httpsUrl(title.img), score: SCORE })
  if (bgImages) {
    const poster = bgImages.bo166x236?.[0]?.url
    if (poster && !covers.some(c => c.url === poster)) covers.push({ url: poster, score: SCORE })
    const banner = bgImages.bo665x375?.[0]?.url ?? bgImages.bo342x192?.[0]?.url
    if (banner) banners.push({ url: banner, score: SCORE })
    const bg = bgImages.bg?.[0]?.url
    if (bg) banners.push({ url: bg, score: SCORE })
  }
  if (title.lgimg && !banners.some(b => b.url === title.lgimg)) banners.push({ url: title.lgimg, score: SCORE })

  return makeMedia({
    origin,
    id: String(title.netflixid),
    url: `https://www.netflix.com/title/${title.netflixid}`,
    score: SCORE,
    ...kindOf(title.vtype),
    titles: [{ language: 'en', title: decode(title.title), score: SCORE }],
    ...desc(title.synopsis ? decode(title.synopsis) : undefined, SCORE),
    covers, banners,
    startDate: title.year ? `${title.year}-01-01` : undefined,
    averageScore: percentScore(title.imdbrating, 10)
  })
}

const normalizeSearchResult = (result: UnogsSearchResult): GQLMedia =>
  makeMedia({
    origin,
    id: String(result.nfid),
    url: `https://www.netflix.com/title/${result.nfid}`,
    score: SCORE,
    ...kindOf(result.vtype),
    titles: [{ language: 'en', title: decode(result.title), score: SCORE }],
    ...desc(result.synopsis ? decode(result.synopsis) : undefined, SCORE),
    covers: result.img ? img(httpsUrl(result.img), SCORE) : [],
    startDate: result.year ? `${result.year}-01-01` : undefined
  })

const normalizeEpisode = (episode: UnogsEpisode, mediaUri: string, episodeNumber: number): GQLEpisode => {
  const synopsis = episode.synopsis?.trim()
  const decodedSynopsis = synopsis && !synopsis.startsWith("THIS EPISODE'S SYNOPSIS IS COMING SOON")
    ? decode(synopsis) : undefined
  return makeEpisode({
    origin,
    id: String(episode.epid),
    mediaUri,
    url: `https://www.netflix.com/watch/${episode.epid}`,
    score: SCORE,
    titles: [{ language: 'en', title: decode(episode.title), score: SCORE }],
    ...desc(decodedSynopsis, SCORE),
    thumbnails: episode.img ? img(httpsUrl(episode.img), SCORE) : [],
    // the schema's `runtime` is MINUTES and Netflix publishes seconds: 1422 s is a 24 minute episode
    runtime: episode.runtimeSec ? Math.round(episode.runtimeSec / 60) : undefined,
    seasonNumber: episode.seasnum,
    episodeNumber
  })
}

// Netflix serves movies at /watch/<id> just like episodes, so the synthetic episode gets a playable url rather than /title/<id>
const normalizeMovieAsEpisode = (media: GQLMedia): GQLEpisode =>
  makeMovieEpisode(media, { url: `https://www.netflix.com/watch/${media.id}`, score: SCORE })

/**
 * Exported for tests/unit/sources/unogs/extractor.test.ts, which drives it directly; nothing else imports it.
 *
 * `requireSeason` is what makes a refusal actually refuse.
 *
 * Without it, a series whose season could not be resolved still produced a media: `seasonNumber` being
 * undefined skips the suffix below, so the uri stays the BARE `nf:<showId>`, the episode filter stops
 * filtering and every season's episodes are attached, and the caller then links the cluster's handles
 * to it. Two runs of one show that both fail to resolve therefore receive the identical show-level uri
 * and union-find welds them, permanently, which is the exact failure this source's season scoping
 * exists to prevent.
 *
 * Measured over 33 multi-season Netflix series and 105 runs: refusing into the show-level id accounted
 * for 30 of 41 welds, and declining to mint anything drops that to 11. The cost is the 56 runs that
 * resolve to no season showing no Netflix row at all, which is the tradeoff already taken for imdb in
 * worker/store/db.ts: a link that has to assert a false identity to exist is not worth having.
 *
 * Callers that do NOT attach cluster handles pass false, because a direct `nf:<id>` browse is the user
 * naming that Netflix title and welds nothing.
 */
/**
 * What a search may offer: FILMS ONLY, for the same reason justwatch's `showRequiresSeason` refuses a
 * seasonless series.
 *
 * A bare `nf:<netflixid>` is the whole Netflix TITLE. For a film that is exact, since a film has no
 * seasons to be confused between. For a series it names every season at once, and this endpoint returns
 * no season information, so there is nothing here to scope it with.
 *
 * An unscoped series id does real damage rather than being merely vague. Measured on the deployed site:
 * searching Mushoku Tensei put the bare `nf:80987039` inside season 1's cluster, with no media page ever
 * opened, claiming the whole show IS that one cour (scripts/reproduce-season-weld.mjs, ARM A). The media
 * path is untouched and still resolves a season, minting `nf:80987039-3`.
 *
 * `vtype` is OPTIONAL on the search payload where the detail payload requires it, so anything that is
 * not exactly 'movie' is read as a series and refused. That is the safe direction, and it is the same
 * ternary `normalizeSearchResult` already uses to assign `categories`.
 */
export const searchNodes = async (query: string, ctx: ExtractorServerContext): Promise<GQLMedia[]> => {
  const { results = [] } = await searchApi(query, ctx)
  return results.filter(result => result.vtype === 'movie').map(normalizeSearchResult)
}

export const getMedia = async (
  id: string,
  ctx: ExtractorServerContext,
  seasonNumber?: number,
  requireSeason = false
): Promise<GQLMedia | undefined> => {
  const [detailRes, bgImagesRes] = await Promise.all([fetchDetail(id, ctx), fetchBgImages(id, ctx)])
  const title = detailRes[0]
  if (!title) return undefined
  if (requireSeason && seasonNumber == null && title.vtype === 'series') return undefined
  const listing = title.vtype === 'series' ? await fetchEpisodes(id, ctx, seasonNumber) : undefined
  return assembleMedia(title, bgImagesRes, listing, seasonNumber)
}

// The media out of payloads already in hand, so `similarSeason` can reuse the detail and episode
// responses it has just read for the pick instead of fetching them a second time.
const assembleMedia = (
  title: UnogsTitle,
  bgImages: UnogsBgImages | undefined,
  listing: SeasonListing | undefined,
  seasonNumber?: number
): GQLMedia | undefined => {
  const media = normalizeTitle(title, bgImages)
  if (seasonNumber != null) {
    // THE SEASON URI IS AN ORDINAL, deliberately, and `NetflixSeason.seasonId` is the real Netflix
    // season id sitting next to it. Minting `nf:<seasid>` instead would be a better id (it survives
    // Netflix renumbering a season, and it is the id Netflix's own endpoint answers about), and it is
    // NOT free: every `nf:<show>-<n>` already in the store, in every cluster's handles and in the
    // recorded corpus, would name nothing, and `graph.link` has no inverse, so the two schemes cannot
    // coexist without welding a run to both. It is a migration, not an edit, and it is a separate
    // decision from carrying the id.
    media.id = `${media.id}-${seasonNumber}`
    media.uri = toUri({ origin, id: media.id })
    media.scope = 'RUN'
    // A SEASON-scoped media may never carry the SHOW's year, and only the id used to be rewritten here.
    //
    // `normalizeTitle` stamps `${title.year}-01-01`, which is Netflix's year for the whole TITLE, so
    // every season of a show carried its FIRST season's year. That is not merely inaccurate: it welds
    // seasons together by a route that looks nothing like a date problem. `profileCluster` derives its
    // `years` set from every member's startDate and `fuzzyMergeMediaClusters` buckets by year, so a
    // season 3 media carrying 2021 is compared against the 2021 clusters, where a shared title is
    // enough. Measured on production 2026-09-05: `nf:80987039-3` carried 2021 and put Mushoku Tensei
    // season 3 in season 1's bucket.
    //
    // Nothing is asserted instead of guessing, because unOGS gives no season premiere to use:
    // `UnogsEpisode` carries epid, seasnum, synopsis, title and img, and no air date at all. An absent
    // date costs this source a year bucket; a wrong one costs a permanent weld, and `graph.link` has no
    // inverse. `tvmaze/extractor.ts`, `appletv/extractor.ts` and `tmdb/extractor.ts` each fixed exactly
    // this in their own file; this one was missed.
    media.startDate = undefined
  }

  if (title.vtype === 'series') {
    if (!listing) return media
    const filtered = seasonNumber != null ? listing.seasons.filter(s => s.season === seasonNumber) : listing.seasons
    // A SEASON A PREFIX NEVER SHOWED IS UNKNOWN, NOT EMPTY, so nothing is minted for it at all, the
    // same refusal `requireSeason` makes for a season nobody could resolve. Netflix's own endpoint
    // pages the SEASON list at ten: One Piece answers ten of its forty, so `getMedia('80107103', ctx,
    // 15)` off that listing filters to nothing, and every episode claim about season 15 would be
    // invented. Measured 2026-09-12, and reachable from any stored `nf:<show>-<n>` with n past the
    // tenth season whenever unOGS is the one that could not answer.
    if (seasonNumber != null && !filtered.length && listing.truncated) return undefined
    media.episodes = filtered.flatMap(season =>
      season.episodes.map((ep, i) => normalizeEpisode(ep, media.uri, i + 1))
    )
    // A TRUNCATED season has a length and no count: the Netflix fallback answers ten of a 24 episode
    // season, and ten published as `episodeCount` is a false claim that the season picker reads as
    // evidence (`foldVetoed` compares counts) and that the page prints as the season's length. The
    // episodes that were answered are still offered; only the claim about how many there are is not.
    //
    // NO EPISODES READ IS NOT A COUNT OF ZERO either. When neither upstream answered, `filtered` holds
    // nothing and `0` is a number this source invented during an outage: `hasEvidence` reads
    // `episodeCount != null`, the cluster's count vote filters on the same test, and the row prints
    // "0 Episodes". Before the fallback existed this case could not arise, because a failed episodes
    // call took the whole resolver down instead of returning an empty list.
    const answered = media.episodes.length > 0 && !filtered.some(season => season.truncated)
    media.episodeCount = answered ? media.episodes.length : undefined
  } else {
    media.episodes = [normalizeMovieAsEpisode(media)]
    media.episodeCount = 1
  }

  return media
}

/**
 * Netflix's seasons as the shared picker reads them.
 *
 * unOGS gives no air date at any level (`UnogsEpisode` is epid, seasnum, synopsis, title, img), so the
 * axes are the count, the episode titles and, on the FIRST season only, the title's year: Netflix's
 * `year` is the whole title's, which is its first season's, and offered on any other season it would
 * veto the very run that season holds.
 */
const netflixCandidates = (seasons: NetflixSeason[], titleYear?: number | string | null): SeasonCandidate<NetflixSeason>[] =>
  [...seasons].sort((a, b) => a.season - b.season).map((season, index) => ({
    season,
    seasonNumber: season.season,
    // A TRUNCATED season offers NO count, because a prefix's length is not a length. Every rule in
    // `pickSimilarSeason` that reads a count refuses without one, which is the right direction: ten
    // episodes of a 24 episode season would clear the fold veto against any run of ten or more and
    // hand that run a season it does not hold, and `graph.link` has no inverse.
    episodeCount: season.truncated ? undefined : season.episodes.length,
    // AND NO TITLES EITHER, which is the axis that decides FIRST. `pickSimilarSeason`'s title rule
    // runs ahead of every count rule and measures coverage against the CANDIDATE's listed titles
    // (`EPISODE_TITLE_COVERAGE`), so a ten of 24 prefix turns the fold the rule exists to refuse,
    // 12/24 = 0.50, into 10/10 = 1.00 and hands a single cour a season holding two. Withholding the
    // count alone left that route open: the prefix has to be silent on both axes.
    episodeTitles: season.truncated ? undefined : season.episodes.map(episode => decode(episode.title ?? '')),
    year: index === 0 ? Number(titleYear) || undefined : undefined
  }))

/**
 * Which of this Netflix series' seasons is the cluster asking, or the whole TITLE when nothing settles it.
 *
 * The rules are `pickSimilarSeason` in ../similar.ts, shared with every source that answers
 * `similarMedia`. What this file measured on its way there, over 33 real multi-season Netflix series
 * and their 105 anime runs (`scripts/measure-unogs-season-match.probe.ts`): the episode count alone is
 * ambiguous for 48 of the 105, and answering anyway landed 51 runs on a season another run already
 * held. A UNIQUE count is still a guess: Netflix lists Mushoku Tensei as 24, 25 and 11 episodes, anime
 * season 1 has 11 and a title naming no season, so the count picked Netflix season 3 for it while
 * season 3's own page took the same `nf:80987039-3` by its ordinal (2026-09-05, five of five runs of
 * `scripts/reproduce-season-weld.mjs`). One id, two runs, and `graph.link` has no inverse.
 *
 * What is not a season is the TITLE: the bare `nf:<id>` scoped CONTAINER, which the store hangs the
 * run under as PART_OF. The Netflix link survives on the page and asserts nothing.
 *
 * WHAT THIS SOURCE STILL CANNOT DO, recorded rather than hidden: Netflix does not agree with anime
 * about what a season is. It splits Fullmetal Alchemist's single 64 episode run into five seasons of
 * about 13 and folds Mushoku Tensei's five runs into three. No amount of counting fixes a disagreement
 * about the unit; the fold veto only ever detects the direction it can see.
 */
type NetflixMatch = { kind: 'season', season: number } | { kind: 'title' }

const matchNetflixSeason = async (
  nfId: string,
  aggregatedUri: string,
  ctx: ExtractorServerContext,
  titleYear?: number | string | null
): Promise<NetflixMatch | undefined> => {
  const known = await waitForMedia<GQLMedia>(aggregatedUri, ctx, media =>
    declaredEpisodeCount(media) ? media as GQLMedia : undefined
  )
  if (!known) return undefined

  const { seasons } = await fetchEpisodes(nfId, ctx)
  if (!seasons.length) return undefined

  const verdict = pickSimilarSeason(
    {
      titles: (known.titles ?? []).map(title => title.title),
      episodeCount: declaredEpisodeCount(known),
      startDate: known.startDate
    },
    netflixCandidates(seasons, titleYear)
  )
  return verdict ? { kind: 'season', season: verdict.season.season } : { kind: 'title' }
}

/**
 * The one Netflix season of `showId` that the caller's evidence establishes as its run, built as a
 * season-scoped RUN carrying no handles, or undefined. A film is not a container and has nothing to
 * pick; a refusal by the picker is undefined too, never the title.
 */
const similarSeason = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  if (!input?.showId) return undefined
  const detail = (await fetchDetail(input.showId, ctx))?.[0]
  if (detail?.vtype !== 'series') return undefined
  const listing = await fetchEpisodes(input.showId, ctx)
  if (!listing.seasons.length) return undefined
  const verdict = pickSimilarSeason(input, netflixCandidates(listing.seasons, detail.year))
  if (!verdict) return undefined
  // enriched AFTER the pick, never before: the verdict is what names the one season worth a request
  const picked = await withNetflixEpisodes(listing, verdict.season.season, ctx)
  return assembleMedia(detail, await fetchBgImages(input.showId, ctx), picked, verdict.season.season)
}

/**
 * The one Netflix season that HOLDS the caller's run without being it, or undefined (4.4).
 *
 * Netflix is the source this exists for. It folds five Mushoku Tensei runs into three seasons, so its
 * season 1 of 24 episodes is the only season either of the first two runs could match and
 * `pickSimilarSeason` refuses it for both, correctly: `theirs (24) > ours (11)` is a fold, and a season
 * longer than the run is not the run. Both runs then had no Netflix anything at all, which is the gap
 * this closes. `pickContainingSeason` carries the evidence and the refusals; this file's job is to
 * offer the same candidates to it and to build the season it names.
 *
 * The answer is the CONTAINER SEASON as an ordinary season-scoped RUN, episodes and count included,
 * exactly as `similarSeason` builds one. What differs is entirely on the caller's side: it claims
 * `PART_OF` from this and never `SAME_AS`, so the row hangs off the run's cluster rather than joining
 * it. Nothing here may hint at sameness, which is why it carries no handles, the same as the answer
 * above.
 */
const containingSeason = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  if (!input?.showId) return undefined
  const detail = (await fetchDetail(input.showId, ctx))?.[0]
  if (detail?.vtype !== 'series') return undefined
  const listing = await fetchEpisodes(input.showId, ctx)
  if (!listing.seasons.length) return undefined
  // A SEASON LIST THAT IS A PREFIX SAYS NOTHING ABOUT WHICH SEASON HOLDS THE RUN: the run's own season
  // may be one of the ones that never came back, and the picker would then hand the run the earliest
  // season sharing its year. The same refusal `assembleMedia` makes for a season a prefix never showed
  // (:775), and reachable the same way: Netflix's landing query caps the SEASON list at ten whenever
  // unOGS is the one that could not answer, so One Piece answers ten of its forty.
  if (listing.truncated) return undefined
  const verdict = pickContainingSeason(input, netflixCandidates(listing.seasons, detail.year))
  if (!verdict) return undefined
  console.warn(`similarMedia: nf season ${verdict.season.season} of ${input.showId} holds this run by ${verdict.rule} (${verdict.theirs} episodes over ${verdict.ours})`)
  const picked = await withNetflixEpisodes(listing, verdict.season.season, ctx)
  return assembleMedia(detail, await fetchBgImages(input.showId, ctx), picked, verdict.season.season)
}

/**
 * The Netflix media a cluster may link to: its season as a RUN, or the whole title as a CONTAINER.
 *
 * Exported for tests/unit/sources/unogs/extractor.test.ts. A film is itself, since it has no seasons to be confused between.
 * The container carries no episode list: every media in this store is one run, and a show's episodes
 * flattened across seasons collide on episodeNumber (crunchyroll/extractor.ts records the measurement).
 * `vtype` and `year` are the search payload's when the caller has it, which saves the detail request.
 */
export const linkNetflix = async (
  nfId: string,
  aggregatedUri: string,
  ctx: ExtractorServerContext,
  vtype?: string,
  year?: number | string | null
): Promise<GQLMedia | undefined> => {
  const detail = vtype === undefined ? (await fetchDetail(nfId, ctx))[0] : undefined
  const kind = vtype ?? detail?.vtype
  if (kind !== 'series') return getMedia(nfId, ctx, undefined, true)
  const match = await matchNetflixSeason(nfId, aggregatedUri, ctx, year ?? detail?.year)
  if (!match) return undefined
  if (match.kind === 'season') return getMedia(nfId, ctx, match.season, true)
  const title = await getMedia(nfId, ctx, undefined, false)
  if (!title) return undefined
  title.episodes = []
  title.episodeCount = undefined
  return title
}

/**
 * One year of slack, and it is the CATALOGUE's year that gets it.
 *
 * The record's own season-level year axis is exact on both of the places it is written down:
 * `yearAppearsInShow` asks for membership and `similar.ts`'s `yearVetoed` for equality. The slack is
 * here because unOGS publishes a LISTING year rather than a premiere, and a film released late in one
 * year is routinely listed under the next. It buys that one case and nothing else: measured over the
 * recorded season corpus it changes no row, since the nearest refused weld is three years out (The
 * Monkey King 2023 against a 2026 run) and both correct film matches are exact.
 */
const LISTING_YEAR_TOLERANCE = 1

/**
 * The year the cluster asking is FROM, as a date the shared year axis reads, or nothing.
 *
 * `seasonYear` first because it survives a coerced date: a source that knows only the broadcast season
 * carries its year there and leaves `startDate` empty, and `mal:64867` in the corpus is exactly that,
 * a run whose only year anywhere is a seasonYear. Nothing at all is undefined, never a guess.
 *
 * Exported for tests/unit/sources/unogs/search-year.test.ts, which measures the gate below over the
 * recorded corpus and has to read a run's year the same way this file does.
 */
export const runYearDate = (
  known: { seasonYear?: number | null, startDate?: string | null } | null | undefined
): string | undefined =>
  known?.seasonYear ? `${known.seasonYear}-01-01` : known?.startDate ?? undefined

/**
 * The DATE half of the search gate: a film whose own year is not the asking run's is a different work.
 *
 * Measured on the recorded summer-2026 season corpus (223 runs, `tests/corpus/`): the search welds a
 * bare Netflix title id into 16 runs whose hand-checked labels say the two are different works. Every
 * one of them clears the title axis and clears the category veto, both of which are about the title
 * and nothing else, and what the sixteen share is a year nobody read. Hollow Man (2000) taken for
 * Potato Man, Indiana Jones and the Last Crusade (1989) for a 2026 Avatar film, The Monkey King (2023)
 * for the 2026 anime of that name, The 40-Year-Old Virgin (2005) for Cherry and Virgin, the two 2012
 * Madoka compilation films for the 2026 fourth one. Fourteen of the sixteen are films carrying their
 * own year and are refused here, 3 to 43 years out. The other two are season picks on a SERIES, which
 * this gate does not judge and cannot: see below.
 *
 * TITLE PICKS THE SHOW, DATE PICKS THE RUN, the rule every other catalogue gate in this tree already
 * runs on (../catalogue-gate.ts). Nothing about the title axis moved to make room for this:
 * TITLE_MATCH_THRESHOLD stays 0.44, calibrated over 243194 correct pairs against 139507 wrong ones,
 * and no threshold could have caught these anyway. Scored with the runs' own recorded titles, The
 * Monkey King reaches 0.7164 against Monkey King and the Madoka compilation 0.7021 against the fourth
 * film, both of them ABOVE the 0.505 that "Cowboy Bebop" scores against "Cowboy Bebop: The Movie",
 * the correct match the threshold is pinned on. There is no number on this axis that separates them.
 *
 * FILMS ONLY, and that is what the payload MEANS rather than caution. unOGS publishes one year per
 * title. On a film that year is the work's. On a series it is the whole TITLE's, which is its first
 * season's, so read as this run's year it would veto the very season that holds the run:
 * `netflixCandidates` below offers it to season 1 alone for exactly that reason, and
 * `yearAppearsInShow` carries what a show-level year does to season-to-parent links (admits 16.543%
 * where season-level membership admits 93.221%).
 *
 * REFUSED BEFORE THE RANKING, never after. `pickTitleMatch` keeps the best scorer, so a wrongly dated
 * candidate left in the list can outscore the right one and take the link with it.
 *
 * SILENCE NEVER BLOCKS. A candidate with no year, or a run whose cluster names no year yet, passes
 * exactly as before: a refusal on absent evidence would drop the link for every run whose date has not
 * landed on the tick its title did, and `graph.link` has no inverse in either direction.
 */
export const filmDatedAnotherYear = (
  result: Pick<UnogsSearchResult, 'vtype' | 'year'>,
  runDate: string | null | undefined
): boolean => {
  if (result.vtype !== 'movie' || !runDate) return false
  // the detail endpoint serves this year as a string where the search payload types it as a number,
  // which is why `netflixCandidates` coerces it too
  const listed = Number(result.year)
  if (!listed) return false
  return !yearAppearsInShow(
    runDate,
    Array.from({ length: LISTING_YEAR_TOLERANCE * 2 + 1 }, (_, index) => listed - LISTING_YEAR_TOLERANCE + index)
  )
}

const searchAndLinkMedia = async (
  title: string,
  aggregatedUri: string,
  ctx: ExtractorServerContext,
  categories?: readonly string[] | null,
  runDate?: string
): Promise<GQLMedia | null> => {
  for (const query of [title, ...simplifyTitle(title)]) {
    const { results = [] } = await searchApi(query, ctx)
    if (!results.length) continue
    // gate BEFORE linkNetflix, which is up to four requests spent on a hit that may
    // name nothing we asked for. The search response already carries everything the gate reads.
    const match = await pickTitleMatch(
      query,
      results.filter(result => !filmDatedAnotherYear(result, runDate)).map(result => ({
        result,
        // the search payload leaves the title html-escaped, and normalizeSearchResult is the only place
        // that decoded it, so a raw compare would put `&amp;` against `&`
        title: decode(result.title),
        categories: result.vtype === 'movie' ? ['MOVIE'] : ['SERIES'],
      })),
      categories
    )
    if (!match) continue
    const nfId = String(match.result.nfid)
    const media = await linkNetflix(nfId, aggregatedUri, ctx, match.result.vtype, match.result.year)
    if (!media) continue
    media.handles = buildHandlesFromUri(aggregatedUri, origin)
    return media
  }
  return null
}

/**
 * One of this source's own ids split back into the Netflix title id and the season ordinal, if any.
 *
 * `nf:<show>-<n>` is what the season rewrite in `assembleMedia` mints, and the suffix is OURS: unOGS
 * has never heard of it and answers HTTP 200 with body `{}` for any id it cannot parse, ours included
 * (measured 2026-09-12: `?netflixid=80987039-3` gives `{}`, where an unknown numeric id gives `[]`).
 * `{}` is not the episodes payload, so it reads as a failure rather than as an answer. EVERY path that
 * asks an upstream about a stored id therefore splits it here first, or it spends a call to learn
 * nothing and serves no episodes for a season that has them.
 */
const splitSeasonId = (id: string): { showId: string, season?: number } => {
  const dash = id.indexOf('-')
  if (dash === -1) return { showId: id }
  const season = Number(id.slice(dash + 1))
  return { showId: id.slice(0, dash), season: Number.isFinite(season) ? season : undefined }
}

const resolveMedia = async (uri: string, ctx: ExtractorServerContext): Promise<GQLMedia | null> => {
  const nfUri = extractAggregatedUriOrigin(uri, origin)
  if (nfUri) {
    // nfUri.id may carry a season suffix (e.g. '81726714-2') from a previous aggregation
    const { showId: nfId, season: existingSeason } = splitSeasonId(nfUri.id)
    // only the aggregated path attaches handles below, so only it can weld and only it must refuse
    const media = existingSeason != null || !isAggregatedUri(uri)
      ? await getMedia(nfId, ctx, existingSeason, isAggregatedUri(uri))
      : await linkNetflix(nfId, uri, ctx)
    if (!media) return null
    if (isAggregatedUri(uri)) media.handles = buildHandlesFromUri(uri, origin)
    return media
  }
  if (!isAggregatedUri(uri)) return null
  // the whole media, not just its title, because the format gate needs its categories, the date gate
  // its year, and a second waitForMedia would race the first
  const known = await waitForMedia(uri, ctx, m => (getFirstTitle(m) ? m : undefined), 30_000)
  const title = getFirstTitle(known)
  if (!title) return null
  // the wait is still on the TITLE alone, because the year is read as evidence and never as a
  // requirement: a cluster that publishes its year a tick later loses the date axis for this call, and
  // a wait that demanded one would lose the link outright for every run that never carries one
  return searchAndLinkMedia(title, uri, ctx, known?.categories, runYearDate(known))
}

export const resolvers: Resolvers = {
  Subscription: {
    similarMedia: {
      // always yield once: a generator that completes without yielding makes yoga respond 204 and the
      // caller waits out its timeout instead of reading the refusal
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        yield { similarMedia: await similarSeason(input, ctx) ?? null }
      }
    },
    // asked ONLY after `similarMedia` answered null (`containingOutcome` in worker/extractor.ts), so
    // the second walk of the same title is spent only on a run no season of ours is
    containingMedia: {
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        yield { containingMedia: await containingSeason(input, ctx) ?? null }
      }
    },
    media: {
      subscribe: async function* (_, { input: { uri: _uri } }, ctx: ExtractorServerContext) {
        if (!_uri || !(isUri(_uri) || isAggregatedUri(_uri))) return yield { media: null }
        yield { media: await resolveMedia(_uri, ctx) }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        yield { mediaPage: { nodes: await searchNodes(search, ctx) } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      if (isMovie(parent)) return [normalizeMovieAsEpisode(parent)]
      // `parent.id` is one of this source's own ids, so a season-scoped media's is `<show>-<n>`: it is
      // split before asking anyone (see `splitSeasonId`) and the answer is filtered back down to that
      // one season, because a RUN may never list another season's episodes.
      const { showId, season: seasonNumber } = splitSeasonId(parent.id)
      const { seasons } = await fetchEpisodes(showId, ctx, seasonNumber)
      const filtered = seasonNumber != null ? seasons.filter(season => season.season === seasonNumber) : seasons
      return filtered.flatMap(season =>
        season.episodes.map((ep, i) => normalizeEpisode(ep, parent.uri, i + 1))
      )
    }
  }
}
