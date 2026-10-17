import type { MediaPlayerHandle } from '@banou/media-player/remote'
import type { PlaybackState } from './protocol'

import { mediaPlayer } from '@banou/media-player/remote'

import { HEARTBEAT_MS, playbackCorrection } from './playback'

// A player the party can hear and move, whoever holds it.
//
// stub's own /embed.html players and a source plugin's player both end up as a `PlayerMedia`: the
// first through `@banou/media-player/remote` over the embed iframe, the second through the plugin's
// connection (see ./plugin-link.ts). What the party's playback sync reads is the link below, so it
// cannot tell the two apart, which is the point.

/** A player the page can hear and move. */
export type PlaybackLink = {
  /**
   * Make the player match `state`.
   *
   * `measured` says `state.at` is on THIS clock rather than the host's, which is true once the
   * follower has timed a round trip (see clock.ts). It decides whether the age of the report is
   * trusted in full or capped, and nothing else.
   */
  apply: (state: PlaybackState, measured?: boolean) => void
  /** every report the player makes; returns the unsubscribe */
  onReport: (listener: (state: PlaybackState) => void) => () => void
  /** Whether the player reached the end, where the browser pauses it on its own: that pause is nobody's. */
  ended?: () => boolean
  /** The media's length in seconds, 0 before it is known; a source plugin's player does not say. */
  duration?: () => number
  dispose: () => void
}

/** The player events a change of state rides on; a heartbeat while playing covers drift between them. */
const EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'ended'] as const

/** The media surface a link reads and drives: what a `PlayerMedia` and a `RemotePlayer` both are. */
export type LinkableMedia = EventTarget & {
  paused: boolean
  ended?: boolean
  duration?: number
  currentTime: number
  playbackRate?: number
  play: () => Promise<void>
  /** `play`, muting if the far document will not start sound without a gesture; see @banou/media-player */
  autoplay?: () => Promise<{ muted: boolean }>
  pause: () => void
}

const stateOf = (media: LinkableMedia): PlaybackState => ({
  paused: media.paused,
  time: media.currentTime,
  rate: media.playbackRate ?? 1,
  at: Date.now(),
})

/**
 * A media as a link: reports on every event a person can cause and every few seconds while playing,
 * and applies a state with the tolerance in ./playback.ts.
 */
export const linkMedia = (media: LinkableMedia, onClose: () => void = () => {}): PlaybackLink => {
  const listeners = new Set<(state: PlaybackState) => void>()
  const report = () => { const state = stateOf(media); for (const listener of listeners) listener(state) }
  for (const event of EVENTS) media.addEventListener(event, report)
  const heartbeat = setInterval(() => { if (!media.paused) report() }, HEARTBEAT_MS)
  return {
    apply: (wanted, measured) => {
      const correction = playbackCorrection(stateOf(media), wanted, Date.now(), measured)
      if (correction.seek !== undefined) media.currentTime = correction.seek
      if (correction.rate !== undefined) media.playbackRate = correction.rate
      if (correction.pause) media.pause()
      // `autoplay` where the player has one: a follower never clicked inside the player's document,
      // and starting muted is better than not starting. The next heartbeat asks again either way.
      if (correction.play) (media.autoplay ? media.autoplay() : media.play()).catch(() => {})
    },
    // a new ear is answered with where the player is now, not at its next event
    onReport: listener => { listeners.add(listener); queueMicrotask(report); return () => { listeners.delete(listener) } },
    ended: () => media.ended ?? false,
    duration: () => media.duration ?? 0,
    dispose: () => {
      for (const event of EVENTS) media.removeEventListener(event, report)
      clearInterval(heartbeat)
      listeners.clear()
      onClose()
    },
  }
}

/**
 * The player inside stub's own embed iframe, as a link.
 *
 * The embed serves its player with `exposePlayer` (see sources/crunchyroll/cr-videojs-player.tsx and
 * the Netflix one), to this page and nobody else; `mediaPlayer` is the other half. Same origin, so the
 * origin is this page's own.
 */
export const attachPlaybackBridge = (iframe: HTMLIFrameElement): PlaybackLink => {
  const player: MediaPlayerHandle = mediaPlayer(iframe, { origin: location.origin })
  return linkMedia(player, () => player.destroy())
}
