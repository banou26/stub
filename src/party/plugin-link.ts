import type { PlaybackLink } from './bridge'
import type { PlaybackState } from './protocol'
import type { PlayerBuffer } from './status'

import { isPlaybackState } from './protocol'

/**
 * A package's `duration`, 0 while the player does not know it yet. Undefined, a player with no length to
 * wait for, from a package that never says it and for Infinity, which @banou/media-player sends for live media.
 */
const lengthOf = (duration: unknown) =>
  typeof duration !== 'number' || duration === Infinity ? undefined : duration > 0 ? duration : 0

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** A package's `buffer` answer, or nothing for one of the wrong shape. */
const bufferOf = (value: unknown): PlayerBuffer | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { time, readyState, ranges } = value as Record<string, unknown>
  if (!finite(time) || time < 0 || !finite(readyState) || !Number.isInteger(readyState) || readyState < 0 || readyState > 4) return undefined
  const valid = Array.isArray(ranges) && ranges.every(range => Array.isArray(range) && range.length === 2 && finite(range[0]) && finite(range[1]) && range[0] <= range[1])
  return valid ? { time, readyState, ranges } : undefined
}

/**
 * How long a package has to answer `buffer` before its answer is nothing. The package connection has
 * no time limit of its own, so a document that stopped answering would hold the call for good.
 */
export const BUFFER_WAIT_MS = 1_000

/** The optional methods a source package may serve beside `play`. See plugin-api.ts. */
export type PlaybackSource = {
  onPlayback?: (listener: (state: PlaybackState & { ended?: boolean, duration?: number }) => void) => Promise<void>
  applyPlayback?: (state: PlaybackState) => Promise<void>
  buffer?: () => Promise<unknown>
}

/**
 * A source package's player as a link, or nothing for a package that does not offer one.
 *
 * The package takes ONE listener and replaces it on the next call, so this registers once and fans
 * out; the party attaches and detaches its own ear through `onReport` without the package hearing
 * about it. Both calls cross the package connection, and a refusal or a dead connection there is
 * not the page's to surface: a player it cannot hear is a player it does not sync.
 */
export const pluginPlaybackLink = (source: PlaybackSource): PlaybackLink | undefined => {
  const { onPlayback, applyPlayback, buffer } = source
  if (!onPlayback || !applyPlayback) return undefined

  const listeners = new Set<(state: PlaybackState) => void>()
  let disposed = false
  let ended = false
  let duration: number | undefined
  // vetted: the package is another origin's code, and what it says goes into the host's snapshot and
  // out to every follower, where the decoder would drop it anyway; better to drop it here, once
  const ear = (report: PlaybackState & { ended?: boolean, duration?: number }) => {
    if (disposed || !isPlaybackState(report)) return
    ended = report.ended === true
    duration = lengthOf(report.duration)
    const { paused, time, rate, at } = report
    for (const listener of listeners) listener({ paused, time, rate, at })
  }
  const listen = () => { onPlayback(ear).catch(() => {}) }
  listen()

  return {
    // `measured` is not forwarded: the package's contract takes a state and nothing else, and it does
    // not need to be told. What reaches it here already carries a local `at` (party-playback.tsx
    // converts before applying), so the package's own cap on a report's age never binds.
    apply: state => { applyPlayback(state).catch(() => {}) },
    // registering the ear again is how the package is asked where the player is NOW: it greets its
    // player on every registration, and the player answers a greeting with a report. A party that
    // starts against a paused player would otherwise have nothing to tell a joiner until the host
    // touched the controls.
    onReport: listener => { listeners.add(listener); listen(); return () => { listeners.delete(listener) } },
    ended: () => ended,
    duration: () => duration,
    ...buffer ? {
      buffer: () => Promise.race([
        buffer().then(bufferOf, () => undefined),
        new Promise<undefined>(resolve => setTimeout(resolve, BUFFER_WAIT_MS)),
      ]),
    } : {},
    dispose: () => { disposed = true; listeners.clear() },
  }
}
