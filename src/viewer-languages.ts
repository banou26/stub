// The languages a source added in Settings is handed (src/plugin-api.ts): the page reads them, and the worker holds
// what the page hands it, as it holds the country (src/sources/country.ts).

import type { ViewerLanguages } from './plugin-api'

import { languageTag } from '@banou/media-player/language'

import { contentLanguage, LANGUAGE_KEY } from './i18n/languages'
import { settings } from './settings-store'
import { AUDIO_LANGUAGE_KEY, OFF, SUBTITLE_LANGUAGE_KEY } from './utils/track-languages'

/**
 * The content language, and the audio and subtitle languages picked in Settings or a player as tags. Automatic,
 * Original and a pick naming no language are left out.
 */
export const viewerLanguages = (): ViewerLanguages => {
  const subtitles = settings.getItem(SUBTITLE_LANGUAGE_KEY)
  const audioTag = languageTag(settings.getItem(AUDIO_LANGUAGE_KEY) ?? undefined)
  const subtitleTag = subtitles === OFF ? null : languageTag(subtitles ?? undefined)
  return {
    language: contentLanguage(),
    ...audioTag ? { audio: audioTag } : {},
    ...subtitleTag !== undefined ? { subtitles: subtitleTag } : {},
  }
}

/**
 * Calls `listener` whenever the language picked in Settings, or a picked audio or subtitle language, changes, here, in
 * another tab or on the account. Returns the stop.
 */
export const watchViewerLanguages = (listener: () => void): () => void => {
  const stops = [LANGUAGE_KEY, AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY].map(key => settings.watch(key, listener))
  return () => { for (const stop of stops) stop() }
}

let held: ViewerLanguages | undefined

/** Holds the viewer's languages in a realm with no settings of its own, the worker. */
export const holdViewerLanguages = (languages: ViewerLanguages) => { held = languages }

/** The languages held, else the browser's alone. */
export const heldViewerLanguages = (): ViewerLanguages => held ?? { language: contentLanguage() }
