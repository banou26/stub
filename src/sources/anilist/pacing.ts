// How the AniList tracker spaces its calls. Import free apart from ./list-api's reading of a 429, with
// the clock and the wait handed in, so a test runs the minute long pauses in no time.

import type { SessionResponse } from './session-page'

import { isRateLimited } from './list-api'

/** At this many calls left in AniList's window, the next call waits LOW_BUDGET_WAIT_MS. */
export const LOW_BUDGET = 2
export const LOW_BUDGET_WAIT_MS = 60_000
/** AniList's timeout after a 429, used when the response names no end to it (docs.anilist.co/guide/rate-limiting). */
export const TIMEOUT_AFTER_429_MS = 60_000

/** What the pacer reads off a response. */
export type Paced = Pick<SessionResponse, 'status' | 'body' | 'rateLimit'>

export type Pacer = {
  /** When calls may go out again, while they may not. */
  pausedUntil: () => number | undefined
  /**
   * Sends `call` once the pause is over and every earlier call has settled, and reads the pause the
   * response sets for the calls after it. A 429 is handed back like any answer, never sent again: the
   * caller says the tracker is paused, and a read asks again after the pause.
   */
  run: <T>(call: () => Promise<T>, pacedOf: (result: T) => Paced | undefined, signal?: AbortSignal) => Promise<T>
}

/**
 * One queue of AniList calls, sent one at a time.
 *
 * After a 429, in the status or only in the body as `isRateLimited` reads it, nothing goes out until
 * AniList's X-RateLimit-Reset (a unix time in seconds), else its Retry-After, else a minute. With
 * X-RateLimit-Remaining at LOW_BUDGET or less, the next call waits a minute: AniList meters a minute's
 * window per address (30 a minute, measured 2026-09-26). No withBackoff here, whose retry of a 429 is
 * exactly the call AniList just refused.
 *
 * The site's own endpoint sent none of the X-RateLimit headers on 2026-09-27 (curl, signed out), where
 * graphql.anilist.co does, so there it is the 429 rule that applies.
 */
export const createPacer = (
  { now, wait }: { now: () => number, wait: (ms: number) => Promise<void> },
): Pacer => {
  let resumeAt = 0
  let tail: Promise<unknown> = Promise.resolve()

  const pauseAfter = ({ status, body, rateLimit }: Paced, at: number) => {
    if (isRateLimited(status, body)) {
      if (rateLimit.reset != null && rateLimit.reset * 1_000 > at) return rateLimit.reset * 1_000
      if (rateLimit.retryAfter != null && rateLimit.retryAfter > 0) return at + rateLimit.retryAfter * 1_000
      return at + TIMEOUT_AFTER_429_MS
    }
    if (rateLimit.remaining != null && rateLimit.remaining <= LOW_BUDGET) return at + LOW_BUDGET_WAIT_MS
    return 0
  }

  const run: Pacer['run'] = (call, pacedOf, signal) => {
    const turn = tail.then(async () => {
      const left = resumeAt - now()
      if (left > 0) await wait(left)
      signal?.throwIfAborted()
      const result = await call()
      const paced = pacedOf(result)
      if (paced) resumeAt = pauseAfter(paced, now())
      return result
    })
    tail = turn.catch(() => {})
    return turn
  }

  return {
    pausedUntil: () => resumeAt > now() ? resumeAt : undefined,
    run,
  }
}
