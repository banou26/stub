// The Trakt tracker served the way every provider is, over a fake session on a hand-made Trakt
// (./fake-trakt.ts) and the saved public answers that place a media.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { CatalogLookup } from '../../../../src/tracking/identity'

import { DROPPED_MAX_PAGES, DROPPED_PAGE_LIMIT, INDEX_TTL_MS, traktTrackerResolvers } from '../../../../src/sources/trakt/tracker-resolvers'
import { RETRY_MS } from '../../../../src/tracking/collect'
import { DELETE_LIST_ENTRY_DOCUMENT, LISTS_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../../src/worker/tracking-document'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'
import { inEnglish } from '../../in-english'
import {
  fakeTrakt, movieRatingItem, progress, publicReads, ratingItem, traktAnswer, watchedMovieItem, watchedShowItem, watchlistItem,
  type FakeTraktOptions,
} from './fake-trakt'

const ROWS = [
  { mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 },
  { mal: 59978, anilist: 182255, kitsu: 49240, anidb: 18886 },
  { mal: 40028, anilist: 110277, kitsu: 42422, anidb: 14977 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => ROWS.find(row => row[origin] === id) }

const FIRST_RUN = 'ag:(anilist:154587)'
const SECOND_RUN = 'ag:(mal:59978)'
const TITAN = 'ag:(anilist:110277)'
const DUNE = 'ag:(tmdb:movie-438631,omdb:tt1160419)'
const FRIEREN = 198225

const WATCHED = { [FRIEREN]: progress({ 1: { watched: Array.from({ length: 31 }, (_, n) => n + 1), aired: 38, at: '2026-01-30T15:00:00.000Z' } }) }

const setup = (options: FakeTraktOptions = {}) => {
  let at = 1_790_000_000_000
  const waits: number[] = []
  const trakt = fakeTrakt({ plays: WATCHED, ...options })
  const resolvers = traktTrackerResolvers({ now: () => at, wait: async ms => { waits.push(ms); at += ms } })
  const reads = publicReads()
  const target = providerServer('trakt', resolvers, { catalog: async () => catalog, session: () => trakt.session, fetch: reads.fetch })
  return { ...trakt, reads, target, waits, advance: (ms: number) => { at += ms } }
}

type Target = ReturnType<typeof setup>['target']

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const watch = (target: Target, uri: string) => {
  const subscription = subscribe(target, TRACKING_DOCUMENT, { input: { uri } })
  live.push(subscription)
  return subscription
}

const watchLists = (target: Target) => {
  const subscription = subscribe(target, LISTS_DOCUMENT, {})
  live.push(subscription)
  return subscription
}

const answerOfResult = (result: any) => result.data.tracking.answers[0]
const first = async (target: Target, uri: string) => answerOfResult(await watch(target, uri).next())
const save = async (target: Target, uri: string, entry: Record<string, unknown>) =>
  (await yogaClient(target).mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['trakt'], entry } }).toPromise()).data.saveListEntry[0]
const remove = async (target: Target, uri: string) =>
  (await yogaClient(target).mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['trakt'] } }).toPromise()).data.deleteListEntry[0]

test('is one of the trackers, under the name and scale its answers carry', async () => {
  const { trakt } = await import('../../../../src/sources/trackers')
  expect(trakt).toMatchObject({ origin: 'trakt', name: 'Trakt', scoreScale: 'POINT_10', isApiOnly: true })
})

const LISTS = [
  'whoami',
  '/sync/last_activities',
  '/sync/ratings/seasons',
  '/sync/ratings/movies',
  '/sync/watchlist/shows',
  '/sync/watchlist/seasons',
  '/sync/watchlist/movies',
  '/users/hidden/dropped',
  '/sync/watched/movies',
]

describe('what the Trakt tracker answers', () => {
  test("LISTED with the run's own share of Trakt's season, the viewer's account, ten points, and writable", async () => {
    const { target, log } = setup({ ratings: [ratingItem(FRIEREN, 1, 9)] })
    expect(await first(target, SECOND_RUN)).toMatchObject({
      state: 'LISTED',
      tracker: { id: 'trakt', name: 'Trakt', signedIn: true, account: 'viewer', canWrite: true, scoreScale: 'POINT_10' },
      episodeCount: 10,
      entry: { _id: 'trakt:viewer:198225-s1e29-38', status: 'WATCHING', progress: 3, score: 90, episodeCount: 10, url: 'https://app.trakt.tv/shows/frieren-beyond-journey-s-end/seasons/1' },
    })
    expect(log).toEqual([...LISTS, '/shows/:id/progress/watched'])
  })

  test('the first run of the same season reads COMPLETED, and movies read off movie lists', async () => {
    const { target } = setup({ watchedMovies: [watchedMovieItem(486228)], movieRatings: [movieRatingItem(486228, 9)] })
    expect(await first(target, FIRST_RUN)).toMatchObject({ state: 'LISTED', entry: { status: 'COMPLETED', progress: 28, episodeCount: 28 } })
    expect(await first(target, DUNE)).toMatchObject({ state: 'LISTED', episodeCount: 1, entry: { status: 'COMPLETED', progress: 1, score: 90 } })
  })

  test("NOT_LISTED, with Trakt's count, when Trakt holds nothing of the run", async () => {
    const { target } = setup()
    expect(await first(target, TITAN)).toMatchObject({ state: 'NOT_LISTED', entry: null, episodeCount: 16, tracker: { account: 'viewer' } })
  })

  test('PLANNING off the watchlist, DROPPED off the dropped list', async () => {
    expect(await first(setup({ watchlist: [watchlistItem(1420, 4)] }).target, TITAN)).toMatchObject({ entry: { status: 'PLANNING' } })
    expect(await first(setup({ dropped: [1420] }).target, TITAN)).toMatchObject({ entry: { status: 'DROPPED' } })
  })

  test('SIGNED_OUT when the session holds no token, and nothing places the media', async () => {
    const { target, log, reads } = setup({ user: null })
    expect(await first(target, SECOND_RUN)).toMatchObject({ state: 'SIGNED_OUT', tracker: { signedIn: false, account: null, canWrite: false } })
    expect(log).toEqual(['whoami'])
    expect(reads.asked).toEqual([])
  })

  test('SIGNED_OUT when the viewer never connected Trakt here', async () => {
    const { target, state, reads } = setup()
    state.connected = false
    expect((await first(target, SECOND_RUN)).state).toBe('SIGNED_OUT')
    expect(reads.asked).toEqual([])
  })

  test("AMBIGUOUS where stub's own tracker is, and NO_ID with nothing to ask by, asking nothing either way", async () => {
    const { target, log, reads } = setup()
    expect(await first(target, 'ag:(anilist:154587,mal:59978)')).toMatchObject({ state: 'AMBIGUOUS', candidates: ['anilist:154587', 'mal:59978'] })
    expect((await first(target, 'ag:(cr:GG5H5XQX4)')).state).toBe('NO_ID')
    expect(log).toEqual([])
    expect(reads.asked).toEqual([])
  })

  test('NO_ID, saying why, for a media Trakt has no range for', async () => {
    const { target } = setup()
    expect(await first(target, 'ag:(imdb:tt13706018)')).toMatchObject({ state: 'NO_ID', error: inEnglish('Trakt keeps this show in seasons: open one of them'), tracker: { account: 'viewer' } })
  })
})

describe('writes, removals and viewerLists', () => {
  test('saving progress on a show adds plays once, skips reloading lists when only history changed, and notifies subscribers', async () => {
    const { target, log, posts } = setup()
    const tracking = watch(target, SECOND_RUN)
    expect(answerOfResult(await tracking.next()).entry.progress).toBe(3)

    log.length = 0
    const saved = await save(target, SECOND_RUN, { progress: 5 })
    expect(saved).toMatchObject({ outcome: 'SAVED', entry: { status: 'WATCHING', progress: 5 } })
    expect(posts).toEqual([{
      path: '/sync/history',
      body: { shows: [{ ids: { trakt: FRIEREN }, seasons: [{ number: 1, episodes: [32, 33].map(number => ({ number, watched_at: expect.any(String) })) }] }] },
      once: true,
    }])
    // skips full list reload when only history changed
    expect(log.filter(x => x === '/sync/ratings/seasons')).toHaveLength(0)
    expect(answerOfResult(await tracking.next()).entry).toMatchObject({ progress: 5 })
  })

  test('lowering progress removes trailing plays, and Remove from list removes rating/watchlist/dropped without touching plays', async () => {
    const { target, posts } = setup({ ratings: [ratingItem(FRIEREN, 1, 8)], watchlist: [watchlistItem(FRIEREN, 1)], dropped: [FRIEREN] })
    const removed = await remove(target, SECOND_RUN)
    expect(removed).toEqual({ tracker: 'trakt', outcome: 'SAVED', error: null, entry: null })
    expect(posts.map(p => p.path)).toEqual(['/users/hidden/dropped/remove', '/sync/watchlist/remove', '/sync/ratings/remove'])

    const lowered = await save(target, SECOND_RUN, { progress: 1 })
    expect(lowered).toMatchObject({ outcome: 'SAVED', entry: { status: 'WATCHING', progress: 1 } })
    expect(posts.at(-1)?.path).toBe('/sync/history/remove')
  })

  test('saving on a movie writes watchlist/history/rating and reports 420 list limit error', async () => {
    const { target, script } = setup()
    expect(await save(target, DUNE, { status: 'COMPLETED', score: 90 })).toMatchObject({
      outcome: 'SAVED',
      entry: { status: 'COMPLETED', progress: 1, score: 90 },
    })

    script.post = path => path === '/sync/watchlist' ? traktAnswer({ error: 'Account limit exceeded' }, { status: 420 }) : undefined
    expect(await save(target, DUNE, { status: 'PLANNING', progress: 0 })).toMatchObject({
      outcome: 'FAILED',
      error: inEnglish('Trakt refused the save: free account list limit reached'),
    })
  })

  test('refuses unsupported statuses on writes cleanly', async () => {
    const { target } = setup()
    expect(await save(target, SECOND_RUN, { status: 'PAUSED' })).toMatchObject({ outcome: 'REFUSED', error: inEnglish('Trakt has no Paused status') })
    expect(await save(target, DUNE, { status: 'DROPPED' })).toMatchObject({ outcome: 'REFUSED', error: inEnglish('Trakt does not support Dropping movies') })
  })

  test('viewerLists serves both watched/listed shows and movies, updating after writes', async () => {
    const { target } = setup({
      watchedShows: [watchedShowItem(190742, { 1: [1, 2] })],
      ratings: [ratingItem(190742, 1, 8)],
      watchedMovies: [watchedMovieItem(486228)],
    })
    const lists = watchLists(target)
    const initial = (await lists.next()).data.viewerLists.lists[0]
    expect(initial.state).toBe('LISTED')
    expect(initial.items.map((i: any) => i.entry._id).sort()).toEqual(['trakt:viewer:movie-486228', 'trakt:viewer:s:190742:1'])

    await save(target, DUNE, { score: 100 })
    const refreshed = (await lists.next()).data.viewerLists.lists[0]
    expect(refreshed.items.find((i: any) => i.entry._id === 'trakt:viewer:movie-486228').entry.score).toBe(100)
  })
})

describe('a read that failed is never NOT_LISTED', () => {
  const DROPPED_ON_PAGE_2 = [...Array.from({ length: DROPPED_PAGE_LIMIT }, (_, n) => n + 1), FRIEREN]

  test.each([
    ['whoami', (path: string) => path === '/users/settings'],
    ['the season ratings', (path: string) => path === '/sync/ratings/seasons'],
    ['the show watchlist', (path: string) => path === '/sync/watchlist/shows'],
    ['the season watchlist', (path: string) => path === '/sync/watchlist/seasons'],
    ["the dropped list's second page", (path: string) => path.startsWith('/users/hidden/dropped?page=2&')],
    ["the show's progress", (path: string) => path.startsWith('/shows/')],
  ])('a 5xx on %s answers ERROR', async (_name, failing) => {
    expect(await first(setup({ dropped: DROPPED_ON_PAGE_2 }).target, SECOND_RUN), 'nothing failing').toMatchObject({ state: 'LISTED', entry: { status: 'DROPPED' } })

    const { target, script } = setup({ dropped: DROPPED_ON_PAGE_2 })
    script.get = path => failing(path) ? traktAnswer(null, { status: 503 }) : undefined
    expect(await first(target, SECOND_RUN)).toMatchObject({ state: 'ERROR', error: inEnglish('Trakt answered 503') })
  })

  test.each(['/sync/ratings/seasons', '/sync/watchlist/shows', '/sync/watchlist/seasons', '/users/hidden/dropped'])('%s answering something other than a list answers ERROR', async list => {
    const { target, script } = setup({ dropped: [FRIEREN] })
    script.get = path => path.split('?')[0] === list ? traktAnswer({ error: 'not a list' }) : undefined
    expect(await first(target, SECOND_RUN)).toMatchObject({ state: 'ERROR', error: inEnglish('Trakt answered something other than a list') })
  })
})

describe('what it asks, and how often', () => {
  test('the lists serve every media for INDEX_TTL_MS; each answer reads its show progress', async () => {
    const { target, log } = setup()
    expect(await first(target, SECOND_RUN)).toMatchObject({ episodeCount: 10, entry: { _id: 'trakt:viewer:198225-s1e29-38', progress: 3 } })
    expect(await first(target, FIRST_RUN)).toMatchObject({ episodeCount: 28, entry: { _id: 'trakt:viewer:198225-s1e1-28', progress: 28 } })
    expect(log).toEqual([...LISTS, '/shows/:id/progress/watched', '/shows/:id/progress/watched'])
  })

  test('once INDEX_TTL_MS passed, last_activities says whether the lists are read again', async () => {
    const { target, log, advance, state } = setup()
    await first(target, SECOND_RUN)
    log.length = 0

    advance(INDEX_TTL_MS)
    await first(target, SECOND_RUN)
    expect(log, 'nothing changed').toEqual(['whoami', '/sync/last_activities', '/shows/:id/progress/watched'])

    log.length = 0
    advance(INDEX_TTL_MS)
    state.activity = 2
    await first(target, SECOND_RUN)
    expect(log).toEqual([...LISTS, '/shows/:id/progress/watched'])
  })

  test('places each media once: ani.zip, TVDB lookup and season listing are not asked again', async () => {
    const { target, reads } = setup()
    await first(target, SECOND_RUN)
    await first(target, 'ag:(anilist:182255)')
    expect(reads.asked).toEqual([
      'https://api.ani.zip/mappings?anilist_id=182255&specials=1',
      'https://apiz.trakt.tv/search/tvdb/424536?type=show',
      'https://apiz.trakt.tv/shows/198225/seasons?extended=episodes',
    ])
  })

  test('a placing that failed answers ERROR and is asked again', async () => {
    const { target, reads } = setup()
    reads.fail(true)
    expect((await first(target, SECOND_RUN)).state).toBe('ERROR')
    reads.fail(false)
    expect((await first(target, SECOND_RUN)).state).toBe('LISTED')

    await first(target, 'ag:(imdb:tt13706018)')
    const asked = reads.asked.length
    expect((await first(target, 'ag:(imdb:tt13706018)')).state).toBe('NO_ID')
    expect(reads.asked).toHaveLength(asked)
  })

  test('pages the dropped list by the page count Trakt names, capped at DROPPED_MAX_PAGES', async () => {
    const paged = setup({ dropped: [...Array.from({ length: DROPPED_PAGE_LIMIT }, (_, n) => n + 1), 1420] })
    expect(await first(paged.target, TITAN)).toMatchObject({ entry: { status: 'DROPPED' } })
    expect(paged.log.filter(path => path === '/users/hidden/dropped')).toHaveLength(2)

    const capped = setup()
    capped.script.get = path => path.startsWith('/users/hidden/dropped?') ? traktAnswer([], { pageCount: 10_000 }) : undefined
    expect((await first(capped.target, TITAN)).state).toBe('NOT_LISTED')
    expect(capped.log.filter(path => path === '/users/hidden/dropped')).toHaveLength(DROPPED_MAX_PAGES)
  })

  test('a token Trakt no longer takes reads SIGNED_OUT', async () => {
    const { target, log, script } = setup()
    await first(target, SECOND_RUN)
    script.get = path => path.startsWith('/shows/') ? traktAnswer(null, { status: 401 }) : undefined
    expect((await first(target, SECOND_RUN)).state).toBe('SIGNED_OUT')

    script.get = undefined
    log.length = 0
    expect((await first(target, SECOND_RUN)).state).toBe('LISTED')
    expect(log[0]).toBe('whoami')
  })

  test('a read a sign in landed under is never kept, and is made again', async () => {
    const { target, state, changed, log, holdNext } = setup()
    const release = holdNext('/sync/ratings/seasons')
    const tracking = watch(target, SECOND_RUN)
    await vi.waitFor(() => expect(log).toContain('/sync/ratings/seasons'))

    state.ratings = [ratingItem(FRIEREN, 1, 9)]
    changed()
    release()

    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'LISTED', entry: { score: 90 } })
    expect(log).toEqual([...LISTS, ...LISTS, '/shows/:id/progress/watched'])
  })

  test('a sign in reads open answers again', async () => {
    const { target, state, changed } = setup({ user: null })
    const tracking = watch(target, SECOND_RUN)
    expect(answerOfResult(await tracking.next()).state).toBe('SIGNED_OUT')

    state.user = 'someone'
    changed()
    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'LISTED', tracker: { account: 'someone' } })
  })
})

describe('when Trakt asks stub to wait', () => {
  test("answers PAUSED, waits out the Retry-After, then reads again", async () => {
    const { target, script, waits } = setup()
    let refused = false
    script.get = path => path.startsWith('/shows/') && !refused ? (refused = true, traktAnswer(null, { status: 429, retryAfter: 20 })) : undefined
    const tracking = watch(target, SECOND_RUN)

    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'PAUSED', error: inEnglish(expect.stringContaining('Trakt asked stub to wait until')) })
    expect(answerOfResult(await tracking.next()).state).toBe('LISTED')
    expect(waits).toEqual([20_000])
  })

  test('an error is read again after RETRY_MS', async () => {
    const { target, script, waits } = setup()
    let failed = false
    script.get = path => path === '/sync/last_activities' && !failed ? (failed = true, traktAnswer(null, { status: 502 })) : undefined
    const tracking = watch(target, SECOND_RUN)

    expect(answerOfResult(await tracking.next())).toMatchObject({ state: 'ERROR', error: inEnglish('Trakt answered 502') })
    expect(answerOfResult(await tracking.next()).state).toBe('LISTED')
    expect(waits).toEqual([RETRY_MS])
  })
})
