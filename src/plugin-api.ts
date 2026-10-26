import type { Resolvers } from './generated/schema/types.generated'
import type { PlaybackState } from './party/protocol'

export type { PlaybackState }

// Subscription.media, mediaPage and similarMedia subscribe generators are served; the ctx a plugin sees carries exactly one function, `similarMedia`, and the viewer's `languages`

/**
 * BCP 47 tags: the viewer's language, and the audio and subtitle languages last picked in a player (null: off).
 * Additive to stub-source@1: a resolver gets them as `languages` in its context, and `play` with the release.
 */
export type ViewerLanguages = { language: string, audio?: string, subtitles?: string | null }

/** What playing a source's releases needs: nothing, an account with the source's site, or a paid plan there. */
export type SourceAccess = 'none' | 'account' | 'paid'

/** What a source says of the viewer's account with its site: signed in (with a plan, for a 'paid' source), signed out, or signed in with no plan. */
export type SourceAccount = 'signed-in' | 'signed-out' | 'no-plan'

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
  play?: (release: { uri: string, url?: string, languages?: ViewerLanguages }) => Promise<boolean>
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
  /**
   * Whether playing this source's releases needs an account with its site ('account') or a paid plan
   * there ('paid'). Optional and additive to stub-source@1: left out, or any other value, it is 'none',
   * and Play weighs the source exactly as before. A source that needs one plays with nothing to fix,
   * for Play, only while `account` says the viewer is signed in. Ranked first otherwise, it gives way to
   * a release that plays with nothing to fix, unless `account` said the viewer was signed in earlier in
   * this page: then Play opens it, for its own player to ask them to sign in again. With nothing to give
   * way to, Play opens it as before. Both levels route alike; 'paid' says a plan is part of the answer.
   */
  access?: SourceAccess
  /**
   * The viewer's account with this source's site now. Asked only of a source whose `access` is not
   * 'none', once for each episode the watch page opens, on the connection the source registered over.
   * Stub keeps the answer in the page's memory only: it is never stored and never sent anywhere.
   * 'no-plan' always gives way, since a sign in cannot fix it. Left out, not answered yet, or answered
   * late (over 3 s), with a rejection or with any other value, the viewer counts as never signed in
   * there for that episode, and Play waits at most those 3 s for the answer.
   */
  account?: () => Promise<SourceAccount>
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
