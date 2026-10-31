import type { MediaChapter } from '@banou/media-player'
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
   *
   * Stub keeps the package's frame for the next releases of the source and plays each there in turn: a
   * play replaces the player before it, in a new frame of its own rather than by loading another
   * address in the old one, which would add a step to the tab's history.
   */
  play?: (release: { uri: string, url?: string, languages?: ViewerLanguages }) => Promise<boolean>
  /**
   * Hear what the player `play` put up is doing: every play, pause, seek and rate change, and a
   * heartbeat every few seconds while it plays. One listener; the next call replaces it.
   *
   * Optional and ADDITIVE to stub-source@1, so it needs no new contract tag: a package without it
   * plays exactly as before and is simply not synced. Stub reads it for a watch party, where a host's
   * player is what every follower's player is made to match. `at` is the PLAYER's clock, whatever
   * document that player lives in, passed through untouched; stub trusts it only within a bound.
   * `ended` is true once the player reached the end, where the browser paused it by itself.
   * `duration` is the media's length in seconds, 0 until the player knows it and Infinity for live media:
   * with a length an episode counts as watched at 85% played and its row shows how far in it stopped;
   * without one, only its end counts. `chapters` are the file's own, in seconds: with an ending among them,
   * Next episode is offered as it starts rather than at the end. `endingOffered` answers `offerEnding`: false
   * only once the player's Skip Ending is off its screen.
   */
  onPlayback?: (listener: (state: PlaybackState & { ended?: boolean, duration?: number, chapters?: MediaChapter[], endingOffered?: boolean }) => void) => Promise<void>
  /** Make the player match `state`. Nothing playing is nothing to do, not an error. */
  applyPlayback?: (state: PlaybackState) => Promise<void>
  /**
   * Where the player `play` put up is, how far it can play on its own (`readyState`, as a media
   * element's) and the ranges it holds, in seconds; undefined with nothing playing. Optional and
   * additive to stub-source@1 like the two above: in a watch party a follower reads it to tell the
   * host whether it is ready to play, and without it, or with no answer within a second, a follower
   * on that source reads as loading.
   */
  buffer?: () => Promise<{ time: number, readyState: number, ranges: [number, number][] } | undefined>
  /**
   * Whether playing this source's releases needs an account with its site ('account') or a paid plan
   * there ('paid'). Optional and additive to stub-source@1: left out, or any other value, it is 'none',
   * and Play weighs the source exactly as before. A source that needs one plays with nothing to fix,
   * for Play, only once `account` said for the episode that the viewer is signed in. Ranked first
   * otherwise, it gives way to a release that plays with nothing to fix, unless `account` said the
   * viewer was signed in earlier in this page: then Play opens it, for its own player to ask them to
   * sign in again. With nothing to give way to, Play opens it as before. Both levels route alike;
   * 'paid' says a plan is part of the answer.
   */
  access?: SourceAccess
  /**
   * The viewer's account with this source's site now. Asked only of a source whose `access` is not
   * 'none', once for each episode the watch page opens, on the connection the source registered over.
   * Stub keeps the answer in the page's memory only: it is never stored and never sent anywhere.
   * 'no-plan' always gives way, since a sign in cannot fix it. Left out, not answered yet, or answered
   * late (over 3 s), with a rejection or with any other value, the viewer counts as not signed in
   * there for that episode, and Play waits at most those 3 s for the answer.
   */
  account?: () => Promise<SourceAccount>
  /**
   * Hand the player's fullscreen to stub: from the first call on, its fullscreen controls call `listener`
   * instead of fullscreening anything, within the press's activation, and stub fullscreens the box around
   * the package's frame, which stays fullscreen as the next episode's player replaces this one. One listener; the
   * next call replaces it. Stub calls it only where it can fullscreen that box, so a package must leave the
   * player its own fullscreen until then. Optional and additive to stub-source@1, like the two below.
   */
  onFullscreenRequest?: (listener: () => void) => Promise<void>
  /** Whether stub shows the player fullscreen, for its fullscreen controls to show: told at once and on every change. */
  applyFullscreen?: (active: boolean) => Promise<void>
  /**
   * Hand the keys on to the player, after stub focused the package's frame: called at the first report of
   * a release's player put up in place of another's, and after a press on stub's own buttons over the
   * player. The player's document may still be loading, and a focus given before it has loaded does not
   * reach it once it has (Chrome 155, 2026-10-26), so a package waits for the load.
   */
  focus?: () => Promise<void>
  /**
   * Ask the player to stop offering to skip its last ending, or to offer it again: stub says false where nothing
   * follows that ending and Next episode takes the corner, and true when there is no Next episode after all. Next
   * waits for the report that says `endingOffered: false`, and a package or player that cannot do this leaves it
   * at the end. Optional and additive to stub-source@1.
   */
  offerEnding?: (offered: boolean) => Promise<void>
  /**
   * Fetch ahead what a later `play` of `release`, the next episode's release Next opens, waits on before its first
   * frame, beside the player up now. Stub asks once an episode's player is 80% through it. Resolves true when it was
   * asked, false with no player up or a release the source cannot play. Optional and additive to stub-source@1.
   */
  prepare?: (release: { uri: string, url?: string }) => Promise<boolean>
}

/** What a field of a plugin's settings holds. A `secret` is drawn as a password input. */
export type PluginSettingKind = 'text' | 'url' | 'secret'

/** One value a plugin asks the viewer for. `label` is shown as written, so it is the plugin's own words. */
export type PluginSettingField = { key: string, label: string, kind: PluginSettingKind, required?: boolean }

/** What the viewer entered, by field key. A field left empty is not there. */
export type PluginValues = Record<string, string>

/**
 * What a package asks the viewer for, beside `origin` on a single source or beside `sources` on a family, so one form
 * serves the whole connection. Optional and additive to stub-source@1: a package without it connects as before and
 * shows no form.
 */
export type PluginSettings = {
  /** The fields Settings shows on the package's row. A malformed or repeated one is dropped on its own. */
  settings?: PluginSettingField[]
  /**
   * Take the viewer's values: on every connection, before the package's sources are asked anything, and at once when
   * the viewer saves. The first call may hold no values at all, and a required field left empty stays out of them, so
   * a package answers what it can without it. Stub waits 3 s at most, and a rejection changes nothing.
   */
  configure?: (values: PluginValues) => Promise<void>
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
export type StubPluginAPI = (StubSource | { sources: StubSource[] }) & PluginSettings

export const STUB_SOURCE_PROTOCOL = 'stub-source@1'
