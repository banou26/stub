// The languages a source added in Settings is handed (src/plugin-api.ts): the page reads them, and the worker holds
// what the page hands it, as it holds the country (src/sources/country.ts).

import type { ViewerLanguages } from './plugin-api'

import { languageTag } from '@banou/media-player/language'

import { contentLanguage } from './i18n/languages'
import { settings } from './settings-store'
import { AUDIO_LANGUAGE_KEY, readTrackLanguages, SUBTITLE_LANGUAGE_KEY } from './utils/track-languages'

/** The content language, and the audio and subtitle languages last picked in a player as tags; a pick naming none is left out. */
export const viewerLanguages = (): ViewerLanguages => {
  const { audio, subtitles } = readTrackLanguages()
  const audioTag = languageTag(audio)
  const subtitleTag = subtitles === null ? null : languageTag(subtitles)
  return {
    language: contentLanguage(),
    ...audioTag ? { audio: audioTag } : {},
    ...subtitleTag !== undefined ? { subtitles: subtitleTag } : {},
  }
}

/** Calls `listener` whenever a picked audio or subtitle language changes, here or on the account. Returns the stop. */
export const watchViewerLanguages = (listener: () => void): () => void => {
  const stops = [AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY].map(key => settings.watch(key, listener))
  return () => { for (const stop of stops) stop() }
}

let held: ViewerLanguages | undefined

/** Holds the viewer's languages in a realm with no settings of its own, the worker. */
export const holdViewerLanguages = (languages: ViewerLanguages) => { held = languages }

/** The languages held, else the browser's alone. */
export const heldViewerLanguages = (): ViewerLanguages => held ?? { language: contentLanguage() }
