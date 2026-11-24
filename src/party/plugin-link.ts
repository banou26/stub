import type { MediaChapter, RemoteExternalSubtitleTrack } from '@banou/media-player'
import type { TrackPick } from '../plugin-api'
import type { PlaybackLink } from './bridge'
import type { Follow, LocalPlayback, PlaybackCorrection } from './playback'
import type { PlaybackState } from './protocol'
import type { PlayerBuffer } from './status'

import { hearFullscreenKey } from '../embed-fullscreen'
import { readAutoplay, setAutoplay, watchAutoplay } from '../utils/autoplay'
import { keepAlwaysSubtitles, keepAudioLanguage, keepSubtitleLanguage } from '../utils/track-languages'
import { advance, followCorrection, sameRate, SEEK_TOLERANCE_S } from './playback'
import { isPlaybackState } from './protocol'
import { HAVE_FUTURE_DATA } from './status'

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

/** Keeps what a package's player says the viewer picked, as a pick in stub's own players is kept. */
const keepPicked = (picked: unknown) => {
  if (!picked || typeof picked !== 'object') return
  const { audio, subtitles, alwaysSubtitles } = picked as Record<string, unknown>
  if (typeof audio === 'string') keepAudioLanguage(audio)
  if (typeof subtitles === 'string' || subtitles === null) keepSubtitleLanguage(subtitles)
  if (typeof alwaysSubtitles === 'boolean') keepAlwaysSubtitles(alwaysSubtitles)
}

/**
 * How long a package has to answer `buffer` before its answer is nothing. The package connection has
 * no time limit of its own, so a document that stopped answering would hold the call for good.
 */
export const BUFFER_WAIT_MS = 1_000

/** What a source package's player reports. See plugin-api.ts. */
type PlayerReport = PlaybackState & { ended?: boolean, duration?: number, chapters?: MediaChapter[], endingOffered?: boolean, picked?: TrackPick, autoplayNext?: boolean, seeking?: boolean, readyState?: number }

/** The optional methods a source package may serve beside `play`. See plugin-api.ts. */
export type PlaybackSource = {
  onPlayback?: (listener: (state: PlayerReport) => void) => Promise<void>
  applyPlayback?: (state: PlaybackState & { exact?: PlaybackCorrection }) => Promise<void>
  buffer?: () => Promise<unknown>
  onFullscreenRequest?: (listener: () => void) => Promise<void>
  applyFullscreen?: (active: boolean) => Promise<void>
  focus?: () => Promise<void>
  offerEnding?: (offered: boolean) => Promise<void>
  applyAutoplay?: (on: boolean) => Promise<void>
  applyEpisodeNavigation?: (navigation: { previous?: string | boolean, next?: string | boolean }) => Promise<void>
  onEpisodeNavigation?: (listener: (direction: 'previous' | 'next') => void) => Promise<void>
  applySourceSwitch?: (value: string | boolean) => Promise<void>
  onSourceSwitch?: (listener: () => void) => Promise<void>
  applyExternalSubtitles?: (tracks: RemoteExternalSubtitleTrack[]) => Promise<void>
  onSubtitleLoadRequest?: (listener: (trackId: string) => void) => Promise<void>
  provideExternalSubtitle?: (trackId: string, content: string | null, error?: string) => Promise<void>
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
 *
 * A track the viewer picks in the player, and a flip of its autoplay switch, are kept from the moment the link is up,
 * party or not.
 *
 * `follow` keeps the player with the host by `followCorrection`, as stub's own players are kept, over where its reports
 * put it now: played on from the last one unless it said it was seeking or waiting, and at a seek it was sent until a
 * report shows it. The package is told what to do as `exact`, beside the host's state for a package from before it.
 *
 * A report made while the player seeks says where it was sent, not where it plays, so it reaches `follow` and no
 * listener: told to the party, a follower would seek there and play on, then seek back as the host's seek lands.
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
  let last: (PlaybackState & { seeking: boolean, standing: boolean }) | undefined
  let seekTo: number | undefined
  let following: Follow | undefined
  let caughtUp: ReturnType<typeof setTimeout> | undefined
  // vetted: the package is another origin's code, and what it says goes into the host's snapshot and
  // out to every follower, where the decoder would drop it anyway; better to drop it here, once
  const ear = (report: PlayerReport) => {
    if (disposed || !isPlaybackState(report)) return
    keepPicked(report.picked)
    if (typeof report.autoplayNext === 'boolean') setAutoplay(report.autoplayNext)
    ended = report.ended === true
    duration = lengthOf(report.duration)
    chapters = chaptersOf(report.chapters)
    endingOffered = report.endingOffered !== false
    const { paused, time, rate, at } = report
    const seeking = report.seeking === true
    if (seekTo !== undefined && (seeking || Math.abs(time - seekTo) <= SEEK_TOLERANCE_S)) seekTo = undefined
    last = { paused, time, rate, at, seeking, standing: seeking || (finite(report.readyState) && report.readyState < HAVE_FUTURE_DATA) }
    if (!seeking) for (const listener of listeners) listener({ paused, time, rate, at })
  }
  const listen = () => { onPlayback(ear).catch(() => {}) }
  listen()
  const local = (now: number): LocalPlayback | undefined => {
    if (!last) return undefined
    const { paused, rate, seeking, standing } = last
    if (seekTo !== undefined) return { paused, time: seekTo, rate, seeking: true }
    return { paused, time: standing ? last.time : advance(last, last.at, now).time, rate, seeking }
  }
  const tell = (state: PlaybackState, exact: PlaybackCorrection) => {
    if (exact.seek !== undefined) seekTo = exact.seek
    applyPlayback({ ...state, exact }).catch(() => {})
  }

  return {
    // `measured` is not forwarded: the package's contract takes a state and nothing else, and it does
    // not need to be told. What reaches it here already carries a local `at` (party-playback.tsx
    // converts before applying), so the package's own cap on a report's age never binds.
    apply: state => { applyPlayback(state).catch(() => {}) },
    seek: time => { if (!disposed && last) tell({ paused: last.paused, time, rate: last.rate, at: Date.now() }, { seek: time }) },
    play: () => { if (!disposed && last && last.paused) tell({ ...last, paused: false, at: Date.now() }, { play: true }) },
    follow: (wanted, atOnce) => {
      const now = Date.now()
      const own = local(now)
      // the package greets its player on every new ear, so a report is on its way
      if (disposed || !own) return {}
      const { correction, follow } = followCorrection(following, own, wanted, now, atOnce)
      following = follow
      clearTimeout(caughtUp)
      const { catchUp } = follow
      if (catchUp) caughtUp = setTimeout(() => { if (last && sameRate(last.rate, catchUp.rate)) tell(advance(wanted, now, Date.now()), { rate: wanted.rate }) }, catchUp.until - now)
      // play() on an ended player starts it over from 0: it follows the host only somewhere else
      if (ended && correction.seek === undefined) return {}
      tell(wanted, correction)
      return correction
    },
    // registering the ear again is how the package is asked where the player is NOW: it greets its
    // player on every registration, and the player answers a greeting with a report. A party that
    // starts against a paused player would otherwise have nothing to tell a joiner until the host
    // touched the controls.
    onReport: listener => { listeners.add(listener); listen(); return () => { listeners.delete(listener) } },
    ended: () => ended,
    duration: () => duration,
    chapters: () => chapters,
    ...(focus || frame) ? {
      focus: () => {
        if (disposed) return
        // blurred first: once the package removed a player's frame that had the keys, Chromium 155 has taken the
        // focus out of the package's document while this page still names its frame focused (2026-10-26).
        // Yield a turn before delegating into the inner frame when `frame` is present (Chrome 156 focus race).
        frame?.blur()
        frame?.focus()
        if (focus) {
          if (frame) setTimeout(() => { if (!disposed) focus().catch(() => {}) }, 0)
          else focus().catch(() => {})
        }
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
    ...prepare ? { prepare: release => (disposed ? Promise.resolve(false) : Promise.resolve(prepare(release)).catch(() => false)) } : {},
    ...buffer ? {
      buffer: () => Promise.race([
        buffer().then(bufferOf, () => undefined),
        new Promise<undefined>(resolve => setTimeout(resolve, BUFFER_WAIT_MS)),
      ]),
    } : {},
    dispose: () => { disposed = true; clearTimeout(caughtUp); listeners.clear() },
  }
}

/**
 * Keeps the fullscreen of a source package's player on `stage`, as ../embed-fullscreen.ts does for stub's own embed:
 * the player asks through the package's `onFullscreenRequest`, within its press's activation, and the package is told
 * the page's state through `applyFullscreen`, at once and on every change. `f` on the page asks too, and then gives
 * the keys to the package's `frame` and through its `focus` to the player. A package without the pair, or a page that
 * cannot fullscreen, leaves the player its own fullscreen. Returns the stop.
 */
export const servePluginFullscreen = (source: PlaybackSource, stage: HTMLElement, host: Window = window, frame?: HTMLIFrameElement) => {
  const { document } = host
  const { onFullscreenRequest, applyFullscreen, focus } = source
  if (!document.fullscreenEnabled || !onFullscreenRequest || !applyFullscreen) return () => {}
  let stopped = false
  const stopKey = hearFullscreenKey(document, stage, frame, () => { if (!stopped) focus?.().catch(() => {}) })
  const tell = () => { applyFullscreen(Boolean(document.fullscreenElement)).catch(() => {}) }
  onFullscreenRequest(() => {
    if (!stopped) (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {})
  }).catch(() => {})
  document.addEventListener('fullscreenchange', tell)
  tell()
  return () => {
    stopped = true
    stopKey()
    document.removeEventListener('fullscreenchange', tell)
  }
}

/**
 * Shows the autoplay setting on a source package's player through its `applyAutoplay`, at once and on every change, in
 * this tab, another one or on the account. A package without it shows none. Returns the stop.
 */
export const servePluginAutoplay = (source: PlaybackSource) => {
  const { applyAutoplay } = source
  if (!applyAutoplay) return () => {}
  const tell = () => { applyAutoplay(readAutoplay()).catch(() => {}) }
  tell()
  return watchAutoplay(tell)
}

/** Serves previous/next episode button state to a source package's player and forwards button clicks to `onStep`. */
export const servePluginEpisodeNavigation = (
  source: PlaybackSource,
  navigation: { previous?: string | boolean, next?: string | boolean },
  onStep: (direction: 'previous' | 'next') => void,
) => {
  const { applyEpisodeNavigation, onEpisodeNavigation } = source
  if (!applyEpisodeNavigation || !onEpisodeNavigation) return () => {}
  let stopped = false
  const previous = navigation.previous || false
  const next = navigation.next || false
  onEpisodeNavigation(direction => {
    if (stopped) return
    if ((direction === 'previous' && previous) || (direction === 'next' && next)) onStep(direction)
  }).catch(() => {})
  applyEpisodeNavigation({ previous, next }).catch(() => {})
  return () => { stopped = true }
}

/** Serves quick source switch control state to a source package's player and forwards button clicks to `onRequest`. */
export const servePluginSourceSwitch = (
  source: PlaybackSource,
  value: string | boolean,
  onRequest: () => void,
) => {
  const { applySourceSwitch, onSourceSwitch } = source
  if (!applySourceSwitch || !onSourceSwitch) return () => {}
  let stopped = false
  const enabled = value || false
  onSourceSwitch(() => {
    if (stopped || !enabled) return
    onRequest()
  }).catch(() => {})
  applySourceSwitch(enabled).catch(() => {})
  return () => { stopped = true }
}

/** Pushes external subtitle tracks to a source package's player and answers load requests using `load`. */
export const servePluginExternalSubtitles = (
  source: PlaybackSource,
  tracks: RemoteExternalSubtitleTrack[],
  load: (trackId: string) => Promise<string>,
) => {
  const { applyExternalSubtitles, onSubtitleLoadRequest, provideExternalSubtitle } = source
  if (!applyExternalSubtitles || !onSubtitleLoadRequest || !provideExternalSubtitle) return () => {}
  let stopped = false
  onSubtitleLoadRequest(trackId => {
    if (stopped) return
    Promise.resolve()
      .then(() => load(trackId))
      .then(
        content => { if (!stopped) void provideExternalSubtitle(trackId, content).catch(() => {}) },
        error => {
          if (!stopped) void provideExternalSubtitle(trackId, null, error instanceof Error ? error.message : String(error)).catch(() => {})
        },
      )
  }).catch(() => {})
  applyExternalSubtitles(tracks).catch(() => {})
  return () => { stopped = true }
}
