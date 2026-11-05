import type { MediaChapter } from '@banou/media-player'
import type { MediaPlayerHandle } from '@banou/media-player/remote'
import type { PlaybackState } from './protocol'
import type { PlayerBuffer } from './status'

import { mediaPlayer } from '@banou/media-player/remote'

import { followCorrection, HEARTBEAT_MS, playbackCorrection, sameRate, type Follow, type PlaybackCorrection } from './playback'

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
  /**
   * Keep the player with a host whose player is at `state`, `state.at` on this clock, as a follower does on every
   * state it hears and every report of its own (see `followCorrection`), and say what it did; `exact` puts it where
   * the host is at once, as on following again or Catch up. Absent where the player keeps up by a rule of its own
   * with each state `apply` hands it.
   */
  follow?: (state: PlaybackState, exact?: boolean) => PlaybackCorrection
  /** every report the player makes; returns the unsubscribe */
  onReport: (listener: (state: PlaybackState) => void) => () => void
  /** Whether the player reached the end, where the browser pauses it on its own: that pause is nobody's. */
  ended?: () => boolean
  /** The media's length in seconds, 0 before it is known, undefined for a source plugin's player that does not say. */
  duration?: () => number | undefined
  /** Where the player is and what it has loaded, as of the call; absent for a source plugin's player that does not say. Never rejects or hangs. */
  buffer?: () => Promise<PlayerBuffer | undefined>
  /** The player's own chapters as of its last report, undefined until it says; absent for stub's own embed, whose page reads its chapters itself. */
  chapters?: () => MediaChapter[] | undefined
  /** Give the keys to a player nested below the frame the page holds; absent where focusing that frame is enough. */
  focus?: () => void
  /** Ask the player to stop offering to skip its last ending, or to offer it again; absent where it cannot be asked. */
  offerEnding?: (offered: boolean) => void
  /** Whether the player offers to skip its last ending, as of its last report; false only once that offer has left its screen. Present with `offerEnding`. */
  endingOffered?: () => boolean
  /** Fetch ahead what the player waits on to play `release`, a release of its own source, next; absent where it cannot. */
  prepare?: (release: { uri: string, url?: string }) => void
  dispose: () => void
}

/** The player events a change of state rides on; a heartbeat while playing covers drift between them. */
const EVENTS = ['play', 'pause', 'seeked', 'ratechange', 'ended'] as const

/** The media surface a link reads and drives: what a `PlayerMedia` and a `RemotePlayer` both are. */
export type LinkableMedia = EventTarget & {
  paused: boolean
  ended?: boolean
  seeking?: boolean
  duration?: number
  currentTime: number
  playbackRate?: number
  readyState?: number
  buffered?: { length: number, start: (index: number) => number, end: (index: number) => number }
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
 * and applies or follows a state by the rules in ./playback.ts.
 */
export const linkMedia = (media: LinkableMedia, onClose: () => void = () => {}): PlaybackLink => {
  const listeners = new Set<(state: PlaybackState) => void>()
  const report = () => { const state = stateOf(media); for (const listener of listeners) listener(state) }
  for (const event of EVENTS) media.addEventListener(event, report)
  const heartbeat = setInterval(() => { if (!media.paused) report() }, HEARTBEAT_MS)
  const move = (correction: PlaybackCorrection) => {
    if (correction.seek !== undefined) media.currentTime = correction.seek
    if (correction.rate !== undefined) media.playbackRate = correction.rate
    if (correction.pause) media.pause()
    // `autoplay` where the player has one: a follower never clicked inside the player's document,
    // and starting muted is better than not starting. The next heartbeat asks again either way.
    if (correction.play) (media.autoplay ? media.autoplay() : media.play()).catch(() => {})
  }
  let following: Follow | undefined
  // a catch-up ends on time whether or not anything is applied by then, a follower that stopped following included
  let caughtUp: ReturnType<typeof setTimeout> | undefined
  return {
    apply: (wanted, measured) => { move(playbackCorrection(stateOf(media), wanted, Date.now(), measured)) },
    follow: (wanted, exact) => {
      const now = Date.now()
      const { correction, follow } = followCorrection(following, { ...stateOf(media), seeking: media.seeking }, wanted, now, exact)
      following = follow
      clearTimeout(caughtUp)
      const { catchUp } = follow
      if (catchUp) caughtUp = setTimeout(() => { if (sameRate(media.playbackRate ?? 1, catchUp.rate)) media.playbackRate = wanted.rate }, catchUp.until - now)
      // play() on an ended player starts it over from 0: it follows the host only somewhere else
      if (media.ended && correction.seek === undefined) return {}
      move(correction)
      return correction
    },
    // a new ear is answered with where the player is now, not at its next event
    onReport: listener => { listeners.add(listener); queueMicrotask(report); return () => { listeners.delete(listener) } },
    ended: () => media.ended ?? false,
    duration: () => media.duration ?? 0,
    buffer: async () => {
      const { buffered } = media
      const ranges: [number, number][] = []
      for (let index = 0; buffered && index < buffered.length; index++) ranges.push([buffered.start(index), buffered.end(index)])
      return { time: media.currentTime, readyState: media.readyState ?? 0, ranges }
    },
    dispose: () => {
      for (const event of EVENTS) media.removeEventListener(event, report)
      clearInterval(heartbeat)
      clearTimeout(caughtUp)
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
