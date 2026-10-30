import type { MediaChapter } from '@banou/media-player'
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

/** A package's chapters, or nothing for a list of the wrong shape. */
const chaptersOf = (value: unknown): MediaChapter[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const chapters = value.map(chapter => {
    const { start, end, title } = (chapter ?? {}) as Record<string, unknown>
    return finite(start) && finite(end) && start >= 0 && end >= start && typeof title === 'string' ? { start, end, title } : undefined
  })
  return chapters.every(chapter => chapter !== undefined) ? chapters : undefined
}

/**
 * How long a package has to answer `buffer` before its answer is nothing. The package connection has
 * no time limit of its own, so a document that stopped answering would hold the call for good.
 */
export const BUFFER_WAIT_MS = 1_000

/** The optional methods a source package may serve beside `play`. See plugin-api.ts. */
export type PlaybackSource = {
  onPlayback?: (listener: (state: PlaybackState & { ended?: boolean, duration?: number, chapters?: MediaChapter[], endingOffered?: boolean }) => void) => Promise<void>
  applyPlayback?: (state: PlaybackState) => Promise<void>
  buffer?: () => Promise<unknown>
  onFullscreenRequest?: (listener: () => void) => Promise<void>
  applyFullscreen?: (active: boolean) => Promise<void>
  focus?: () => Promise<void>
  offerEnding?: (offered: boolean) => Promise<void>
  prepare?: (release: { uri: string, url?: string }) => Promise<boolean>
}

/**
 * A source package's player as a link, or nothing for a package that does not offer one.
 *
 * The package takes ONE listener and replaces it on the next call, so this registers once and fans
 * out; the party attaches and detaches its own ear through `onReport` without the package hearing
 * about it. Both calls cross the package connection, and a refusal or a dead connection there is
 * not the page's to surface: a player it cannot hear is a player it does not sync.
 *
 * `frame` is the package's frame on this page. The link's `focus` focuses it afresh first, which gives the package's
 * document the focus it hands on to its player, and tells a viewer who moved on since from one who did not.
 */
export const pluginPlaybackLink = (source: PlaybackSource, frame?: HTMLIFrameElement): PlaybackLink | undefined => {
  const { onPlayback, applyPlayback, buffer, focus, offerEnding, prepare } = source
  if (!onPlayback || !applyPlayback) return undefined

  const listeners = new Set<(state: PlaybackState) => void>()
  let disposed = false
  let ended = false
  let duration: number | undefined
  let chapters: MediaChapter[] | undefined
  let endingOffered = true
  // the last ask, since the player's last word can be older than an ask still on its way
  let asked = true
  // vetted: the package is another origin's code, and what it says goes into the host's snapshot and
  // out to every follower, where the decoder would drop it anyway; better to drop it here, once
  const ear = (report: PlaybackState & { ended?: boolean, duration?: number, chapters?: MediaChapter[], endingOffered?: boolean }) => {
    if (disposed || !isPlaybackState(report)) return
    ended = report.ended === true
    duration = lengthOf(report.duration)
    chapters = chaptersOf(report.chapters)
    endingOffered = report.endingOffered !== false
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
    chapters: () => chapters,
    ...focus ? {
      focus: () => {
        if (disposed) return
        // blurred first: once the package removed a player's frame that had the keys, Chromium 155 has taken the
        // focus out of the package's document while this page still names its frame focused (2026-10-26)
        frame?.blur()
        frame?.focus()
        focus().catch(() => {})
      },
    } : {},
    ...offerEnding ? {
      offerEnding: offered => {
        if (disposed || (offered === endingOffered && offered === asked)) return
        asked = offered
        offerEnding(offered).catch(() => {})
      },
      endingOffered: () => endingOffered,
    } : {},
    ...prepare ? { prepare: release => { if (!disposed) prepare(release).catch(() => {}) } } : {},
    ...buffer ? {
      buffer: () => Promise.race([
        buffer().then(bufferOf, () => undefined),
        new Promise<undefined>(resolve => setTimeout(resolve, BUFFER_WAIT_MS)),
      ]),
    } : {},
    dispose: () => { disposed = true; listeners.clear() },
  }
}

/**
 * Keeps the fullscreen of a source package's player on `stage`, as ../embed-fullscreen.ts does for stub's own embed:
 * the player asks through the package's `onFullscreenRequest`, within its press's activation, and the package is told
 * the page's state through `applyFullscreen`, at once and on every change. A package without the pair, or a page
 * that cannot fullscreen, leaves the player its own fullscreen. Returns the stop.
 */
export const servePluginFullscreen = (source: PlaybackSource, stage: HTMLElement, host: Window = window) => {
  const { document } = host
  const { onFullscreenRequest, applyFullscreen } = source
  if (!document.fullscreenEnabled || !onFullscreenRequest || !applyFullscreen) return () => {}
  let stopped = false
  const tell = () => { applyFullscreen(Boolean(document.fullscreenElement)).catch(() => {}) }
  onFullscreenRequest(() => {
    if (!stopped) (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {})
  }).catch(() => {})
  document.addEventListener('fullscreenchange', tell)
  tell()
  return () => {
    stopped = true
    document.removeEventListener('fullscreenchange', tell)
  }
}
