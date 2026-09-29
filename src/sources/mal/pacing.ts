// How the MyAnimeList tracker spaces its calls: tracking/pacing.ts's queue with MyAnimeList's rule, and
// a queue of saves kept apart by a gap. Import free apart from that queue, with the clock and the wait
// handed in, so a test runs the five minute pause in no time.

import type { Pacer } from '../../tracking/pacing'

import { pacedQueue } from '../../tracking/pacing'

/**
 * How long nothing goes out after MyAnimeList refused stub, when it named no Retry-After. MyAnimeList
 * states no end to a block, so this is a CHOICE, not a measurement. Its requests go out from FKN's
 * shared egress, so a refusal is one for everybody on that node, and waiting costs one viewer a few
 * minutes where asking again could cost all of them.
 */
export const BLOCKED_PAUSE_MS = 5 * 60_000

/** Between two saves, MAL-Sync's spacing of its own writes (syncHandler.ts:262-268). */
export const WRITE_GAP_MS = 3_000

/** What the pacer reads off an answer. */
export type MalPaced = { blocked: boolean, retryAfter: number | null }

/** After a refusal, nothing until its Retry-After, else BLOCKED_PAUSE_MS. Nothing else pauses. */
export const malPauseAfter = ({ blocked, retryAfter }: MalPaced, at: number) =>
  blocked ? at + (retryAfter != null && retryAfter > 0 ? retryAfter * 1_000 : BLOCKED_PAUSE_MS) : 0

type Clock = { now: () => number, wait: (ms: number) => Promise<void> }

/**
 * One queue of MyAnimeList calls, sent one at a time: list pages go back to back, and a refused call
 * is never sent again (the caller says the tracker is paused, and a read asks again after the pause).
 */
export const createMalPacer = (clock: Clock): Pacer<MalPaced> => pacedQueue({ ...clock, pauseAfter: malPauseAfter })

/** A save's turn: `ready` waits out the gap before its first write, `wrote` starts the gap after its last. */
export type SaveTurn = { ready: () => Promise<void>, wrote: () => void }

/**
 * Saves one at a time, each planned on what the one before it left, and each one's first write at
 * least WRITE_GAP_MS after the last write of the one before. Only saves are spaced: the steps of one
 * save go back to back, as MyAnimeList's own list page posts them, and no read waits for the gap.
 */
export const createSaveQueue = ({ now, wait }: Clock, gapMs = WRITE_GAP_MS) => {
  let nextWriteAt = 0
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run: <T>(save: (turn: SaveTurn) => Promise<T>): Promise<T> => {
      const turn = tail.then(() => save({
        ready: async () => {
          const left = nextWriteAt - now()
          if (left > 0) await wait(left)
        },
        wrote: () => { nextWriteAt = now() + gapMs },
      }))
      tail = turn.catch(() => {})
      return turn
    },
  }
}
