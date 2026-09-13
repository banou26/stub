import type { ExtractorServerContext } from '../../worker/extractor'
import type { Resolvers, Media as GQLMedia, Episode as GQLEpisode, SimilarMediaInput } from '../../generated/schema/types.generated'
import { extractAggregatedUriOrigin, fromAggregatedUri, isAggregatedUri, isUri } from '../../utils/uri'
import { SEASON_DATE_WINDOW } from '../catalogue-gate'
import { isOnlySeasonLabel } from '../season'
import { pickSimilarSeason, type RunEvidence, type SeasonCandidate } from '../similar'
import {
  makeMedia, makeEpisode, desc, img,
  bestTitleScore, buildHandlesFromUri, getFirstTitle, simplifyTitle, waitForMedia
} from '../utils'

const SCORE = 0.5

export const icon = 'https://static.crunchyroll.com/cxweb/assets/img/favicons/favicon-96x96.png'
export const originUrl = 'https://www.crunchyroll.com'
export const categories = ['ANIME', 'SERIES'] as const
export const name = 'Crunchyroll'
export const origin = 'cr'
export const official = true
export const metadataOnly = false
export const isApiOnly = false
export const supportedUris = ['cr']

type Token = { timestamp: number, access_token: string, expires_in: number }
let _token: Token | undefined
let _tokenPromise: Promise<Token> | undefined

const getToken = async (ctx: ExtractorServerContext): Promise<Token> => {
  if (_token && Date.now() - _token.timestamp < _token.expires_in * 1000) return _token
  if (_tokenPromise) return _tokenPromise
  _tokenPromise = (async () => {
    const res = await ctx.fetch('https://www.crunchyroll.com/auth/v1/token', {
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization: `Basic ${btoa('cr_web:')}`,
        'content-type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_id',
      method: 'POST',
      mode: 'cors',
      credentials: 'include'
    }).then(r => r.json())
    if (!res.access_token) throw new Error(`Crunchyroll token fetch failed: ${JSON.stringify(res)}`)
    return (_token = { timestamp: Date.now(), access_token: res.access_token, expires_in: res.expires_in })
  })().finally(() => { _tokenPromise = undefined })
  return _tokenPromise
}

const _inflight = new Map<string, Promise<unknown>>()

const api = async <T>(url: string, ctx: ExtractorServerContext): Promise<T> => {
  const existing = _inflight.get(url)
  if (existing) return existing as Promise<T>
  const promise = getToken(ctx).then(token =>
    ctx.fetch(url, {
      headers: {
        accept: 'application/json, text/plain, */*',
        authorization: `Bearer ${token.access_token}`
      },
      mode: 'cors',
      credentials: 'include'
    }).then(r => r.json() as T)
  )
  _inflight.set(url, promise)
  // `.finally` mints a second promise that rejects when this one does, and nobody awaits it: a failed
  // request surfaced as an unhandled rejection on top of the one the caller got (2026-09-05)
  const forget = () => { _inflight.delete(url) }
  promise.then(forget, forget)
  return promise
}

interface CrSeries {
  id: string
  title: string
  slug_title: string
  description: string
  images: { poster_tall?: { source: string }[][], poster_wide?: { source: string }[][] }
  series_metadata?: { episode_count: number, series_launch_year?: number }
}

interface CrSeason {
  id: string
  title: string
  description: string
  audio_locale: string
  versions?: { audio_locale: string, guid: string, original: boolean }[]
}

interface CrEpisode {
  id: string
  title: string
  description: string
  episode_number: number
  season_number: number
  season_id: string
  series_id: string
  sequence_number: number
  episode_air_date: string
  images?: { thumbnail?: { source: string }[][] }
}

const CMS = 'https://www.crunchyroll.com/content/v2/cms'

// Crunchyroll's error body (`{ __class__: 'error', code: 'rate_limited' }` on a 429) carries no `data`.
// Read as an empty list it was an ANSWER about the show: three such bodies described three seasons of
// zero episodes, the walk refused, the cache served that for ten minutes and the consumer recorded the
// refusal for the session (2026-09-05). An empty `data` is still a real answer: an unknown series, a
// seasonless one, a season with nothing listed.
const dataOf = <T>(res: { data?: T[] } | undefined, url: string): T[] => {
  const data = res?.data
  if (!Array.isArray(data)) throw new Error(`Crunchyroll answered ${url} with no data: ${JSON.stringify(res)?.slice(0, 200)}`)
  return data
}

const fetchList = <T>(url: string, ctx: ExtractorServerContext) =>
  api<{ data?: T[] }>(url, ctx).then(res => ({ data: dataOf(res, url) }))

const fetchSeries = (id: string, ctx: ExtractorServerContext) =>
  fetchList<CrSeries>(`${CMS}/series/${id}?preferred_audio_language=ja-JP&locale=en-US`, ctx)

const fetchSeasons = (id: string, ctx: ExtractorServerContext) =>
  fetchList<CrSeason>(`${CMS}/series/${id}/seasons?force_locale=&preferred_audio_language=ja-JP&locale=en-US`, ctx)

const fetchEpisodes = (seasonId: string, ctx: ExtractorServerContext) =>
  fetchList<CrEpisode>(`${CMS}/seasons/${seasonId}/episodes?preferred_audio_language=ja-JP&locale=en-US`, ctx)

const searchSeries = (query: string, ctx: ExtractorServerContext) =>
  api<{ data?: { type: string, items: CrSeries[] }[] }>(
    `https://www.crunchyroll.com/content/v2/discover/search?q=${encodeURIComponent(query)}&n=50&type=series&locale=en-US`,
    ctx
  ).then(res => ({ data: res?.data ?? [] }))

export const resolveEpisodeToSeriesId = async (
  episodeId: string,
  ctx: ExtractorServerContext
) => {
  const res = await api<{ data: { episode_metadata?: { series_id: string, season_id: string } }[] }>(
    `${CMS}/objects/${episodeId}?ratings=true&locale=en-US`, ctx
  )
  const meta = res.data?.[0]?.episode_metadata
  return meta?.series_id ? { seriesId: meta.series_id, seasonId: meta.season_id } : undefined
}

const stripLocale = (id: string) => id.replace(/JAJP$/, '')

const resolveSeasonId = (season: CrSeason): string =>
  season.versions?.find(v => v.audio_locale === 'ja-JP')?.guid
  ?? season.versions?.find(v => v.original)?.guid
  ?? stripLocale(season.id)

export const crunchyrollId = (seriesId: string, seasonId?: string, episodeId?: string) =>
  [seriesId, seasonId && stripLocale(seasonId), episodeId].filter(Boolean).join('-')

// Crunchyroll's API hands image `source` urls on www.crunchyroll.com/imgsrv/display/<kind>/<WxH>/<key>,
// and that host answers a geo-blocked location (Japan, measured 2026-09-05) with a 301 to its
// "currently unavailable" page, which a browser refuses to embed as an image: every episode thumbnail
// of a season blank. The same key on the CDN host behind Cloudflare's image resizer answered 200 for
// every asset checked. The display url's width becomes the resize width.
const WWW_IMAGE = /^https?:\/\/www\.crunchyroll\.com\/imgsrv\/display\/[^/]+\/(\d+)x\d+\/(.+)$/
export const cdnImageUrl = (url: string): string => {
  const match = url.match(WWW_IMAGE)
  return match ? `https://imgsrv.crunchyroll.com/cdn-cgi/image/fit=contain,format=auto,quality=85,width=${match[1]}/${match[2]}` : url
}

const bestImage = (images?: { source: string }[][]) => {
  const source = images?.at(-1)?.at(-1)?.source
  return source ? cdnImageUrl(source) : source
}

// An id with no season segment is the bare series id, which Crunchyroll shares across every season,
// so it names the SHOW. It enters the store as a CONTAINER and never a run's identity space: the
// bare cr:G24H1N3MP fuzzy merged into Mushoku Tensei season 1's cluster on the search path is what
// welded season 1 to season 3 on the live site. Anything carrying a season segment is one run.
const scopeOf = (id: string, series: CrSeries) => id === series.id ? 'CONTAINER' as const : 'RUN' as const

const normalizeMedia = (id: string, title: string, description: string, series: CrSeries, episodeCount?: number): GQLMedia =>
  makeMedia({
    origin,
    id,
    scope: scopeOf(id, series),
    url: `https://www.crunchyroll.com/series/${series.id}/${series.slug_title}`,
    score: SCORE,
    categories: ['ANIME', 'SERIES'],
    titles: [{ language: 'en', title, score: SCORE }],
    ...desc(description, SCORE),
    covers: img(bestImage(series.images?.poster_tall), SCORE),
    banners: img(bestImage(series.images?.poster_wide), SCORE),
    // launch year is the series premiere, only valid on the series-level media, not seasons
    startDate: id === series.id && series.series_metadata?.series_launch_year
      ? `${series.series_metadata.series_launch_year}-01-01`
      : undefined,
    episodeCount
  })

const normalizeEpisode = (ep: CrEpisode, mediaUri: string): GQLEpisode =>
  makeEpisode({
    origin,
    id: crunchyrollId(ep.series_id, ep.season_id, ep.id),
    mediaUri,
    url: `https://www.crunchyroll.com/watch/${ep.id}`,
    score: SCORE,
    titles: [{ language: 'en', title: ep.title, score: SCORE }],
    ...desc(ep.description, SCORE),
    thumbnails: img(bestImage(ep.images?.thumbnail), SCORE),
    seasonNumber: ep.season_number,
    episodeNumber: ep.episode_number,
    absoluteEpisodeNumber: ep.sequence_number,
    releaseDate: ep.episode_air_date ? new Date(ep.episode_air_date).toISOString() : undefined
  })

// regular episodes come after specials in CR's ordering, so the last per episode_number wins
/** Keep only the last episode per episode_number (regular episodes come after specials in CR's ordering) */
const deduplicateEpisodes = (episodes: GQLEpisode[]): GQLEpisode[] => {
  const lastByNumber = new Map<number, GQLEpisode>()
  for (const ep of episodes) {
    if (ep.episodeNumber != null) lastByNumber.set(ep.episodeNumber, ep)
  }
  return episodes.filter(ep => ep.episodeNumber == null || lastByNumber.get(ep.episodeNumber) === ep)
}

const fetchNormalizedEpisodes = async (seasonId: string, mediaUri: string, ctx: ExtractorServerContext) => {
  const { data } = await fetchEpisodes(seasonId, ctx)
  return deduplicateEpisodes(data.map(ep => normalizeEpisode(ep, mediaUri)))
}

const findSeason = (seasons: CrSeason[], seasonId: string) =>
  seasons.find(s => stripLocale(s.id) === seasonId || resolveSeasonId(s) === seasonId)

export const getMedia = async (id: string, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const [seriesId, seasonId] = id.split('-')
  if (!seriesId) return undefined

  const [seriesRes, seasonsRes] = await Promise.all([fetchSeries(seriesId, ctx), fetchSeasons(seriesId, ctx)])
  const series = seriesRes.data[0]
  if (!series) return undefined

  const seasons = seasonsRes.data
  const targetSeason = seasonId
    ? findSeason(seasons, seasonId)
    : seasons.length === 1 ? seasons[0] : undefined

  if (seasonId && !targetSeason) return undefined

  // Crunchyroll names a great many seasons with nothing but their position, so `targetSeason.title` is
  // routinely the literal "Season 3". Publishing that as the media's own title puts a string naming no
  // show into the store, where anything comparing titles reads it as an identity: it is what merged
  // Grand Blue into Mushoku Tensei. Fall back to the series, which always names the show.
  const seasonTitle = targetSeason && !isOnlySeasonLabel(targetSeason.title) ? targetSeason.title : undefined
  const media = targetSeason
    ? normalizeMedia(
      crunchyrollId(seriesId, resolveSeasonId(targetSeason)),
      seasonTitle ?? series.title,
      targetSeason.description || series.description,
      series
    )
    : normalizeMedia(series.id, series.title, series.description, series)

  // No target season is a SHOW-level media, and a show has no honest episode list here: every media in
  // this store is one season, so `episodeNumber` is within-season and flattening several seasons into
  // one list collides them. `store/db.ts` hangs a HAS_EPISODE edge off this uri for every one of them
  // and `Media.episodes` groups the union by episodeNumber ALONE, so whatever else the cluster holds
  // ends up sharing rows with a season nobody asked for.
  //
  // Measured on the live site 2026-08-31, before this guard: the Mushoku Tensei season 3 page listed
  // 24 rows for a 14 episode season. Rows 1 to 10 were right, because AniZip scores 0.9 against this
  // source's 0.5 and won them; row 11 carried AniZip's season 3 title over a season 1 description; and
  // rows 12 to 24 were season 1 outright, since AniZip publishes no English title past episode 11.
  //
  // So a show-level id gets the metadata and no episodes, rather than every season's. The media itself
  // stays, because `mediaPage` mints exactly these ids for SEARCH results and dropping it would take
  // the search hit down with it. A single-season series is unaffected: `targetSeason` is that season.
  if (targetSeason) {
    media.episodes = await fetchNormalizedEpisodes(resolveSeasonId(targetSeason), media.uri, ctx)
    media.episodeCount = media.episodes.length
    // THE SEASON'S PREMIERE IS ITS FIRST EPISODE'S AIR DATE, which is this file's own rule for the
    // similarity path (`walkSeasonCandidates`: "the premiere is the first episode's air date") and was
    // never applied to the row itself. `normalizeMedia` publishes `series_launch_year` on the SHOW and
    // nothing on a season, correctly, since one season must not carry another's premiere. But nothing
    // put the season's own date there either, so every Crunchyroll season row reached the store with a
    // NULL year, and `plugin:title`'s gate 0 buckets by year: a row with none is never placed beside
    // the run it belongs to. The corpus triage names exactly this, beside the JustWatch title that has
    // since been fixed ("the nf and cr rows that split publish no start date at all, so their profiles
    // hold year NULL and gate 0's year bucket never puts them beside the run").
    //
    // The EARLIEST released date, not `episodes[0]`: the list is ordered by episode number and a
    // special or a late-added row can sit first, which would publish a date from the wrong end of the
    // run. A season whose episodes carry no date at all keeps its NULL, which is the honest answer.
    if (!media.startDate) {
      const aired = media.episodes
        .map(episode => episode.releaseDate)
        .filter((date): date is string => typeof date === 'string' && !Number.isNaN(Date.parse(date)))
        .sort()
      if (aired.length) media.startDate = aired[0]
    }
  }
  return media
}

type CrSeasonCandidate = SeasonCandidate<{ resolvedId: string }> & { airDates?: string[] }
type SeasonWalk = { seasons: CrSeason[], candidates: CrSeasonCandidate[] }

/**
 * Every japanese-audio season of a series described the way `pickSimilarSeason` reads one, at the
 * cost of one episodes request per season. The premiere is the first episode's air date, the count is
 * the distinct numbered episodes (specials carry no number and are not part of the run's length).
 */
const walkSeasonCandidates = async (seriesId: string, ctx: ExtractorServerContext): Promise<SeasonWalk> => {
  const { data: seasons } = await fetchSeasons(seriesId, ctx)
  if (!seasons.length) return { seasons, candidates: [] }

  const jaSeasons = seasons.filter(s => s.audio_locale === 'ja-JP')
  const chosen = jaSeasons.length > 0 ? jaSeasons : seasons

  const candidates = await Promise.all(
    chosen.map(async (season): Promise<CrSeasonCandidate> => {
      const resolvedId = resolveSeasonId(season)
      const { data } = await fetchEpisodes(resolvedId, ctx)
      return {
        season: { resolvedId },
        seasonNumber: data[0]?.season_number,
        episodeCount: new Set(data.filter(ep => ep.episode_number != null).map(ep => ep.episode_number)).size,
        premiere: data[0]?.episode_air_date || undefined,
        episodeTitles: data.map(ep => ep.title),
        // every air date, not just the first: a season that CONTAINS a run is recognised by its span,
        // and the walk already holds the whole payload it would otherwise be refetched from
        airDates: data.map(ep => ep.episode_air_date).filter((date): date is string => Boolean(date)),
      }
    })
  )
  return { seasons, candidates }
}

/**
 * How long one series' season walk is reused. What can move inside a session is a currently airing
 * season publishing an episode (its count and title list grow by one, its premiere and number do
 * not), roughly weekly; region and entitlement changes are not reachable mid-session. Ten minutes
 * bounds a stale count to the same exposure as reading it ten minutes before the episode published.
 */
const SEASON_CANDIDATES_TTL_MS = 10 * 60 * 1000
const _seasonCandidates = new Map<string, { at: number, promise: Promise<SeasonWalk> }>()

// Keyed by series id alone: the token and the fetch are module-wide already. Unlike `_inflight`, which
// collapses concurrent identical requests and forgets them on settle, this keeps the settled walk, so
// the search path and `similarMedia` share one walk per show and two pages of one show pay for one.
const seasonCandidates = (seriesId: string, ctx: ExtractorServerContext): Promise<SeasonWalk> => {
  const cached = _seasonCandidates.get(seriesId)
  if (cached && Date.now() - cached.at < SEASON_CANDIDATES_TTL_MS) return cached.promise
  const promise = walkSeasonCandidates(seriesId, ctx)
  _seasonCandidates.set(seriesId, { at: Date.now(), promise })
  // a failed walk is not an answer about the show: drop it so the next ask walks again. A rate limited
  // payload is a failure by `dataOf`, so it lands here and not in the ten minute cache
  promise.catch(() => { if (_seasonCandidates.get(seriesId)?.promise === promise) _seasonCandidates.delete(seriesId) })
  return promise
}

/** TESTS ONLY: forget every cached season walk. A module singleton, so a test counting requests otherwise reads the test before it. */
export const resetCrunchyrollCaches = () => { _seasonCandidates.clear() }

/**
 * Linking a search hit asserts identity PERMANENTLY: `graph.link` is a union-find union with no
 * inverse, so a wrong hit is not a bad row, it is a different show welded to this title for the rest
 * of the session, and every episode and every play button under it belongs to that other show. The
 * same mistake measured on unOGS welded "Demon Slayer" onto a 2009 korean movie 14 times in 62
 * queries (sources/utils.ts:163-166). So the gate here is deliberately stricter than the shared one.
 *
 * TWO INDEPENDENT AXES, and both must agree:
 *
 *   TITLE decides the franchise. Season markers come off both sides first, because a catalogue that
 *   models a show as one series with several seasons names it once without the season, and charging a
 *   correct match for that difference is what would force the threshold back down. Every title the
 *   cluster knows is tried and the best wins, since catalogues disagree about the canonical name.
 *
 *   DATE decides the season. The candidate season's first episode must have aired within
 *   SEASON_DATE_WINDOW of this media's start date.
 *
 * Neither axis alone is close to sufficient, which is the whole reason both are here. Title alone
 * cannot separate the 2001 and 2019 "Fruits Basket", nor season 1 from season 3 of anything, and it
 * is exactly a multi-season show that this path exists to rescue. Date alone matches every show that
 * aired the same week. Requiring both is what makes a hit worth trusting.
 *
 * Anything missing is a refusal, never a guess: no start date, no titles, nothing over the threshold,
 * or nothing inside the window, and this returns undefined and Crunchyroll simply does not appear.
 * That is the correct trade. A missing row is a nuisance; a wrong row is a lie about what the user is
 * about to watch, and it is not recoverable without a reload.
 */
const CONFIDENT_TITLE_THRESHOLD = 0.9
// a franchise can be split across several catalogue entries, so the runners-up are date-checked too,
// but the list is capped: each one costs a seasons call plus an episodes call per season
const MAX_SERIES_CANDIDATES = 3
const MAX_SEARCH_QUERIES = 4

/** The day a date falls on, which is the precision two catalogues actually agree to. */
const dayOf = (date: string | undefined): number | undefined => {
  const at = date ? Date.parse(date) : Number.NaN
  return Number.isFinite(at) ? Math.floor(at / 86_400_000) : undefined
}

/**
 * The season that CONTAINS this run, when no season IS it.
 *
 * Crunchyroll models a split cour as one season, so neither part matches: part one is refused by the
 * fold veto for being shorter than what it found, and part two never comes near, because the season
 * it belongs to premiered with part one nine months earlier. Both parts then carry no Crunchyroll at
 * all, which is the state the site was in on 2026-09-09.
 *
 * WHAT IS RETURNED IS NOT AN IDENTITY. The season is one thing and the run is another, so it carries
 * NO handles: claiming it would union both parts into one cluster through a shared uri, which is the
 * defect the fold veto exists to prevent and which `graph.link` has no inverse for. What crosses over
 * is the EPISODES, re-pointed at the run that asked, so a `HAS_EPISODE` edge exists and the run's own
 * walk can reach them.
 *
 * They keep CRUNCHYROLL'S OWN NUMBERING. The node is shared with everything else that reads that
 * season and `graph.set` is last-write-wins, so rewriting it here would change what those readers
 * see. `store/consensus.ts` aligns them onto the run's numbering at READ time, from the dates both
 * sides publish, and windows away the parts of the season that belong to the run's siblings.
 *
 * CONTAINMENT IS A SPAN, not a premiere. The run's start has to fall inside the season's own
 * broadcast, and the season has to be longer than the run, and exactly ONE season may qualify: two
 * would mean the catalogue splits this show differently again, and there is nothing here to choose
 * between them with.
 */
const lendContainingSeason = async (
  walks: { seriesId: string, candidates: CrSeasonCandidate[] }[],
  evidence: RunEvidence,
  aggregatedUri: string,
  ctx: ExtractorServerContext
): Promise<GQLMedia | undefined> => {
  const start = dayOf(evidence.startDate ?? undefined)
  const ours = evidence.episodeCount
  if (start == null || ours == null) return undefined

  const holders = walks.flatMap(({ seriesId, candidates }) =>
    candidates
      .filter(candidate => (candidate.episodeCount ?? 0) > ours)
      .filter(candidate => {
        const days = (candidate.airDates ?? []).map(dayOf).filter((day): day is number => day != null)
        // a day of slack either end, the same allowance the alignment makes for one broadcast being
        // stamped in two timezones
        return days.length > 1 && start >= Math.min(...days) - 1 && start <= Math.max(...days) + 1
      })
      .map(candidate => ({ seriesId, seasonId: candidate.season.resolvedId })))

  if (holders.length !== 1) return undefined
  const holder = holders[0]!

  const season = await getMedia(crunchyrollId(holder.seriesId, holder.seasonId), ctx)
  if (!season?.episodes?.length) return undefined

  // the row the run's walk starts from. Any member of the asking cluster reaches the same cluster, so
  // the first is chosen for being deterministic rather than for being special.
  const member = fromAggregatedUri(aggregatedUri as Parameters<typeof fromAggregatedUri>[0])?.handleUris?.[0]
  if (!member) return undefined

  return {
    ...season,
    // no identity: this season is not this run, and saying so would weld the run to its own sibling
    handles: [],
    episodes: season.episodes.map(episode => ({ ...episode, mediaUri: member })),
  }
}

const searchAndLinkMedia = async (
  aggregatedUri: string,
  ctx: ExtractorServerContext
): Promise<GQLMedia | undefined> => {
  /**
   * WAITS FOR THE DATE, not just for a title.
   *
   * Every rule below reads `known.startDate`, and the very next line used to return on a null one. It
   * waited for a title alone, so it fired as soon as ANY source named the show and gave up if the
   * ones carrying a date had not landed yet: measured on a real Mushoku Tensei page 2026-09-09, the
   * ask ran with `start=null` every time and this path never got past its second statement.
   *
   * Waiting for what it actually needs costs a cluster with no date the full timeout instead of an
   * immediate refusal, and that cluster was never going to match on any rule here anyway.
   */
  const known = await waitForMedia(
    aggregatedUri,
    ctx,
    media => (getFirstTitle(media) && media.startDate ? media : undefined),
    30_000
  )
  if (!known?.startDate) return undefined
  if (isNaN(new Date(known.startDate).getTime())) return undefined

  const knownTitles = (known.titles ?? []).map(title => title.title).filter(Boolean)
  const primary = knownTitles[0]
  if (!primary) return undefined

  const queries = [...new Set([primary, ...simplifyTitle(primary)])].slice(0, MAX_SEARCH_QUERIES)

  for (const query of queries) {
    const { data } = await searchSeries(query, ctx)
    const items = data.find(entry => entry.type === 'series')?.items ?? []
    if (!items.length) continue

    // gate on title BEFORE spending any season or episode requests: the search payload already carries
    // everything this axis reads, and a rejected candidate must cost nothing
    const scored = (await Promise.all(
      items.map(async series => ({ series, score: await bestTitleScore(knownTitles, series.title) }))
    ))
      .filter(entry => entry.score >= CONFIDENT_TITLE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SERIES_CANDIDATES)
    if (!scored.length) continue

    /**
     * THE SAME PICKER `seasonForShow` USES, rather than a date comparison of this path's own.
     *
     * This path had one rule where that one has five, and none of the guards the others carry.
     * Measured 2026-09-09 against the manami database joined to real AniList dates: 82 pairs of
     * RELATED entries premiere within 45 days of each other AND clear this file's own 0.9 title gate
     * on both sides, 37 of them with a TV side. Rent-a-Girlfriend season 2 and its Petit shorts are
     * three days apart and score 1.0000. Nothing here refused them; what kept them apart was whether
     * Crunchyroll happened to publish the companion as its own season, which is upstream data rather
     * than a rule, and a wrong claim unions two runs for the session with no inverse.
     *
     * What comes with the picker: a refusal when TWO seasons sit inside the window, which is exactly
     * what two parts released together look like; a date rule that ignores a start date naming only a
     * year, which seven extractors template as the first of January; the fold veto this path used to
     * apply by hand; a year veto; and four further ways to match that a date comparison cannot.
     *
     * THE SERIES IS NOW DECIDED BY TITLE ALONE rather than by whichever series held the nearest
     * season. `scored` is already sorted by title score, and the title is the axis that decides the
     * franchise; letting a worse-named series win on a closer date is how a companion show gets in.
     */
    const evidence: RunEvidence = {
      startDate: known.startDate,
      titles: knownTitles,
      episodeCount: known.episodeCount,
    }

    let best: { seriesId: string, seasonId: string } | undefined
    const walks: { seriesId: string, candidates: CrSeasonCandidate[] }[] = []
    for (const { series } of scored) {
      const { candidates } = await seasonCandidates(series.id, ctx)
      walks.push({ seriesId: series.id, candidates })
      const verdict = pickSimilarSeason(evidence, candidates)
      if (!verdict) continue
      best = { seriesId: series.id, seasonId: verdict.season.resolvedId }
      break
    }

    if (best) {
      const media = await getMedia(crunchyrollId(best.seriesId, best.seasonId), ctx)
      if (!media) continue
      media.handles = buildHandlesFromUri(aggregatedUri, origin)
      return media
    }

    const contained = await lendContainingSeason(walks, evidence, aggregatedUri, ctx)
    if (contained) return contained
  }

  return undefined
}

/**
 * The one run of a show that the caller's evidence establishes, for a caller holding the show.
 *
 * The show id already names the franchise (the caller has a `crunchyroll.com/series/<id>` url off its
 * own record), so the only open question is which of that series' seasons is ours, and every rule that
 * answers it lives in `pickSimilarSeason`: a premiere inside the window of a day-precise date, the
 * episode titles, an ordinal the titles agree on with a count the season does not exceed, the one
 * season dated our year holding no more than our count, the first season holding our episodes. A
 * year-only date is no longer thrown out here: the date rule ignores it itself and the later rules
 * can still read the year.
 *
 * Null is the expected answer for most shows and is never an error. Answering with the SERIES would
 * put back exactly the show-level handle the caller came here to avoid minting.
 */
const seasonForShow = async (input: SimilarMediaInput, ctx: ExtractorServerContext): Promise<GQLMedia | undefined> => {
  const { candidates } = await seasonCandidates(input.showId, ctx)
  if (!candidates.length) return undefined
  const verdict = pickSimilarSeason(input, candidates)
  if (!verdict) return undefined
  console.warn(`similarMedia: cr picked ${verdict.season.resolvedId} by ${verdict.rule} for ${input.showId}`)
  return await getMedia(crunchyrollId(input.showId, verdict.season.resolvedId), ctx)
}

export const resolvers: Resolvers = {
  Subscription: {
    similarMedia: {
      // always yield once: a generator that completes without yielding makes yoga respond 204 and the
      // caller waits out its timeout instead of reading the refusal
      subscribe: async function* (_, { input }, ctx: ExtractorServerContext) {
        if (!input?.showId) return yield { similarMedia: null }
        yield { similarMedia: await seasonForShow(input, ctx) ?? null }
      }
    },
    media: {
      subscribe: async function* (_, { input: { uri: _uri } }, ctx: ExtractorServerContext) {
        if (!_uri || !(isUri(_uri) || isAggregatedUri(_uri))) return yield { media: null }
        const uri = extractAggregatedUriOrigin(_uri, origin)
        if (uri) return yield { media: await getMedia(uri.id, ctx) ?? null }
        // no `cr:` in the uri, so no source ever supplied one. Search, under the gate above.
        if (!isAggregatedUri(_uri)) return yield { media: null }
        yield { media: await searchAndLinkMedia(_uri, ctx) ?? null }
      }
    },
    mediaPage: {
      resolve: (parent: { mediaPage: { nodes: GQLMedia[] } }) => parent.mediaPage,
      subscribe: async function* (_, { input: { search } }, ctx: ExtractorServerContext) {
        if (!search) return yield { mediaPage: { nodes: [] } }
        const res = await searchSeries(search, ctx)
        const items = res.data.find(d => d.type === 'series')?.items ?? []
        yield { mediaPage: { nodes: items.map(s => normalizeMedia(s.id, s.title, s.description, s, s.series_metadata?.episode_count)) } }
      }
    }
  },
  Media: {
    episodes: async (parent, _, ctx: ExtractorServerContext) => {
      if (parent.origin !== origin) return parent.episodes ?? []
      if (parent.episodes?.length) return parent.episodes
      return (await getMedia(parent.id, ctx))?.episodes ?? []
    }
  }
}
