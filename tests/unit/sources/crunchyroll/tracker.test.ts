// The Crunchyroll tracker served the way every provider is, over a fake session that answers what the
// Crunchyroll page script answers (./watched-fixtures.ts says what was recorded), and asked the
// questions the app asks it.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { SaveAnswer, SaveRequest, WatchedAnswer } from '../../../../src/sources/crunchyroll/session-page'
import type { TrackerAnswer } from '../../../../src/generated/schema/types.generated'
import type { CallOptions, SiteSessionResult } from '../../../../src/tracking/site-session'

import { readWatched, saveWatched } from '../../../../src/sources/crunchyroll/session-page'
import { crunchyrollTrackerResolvers } from '../../../../src/sources/crunchyroll/tracker-resolvers'
import { aggregateTracking } from '../../../../src/tracking/aggregate'
import { RETRY_MS } from '../../../../src/tracking/collect'
import { CallInterrupted } from '../../../../src/tracking/session-frames'
import { watchedPatches } from '../../../../src/tracking/watched'
import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../../src/worker/tracking-document'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'
import { ACCOUNT_ID, SEASON_ID, SERIES_ID, SIGNED_OUT, fakeCrunchyroll, fullyWatched, numberedSeason } from './watched-fixtures'
import { inEnglish } from '../../in-english'

// the show-level id beside the season's, as a cluster holds them
const URI = `ag:(anilist:154587,cr:${SERIES_ID},cr:${SERIES_ID}-${SEASON_ID})`
const SEASON = { seriesId: SERIES_ID, seasonId: SEASON_ID }

type Reply<T> = T | 'not-connected' | Error

/**
 * A session answering each `watched` call with the next of `replies` and each `save` with the next of
 * `saves` (the last one again once they run out).
 */
const fakeSession = (replies: Reply<WatchedAnswer>[], saves: Reply<SaveAnswer>[]) => {
  const asked: { method: string, arg: unknown, options?: CallOptions }[] = []
  const listeners = new Set<() => void>()
  const next = <T>(from: Reply<T>[]) => from.length > 1 ? from.shift()! : from[0]!
  const call = vi.fn(async (method: string, arg: unknown, options?: CallOptions): Promise<SiteSessionResult<unknown>> => {
    asked.push({ method, arg, ...options ? { options } : {} })
    const reply = method === 'save' ? next(saves) : next(replies)
    if (reply instanceof Error) throw reply
    return reply === 'not-connected' ? { kind: 'not-connected' } : { kind: 'response', response: reply }
  })
  return {
    session: { call, onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    asked,
    /** the session changed under the tracker: a sign in */
    changed: () => { for (const listener of listeners) listener() },
  }
}

/** What the page script answers for SEASON_ID over the fixtures: episodes 1 and 2 of 4 watched. */
const watchedRead = () => readWatched(SEASON, fakeCrunchyroll().send)
const read = (progress: number, { stars = null as number | null, watchlisted = false } = {}): WatchedAnswer =>
  ({ status: 200, body: null, held: { progress, stars, watchlisted } })
const SAVED: SaveAnswer = { status: 200, body: null }

const setup = (replies: Reply<WatchedAnswer>[], saves: Reply<SaveAnswer>[] = [SAVED]) => {
  const waits: number[] = []
  const fake = fakeSession(replies, saves)
  const resolvers = crunchyrollTrackerResolvers({ wait: async ms => { waits.push(ms); await new Promise(() => {}) } })
  return { ...fake, waits, target: providerServer('cr', resolvers, { session: () => fake.session }) }
}

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const watch = (target: ReturnType<typeof setup>['target'], uri = URI) => {
  const subscription = subscribe(target, TRACKING_DOCUMENT, { input: { uri } })
  live.push(subscription)
  return subscription
}

const answerOf = (result: any): TrackerAnswer => result.data.tracking.answers[0]

const save = async (target: ReturnType<typeof setup>['target'], entry: Record<string, unknown>, uri = URI) =>
  (await yogaClient(target).mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['cr'], entry } }).toPromise()).data.saveListEntry
const remove = async (target: ReturnType<typeof setup>['target']) =>
  (await yogaClient(target).mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri: URI, trackers: ['cr'] } }).toPromise()).data.deleteListEntry
const saves = (asked: ReturnType<typeof setup>['asked']) => asked.filter(({ method }) => method === 'save')

describe('what the Crunchyroll tracker answers', () => {
  test('LISTED with how far the viewer got on the season the media plays on Crunchyroll, a tracker written to on 5 stars it cannot clear with Plan to watch alone, and no count of its own', async () => {
    const { target, asked } = setup([await watchedRead()])

    const answer = answerOf(await watch(target).next())

    expect(asked).toEqual([{ method: 'watched', arg: SEASON }])
    expect(answer).toMatchObject({
      state: 'LISTED',
      episodeCount: null,
      tracker: { id: 'cr', name: 'Crunchyroll', signedIn: true, account: null, canWrite: true, statuses: ['PLANNING'], scoreScale: 'POINT_5', canClearScore: false },
      entry: { _id: `cr:${SERIES_ID}-${SEASON_ID}`, tracker: 'cr', mediaUri: `cr:${SERIES_ID}-${SEASON_ID}`, status: null, progress: 2, score: null, episodeCount: null },
    })
  })

  test("the series' stars as its score, and its place on the Watchlist as Plan to watch while nothing of the season is watched", async () => {
    const entryOf = async (reply: WatchedAnswer) => answerOf(await watch(setup([reply]).target).next())
    expect(await entryOf(read(3, { stars: 4 }))).toMatchObject({ state: 'LISTED', entry: { status: null, progress: 3, score: 80 } })
    expect(await entryOf(read(0, { watchlisted: true }))).toMatchObject({ state: 'LISTED', entry: { status: 'PLANNING', progress: 0, score: null } })
    expect(await entryOf(read(0, { stars: 1 }))).toMatchObject({ state: 'LISTED', entry: { status: null, progress: 0, score: 20 } })
    // on the Watchlist with episodes watched is following the show, not planning it
    expect(await entryOf(read(2, { watchlisted: true }))).toMatchObject({ state: 'LISTED', entry: { status: null, progress: 2 } })
  })

  test('NOT_LISTED when nothing of the season is fully watched there, and the series is neither rated nor on the Watchlist', async () => {
    const { target } = setup([read(0)])
    expect(answerOf(await watch(target).next())).toMatchObject({ state: 'NOT_LISTED', entry: null, episodeCount: null, tracker: { signedIn: true, canWrite: true } })
  })

  test('NO_ID, asking nothing, on a title Crunchyroll does not carry and on one it names only as a show', async () => {
    const { target, asked } = setup([await watchedRead()])
    expect(answerOf(await watch(target, 'ag:(anilist:154587,mal:52991)').next()).state).toBe('NO_ID')
    expect(answerOf(await watch(target, 'jw:1526979').next()).state).toBe('NO_ID')
    // a show's seasons each count their own episodes, and nothing says which one this is
    expect(answerOf(await watch(target, `ag:(anilist:154587,cr:${SERIES_ID})`).next()).state).toBe('NO_ID')
    expect(asked).toEqual([])
  })

  test('SIGNED_OUT when stub never saw a Crunchyroll sign in here, and when the session is signed out', async () => {
    expect(answerOf(await watch(setup(['not-connected']).target).next())).toMatchObject({ state: 'SIGNED_OUT', tracker: { signedIn: false, canWrite: false } })
    expect(answerOf(await watch(setup([{ status: 400, body: SIGNED_OUT }]).target).next()).state).toBe('SIGNED_OUT')
  })

  test('ERROR with what Crunchyroll answered, in the viewer\'s words, and reads again after a while', async () => {
    const { target, waits } = setup([{ status: 403, body: null }])
    expect(answerOf(await watch(target).next()))
      .toMatchObject({ state: 'ERROR', error: { message: 'Crunchyroll answered {status}', values: { status: 403 } }, tracker: { canWrite: false } })
    await vi.waitFor(() => expect(waits).toEqual([RETRY_MS]))
  })

  test('a read whose fetch got no answer says Crunchyroll could not be reached, and any other throw keeps its words', async () => {
    const unreached = setup([new TypeError('NetworkError when attempting to fetch resource.')])
    expect(answerOf(await watch(unreached.target).next())).toMatchObject({ state: 'ERROR', error: inEnglish('Could not reach Crunchyroll, retrying') })
    const refused = setup([new Error('Crunchyroll answered 500')])
    expect(answerOf(await watch(refused.target).next())).toMatchObject({ state: 'ERROR', error: 'Crunchyroll answered 500' })
  })

  test('reads again after a sign in', async () => {
    const { target, changed } = setup(['not-connected', read(1)])
    const subscription = watch(target)
    expect(answerOf(await subscription.next()).state).toBe('SIGNED_OUT')
    changed()
    expect(answerOf(await subscription.next())).toMatchObject({ state: 'LISTED', entry: { progress: 1 } })
  })
})

describe('a write', () => {
  test('progress goes to the page once, never run again, and every open answer reads again after it', async () => {
    const { target, asked } = setup([read(2), read(4)])
    const subscription = watch(target)
    expect(answerOf(await subscription.next()).entry).toMatchObject({ progress: 2 })

    expect(await save(target, { progress: 4 })).toEqual([{ tracker: 'cr', outcome: 'SAVED', error: null, entry: null }])

    expect(saves(asked)).toEqual([{ method: 'save', arg: { ...SEASON, progress: 4 }, options: { once: true } }])
    expect(answerOf(await subscription.next()).entry).toMatchObject({ progress: 4 })
  })

  test('a score goes as the stars it shows on 5, a cleared one as none, and Plan to watch as the Watchlist', async () => {
    const sent = async (entry: Record<string, unknown>) => {
      const { target, asked } = setup([read(2)])
      expect(await save(target, entry), JSON.stringify(entry)).toMatchObject([{ outcome: 'SAVED' }])
      return saves(asked).map(({ arg }) => arg)
    }
    expect(await sent({ score: 80 })).toEqual([{ ...SEASON, stars: 4 }])
    expect(await sent({ score: 100 })).toEqual([{ ...SEASON, stars: 5 }])
    expect(await sent({ score: 70 })).toEqual([{ ...SEASON, stars: 4 }])
    expect(await sent({ score: 30 })).toEqual([{ ...SEASON, stars: 2 }])
    expect(await sent({ score: 5 })).toEqual([{ ...SEASON, stars: 1 }])
    expect(await sent({ score: null })).toEqual([{ ...SEASON, stars: null }])
    expect(await sent({ status: 'PLANNING' })).toEqual([{ ...SEASON, watchlist: true }])
    expect(await sent({ status: 'PLANNING', progress: 0, score: 60 })).toEqual([{ ...SEASON, progress: 0, stars: 3, watchlist: true }])
  })

  test('any other status sends Crunchyroll nothing beyond the episodes, Completed included', async () => {
    const sent = async (entry: Record<string, unknown>) => {
      const { target, asked } = setup([read(2)])
      expect(await save(target, entry), JSON.stringify(entry)).toMatchObject([{ outcome: 'SAVED', error: null }])
      return saves(asked).map(({ arg }) => arg)
    }
    expect(await sent({ status: 'COMPLETED', progress: 12 })).toEqual([{ ...SEASON, progress: 12 }])
    for (const status of ['WATCHING', 'REWATCHING', 'COMPLETED', 'PAUSED', 'DROPPED']) expect(await sent({ status }), status).toEqual([])
  })

  test('Remove from list takes the series off the Watchlist, and only that, once', async () => {
    const { target, asked } = setup([read(0, { watchlisted: true })])
    expect(await remove(target)).toMatchObject([{ tracker: 'cr', outcome: 'SAVED' }])
    expect(saves(asked)).toEqual([{ method: 'save', arg: { ...SEASON, watchlist: false }, options: { once: true } }])
  })

  test("a refusal from the page is the save's refusal, in its own words", async () => {
    const { target } = setup([read(4)], [{ status: 200, body: null, refused: 'Crunchyroll cannot unmark an episode' }])
    expect(await save(target, { progress: 1 })).toEqual([{ tracker: 'cr', outcome: 'REFUSED', error: 'Crunchyroll cannot unmark an episode', entry: null }])
  })

  test('signed out, a save is refused with how to fix it', async () => {
    for (const reply of ['not-connected', { status: 400, body: SIGNED_OUT }] as const) {
      const { target } = setup([read(2)], [reply])
      expect(await save(target, { progress: 3 }), JSON.stringify(reply)).toEqual([{ tracker: 'cr', outcome: 'REFUSED', error: inEnglish('Sign in to Crunchyroll to save to it'), entry: null }])
    }
  })

  test('a save cut short or failing in the page fails, and the answers read what Crunchyroll now holds', async () => {
    const { target } = setup([read(2), read(3)], [new CallInterrupted('https://www.crunchyroll.com changed while stub\'s call was running, so whether it arrived is not known')])
    const subscription = watch(target)
    await subscription.next()
    expect(await save(target, { progress: 4 })).toMatchObject([{ tracker: 'cr', outcome: 'FAILED', error: expect.stringContaining('whether it arrived is not known') }])
    expect(answerOf(await subscription.next()).entry).toMatchObject({ progress: 3 })
  })

  test('a media naming no Crunchyroll season is refused without asking anything', async () => {
    const { target, asked } = setup([read(2)])
    expect(await save(target, { progress: 3 }, `ag:(anilist:154587,cr:${SERIES_ID})`)).toMatchObject([{ tracker: 'cr', outcome: 'REFUSED' }])
    expect(asked).toEqual([])
  })
})

describe('beside the trackers the viewer writes to', () => {
  const tracker = (id: string, name: string) => ({ id, name, signedIn: true, account: 'viewer', canWrite: true, scoreScale: 'POINT_100' })
  const anilist = (progress: number, episodeCount: number) => ({
    _id: 'answer:anilist', state: 'LISTED', candidates: [], error: null, episodeCount, tracker: tracker('anilist', 'AniList'),
    entry: { _id: 'anilist:1', tracker: 'anilist', status: 'WATCHING', progress, score: null, updatedAt: '2026-10-01T00:00:00Z', episodeCount },
  }) as TrackerAnswer
  const listsNothing = (id: string, name: string, episodeCount: number | null) =>
    ({ _id: `answer:${id}`, state: 'NOT_LISTED', candidates: [], error: null, episodeCount, tracker: tracker(id, name), entry: null }) as TrackerAnswer
  // a 26 episode run still airing: Crunchyroll lists the 11 aired so far
  const airing = async (watched: number) => answerOf(await watch(setup([read(watched)]).target).next())

  test('its progress joins the summary, which marks where it differs from theirs', async () => {
    const cr = answerOf(await watch(setup([await watchedRead()]).target).next())
    const tracking = aggregateTracking(URI, [anilist(1, 4), cr])

    expect(tracking.disagreements).toEqual(['PROGRESS'])
    expect(tracking.summary).toMatchObject({ status: 'WATCHING', progress: 2, episodeCount: 4 })
  })

  test('an airing season ahead of a listed AniList marks the difference, counted on the run', async () => {
    const tracking = aggregateTracking(URI, [anilist(3, 26), await airing(8)])

    expect(tracking.disagreements).toEqual(['PROGRESS'])
    expect(tracking.summary).toMatchObject({ progress: 8, episodeCount: 26 })
  })

  test('an airing season beside an AniList and a Stub that list nothing leaves what watching writes them as it was, and is raised to the episode itself', async () => {
    const others = [listsNothing('anilist', 'AniList', 26), listsNothing('stub', 'Stub', null)]
    const without = aggregateTracking(URI, others)
    const beside = aggregateTracking(URI, [...others, await airing(5)])

    for (const episode of [6, 11]) {
      const watched = { played: 0.9, episode }
      const { cr, ...theirs } = watchedPatches(watched, beside, {}, 26)
      expect(theirs, `episode ${episode}`).toEqual(watchedPatches(watched, without, {}, 26))
      expect(cr, `episode ${episode}`).toEqual({ progress: episode, status: 'WATCHING' })
    }
    expect(watchedPatches({ played: 0.9, episode: 11 }, beside, {}, 26), 'the 11th of 26 completes nothing').toEqual({
      anilist: { progress: 11, status: 'WATCHING' },
      stub: { progress: 11, status: 'WATCHING' },
      cr: { progress: 11, status: 'WATCHING' },
    })
  })

  test('watching episode 5 marks episode 5 on Crunchyroll alone, never the ones before it the account left unmarked', async () => {
    const site = fakeCrunchyroll({ episodes: numberedSeason(12), playheads: fullyWatched('GJA1', 'GJA2') })
    const page = {
      call: async (method: string, arg: SaveRequest) =>
        ({ kind: 'response', response: method === 'save' ? await saveWatched(arg, site.send) : await readWatched(arg, site.send) }),
      onChange: () => () => {},
    }
    const target = providerServer('cr', crunchyrollTrackerResolvers({ wait: () => new Promise(() => {}) }), { session: () => page })
    const tracking = aggregateTracking(URI, [answerOf(await watch(target).next())])

    const { cr } = watchedPatches({ played: 0.9, episode: 5 }, tracking, {}, 12)
    expect(cr).toEqual({ progress: 5, status: 'WATCHING' })
    expect(await save(target, cr!)).toMatchObject([{ tracker: 'cr', outcome: 'SAVED' }])
    expect(site.writes().map(({ method, url }) => `${method} ${new URL(url).pathname}`)).toEqual([`POST /content/v2/discover/${ACCOUNT_ID}/mark_as_watched/GJA5`])
  })
})
