import type { PlaybackState, PlayerAsk, PlayerControl } from './protocol'

// How a follower's player is moved to match the host's. Pure and import-free so the numbers can be pinned: they
// decide between a follower that keeps changing speed and one that drifts.

/**
 * The gap past which a player is seeked to where it was asked to be, in seconds: the host's own player on a
 * follower's ask, and a follower's when the host seeked, paused or resumed. Under it a seek would buy nothing and
 * cost a visible stall.
 */
export const SEEK_TOLERANCE_S = 0.5

/**
 * The drift past which a follower seeks even though the host only played on, in seconds; under it, and outside
 * DEAD_BAND_S, it catches up by speed instead. A seek is a visible jump and a stall to re-buffer, which can leave
 * the follower behind again, while a catch-up closes 3 s in a minute with nothing to see.
 */
export const CATCH_UP_LIMIT_S = 3

/**
 * The drift a follower leaves alone, in seconds: under it two viewers cannot tell they are apart. What a follower
 * measures is off by up to a quarter second on each side (a player's mirror says its time as of its last
 * `timeupdate`, 250 ms apart in Chrome, and a heartbeat reads it at the same point of that cycle every time), plus
 * what the message's delay leaves. In tests/unit/components/party-playback-simulation.tsx, 2026-11-05, a band of
 * 0.25 s once caught up on that alone in twelve ten-minute runs with no drift, 0.3 s never did, and 0.4 s keeps a
 * margin while a decoder drifting a millisecond a second stays under 0.5 s from the host.
 */
export const DEAD_BAND_S = 0.4

/**
 * How many drifts a follower reads before it believes one: the median of the last FILTER_SIZE since its player
 * last changed, so one late report moves nothing and only a drift that stays outside the band for a while (most
 * of five applies, about ten seconds of heartbeats and host messages) starts a catch-up.
 */
export const FILTER_SIZE = 5

/**
 * How long a catch-up runs, in seconds, and the most it moves off the host's speed. The speed is the drift over
 * CATCH_UP_S, so a small drift is closed gently and in one go, and a large one at NUDGE_RATE for as long as it
 * takes: 5% is under what a viewer hears, with the browser keeping the pitch.
 */
export const CATCH_UP_S = 10
export const NUDGE_RATE = 1.05

/** How often the host's player reports while it plays, so a follower that drifts is corrected. */
export const HEARTBEAT_MS = 5_000

/** The local player, as much of it as the correction reads; `seeking` while a seek it was sent has not landed. */
export type LocalPlayback = { paused: boolean, time: number, rate: number, seeking?: boolean }

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
 * What to do to `local` so it matches `wanted` at once: seek past SEEK_TOLERANCE_S, play, pause and take its
 * speed. What the host's player does with a follower's ask.
 */
export const playbackCorrection = (local: LocalPlayback, wanted: PlaybackState, now: number, measured = false): PlaybackCorrection => {
  const correction: PlaybackCorrection = {}
  const target = expectedTime(wanted, now, measured)
  if (Math.abs(target - local.time) > SEEK_TOLERANCE_S) correction.seek = target
  if (wanted.paused && !local.paused) correction.pause = true
  if (!wanted.paused && local.paused) correction.play = true
  if (!sameRate(local.rate, wanted.rate)) correction.rate = wanted.rate
  return correction
}

/** How far a player's time may run back before it moved: by itself it never runs back, so this is only slack. */
const RUNS_BACK_S = 0.05

/** What a follower's correction keeps from one apply to the next. */
export type Follow = {
  /** where the host's player was at the last apply, on this clock */
  heard: PlaybackState
  /** where this player was left at the last apply */
  played: PlaybackState
  /** the drifts measured since the player last changed, newest last, in seconds */
  drifts: number[]
  /** the catch-up running: its speed, held until `until` on this clock */
  catchUp?: { rate: number, until: number }
  /** a seek this player was sent, until it is read once it landed: how far past the host it aimed, in seconds */
  seek?: { aim: number }
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

/**
 * What to do to a follower's `local` player to keep it with the host's, and what to remember for the next apply.
 * `wanted.at` is on this clock.
 *
 * When `exact`, when the host seeked, paused or resumed since the last apply, when this player jumped by itself (a
 * person, or the player rebuilding), or on the first, it is `playbackCorrection`: the follower goes where the host
 * is at once. Otherwise the follower is the one that drifted (a stall, a decoder, the network), and it is left alone inside
 * DEAD_BAND_S. A drift that stays outside it (the median of the last FILTER_SIZE since the player last changed) is
 * closed by a catch-up: a speed scaled to the drift, held until dead reckoning says the gap is closed, then the
 * host's speed again, with nothing measured in between. Only past CATCH_UP_LIMIT_S does it seek. A new speed from
 * the host is taken at once and starts the reading over; a paused player is never caught up, and one still seeking
 * is neither read nor sent again, since it says where it was sent rather than where it plays. A seek that landed
 * far behind (a slow network) tells what the next costs, so that one aims as far past the host.
 *
 * Drifts and limits are in seconds of the host playing, not of media: what a reading is off by is time (a mirror's
 * last `timeupdate`, a message's delay), which at 2x is twice the media.
 */
export const followCorrection = (follow: Follow | undefined, local: LocalPlayback, wanted: PlaybackState, now: number, exact = false): { correction: PlaybackCorrection, follow: Follow } => {
  const target = expectedTime(wanted, now, true)
  const drift = (target - local.time) / wanted.rate
  const slack = SEEK_TOLERANCE_S * wanted.rate
  const heard = { ...wanted, time: target, at: now }
  // a stall stands still, so it never reads as this player jumping
  const moved = exact || !follow || follow.heard.paused !== wanted.paused || Math.abs(expectedTime(follow.heard, now, true) - target) > slack ||
    local.time < follow.played.time - RUNS_BACK_S || local.time > expectedTime(follow.played, now, true) + slack
  const correction = playbackCorrection(local, wanted, now, true)
  if (Math.abs(drift) <= (moved ? SEEK_TOLERANCE_S : local.seeking ? Infinity : CATCH_UP_LIMIT_S)) delete correction.seek
  // read once a seek landed, the drift is what that seek cost beyond what it aimed, so the next aims that far ahead
  const aim = !moved && correction.seek !== undefined && follow?.seek ? Math.max(0, drift + follow.seek.aim) : 0
  if (correction.seek !== undefined) correction.seek += aim * wanted.rate

  let next: Omit<Follow, 'played'>
  if (!follow || moved || !sameRate(follow.heard.rate, wanted.rate) || local.paused || local.seeking || correction.seek !== undefined) next = { heard, drifts: [] }
  else if (follow.catchUp && now < follow.catchUp.until) next = { ...follow, heard }
  else {
    const drifts = [...follow.drifts, drift].slice(-FILTER_SIZE)
    const filtered = drifts.length === FILTER_SIZE ? median(drifts) : 0
    if (Math.abs(filtered) > DEAD_BAND_S) {
      // behind the host runs fast, ahead of it runs slow, either side of the host's own speed
      const speed = Math.min(Math.abs(filtered) / CATCH_UP_S, NUDGE_RATE - 1)
      const rate = wanted.rate * (filtered > 0 ? 1 + speed : 1 / (1 + speed))
      next = { heard, drifts: [], catchUp: { rate, until: now + Math.abs(filtered * wanted.rate / (rate - wanted.rate)) * 1000 } }
    } else next = { heard, drifts }
  }

  const rate = next.catchUp?.rate ?? wanted.rate
  if (sameRate(local.rate, rate)) delete correction.rate
  else correction.rate = rate
  const played = { paused: correction.pause ?? (local.paused && !correction.play), time: correction.seek ?? local.time, rate, at: now }
  const seek = correction.seek !== undefined ? { aim } : local.seeking ? follow?.seek : undefined
  return { correction, follow: { ...next, played, seek } }
}

export const sameRate = (a: number, b: number) => Math.abs(a - b) <= 0.001
/** Whether `rate` is `base` or a catch-up either side of it. */
const nudgeOf = (rate: number, base: number) => rate <= base * NUDGE_RATE + 0.001 && rate >= base / NUDGE_RATE - 0.001

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

/** The least time between two asks for one control: the latest of a burst goes out at the end, so a held seek key cannot spend the member's ten messages a second. */
export const ASK_THROTTLE_MS = 250

/**
 * Which controls a person used on a follower's player, from a report against the one before it.
 *
 * `play` is the player pausing or resuming AWAY from `wanted`, so a player answering the host's own
 * pause late is not read as the person. `seek` is the time jumping against the previous report, back
 * by more than RUNS_BACK_S (a player's time never runs back by itself, and a 5 s skip made 4.5 s after the
 * last report lands only 0.5 s behind it) or forward past what it played since plus the tolerance, and
 * landing away from `wanted`: a stall stands still, so it is never a seek however far behind it leaves
 * the player. `rate` is a speed more than a catch-up from the last report's (menus step 0.25, and the
 * player's own catch-up can land after the host's new speed) that is neither `wanted`'s nor a catch-up of it.
 */
export const personAction = (previous: PlaybackState, report: PlaybackState, wanted: LocalPlayback): PlayerControl[] => {
  const used: PlayerControl[] = []
  if (report.paused !== previous.paused && report.paused !== wanted.paused) used.push('play')
  const jumped = report.time < previous.time - RUNS_BACK_S || report.time > expectedTime(previous, report.at, true) + SEEK_TOLERANCE_S
  if (jumped && Math.abs(report.time - wanted.time) > SEEK_TOLERANCE_S) used.push('seek')
  if (!nudgeOf(report.rate, previous.rate) && !nudgeOf(report.rate, wanted.rate)) used.push('rate')
  return used
}

/**
 * What the host's player should do for an ask: its own last report moved to now with only the asked
 * control changed, or undefined when it already does what was asked. `own.at` is the host's clock. A
 * seek's age is capped as an unmeasured report's is, so an ask that took long to arrive moves the host
 * at most that far past where the person put it.
 */
export const askedState = (own: PlaybackState, ask: PlayerAsk, now: number): PlaybackState | undefined => {
  const current = advance(own, own.at, now)
  if (ask.c === 'play') return own.paused === ask.s.paused ? undefined : { ...current, paused: ask.s.paused }
  if (ask.c === 'rate') return sameRate(own.rate, ask.s.rate) ? undefined : { ...current, rate: ask.s.rate }
  const time = expectedTime(ask.s, now)
  return Math.abs(time - current.time) <= SEEK_TOLERANCE_S ? undefined : { ...current, time }
}
