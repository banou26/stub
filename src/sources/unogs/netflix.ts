// Netflix's OWN data endpoint: the one www.netflix.com's public title pages call for their season and
// episode lists. It is NOT a documented or supported API, nobody publishes a contract for it, and it
// can change shape or disappear without notice. Everything below is written so that a change says so
// instead of quietly becoming an empty answer, because an empty answer here reads as "this title has
// no episodes" and that claim welds runs together downstream.
//
// Measured 2026-09-12 against www.netflix.com, anonymous, no cookie: HTTP 200, 41 KB, 0.52 to 0.54 s
// over five runs. CORS is open (OPTIONS answers 200 with access-control-allow-origin: *, and a POST
// carrying Origin: https://stub.moe is answered with that origin reflected), so a browser can make
// this call.
//
// AND IT HAS TO BE THE BROWSER THAT MAKES IT. Netflix answers per COUNTRY, about the address the
// request came from, so its `ctx.fetch` must not go through the FKN relay: the relay would answer
// correctly about the relay's country and the page is about the viewer's. `src/worker/direct-fetch.ts`
// holds the routing and what asking from the browser costs. Until 2026-09-13 these two calls went over
// the relay and this whole slice published nothing on any page load, while the log read
// `no-episodes-listed`, which named Netflix for a fault that was ours.
import type { ExtractorServerContext } from '../../worker/extractor'

import { languageTags } from '../stream-facts'

/** The endpoint. Public title pages call it unauthenticated; see `fetchNetflixTitle` on credentials. */
export const NETFLIX_GRAPHQL_URL = 'https://www.netflix.com/graphql'

/**
 * The persisted query www.netflix.com sends for a logged-out title page, id and version exactly as
 * Netflix's own bundle spells them (measured 2026-09-12: 217277fd, version 102).
 *
 * WHEN IT GOES STALE, and it will: Netflix edits the query, the server stops recognising this id, and
 * every call is answered `PersistedQueryNotFound`. That arrives as `failure: 'persisted-query-stale'`
 * from `fetchNetflixTitle`, never as a title with no seasons.
 *
 * RECOVERY, which is a read rather than a guess: load a title page on www.netflix.com logged out, find
 * `LodpTitleAndPlansPageQueryDocument` in the page bundle, and read `__meta__.q` off it. The wire
 * format is the `{id, version}` pair that the bundle's `PrePersistedQueryLink` sends, which is exactly
 * the object below. Update both halves together: a right id with a wrong version is refused the same
 * way as a wrong id.
 */
export const NETFLIX_PERSISTED_QUERY = { id: '217277fd-12a1-4816-a5b2-b9d7b9afd4ea', version: 102 }

const OPERATION_NAME = 'LodpTitleAndPlansPageQuery'

/**
 * How many edges one page of this operation holds, measured and not documented anywhere by Netflix.
 *
 * Every season longer than ten answered exactly ten episodes, and One Piece's forty seasons answered
 * exactly ten seasons (2026-09-12, six shows). The operation takes no pagination variable, so there is
 * nothing to ask the rest with: a list that came back AT the cap is a prefix whatever its `pageInfo`
 * says, which is the second half of how `truncated` is read below.
 */
export const NETFLIX_PAGE_SIZE = 10

/**
 * The variables the page sends. Only `videoId` varies; the rest select the image formats and switch
 * off the signup-page extras, and Netflix rejects the operation if any of them is missing.
 */
const variablesFor = (videoId: number) => ({
  videoId,
  opaqueImageFormat: 'JPG',
  transparentImageFormat: 'PNG',
  thumbnailVideoId: 0,
  hasValidThumbnailVideoId: false,
  useBakedInPlayThumbnail: false,
  useFromWatchSupplements: false,
  isModernizedSignup: false
})

/** One episode as Netflix publishes it. `videoId` is the id unogs republishes as `epid`. */
export type NetflixEpisode = {
  videoId: number
  /**
   * Netflix's own position in its own season, undefined when the payload omits it.
   *
   * EVIDENCE ABOUT NETFLIX'S ORDERING, NEVER A CANONICAL EPISODE NUMBER: Netflix's numbering was
   * measured shifted by one against canonical numbering on at least one season, and Netflix also
   * disagrees about where a season begins (it splits Fullmetal Alchemist's single 64 episode run into
   * five seasons and folds Mushoku Tensei's five runs into three).
   */
  number?: number
  title: string
  synopsis?: string
  runtimeSec?: number
  thumbnail?: string
}

/** One season as Netflix publishes it. `videoId` is the id unogs republishes as `seasid`. */
export type NetflixSeasonListing = {
  videoId: number
  /**
   * The ordinal read off Netflix's own season label, undefined when the label names no number
   * ("Limited Series", a localized label). A caller that needs a number should use the season's
   * POSITION in the list rather than inventing one here.
   */
  number?: number
  title: string
  episodes: NetflixEpisode[]
  /**
   * True when `episodes` is a PREFIX of the season rather than the season, so its length is not the
   * season's length. A caller that reads `episodes.length` as an episode count here asserts 10 of 24.
   *
   * This operation caps a season at TEN episodes and takes no pagination variable, so a season longer
   * than ten is truncated by construction and there is nothing to ask for the rest with. Read from
   * `hasNextPage` AND from the measured cap (`isPrefix`), so a payload that stops declaring
   * `pageInfo` cannot arrive as a complete season.
   */
  truncated: boolean
}

/** One Netflix title: the show, its seasons, and how complete that listing is. */
export type NetflixTitle = {
  videoId: number
  /** `movie` for a film and `series` for anything else, the words unOGS' `vtype` uses for the same fact. */
  vtype: 'series' | 'movie'
  title: string
  synopsis?: string
  /** Netflix's `latestYear` for the whole TITLE, which is not any one season's year. */
  year?: number
  seasons: NetflixSeasonListing[]
  /**
   * True when the SEASON list itself is a prefix. A film simply has no seasons, which is not this.
   *
   * The same ten-per-page cap applies to seasons: One Piece answers `totalCount: 40` with ten edges
   * and `hasNextPage: true` (2026-09-12), so a caller asked about season 15 off this listing is
   * asking about a season it cannot see. A season missing from a truncated listing is unknown, never
   * absent, and `extractor.ts`'s `assembleMedia` refuses to mint one rather than publishing zero.
   */
  seasonsTruncated: boolean
  /** The title's audio and subtitle languages, as BCP 47 tags: Netflix lists them per title, never per episode. */
  audioLanguages?: string[]
  subtitleLanguages?: string[]
}

/**
 * Why a call did not produce a title. Each one is a different thing to do about it:
 *
 * - `persisted-query-stale`: Netflix edited the query and `NETFLIX_PERSISTED_QUERY` must be re-read
 *   from their bundle (procedure on that constant). Nothing else will fix it, and every call fails
 *   until it is done.
 * - `http-status`: the endpoint answered a non-success status. Transient or a moved endpoint.
 * - `graphql-errors`: a 200 carrying `errors`, which is how this endpoint reports a rejected
 *   operation. The message is theirs.
 * - `not-netflix`: a 200 that is not this endpoint's answer at all, so nothing in it is a fact about
 *   Netflix. Something between this browser and www.netflix.com answered instead.
 * - `unreadable`: the body IS this endpoint's envelope and is not the shape this file parses, which
 *   is the tell that the payload changed under us.
 * - `unreachable`: the request itself failed (dropped connection, blocked egress).
 */
export type NetflixFailureKind =
  | 'persisted-query-stale'
  | 'http-status'
  | 'graphql-errors'
  | 'not-netflix'
  | 'unreadable'
  | 'unreachable'

/**
 * WHOSE FACT each failure is, in the words that go on the log line.
 *
 * Here because the thing that cost a day was not a missing log, it was a log that said
 * `no-episodes-listed` about a request that never got a Netflix answer at all: the sentence named
 * Netflix and the fault was ours. A caller that prints a `failure` without this prints the same
 * ambiguity in a new place, so the owner of the fact travels with the kind rather than being reasoned
 * out at each call site.
 *
 * Exhaustive by construction (`Record<NetflixFailureKind, string>`): a new kind does not compile until
 * somebody has decided whose fact it is.
 */
export const NETFLIX_FAILURE_FACT: Record<NetflixFailureKind, string> = {
  'persisted-query-stale': "ours: Netflix edited the query and this app's copy of its id is stale",
  'http-status': "Netflix's: their endpoint refused the request",
  'graphql-errors': "Netflix's: their endpoint rejected the operation",
  'not-netflix': 'neither: something between this browser and www.netflix.com answered instead',
  'unreadable': "Netflix's: their payload is no longer the shape this app parses",
  'unreachable': 'ours: the request never arrived at Netflix'
}

/**
 * What one ask came to.
 *
 * `{ ok: true, title: undefined }` is a real answer: Netflix has no such video id. It is deliberately
 * a different value from every failure above, because the whole point of this module is that a
 * failure must never be mistaken for a title with nothing in it.
 */
export type NetflixTitleResult =
  | { ok: true, title: NetflixTitle | undefined }
  | { ok: false, failure: NetflixFailureKind, message: string }

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Json : undefined

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const asNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length ? value : undefined

/** Netflix labels a season rather than numbering it, so the ordinal is read off the label or nothing. */
const labelNumber = (...labels: (string | undefined)[]): number | undefined => {
  for (const label of labels) {
    const digits = label?.match(/\d+/)
    if (digits) return Number(digits[0])
  }
  return undefined
}

const ISO_639_1 = (
  'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu '
  + 'fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km '
  + 'kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om '
  + 'or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr '
  + 'ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
).split(' ')
// the two Netflix names no ISO 639-1 code is called in English
const LANGUAGE_ALIASES: Record<string, string> = { Mandarin: 'zh', Cantonese: 'yue' }
let languageCodes: Map<string, string> | undefined

/**
 * Netflix names a track's language in English rather than coding it ("Japanese [Original]", "Spanish
 * (Latin America)", "Mandarin (Guoyu)"), so the name without its brackets is read back to its code. A
 * name nothing reads is dropped rather than guessed.
 */
const netflixLanguageCode = (name: string): string | undefined => {
  if (!languageCodes) {
    const english = new Intl.DisplayNames(['en'], { type: 'language' })
    languageCodes = new Map(ISO_639_1.map(code => [english.of(code) ?? code, code]))
  }
  const base = name.replace(/\[[^\]]*\]|\([^)]*\)|\s-\s.*$/g, '').trim()
  return LANGUAGE_ALIASES[base] ?? languageCodes.get(base)
}

const trackLanguages = (tracks: unknown): string[] | undefined =>
  languageTags(asArray(tracks).map(track => {
    const name = asString(asRecord(track)?.language)
    return name ? netflixLanguageCode(name) : undefined
  }))

/** An image is only a url when Netflix says it resolved; an unavailable one carries a stale key. */
const imageUrl = (value: unknown): string | undefined => {
  const image = asRecord(value)
  if (!image || image.available === false) return undefined
  return asString(image.url)
}

const parseEpisode = (value: unknown): NetflixEpisode | undefined => {
  const node = asRecord(asRecord(value)?.node)
  const videoId = asNumber(node?.videoId)
  if (!node || videoId === undefined) return undefined
  return {
    videoId,
    number: asNumber(node.number),
    title: asString(node.title) ?? '',
    synopsis: asString(node.shortSynopsis),
    runtimeSec: asNumber(node.runtimeSec),
    thumbnail: imageUrl(node.merchStill300)
  }
}

const parseSeason = (value: unknown): NetflixSeasonListing | undefined => {
  const node = asRecord(asRecord(value)?.node)
  const videoId = asNumber(node?.videoId)
  if (!node || videoId === undefined) return undefined
  const episodes = asRecord(node.episodes)
  const title = asString(node.title) ?? ''
  const parsed = asArray(episodes?.edges).map(parseEpisode).filter((episode): episode is NetflixEpisode => Boolean(episode))
  return {
    videoId,
    number: labelNumber(asString(node.numberLabelV2), asString(node.shortTitle), title),
    title,
    episodes: parsed,
    truncated: Boolean(episodes) && isPrefix(episodes, parsed.length)
  }
}

/**
 * Whether a connection answered a PREFIX of what it holds. Belt and braces, and both halves are load
 * bearing, because reading this wrong publishes ten episodes as a 24 episode season's length.
 *
 * `hasNextPage` is Netflix's own word, so only an explicit `false` is taken as "that is all of it": an
 * absent `pageInfo`, a renamed field or a reshaped connection reads as a prefix rather than silently
 * as a complete list. And a list that came back exactly AT `NETFLIX_PAGE_SIZE` is a prefix whatever
 * the flag says, since that is the measured page and the operation cannot ask for a second one.
 */
const isPrefix = (connection: Json | undefined, count: number): boolean =>
  asRecord(connection?.pageInfo)?.hasNextPage !== false || count >= NETFLIX_PAGE_SIZE

/**
 * The GraphQL envelope off one 200, or a named failure that says whose fact it is.
 *
 * THE ONE THIS EXISTS FOR: a 200 is not a Netflix answer. Anything on the way, and the relay path
 * this app used to send these requests over is one such thing, can answer 200 with a body of its own.
 * Measured 2026-09-13 through that path: `{"error":"rate limit exceeded"}` from one host and a
 * Cloudflare `<!DOCTYPE html><title>Just a moment...` interstitial from another, both HTTP 200. The
 * first parses as JSON and the second does not, and neither is a fact about Netflix.
 *
 * Read as `unreadable` those two would say "Netflix answered a body that is not an object", which
 * names the wrong party and sends the reader to Netflix's payload for a fault that is not in it. So a
 * 200 carrying neither `data` nor `errors` is `not-netflix`, and its first 160 characters travel with
 * it, because what answered instead is the only thing worth reading.
 *
 * `unreadable` keeps its meaning and narrows to it: the envelope IS this endpoint's and the shape
 * inside it changed.
 */
const readEnvelope = async (response: Response): Promise<{ ok: true, body: Json } | { ok: false, failure: NetflixFailureKind, message: string }> => {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return { ok: false, failure: 'unreachable', message: `the answer body could not be read: ${String(error)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, failure: 'not-netflix', message: `a 200 that is not JSON answered for ${NETFLIX_GRAPHQL_URL}: ${preview(text)}` }
  }
  const body = asRecord(parsed)
  // GraphQL's own envelope rule: a response is an object carrying `data`, `errors` or both. Anything
  // else answered in Netflix's place, whatever status it used.
  if (!body || (!('data' in body) && !('errors' in body))) {
    return { ok: false, failure: 'not-netflix', message: `a 200 that is not a GraphQL answer came back for ${NETFLIX_GRAPHQL_URL}: ${preview(text)}` }
  }
  return { ok: true, body }
}

/** The first 160 characters of whatever answered, on one line, so the log line stays one line. */
const preview = (text: string): string =>
  `${text.slice(0, 160).replace(/\s+/g, ' ')}${text.length > 160 ? '...' : ''}`

/**
 * What one 200's `errors` array means, which is NOT "the call failed".
 *
 * THE ONE THAT LOSES A WHOLE SEASON IF READ WRONG: the season operation answers HTTP 200 with
 * PARTIAL errors on every logged-out call, one per episode for `bookmark` and one for
 * `playlistActions`, both of them per-viewer watch state (measured 2026-09-13 on seasons 81392609,
 * 81705182 and 82941638). Every other field is present and complete. An implementation that reads a
 * non-empty `errors` array as a failure throws away all 24 episodes over two fields nobody asked for.
 *
 * So an error is TOLERATED only when it is scoped to a field (`path` names one) and its type is
 * `UNAUTHENTICATED`: the rest of the payload stands, and the field itself is one this app never
 * reads. A top-level `UNAUTHENTICATED` carrying no path is a claim about the whole operation and
 * stays fatal, which is also why this is not a list of the two field names: Netflix adding a third
 * per-viewer field must not become an outage.
 *
 * `stale` is BOTH measured shapes of a persisted query this app can no longer send, which look
 * nothing alike (2026-09-13, both on the season query): a wrong ID answers `PersistedQueryNotFound`
 * with `code: PERSISTED_QUERY_NOT_FOUND`, where a wrong VERSION answers `Gateway Internal Error`
 * with `errorType: INTERNAL` and the only tell buried in
 * `extensions.debugInfo.exception: PersistedQueryValidationException(...)`. Reading the first alone
 * files a stale version under `graphql-errors`, where nobody would think to re-read the constant.
 */
const readErrors = (body: Json): { stale: boolean, fatal: boolean, message: string } => {
  const errors = asArray(body.errors).map(asRecord)
  const stale = errors.some(error => {
    const extensions = asRecord(error?.extensions)
    return extensions?.code === 'PERSISTED_QUERY_NOT_FOUND'
      || extensions?.errorType === 'PERSISTED_QUERY_NOT_FOUND'
      || error?.message === 'PersistedQueryNotFound'
      || (asString(asRecord(extensions?.debugInfo)?.exception) ?? '').includes('PersistedQuery')
  })
  const fatal = errors.filter(error => {
    const extensions = asRecord(error?.extensions)
    const scoped = asArray(error?.path).length > 0
    return !(scoped && (extensions?.errorType === 'UNAUTHENTICATED' || extensions?.code === 'UNAUTHENTICATED'))
  })
  return {
    stale,
    fatal: fatal.length > 0,
    message: (fatal.length ? fatal : errors).map(error => asString(error?.message) ?? 'unnamed error').join('; ')
  }
}

/**
 * Netflix's seasons and episodes for one title id, or a named failure.
 *
 * NO CREDENTIALS, EVER. `credentials: 'omit'` is explicit and load bearing: the call works
 * anonymously, this runs in a browser where the viewer may well be signed in to Netflix, and a
 * request that carried their session would attach their account to a lookup they did not make. The
 * same reason it is not `'include'` like the unogs calls in extractor.ts: those are a public token
 * flow, this is netflix.com's own origin.
 *
 * `x-netflix.context.locales: en` or the titles come back in the geo default language.
 *
 * REFUSES: a stale persisted query, a non-success status, a GraphQL error, a body it cannot parse and
 * a request that never arrived, each as its own `failure` rather than as an empty title. Returns
 * `{ ok: true, title: undefined }` only when Netflix answered and knows no such video id.
 */
export const fetchNetflixTitle = async (videoId: string | number, ctx: ExtractorServerContext): Promise<NetflixTitleResult> => {
  const id = Number(videoId)
  if (!Number.isFinite(id)) return { ok: false, failure: 'unreadable', message: `not a Netflix video id: ${videoId}` }

  let response: Response
  try {
    response = await ctx.fetch(NETFLIX_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-netflix.context.locales': 'en'
      },
      body: JSON.stringify({
        operationName: OPERATION_NAME,
        variables: variablesFor(id),
        extensions: { persistedQuery: NETFLIX_PERSISTED_QUERY }
      }),
      mode: 'cors',
      // the viewer's own Netflix session must never ride along on this: see above
      credentials: 'omit'
    })
  } catch (error) {
    return { ok: false, failure: 'unreachable', message: String(error) }
  }

  // a stubbed Response may omit `ok`, and an absent field is not a claim that the call failed
  if (response.ok === false) return { ok: false, failure: 'http-status', message: `Netflix answered ${response.status}` }

  const envelope = await readEnvelope(response)
  if (!envelope.ok) return envelope
  const body = envelope.body

  // the one error that means OUR query is stale rather than THEIR service being unhappy, and the only
  // one a human has to act on: it is loud here so it cannot be read as "this title has no seasons"
  const { stale, fatal, message } = readErrors(body)
  if (stale) return { ok: false, failure: 'persisted-query-stale', message: `${message}. Re-read NETFLIX_PERSISTED_QUERY from Netflix's page bundle` }
  if (fatal) return { ok: false, failure: 'graphql-errors', message }

  const data = asRecord(body.data)
  if (!data) return { ok: false, failure: 'unreadable', message: 'Netflix answered no data' }
  // an EMPTY list is "no such video id"; anything that is not a list at all is the payload having
  // changed shape, and reading that as an unknown id is the one place this module's own tell would be
  // swallowed: `{ ok: true, title: undefined }` is indistinguishable from a genuine miss
  if (!Array.isArray(data.videos)) return { ok: false, failure: 'unreadable', message: 'Netflix answered no videos list' }
  const video = asRecord(data.videos[0])
  if (!video) return { ok: true, title: undefined }
  const videoIdOut = asNumber(video.videoId)
  if (videoIdOut === undefined) return { ok: false, failure: 'unreadable', message: 'Netflix answered a video with no videoId' }

  const seasons = asRecord(video.seasons)
  const parsedSeasons = asArray(seasons?.edges).map(parseSeason).filter((season): season is NetflixSeasonListing => Boolean(season))
  const tracks = asRecord(video.mediaTracks)
  return {
    ok: true,
    title: {
      videoId: videoIdOut,
      vtype: video.__typename === 'Movie' ? 'movie' : 'series',
      title: asString(video.title) ?? '',
      synopsis: asString(video.shortSynopsis),
      year: asNumber(video.latestYear),
      seasons: parsedSeasons,
      // a film carries no seasons connection at all, which is not a prefix of anything
      seasonsTruncated: Boolean(seasons) && isPrefix(seasons, parsedSeasons.length),
      audioLanguages: trackLanguages(tracks?.audioTracks),
      subtitleLanguages: trackLanguages(tracks?.subtitles),
    }
  }
}

/**
 * The persisted query Netflix's own preview modal sends for ONE season's episode list, id and version
 * exactly as their bundle spells them (measured 2026-09-13: 4cf0a279, version 102).
 *
 * THIS IS THE EPISODE SOURCE, where `NETFLIX_PERSISTED_QUERY` above is the season INDEX. The landing
 * query answers ten episodes of a 24 episode season and takes no pagination variable; this one
 * answers the whole season, pages, and carries a real still and a real synopsis per episode. unOGS
 * republishes neither well: one placeholder image repeated across a season (231 of its 276 image
 * pairs near-identical, against 0 of 45 here) and 4 synopses of 24 against 24 of 24.
 *
 * WHEN IT GOES STALE, the same way and with the same tell as the other: `fetchNetflixSeasonEpisodes`
 * answers `failure: 'persisted-query-stale'`, never a season with no episodes.
 *
 * RECOVERY, a read rather than a guess: open a title page on www.netflix.com logged out, open the
 * preview modal's episode selector, and read the `extensions.persistedQuery` object off the POST to
 * /graphql whose `operationName` is the one below. In the bundle it is
 * `PreviewModalEpisodeSelectorSeasonEpisodesQueryDocument`'s `__meta__.q`. Update both halves
 * together: a right id with a wrong version is refused, differently (see `readErrors`).
 */
export const NETFLIX_SEASON_QUERY = { id: '4cf0a279-dd32-454d-9758-486359c0d48b', version: 102 }

const SEASON_OPERATION_NAME = 'PreviewModalEpisodeSelectorSeasonEpisodes'

/**
 * How many episodes one page of the season operation is asked for. 40 covers every season measured in
 * one request; the pagination below exists for the ones it will not.
 */
export const NETFLIX_SEASON_PAGE_SIZE = 40

/**
 * How many pages one season may cost, so a server that never stops saying `hasNextPage` cannot spin
 * this loop forever. 20 pages is 800 episodes, past every Netflix season there is.
 */
const NETFLIX_SEASON_MAX_PAGES = 20

/**
 * The variables the preview modal sends. `artworkContext: {}` and the image format are required (the
 * operation is refused without them), and `cursor` is the pagination variable.
 *
 * IT IS `cursor`, NOT `after`, and getting that wrong does not fail: measured 2026-09-13 on season
 * 82941638 with `count: 5`, a second request carrying `after: <endCursor>` answered THE SAME FIVE
 * episodes with the same `endCursor` and `hasNextPage: true`, where `cursor: <endCursor>` answered
 * the next five. An unknown variable is ignored in silence, so a loop written against `after` reads
 * page one forever. `fetchNetflixSeasonEpisodes` refuses to loop on a page that brought nothing new
 * for exactly that reason.
 */
const seasonVariablesFor = (seasonId: number, cursor?: string) => ({
  seasonId,
  count: NETFLIX_SEASON_PAGE_SIZE,
  opaqueImageFormat: 'WEBP',
  artworkContext: {},
  ...(cursor === undefined ? {} : { cursor })
})

/**
 * An episode STILL, or nothing, gated on Netflix's own key.
 *
 * The season payload's field is the generic `artwork` rather than the landing query's `merchStill300`,
 * so the field name asserts nothing about what the image IS and the key is the only thing that does.
 * Measured 2026-09-13: season 82941638's episode 12 carries `SHORT_PANEL|...`, a promotional panel
 * rather than a frame of the episode, where its other eleven carry `MERCH_STILL|...`. Published as a
 * thumbnail it is simply a wrong picture on one row.
 */
const stillUrl = (value: unknown): string | undefined => {
  const image = asRecord(value)
  if (!image || image.available === false) return undefined
  if (!(asString(image.key) ?? '').startsWith('MERCH_STILL')) return undefined
  return asString(image.url)
}

const parseSeasonEpisode = (value: unknown): NetflixEpisode | undefined => {
  const node = asRecord(asRecord(value)?.node)
  const videoId = asNumber(node?.videoId)
  if (!node || videoId === undefined) return undefined
  return {
    videoId,
    number: asNumber(node.number),
    title: asString(node.title) ?? '',
    synopsis: asString(asRecord(node.contextualSynopsis)?.text),
    runtimeSec: asNumber(node.runtimeSec) ?? asNumber(node.displayRuntimeSec),
    thumbnail: stillUrl(node.artwork)
  }
}

/**
 * One season's episodes, or a named failure.
 *
 * `truncated` is true when the season is longer than what came back: the page cap was reached, or a
 * page declared `hasNextPage` and then brought nothing this loop had not already seen. It is never
 * true because a season is short. A caller must not publish `episodes.length` as a count when it is
 * set (extractor.ts's `NetflixSeason.truncated` carries what that costs).
 */
/**
 * Why a SUCCESSFUL season answer carried no episodes, which is a different fact from a failure and
 * was invisible until 2026-09-13.
 *
 * Netflix answers HTTP 200 with a well formed body in all three shapes, so none is an error and none
 * may take a season down; but they send the reader to different places, and a caller that only sees an
 * empty array reads them as the same silence. Measured that day on Mushoku Tensei: season 82941638
 * answered `EpisodesConnection {edges: [], pageInfo: {hasNextPage: false}}` and season 82984815
 * answered `videos: [null]`.
 *
 * EVERY ONE OF THESE IS A FACT ABOUT ONE COUNTRY, which is the thing that was missed for a day.
 * Netflix answers about the address that asked, so the same two seasons above answered 12 and 11
 * episodes from Tokyo on the same afternoon they answered nothing from Hong Kong. `not-in-this-
 * catalogue` is the case where Netflix says so in as many words (`parentShow.isAvailable: false`), and
 * it is the reason `src/worker/direct-fetch.ts` exists: the question is about the viewer's country, so
 * the viewer's browser has to be the one asking.
 */
export type NetflixSeasonEmpty = 'no-such-season' | 'not-in-this-catalogue' | 'no-episodes-listed'

/**
 * WHOSE FACT each empty answer is, the same contract as `NETFLIX_FAILURE_FACT` and for the same
 * reason: `no-episodes-listed` on its own reads as a statement about Netflix's catalogue, and the day
 * it was read that way it was a statement about which address the request left from.
 *
 * Exhaustive by construction: a new shape does not compile until somebody has decided whose it is.
 */
export const NETFLIX_EMPTY_FACT: Record<NetflixSeasonEmpty, string> = {
  'no-such-season': "Netflix's, for the country this request came from: they list no season under that id",
  'not-in-this-catalogue': "Netflix's, for the country this request came from: they say the show is not available in it",
  'no-episodes-listed': "Netflix's: the season is in this country's catalogue and lists no episodes"
}

export type NetflixSeasonEpisodesResult =
  | { ok: true, episodes: NetflixEpisode[], truncated: boolean, empty?: NetflixSeasonEmpty }
  | { ok: false, failure: NetflixFailureKind, message: string }

type SeasonPage =
  | { ok: true, episodes: NetflixEpisode[], hasNextPage: boolean, endCursor?: string, empty?: NetflixSeasonEmpty }
  | { ok: false, failure: NetflixFailureKind, message: string }

const fetchSeasonPage = async (seasonId: number, cursor: string | undefined, ctx: ExtractorServerContext): Promise<SeasonPage> => {
  let response: Response
  try {
    response = await ctx.fetch(NETFLIX_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-netflix.context.locales': 'en'
      },
      body: JSON.stringify({
        operationName: SEASON_OPERATION_NAME,
        variables: seasonVariablesFor(seasonId, cursor),
        extensions: { persistedQuery: NETFLIX_SEASON_QUERY }
      }),
      mode: 'cors',
      // the viewer's own Netflix session must never ride along on this: see `fetchNetflixTitle`
      credentials: 'omit'
    })
  } catch (error) {
    return { ok: false, failure: 'unreachable', message: String(error) }
  }

  // a stubbed Response may omit `ok`, and an absent field is not a claim that the call failed
  if (response.ok === false) return { ok: false, failure: 'http-status', message: `Netflix answered ${response.status}` }

  const envelope = await readEnvelope(response)
  if (!envelope.ok) return envelope
  const body = envelope.body

  const { stale, fatal, message } = readErrors(body)
  if (stale) return { ok: false, failure: 'persisted-query-stale', message: `${message}. Re-read NETFLIX_SEASON_QUERY from Netflix's page bundle` }
  if (fatal) return { ok: false, failure: 'graphql-errors', message }

  const data = asRecord(body.data)
  if (!data) return { ok: false, failure: 'unreadable', message: 'Netflix answered no data' }
  if (!Array.isArray(data.videos)) return { ok: false, failure: 'unreadable', message: 'Netflix answered no videos list' }
  // an empty list is "no such season id", which is an answer of no episodes rather than a failure
  const season = asRecord(data.videos[0])
  if (!season) return { ok: true, episodes: [], hasNextPage: false, empty: 'no-such-season' }
  const episodes = asRecord(season.episodes)
  if (!episodes) return { ok: false, failure: 'unreadable', message: 'Netflix answered a season with no episodes connection' }
  const pageInfo = asRecord(episodes.pageInfo)
  const parsed = asArray(episodes.edges).map(parseSeasonEpisode).filter((episode): episode is NetflixEpisode => Boolean(episode))
  // Netflix's own word on whether the show is in the asking address's catalogue, which is what tells
  // an empty season apart from a season the asker is not allowed to see. Measured 2026-09-13 on
  // 82941638: `false` with zero edges from Hong Kong, `true` with twelve from Tokyo, same minute.
  const unavailableHere = asRecord(season.parentShow)?.isAvailable === false
  return {
    ok: true,
    episodes: parsed,
    // the season exists and listed nothing, which the caller must be able to tell from the shape above
    ...(parsed.length ? {} : { empty: (unavailableHere ? 'not-in-this-catalogue' : 'no-episodes-listed') as NetflixSeasonEmpty }),
    // only an explicit `false` is taken as "that is all of it", the same reading `isPrefix` uses: a
    // renamed or absent `pageInfo` must read as more to come rather than as a complete season
    hasNextPage: pageInfo?.hasNextPage !== false,
    endCursor: asString(pageInfo?.endCursor)
  }
}

/**
 * Every episode of one Netflix SEASON, by the season's own video id (unOGS republishes it as `seasid`
 * and the landing query answers it as `seasons.edges[].node.videoId`).
 *
 * NO CREDENTIALS, EVER, for the reason on `fetchNetflixTitle`: the call works anonymously and the
 * viewer may well be signed in to Netflix in the browser this runs in.
 *
 * PARTIAL ERRORS ARE SUCCESS. Every logged-out call answers 200 with one `UNAUTHENTICATED` error per
 * episode for `bookmark` and `playlistActions`, and the season is complete beside them (`readErrors`).
 *
 * REFUSES: a stale persisted query, a non-success status, a GraphQL error that is not per-viewer
 * watch state, a body it cannot parse, and a request that never arrived, each as its own `failure`.
 * Returns `{ ok: true, episodes: [] }` when Netflix knows no such season id, which is an answer.
 */
export const fetchNetflixSeasonEpisodes = async (seasonId: string | number, ctx: ExtractorServerContext): Promise<NetflixSeasonEpisodesResult> => {
  const id = Number(seasonId)
  if (!Number.isFinite(id)) return { ok: false, failure: 'unreadable', message: `not a Netflix season id: ${seasonId}` }

  const episodes: NetflixEpisode[] = []
  const seen = new Set<number>()
  let cursor: string | undefined
  for (let page = 0; page < NETFLIX_SEASON_MAX_PAGES; page += 1) {
    const answer = await fetchSeasonPage(id, cursor, ctx)
    if (!answer.ok) return answer
    const fresh = answer.episodes.filter(episode => !seen.has(episode.videoId))
    for (const episode of fresh) seen.add(episode.videoId)
    episodes.push(...fresh)
    if (!answer.hasNextPage) return { ok: true, episodes, truncated: false, ...(episodes.length ? {} : { empty: answer.empty }) }
    // a page that declares more and delivers nothing new is the ignored-variable trap (see
    // `seasonVariablesFor`): stop, and say the season is longer than this rather than looping
    if (!answer.endCursor || answer.endCursor === cursor || !fresh.length) return { ok: true, episodes, truncated: true }
    cursor = answer.endCursor
  }
  return { ok: true, episodes, truncated: true }
}
