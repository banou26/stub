/**
 * Where the audio and subtitle languages the viewer last picked in a player are kept, in localStorage as the volume
 * is: the player runs in the embed's document, where no account sync does.
 */
export const AUDIO_LANGUAGE_KEY = 'stub.player.audio-language'
export const SUBTITLE_LANGUAGE_KEY = 'stub.player.subtitle-language'
const OFF = 'off'

/** As `preferredSelection` takes them: subtitles null for off, and a language undefined when none was picked. */
export type TrackLanguages = { audio?: string, subtitles?: string | null }

const read = (key: string) => {
  try {
    return globalThis.localStorage.getItem(key)
  } catch {
    return null
  }
}

export const readTrackLanguages = (): TrackLanguages => {
  const subtitles = read(SUBTITLE_LANGUAGE_KEY)
  return { audio: read(AUDIO_LANGUAGE_KEY) ?? undefined, subtitles: subtitles === OFF ? null : subtitles ?? undefined }
}

/** Keeps a language the player reported the viewer picked, as `onPreferredAudioLanguageChange` reports it. */
export const keepAudioLanguage = (language: string) => {
  try {
    globalThis.localStorage.setItem(AUDIO_LANGUAGE_KEY, language)
  } catch {}
}

/** As keepAudioLanguage, for subtitles, null for off. */
export const keepSubtitleLanguage = (language: string | null) => {
  try {
    globalThis.localStorage.setItem(SUBTITLE_LANGUAGE_KEY, language ?? OFF)
  } catch {}
}
