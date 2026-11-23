// A HAND-MADE Trakt behind a fake session, for the tracker tests, answering in the shapes of Trakt's
// API contract: reads use saved answers in __fixtures__/tracker for public lookups and stateful
// per-viewer lists and writes in memory.
import { readFileSync } from 'node:fs'
import { vi } from 'vite-plus/test'

import type { TraktPageAnswer } from '../../../../src/sources/trakt/session-page'
import type { SiteSessionResult } from '../../../../src/tracking/site-session'

const DIR = `${__dirname}/__fixtures__/tracker`

const AT = '2026-10-01T00:00:00.000Z'
const showOf = (trakt: number) => ({ title: `Show ${trakt}`, year: 2023, ids: { trakt, slug: `show-${trakt}`, tmdb: trakt * 10, imdb: `tt${trakt}` } })
const movieOf = (trakt: number) => ({ title: `Movie ${trakt}`, year: 2024, ids: { trakt, slug: `movie-${trakt}`, imdb: `tt9${trakt}`, tmdb: trakt + 100_000 } })

/** One `/sync/ratings/seasons` item. */
export const ratingItem = (show: number, season: number, rating: number) =>
  ({ rated_at: AT, rating, type: 'season', season: { number: season, ids: { trakt: show * 100 + season } }, show: showOf(show) })

/** One `/sync/ratings/movies` item. */
export const movieRatingItem = (movie: number, rating: number) =>
  ({ rated_at: AT, rating, type: 'movie', movie: movieOf(movie) })

/** One `/sync/watchlist/shows` or `/sync/watchlist/seasons` item. */
export const watchlistItem = (show: number, season?: number) =>
  season === undefined
    ? { rank: 1, id: show, listed_at: AT, type: 'show', show: showOf(show) }
    : { rank: 1, id: show * 100 + season, listed_at: AT, type: 'season', season: { number: season, ids: { trakt: show * 100 + season } }, show: showOf(show) }

/** One `/sync/watchlist/movies` item. */
export const movieWatchlistItem = (movie: number) =>
  ({ rank: 1, id: movie, listed_at: AT, type: 'movie', movie: movieOf(movie) })

/** One `/sync/watched/movies` item. */
export const watchedMovieItem = (movie: number, at = AT, resetAt: string | null = null) =>
  ({ plays: 1, last_watched_at: at, last_updated_at: at, reset_at: resetAt, movie: movieOf(movie) })

/** One `/sync/watched/shows` item. */
export const watchedShowItem = (show: number, seasons: Record<number, number[]>, at = AT, resetAt: string | null = null) => ({
  plays: Object.values(seasons).reduce((s, eps) => s + eps.length, 0),
  last_watched_at: at,
  last_updated_at: at,
  reset_at: resetAt,
  show: showOf(show),
  seasons: Object.entries(seasons).map(([number, episodes]) => ({
    number: Number(number),
    episodes: episodes.map(ep => ({ number: ep, plays: 1, last_watched_at: at })),
  })),
})

/** One page of `/users/hidden/dropped`. */
export const droppedPage = (shows: number[]) => shows.map(trakt => ({ hidden_at: AT, type: 'show', show: showOf(trakt) }))

/** A show's `/progress/watched`: `watched` episodes of each season out of `aired`, each last watched `at`. */
export const progress = (seasons: Record<number, { watched: number[], aired: number, at?: string }>, resetAt: string | null = null) => {
  const all = Object.entries(seasons).map(([number, { watched, aired, at = '2026-01-01T00:00:00.000Z' }]) => ({
    number: Number(number),
    title: null,
    aired,
    completed: watched.length,
    episodes: Array.from({ length: aired }, (_, index) => ({
      number: index + 1,
      completed: watched.includes(index + 1),
      last_watched_at: watched.includes(index + 1) ? at : null,
    })),
  }))
  return {
    aired: all.reduce((sum, season) => sum + season.aired, 0),
    completed: all.reduce((sum, season) => sum + season.completed, 0),
    last_watched_at: null,
    reset_at: resetAt,
    next_episode: null,
    last_episode: null,
    seasons: all,
    hidden_seasons: [],
  }
}

export type FakeTraktOptions = {
  /** Null: the session holds no token. */
  user?: string | null
  plays?: Record<number, ReturnType<typeof progress>>
  ratings?: ReturnType<typeof ratingItem>[]
  movieRatings?: ReturnType<typeof movieRatingItem>[]
  watchlist?: ReturnType<typeof watchlistItem>[]
  movieWatchlist?: ReturnType<typeof movieWatchlistItem>[]
  dropped?: number[]
  watchedMovies?: ReturnType<typeof watchedMovieItem>[]
  watchedShows?: ReturnType<typeof watchedShowItem>[]
  pageSize?: number
}

export const traktAnswer = <T>(body: T | null, { status = 200, retryAfter = null, pageCount = null }: { status?: number, retryAfter?: number | null, pageCount?: number | null } = {}): TraktPageAnswer<T> =>
  ({ kind: 'answer', status, body, retryAfter, pageCount })

export const fakeTrakt = ({
  user = 'viewer',
  plays = {},
  ratings = [],
  movieRatings = [],
  watchlist = [],
  movieWatchlist = [],
  dropped = [],
  watchedMovies = [],
  watchedShows = [],
  pageSize = 100,
}: FakeTraktOptions = {}) => {
  const state = {
    user,
    connected: true,
    plays: structuredClone(plays),
    ratings: structuredClone(ratings),
    movieRatings: structuredClone(movieRatings),
    watchlist: structuredClone(watchlist),
    movieWatchlist: structuredClone(movieWatchlist),
    dropped: [...dropped],
    watchedMovies: structuredClone(watchedMovies),
    watchedShows: structuredClone(watchedShows),
    activity: 1,
  }
  const log: string[] = []
  const posts: { path: string, body: unknown, once?: boolean }[] = []
  const listeners = new Set<() => void>()
  const held: { name: string, release: Promise<void> }[] = []
  const script: {
    get?: (path: string) => TraktPageAnswer | undefined
    post?: (path: string, body: unknown) => TraktPageAnswer | undefined
  } = {}

  const applyPost = (path: string, rawBody: unknown): TraktPageAnswer => {
    if (!state.user) return { kind: 'signed-out' }
    state.activity++
    const body = rawBody as {
      shows?: { ids: { trakt: number }, seasons?: { number: number, rating?: number, episodes?: { number: number, watched_at?: string }[] }[] }[]
      movies?: { ids: { trakt: number }, rating?: number, watched_at?: string }[]
    }
    if (path === '/users/hidden/dropped') {
      for (const s of body.shows ?? []) if (!state.dropped.includes(s.ids.trakt)) state.dropped.push(s.ids.trakt)
      return traktAnswer({ added: { shows: (body.shows ?? []).length } }, { status: 201 })
    }
    if (path === '/users/hidden/dropped/remove') {
      const ids = new Set((body.shows ?? []).map(s => s.ids.trakt))
      state.dropped = state.dropped.filter(id => !ids.has(id))
      return traktAnswer({ deleted: { shows: ids.size } }, { status: 200 })
    }
    if (path === '/sync/watchlist') {
      for (const s of body.shows ?? []) {
        if (s.seasons?.length) {
          for (const season of s.seasons) {
            if (!state.watchlist.some(w => w.type === 'season' && w.show.ids.trakt === s.ids.trakt && w.season?.number === season.number)) {
              state.watchlist.push(watchlistItem(s.ids.trakt, season.number))
            }
          }
        } else if (!state.watchlist.some(w => w.type === 'show' && w.show.ids.trakt === s.ids.trakt)) {
          state.watchlist.push(watchlistItem(s.ids.trakt))
        }
      }
      for (const m of body.movies ?? []) {
        if (!state.movieWatchlist.some(w => w.movie.ids.trakt === m.ids.trakt)) state.movieWatchlist.push(movieWatchlistItem(m.ids.trakt))
      }
      return traktAnswer({ added: { shows: 1 } }, { status: 201 })
    }
    if (path === '/sync/watchlist/remove') {
      for (const s of body.shows ?? []) {
        if (s.seasons?.length) {
          const nums = new Set(s.seasons.map(x => x.number))
          state.watchlist = state.watchlist.filter(w => !(w.show.ids.trakt === s.ids.trakt && w.type === 'season' && nums.has(w.season!.number)))
        } else {
          state.watchlist = state.watchlist.filter(w => w.show.ids.trakt !== s.ids.trakt)
        }
      }
      const rmMovies = new Set((body.movies ?? []).map(m => m.ids.trakt))
      if (rmMovies.size) state.movieWatchlist = state.movieWatchlist.filter(w => !rmMovies.has(w.movie.ids.trakt))
      return traktAnswer({ deleted: { shows: 1 } }, { status: 200 })
    }
    if (path === '/sync/ratings') {
      for (const s of body.shows ?? []) {
        for (const season of s.seasons ?? []) {
          state.ratings = state.ratings.filter(r => !(r.show.ids.trakt === s.ids.trakt && r.season.number === season.number))
          if (season.rating != null) state.ratings.push(ratingItem(s.ids.trakt, season.number, season.rating))
        }
      }
      for (const m of body.movies ?? []) {
        state.movieRatings = state.movieRatings.filter(r => r.movie.ids.trakt !== m.ids.trakt)
        if (m.rating != null) state.movieRatings.push(movieRatingItem(m.ids.trakt, m.rating))
      }
      return traktAnswer({ added: { seasons: 1 } }, { status: 201 })
    }
    if (path === '/sync/ratings/remove') {
      for (const s of body.shows ?? []) {
        const nums = new Set((s.seasons ?? []).map(x => x.number))
        state.ratings = state.ratings.filter(r => !(r.show.ids.trakt === s.ids.trakt && (!nums.size || nums.has(r.season.number))))
      }
      const rmMovies = new Set((body.movies ?? []).map(m => m.ids.trakt))
      if (rmMovies.size) state.movieRatings = state.movieRatings.filter(r => !rmMovies.has(r.movie.ids.trakt))
      return traktAnswer({ deleted: { seasons: 1 } }, { status: 200 })
    }
    if (path === '/sync/history' || path === '/sync/history/remove') {
      const add = path === '/sync/history'
      for (const s of body.shows ?? []) {
        const current = state.plays[s.ids.trakt] ?? progress({ 1: { watched: [], aired: 38 } })
        state.plays[s.ids.trakt] = current
        for (const reqSeason of s.seasons ?? []) {
          let target = current.seasons.find(cs => cs.number === reqSeason.number)
          if (!target) {
            const maxEp = Math.max(24, ...(reqSeason.episodes ?? []).map(e => e.number))
            target = progress({ [reqSeason.number]: { watched: [], aired: maxEp } }).seasons[0]!
            current.seasons.push(target)
          }
          for (const ep of reqSeason.episodes ?? []) {
            const existing = target.episodes.find(e => e.number === ep.number)
            if (existing) {
              existing.completed = add
              existing.last_watched_at = add ? (ep.watched_at ?? AT) : null
            }
          }
          target.completed = target.episodes.filter(e => e.completed).length
        }
      }
      for (const m of body.movies ?? []) {
        state.watchedMovies = state.watchedMovies.filter(wm => wm.movie.ids.trakt !== m.ids.trakt)
        if (add) state.watchedMovies.push(watchedMovieItem(m.ids.trakt, m.watched_at ?? AT))
      }
      return traktAnswer(add ? { added: { episodes: 1 } } : { deleted: { episodes: 1 } }, { status: add ? 201 : 200 })
    }
    return traktAnswer({ error: 'not found' }, { status: 404 })
  }

  const get = (path: string): TraktPageAnswer => {
    if (!state.user) return { kind: 'signed-out' }
    const [route, query = ''] = path.split('?')
    const params = new URLSearchParams(query)
    if (route === '/users/settings') return traktAnswer({ user: { username: state.user } })
    if (route === '/sync/last_activities') {
      const stamp = `2026-10-0${state.activity}T00:00:00.000Z`
      return traktAnswer({
        all: stamp,
        shows: { watchlisted_at: stamp, dropped_at: stamp, hidden_at: stamp },
        seasons: { rated_at: stamp, watchlisted_at: stamp },
        episodes: { watched_at: stamp },
        movies: { rated_at: stamp, watchlisted_at: stamp, watched_at: stamp },
      })
    }
    if (route === '/sync/ratings/seasons') return traktAnswer(state.ratings)
    if (route === '/sync/ratings/movies') return traktAnswer(state.movieRatings)
    if (route === '/sync/watchlist/shows') return traktAnswer(state.watchlist.filter(item => item.type === 'show'))
    if (route === '/sync/watchlist/seasons') return traktAnswer(state.watchlist.filter(item => item.type === 'season'))
    if (route === '/sync/watchlist/movies') return traktAnswer(state.movieWatchlist)
    if (route === '/sync/watched/movies') return traktAnswer(state.watchedMovies)
    if (route === '/sync/watched/shows') return traktAnswer(state.watchedShows)
    if (route === '/users/hidden/dropped') {
      const page = Number(params.get('page'))
      const limit = Math.min(pageSize, Number(params.get('limit')))
      return traktAnswer(droppedPage(state.dropped.slice((page - 1) * limit, page * limit)), {
        pageCount: state.dropped.length === 0 ? 0 : Math.ceil(state.dropped.length / limit),
      })
    }
    const show = /^\/shows\/(\d+)\/progress\/watched$/.exec(route!)?.[1]
    if (show) return traktAnswer(state.plays[Number(show)] ?? progress({}))
    return traktAnswer({ error: 'not found' }, { status: 404 })
  }

  const call = vi.fn(async (method: string, arg: unknown, options?: { once?: boolean }): Promise<SiteSessionResult<TraktPageAnswer>> => {
    const path = method === 'whoami' ? '/users/settings' : (arg as { path: string }).path
    const name = method === 'whoami' ? 'whoami'
      : method === 'post' ? `POST ${path}`
      : path.split('?')[0]!.replace(/^\/shows\/\d+\//, '/shows/:id/')
    log.push(name)
    if (method === 'post') posts.push({ path, body: (arg as { body: unknown }).body, once: options?.once })
    if (!state.connected) return { kind: 'not-connected' }
    const response = method === 'post'
      ? (script.post?.(path, (arg as { body: unknown }).body) ?? applyPost(path, (arg as { body: unknown }).body))
      : (script.get?.(path) ?? get(path))
    const hold = held.findIndex(entry => entry.name === name)
    if (hold !== -1) await held.splice(hold, 1)[0]!.release
    if (method !== 'whoami' || response.kind !== 'answer') return { kind: 'response', response }
    return { kind: 'response', response: { ...response, body: (response.body as { user?: { username?: string } } | null)?.user?.username ?? null } }
  })

  return {
    state,
    script,
    log,
    posts,
    session: { call, onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    changed: () => { for (const listener of listeners) listener() },
    holdNext: (name: string) => {
      let release!: () => void
      held.push({ name, release: new Promise<void>(resolve => { release = resolve }) })
      return () => release()
    },
  }
}

const SAVED: Record<string, string> = {
  'https://apiz.trakt.tv/search/tvdb/424536?type=show': 'search-tvdb-424536.json',
  'https://apiz.trakt.tv/search/tvdb/267440?type=show': 'search-tvdb-267440.json',
  'https://apiz.trakt.tv/search/imdb/tt13706018?type=movie,show': 'search-imdb-tt13706018.json',
  'https://apiz.trakt.tv/shows/198225/seasons?extended=episodes': 'seasons-198225.json',
  'https://apiz.trakt.tv/shows/1420/seasons?extended=episodes': 'seasons-1420.json',
  'https://apiz.trakt.tv/shows/190742/seasons?extended=episodes': 'seasons-190742.json',
}

const DUNE_SEARCH = [{ type: 'movie', movie: { title: 'Dune', year: 2021, ids: { trakt: 486228, slug: 'dune-2021', imdb: 'tt1160419', tmdb: 438631 } } }]

/** The worker's public fetch over the saved answers, ani.zip's by AniList id, and synthetic movie search. */
export const publicReads = () => {
  const asked: string[] = []
  let failing = false
  const fetch = vi.fn(async (url: string) => {
    asked.push(url)
    if (failing) return new Response('<html>not here</html>', { status: 502 })
    if (url === 'https://apiz.trakt.tv/search/tmdb/438631?type=movie' || url === 'https://apiz.trakt.tv/search/imdb/tt1160419?type=movie,show') {
      return new Response(JSON.stringify(DUNE_SEARCH), { status: 200 })
    }
    const run = /^https:\/\/api\.ani\.zip\/mappings\?anilist_id=(\d+)&specials=1$/.exec(url)?.[1]
    const file = run ? `anizip-${run}.json` : SAVED[url]
    if (!file) return new Response('<html>not here</html>', { status: 404 })
    return new Response(readFileSync(`${DIR}/${file}`, 'utf8'), { status: 200 })
  })
  return { fetch, asked, fail: (on: boolean) => { failing = on } }
}
