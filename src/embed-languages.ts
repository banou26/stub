/**
 * The audio and subtitle languages the viewer last picked (./utils/track-languages.ts), between the watch page
 * that keeps them on the FKN account and stub's own embed, where the player runs and no account sync does.
 *
 * The page hands them to the embed in its url, under their setting keys, and the embed tells the page each
 * language the viewer picks there. Only this app's origin is heard or sent to, as in ./embed-title.ts.
 */
import type { TrackKind } from './embed-tracks'

import { settings } from './settings-store'
import { AUDIO_LANGUAGE_KEY, keepAudioLanguage, keepSubtitleLanguage, readTrackLanguages, SUBTITLE_LANGUAGE_KEY, type TrackLanguages } from './utils/track-languages'

const PICKED = 'stub:embed-language-picked'

/** On the watch page: the embed url parameters handing over the languages kept. */
export const trackLanguagesParams = (): Record<string, string> => Object.fromEntries(
  [AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY].flatMap(key => {
    const value = settings.getItem(key)
    return value === null ? [] : [[key, value]]
  }),
)

/** In the embed: the languages its url hands over. */
export const trackLanguagesOf = (params: URLSearchParams): TrackLanguages => readTrackLanguages(key => params.get(key))

/** On the watch page: keeps each language the embed in `iframe` says the viewer picked. Returns the stop. */
export const hearTrackLanguages = (iframe: HTMLIFrameElement, host: Window = window) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, kind, language } = (event.data ?? {}) as { type?: unknown, kind?: unknown, language?: unknown }
    if (type !== PICKED) return
    if (kind === 'audio' && typeof language === 'string') keepAudioLanguage(language)
    if (kind === 'subtitles' && (typeof language === 'string' || language === null)) keepSubtitleLanguage(language)
  }
  host.addEventListener('message', receive)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: tells the page that frames it the language the viewer picked for `kind`, null for subtitles off. */
export const tellTrackLanguage = (kind: TrackKind, language: string | null, host: Window = window) => {
  if (host.parent !== host) host.parent.postMessage({ type: PICKED, kind, language }, host.location.origin)
}
