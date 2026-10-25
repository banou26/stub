import { settings } from '../settings-store'

/**
 * The settings holding the audio and subtitle languages the viewer last picked in a player, as the player reported
 * them, `off` for subtitles turned off. They follow the FKN account (src/settings-sync.ts), so the watch page keeps
 * them: the player runs in the embed, which hands each pick to the page (src/embed-languages.ts).
 */
export const AUDIO_LANGUAGE_KEY = 'stub.player.audio-language'
export const SUBTITLE_LANGUAGE_KEY = 'stub.player.subtitle-language'
const OFF = 'off'

/** As `preferredSelection` takes them: subtitles null for off, and a language undefined when none was picked. */
export type TrackLanguages = { audio?: string, subtitles?: string | null }

/** The languages kept, or those `read` holds under the same keys. */
export const readTrackLanguages = (read: (key: string) => string | null = key => settings.getItem(key)): TrackLanguages => {
  const subtitles = read(SUBTITLE_LANGUAGE_KEY)
  return { audio: read(AUDIO_LANGUAGE_KEY) ?? undefined, subtitles: subtitles === OFF ? null : subtitles ?? undefined }
}

/** Keeps an audio language the viewer picked, as `onPreferredAudioLanguageChange` reports it. */
export const keepAudioLanguage = (language: string) => {
  try { settings.setItem(AUDIO_LANGUAGE_KEY, language) } catch {}
}

/** As keepAudioLanguage, for subtitles, null for off. */
export const keepSubtitleLanguage = (language: string | null) => {
  try { settings.setItem(SUBTITLE_LANGUAGE_KEY, language ?? OFF) } catch {}
}
