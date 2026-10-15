// The Crunchyroll tracker served the way every provider is, over a fake session that answers what the
// Crunchyroll page script answers (./watched-fixtures.ts says what was recorded), and asked the
// questions the app asks it.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { WatchedAnswer } from '../../../../src/sources/crunchyroll/session-page'
import type { TrackerAnswer } from '../../../../src/generated/schema/types.generated'
import type { SiteSessionResult } from '../../../../src/tracking/site-session'

import { readWatched } from '../../../../src/sources/crunchyroll/session-page'
import { crunchyrollTrackerResolvers } from '../../../../src/sources/crunchyroll/tracker-resolvers'
import { aggregateTracking } from '../../../../src/tracking/aggregate'
import { RETRY_MS } from '../../../../src/tracking/collect'
import { watchedPatches } from '../../../../src/tracking/watched'
import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../../src/worker/tracking-document'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'
import { SEASON_ID, SERIES_ID, SIGNED_OUT, fakeCrunchyroll } from './watched-fixtures'

// the show-level id beside the season's, as a cluster holds them
const URI = `ag:(anilist:154587,cr:${SERIES_ID},cr:${SERIES_ID}-${SEASON_ID})`

type Reply = WatchedAnswer | 'not-connected' | Error

/** A session answering each `watched` call with the next of `replies` (the last one again once they run out). */
const fakeSession = (...replies: Reply[]) => {
  const asked: { method: string, arg: unknown }[] = []
  const listeners = new Set<() => void>()
  const call = vi.fn(async (method: string, arg: unknown): Promise<SiteSessionResult<WatchedAnswer>> => {
    asked.push({ method, arg })
    const reply = replies.length > 1 ? replies.shift()! : replies[0]!
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
const watchedRead = () => readWatched({ seriesId: SERIES_ID, seasonId: SEASON_ID }, fakeCrunchyroll().send)
const read = (watched: number[], numbers: number[]): WatchedAnswer =>
  ({ status: 200, body: null, episodes: numbers.map(number => ({ number, watched: watched.includes(number) })) })

const setup = (...replies: Reply[]) => {
  const waits: number[] = []
  const fake = fakeSession(...replies)
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

describe('what the Crunchyroll tracker answers', () => {
  test("LISTED with how far the viewer got on the season the media plays on Crunchyroll, read only, and no count of its own", async () => {
    const { target, asked } = setup(await watchedRead())

    const answer = answerOf(await watch(target).next())

    expect(asked).toEqual([{ method: 'watched', arg: { seriesId: SERIES_ID, seasonId: SEASON_ID } }])
    expect(answer).toMatchObject({
      state: 'LISTED',
      episodeCount: null,
      tracker: { id: 'cr', name: 'Crunchyroll', signedIn: true, account: null, canWrite: false, readOnly: true },
      entry: { _id: `cr:${SERIES_ID}-${SEASON_ID}`, tracker: 'cr', mediaUri: `cr:${SERIES_ID}-${SEASON_ID}`, status: null, progress: 2, score: null, episodeCount: null },
    })
  })

  test('progress is the last episode fully watched, counted in the season, wherever Crunchyroll numbers it from', async () => {
    const { target } = setup(read([25, 27], [25, 26, 27, 28, 29]))
    expect(answerOf(await watch(target).next()).entry).toMatchObject({ progress: 3 })
  })

  test('NOT_LISTED when nothing of the season is fully watched there', async () => {
    const { target } = setup(read([], [1, 2, 3]))
    expect(answerOf(await watch(target).next())).toMatchObject({ state: 'NOT_LISTED', entry: null, episodeCount: null, tracker: { signedIn: true } })
  })

  test('NO_ID, asking nothing, on a title Crunchyroll does not carry and on one it names only as a show', async () => {
    const { target, asked } = setup(await watchedRead())
    expect(answerOf(await watch(target, 'ag:(anilist:154587,mal:52991)').next()).state).toBe('NO_ID')
    expect(answerOf(await watch(target, 'jw:1526979').next()).state).toBe('NO_ID')
    // a show's seasons each count their own episodes, and nothing says which one this is
    expect(answerOf(await watch(target, `ag:(anilist:154587,cr:${SERIES_ID})`).next()).state).toBe('NO_ID')
    expect(asked).toEqual([])
  })

  test('SIGNED_OUT when stub never saw a Crunchyroll sign in here, and when the session is signed out', async () => {
    expect(answerOf(await watch(setup('not-connected').target).next())).toMatchObject({ state: 'SIGNED_OUT', tracker: { signedIn: false } })
    expect(answerOf(await watch(setup({ status: 400, body: SIGNED_OUT }).target).next()).state).toBe('SIGNED_OUT')
  })

  test('ERROR with what Crunchyroll answered, and reads again after a while', async () => {
    const { target, waits } = setup({ status: 403, body: null })
    expect(answerOf(await watch(target).next())).toMatchObject({ state: 'ERROR', error: 'Crunchyroll answered 403', tracker: { readOnly: true } })
    await vi.waitFor(() => expect(waits).toEqual([RETRY_MS]))
  })

  test('reads again after a sign in', async () => {
    const { target, changed } = setup('not-connected', read([1], [1, 2]))
    const subscription = watch(target)
    expect(answerOf(await subscription.next()).state).toBe('SIGNED_OUT')
    changed()
    expect(answerOf(await subscription.next())).toMatchObject({ state: 'LISTED', entry: { progress: 1 } })
  })

  test('takes no writes, and asks nothing for one', async () => {
    const { target, asked } = setup(await watchedRead())
    const client = yogaClient(target)
    const saved = await client.mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri: URI, trackers: ['cr'], entry: { progress: 3 } } }).toPromise()
    const removed = await client.mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri: URI, trackers: ['cr'] } }).toPromise()

    expect(saved.data.saveListEntry).toMatchObject([{ tracker: 'cr', outcome: 'REFUSED' }])
    expect(removed.data.deleteListEntry).toMatchObject([{ tracker: 'cr', outcome: 'REFUSED' }])
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
  const upTo = (last: number) => Array.from({ length: last }, (_, at) => at + 1)
  // a 26 episode run still airing: Crunchyroll lists the 11 aired so far
  const airing = async (watched: number) => answerOf(await watch(setup(read(upTo(watched), upTo(11))).target).next())

  test('its progress joins the summary, which marks where it differs from theirs', async () => {
    const cr = answerOf(await watch(setup(await watchedRead()).target).next())
    const tracking = aggregateTracking(URI, [anilist(1, 4), cr])

    expect(tracking.disagreements).toEqual(['PROGRESS'])
    expect(tracking.summary).toMatchObject({ status: 'WATCHING', progress: 2, episodeCount: 4 })
  })

  test('an airing season ahead of a listed AniList marks the difference, counted on the run', async () => {
    const tracking = aggregateTracking(URI, [anilist(3, 26), await airing(8)])

    expect(tracking.disagreements).toEqual(['PROGRESS'])
    expect(tracking.summary).toMatchObject({ progress: 8, episodeCount: 26 })
  })

  test('an airing season beside an AniList and a Stub that list nothing leaves what watching writes as it was', async () => {
    const others = [listsNothing('anilist', 'AniList', 26), listsNothing('stub', 'Stub', null)]
    const without = aggregateTracking(URI, others)
    const beside = aggregateTracking(URI, [...others, await airing(5)])

    for (const episode of [6, 11]) {
      const watched = { played: 0.9, episode }
      expect(watchedPatches(watched, beside, {}, 26), `episode ${episode}`).toEqual(watchedPatches(watched, without, {}, 26))
    }
    expect(watchedPatches({ played: 0.9, episode: 11 }, beside, {}, 26), 'the 11th of 26 completes nothing').toEqual({
      anilist: { progress: 11, status: 'WATCHING' },
      stub: { progress: 11, status: 'WATCHING' },
    })
  })
})
