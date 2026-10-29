// The app-level tracking resolvers over two providers: the real stub tracker and a fake second one.
// Each answers alone through the shared fan-out, the page gets both answers and a summary, and a write
// reaches the providers it names and no other.
import { afterEach, expect, test } from 'vite-plus/test'

import type { Tracker } from '../../../src/generated/schema/types.generated'

import { trackingResolvers, type TrackerProvider } from '../../../src/tracking/app-resolvers'
import { stubTrackerResolvers } from '../../../src/sources/stub/tracker-resolvers'
import { openJournal, type Journal } from '../../../src/tracking/journal'
import { memoryStore } from './memory-store'
import { providerServer, subscribe, yogaClient } from '../worker/yoga-client'

const URI = 'ag:(anilist:1)'

const OTHER: Tracker = { id: 'other', name: 'Other', icon: null, color: null, signedIn: true, account: 'someone', canWrite: true, scoreScale: 'POINT_100' }

const otherWrites: unknown[] = []
const otherDeletes: unknown[] = []
const other = providerServer('other', {
  Subscription: {
    tracking: {
      subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }) {
        yield {
          tracking: {
            _id: `tracking:${input.uri}`,
            answers: [{
              _id: `answer:other:${input.uri}`,
              tracker: OTHER,
              state: 'LISTED',
              entry: { _id: 'other:42', tracker: 'other', mediaUri: 'anilist:1', status: 'WATCHING', progress: 7, score: 90, updatedAt: '2026-09-01T00:00:00.000Z' },
              candidates: [],
              error: null,
            }],
            summary: null,
            disagreements: [],
          },
        }
      },
    },
  },
  Mutation: {
    saveListEntry: (_parent: unknown, { input }: { input: unknown }) => {
      otherWrites.push(input)
      return [{ tracker: 'other', outcome: 'SAVED', entry: null, error: null }]
    },
    deleteListEntry: (_parent: unknown, { input }: { input: unknown }) => {
      otherDeletes.push(input)
      return [{ tracker: 'other', outcome: 'SAVED', entry: null, error: null }]
    },
  },
})

// a provider whose every answer fails, as one does when its service is down
const broken = providerServer('broken', {
  Subscription: {
    tracking: {
      subscribe: () => { throw new Error('The list service answered 503') },
    },
  },
})

// a provider that answers only once the test lets it
let release = () => {}
const slow = providerServer('slow', {
  Subscription: {
    tracking: {
      subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }) {
        await new Promise<void>(resolve => { release = resolve })
        yield {
          tracking: {
            _id: `tracking:${input.uri}`,
            answers: [{ _id: `answer:slow:${input.uri}`, tracker: { ...OTHER, id: 'slow' }, state: 'NOT_LISTED', entry: null, candidates: [], error: null }],
            summary: null,
            disagreements: [],
          },
        }
      },
    },
  },
})

// a provider with no tracking of its own answers null, as the default a provider yields
const silent = providerServer('silent', {
  Subscription: {
    tracking: {
      subscribe: async function* () { yield { tracking: null } },
    },
  },
})

// a provider that answers, then answers nothing once the test says so
let retract = () => {}
const fickle = providerServer('fickle', {
  Subscription: {
    tracking: {
      subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }) {
        yield {
          tracking: {
            _id: `tracking:${input.uri}`,
            answers: [{ _id: `answer:fickle:${input.uri}`, tracker: { ...OTHER, id: 'fickle' }, state: 'NOT_LISTED', entry: null, candidates: [], error: null }],
            summary: null,
            disagreements: [],
          },
        }
        await new Promise<void>(resolve => { retract = resolve })
        yield { tracking: null }
      },
    },
  },
})

let now = 1_700_000_000_000
let journal: Promise<Journal> | undefined
const stub = providerServer(
  'stub',
  stubTrackerResolvers(() => (journal ??= openJournal(memoryStore(), { now: () => (now += 1_000), uuid: () => crypto.randomUUID() }))),
  { catalog: async () => ({ lookup: () => undefined }) },
)

const entry = (origin: string, target: typeof stub): TrackerProvider => ({ name: origin, extractor: { origin }, client: yogaClient(target) })
const providers = [entry('stub', stub), entry('other', other)]
const trackerOf = (provider: TrackerProvider): Tracker => ({ ...OTHER, id: provider.extractor.origin, name: provider.extractor.origin, signedIn: false, account: null })

const app = providerServer('app', trackingResolvers(providers, trackerOf))

const TRACKING = `
  subscription ($input: TrackingInput!) {
    tracking(input: $input) {
      _id
      summary { _id status progress score }
      disagreements
      answers { state error tracker { id } entry { _id progress score } }
    }
  }
`
const SAVE = `
  mutation ($input: SaveListEntryInput!) {
    saveListEntry(input: $input) { tracker outcome error }
  }
`

const DELETE = `
  mutation ($input: DeleteListEntryInput!) {
    deleteListEntry(input: $input) { tracker outcome error }
  }
`

type Answer = { tracker: { id: string }, state: string }
const states = (answers: Answer[]) => answers.map(answer => [answer.tracker.id, answer.state])
// every asked tracker has answered, so nothing in the result is still loading
const settled = (count: number) => (result: any) =>
  result.data?.tracking?.answers.length === count && result.data.tracking.answers.every((answer: Answer) => answer.state !== 'LOADING')

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

test('every provider answers alone and the page gets each answer beside the summary', async () => {
  const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  const both = (await tracking.until(settled(2))).data.tracking
  expect(states(both.answers)).toEqual([['stub', 'NOT_LISTED'], ['other', 'LISTED']])
  expect(both.summary).toMatchObject({ _id: `summary:${URI}`, progress: 7, score: 90 })
})

test('a save goes to the providers it names and to no other, and the page sees it land', async () => {
  otherWrites.length = 0
  const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
  live.push(tracking)
  await tracking.until(settled(2))

  const saved = await yogaClient(app).mutation(SAVE, { input: { uri: URI, trackers: ['stub'], entry: { status: 'WATCHING', progress: 3, score: 80 } } }).toPromise()

  expect(saved.data.saveListEntry).toEqual([{ tracker: 'stub', outcome: 'SAVED', error: null }])
  expect(otherWrites, 'the second provider is connected and was not named, so it is not written to').toEqual([])

  const after = (await tracking.until(result => result.data.tracking.answers[0].state === 'LISTED')).data.tracking
  expect(after.answers[0].entry).toMatchObject({ progress: 3, score: 80 })
  expect(after.answers[1].entry, 'the other provider\'s answer is its own and unchanged').toMatchObject({ progress: 7, score: 90 })
  expect(after.summary).toMatchObject({ progress: 7 })
  expect(after.disagreements).toEqual(['PROGRESS', 'SCORE'])
})

test('a write to a tracker that does not exist is refused, and naming none writes nowhere', async () => {
  const unknown = await yogaClient(app).mutation(SAVE, { input: { uri: URI, trackers: ['nope'], entry: { progress: 1 } } }).toPromise()
  const none = await yogaClient(app).mutation(SAVE, { input: { uri: URI, trackers: [], entry: { progress: 1 } } }).toPromise()

  expect(unknown.data.saveListEntry).toMatchObject([{ tracker: 'nope', outcome: 'REFUSED' }])
  expect(none.data.saveListEntry).toEqual([])
})

test('the page may ask only some trackers', async () => {
  const tracking = subscribe(app, TRACKING, { input: { uri: URI, trackers: ['other'] } })
  live.push(tracking)

  const answers = (await tracking.next()).data.tracking.answers
  expect(answers.map((answer: { tracker: { id: string } }) => answer.tracker.id)).toEqual(['other'])
})

test('a delete goes to the providers it names and to no other', async () => {
  otherDeletes.length = 0
  await yogaClient(app).mutation(SAVE, { input: { uri: URI, trackers: ['stub'], entry: { status: 'WATCHING', progress: 4 } } }).toPromise()

  const deleted = await yogaClient(app).mutation(DELETE, { input: { uri: URI, trackers: ['stub'] } }).toPromise()

  expect(deleted.data.deleteListEntry).toEqual([{ tracker: 'stub', outcome: 'SAVED', error: null }])
  expect(otherDeletes, 'the second provider is connected and was not named, so nothing is removed from it').toEqual([])

  const named = await yogaClient(app).mutation(DELETE, { input: { uri: URI, trackers: ['other'] } }).toPromise()
  expect(named.data.deleteListEntry, 'the control: once named, it is asked').toEqual([{ tracker: 'other', outcome: 'SAVED', error: null }])
  expect(otherDeletes).toHaveLength(1)
})

test('a provider that fails is shown as failed rather than left out', async () => {
  const withBroken = providerServer('app', trackingResolvers([entry('stub', stub), entry('broken', broken)], trackerOf))
  const tracking = subscribe(withBroken, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  const both = await tracking.until(settled(2))
    .catch(() => { throw new Error('the page never got an answer for the failing provider') })
  expect(both.data.tracking.answers[1]).toMatchObject({ state: 'ERROR', error: 'The list service answered 503', tracker: { id: 'broken' } })
})

test("a tracker that has not answered yet is in the page's first answer, as loading, and its own answer replaces it", async () => {
  const withSlow = providerServer('app', trackingResolvers([entry('stub', stub), entry('slow', slow)], trackerOf))
  const tracking = subscribe(withSlow, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  const first = (await tracking.next()).data.tracking
  expect(states(first.answers)).toEqual([['stub', 'NOT_LISTED'], ['slow', 'LOADING']])
  expect(first.answers[1].tracker.id, 'named as its provider, so its chip can be drawn').toBe('slow')

  release()
  expect(states((await tracking.next()).data.tracking.answers)).toEqual([['stub', 'NOT_LISTED'], ['slow', 'NOT_LISTED']])
})

test('a tracker that answers nothing is left out, not loading for ever', async () => {
  const withSilent = providerServer('app', trackingResolvers([entry('stub', stub), entry('silent', silent)], trackerOf))
  const tracking = subscribe(withSilent, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  const answers = (await tracking.until(settled(1))).data.tracking.answers
  expect(states(answers)).toEqual([['stub', 'NOT_LISTED']])
})

test('the first answer comes before any tracker has answered, with every tracker loading', async () => {
  const withSlow = providerServer('app', trackingResolvers([entry('slow', slow)], trackerOf))
  const tracking = subscribe(withSlow, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  expect(states((await tracking.next(1_000)).data.tracking.answers)).toEqual([['slow', 'LOADING']])
  release()
})

test('a tracker whose latest answer is nothing is left out, even after it answered', async () => {
  const withFickle = providerServer('app', trackingResolvers([entry('stub', stub), entry('fickle', fickle)], trackerOf))
  const tracking = subscribe(withFickle, TRACKING, { input: { uri: URI } })
  live.push(tracking)
  await tracking.until(settled(2))

  retract()
  expect(states((await tracking.until(settled(1), 1_000)).data.tracking.answers)).toEqual([['stub', 'NOT_LISTED']])
})

// HOR-1064 (a My list page): every tracker's whole list, joined
const LISTS = `
  subscription {
    viewerLists {
      _id
      lists { state tracker { id } }
      rows { uri disagreements summary { progress } answers { tracker { id } entry { progress } } }
    }
  }
`

const listed = providerServer('listed', {
  Subscription: {
    viewerLists: {
      subscribe: async function* () {
        yield {
          viewerLists: {
            _id: 'viewerLists',
            lists: [{
              _id: 'list:listed',
              tracker: { ...OTHER, id: 'listed' },
              state: 'LISTED',
              items: [{ entry: { _id: 'listed:10', tracker: 'listed', mediaUri: 'mal:10', status: 'WATCHING', progress: 7, updatedAt: '2026-09-01T00:00:00.000Z' }, episodeCount: 12, mediaStatus: 'FINISHED', type: 'TV', nextAiringEpisode: null }],
            }],
            rows: [],
          },
        }
      },
    },
  },
})

const unlisted = providerServer('unlisted', {
  Subscription: {
    viewerLists: { subscribe: () => { throw new Error('The list service answered 503') } },
  },
})

test("every tracker's list comes joined, one row per work, beside where each tracker stands", async () => {
  const own = providerServer('stub', stubTrackerResolvers((() => {
    let opened: Promise<Journal> | undefined
    return () => (opened ??= openJournal(memoryStore(), { now: () => (now += 1_000), uuid: () => crypto.randomUUID() }))
  })()), { catalog: async () => ({ lookup: () => undefined }) })
  await yogaClient(own).mutation(SAVE, { input: { uri: 'ag:(anilist:1)', trackers: ['stub'], entry: { status: 'WATCHING', progress: 3 } } }).toPromise()
  const catalog = { lookup: (origin: string, id: number) => ({ anilist: 1, mal: 10 } as Record<string, number>)[origin] === id ? { anilist: 1, mal: 10 } : undefined }
  const withLists = providerServer('app', trackingResolvers(
    [entry('stub', own), entry('listed', listed), entry('silent', silent), entry('unlisted', unlisted)],
    trackerOf,
    async () => catalog as never,
  ))
  const lists = subscribe(withLists, LISTS, {})
  live.push(lists)

  const joined = (await lists.until(result => result.data.viewerLists.lists.every((list: { state: string }) => list.state !== 'LOADING'))).data.viewerLists
  expect(joined.lists.map((list: { tracker: { id: string }, state: string }) => [list.tracker.id, list.state]), 'a tracker with no list is left out')
    .toEqual([['stub', 'LISTED'], ['listed', 'LISTED'], ['unlisted', 'ERROR']])
  expect(joined.rows).toEqual([{
    uri: 'anilist:1',
    disagreements: ['PROGRESS'],
    summary: { progress: 7 },
    answers: [{ tracker: { id: 'stub' }, entry: { progress: 3 } }, { tracker: { id: 'listed' }, entry: { progress: 7 } }],
  }])
})
