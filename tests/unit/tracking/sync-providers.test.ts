// A per-media sync end to end through the app's tracking resolvers, over the real stub tracker, the
// real AniList tracker on a fake session answering with AniList's own answers, the real MyAnimeList
// tracker on the hand-made MyAnimeList of its own tests, and a fake provider that fails. The plan is read off the answers the page gets, through the page's own
// subscription document, and applied as the panel applies it: one `saveListEntry` per target, naming
// that target alone.
import { print } from 'graphql'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ListEntryInput, Tracker } from '../../../src/generated/schema/types.generated'
import type { AnilistEntry, AnilistViewer } from '../../../src/sources/anilist/list-api'
import type { SessionRateLimit, SessionRequest, SessionResponse } from '../../../src/sources/anilist/session-page'
import type { CatalogLookup } from '../../../src/tracking/identity'

import { MediaTrackingDocument } from '../../../src/generated/graphql'
import { anilistTrackerResolvers } from '../../../src/sources/anilist/tracker-resolvers'
import { malTrackerResolvers } from '../../../src/sources/mal/tracker-resolvers'
import { stubTrackerResolvers } from '../../../src/sources/stub/tracker-resolvers'
import { trackingResolvers, type TrackerProvider } from '../../../src/tracking/app-resolvers'
import { openJournal } from '../../../src/tracking/journal'
import { SYNC_FIELDS, applySync, planSync, sourceRefusal, type SyncAnswer } from '../../../src/tracking/sync'
import { FRIEREN, FRIEREN_ENTRY, VIEWER } from '../sources/anilist/list-fixtures'
import { answerOf, fakeMal, type FakeMalOptions, type RawRow } from '../sources/mal/fake-mal'
import { HACK_SIGN } from '../sources/mal/list-fixtures'
import { providerServer, subscribe, yogaClient } from '../worker/yoga-client'
import { memoryStore } from './memory-store'

const URI = 'ag:(anilist:154587)'
const catalog: CatalogLookup = { lookup: (origin, id) => [{ mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 }].find(row => row[origin] === id) }

const NO_LIMIT: SessionRateLimit = { limit: null, remaining: null, reset: null, retryAfter: null }
const response = (body: unknown): SessionResponse => ({ status: 200, body: body as SessionResponse['body'], rateLimit: NO_LIMIT })

// a viewer who scores on ten points, holding Frieren at 12 episodes and a 9
const TEN_POINT = { ...VIEWER, mediaListOptions: { scoreFormat: 'POINT_10' } }
const HELD = { ...FRIEREN_ENTRY, scoreRaw: 90, score: 9 }

const setup = ({ listed = true } = {}) => {
  const asked: { operation: string, variables: Record<string, unknown> }[] = []
  const call = vi.fn(async (method: string, { query, variables = {} }: SessionRequest) => {
    if (method !== 'graphql') throw new Error(`anilist.co's page serves no ${method}`)
    const operation = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? 'anonymous'
    asked.push({ operation, variables })
    if (operation === 'StubSaveListEntry') {
      return { kind: 'response' as const, response: response({ data: { SaveMediaListEntry: { ...HELD, ...variables, media: FRIEREN } } }) }
    }
    return { kind: 'response' as const, response: response({ data: { Viewer: TEN_POINT, Media: { ...FRIEREN, mediaListEntry: listed ? HELD : null } } }) }
  })
  const session = { call, onChange: () => () => {} }
  const anilist = providerServer('anilist', anilistTrackerResolvers({ wait: async () => {} }), { catalog: async () => catalog, session: () => session })

  let now = 1_790_000_000_000
  const store = memoryStore()
  const journal = openJournal(store, { now: () => (now += 1_000), uuid: () => crypto.randomUUID() })
  const stub = providerServer('stub', stubTrackerResolvers(() => journal), { catalog: async () => catalog })

  // a provider whose list is empty and whose first write fails, as one does while its service is down
  const brokenWrites: unknown[] = []
  let down = true
  const brokenTracker: Tracker = { id: 'broken', name: 'Broken', icon: null, color: null, signedIn: true, account: null, canWrite: true, scoreScale: 'POINT_100', writeNotice: null, keepsPageEpisodeCount: false, keeps: [...SYNC_FIELDS], rewatchThroughCompleted: false }
  const broken = providerServer('broken', {
    Subscription: {
      tracking: {
        subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }) {
          yield { tracking: { _id: `tracking:${input.uri}`, answers: [{ _id: `answer:broken:${input.uri}`, tracker: brokenTracker, state: 'NOT_LISTED', entry: null, candidates: [], error: null, pending: 0 }], summary: null, disagreements: [] } }
        },
      },
    },
    Mutation: {
      saveListEntry: (_parent: unknown, { input }: { input: unknown }) => {
        brokenWrites.push(input)
        if (down) throw new Error('The list service answered 503')
        return [{ tracker: 'broken', outcome: 'SAVED', entry: null, error: null }]
      },
    },
  })

  const entry = (origin: string, target: ReturnType<typeof providerServer>): TrackerProvider => ({ name: origin, extractor: { origin }, client: yogaClient(target) })
  const app = providerServer('app', trackingResolvers([entry('stub', stub), entry('anilist', anilist), entry('broken', broken)], provider => ({ ...brokenTracker, id: provider.extractor.origin, name: provider.extractor.origin })))
  return { app, asked, brokenWrites, recover: () => { down = false } }
}

const TRACKING = print(MediaTrackingDocument)
const SAVE = `
  mutation ($input: SaveListEntryInput!) {
    saveListEntry(input: $input) { tracker outcome error }
  }
`

/** The panel's write: one target, named alone, with the page's episode count beside it. */
const writeThrough = (app: ReturnType<typeof setup>['app'], episodeCount?: number) => async (tracker: string, entry: ListEntryInput) =>
  (await yogaClient(app).mutation(SAVE, { input: { uri: URI, trackers: [tracker], entry, episodeCount } }).toPromise()).data.saveListEntry

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

const answersOf = (result: any): SyncAnswer[] => result.data.tracking.answers
const find = (answers: SyncAnswer[], id: string) => answers.find(answer => answer.tracker.id === id)!

describe('a sync through the providers', () => {
  test('copies AniList onto the targets named, each failing or landing on its own, and a retry lands the rest', async () => {
    const { app, asked, brokenWrites, recover } = setup()
    const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
    live.push(tracking)
    const first = answersOf(await tracking.until(result => result.data?.tracking?.answers.length === 3))
    expect(first.map(answer => [answer.tracker.id, answer.state])).toEqual([['stub', 'NOT_LISTED'], ['anilist', 'LISTED'], ['broken', 'NOT_LISTED']])

    const plan = planSync(first, 'anilist', ['stub', 'broken'])
    expect(plan.targets.find(target => target.tracker === 'stub')!.entry, "AniList's 9 goes to stub as 90, and its rewatch count of 0 as nothing")
      .toEqual({ status: 'WATCHING', progress: 12, score: 90, startedAt: { year: 2026, month: 1, day: 10 } })

    const outcomes = await applySync(plan, writeThrough(app))

    expect(outcomes).toEqual([
      { tracker: 'stub', outcome: 'SAVED', error: null },
      { tracker: 'broken', outcome: 'FAILED', error: 'The list service answered 503' },
    ])
    expect(asked.map(({ operation }) => operation), 'the source is read and never written').not.toContain('StubSaveListEntry')

    const after = answersOf(await tracking.until(result => find(answersOf(result), 'stub').state === 'LISTED'))
    expect(find(after, 'stub').entry).toMatchObject({ status: 'WATCHING', progress: 12, score: 90, startedAt: { year: 2026, month: 1, day: 10 } })

    // the retry is the plan read again: stub has nothing left to change, the failed target still has
    recover()
    const retry = planSync(after, 'anilist', ['broken'])
    expect(await applySync(retry, writeThrough(app))).toEqual([{ tracker: 'broken', outcome: 'SAVED', error: null }])
    expect(planSync(after, 'anilist', ['stub']).targets[0]!.entry).toBeNull()
    expect(brokenWrites).toHaveLength(2)
  })

  test('copies stub onto AniList as SaveMediaListEntry with the differing fields alone, the score on the viewer\'s scale', async () => {
    const { app, asked } = setup()
    const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
    live.push(tracking)
    await tracking.until(result => result.data?.tracking?.answers.length === 3)

    await writeThrough(app)('stub', { status: 'WATCHING', progress: 14, score: 87, startedAt: { year: 2026, month: 1, day: 10 } })
    const answers = answersOf(await tracking.until(result => find(answersOf(result), 'stub').entry?.progress === 14))

    const plan = planSync(answers, 'stub', ['anilist'])
    expect(plan.targets[0]!.changes.map(({ field, from, to }) => [field, from, to])).toEqual([
      ['PROGRESS', '12 / 28', '14 / 28'],
      ['SCORE', '9 / 10', '8 / 10'],
    ])
    expect(await applySync(plan, writeThrough(app))).toEqual([{ tracker: 'anilist', outcome: 'SAVED', error: null }])
    expect(asked.find(({ operation }) => operation === 'StubSaveListEntry')!.variables).toEqual({ mediaId: 154587, progress: 14, scoreRaw: 80 })
  })

  test("holds progress back from an AniList that lists nothing yet, where AniList counts the run differently", async () => {
    const { app } = setup({ listed: false })
    const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
    live.push(tracking)
    await tracking.until(result => result.data?.tracking?.answers.length === 3)

    // watched from a page that splits the run at 24 episodes, where AniList counts Frieren's 28
    await writeThrough(app, 24)('stub', { status: 'WATCHING', progress: 18 })
    const answers = answersOf(await tracking.until(result => find(answersOf(result), 'stub').entry?.progress === 18))
    expect(find(answers, 'anilist')).toMatchObject({ state: 'NOT_LISTED', episodeCount: 28 })

    const plan = planSync(answers, 'stub', ['anilist'])
    expect(plan.targets[0]!.held).toEqual([{ field: 'PROGRESS', reason: 'Stub counts 24 episodes and AniList counts 28, so progress is not copied' }])
    expect(plan.targets[0]!.entry).toEqual({ status: 'WATCHING' })

    await writeThrough(app, 28)('stub', { progress: 19 })
    const whole = answersOf(await tracking.until(result => find(answersOf(result), 'stub').entry?.progress === 19))
    expect(planSync(whole, 'stub', ['anilist']).targets[0]!.entry, 'the control: counted alike').toEqual({ status: 'WATCHING', progress: 19 })
  })

  test("holds AniList's progress back from stub's tracker, which takes the count of the page it is written from", async () => {
    const { app } = setup()
    const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
    live.push(tracking)
    const answers = answersOf(await tracking.until(result => result.data?.tracking?.answers.length === 3))
    expect(find(answers, 'stub').state).toBe('NOT_LISTED')

    // a page that splits the run at 24 episodes, where AniList counts Frieren's 28
    const plan = planSync(answers, 'anilist', ['stub'], { episodeCount: 24 })
    expect(plan.targets[0]!.held).toEqual([{ field: 'PROGRESS', reason: 'AniList counts 28 episodes and Stub counts 24, so progress is not copied' }])
    expect(await applySync(plan, writeThrough(app, 24))).toEqual([{ tracker: 'stub', outcome: 'SAVED', error: null }])
    const after = answersOf(await tracking.until(result => find(answersOf(result), 'stub').state === 'LISTED'))
    expect(find(after, 'stub').entry).toMatchObject({ status: 'WATCHING', progress: null, episodeCount: 24 })

    expect(planSync(answers, 'anilist', ['stub'], { episodeCount: 28 }).targets[0]!.entry, 'the control: a page counting 28')
      .toMatchObject({ progress: 12 })
  })
})

// HAND-MADE on a recorded row's shape: Frieren (52991) on the viewer's MyAnimeList, 28 episodes
const MAL_FRIEREN: RawRow = {
  ...HACK_SIGN,
  anime_id: 52991,
  anime_title: 'Sousou no Frieren',
  anime_title_eng: "Frieren: Beyond Journey's End",
  anime_num_episodes: 28,
  anime_url: '/anime/52991/Sousou_no_Frieren',
  status: 2,
  score: 9,
  num_watched_episodes: 28,
  updated_at: 1_789_900_000,
}

// Frieren, and a media no MyAnimeList id reaches: the catalogue's 0 is no id
const CATALOGUE = [{ mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 }, { mal: 0, anilist: 999_001, kitsu: 0, anidb: 0 }]
const withMal: CatalogLookup = { lookup: (origin, id) => CATALOGUE.find(row => row[origin] === id) }

type MalSetup = { viewer?: AnilistViewer, held?: AnilistEntry | null, mal?: FakeMalOptions, holdWaits?: boolean }

/** stub, AniList holding `held` for `viewer`, and MyAnimeList, through the app as the page reaches them. */
const setupWithMal = ({ viewer = VIEWER, held = FRIEREN_ENTRY, mal: options = {}, holdWaits = false }: MalSetup = {}) => {
  const asked: { operation: string, variables: Record<string, unknown> }[] = []
  const call = vi.fn(async (method: string, { query, variables = {} }: SessionRequest) => {
    if (method !== 'graphql') throw new Error(`anilist.co's page serves no ${method}`)
    const operation = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? 'anonymous'
    asked.push({ operation, variables })
    if (operation === 'StubSaveListEntry') {
      return { kind: 'response' as const, response: response({ data: { SaveMediaListEntry: { ...FRIEREN_ENTRY, ...held, ...variables, media: FRIEREN } } }) }
    }
    return { kind: 'response' as const, response: response({ data: { Viewer: viewer, Media: { ...FRIEREN, mediaListEntry: held } } }) }
  })
  const anilist = providerServer('anilist', anilistTrackerResolvers({ wait: async () => {} }), { catalog: async () => withMal, session: () => ({ call, onChange: () => () => {} }) })

  let now = 1_790_000_000_000
  const journal = openJournal(memoryStore(), { now: () => (now += 1_000), uuid: () => crypto.randomUUID() })
  const stub = providerServer('stub', stubTrackerResolvers(() => journal), { catalog: async () => withMal })

  const mal = fakeMal({ rows: [], ...options })
  let at = 1_790_000_000_000
  const malResolvers = malTrackerResolvers({
    now: () => at,
    // a pause held for good, so an answer that says PAUSED stays that way while the test reads it
    wait: async ms => { if (holdWaits) await new Promise(() => {}); at += ms },
  })
  const malServer = providerServer('mal', malResolvers, { catalog: async () => withMal, session: () => mal.session })

  const entry = (origin: string, target: ReturnType<typeof providerServer>): TrackerProvider => ({ name: origin, extractor: { origin }, client: yogaClient(target) })
  const fallback: Tracker = { id: '', name: '', icon: null, color: null, signedIn: false, account: null, canWrite: false, scoreScale: 'POINT_100', writeNotice: null, keepsPageEpisodeCount: false, keeps: [...SYNC_FIELDS], rewatchThroughCompleted: false }
  const app = providerServer('app', trackingResolvers([entry('stub', stub), entry('anilist', anilist), entry('mal', malServer)], provider => ({ ...fallback, id: provider.extractor.origin, name: provider.extractor.origin })))
  const watch = (uri = URI) => {
    const tracking = subscribe(app, TRACKING, { input: { uri } })
    live.push(tracking)
    return tracking
  }
  const write = (uri = URI, episodeCount?: number) => async (tracker: string, input: ListEntryInput) =>
    (await yogaClient(app).mutation(SAVE, { input: { uri, trackers: [tracker], entry: input, episodeCount } }).toPromise()).data.saveListEntry
  return { app, asked, mal, watch, write }
}

const malIs = (predicate: (answer: SyncAnswer) => boolean) => (result: any) => {
  const answer = result.data?.tracking?.answers.find((one: SyncAnswer) => one.tracker.id === 'mal')
  return Boolean(answer && predicate(answer))
}

const changesOf = (plan: ReturnType<typeof planSync>, tracker: string) =>
  plan.targets.find(target => target.tracker === tracker)!.changes.map(({ field, from, to, note }) => [field, from, to, note])

describe('a sync with MyAnimeList, through its own provider', () => {
  test("copies AniList onto MyAnimeList on its ten points, against MyAnimeList's own count, and no date", async () => {
    const { watch, write, mal, asked } = setupWithMal({ mal: { episodes: { 52991: 28 } } })
    const tracking = watch()
    const answers = answersOf(await tracking.until(malIs(answer => answer.state === 'NOT_LISTED' && answer.episodeCount === 28)))
    expect(find(answers, 'mal').tracker).toMatchObject({ scoreScale: 'POINT_10', keeps: ['STATUS', 'PROGRESS', 'SCORE'], rewatchThroughCompleted: true, keepsPageEpisodeCount: false })

    const plan = planSync(answers, 'anilist', ['mal'])
    expect(changesOf(plan, 'mal')).toEqual([
      ['STATUS', null, 'Watching', undefined],
      ['PROGRESS', null, '12 / 28', undefined],
      ['SCORE', null, '8 / 10', "rounded from AniList's 8.5 / 10"],
    ])
    expect(plan.targets[0]!.held).toEqual([{ field: 'STARTED_AT', reason: 'MyAnimeList does not take the start date from stub, so it is not copied' }])
    expect(plan.targets[0]!.entry).toEqual({ status: 'WATCHING', progress: 12, score: 80 })

    expect(await applySync(plan, write())).toEqual([{ tracker: 'mal', outcome: 'SAVED', error: null }])
    expect(mal.writes().map(({ steps }) => steps), 'the 8 the preview showed').toEqual([[{ kind: 'add', fields: { anime_id: 52991, status: 1, score: 8, num_watched_episodes: 12 } }]])
    expect(asked.map(({ operation }) => operation), 'the source is read and never written').not.toContain('StubSaveListEntry')

    const after = await tracking.until(malIs(answer => answer.state === 'LISTED'))
    expect(find(answersOf(after), 'mal').entry).toMatchObject({ status: 'WATCHING', progress: 12, score: 80, scoreLabel: '8 / 10', episodeCount: 28 })
    expect(planSync(answersOf(after), 'anilist', ['mal']).targets[0]!.entry, "AniList's 85 is MyAnimeList's 8: nothing left to copy").toBeNull()
    expect(after.data.tracking.disagreements).not.toContain('SCORE')
  })

  test("copies MyAnimeList onto AniList and stub, its 9 compared with AniList's 8.5 on ten points", async () => {
    const { watch, write, asked } = setupWithMal({ mal: { rows: [MAL_FRIEREN] } })
    const answers = answersOf(await watch().until(malIs(answer => answer.state === 'LISTED')))

    const plan = planSync(answers, 'mal', ['anilist', 'stub'], { episodeCount: 28 })
    expect(changesOf(plan, 'anilist')).toEqual([
      ['STATUS', 'Watching', 'Completed', undefined],
      ['PROGRESS', '12 / 28', '28 / 28', undefined],
      ['SCORE', '8.5 / 10', '9.0 / 10', undefined],
    ])
    expect(plan.targets.find(target => target.tracker === 'stub')!.entry).toEqual({ status: 'COMPLETED', progress: 28, score: 90 })
    expect(await applySync(plan, write(URI, 28))).toEqual([
      { tracker: 'anilist', outcome: 'SAVED', error: null },
      { tracker: 'stub', outcome: 'SAVED', error: null },
    ])
    expect(asked.find(({ operation }) => operation === 'StubSaveListEntry')!.variables).toEqual({ mediaId: 154587, status: 'COMPLETED', progress: 28, scoreRaw: 90 })

    const eight = setupWithMal({ mal: { rows: [{ ...MAL_FRIEREN, score: 8 }] } })
    const same = await eight.watch().until(malIs(answer => answer.state === 'LISTED'))
    expect(planSync(answersOf(same), 'mal', ['anilist']).targets[0]!.changes.map(({ field }) => field), 'the control: 8 and 8.5 agree on ten points')
      .toEqual(['STATUS', 'PROGRESS'])
    expect(same.data.tracking.disagreements).not.toContain('SCORE')
  })

  test('holds progress back from a MyAnimeList that counts the run differently, whatever the page counts', async () => {
    const { watch } = setupWithMal({ mal: { episodes: { 52991: 24 } } })
    const answers = answersOf(await watch().until(malIs(answer => answer.episodeCount === 24)))

    const plan = planSync(answers, 'anilist', ['mal'], { episodeCount: 28 })
    expect(plan.targets[0]!.held).toContainEqual({ field: 'PROGRESS', reason: 'AniList counts 28 episodes and MyAnimeList counts 24, so progress is not copied' })
    expect(plan.targets[0]!.entry).toEqual({ status: 'WATCHING', score: 80 })

    const listed = setupWithMal({ mal: { rows: [{ ...MAL_FRIEREN, anime_num_episodes: 24, status: 1, num_watched_episodes: 3 }] } })
    const held = answersOf(await listed.watch().until(malIs(answer => answer.state === 'LISTED')))
    expect(planSync(held, 'anilist', ['mal'], { episodeCount: 28 }).targets[0]!.entry, 'listed, by its own count too').toEqual({ score: 80 })
  })

  test('starts a rewatch on MyAnimeList only from Completed, with the flag first, and never from anything else', async () => {
    const repeating = { ...FRIEREN_ENTRY, status: 'REPEATING', progress: 3 }
    const watching = setupWithMal({ held: repeating, mal: { rows: [{ ...MAL_FRIEREN, status: 1, num_watched_episodes: 20 }] } })
    const refused = planSync(answersOf(await watching.watch().until(malIs(answer => answer.state === 'LISTED'))), 'anilist', ['mal'])
    expect(refused.targets[0]).toEqual({ tracker: 'mal', refusal: 'MyAnimeList starts a rewatch only on an entry it lists as Completed', changes: [], held: [], entry: null })
    expect(await applySync(refused, watching.write())).toEqual([])
    expect(watching.mal.writes()).toEqual([])

    const completed = setupWithMal({ held: repeating, mal: { rows: [MAL_FRIEREN] } })
    const plan = planSync(answersOf(await completed.watch().until(malIs(answer => answer.state === 'LISTED'))), 'anilist', ['mal'])
    expect(plan.targets[0]!.entry).toEqual({ status: 'REWATCHING', progress: 3, score: 80 })
    expect(await applySync(plan, completed.write())).toEqual([{ tracker: 'mal', outcome: 'SAVED', error: null }])
    expect(completed.mal.writes().map(({ steps }) => steps)).toEqual([
      [{ kind: 'edit', fields: { anime_id: 52991, status: 2, is_rewatching: 1 } }],
      [{ kind: 'edit', fields: { anime_id: 52991, status: 2, score: 8, num_watched_episodes: 3 } }],
    ])
    expect(completed.mal.row(52991)).toMatchObject({ status: 2, is_rewatching: 1, num_watched_episodes: 3, score: 8 })
  })

  test("ends a MyAnimeList rewatch as Completed through MyAnimeList's own finish, which the preview says counts", async () => {
    const { watch, write, mal } = setupWithMal({ held: { ...FRIEREN_ENTRY, status: 'COMPLETED', progress: 28 }, mal: { rows: [{ ...MAL_FRIEREN, is_rewatching: 1, num_watched_episodes: 3, score: 8 }] } })
    const plan = planSync(answersOf(await watch().until(malIs(answer => answer.entry?.status === 'REWATCHING'))), 'anilist', ['mal'])
    expect(changesOf(plan, 'mal')).toEqual([
      ['STATUS', 'Rewatching', 'Completed', 'counts one finished rewatch on MyAnimeList'],
      ['PROGRESS', '3 / 28', '28 / 28', undefined],
    ])
    expect(await applySync(plan, write())).toEqual([{ tracker: 'mal', outcome: 'SAVED', error: null }])
    expect(mal.writes().map(({ steps }) => steps.map(step => step.kind))).toEqual([['finish-rewatch', 'edit']])
    expect(mal.state.finishedRewatches).toBe(1)
  })

  // a LISTED answer anyone may copy from, for the targets a real source could not be copied onto here
  const copyable: SyncAnswer = { state: 'LISTED', pending: 0, tracker: { id: 'anilist', name: 'AniList', canWrite: true, scoreScale: 'POINT_100' }, entry: { status: 'WATCHING', progress: 1 } }

  test.each([
    ['SIGNED_OUT', 'Sign in to MyAnimeList first', { mal: { user: null } }, URI],
    ['PAUSED', 'MyAnimeList asked stub to wait', { holdWaits: true, mal: { rows: [MAL_FRIEREN] } }, URI],
    ['ERROR', 'MyAnimeList could not answer', { mal: { rows: [MAL_FRIEREN] } }, URI],
    ['NO_ID', 'MyAnimeList has no id for this media', {}, 'ag:(anilist:999001)'],
    ['AMBIGUOUS', 'MyAnimeList names two entries for this media and cannot tell which one is meant', {}, 'ag:(mal:52991,mal:99999)'],
    ['NOT_LISTED', 'MyAnimeList lists nothing for this media', {}, URI],
  ] as const)('never syncs out of a MyAnimeList that answers %s, nor into one that cannot answer', async (state, why, options, uri) => {
    const { watch, write, mal } = setupWithMal(options as MalSetup)
    if (state === 'PAUSED') mal.script.list = () => answerOf('', { status: 429, retryAfter: 60 })
    if (state === 'ERROR') mal.script.whoami = () => ({ kind: 'whoami', status: 200, url: 'https://myanimelist.net/about.php', page: false, user: null, token: false, blocked: false, retryAfter: null })
    const answer = find(answersOf(await watch(uri).until(malIs(one => one.state === state))), 'mal')

    expect(sourceRefusal(answer)).toBe(why)
    const onto = planSync([copyable, answer], 'anilist', ['mal'])
    if (state === 'NOT_LISTED') expect(onto.targets[0]!.entry, 'the control: a target that lists nothing yet').toEqual({ status: 'WATCHING', progress: 1 })
    else {
      expect(onto.targets[0]!.refusal).toBe(why)
      expect(await applySync(onto, write(uri))).toEqual([])
      expect(mal.writes()).toEqual([])
    }
  })
})

const answerIs = (id: string, predicate: (answer: SyncAnswer) => boolean) => (result: any) => {
  const answer = result.data?.tracking?.answers.find((one: SyncAnswer) => one.tracker.id === id)
  return Boolean(answer && predicate(answer))
}

// read off the real providers' answers, never an ERROR answer, which carries the app's fallback tracker
const bothAnswered = (result: any) =>
  answerIs('anilist', answer => answer.state === 'LISTED')(result) && answerIs('stub', answer => answer.state === 'NOT_LISTED' || answer.state === 'LISTED')(result)

describe("AniList's and stub's own trackers, as a sync reads them", () => {
  test('both keep every field a sync copies, and take a rewatch from any status', async () => {
    const answers = answersOf(await setupWithMal().watch().until(bothAnswered))
    for (const id of ['anilist', 'stub']) {
      expect(find(answers, id).tracker, id).toMatchObject({ keeps: ['STATUS', 'PROGRESS', 'SCORE', 'STARTED_AT', 'COMPLETED_AT', 'REWATCH_COUNT'], rewatchThroughCompleted: false })
    }
  })

  test("copies stub's dates and rewatch count onto AniList", async () => {
    const { watch, write, asked } = setupWithMal()
    const tracking = watch()
    await tracking.until(bothAnswered)
    await write(URI, 28)('stub', { status: 'COMPLETED', progress: 28, startedAt: { year: 2026, month: 1, day: 12 }, completedAt: { year: 2026, month: 3, day: 20 }, rewatchCount: 1 })
    const answers = answersOf(await tracking.until(answerIs('stub', answer => answer.entry?.rewatchCount === 1)))

    const plan = planSync(answers, 'stub', ['anilist'])
    expect(changesOf(plan, 'anilist')).toEqual([
      ['STATUS', 'Watching', 'Completed', undefined],
      ['PROGRESS', '12 / 28', '28 / 28', undefined],
      ['STARTED_AT', '2026-01-10', '2026-01-12', undefined],
      ['COMPLETED_AT', null, '2026-03-20', undefined],
      ['REWATCH_COUNT', null, '1', undefined],
    ])
    expect(plan.targets[0]!.held).toEqual([])
    expect(await applySync(plan, write(URI, 28))).toEqual([{ tracker: 'anilist', outcome: 'SAVED', error: null }])
    expect(asked.find(({ operation }) => operation === 'StubSaveListEntry')!.variables).toEqual({
      mediaId: 154587,
      status: 'COMPLETED',
      progress: 28,
      repeat: 1,
      startedAt: { year: 2026, month: 1, day: 12 },
      completedAt: { year: 2026, month: 3, day: 20 },
    })
  })

  const repeating = { ...FRIEREN_ENTRY, status: 'REPEATING', progress: 3 }

  test('moves an AniList rewatch back to Watching', async () => {
    const { watch, write, asked } = setupWithMal({ held: repeating })
    const tracking = watch()
    await tracking.until(bothAnswered)
    await write(URI, 28)('stub', { status: 'WATCHING', progress: 5 })
    const plan = planSync(answersOf(await tracking.until(answerIs('stub', answer => answer.entry?.progress === 5))), 'stub', ['anilist'])
    expect(plan.targets[0]!.refusal).toBeUndefined()
    expect(changesOf(plan, 'anilist')).toEqual([
      ['STATUS', 'Rewatching', 'Watching', undefined],
      ['PROGRESS', '3 / 28', '5 / 28', undefined],
    ])
    expect(await applySync(plan, write(URI, 28))).toEqual([{ tracker: 'anilist', outcome: 'SAVED', error: null }])
    expect(asked.find(({ operation }) => operation === 'StubSaveListEntry')!.variables).toEqual({ mediaId: 154587, status: 'CURRENT', progress: 5 })
  })

  test('ends an AniList rewatch as Completed with no rewatch counted', async () => {
    const { watch, write } = setupWithMal({ held: repeating })
    const tracking = watch()
    await tracking.until(bothAnswered)
    await write(URI, 28)('stub', { status: 'COMPLETED', progress: 28 })
    const plan = planSync(answersOf(await tracking.until(answerIs('stub', answer => answer.entry?.progress === 28))), 'stub', ['anilist'])
    expect(changesOf(plan, 'anilist'), 'AniList counts no rewatch on its own, so the preview says nothing of one').toEqual([
      ['STATUS', 'Rewatching', 'Completed', undefined],
      ['PROGRESS', '3 / 28', '28 / 28', undefined],
    ])
  })

  test("starts a rewatch on stub's tracker from an entry that is not Completed", async () => {
    const { watch, write } = setupWithMal({ held: repeating })
    const tracking = watch()
    const plan = planSync(answersOf(await tracking.until(bothAnswered)), 'anilist', ['stub'], { episodeCount: 28 })
    expect(plan.targets[0]!.refusal, 'stub lists nothing, which is not Completed').toBeUndefined()
    expect(plan.targets[0]!.entry).toEqual({ status: 'REWATCHING', progress: 3, score: 85, startedAt: { year: 2026, month: 1, day: 10 } })
    expect(await applySync(plan, write(URI, 28))).toEqual([{ tracker: 'stub', outcome: 'SAVED', error: null }])
    const after = answersOf(await tracking.until(answerIs('stub', answer => answer.state === 'LISTED')))
    expect(find(after, 'stub').entry).toMatchObject({ status: 'REWATCHING', progress: 3 })
  })

  test("ends a rewatch on stub's tracker in a status that is not Completed", async () => {
    const { watch, write } = setupWithMal()
    const tracking = watch()
    await tracking.until(bothAnswered)
    await write(URI, 28)('stub', { status: 'REWATCHING', progress: 2 })
    const plan = planSync(answersOf(await tracking.until(answerIs('stub', answer => answer.entry?.status === 'REWATCHING'))), 'anilist', ['stub'], { episodeCount: 28 })
    expect(plan.targets[0]!.refusal).toBeUndefined()
    expect(changesOf(plan, 'stub')[0]).toEqual(['STATUS', 'Rewatching', 'Watching', undefined])
  })
})
