// How the AniList tracker spaces its calls: tracking/pacing.ts's queue, with AniList's rule for the
// pause an answer sets. Import free apart from those two and ./list-api's reading of a 429, with the
// clock and the wait handed in, so a test runs the minute long pauses in no time.

import type { Pacer as SharedPacer } from '../../tracking/pacing'
import type { SessionResponse } from './session-page'

import { pacedQueue } from '../../tracking/pacing'
import { isRateLimited } from './list-api'

/** At this many calls left in AniList's window, the next call waits LOW_BUDGET_WAIT_MS. */
export const LOW_BUDGET = 2
export const LOW_BUDGET_WAIT_MS = 60_000
/** AniList's timeout after a 429, used when the response names no end to it (docs.anilist.co/guide/rate-limiting). */
export const TIMEOUT_AFTER_429_MS = 60_000

/** What the pacer reads off a response. */
export type Paced = Pick<SessionResponse, 'status' | 'body' | 'rateLimit'>

export type Pacer = SharedPacer<Paced>

/**
 * AniList's rule for how long the calls after an answer wait.
 *
 * After a 429, in the status or only in the body as `isRateLimited` reads it, nothing goes out until
 * AniList's X-RateLimit-Reset (a unix time in seconds), else its Retry-After, else a minute. With
 * X-RateLimit-Remaining at LOW_BUDGET or less, the next call waits a minute: AniList meters a minute's
 * window per address (30 a minute, measured 2026-09-26), which through FKN's render proxy is FKN's,
 * shared by every viewer. No withBackoff here, whose retry of a 429 is exactly the call AniList just
 * refused.
 *
 * The site's own endpoint sent none of the X-RateLimit headers on 2026-09-27 (curl, signed out), where
 * graphql.anilist.co does, so there it is the 429 rule that applies.
 */
export const anilistPauseAfter = ({ status, body, rateLimit }: Paced, at: number) => {
  if (isRateLimited(status, body)) {
    if (rateLimit.reset != null && rateLimit.reset * 1_000 > at) return rateLimit.reset * 1_000
    if (rateLimit.retryAfter != null && rateLimit.retryAfter > 0) return at + rateLimit.retryAfter * 1_000
    return at + TIMEOUT_AFTER_429_MS
  }
  if (rateLimit.remaining != null && rateLimit.remaining <= LOW_BUDGET) return at + LOW_BUDGET_WAIT_MS
  return 0
}

/** One queue of AniList calls, sent one at a time, paced by `anilistPauseAfter`. */
export const createPacer = (clock: { now: () => number, wait: (ms: number) => Promise<void> }): Pacer =>
  pacedQueue({ ...clock, pauseAfter: anilistPauseAfter })
