// The fan-out every provider question goes through: media sources and trackers alike. Kept apart from
// worker/extractor.ts, which reaches urql and cannot load under vitest, so the one piece both kinds of
// provider share can be driven with fake entries.

import { stamp, type RequestContext } from './request-context'

export type FanoutSubscription = { unsubscribe: () => void }

/**
 * What the fan-out needs of a provider: a name for its logs and a client to subscribe through. An
 * extractor entry is one, and so is a test's fake.
 */
export type FanoutEntry = {
  name: string
  client: {
    subscription: (query: any, variables: any) => { subscribe: (sink: (result: any) => void) => FanoutSubscription }
  }
}

/**
 * Called with every result any provider yields, with the provider that yielded it. The media fan-out
 * collects the uris an answer names; the tracking fan-out keeps each tracker's latest answer.
 */
export type OnResult<E extends FanoutEntry> = (entry: E, result: any) => void

export type Fanout<E extends FanoutEntry> = {
  query: unknown
  variables: Record<string, unknown> | undefined
  onResult?: OnResult<E>
  /** the same array the caller holds and unsubscribes, so late joiners are torn down with the rest */
  subscriptions: FanoutSubscription[]
  joined: Map<E, FanoutSubscription>
  /**
   * Stamped onto every joiner's input, including one that registers mid-flight, so no source is left
   * unstamped. Absent for a question whose input carries no `context`, which a tracker's does not.
   */
  root?: RequestContext
}

// one provider must never be able to take down the fan-out: a provider that cannot start is skipped
export const joinFanout = <E extends FanoutEntry>(fanout: Fanout<E>, entry: E) => {
  if (fanout.joined.has(entry)) return
  let subscription: FanoutSubscription
  try {
    const variables = fanout.root ? stamp(fanout.variables ?? {}, fanout.root) : fanout.variables ?? {}
    subscription = entry.client.subscription(fanout.query, variables).subscribe((result) => {
      if (!fanout.onResult) return
      try {
        fanout.onResult(entry, result)
      } catch (error) {
        console.error(new Error(`Extractor ${entry.name} produced an unreadable fan-out result`, { cause: error }))
      }
    })
  } catch (error) {
    console.error(new Error(`Extractor ${entry.name} failed to join the fan-out`, { cause: error }))
    return
  }
  fanout.joined.set(entry, subscription)
  fanout.subscriptions.push(subscription)
}

export const leaveFanout = <E extends FanoutEntry>(fanout: Fanout<E>, entry: E) => {
  const subscription = fanout.joined.get(entry)
  if (!subscription) return
  fanout.joined.delete(entry)
  const index = fanout.subscriptions.indexOf(subscription)
  if (index !== -1) fanout.subscriptions.splice(index, 1)
  Promise.resolve(subscription.unsubscribe()).catch(() => {})
}

/**
 * Ask every entry in `entries` the same question and hand each result to `onResult`.
 *
 * The caller owns the teardown: it unsubscribes `subscriptions` when its own request ends. Nothing is
 * collected here beyond what `onResult` keeps, so a caller that passes none asks and ignores the
 * answers, which is what a media page does (its rows reach the store through the providers' own
 * servers).
 */
export const openFanout = <E extends FanoutEntry>(
  { entries, query, variables, root, onResult }:
  { entries: readonly E[], query: unknown, variables: Record<string, unknown> | undefined, root?: RequestContext, onResult?: OnResult<E> }
): Fanout<E> => {
  const fanout: Fanout<E> = { query, variables, root, onResult, subscriptions: [], joined: new Map() }
  for (const entry of entries) joinFanout(fanout, entry)
  return fanout
}

/** The media page's hook: every uri an answer names, gathered into `into`. */
export const collectUris = (extractUris: (result: any) => string[] | undefined, into: Set<string>): OnResult<FanoutEntry> =>
  (_entry, result) => {
    for (const uri of extractUris(result) ?? []) into.add(uri)
  }
