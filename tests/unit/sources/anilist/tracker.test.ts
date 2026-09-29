// The AniList tracker served the way every provider is, over a fake session that answers with AniList's
// own answers (./list-fixtures.ts says which were recorded), and asked the questions the app asks it.
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { SessionRateLimit, SessionRequest, SessionResponse } from '../../../../src/sources/anilist/session-page'
import type { CatalogLookup } from '../../../../src/tracking/identity'
import type { SiteSessionResult } from '../../../../src/tracking/site-session'

import { ANILIST_WRITE_NOTICE } from '../../../../src/sources/anilist/list-api'
import { TIMEOUT_AFTER_429_MS } from '../../../../src/sources/anilist/pacing'
import { anilistTrackerResolvers } from '../../../../src/sources/anilist/tracker-resolvers'
import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../../../../src/worker/tracking-document'
import { providerServer, subscribe, yogaClient } from '../../worker/yoga-client'
import { FRIEREN, FRIEREN_ENTRY, LISTED_BODY, NOT_LISTED_BODY, SIGNED_OUT_BODY } from './list-fixtures'

const ROWS = [
  { mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 },
  { mal: 59978, anilist: 182255, kitsu: 49240, anidb: 19018 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => ROWS.find(row => row[origin] === id) }

const NO_LIMIT: SessionRateLimit = { limit: null, remaining: null, reset: null, retryAfter: null }
const response = (body: unknown, status = 200, rateLimit: Partial<SessionRateLimit> = {}): SessionResponse =>
  ({ status, body: body as SessionResponse['body'], rateLimit: { ...NO_LIMIT, ...rateLimit } })

type Answer = (variables: Record<string, unknown>) => SessionResponse | 'not-connected'

/** A session answering each operation from `script`, recording what it was asked. */
const fakeSession = (script: Record<string, Answer>) => {
  const asked: { operation: string, variables: Record<string, unknown>, query: string }[] = []
  const listeners = new Set<() => void>()
  const call = vi.fn(async (method: string, { query, variables = {} }: SessionRequest): Promise<SiteSessionResult<SessionResponse>> => {
    if (method !== 'graphql') throw new Error(`anilist.co's page serves no ${method}`)
    const operation = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? 'anonymous'
    asked.push({ operation, variables, query })
    const answer = script[operation]?.(variables) ?? response({ errors: [{ message: `no answer scripted for ${operation}`, status: 500 }] }, 500)
    return answer === 'not-connected' ? { kind: 'not-connected' } : { kind: 'response', response: answer }
  })
  return {
    session: { call, onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } } },
    script,
    asked,
    operations: () => asked.map(({ operation }) => operation),
    /** the session changed under the tracker: a sign in */
    changed: () => { for (const listener of listeners) listener() },
  }
}

/**
 * `holdWaits` keeps every pacer wait pending until `release`, as real time would; `drift` moves the
 * clock on by that much each time the tracker reads it.
 */
const setup = (script: Record<string, Answer>, { holdWaits = false, drift = 0 } = {}) => {
  let at = 1_790_000_000_000
  const waits: number[] = []
  const held: (() => void)[] = []
  const fake = fakeSession(script)
  const resolvers = anilistTrackerResolvers({
    now: () => (at += drift) - drift,
    wait: async ms => {
      waits.push(ms)
      if (holdWaits) await new Promise<void>(resolve => held.push(resolve))
      at += ms
    },
  })
  const target = providerServer('anilist', resolvers, { catalog: async () => catalog, session: () => fake.session })
  return { ...fake, target, waits, now: () => at, release: () => held.shift()?.() }
}

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const watch = (target: ReturnType<typeof setup>['target'], uri: string) => {
  const subscription = subscribe(target, TRACKING_DOCUMENT, { input: { uri } })
  live.push(subscription)
  return subscription
}

const answerOf = (result: any) => result.data.tracking.answers[0]

const save = (target: ReturnType<typeof setup>['target'], uri: string, entry: Record<string, unknown>) =>
  yogaClient(target).mutation(SAVE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['anilist'], entry } }).toPromise()

const remove = (target: ReturnType<typeof setup>['target'], uri: string) =>
  yogaClient(target).mutation(DELETE_LIST_ENTRY_DOCUMENT, { input: { uri, trackers: ['anilist'] } }).toPromise()

describe('what the AniList tracker answers', () => {
  test("LISTED with the viewer's own entry, their account and their score format", async () => {
    const { target, asked } = setup({ StubTracking: () => response(LISTED_BODY) })

    const answer = answerOf(await watch(target, 'ag:(anilist:154587,cr:GG5H5XQX4)').next())

    expect(asked).toMatchObject([{ operation: 'StubTracking', variables: { mediaId: 154587 } }])
    expect(answer).toMatchObject({
      state: 'LISTED',
      tracker: { id: 'anilist', name: 'AniList', signedIn: true, account: 'viewer', canWrite: true, scoreScale: 'POINT_10_DECIMAL', writeNotice: ANILIST_WRITE_NOTICE },
      entry: { _id: 'anilist:398761234', mediaUri: 'anilist:154587', status: 'WATCHING', progress: 12, score: 85, scoreLabel: '8.5 / 10', episodeCount: 28 },
    })
  })

  test('NOT_LISTED when the viewer has no entry for it', async () => {
    const { target } = setup({ StubTracking: () => response(NOT_LISTED_BODY) })
    expect(answerOf(await watch(target, 'ag:(anilist:154587)').next())).toMatchObject({ state: 'NOT_LISTED', entry: null, tracker: { signedIn: true } })
  })

  test('SIGNED_OUT, and takes no writes, when anilist.co answers the session 401', async () => {
    const { target } = setup({ StubTracking: () => response(SIGNED_OUT_BODY, 401) })
    expect(answerOf(await watch(target, 'ag:(anilist:154587)').next()))
      .toMatchObject({ state: 'SIGNED_OUT', entry: null, tracker: { signedIn: false, canWrite: false, account: null } })
  })

  test('SIGNED_OUT when the viewer never connected AniList here', async () => {
    const { target } = setup({ StubTracking: () => 'not-connected' })
    expect(answerOf(await watch(target, 'ag:(anilist:154587)').next()).state).toBe('SIGNED_OUT')
  })

  test('finds the AniList entry of a media known by its MyAnimeList id alone', async () => {
    const { target, asked } = setup({ StubTracking: () => response(LISTED_BODY) })
    expect(answerOf(await watch(target, 'ag:(mal:52991)').next()).state).toBe('LISTED')
    expect(asked[0]!.variables).toEqual({ mediaId: 154587 })
  })

  test('AMBIGUOUS with both ids when the media names two AniList ids, and asks and writes nothing', async () => {
    const { target, asked } = setup({ StubTracking: () => response(LISTED_BODY) })
    const uri = 'ag:(anilist:154587,anilist:182255)'

    expect(answerOf(await watch(target, uri).next())).toMatchObject({ state: 'AMBIGUOUS', candidates: ['anilist:154587', 'anilist:182255'] })
    const saved = await save(target, uri, { progress: 1 })
    expect(saved.data.saveListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'REFUSED' }])
    expect(saved.data.saveListEntry[0].error).toContain('anilist:154587 and anilist:182255')
    expect(asked).toEqual([])
  })

  // a cluster that welded season 1's AniList id to season 2's MyAnimeList id, which stub's own tracker
  // answers AMBIGUOUS: keyed on its own AniList id, a save would land on the other season's entry
  test('AMBIGUOUS where stub\'s own tracker is, even with an AniList id of its own, and asks and writes nothing', async () => {
    const { target, asked } = setup({ StubTracking: () => response(LISTED_BODY) })
    const uri = 'ag:(anilist:154587,mal:59978,cr:GG5H5XQX4)'

    expect(answerOf(await watch(target, uri).next())).toMatchObject({ state: 'AMBIGUOUS', candidates: ['anilist:154587', 'mal:59978'] })
    expect((await save(target, uri, { progress: 5 })).data.saveListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'REFUSED' }])
    expect((await remove(target, uri)).data.deleteListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'REFUSED' }])
    expect(asked).toEqual([])
  })

  test('the control: an AniList id beside a MyAnimeList id of the same run reads and writes', async () => {
    const saved = { ...FRIEREN_ENTRY, progress: 5, media: FRIEREN }
    const { target, asked } = setup({
      StubTracking: () => response(LISTED_BODY),
      StubSaveListEntry: () => response({ data: { SaveMediaListEntry: saved } }),
    })
    const uri = 'ag:(anilist:154587,mal:52991,cr:GG5H5XQX4)'

    expect(answerOf(await watch(target, uri).next()).state).toBe('LISTED')
    expect((await save(target, uri, { progress: 5 })).data.saveListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'SAVED' }])
    expect(asked.slice(0, 2).map(({ operation, variables }) => [operation, variables])).toEqual([
      ['StubTracking', { mediaId: 154587 }],
      ['StubSaveListEntry', { mediaId: 154587, progress: 5 }],
    ])
  })

  test('NO_ID for a media no AniList id reaches', async () => {
    const { target, asked } = setup({})
    expect(answerOf(await watch(target, 'ag:(cr:GG5H5XQX4)').next()).state).toBe('NO_ID')
    expect(asked).toEqual([])
  })

  test('reads again once the viewer signed in', async () => {
    const { target, script, changed } = setup({ StubTracking: () => response(SIGNED_OUT_BODY, 401) })
    const tracking = watch(target, 'ag:(anilist:154587)')
    expect(answerOf(await tracking.next()).state).toBe('SIGNED_OUT')

    script.StubTracking = () => response(LISTED_BODY)
    changed()
    expect(answerOf(await tracking.next())).toMatchObject({ state: 'LISTED', tracker: { account: 'viewer' } })
  })
})

describe('what the AniList tracker writes', () => {
  test('a save goes as SaveMediaListEntry, mapped, and the open answer reads again', async () => {
    const saved = { ...FRIEREN_ENTRY, status: 'COMPLETED', progress: 28, scoreRaw: 90, score: 9, media: FRIEREN }
    const { target, asked, operations } = setup({
      StubTracking: () => response(LISTED_BODY),
      StubSaveListEntry: () => response({ data: { SaveMediaListEntry: saved } }),
    })
    const tracking = watch(target, 'ag:(anilist:154587)')
    await tracking.next()

    const result = await save(target, 'ag:(anilist:154587)', { status: 'COMPLETED', progress: 28, score: 90 })

    expect(asked.find(({ operation }) => operation === 'StubSaveListEntry')!.variables)
      .toEqual({ mediaId: 154587, status: 'COMPLETED', progress: 28, scoreRaw: 90 })
    expect(result.data.saveListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'SAVED', entry: { status: 'COMPLETED', progress: 28, score: 90, scoreLabel: '9.0 / 10' } }])
    await tracking.next()
    expect(operations()).toEqual(['StubTracking', 'StubSaveListEntry', 'StubTracking'])
  })

  test('a save while signed out is refused, saying so', async () => {
    const { target } = setup({ StubSaveListEntry: () => response(SIGNED_OUT_BODY, 401) })
    expect((await save(target, 'ag:(anilist:154587)', { progress: 1 })).data.saveListEntry)
      .toMatchObject([{ outcome: 'REFUSED', error: 'Sign in to AniList to save to it' }])
  })

  test("a delete looks the entry's own id up and deletes that", async () => {
    const { target, asked } = setup({
      StubListEntryId: () => response({ data: { Media: { id: 154587, mediaListEntry: { id: 398761234 } } } }),
      StubDeleteListEntry: () => response({ data: { DeleteMediaListEntry: { deleted: true } } }),
    })
    expect((await remove(target, 'ag:(anilist:154587)')).data.deleteListEntry).toMatchObject([{ tracker: 'anilist', outcome: 'SAVED' }])
    expect(asked.map(({ operation, variables }) => [operation, variables])).toEqual([
      ['StubListEntryId', { mediaId: 154587 }],
      ['StubDeleteListEntry', { id: 398761234 }],
    ])
  })

  test('a delete of nothing listed is done, and deletes nothing', async () => {
    const { target, operations } = setup({ StubListEntryId: () => response({ data: { Media: { id: 154587, mediaListEntry: null } } }) })
    expect((await remove(target, 'ag:(anilist:154587)')).data.deleteListEntry).toMatchObject([{ outcome: 'SAVED' }])
    expect(operations()).toEqual(['StubListEntryId'])
  })
})

describe("AniList's rate limit", () => {
  test('a 429 answers PAUSED, and the answer is read again only once the reset has passed', async () => {
    let calls = 0
    const { target, waits, now } = setup({
      StubTracking: () => ++calls === 1
        ? response({ errors: [{ message: 'Too Many Requests.', status: 429 }] }, 429, { reset: Math.floor(now() / 1_000) + 40, remaining: 0 })
        : response(LISTED_BODY),
    })
    const tracking = watch(target, 'ag:(anilist:154587)')

    const paused = answerOf(await tracking.next())
    expect(paused.state).toBe('PAUSED')
    expect(paused.error).toContain('asked stub to wait')
    expect(answerOf(await tracking.next()).state).toBe('LISTED')
    expect(waits).toEqual([40_000])
    expect(calls).toBe(2)
  })

  // AniList's usual way to report a failure: an HTTP 200 whose body carries the status
  const BODY_429 = { data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] }
  // a loop that does spin stops at the cap, so the test fails rather than never yielding
  const rateLimitedUpTo = (cap: number, counted: { calls: number }) => () =>
    ++counted.calls <= cap ? response(BODY_429) : response(LISTED_BODY)

  test('a 429 only in the body pauses the same way: each read after it waits the pause out first', async () => {
    const counted = { calls: 0 }
    const { target, waits, release } = setup({ StubTracking: rateLimitedUpTo(20, counted) }, { holdWaits: true })
    const tracking = watch(target, 'ag:(anilist:154587)')

    expect(answerOf(await tracking.next())).toMatchObject({ state: 'PAUSED', error: expect.stringContaining('asked stub to wait until') })
    await expect(tracking.next(100), 'nothing is asked while the pause holds').rejects.toThrow('no payload')
    expect(counted.calls).toBe(1)
    expect(waits).toEqual([TIMEOUT_AFTER_429_MS])

    release()
    expect(answerOf(await tracking.next()).state).toBe('PAUSED')
    await expect(tracking.next(100)).rejects.toThrow('no payload')
    expect(counted.calls).toBe(2)
    expect(waits).toEqual([TIMEOUT_AFTER_429_MS, TIMEOUT_AFTER_429_MS])
  })

  test('a PAUSED read with no pause left to wait out is not asked again on its own', async () => {
    const counted = { calls: 0 }
    // a clock past every pause by the time the tracker looks at it again
    const { target } = setup({ StubTracking: rateLimitedUpTo(20, counted) }, { drift: TIMEOUT_AFTER_429_MS + 1_000 })
    const tracking = watch(target, 'ag:(anilist:154587)')

    expect(answerOf(await tracking.next()).state).toBe('PAUSED')
    await expect(tracking.next(100)).rejects.toThrow('no payload')
    expect(counted.calls).toBe(1)
  })

  test('a save refused with a 429 fails, saying why, and is not sent again', async () => {
    const { target, operations } = setup({
      StubSaveListEntry: () => response({ errors: [{ message: 'Too Many Requests.', status: 429 }] }, 429, { retryAfter: 60 }),
    })
    const result = await save(target, 'ag:(anilist:154587)', { progress: 3 })
    expect(result.data.saveListEntry).toMatchObject([{ outcome: 'FAILED' }])
    expect(result.data.saveListEntry[0].error).toContain('asked stub to wait')
    expect(operations()).toEqual(['StubSaveListEntry'])
  })

  test('with 2 or fewer calls left, the next one waits a minute', async () => {
    const { target, waits } = setup({ StubTracking: () => response(LISTED_BODY, 200, { remaining: 2, limit: 30 }) })
    await watch(target, 'ag:(anilist:154587)').next()
    await watch(target, 'ag:(anilist:154587)').until(result => answerOf(result).state === 'LISTED')
    expect(waits).toEqual([60_000])
  })
})
