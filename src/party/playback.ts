import type { Control, PartyMessage, PlaybackState } from './protocol'

// How a follower's player is moved to match the host's. Pure and import-free so the tolerance can be
// pinned: it is the one number that decides between a follower that stutters every heartbeat and
// one that drifts.

/**
 * The gap past which a follower seeks to the host's position, in seconds.
 *
 * Under it nothing is touched: the host's heartbeat arrives every few seconds, transit is a few
 * hundred milliseconds at most, and seeking a player that is already within a second of the host
 * would buy nothing and cost a visible stall each time. Over it the follower has fallen behind, or
 * the host seeked, and either way the honest move is to jump.
 */
export const SEEK_TOLERANCE_S = 0.5

/**
 * The drift a follower closes by playing slightly faster or slower rather than by seeking.
 *
 * Between NUDGE_FLOOR_S and SEEK_TOLERANCE_S a seek would be the wrong tool: it costs a visible
 * stall and a re-buffer to fix a gap nobody can see, and the host's heartbeat would hand it back a
 * few seconds later. Running at NUDGE_RATE instead closes a quarter second in about five seconds,
 * inaudibly, and the follower ends up genuinely level rather than merely within tolerance.
 *
 * Below the floor nothing is done at all, which is what stops the correction oscillating: a follower
 * that nudged until it was exact would overshoot and nudge back forever.
 */
export const NUDGE_FLOOR_S = 0.05
export const NUDGE_RATE = 1.05

/** How often the host's player reports while it plays, so a follower that drifts is corrected. */
export const HEARTBEAT_MS = 5_000

/** The local player, as much of it as the correction reads. */
export type LocalPlayback = { paused: boolean, time: number, rate: number }

/** What to do to a local player so it matches `wanted`. Each field is present only when it has to change. */
export type PlaybackCorrection = { seek?: number, play?: true, pause?: true, rate?: number }

/**
 * Where the host's player IS now, from where it said it was.
 *
 * `at` is the host's clock and `now` is the follower's. When the two have been reconciled (see
 * clock.ts, and party-playback.tsx which does the reconciling) their difference is transit alone and
 * the answer is exact, so it is applied in full.
 *
 * Unreconciled it is skew plus transit with no way to tell them apart, so it is capped: a report a
 * few hundred milliseconds old is moved forward by that much, which is right whenever the clocks
 * happen to agree, and one that looks older than the cap is treated as arriving just now, which is
 * the safe reading when they do not. That is the pre-measurement behaviour and it stays the
 * behaviour for a follower whose first exchange has not landed yet.
 *
 * Paused players do not move.
 */
export const expectedTime = (state: PlaybackState, now: number, measured = false): number => {
  if (state.paused) return state.time
  const raw = Math.max(now - state.at, 0)
  const elapsed = (measured ? raw : Math.min(raw, MAX_TRANSIT_MS)) / 1000
  return state.time + elapsed * state.rate
}

const MAX_TRANSIT_MS = 2_000

/**
 * What to do to `local` so it matches `wanted`, in three tiers of drift.
 *
 * Over SEEK_TOLERANCE_S it jumps, because the follower is somewhere else entirely: the host seeked,
 * or a stall put it behind. Between the floor and the tolerance it runs off-rate to close the gap
 * smoothly, so a follower converges on the host rather than settling anywhere inside a tolerance
 * band. Under the floor it is left alone, since a correction that never stops is a stutter.
 *
 * A paused player is never nudged: it is not moving, so a rate has nothing to act on, and it would
 * be left at the wrong rate for whenever it resumes.
 */
export const playbackCorrection = (local: LocalPlayback, wanted: PlaybackState, now: number, measured = false): PlaybackCorrection => {
  const correction: PlaybackCorrection = {}
  const target = expectedTime(wanted, now, measured)
  const drift = target - local.time
  if (Math.abs(drift) > SEEK_TOLERANCE_S) correction.seek = target
  if (wanted.paused && !local.paused) correction.pause = true
  if (!wanted.paused && local.paused) correction.play = true

  // behind the host runs fast, ahead of it runs slow, and anything else runs at the host's own rate
  const nudging = !wanted.paused && correction.seek === undefined && Math.abs(drift) >= NUDGE_FLOOR_S
  const rate = nudging ? wanted.rate * (drift > 0 ? NUDGE_RATE : 1 / NUDGE_RATE) : wanted.rate
  if (Math.abs(local.rate - rate) > 0.001) correction.rate = rate
  return correction
}

/**
 * A state the follower heard a while ago, moved to where the host's player is NOW.
 *
 * The follower's own clock does this, not the host's: `receivedAt` and `now` are the same clock, so
 * the gap between them is playback time with no skew in it. `expectedTime` cannot do this on its own
 * because it only has the host's `at`, and it caps what it trusts of that. A follower re-applies a
 * state whenever its own player reports (see components/party-playback.tsx), which can be many
 * seconds after the state arrived; re-applying the state as received would seek it BACK by that
 * much every time. Found in review, 2026-09-07.
 */
export const advance = (state: PlaybackState, receivedAt: number, now: number): PlaybackState => ({
  ...state,
  time: state.paused ? state.time : state.time + Math.max(0, now - receivedAt) / 1000 * state.rate,
  at: now,
})

/**
 * How long a follower's player is still answering a correction that played, paused or seeked it, so a
 * report inside it is that correction and never read as a person.
 */
export const SETTLE_MS = 2_000

/** How long a follower that asked the host waits for the answer before its player rejoins the party. */
export const ASK_HOLD_MS = 3_000

/**
 * Which controls a person used on a follower's player, from a report against the one before it.
 *
 * `play` is the player pausing or resuming AWAY from `wanted`, so a player answering the host's own
 * pause late is not read as the person.
 */
export const personAction = (previous: LocalPlayback, report: LocalPlayback, wanted: LocalPlayback): Control[] =>
  report.paused !== previous.paused && report.paused !== wanted.paused ? ['play'] : []

/**
 * What the host's player should do for an ask: its own last report moved to now with only the asked
 * control changed, or undefined when it already does what was asked. `own.at` is the host's clock.
 */
export const askedState = (own: PlaybackState, ask: Extract<PartyMessage, { t: 'ask' }>, now: number): PlaybackState | undefined =>
  own.paused === ask.s.paused ? undefined : { ...advance(own, own.at, now), paused: ask.s.paused }
