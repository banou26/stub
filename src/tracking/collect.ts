// The app-level half of tracking: each tracker's latest answer gathered off the shared fan-out, and a
// write sent to exactly the trackers it names. Import free so it can be driven under vitest with fake
// providers; worker/resolvers/tracking wires it to the real ones.

import type { Tracker, TrackerAnswer, WriteOutcome } from '../generated/schema/types.generated'

export const answerId = (tracker: string, uri: string) => `answer:${tracker}:${uri}`

export const errorAnswer = (uri: string, tracker: Tracker, error: string): TrackerAnswer => ({
  _id: answerId(tracker.id, uri),
  tracker,
  state: 'ERROR',
  entry: null,
  candidates: [],
  error,
  pending: 0,
})

const messageOf = (error: unknown) =>
  (error as { graphQLErrors?: { message: string }[] })?.graphQLErrors?.[0]?.message
  ?? (error as { message?: string })?.message
  ?? String(error)

/**
 * Wakes on every `subscribe` notification, coalescing a burst into one wake, until `signal` aborts.
 * What a subscription loop waits on between yields.
 */
export const changes = (
  subscribe: (listener: () => void) => () => void,
  { signal, debounceMs = 0 }: { signal?: AbortSignal, debounceMs?: number } = {}
): AsyncIterableIterator<void> => {
  let pending = false
  let wake: ((result: IteratorResult<void>) => void) | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let done = signal?.aborted ?? false

  const fire = () => {
    if (wake) { wake({ value: undefined, done: false }); wake = undefined }
    else pending = true
  }
  const unsubscribe = subscribe(() => {
    if (!debounceMs) return fire()
    clearTimeout(timer)
    timer = setTimeout(fire, debounceMs)
  })
  const finish = () => {
    done = true
    clearTimeout(timer)
    unsubscribe()
    wake?.({ value: undefined, done: true })
    wake = undefined
  }
  signal?.addEventListener('abort', finish, { once: true })

  return {
    next: async () => {
      if (done) return { value: undefined, done: true }
      if (pending) { pending = false; return { value: undefined, done: false } }
      return await new Promise<IteratorResult<void>>(resolve => { wake = resolve })
    },
    return: async () => { finish(); return { value: undefined, done: true } },
    [Symbol.asyncIterator] () { return this },
  }
}

/**
 * Each tracker's latest answer about one media, in the order the trackers were given.
 *
 * `onResult` is the fan-out hook. A tracker that errors is kept as an ERROR answer rather than
 * dropped, so the page shows the tracker failed instead of showing nothing for it; a tracker that
 * answers null (the default a provider yields when it implements nothing) is left out.
 */
export const answerCollector = <E>(uri: string, order: readonly E[], trackerOf: (entry: E) => Tracker) => {
  const answers = new Map<E, TrackerAnswer>()
  const listeners = new Set<() => void>()
  return {
    onResult: (entry: E, result: { data?: { tracking?: { answers?: TrackerAnswer[] } | null } | null, error?: unknown }) => {
      const answer = result?.error
        ? errorAnswer(uri, trackerOf(entry), messageOf(result.error))
        : result?.data?.tracking?.answers?.[0]
      if (!answer) return
      answers.set(entry, answer)
      for (const listener of listeners) listener()
    },
    answers: () => order.flatMap(entry => answers.get(entry) ?? []),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const outcome = (tracker: string, state: WriteOutcome['outcome'], error: string): WriteOutcome =>
  ({ tracker, outcome: state, entry: null, error })

/**
 * Send one write to exactly the trackers named, and nothing else: no tracker is written to because it
 * is connected, and one that is not named is never asked. Every name gets one outcome, in order.
 */
export const writeToTargets = async <E>(
  targets: readonly string[],
  find: (tracker: string) => E | undefined,
  send: (entry: E, tracker: string) => Promise<{ data?: Record<string, WriteOutcome[] | null> | null, error?: unknown }>,
  field: 'saveListEntry' | 'deleteListEntry'
): Promise<WriteOutcome[]> =>
  await Promise.all([...new Set(targets)].map(async tracker => {
    const entry = find(tracker)
    if (!entry) return outcome(tracker, 'REFUSED', `There is no tracker called ${tracker}`)
    try {
      const result = await send(entry, tracker)
      if (result.error) return outcome(tracker, 'FAILED', messageOf(result.error))
      return result.data?.[field]?.find(answer => answer.tracker === tracker)
        ?? outcome(tracker, 'REFUSED', 'This tracker takes no writes')
    } catch (error) {
      return outcome(tracker, 'FAILED', messageOf(error))
    }
  }))
