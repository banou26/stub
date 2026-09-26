// The app-level tracking resolvers over whichever trackers they are handed. worker/resolvers/tracking
// hands them the real ones; a test hands them fakes, since the real ones are built by
// worker/extractor.ts, which cannot load under vitest.

import type { Resolvers, Tracker, Tracking } from '../generated/schema/types.generated'

import { openFanout, type FanoutEntry } from '../worker/fanout'
import { DELETE_LIST_ENTRY_DOCUMENT, SAVE_LIST_ENTRY_DOCUMENT, TRACKING_DOCUMENT } from '../worker/tracking-document'
import { aggregateTracking } from './aggregate'
import { answerCollector, changes, writeToTargets } from './collect'
import { decodeRouteUri, isAggregatedUri, isUri } from '../utils/uri'

/** A tracker as the app reaches it: the fan-out's entry, which also takes mutations. */
export type TrackerProvider = FanoutEntry & {
  extractor: { origin: string }
  client: FanoutEntry['client'] & { mutation: (query: any, variables: any) => { toPromise: () => Promise<any> } }
}

/**
 * `tracking` asks every tracker (or those `input.trackers` names) through the shared fan-out and
 * yields every answer with a display-only summary, again whenever any tracker answers anew.
 * `saveListEntry` and `deleteListEntry` go to the trackers the input names and to no other.
 */
export const trackingResolvers = <E extends TrackerProvider>(entries: readonly E[], trackerOf: (entry: E) => Tracker) => {
  const find = (id: string) => entries.find(entry => entry.extractor.origin === id)
  const send = (document: string, input: Record<string, unknown>) =>
    (entry: E, tracker: string) =>
      entry.client.mutation(document, { input: { ...input, trackers: [tracker] } }).toPromise()

  return {
    Query: {},
    Mutation: {
      saveListEntry: (_parent, { input }) =>
        writeToTargets(input.trackers, find, send(SAVE_LIST_ENTRY_DOCUMENT, input), 'saveListEntry'),
      deleteListEntry: (_parent, { input }) =>
        writeToTargets(input.trackers, find, send(DELETE_LIST_ENTRY_DOCUMENT, input), 'deleteListEntry'),
    },
    Subscription: {
      tracking: {
        resolve: (parent: Tracking) => parent,
        subscribe: async function* (_parent, { input }, ctx) {
          const uri = decodeRouteUri(input.uri)
          if (!uri || !(isUri(uri) || isAggregatedUri(uri))) {
            console.warn(`tracking: refused '${input.uri}', which names no uri`)
            yield null
            return
          }
          const asked = input.trackers ? entries.filter(entry => input.trackers!.includes(entry.extractor.origin)) : entries
          const collected = answerCollector(uri, asked, trackerOf)
          // listening before asking, so no answer can land ahead of the wake it should cause; a burst
          // of answers, the first one from every tracker at once, is one yield
          const wakes = changes(collected.subscribe, { signal: ctx.request.signal, debounceMs: 30 })
          // the same fan-out the media page asks its sources through, over the trackers alone and
          // with a document of its own (see tracking-document.ts for why not the page's)
          const fanout = openFanout({ entries: asked, query: TRACKING_DOCUMENT, variables: { input: { uri } }, onResult: collected.onResult })
          try {
            if (!asked.length) yield aggregateTracking(uri, [])
            for await (const _ of wakes) {
              yield aggregateTracking(uri, collected.answers())
            }
          } finally {
            await Promise.allSettled(fanout.subscriptions.map(subscription => subscription.unsubscribe()))
          }
        }
      }
    }
  } satisfies Resolvers
}
