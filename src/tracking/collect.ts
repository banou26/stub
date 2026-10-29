// The app-level half of tracking: each tracker's latest answer gathered off the shared fan-out, and a
// write sent to exactly the trackers it names. Import free so it can be driven under vitest with fake
// providers; worker/resolvers/tracking wires it to the real ones.

import type { Tracker, TrackerAnswer, WriteOutcome } from '../generated/schema/types.generated'
import type { Said } from '../i18n/said'

import { forPage, saidOf } from '../i18n/said'

export const answerId = (tracker: string, uri: string) => `answer:${tracker}:${uri}`

export const errorAnswer = (uri: string, tracker: Tracker, error: Said): TrackerAnswer => ({
  _id: answerId(tracker.id, uri),
  tracker,
  state: 'ERROR',
  entry: null,
  candidates: [],
  error,
})

const loadingAnswer = (uri: string, tracker: Tracker): TrackerAnswer =>
  ({ _id: answerId(tracker.id, uri), tracker, state: 'LOADING', entry: null, candidates: [], error: null })

const messageOf = (error: unknown) =>
  (error as { graphQLErrors?: { message: string }[] })?.graphQLErrors?.[0]?.message ?? saidOf(error)

/**
 * The answer for a read that threw. A fetch that got no answer rejects with a TypeError however the
 * engine words it (Chrome "Failed to fetch", Firefox "NetworkError when attempting to fetch resource.",
 * Safari "Load failed"), and osra keeps the class across the session page's port, so the class decides
 * and the chip says so in stub's words, while the error itself goes to the console: a bug thrown as a
 * TypeError looks the same on the chip. Every tracker reads again after a failed read.
 */
export const failedReadAnswer = (uri: string, tracker: Tracker, error: unknown): TrackerAnswer => {
  if (!(error instanceof TypeError)) return errorAnswer(uri, tracker, messageOf(error))
  console.warn(`tracking: ${tracker.name} read got no answer`, error)
  return errorAnswer(uri, tracker, forPage.formatMessage({ id: 'Could not reach {name}, retrying', defaultMessage: 'Could not reach {name}, retrying' }, { name: tracker.name }))
}

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

/** The wait before a failed read is made again, doubled for each failure in a row up to RETRY_MAX_MS. */
export const RETRY_MS = 60_000
export const RETRY_MAX_MS = 30 * 60_000

/**
 * What a tracker's subscription loop waits on before its next read: the next of `wakes`, or after a
 * failed read whichever comes first of that and the retry wait. Resolves false once `wakes` ended.
 */
export const rereads = (wakes: AsyncIterator<void>, wait: (ms: number) => Promise<void>) => {
  let delay = RETRY_MS
  return async (failed: boolean): Promise<boolean> => {
    const woken = wakes.next()
    if (!failed) {
      delay = RETRY_MS
      return !(await woken).done
    }
    const retry = wait(delay).then(() => ({ done: false }))
    delay = Math.min(delay * 2, RETRY_MAX_MS)
    return !(await Promise.race([woken, retry])).done
  }
}

/**
 * Each tracker's latest answer about one media, in the order the trackers were given, and a LOADING
 * one for a tracker that has not answered yet, so the page can draw every tracker at once.
 *
 * `onResult` is the fan-out hook. A tracker that errors is kept as an ERROR answer rather than
 * dropped, so the page shows the tracker failed instead of showing nothing for it; a tracker that
 * answers null (the default a provider yields when it implements nothing) is left out.
 */
export const answerCollector = <E>(uri: string, order: readonly E[], trackerOf: (entry: E) => Tracker) => {
  const answers = new Map<E, TrackerAnswer | null>()
  const listeners = new Set<() => void>()
  return {
    onResult: (entry: E, result: { data?: { tracking?: { answers?: TrackerAnswer[] } | null } | null, error?: unknown }) => {
      answers.set(entry, result?.error
        ? errorAnswer(uri, trackerOf(entry), messageOf(result.error))
        : result?.data?.tracking?.answers?.[0] ?? null)
      for (const listener of listeners) listener()
    },
    answers: () => order.flatMap(entry => {
      const answer = answers.get(entry)
      return answer === undefined ? loadingAnswer(uri, trackerOf(entry)) : answer ?? []
    }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const outcome = (tracker: string, state: WriteOutcome['outcome'], error: Said): WriteOutcome =>
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
    if (!entry) return outcome(tracker, 'REFUSED', forPage.formatMessage({ id: 'There is no tracker called {tracker}', defaultMessage: 'There is no tracker called {tracker}' }, { tracker }))
    try {
      const result = await send(entry, tracker)
      if (result.error) return outcome(tracker, 'FAILED', messageOf(result.error))
      return result.data?.[field]?.find(answer => answer.tracker === tracker)
        ?? outcome(tracker, 'REFUSED', forPage.formatMessage({ id: 'This tracker takes no writes', defaultMessage: 'This tracker takes no writes' }))
    } catch (error) {
      return outcome(tracker, 'FAILED', messageOf(error))
    }
  }))
