import type { FollowerState, PartyMessage } from './protocol'

import { SEEK_TOLERANCE_S } from './playback'

// Where a follower stands, told to the host. Pure, so the thresholds can be pinned.

/** What a follower tells the host: the `status` message without its tag. */
export type FollowerStatus = Omit<Extract<PartyMessage, { t: 'status' }>, 't'>

/** Where a player is, how far it can play on its own (`readyState`, as a media element's) and the ranges it holds, in seconds. */
export type PlayerBuffer = { time: number, readyState: number, ranges: [number, number][] }

/**
 * Seconds loaded past the party's position for a follower to be ready, and the fewer it may drop to
 * before it is not.
 *
 * Not the browser's own "enough data": on every swarm torrent measured through torrent.fkn.app
 * (2026-10-20 and 2026-10-22, four torrents, eight observations) the video said it had enough with
 * under 5 s loaded, and 10 s came from half a second to half a minute later. A paused torrent player
 * keeps loading to about 30 s (media-player's buffer target), so 10 s is always reached given time.
 * The lower bound keeps a follower playing on a thin buffer, as a torrent does, from flickering.
 */
export const READY_AHEAD_S = 10
export const STALL_AHEAD_S = 2

/** `readyState` from which a player can move forward on its own. */
export const HAVE_FUTURE_DATA = 3

/** How often a follower looks at its player to tell the host. */
export const STATUS_CHECK_MS = 1_000

/** How far a follower's player may be from where its last status puts it before that status is news. */
const STATUS_DRIFT_S = 1

/**
 * The seconds loaded past `time`, in the range holding it. A range starting within the seek tolerance
 * after it counts: a follower is placed that close to the host, and plays from there.
 */
export const bufferedAhead = (ranges: readonly [number, number][], time: number): number => {
  const range = ranges.find(([start, end]) => start - SEEK_TOLERANCE_S <= time && time < end)
  return range ? range[1] - time : 0
}

/**
 * Whether a follower can play from `position`, the party's second: enough loaded past it, or all of
 * what is left up to `duration`.
 */
export const readiness = (was: FollowerState | undefined, buffer: PlayerBuffer | undefined, position: number, duration = 0): 'ready' | 'loading' => {
  if (!buffer || buffer.readyState < HAVE_FUTURE_DATA) return 'loading'
  const need = was === 'ready' ? STALL_AHEAD_S : READY_AHEAD_S
  const left = duration > 0 && Number.isFinite(duration) ? duration - position : Infinity
  return bufferedAhead(buffer.ranges, position) >= Math.min(need, left) ? 'ready' : 'loading'
}

/** Where a status puts the follower's player `ms` after it was said. */
export const statusTime = (status: FollowerStatus, ms: number): number | undefined =>
  status.time === undefined ? undefined : status.time + Math.max(0, ms) / 1000 * (status.rate ?? 0)

/**
 * Whether `next` says something `told`, said `ms` ago, does not: another state or page, a player that
 * started or stopped, or one away from where `told` puts it.
 */
export const statusMoved = (told: FollowerStatus, next: FollowerStatus, ms: number): boolean => {
  if (told.s !== next.s || told.path !== next.path || !told.rate !== !next.rate) return true
  const expected = statusTime(told, ms)
  return expected === undefined || next.time === undefined ? expected !== next.time : Math.abs(expected - next.time) > STATUS_DRIFT_S
}

/**
 * A follower as the host shows it on `page`, `ms` after it was heard. A status about another page is
 * a follower still on its way there, so a Ready from the last episode never shows on the next one.
 */
export const shownStatus = (status: FollowerStatus, ms: number, page: string): { s: FollowerState, time?: number } => {
  if (status.path !== page) return { s: status.s === 'away' ? 'away' : 'loading' }
  const time = statusTime(status, ms)
  return time === undefined ? { s: status.s } : { s: status.s, time }
}
