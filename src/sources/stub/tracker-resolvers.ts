// The stub tracker's resolvers over a journal it is handed, so a test can serve them over a journal
// kept in memory. ./tracker.ts hands them this device's.

import type { ListEntry, ListItem, Resolvers, Tracker, TrackerAnswer, Tracking, WriteOutcome } from '../../generated/schema/types.generated'
import type { SessionScope } from '../../tracking/account-link'
import type { Found, Journal, JournalEntry } from '../../tracking/journal'

import { forPage, type Said } from '../../i18n/said'
import { answerId, changes, errorAnswer } from '../../tracking/collect'
import { trackingId } from '../../tracking/aggregate'
import { catalogFor, entryMediaUri, identify, type CatalogLookup, type MediaIdentity } from '../../tracking/identity'
import { liveValues, patchFrom } from '../../tracking/journal'
import { ownList } from '../../tracking/lists'

export const STUB_TRACKER_ID = 'stub'

const ON_THIS_DEVICE = forPage.formatMessage({ id: 'This device', defaultMessage: 'This device' })

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
  account: ON_THIS_DEVICE,
  canWrite: true,
  scoreScale: 'POINT_100',
}

/** The tracker as it answers, naming whose list it holds. */
export const stubTrackerAt = (where: SessionScope): Tracker =>
  ({ ...stubTracker, account: where === 'account' ? forPage.formatMessage({ id: 'FKN account', defaultMessage: 'FKN account' }) : ON_THIS_DEVICE })

const iso = (at: number | undefined) => at ? new Date(at).toISOString() : null

const listEntryOf = (entry: JournalEntry, values: Found & { state: 'LISTED' | 'NOT_LISTED' }): ListEntry => ({
  _id: `${STUB_TRACKER_ID}:${entry.id}`,
  tracker: STUB_TRACKER_ID,
  mediaUri: entryMediaUri(entry),
  status: values.values.status ?? null,
  progress: values.values.progress ?? null,
  score: values.values.score ?? null,
  startedAt: values.values.startedAt ?? null,
  completedAt: values.values.completedAt ?? null,
  rewatchCount: values.values.rewatchCount ?? null,
  updatedAt: iso(values.updatedAt),
  url: null,
  title: values.values.title ?? null,
  cover: values.values.cover ?? null,
  // the count a write keeps is the page's at the time, not one this tracker counts, so progress here is
  // read on the page's count now
  episodeCount: null,
})

/** The entry a write lands on is the one read back as `_id`, so the cache updates the row it holds. */
const primaryOf = (found: Found & { state: 'LISTED' | 'NOT_LISTED' }) =>
  [...found.entries].sort((a, b) => (liveValues(b).updatedAt ?? 0) - (liveValues(a).updatedAt ?? 0))[0]

export const answerFor = (uri: string, found: Found, tracker: Tracker = stubTracker): TrackerAnswer => {
  const base = { _id: answerId(STUB_TRACKER_ID, uri), tracker, entry: null, candidates: [], error: null }
  if (found.state === 'NO_ID') return { ...base, state: 'NO_ID' }
  if (found.state === 'AMBIGUOUS') return { ...base, state: 'AMBIGUOUS', candidates: found.candidates }
  const primary = primaryOf(found)
  if (found.state === 'NOT_LISTED' || !primary) return { ...base, state: 'NOT_LISTED' }
  return { ...base, state: 'LISTED', entry: listEntryOf(primary, found) }
}

const trackingOf = (uri: string, answer: TrackerAnswer): Tracking =>
  ({ _id: trackingId(uri), answers: [answer], summary: null, disagreements: [] })

const refused = (error: Said): WriteOutcome[] => [{ tracker: STUB_TRACKER_ID, outcome: 'REFUSED', entry: null, error }]
const failed = (error: unknown): WriteOutcome[] =>
  [{ tracker: STUB_TRACKER_ID, outcome: 'FAILED', entry: null, error: error instanceof Error ? error.message : String(error) }]

type Writable = Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>

/**
 * Every listed media of the journal, each as its title row reads it: the entries for one media, from
 * whichever devices, combined. An entry is matched on the ids it keeps, which a save widened through the
 * catalogue already.
 */
const listItemsOf = (journal: Journal): ListItem[] => {
  const seen = new Set<string>()
  const items: ListItem[] = []
  for (const entry of journal.listEntries()) {
    const uri = entryMediaUri(entry)
    if (seen.has(entry.id) || !uri) continue
    const found = journal.find(entry.ids.length ? { kind: 'catalogue', ids: entry.ids, keys: [] } : { kind: 'keys', keys: [entry.key!] })
    if (!('entries' in found)) continue
    for (const one of found.entries) seen.add(one.id)
    const listed = answerFor(uri, found).entry
    if (listed) items.push({ entry: listed, episodeCount: found.values.episodeCount ?? null, mediaStatus: null, type: null, nextAiringEpisode: null })
  }
  return items
}

/** Why an identity cannot take a write, or undefined when it can. */
const refusal = (identity: MediaIdentity): Said | undefined =>
  identity.kind === 'none' ? forPage.formatMessage({ id: 'This media names no id stub can track', defaultMessage: 'This media names no id stub can track' })
  : identity.kind === 'ambiguous' ? forPage.formatMessage({ id: 'This media names {candidates}, and stub cannot tell which one is meant', defaultMessage: 'This media names {candidates}, and stub cannot tell which one is meant' }, { candidates: { list: identity.candidates, join: 'and' } })
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
          identity = identify(uri, await catalogFor(uri, ctx.catalog))
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
    },
    viewerLists: {
      subscribe: async function* (_parent: unknown, _args: unknown, ctx: StubTrackerContext) {
        let journal: Journal
        try {
          journal = await open()
        } catch {
          yield ownList(stubTracker, 'ERROR')
          return
        }
        const list = async () => ownList(stubTrackerAt(await where().catch(() => 'device' as const)), 'LISTED', listItemsOf(journal))
        yield await list()
        for await (const _ of changes(journal.onChange, { signal: ctx.request.signal })) yield await list()
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
        const identity = identify(input.uri, await catalogFor(input.uri, ctx.catalog))
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
        const identity = identify(input.uri, await catalogFor(input.uri, ctx.catalog))
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
