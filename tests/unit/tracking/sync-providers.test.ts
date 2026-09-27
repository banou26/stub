// A per-media sync end to end through the app's tracking resolvers, over the real stub tracker, the
// real AniList tracker on a fake session answering with AniList's own answers, and a fake third
// provider that fails. The plan is read off the answers the page gets, through the page's own
// subscription document, and applied as the panel applies it: one `saveListEntry` per target, naming
// that target alone.
import { print } from 'graphql'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ListEntryInput, Tracker } from '../../../src/generated/schema/types.generated'
import type { SessionRateLimit, SessionRequest, SessionResponse } from '../../../src/sources/anilist/session-page'
import type { CatalogLookup } from '../../../src/tracking/identity'

import { MediaTrackingDocument } from '../../../src/generated/graphql'
import { anilistTrackerResolvers } from '../../../src/sources/anilist/tracker-resolvers'
import { stubTrackerResolvers } from '../../../src/sources/stub/tracker-resolvers'
import { trackingResolvers, type TrackerProvider } from '../../../src/tracking/app-resolvers'
import { openJournal } from '../../../src/tracking/journal'
import { applySync, planSync, type SyncAnswer } from '../../../src/tracking/sync'
import { FRIEREN, FRIEREN_ENTRY, VIEWER } from '../sources/anilist/list-fixtures'
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
  const graphql = vi.fn(async ({ query, variables = {} }: SessionRequest) => {
    const operation = /(?:query|mutation) (\w+)/.exec(query)?.[1] ?? 'anonymous'
    asked.push({ operation, variables })
    if (operation === 'StubSaveListEntry') {
      return { kind: 'response' as const, response: response({ data: { SaveMediaListEntry: { ...HELD, ...variables, media: FRIEREN } } }) }
    }
    return { kind: 'response' as const, response: response({ data: { Viewer: TEN_POINT, Media: { ...FRIEREN, mediaListEntry: listed ? HELD : null } } }) }
  })
  const session = { graphql, onChange: () => () => {} }
  const anilist = providerServer('anilist', anilistTrackerResolvers({ wait: async () => {} }), { catalog: async () => catalog, session: () => session })

  let now = 1_790_000_000_000
  const store = memoryStore()
  const journal = openJournal(store, { now: () => (now += 1_000), uuid: () => crypto.randomUUID() })
  const stub = providerServer('stub', stubTrackerResolvers(() => journal), { catalog: async () => catalog })

  // a provider whose list is empty and whose first write fails, as one does while its service is down
  const brokenWrites: unknown[] = []
  let down = true
  const brokenTracker: Tracker = { id: 'broken', name: 'Broken', icon: null, color: null, signedIn: true, account: null, canWrite: true, scoreScale: 'POINT_100', writeNotice: null }
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
})
