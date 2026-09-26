// The app-level tracking resolvers over two providers: the real stub tracker and a fake second one.
// Each answers alone through the shared fan-out, the page gets both answers and a summary, and a write
// reaches the providers it names and no other.
import { afterEach, expect, test } from 'vitest'

import type { Tracker } from '../../../src/generated/schema/types.generated'

import { trackingResolvers, type TrackerProvider } from '../../../src/tracking/app-resolvers'
import { stubTrackerResolvers } from '../../../src/sources/stub/tracker-resolvers'
import { openJournal, type Journal } from '../../../src/tracking/journal'
import { memoryStore } from './memory-store'
import { providerServer, subscribe, yogaClient } from '../worker/yoga-client'

const URI = 'ag:(anilist:1)'

const OTHER: Tracker = { id: 'other', name: 'Other', icon: null, color: null, signedIn: true, account: 'someone', canWrite: true, scoreScale: 'POINT_100' }

const otherWrites: unknown[] = []
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
              pending: 0,
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
      answers { state tracker { id } entry { _id progress score } }
    }
  }
`
const SAVE = `
  mutation ($input: SaveListEntryInput!) {
    saveListEntry(input: $input) { tracker outcome error }
  }
`

const live: { close: () => void }[] = []
afterEach(() => { while (live.length) live.pop()!.close() })

test('every provider answers alone and the page gets each answer beside the summary', async () => {
  const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
  live.push(tracking)

  const both = (await tracking.until(result => result.data?.tracking?.answers.length === 2)).data.tracking
  expect(both.answers.map((answer: { tracker: { id: string }, state: string }) => [answer.tracker.id, answer.state]))
    .toEqual([['stub', 'NOT_LISTED'], ['other', 'LISTED']])
  expect(both.summary).toMatchObject({ _id: `summary:${URI}`, progress: 7, score: 90 })
})

test('a save goes to the providers it names and to no other, and the page sees it land', async () => {
  otherWrites.length = 0
  const tracking = subscribe(app, TRACKING, { input: { uri: URI } })
  live.push(tracking)
  await tracking.until(result => result.data?.tracking?.answers.length === 2)

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
