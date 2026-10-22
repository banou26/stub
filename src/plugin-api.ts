import type { Resolvers } from './generated/schema/types.generated'
import type { PlaybackState } from './party/protocol'

export type { PlaybackState }

// Subscription.media, mediaPage and similarMedia subscribe generators are served; the ctx a plugin sees carries exactly one function, `similarMedia`

export type StubSource = {
  // contract: every top-level media a plugin yields must carry its declared origin or the worker drops it (enforcePluginOrigin); nested handles are exempt, cross-origin handles are how clustering works
  /** unique lowercase origin slug, e.g. 'myanime' - all yielded media must carry it */
  origin: string
  originUrl: string
  name: string
  icon?: string
  color?: string
  isApiOnly: boolean
  metadataOnly?: boolean
  resolvers: Resolvers
  /**
   * Render this source's own picker for the given handle uris. Stub shows the package's frame with
   * `packages.show` and awaits this call; the resolution IS the pick.
   */
  selectRelease?: (uris: string[]) => Promise<string | null>
  /**
   * Play a release inside the package's own frame, resolving true once its player is up.
   *
   * Declaring this is what makes a source self-playing: stub MOUNTS the package into its player area
   * with `packages.mount` and calls this on that connection, so the package renders inside stub's
   * layout and fullscreens with it. Stub never learns how the source plays anything, which is the
   * point: a torrent index can hand its release to a torrent client without stub knowing torrents
   * exist.
   */
  play?: (release: { uri: string, url?: string }) => Promise<boolean>
  /**
   * Hear what the player `play` put up is doing: every play, pause, seek and rate change, and a
   * heartbeat every few seconds while it plays. One listener; the next call replaces it.
   *
   * Optional and ADDITIVE to stub-source@1, so it needs no new contract tag: a package without it
   * plays exactly as before and is simply not synced. Stub reads it for watch together, where a host's
   * player is what every follower's player is made to match. `at` is the PLAYER's clock, whatever
   * document that player lives in, passed through untouched; stub trusts it only within a bound.
   * `ended` is true once the player reached the end, where the browser paused it by itself.
   * `duration` is the media's length in seconds, 0 until the player knows it and Infinity for live media:
   * with a length an episode counts as watched at 85% played and its row shows how far in it stopped;
   * without one, only its end counts.
   */
  onPlayback?: (listener: (state: PlaybackState & { ended?: boolean, duration?: number }) => void) => Promise<void>
  /** Make the player match `state`. Nothing playing is nothing to do, not an error. */
  applyPlayback?: (state: PlaybackState) => Promise<void>
  /**
   * Where the player `play` put up is, how far it can play on its own (`readyState`, as a media
   * element's) and the ranges it holds, in seconds; undefined with nothing playing. Optional and
   * additive to stub-source@1 like the two above: in watch together a follower reads it to tell the
   * host whether it is ready to play, and without it, or with no answer within a second, a follower
   * on that source reads as loading.
   */
  buffer?: () => Promise<{ time: number, readyState: number, ranges: [number, number][] } | undefined>
}

/**
 * What a plugin serves: one source, or a family of them.
 *
 * A source in a family is an ordinary standalone source that happens to arrive over a shared
 * connection. Each registers under its own origin with its own name, icon and colour, and each fails
 * on its own: a malformed or colliding source is skipped and reported while its siblings serve
 * normally, so grouping sources into one package never makes them more fragile than shipping them
 * separately. They are torn down together when the package disconnects.
 */
export type StubPluginAPI = StubSource | { sources: StubSource[] }

export const STUB_SOURCE_PROTOCOL = 'stub-source@1'
