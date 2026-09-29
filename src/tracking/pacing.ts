// One queue of calls to a site, sent one at a time, with the pause each answer sets for the calls after
// it. Import free, with the clock and the wait handed in, so a test runs minute long pauses in no time.
// Each tracker brings its own rule for reading a pause off an answer (sources/*/pacing.ts).

export type Pacer<P> = {
  /** When calls may go out again, while they may not. */
  pausedUntil: () => number | undefined
  /**
   * Sends `call` once the pause is over and every earlier call has settled, and reads the pause its
   * answer sets for the calls after it. An answer that sets a pause is handed back like any other and
   * never sent again. A call whose `signal` aborted during the wait is not sent at all.
   */
  run: <T>(call: () => Promise<T>, pacedOf: (result: T) => P | undefined, signal?: AbortSignal) => Promise<T>
}

export type PacedQueueOptions<P> = {
  now: () => number
  wait: (ms: number) => Promise<void>
  /** The time calls may go out again after an answer read as `paced` at `at`; 0 or less for no pause. */
  pauseAfter: (paced: P, at: number) => number
}

export const pacedQueue = <P>({ now, wait, pauseAfter }: PacedQueueOptions<P>): Pacer<P> => {
  let resumeAt = 0
  let tail: Promise<unknown> = Promise.resolve()

  const run: Pacer<P>['run'] = (call, pacedOf, signal) => {
    const turn = tail.then(async () => {
      const left = resumeAt - now()
      if (left > 0) await wait(left)
      signal?.throwIfAborted()
      const result = await call()
      const paced = pacedOf(result)
      if (paced !== undefined) resumeAt = pauseAfter(paced, now())
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
