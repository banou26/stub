// The languages a source added in Settings is handed (src/plugin-api.ts): the page reads them, and the worker holds
// what the page hands it, as it holds the country (src/sources/country.ts).

import type { ViewerLanguages } from './plugin-api'

import { languageTag } from '@banou/media-player/language'

import { contentLanguage, LANGUAGE_KEY } from './i18n/languages'
import { settings } from './settings-store'
import { ALWAYS_SUBTITLES_KEY, AUDIO_LANGUAGE_KEY, OFF, ON, ORIGINAL, SUBTITLE_LANGUAGE_KEY } from './utils/track-languages'

/**
 * The content language, the audio and subtitle languages picked in Settings or a player as tags, and Always show
 * subtitles. Automatic, Original and a pick naming no language are left out of the tags, Original being
 * `originalAudio` and a subtitle track's title `titledSubtitles`.
 */
export const viewerLanguages = (): ViewerLanguages => {
  const audio = settings.getItem(AUDIO_LANGUAGE_KEY)
  const subtitles = settings.getItem(SUBTITLE_LANGUAGE_KEY)
  const audioTag = languageTag(audio ?? undefined)
  const subtitleTag = subtitles === OFF ? null : languageTag(subtitles ?? undefined)
  return {
    language: contentLanguage(),
    ...audioTag ? { audio: audioTag } : {},
    ...subtitleTag !== undefined ? { subtitles: subtitleTag } : {},
    alwaysSubtitles: settings.getItem(ALWAYS_SUBTITLES_KEY) === ON,
    ...audio === ORIGINAL ? { originalAudio: true } : {},
    ...subtitles && subtitleTag === undefined ? { titledSubtitles: true } : {},
  }
}

/**
 * Calls `listener` whenever the language picked in Settings, a picked audio or subtitle language, or Always show
 * subtitles changes, here, in another tab or on the account. Returns the stop.
 */
export const watchViewerLanguages = (listener: () => void): () => void => {
  const stops = [LANGUAGE_KEY, AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, ALWAYS_SUBTITLES_KEY].map(key => settings.watch(key, listener))
  return () => { for (const stop of stops) stop() }
}

let held: ViewerLanguages | undefined

/** Holds the viewer's languages in a realm with no settings of its own, the worker. */
export const holdViewerLanguages = (languages: ViewerLanguages) => { held = languages }

/** The languages held, else the browser's alone. */
export const heldViewerLanguages = (): ViewerLanguages => held ?? { language: contentLanguage() }
