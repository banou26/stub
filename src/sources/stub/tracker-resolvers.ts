// The stub tracker's resolvers over a journal it is handed, so a test can serve them over a journal
// kept in memory. ./tracker.ts hands them this device's.

import type { ListEntry, Resolvers, Tracker, TrackerAnswer, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { SessionScope } from '../../tracking/account-link'
import type { Found, Journal, JournalEntry } from '../../tracking/journal'

import { answerId, changes, errorAnswer } from '../../tracking/collect'
import { trackingId } from '../../tracking/aggregate'
import { entryMediaUri, identify, type CatalogLookup, type MediaIdentity } from '../../tracking/identity'
import { liveValues, patchFrom } from '../../tracking/journal'
import { SYNC_FIELDS } from '../../tracking/sync'

export const STUB_TRACKER_ID = 'stub'

/** What the tracker reads off its request context, beside what every provider gets. */
export type StubTrackerContext = {
  catalog: () => Promise<CatalogLookup>
  request: { signal: AbortSignal }
}

export const stubTracker: Tracker = {
  id: STUB_TRACKER_ID,
  name: 'Stub',
  icon: null,
  color: null,
  // nothing to sign in to: the list is this device's, or the FKN account's while one is signed in
  signedIn: true,
  account: 'This device',
  canWrite: true,
  scoreScale: 'POINT_100',
  writeNotice: null,
  // patchFrom stores the episodeCount the page sends with each write
  keepsPageEpisodeCount: true,
  keeps: [...SYNC_FIELDS],
  rewatchThroughCompleted: false,
}

/** The tracker as it answers, naming whose list it holds. */
export const stubTrackerAt = (where: SessionScope): Tracker =>
  ({ ...stubTracker, account: where === 'account' ? 'FKN account' : 'This device' })

const iso = (at: number | undefined) => at ? new Date(at).toISOString() : null

const listEntryOf = (entry: JournalEntry, values: Found & { state: 'LISTED' | 'NOT_LISTED' }): ListEntry => ({
  _id: `${STUB_TRACKER_ID}:${entry.id}`,
  tracker: STUB_TRACKER_ID,
  mediaUri: entryMediaUri(entry),
  status: values.values.status ?? null,
  progress: values.values.progress ?? null,
  score: values.values.score ?? null,
  scoreLabel: values.values.score != null ? String(values.values.score) : null,
  startedAt: values.values.startedAt ?? null,
  completedAt: values.values.completedAt ?? null,
  rewatchCount: values.values.rewatchCount ?? null,
  updatedAt: iso(values.updatedAt),
  url: null,
  title: values.values.title ?? null,
  cover: values.values.cover ?? null,
  episodeCount: values.values.episodeCount ?? null,
})

/** The entry a write lands on is the one read back as `_id`, so the cache updates the row it holds. */
const primaryOf = (found: Found & { state: 'LISTED' | 'NOT_LISTED' }) =>
  [...found.entries].sort((a, b) => (liveValues(b).updatedAt ?? 0) - (liveValues(a).updatedAt ?? 0))[0]

export const answerFor = (uri: string, found: Found, tracker: Tracker = stubTracker): TrackerAnswer => {
  const base = { _id: answerId(STUB_TRACKER_ID, uri), tracker, entry: null, candidates: [], error: null, pending: 0 }
  if (found.state === 'NO_ID') return { ...base, state: 'NO_ID' }
  if (found.state === 'AMBIGUOUS') return { ...base, state: 'AMBIGUOUS', candidates: found.candidates }
  const primary = primaryOf(found)
  if (found.state === 'NOT_LISTED' || !primary) return { ...base, state: 'NOT_LISTED' }
  return { ...base, state: 'LISTED', entry: listEntryOf(primary, found) }
}

const trackingOf = (uri: string, answer: TrackerAnswer): Tracking =>
  ({ _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] })

const refused = (error: string): WriteOutcome[] => [{ tracker: STUB_TRACKER_ID, outcome: 'REFUSED', entry: null, error }]
const failed = (error: unknown): WriteOutcome[] =>
  [{ tracker: STUB_TRACKER_ID, outcome: 'FAILED', entry: null, error: error instanceof Error ? error.message : String(error) }]

type Writable = Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>

/** Why an identity cannot take a write, or undefined when it can. */
const refusal = (identity: MediaIdentity): string | undefined =>
  identity.kind === 'none' ? 'This media names no id the stub tracker can keep an entry under'
  : identity.kind === 'ambiguous' ? `This media names ${identity.candidates.join(' and ')}, and the stub tracker cannot tell which one is meant`
  : undefined

export const stubTrackerResolvers = (open: () => Promise<Journal>, where: () => Promise<SessionScope> = async () => 'device') => ({
  Subscription: {
    tracking: {
      subscribe: async function* (_parent: unknown, { input }: { input: { uri: string } }, ctx: StubTrackerContext) {
        const { uri } = input
        let journal: Journal
        let identity: MediaIdentity
        try {
          journal = await open()
          identity = identify(uri, await ctx.catalog())
        } catch (error) {
          yield { tracking: trackingOf(uri, errorAnswer(uri, stubTracker, error instanceof Error ? error.message : String(error))) }
          return
        }
        const answer = async () => {
          const tracker = stubTrackerAt(await where().catch(() => 'device' as const))
          return answerFor(uri, journal.find(identity), tracker)
        }
        yield { tracking: trackingOf(uri, await answer()) }
        for await (const _ of changes(journal.onChange, { signal: ctx.request.signal })) {
          yield { tracking: trackingOf(uri, await answer()) }
        }
      }
    }
  },
  Mutation: {
    saveListEntry: async (
      _parent: unknown,
      { input }: { input: { uri: string, entry: Parameters<typeof patchFrom>[0], title?: string | null, cover?: string | null, episodeCount?: number | null } },
      ctx: StubTrackerContext
    ): Promise<WriteOutcome[]> => {
      try {
        const identity = identify(input.uri, await ctx.catalog())
        const why = refusal(identity)
        if (why) return refused(why)
        const patch = patchFrom(input.entry, input)
        if ('error' in patch) return refused(patch.error)
        const journal = await open()
        await journal.save(identity as Writable, patch.patch)
        const found = journal.find(identity)
        return [{ tracker: STUB_TRACKER_ID, outcome: 'SAVED', entry: answerFor(input.uri, found).entry ?? null, error: null }]
      } catch (error) {
        return failed(error)
      }
    },
    deleteListEntry: async (_parent: unknown, { input }: { input: { uri: string } }, ctx: StubTrackerContext): Promise<WriteOutcome[]> => {
      try {
        const identity = identify(input.uri, await ctx.catalog())
        const why = refusal(identity)
        if (why) return refused(why)
        await (await open()).remove(identity as Writable)
        return [{ tracker: STUB_TRACKER_ID, outcome: 'SAVED', entry: null, error: null }]
      } catch (error) {
        return failed(error)
      }
    },
  },
}) satisfies Resolvers
