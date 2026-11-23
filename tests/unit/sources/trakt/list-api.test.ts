// What the Trakt tracker reads off each answer, how show/movie entries map onto stub entries and list
// items, and how writes and removals plan POST payloads.
import { describe, expect, test } from 'vite-plus/test'

import type { TraktRange } from '../../../../src/sources/trakt/identity'

import {
  activitiesOf, buildLists, droppedOf, listEntryOf, listEntryOfMovie, listItemsOf,
  planMovieRemove, planMovieWrite, planShowRemove, planShowWrite, ratingsOf, readAnswer, readList,
  statusOf, traktTracker, watchlistOf,
} from '../../../../src/sources/trakt/list-api'
import { inEnglish } from '../../in-english'
import { droppedPage, movieRatingItem, movieWatchlistItem, progress, ratingItem, watchedMovieItem, watchedShowItem, watchlistItem } from './fake-trakt'

const answer = (status: number, body: unknown = {}, retryAfter: number | null = null) => ({ kind: 'answer' as const, status, body, retryAfter, pageCount: null })

const emptyLists = () => buildLists({
  ratingsSeasons: [],
  ratingsMovies: [],
  watchlistShows: [],
  watchlistSeasons: [],
  watchlistMovies: [],
  dropped: [],
  watchedMovies: [],
})

describe('one answer', () => {
  test('a 2xx with a body is data, 401 is signed out, 429 is blocked, 420 is free list limit error', () => {
    expect(readAnswer(answer(200, { a: 1 }))).toEqual({ kind: 'data', data: { a: 1 } })
    expect(readAnswer(answer(401, null))).toEqual({ kind: 'signed-out' })
    expect(readAnswer({ kind: 'signed-out' })).toEqual({ kind: 'signed-out' })
    expect(readAnswer(answer(429, null, 30))).toEqual({ kind: 'blocked', retryAfter: 30 })
    expect(readAnswer(answer(420, null))).toMatchObject({ kind: 'error', message: inEnglish('Trakt refused the save: free account list limit reached') })
  })

  test('anything else is an error that says what answered', () => {
    expect(readAnswer(answer(500, null))).toMatchObject({ kind: 'error', message: inEnglish('Trakt answered 500') })
    expect(readAnswer(answer(200, null))).toMatchObject({ kind: 'error', message: inEnglish('Trakt answered 200 with nothing stub could read') })
    expect(readAnswer({ kind: 'no-session', status: 403 })).toMatchObject({ kind: 'error', message: inEnglish('app.trakt.tv answered 403 with no session stub could read') })
  })

  test('a list read is an array, and anything else is an error, never an empty list', () => {
    expect(readList(answer(200, []))).toEqual({ kind: 'data', data: [] })
    expect(readList(answer(200, { error: 'not a list' }))).toMatchObject({ kind: 'error', message: inEnglish('Trakt answered something other than a list') })
    expect(readList(answer(429, null, 30))).toEqual({ kind: 'blocked', retryAfter: 30 })
  })
})

describe('the lists', () => {
  test('season ratings, watchlist and dropped shows', () => {
    expect(ratingsOf([ratingItem(198225, 1, 9), { rating: 7, type: 'show', show: { ids: { trakt: 198225 } } }, ratingItem(1, 1, 11), null, 'x']))
      .toEqual(new Map([['198225:1', 9]]))
    expect(watchlistOf([watchlistItem(190742)], [watchlistItem(1420, 4)])).toEqual(new Set(['190742', '1420:4']))
    expect(droppedOf(droppedPage([198225, 1420]))).toEqual([198225, 1420])
  })

  test('last_activities moves when show/season/episode/movie stamps move', () => {
    const at = () => ({
      shows: { watchlisted_at: 'w', dropped_at: 'd', hidden_at: 'h' },
      seasons: { rated_at: 'r', watchlisted_at: 'sw' },
      episodes: { watched_at: 'ew' },
      movies: { rated_at: 'mr', watchlisted_at: 'mw', watched_at: 'mwa' },
    })
    for (const stamp of ['seasons.rated_at', 'seasons.watchlisted_at', 'shows.watchlisted_at', 'shows.dropped_at', 'shows.hidden_at', 'episodes.watched_at', 'movies.rated_at', 'movies.watchlisted_at', 'movies.watched_at']) {
      const moved: Record<string, Record<string, string>> = at()
      const [group, field] = stamp.split('.') as [string, string]
      moved[group]![field] = 'later'
      expect(activitiesOf(moved)).not.toBe(activitiesOf(at()))
    }
    expect(activitiesOf({})).toBeUndefined()
  })
})

describe("a run's status and tracker capabilities", () => {
  const base = { dropped: false, rewatching: false, watched: 0, total: 10, planned: false }
  test.each([
    [{ dropped: true, watched: 10, planned: true }, 'DROPPED'],
    [{ dropped: true, rewatching: true, watched: 3 }, 'DROPPED'],
    [{ rewatching: true, watched: 3 }, 'REWATCHING'],
    [{ rewatching: true, watched: 10 }, 'COMPLETED'],
    [{ watched: 10 }, 'COMPLETED'],
    [{ watched: 4, planned: true }, 'WATCHING'],
    [{ planned: true }, 'PLANNING'],
    [{}, null],
  ])('%o is %s', (over, status) => {
    expect(statusOf({ ...base, ...over })).toBe(status)
  })

  test('traktTracker enables writes when signed in and exposes no partial status cap', () => {
    expect(traktTracker('viewer')).toMatchObject({ id: 'trakt', signedIn: true, canWrite: true, account: 'viewer', scoreScale: 'POINT_10' })
    expect(traktTracker()).toMatchObject({ signedIn: false, canWrite: false, account: null })
  })
})

describe('entries and viewerLists items', () => {
  const SECOND_RUN: TraktRange = { show: { trakt: 198225, slug: 'frieren-beyond-journey-s-end', title: 'Frieren' }, season: 1, from: 29, to: 38 }
  const DUNE = { trakt: 486228, slug: 'dune-2021', title: 'Dune' }

  test('counts only the run episodes, handles updatedAt and status priorities', () => {
    const body = progress({ 1: { watched: [...Array.from({ length: 28 }, (_, n) => n + 1), 29, 30, 31], aired: 38, at: '2026-01-30T15:00:00.000Z' } })
    const lists = buildLists({ ratingsSeasons: [ratingItem(198225, 1, 8)], ratingsMovies: [], watchlistShows: [], watchlistSeasons: [], watchlistMovies: [], dropped: [], watchedMovies: [] })
    expect(listEntryOf('viewer', SECOND_RUN, body, lists)).toEqual({
      _id: 'trakt:viewer:198225-s1e29-38',
      tracker: 'trakt',
      mediaUri: 'trakt:198225-s1e29-38',
      status: 'WATCHING',
      progress: 3,
      score: 80,
      startedAt: null,
      completedAt: null,
      rewatchCount: null,
      updatedAt: '2026-01-30T15:00:00.000Z',
      url: 'https://app.trakt.tv/shows/frieren-beyond-journey-s-end/seasons/1',
      title: 'Frieren',
      cover: null,
      episodeCount: 10,
    })
  })

  test('maps movies and viewerLists items across shows and movies', () => {
    const lists = buildLists({
      ratingsSeasons: [ratingItem(190742, 1, 8)],
      ratingsMovies: [movieRatingItem(486228, 9)],
      watchlistShows: [watchlistItem(1420)],
      watchlistSeasons: [],
      watchlistMovies: [movieWatchlistItem(777)],
      dropped: [1420],
      droppedItems: droppedPage([1420]),
      watchedMovies: [watchedMovieItem(486228)],
    })
    expect(listEntryOfMovie('viewer', DUNE, lists)).toMatchObject({
      _id: 'trakt:viewer:movie-486228',
      status: 'COMPLETED',
      progress: 1,
      score: 90,
      episodeCount: 1,
      url: 'https://app.trakt.tv/movies/dune-2021',
    })

    const items = listItemsOf('viewer', lists, [watchedShowItem(190742, { 1: [1, 2, 3] })])
    expect(items.find(i => i.entry._id === 'trakt:viewer:s:190742:1')).toMatchObject({
      type: 'TV',
      entry: { status: 'WATCHING', progress: 3, score: 80, mediaUri: 'tmdb:1907420-s1' },
    })
    expect(items.find(i => i.entry._id === 'trakt:viewer:show:1420')).toMatchObject({
      type: 'TV',
      entry: { status: 'DROPPED', mediaUri: 'tmdb:14200-s1' },
    })
    expect(items.find(i => i.entry._id === 'trakt:viewer:movie-486228')).toMatchObject({
      type: 'MOVIE',
      episodeCount: 1,
      entry: { status: 'COMPLETED', progress: 1, score: 90, mediaUri: 'omdb:tt9486228' },
    })
    expect(items.find(i => i.entry._id === 'trakt:viewer:movie-777')).toMatchObject({
      type: 'MOVIE',
      entry: { status: 'PLANNING', progress: 0 },
    })
  })
})

describe('write and removal planning', () => {
  const RUN: TraktRange = { show: { trakt: 198225, slug: 'frieren', title: 'Frieren' }, season: 1, from: 29, to: 38 }
  const DUNE = { trakt: 486228, slug: 'dune-2021', title: 'Dune' }
  const NOW = '2026-11-23T12:00:00.000Z'

  test('refuses PAUSED, REWATCHING, bad numbers, Watching at 0, Planning above 0, and Dropped movies', () => {
    const empty = emptyLists()
    const prog = progress({ 1: { watched: [29], aired: 38 } })
    expect(planShowWrite(RUN, prog, empty, { status: 'PAUSED' }, NOW)).toMatchObject({ error: inEnglish('Trakt has no Paused status') })
    expect(planShowWrite(RUN, prog, empty, { status: 'REWATCHING' }, NOW)).toMatchObject({ error: inEnglish('Trakt rewatching can only be started on Trakt itself') })
    expect(planShowWrite(RUN, prog, empty, { status: 'WATCHING', progress: 0 }, NOW)).toMatchObject({ error: inEnglish('Watch at least one episode to mark as Watching on Trakt') })
    expect(planShowWrite(RUN, prog, empty, { status: 'PLANNING' }, NOW)).toMatchObject({ error: inEnglish('Lower progress to 0 on Trakt before moving it to Planning') })
    expect(planShowWrite(RUN, prog, empty, { progress: 11 }, NOW)).toMatchObject({ error: inEnglish('Trakt lists only 10 episodes in this run') })
    expect(planMovieWrite(DUNE, empty, { status: 'DROPPED' }, NOW)).toMatchObject({ error: inEnglish('Trakt does not support Dropping movies') })
  })

  test('plans adding plays, removing trailing plays, rating, dropped, and Remove preserving history', () => {
    const empty = emptyLists()
    expect(planShowWrite(RUN, progress({ 1: { watched: [29], aired: 38 } }), empty, { progress: 3, score: 80 }, NOW)).toEqual({
      steps: [
        { path: '/sync/history', body: { shows: [{ ids: { trakt: 198225 }, seasons: [{ number: 1, episodes: [{ number: 30, watched_at: NOW }, { number: 31, watched_at: NOW }] }] }] } },
        { path: '/sync/ratings', body: { shows: [{ ids: { trakt: 198225 }, seasons: [{ number: 1, rating: 8 }] }] } },
      ],
    })

    expect(planShowWrite(RUN, progress({ 1: { watched: [29, 30, 31], aired: 38 } }), empty, { progress: 1 }, NOW)).toEqual({
      steps: [
        { path: '/sync/history/remove', body: { shows: [{ ids: { trakt: 198225 }, seasons: [{ number: 1, episodes: [{ number: 30 }, { number: 31 }] }] }] } },
      ],
    })

    const listed = buildLists({
      ratingsSeasons: [ratingItem(198225, 1, 9)],
      ratingsMovies: [movieRatingItem(486228, 8)],
      watchlistShows: [],
      watchlistSeasons: [watchlistItem(198225, 1)],
      watchlistMovies: [movieWatchlistItem(486228)],
      dropped: [198225],
      watchedMovies: [],
    })
    expect(planShowRemove(RUN, listed)).toEqual([
      { path: '/users/hidden/dropped/remove', body: { shows: [{ ids: { trakt: 198225 } }] } },
      { path: '/sync/watchlist/remove', body: { shows: [{ ids: { trakt: 198225 }, seasons: [{ number: 1 }] }] } },
      { path: '/sync/ratings/remove', body: { shows: [{ ids: { trakt: 198225 }, seasons: [{ number: 1 }] }] } },
    ])
    expect(planMovieRemove(DUNE, listed)).toEqual([
      { path: '/sync/watchlist/remove', body: { movies: [{ ids: { trakt: 486228 } }] } },
      { path: '/sync/ratings/remove', body: { movies: [{ ids: { trakt: 486228 } }] } },
    ])
  })
})
