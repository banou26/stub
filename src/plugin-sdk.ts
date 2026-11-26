export type PlaybackState = {
  paused: boolean
  time: number
  rate: number
  at: number
}

export type PlaybackCorrection = {
  seek?: number
  play?: true
  pause?: true
  rate?: number
}

export type MediaChapter = {
  start: number
  end: number
  title: string
}

export type RemoteExternalSubtitleTrack = {
  id: string
  language: string
  label: string
  format: 'srt' | 'vtt' | 'ass'
  content?: string
}

/**
 * BCP 47 tags: the viewer's language, and the audio and subtitle languages picked in Settings or a player (null: off).
 * Additive to stub-source@1: a resolver gets them as `languages` in its context, and `play` with the entry.
 */
export type ViewerLanguages = {
  language: string
  audio?: string
  subtitles?: string | null
  alwaysSubtitles?: boolean
  originalAudio?: boolean
  titledSubtitles?: boolean
}

/**
 * What the viewer picked in a source's player: an audio or a subtitle language by its tag, else its track's title
 * (subtitles off: null), or `alwaysSubtitles` true for subtitles picked in the language the audio plays in.
 */
export type TrackPick = {
  audio?: string
  subtitles?: string | null
  alwaysSubtitles?: boolean
}

/** What playing a source's entries needs: nothing, an account with the source's site, or a paid plan there. */
export type SourceAccess = 'none' | 'account' | 'paid'

/** What a source says of the viewer's account with its site: signed in, signed out, or signed in with no plan. */
export type SourceAccount = 'signed-in' | 'signed-out' | 'no-plan'

/** Metadata handed to a subtitle source when stub searches or opens its subtitle picker for the playing episode. */
export type SubtitleQueryContext = {
  mediaUri: string
  episodeUri: string
  imdbId?: string
  aniId?: { providerId: 'anilist' | 'mal' | 'anidb', id: string }
  isAnime: boolean
  film: boolean
  season?: number
  episode?: number
  title?: string
  releaseName?: string
  query?: string
  preferredLanguages: string[]
  locale: string
}

/** One external subtitle track returned by a source's `findSubtitles` or `selectSubtitle`. */
export type PluginSubtitleTrack = {
  id: string
  language: string
  label: string
  format: 'srt' | 'vtt' | 'ass'
  content?: string
  url?: string
  release?: string
  group?: string
  hearingImpaired?: boolean
  downloads?: number
}

/** Visual emphasis tone for generic catalogue badges and metrics. */
export type CatalogTone = 'neutral' | 'positive' | 'warning' | 'muted'

/** Source-declared pill displayed on a catalogue item row and optionally exposed as a toggle filter. */
export type CatalogBadge = {
  id: string
  label: string
  tone?: CatalogTone
  /** When true, Stub offers a toggle chip to filter items carrying this badge `id`. */
  filterable?: boolean
}

/** Source-declared numeric attribute displayed on a catalogue item row and optionally sortable across sources. */
export type CatalogMetric = {
  id: string
  label: string
  value: number
  /** Preformatted text shown next to/instead of the numeric count; falls back to localized `value`. */
  display?: string
  /** When set, Stub adds this metric `id` to the Sort dropdown (`asc` or `desc`, missing values last). */
  sort?: 'desc' | 'asc'
  tone?: CatalogTone
}

export type CatalogActionIcon = 'copy' | 'download' | 'external' | 'info' | 'action'

/** Source-declared secondary action button rendered beside a catalogue item row. */
export type CatalogAction = {
  id: string
  label: string
  icon?: CatalogActionIcon
}

/** Generic browser outcome returned by a source's `runCatalogAction` hook. */
export type CatalogActionResult =
  | { kind: 'done', message?: string }
  | { kind: 'copy', text: string, message?: string }
  | { kind: 'download', filename: string, mimeType?: string, base64: string, message?: string }
  | { kind: 'open', url: string }
  | { kind: 'refresh', message?: string }
  | { kind: 'error', message?: string }

/** Viewer context passed to `catalogItems`. */
export type CatalogQueryContext = {
  locale?: string
}

/** Generic declarative item metadata exposed by a source for Stub's unified source catalogue. */
export type CatalogItem = {
  uri: string
  title: string
  rawTitle?: string
  subtitle?: string
  resolution?: number
  videoQualities?: string[]
  audioQualities?: string[]
  audioLanguages?: string[]
  subtitleLanguages?: string[]
  sizeBytes?: number
  sizeText?: string
  /** Unix epoch timestamp in milliseconds (`Date.now()`). */
  publishedAt?: number
  badges?: CatalogBadge[]
  metrics?: CatalogMetric[]
  actions?: CatalogAction[]
}

/** Where a source's site asks the viewer to pass a check, and what is on that page once they have. */
export type SourceCheck = { url: string, passed: string }

/** What a field of a plugin's settings holds. A `secret` is drawn as a password input. */
export type PluginSettingKind = 'text' | 'url' | 'secret'

/** One value a plugin asks the viewer for. `label` is shown as written, so it is the plugin's own words. */
export type PluginSettingField = { key: string, label: string, kind: PluginSettingKind, required?: boolean }

/** What the viewer entered, by field key. A field left empty is not there. */
export type PluginValues = Record<string, string>

/**
 * What a package asks the viewer for, beside `origin` on a single source or beside `sources` on a family,
 * so one form serves the whole connection. Optional and additive to `stub-source@1`.
 */
export type PluginSettings = {
  settings?: PluginSettingField[]
  configure?: (values: PluginValues) => Promise<void>
}

/** Source contract implementing `stub-source@1` plus additive generic catalogue and playback hooks. */
export type StubSource<TResolvers = Record<string, unknown>> = {
  /** Unique lowercase origin slug, e.g. `'myanime'`. */
  origin: string
  originUrl: string
  name: string
  icon?: string
  color?: string
  isApiOnly: boolean
  metadataOnly?: boolean
  /** Marks a source that only provides external subtitles (`findSubtitles` / `selectSubtitle`). */
  subtitlesOnly?: boolean
  /** Origins whose ids this source can be asked with when a media gains handles after subscribe time. */
  supportedUris?: readonly string[]
  resolvers?: TResolvers
  /** Search for external subtitles matching the current episode/film or explicit viewer `query`. */
  findSubtitles?: (context: SubtitleQueryContext) => Promise<PluginSubtitleTrack[]>
  /** Lazy-load subtitle file text for a `PluginSubtitleTrack` id when neither `content` nor `url` was returned upfront. */
  loadSubtitle?: (trackId: string) => Promise<string>
  /** Open the plugin's own subtitle picker UI and resolve with picked track(s) or null if cancelled. */
  selectSubtitle?: (context: SubtitleQueryContext) => Promise<PluginSubtitleTrack[] | PluginSubtitleTrack | null>
  /** Return generic metadata, filterable badges, sortable metrics, and custom actions for URIs owned by `origin`. */
  catalogItems?: (uris: string[], context?: CatalogQueryContext) => Promise<CatalogItem[]>
  /** Run a declarative item action declared in `CatalogItem.actions`. */
  runCatalogAction?: (uri: string, actionId: string) => Promise<CatalogActionResult | null>
  /** Render this source's own picker for legacy sources that do not implement `catalogItems`. */
  selectRelease?: (uris: string[], options?: { playing?: string }) => Promise<string | null>
  /**
   * Play an entry inside the package's own frame, resolving true once its player is up.
   *
   * Declaring this makes a source self-playing: stub mounts the package into its player area and calls this on
   * that connection, without learning how the source plays anything.
   */
  play?: (item: { uri: string, url?: string, languages?: ViewerLanguages }) => Promise<boolean>
  /** Report playback transitions and heartbeats from a framed source player. */
  onPlayback?: (listener: (state: PlaybackState & {
    ended?: boolean
    duration?: number
    chapters?: MediaChapter[]
    endingOffered?: boolean
    picked?: TrackPick
    autoplayNext?: boolean
    seeking?: boolean
    readyState?: number
  }) => void) => Promise<void>
  /** Synchronize a framed source player to `state`. */
  applyPlayback?: (state: PlaybackState & { exact?: PlaybackCorrection }) => Promise<void>
  /** Read buffered ranges and player readiness for watch party sync. */
  buffer?: () => Promise<{ time: number, readyState: number, ranges: [number, number][] } | undefined>
  /** Whether playing this source's entries needs an account (`'account'`) or paid plan (`'paid'`). */
  access?: SourceAccess
  /** Current account state for this source's site. */
  account?: () => Promise<SourceAccount>
  /** Intercept fullscreen toggles to hand fullscreen management to stub's outer container. */
  onFullscreenRequest?: (listener: () => void) => Promise<void>
  /** Notify the player when stub's outer fullscreen container enters or leaves fullscreen. */
  applyFullscreen?: (active: boolean) => Promise<void>
  /** Forward keyboard focus into the framed player document. */
  focus?: () => Promise<void>
  /** Control Skip Ending prompt visibility inside a framed player. */
  offerEnding?: (offered: boolean) => Promise<void>
  /** Mirror the viewer's Autoplay next episode setting on a framed player. */
  applyAutoplay?: (on: boolean) => Promise<void>
  /** Show previous and next episode buttons on a framed player. */
  applyEpisodeNavigation?: (navigation: { previous?: string | boolean, next?: string | boolean }) => Promise<void>
  /** Hear clicks on the framed player's previous/next episode controls. */
  onEpisodeNavigation?: (listener: (direction: 'previous' | 'next') => void) => Promise<void>
  /** Show or hide the source switcher control on a framed player. */
  applySourceSwitch?: (value: string | boolean) => Promise<void>
  /** Hear clicks on the framed player's source switcher control. */
  onSourceSwitch?: (listener: () => void) => Promise<void>
  /** Offer external subtitle tracks in a framed player's subtitle menu. */
  applyExternalSubtitles?: (tracks: RemoteExternalSubtitleTrack[]) => Promise<void>
  /** Hear on-demand subtitle load requests from a framed player. */
  onSubtitleLoadRequest?: (listener: (trackId: string) => void) => Promise<void>
  /** Deliver loaded subtitle content (or error) to a framed player. */
  provideExternalSubtitle?: (trackId: string, content: string | null, error?: string) => Promise<void>
  /** Show or hide the subtitle browser trigger on a framed player. */
  applyBrowseSubtitles?: (value: string | boolean) => Promise<void>
  /** Hear clicks on the framed player's subtitle browser trigger. */
  onBrowseSubtitles?: (listener: () => void) => Promise<void>
  /** Activate an external subtitle track by id on a framed player. */
  selectExternalSubtitle?: (trackId: string) => Promise<void>
  /** Prefetch the upcoming item before playback reaches the next episode. */
  prepare?: (item: { uri: string, url?: string }) => Promise<boolean>
  /** Request an interactive browser verification check on the source's own host. */
  check?: () => Promise<SourceCheck | null>
  /** Notify the source after the viewer completes or dismisses its verification check. */
  checkDone?: () => Promise<void>
}

/** Package entrypoint shape exported for `attach` / `serve`: one source or a `sources` family plus settings. */
export type StubPlugin<TResolvers = Record<string, unknown>> =
  (StubSource<TResolvers> | { sources: StubSource<TResolvers>[] }) & PluginSettings

export const STUB_SOURCE_PROTOCOL = 'stub-source@1'

/** Identity helper giving source authors typed `StubSource` authoring with zero runtime overhead. */
export const defineStubSource = <TResolvers = Record<string, unknown>>(source: StubSource<TResolvers>): StubSource<TResolvers> => source

/** Identity helper giving plugin packages typed `StubPlugin` authoring with zero runtime overhead. */
export const defineStubPlugin = <TResolvers = Record<string, unknown>>(plugin: StubPlugin<TResolvers>): StubPlugin<TResolvers> => plugin
