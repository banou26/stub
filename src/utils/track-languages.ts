import type { TrackPreferences } from '@banou/media-player/language'

import { contentLanguage } from '../i18n/languages'
import { settings } from '../settings-store'

/**
 * The settings a player starts its audio and subtitles in, set in Settings, Playback, and by a pick in a player, which
 * writes the language it reported: Automatic is no value, `original` the audio a media was made in, `off` subtitles
 * off. Always show subtitles is `on` or no value. They follow the FKN account (src/settings-sync.ts), and the watch page
 * hands them to the embed, where the player runs and tells the page each pick (src/embed-languages.ts).
 */
export const AUDIO_LANGUAGE_KEY = 'stub.player.audio-language'
export const SUBTITLE_LANGUAGE_KEY = 'stub.player.subtitle-language'
export const ALWAYS_SUBTITLES_KEY = 'stub.player.always-subtitles'
export const ORIGINAL = 'original'
export const OFF = 'off'
export const ON = 'on'

/** What a player starts in, as `startingTracks` takes it: Automatic is `language`, Original no audio, off null. */
export type TrackLanguages = TrackPreferences

/** The settings kept, or those `read` holds under the same keys, with Automatic as `language`. */
export const readTrackLanguages = (
  read: (key: string) => string | null = key => settings.getItem(key),
  language = contentLanguage(),
): TrackLanguages => {
  const audio = read(AUDIO_LANGUAGE_KEY)
  const subtitles = read(SUBTITLE_LANGUAGE_KEY)
  return {
    audio: audio === ORIGINAL ? undefined : audio ?? language,
    subtitles: subtitles === OFF ? null : subtitles ?? language,
    alwaysSubtitles: read(ALWAYS_SUBTITLES_KEY) === ON,
  }
}

// each write names its key, so the privacy page's scan of src (tests/unit/router/privacy-stored-data.test.ts) finds it
/** Keeps an audio language as `onPreferredAudioLanguageChange` reports it or Settings sets it, undefined for Automatic. */
export const keepAudioLanguage = (language: string | undefined) => {
  try {
    if (language === undefined) settings.removeItem(AUDIO_LANGUAGE_KEY)
    else settings.setItem(AUDIO_LANGUAGE_KEY, language)
  } catch {}
}

/** As keepAudioLanguage, for subtitles, null for off. */
export const keepSubtitleLanguage = (language: string | null | undefined) => {
  try {
    if (language === undefined) settings.removeItem(SUBTITLE_LANGUAGE_KEY)
    else settings.setItem(SUBTITLE_LANGUAGE_KEY, language ?? OFF)
  } catch {}
}

/** Keeps whether subtitles show when the audio plays in their language. */
export const keepAlwaysSubtitles = (on: boolean) => {
  try {
    if (on) settings.setItem(ALWAYS_SUBTITLES_KEY, ON)
    else settings.removeItem(ALWAYS_SUBTITLES_KEY)
  } catch {}
}

/** Calls `listener` whenever one of these settings changes, here, in another tab or on the account. Returns the stop. */
export const watchTrackLanguages = (listener: () => void): () => void => {
  const stops = [AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, ALWAYS_SUBTITLES_KEY].map(key => settings.watch(key, listener))
  return () => { for (const stop of stops) stop() }
}
