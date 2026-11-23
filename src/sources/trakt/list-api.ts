// The viewer's Trakt list as the Trakt tracker reads and writes it: what each answer the page
// script hands back means, the viewer's ratings, watchlist, watched movies/shows and dropped shows
// as one index, and how writes map onto Trakt POST requests. Import free apart from types and i18n.

import type { ListEntry, ListEntryInput, ListItem, ListStatus, Tracker } from '../../generated/schema/types.generated'
import type { Said } from '../../i18n/said'
import type { TraktMovieRef, TraktRange } from './identity'
import type { TraktPageAnswer } from './session-page'

import { forPage } from '../../i18n/said'
import { isScored, nativeScore } from '../../tracking/score-scale'
import { TRAKT_ICON } from './api'

export const TRAKT_TRACKER_ID = 'trakt'
export const TRAKT_URL = 'https://app.trakt.tv'
/** Trakt's one scale: whole points from 1 to 10. */
export const TRAKT_SCORE_SCALE = 'POINT_10'

/** What one answer said, before it means anything about a media. */
export type TraktRead<T> =
  | { kind: 'data', data: T }
  | { kind: 'signed-out' }
  | { kind: 'blocked', retryAfter: number | null }
  | { kind: 'error', message: Said }

/** One answer of the page. A 401 is a token Trakt no longer takes, after the page read the cookie afresh. */
export const readAnswer = <T>(answer: TraktPageAnswer<T>): TraktRead<T> => {
  if (answer.kind === 'signed-out') return { kind: 'signed-out' }
  if (answer.kind === 'no-session') {
    return {
      kind: 'error',
      message: forPage.formatMessage(
        { id: 'app.trakt.tv answered {status} with no session stub could read', defaultMessage: 'app.trakt.tv answered {status} with no session stub could read' },
        { status: answer.status },
      ),
    }
  }
  if (answer.status === 401) return { kind: 'signed-out' }
  if (answer.status === 429) return { kind: 'blocked', retryAfter: answer.retryAfter }
  if (answer.status === 420) {
    return {
      kind: 'error',
      message: forPage.formatMessage({ id: 'Trakt refused the save: free account list limit reached', defaultMessage: 'Trakt refused the save: free account list limit reached' }),
    }
  }
  if (answer.status >= 200 && answer.status < 300 && answer.body !== null) return { kind: 'data', data: answer.body }
  if (answer.status >= 200 && answer.status < 300) {
    return {
      kind: 'error',
      message: forPage.formatMessage({ id: 'Trakt answered {status} with nothing stub could read', defaultMessage: 'Trakt answered {status} with nothing stub could read' }, { status: answer.status }),
    }
  }
  return {
    kind: 'error',
    message: forPage.formatMessage({ id: 'Trakt answered {status}', defaultMessage: 'Trakt answered {status}' }, { status: answer.status }),
  }
}

/** One answer of a list read: anything but an array is an error, never an empty list. */
export const readList = (answer: TraktPageAnswer): TraktRead<unknown[]> => {
  const read = readAnswer(answer)
  if (read.kind !== 'data') return read
  return Array.isArray(read.data)
    ? { kind: 'data', data: read.data }
    : { kind: 'error', message: forPage.formatMessage({ id: 'Trakt answered something other than a list', defaultMessage: 'Trakt answered something other than a list' }) }
}

type RawIds = { trakt?: unknown, slug?: unknown, imdb?: unknown, tmdb?: unknown }
export type ListedMedia = { trakt: number, slug: string | null, imdb: string | null, tmdb: number | null, title: string | null }

/** The viewer's lists, read whole. Seasons are keyed `<show trakt id>:<season number>`. */
export type TraktLists = {
  /** Season ratings, 1 to 10. */
  ratings: ReadonlyMap<string, number>
  /** Movie ratings, 1 to 10, by movie trakt id. */
  movieRatings: ReadonlyMap<number, number>
  /** Shows by id, and seasons by key, on the watchlist. */
  watchlist: ReadonlySet<string>
  /** Movies on the watchlist, by movie trakt id. */
  movieWatchlist: ReadonlySet<number>
  /** Shows on the dropped list, by trakt id. */
  dropped: ReadonlySet<number>
  /** Watched movies, by movie trakt id. */
  watchedMovies: ReadonlyMap<number, { watchedAt: string | null, resetAt: string | null }>
  /** Metadata kept for `viewerLists` without extra lookups. */
  meta: {
    shows: ReadonlyMap<number, ListedMedia>
    movies: ReadonlyMap<number, ListedMedia>
    updatedAt: ReadonlyMap<string, string>
  }
}

export const seasonKey = (show: number, season: number) => `${show}:${season}`

type Item = {
  show?: { title?: unknown, ids?: RawIds }
  movie?: { title?: unknown, ids?: RawIds }
  season?: { number?: unknown }
  rating?: unknown
  rated_at?: unknown
  listed_at?: unknown
  last_watched_at?: unknown
  reset_at?: unknown
  plays?: unknown
  seasons?: { number?: unknown, episodes?: { number?: unknown, plays?: unknown, last_watched_at?: unknown }[] }[]
}

const itemsOf = (body: unknown[]): Item[] => body.filter((item): item is Item => Boolean(item) && typeof item === 'object')

const wholeOf = (value: unknown) => typeof value === 'number' && Number.isInteger(value) ? value : undefined
const strOf = (value: unknown) => typeof value === 'string' && value !== '' ? value : null

const mediaMetaOf = (raw?: { title?: unknown, ids?: RawIds }): ListedMedia | undefined => {
  const trakt = wholeOf(raw?.ids?.trakt)
  if (trakt === undefined) return undefined
  return {
    trakt,
    slug: strOf(raw?.ids?.slug),
    imdb: strOf(raw?.ids?.imdb),
    tmdb: wholeOf(raw?.ids?.tmdb) ?? null,
    title: strOf(raw?.title),
  }
}

const keyOf = (item: Item) => {
  const show = wholeOf(item.show?.ids?.trakt)
  const season = wholeOf(item.season?.number)
  return show === undefined ? undefined : season === undefined ? String(show) : seasonKey(show, season)
}

/** `/sync/ratings/seasons`: each season's rating, by season key. */
export const ratingsOf = (body: unknown[]): Map<string, number> => {
  const ratings = new Map<string, number>()
  for (const item of itemsOf(body)) {
    const key = keyOf(item)
    const rating = wholeOf(item.rating)
    if (key?.includes(':') && rating !== undefined && rating >= 1 && rating <= 10) ratings.set(key, rating)
  }
  return ratings
}

/** `/sync/ratings/movies`: each movie's rating, by trakt id. */
export const movieRatingsOf = (body: unknown[]): Map<number, number> => {
  const ratings = new Map<number, number>()
  for (const item of itemsOf(body)) {
    const movie = wholeOf(item.movie?.ids?.trakt)
    const rating = wholeOf(item.rating)
    if (movie !== undefined && rating !== undefined && rating >= 1 && rating <= 10) ratings.set(movie, rating)
  }
  return ratings
}

/** `/sync/watchlist/shows` and `/sync/watchlist/seasons` read together: a show by its id, a season by its key. */
export const watchlistOf = (...bodies: unknown[][]): Set<string> =>
  new Set(bodies.flatMap(body => itemsOf(body).flatMap(item => keyOf(item) ?? [])))

/** `/sync/watchlist/movies`: movie trakt ids on the watchlist. */
export const movieWatchlistOf = (body: unknown[]): Set<number> =>
  new Set(itemsOf(body).flatMap(item => wholeOf(item.movie?.ids?.trakt) ?? []))

/** One page of `/users/hidden/dropped`: the shows on it. */
export const droppedOf = (body: unknown[]): number[] => itemsOf(body).flatMap(item => wholeOf(item.show?.ids?.trakt) ?? [])

/** `/sync/watched/movies`: watched movie ids with latest play timestamp and reset timestamp. */
export const watchedMoviesOf = (body: unknown[]): Map<number, { watchedAt: string | null, resetAt: string | null }> => {
  const watched = new Map<number, { watchedAt: string | null, resetAt: string | null }>()
  for (const item of itemsOf(body)) {
    const movie = wholeOf(item.movie?.ids?.trakt)
    const plays = wholeOf(item.plays) ?? 0
    if (movie !== undefined && plays > 0) watched.set(movie, { watchedAt: strOf(item.last_watched_at), resetAt: strOf(item.reset_at) })
  }
  return watched
}

export const buildLists = (raw: {
  ratingsSeasons: unknown[]
  ratingsMovies: unknown[]
  watchlistShows: unknown[]
  watchlistSeasons: unknown[]
  watchlistMovies: unknown[]
  dropped: number[]
  droppedItems?: unknown[]
  watchedMovies: unknown[]
}): TraktLists => {
  const shows = new Map<number, ListedMedia>()
  const movies = new Map<number, ListedMedia>()
  const updatedAt = new Map<string, string>()
  const keepTime = (k: string, t: string | null) => {
    if (!t) return
    const prev = updatedAt.get(k)
    if (!prev || t > prev) updatedAt.set(k, t)
  }
  for (const list of [raw.ratingsSeasons, raw.watchlistShows, raw.watchlistSeasons, raw.droppedItems ?? []]) {
    for (const item of itemsOf(list)) {
      const meta = mediaMetaOf(item.show)
      if (!meta) continue
      shows.set(meta.trakt, meta)
      const s = wholeOf(item.season?.number)
      keepTime(s !== undefined ? seasonKey(meta.trakt, s) : String(meta.trakt), strOf(item.rated_at) ?? strOf(item.listed_at))
    }
  }
  for (const list of [raw.ratingsMovies, raw.watchlistMovies, raw.watchedMovies]) {
    for (const item of itemsOf(list)) {
      const meta = mediaMetaOf(item.movie)
      if (!meta) continue
      movies.set(meta.trakt, meta)
      keepTime(`m:${meta.trakt}`, strOf(item.last_watched_at) ?? strOf(item.rated_at) ?? strOf(item.listed_at))
    }
  }
  return {
    ratings: ratingsOf(raw.ratingsSeasons),
    movieRatings: movieRatingsOf(raw.ratingsMovies),
    watchlist: watchlistOf(raw.watchlistShows, raw.watchlistSeasons),
    movieWatchlist: movieWatchlistOf(raw.watchlistMovies),
    dropped: new Set(raw.dropped),
    watchedMovies: watchedMoviesOf(raw.watchedMovies),
    meta: { shows, movies, updatedAt },
  }
}

/**
 * What `/sync/last_activities` says of the lists the index holds, as one value that moves when any of
 * them changed. Undefined when the answer carries none of it, so the lists are read again.
 */
export const activitiesOf = (body: unknown): string | undefined => {
  const at = body as { shows?: Record<string, unknown>, seasons?: Record<string, unknown>, episodes?: Record<string, unknown>, movies?: Record<string, unknown> } | null
  const stamps = [
    at?.seasons?.rated_at,
    at?.seasons?.watchlisted_at,
    at?.shows?.watchlisted_at,
    at?.shows?.dropped_at,
    at?.shows?.hidden_at,
    at?.episodes?.watched_at,
    at?.movies?.rated_at,
    at?.movies?.watchlisted_at,
    at?.movies?.watched_at,
  ]
  return stamps.some(stamp => typeof stamp === 'string') ? JSON.stringify(stamps) : undefined
}

export type ProgressEpisode = { number: number, completed: boolean, watchedAt: string | null }

/**
 * The run's episodes in `/shows/<id>/progress/watched`, and whether the show is being watched again
 * (`reset_at`, set by a progress reset). Episodes Trakt does not list, not aired yet, count as not watched.
 */
export const progressOf = (body: unknown, range: TraktRange): { episodes: ProgressEpisode[], resetAt: string | null } => {
  const progress = body as { reset_at?: unknown, seasons?: { number?: unknown, episodes?: unknown }[] } | null
  const season = Array.isArray(progress?.seasons) ? progress.seasons.find(candidate => candidate?.number === range.season) : undefined
  const episodes = (Array.isArray(season?.episodes) ? season.episodes as { number?: unknown, completed?: unknown, last_watched_at?: unknown }[] : [])
    .flatMap(episode => {
      const number = wholeOf(episode?.number)
      return number !== undefined && number >= range.from && number <= range.to
        ? [{ number, completed: episode.completed === true, watchedAt: typeof episode.last_watched_at === 'string' ? episode.last_watched_at : null }]
        : []
    })
  return { episodes, resetAt: typeof progress?.reset_at === 'string' ? progress.reset_at : null }
}

/**
 * Trakt keeps no status, so one is derived, first match wins: on the dropped list DROPPED; reset and
 * the run not finished REWATCHING; every episode watched COMPLETED; some WATCHING; on the watchlist
 * (the show or the season) PLANNING. Null when none of these holds and the season is only rated.
 */
export const statusOf = (
  { dropped, rewatching, watched, total, planned }: { dropped: boolean, rewatching: boolean, watched: number, total: number, planned: boolean },
): ListStatus | null =>
  dropped ? 'DROPPED'
  : rewatching && watched < total ? 'REWATCHING'
  : watched >= total ? 'COMPLETED'
  : watched > 0 ? 'WATCHING'
  : planned ? 'PLANNING'
  : null

export const rangeId = ({ show, season, from, to }: TraktRange) => `${show.trakt}-s${season}e${from}-${to}`

/** The run's entry, or null when Trakt holds nothing of it: no play, no list, no rating. */
export const listEntryOf = (user: string, range: TraktRange, progress: unknown, lists: TraktLists): ListEntry | null => {
  const { episodes, resetAt } = progressOf(progress, range)
  const show = range.show.trakt
  const total = range.to - range.from + 1
  const watched = episodes.filter(episode => episode.completed).length
  const rating = lists.ratings.get(seasonKey(show, range.season))
  const status = statusOf({
    dropped: lists.dropped.has(show),
    rewatching: resetAt !== null,
    watched,
    total,
    planned: lists.watchlist.has(String(show)) || lists.watchlist.has(seasonKey(show, range.season)),
  })
  if (!status && rating === undefined) return null
  const watchedAt = episodes.flatMap(episode => episode.watchedAt ?? []).sort().at(-1)
  return {
    _id: `${TRAKT_TRACKER_ID}:${user}:${rangeId(range)}`,
    tracker: TRAKT_TRACKER_ID,
    mediaUri: `${TRAKT_TRACKER_ID}:${rangeId(range)}`,
    status,
    progress: watched,
    score: rating === undefined ? null : rating * 10,
    startedAt: null,
    completedAt: null,
    rewatchCount: null,
    updatedAt: watchedAt ?? null,
    url: `${TRAKT_URL}/shows/${range.show.slug ?? show}/seasons/${range.season}`,
    title: range.show.title,
    cover: null,
    episodeCount: total,
  }
}

/** A movie's entry, or null when Trakt holds nothing of it: no watch, no watchlist, no rating. */
export const listEntryOfMovie = (user: string, movie: TraktMovieRef, lists: TraktLists): ListEntry | null => {
  const watched = lists.watchedMovies.get(movie.trakt)
  const rating = lists.movieRatings.get(movie.trakt)
  const planned = lists.movieWatchlist.has(movie.trakt)
  const status: ListStatus | null =
    watched ? (watched.resetAt ? 'REWATCHING' : 'COMPLETED')
    : planned ? 'PLANNING'
    : null
  if (!status && rating === undefined) return null
  return {
    _id: `${TRAKT_TRACKER_ID}:${user}:movie-${movie.trakt}`,
    tracker: TRAKT_TRACKER_ID,
    mediaUri: `${TRAKT_TRACKER_ID}:movie-${movie.trakt}`,
    status,
    progress: watched ? 1 : 0,
    score: rating === undefined ? null : rating * 10,
    startedAt: null,
    completedAt: null,
    rewatchCount: null,
    updatedAt: watched?.watchedAt ?? null,
    url: `${TRAKT_URL}/movies/${movie.slug ?? movie.trakt}`,
    title: movie.title,
    cover: null,
    episodeCount: 1,
  }
}

const showMediaUri = (show: ListedMedia, season: number): string | null =>
  show.tmdb ? `tmdb:${show.tmdb}-s${season}`
  : show.slug ? `trakt:${show.slug}`
  : show.imdb ? `omdb:${show.imdb}`
  : `trakt:${show.trakt}`

const movieMediaUri = (movie: ListedMedia): string | null =>
  movie.imdb ? `omdb:${movie.imdb}`
  : movie.tmdb ? `tmdb:movie-${movie.tmdb}`
  : movie.slug ? `trakt:${movie.slug}`
  : `trakt:${movie.trakt}`

/** Every listed show season and movie combined into `viewerLists` items. */
export const listItemsOf = (user: string, lists: TraktLists, watchedShowsRaw: unknown[]): ListItem[] => {
  const items: ListItem[] = []
  const seasonProgress = new Map<string, { episodes: number, watchedAt: string | null, resetAt: string | null }>()
  const shows = new Map(lists.meta.shows)

  for (const raw of itemsOf(watchedShowsRaw)) {
    const meta = mediaMetaOf(raw.show)
    if (!meta) continue
    shows.set(meta.trakt, meta)
    const resetAt = strOf(raw.reset_at)
    for (const season of raw.seasons ?? []) {
      const s = wholeOf(season.number)
      if (!s || s <= 0) continue
      const eps = (season.episodes ?? []).filter(ep => (wholeOf(ep.plays) ?? 0) > 0)
      if (!eps.length) continue
      const latest = eps.flatMap(ep => strOf(ep.last_watched_at) ?? []).sort().at(-1) ?? strOf(raw.last_watched_at)
      seasonProgress.set(seasonKey(meta.trakt, s), { episodes: eps.length, watchedAt: latest, resetAt })
    }
  }

  const emittedShows = new Set<number>()
  const seasonKeys = new Set<string>([
    ...seasonProgress.keys(),
    ...lists.ratings.keys(),
    ...[...lists.watchlist].filter(k => k.includes(':')),
  ])

  for (const key of seasonKeys) {
    const [showStr, seasonStr] = key.split(':')
    const showId = Number(showStr)
    const season = Number(seasonStr)
    const meta = shows.get(showId)
    if (!meta || !Number.isInteger(season)) continue
    emittedShows.add(showId)
    const prog = seasonProgress.get(key)
    const watched = prog?.episodes ?? 0
    const rating = lists.ratings.get(key)
    const dropped = lists.dropped.has(showId)
    const planned = lists.watchlist.has(key) || lists.watchlist.has(String(showId))
    const status: ListStatus | null =
      dropped ? 'DROPPED'
      : watched > 0 ? (prog?.resetAt ? 'REWATCHING' : 'WATCHING')
      : planned ? 'PLANNING'
      : null
    if (!status && rating === undefined) continue
    items.push({
      entry: {
        _id: `${TRAKT_TRACKER_ID}:${user}:s:${showId}:${season}`,
        tracker: TRAKT_TRACKER_ID,
        mediaUri: showMediaUri(meta, season),
        status,
        progress: watched,
        score: rating === undefined ? null : rating * 10,
        startedAt: null,
        completedAt: null,
        rewatchCount: null,
        updatedAt: prog?.watchedAt ?? lists.meta.updatedAt.get(key) ?? lists.meta.updatedAt.get(String(showId)) ?? null,
        url: `${TRAKT_URL}/shows/${meta.slug ?? showId}/seasons/${season}`,
        title: meta.title,
        cover: null,
        episodeCount: null,
      },
      episodeCount: null,
      mediaStatus: null,
      type: 'TV',
    })
  }

  for (const showId of new Set([...lists.dropped, ...[...lists.watchlist].filter(k => !k.includes(':')).map(Number)])) {
    if (emittedShows.has(showId)) continue
    const meta = shows.get(showId)
    if (!meta) continue
    const dropped = lists.dropped.has(showId)
    const planned = lists.watchlist.has(String(showId))
    const status: ListStatus | null = dropped ? 'DROPPED' : planned ? 'PLANNING' : null
    if (!status) continue
    items.push({
      entry: {
        _id: `${TRAKT_TRACKER_ID}:${user}:show:${showId}`,
        tracker: TRAKT_TRACKER_ID,
        mediaUri: showMediaUri(meta, 1),
        status,
        progress: 0,
        score: null,
        startedAt: null,
        completedAt: null,
        rewatchCount: null,
        updatedAt: lists.meta.updatedAt.get(String(showId)) ?? null,
        url: `${TRAKT_URL}/shows/${meta.slug ?? showId}`,
        title: meta.title,
        cover: null,
        episodeCount: null,
      },
      episodeCount: null,
      mediaStatus: null,
      type: 'TV',
    })
  }

  for (const [movieId, meta] of lists.meta.movies) {
    const entry = listEntryOfMovie(user, { trakt: movieId, slug: meta.slug, title: meta.title }, lists)
    if (!entry) continue
    items.push({
      entry: {
        ...entry,
        mediaUri: movieMediaUri(meta),
        updatedAt: entry.updatedAt ?? lists.meta.updatedAt.get(`m:${movieId}`) ?? null,
      },
      episodeCount: 1,
      mediaStatus: null,
      type: 'MOVIE',
    })
  }

  return items
}

export type TraktWriteStep = { path: string, body: unknown }
export type TraktWritePlan = { steps: TraktWriteStep[] } | { noop: true } | { error: Said }

const isCount = (value: number | null | undefined) => value == null || (Number.isInteger(value) && value >= 0)
const NOT_A_PROGRESS = forPage.formatMessage({ id: 'Progress has to be a whole number of episodes', defaultMessage: 'Progress has to be a whole number of episodes' })
const NOT_A_SCORE = forPage.formatMessage({ id: 'A score is a whole number from 0 to 100', defaultMessage: 'A score is a whole number from 0 to 100' })
const NO_PAUSED = forPage.formatMessage({ id: 'Trakt has no Paused status', defaultMessage: 'Trakt has no Paused status' })
const NO_REWATCHING = forPage.formatMessage({ id: 'Trakt rewatching can only be started on Trakt itself', defaultMessage: 'Trakt rewatching can only be started on Trakt itself' })
const NEED_PROGRESS_FOR_WATCHING = forPage.formatMessage({ id: 'Watch at least one episode to mark as Watching on Trakt', defaultMessage: 'Watch at least one episode to mark as Watching on Trakt' })
const PLANNING_NEEDS_ZERO = forPage.formatMessage({ id: 'Lower progress to 0 on Trakt before moving it to Planning', defaultMessage: 'Lower progress to 0 on Trakt before moving it to Planning' })

export const planShowWrite = (
  range: TraktRange,
  progressBody: unknown,
  lists: TraktLists,
  input: ListEntryInput,
  nowIso: string,
): TraktWritePlan => {
  if (!isCount(input.progress)) return { error: NOT_A_PROGRESS }
  if (input.score != null && !(Number.isInteger(input.score) && input.score >= 0 && input.score <= 100)) return { error: NOT_A_SCORE }

  const showId = range.show.trakt
  const total = range.to - range.from + 1
  if (input.progress != null && input.progress > total) {
    return { error: forPage.formatMessage({ id: 'Trakt lists only {total} episodes in this run', defaultMessage: 'Trakt lists only {total} episodes in this run' }, { total }) }
  }
  if (input.status === 'PAUSED') return { error: NO_PAUSED }
  if (input.status === 'REWATCHING') return { error: NO_REWATCHING }

  const { episodes } = progressOf(progressBody, range)
  const watchedSet = new Set(episodes.filter(ep => ep.completed).map(ep => ep.number))
  const beforeWatched = watchedSet.size
  const beforeDropped = lists.dropped.has(showId)
  const beforeShowWatchlist = lists.watchlist.has(String(showId))
  const beforeSeasonWatchlist = lists.watchlist.has(seasonKey(showId, range.season))
  const beforeRating = lists.ratings.get(seasonKey(showId, range.season)) ?? null

  const hasStatus = 'status' in input && input.status !== undefined
  const hasProgress = 'progress' in input && input.progress !== undefined
  const hasScore = 'score' in input && input.score !== undefined

  let targetWatched = hasProgress ? (input.progress ?? 0) : beforeWatched
  if (hasStatus && input.status === 'COMPLETED' && !hasProgress) targetWatched = total

  if (hasStatus && input.status === 'WATCHING' && targetWatched === 0) return { error: NEED_PROGRESS_FOR_WATCHING }
  if (hasStatus && input.status === 'PLANNING' && targetWatched > 0) return { error: PLANNING_NEEDS_ZERO }

  const steps: TraktWriteStep[] = []
  const wantDropped = hasStatus ? input.status === 'DROPPED' : beforeDropped
  const wantWatchlist = hasStatus
    ? (input.status === 'PLANNING')
    : targetWatched === 0 && !wantDropped && (beforeShowWatchlist || beforeSeasonWatchlist)

  if (wantDropped && !beforeDropped) {
    steps.push({ path: '/users/hidden/dropped', body: { shows: [{ ids: { trakt: showId } }] } })
  } else if (!wantDropped && beforeDropped) {
    steps.push({ path: '/users/hidden/dropped/remove', body: { shows: [{ ids: { trakt: showId } }] } })
  }

  if (wantWatchlist && !beforeSeasonWatchlist && !beforeShowWatchlist) {
    steps.push({ path: '/sync/watchlist', body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season }] }] } })
  } else if (!wantWatchlist && (beforeSeasonWatchlist || (beforeShowWatchlist && targetWatched === 0))) {
    const showBody = beforeShowWatchlist
      ? { ids: { trakt: showId } }
      : { ids: { trakt: showId }, seasons: [{ number: range.season }] }
    steps.push({ path: '/sync/watchlist/remove', body: { shows: [showBody] } })
  }

  const runNumbers = Array.from({ length: total }, (_, idx) => range.from + idx)
  if (targetWatched > beforeWatched) {
    const needed = targetWatched - beforeWatched
    const addNumbers = runNumbers.filter(n => !watchedSet.has(n)).slice(0, needed)
    if (addNumbers.length) {
      steps.push({
        path: '/sync/history',
        body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season, episodes: addNumbers.map(number => ({ number, watched_at: nowIso })) }] }] },
      })
    }
  } else if (targetWatched < beforeWatched) {
    const watchedInRun = runNumbers.filter(n => watchedSet.has(n))
    const removeNumbers = watchedInRun.slice(targetWatched)
    if (removeNumbers.length) {
      steps.push({
        path: '/sync/history/remove',
        body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season, episodes: removeNumbers.map(number => ({ number })) }] }] },
      })
    }
  }

  if (hasScore) {
    const targetRating = !isScored(input.score) ? null : nativeScore(input.score, TRAKT_SCORE_SCALE)
    if (targetRating !== beforeRating) {
      if (targetRating === null) {
        steps.push({ path: '/sync/ratings/remove', body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season }] }] } })
      } else {
        steps.push({ path: '/sync/ratings', body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season, rating: targetRating }] }] } })
      }
    }
  }

  return steps.length ? { steps } : { noop: true }
}

/** Removing from list clears dropped status, watchlist (season + show if whole-show listed), and rating; history plays stay. */
export const planShowRemove = (range: TraktRange, lists: TraktLists): TraktWriteStep[] => {
  const showId = range.show.trakt
  const steps: TraktWriteStep[] = []
  if (lists.dropped.has(showId)) steps.push({ path: '/users/hidden/dropped/remove', body: { shows: [{ ids: { trakt: showId } }] } })
  const onShow = lists.watchlist.has(String(showId))
  const onSeason = lists.watchlist.has(seasonKey(showId, range.season))
  if (onShow || onSeason) {
    steps.push({
      path: '/sync/watchlist/remove',
      body: { shows: [onShow ? { ids: { trakt: showId } } : { ids: { trakt: showId }, seasons: [{ number: range.season }] }] },
    })
  }
  if (lists.ratings.has(seasonKey(showId, range.season))) {
    steps.push({ path: '/sync/ratings/remove', body: { shows: [{ ids: { trakt: showId }, seasons: [{ number: range.season }] }] } })
  }
  return steps
}

export const planMovieWrite = (
  movie: TraktMovieRef,
  lists: TraktLists,
  input: ListEntryInput,
  nowIso: string,
): TraktWritePlan => {
  if (!isCount(input.progress)) return { error: NOT_A_PROGRESS }
  if (input.score != null && !(Number.isInteger(input.score) && input.score >= 0 && input.score <= 100)) return { error: NOT_A_SCORE }
  if (input.progress != null && input.progress > 1) {
    return { error: forPage.formatMessage({ id: 'Trakt only lists 1 part for a movie', defaultMessage: 'Trakt only lists 1 part for a movie' }) }
  }
  if (input.status === 'PAUSED') return { error: NO_PAUSED }
  if (input.status === 'REWATCHING') return { error: NO_REWATCHING }
  if (input.status === 'DROPPED') {
    return { error: forPage.formatMessage({ id: 'Trakt does not support Dropping movies', defaultMessage: 'Trakt does not support Dropping movies' }) }
  }

  const movieId = movie.trakt
  const beforeWatched = lists.watchedMovies.has(movieId) ? 1 : 0
  const beforeWatchlist = lists.movieWatchlist.has(movieId)
  const beforeRating = lists.movieRatings.get(movieId) ?? null

  const hasStatus = 'status' in input && input.status !== undefined
  const hasProgress = 'progress' in input && input.progress !== undefined
  const hasScore = 'score' in input && input.score !== undefined

  let targetWatched = hasProgress ? (input.progress ?? 0) : beforeWatched
  if (hasStatus && input.status === 'COMPLETED' && !hasProgress) targetWatched = 1
  if (hasStatus && input.status === 'WATCHING' && targetWatched === 0) return { error: NEED_PROGRESS_FOR_WATCHING }
  if (hasStatus && input.status === 'PLANNING' && targetWatched > 0) return { error: PLANNING_NEEDS_ZERO }

  const wantWatchlist = hasStatus
    ? (input.status === 'PLANNING')
    : targetWatched === 0 && beforeWatchlist

  const steps: TraktWriteStep[] = []
  if (wantWatchlist && !beforeWatchlist) {
    steps.push({ path: '/sync/watchlist', body: { movies: [{ ids: { trakt: movieId } }] } })
  } else if (!wantWatchlist && beforeWatchlist) {
    steps.push({ path: '/sync/watchlist/remove', body: { movies: [{ ids: { trakt: movieId } }] } })
  }

  if (targetWatched === 1 && beforeWatched === 0) {
    steps.push({ path: '/sync/history', body: { movies: [{ ids: { trakt: movieId }, watched_at: nowIso }] } })
  } else if (targetWatched === 0 && beforeWatched === 1) {
    steps.push({ path: '/sync/history/remove', body: { movies: [{ ids: { trakt: movieId } }] } })
  }

  if (hasScore) {
    const targetRating = !isScored(input.score) ? null : nativeScore(input.score, TRAKT_SCORE_SCALE)
    if (targetRating !== beforeRating) {
      if (targetRating === null) steps.push({ path: '/sync/ratings/remove', body: { movies: [{ ids: { trakt: movieId } }] } })
      else steps.push({ path: '/sync/ratings', body: { movies: [{ ids: { trakt: movieId }, rating: targetRating }] } })
    }
  }

  return steps.length ? { steps } : { noop: true }
}

/** Removing a movie from list clears watchlist and rating; watched plays stay. */
export const planMovieRemove = (movie: TraktMovieRef, lists: TraktLists): TraktWriteStep[] => {
  const movieId = movie.trakt
  const steps: TraktWriteStep[] = []
  if (lists.movieWatchlist.has(movieId)) steps.push({ path: '/sync/watchlist/remove', body: { movies: [{ ids: { trakt: movieId } }] } })
  if (lists.movieRatings.has(movieId)) steps.push({ path: '/sync/ratings/remove', body: { movies: [{ ids: { trakt: movieId } }] } })
  return steps
}

/** The tracker as its answers name it, from the viewer the last read found (none: signed out). */
export const traktTracker = (user?: string): Tracker => ({
  id: TRAKT_TRACKER_ID,
  name: 'Trakt',
  icon: TRAKT_ICON,
  color: null,
  signedIn: Boolean(user),
  account: user ?? null,
  canWrite: Boolean(user),
  scoreScale: TRAKT_SCORE_SCALE,
})
