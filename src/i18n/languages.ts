// The viewer's language, the one picked in Settings (a setting that follows the FKN account, src/settings-store.ts)
// else the browser's, read three ways: the language stub's text is shown in, how dates and numbers are written, and
// the language content is wanted in. Import free but the settings store and the offered list, so the page, the
// worker and src/viewer-languages.ts share it.

import OFFERED_LANGUAGES from './offered.json'
import { settings } from '../settings-store'

/** The setting holding the language picked in Settings, an offered tag. No value is Automatic. */
export const LANGUAGE_KEY = 'stub.language'

/** The languages stub's text is offered in, each but English with a complete catalogue in src/locales. */
export const OFFERED: readonly string[] = OFFERED_LANGUAGES

// a fixed list rather than Intl.Locale's text info, which Firefox lacks
const RIGHT_TO_LEFT = new Set(['ar', 'ckb', 'dv', 'fa', 'he', 'ps', 'sd', 'ug', 'ur', 'yi'])

const browserLanguages = (): readonly string[] => globalThis.navigator?.languages ?? []

const localeOf = (tag: string) => {
  try { return new Intl.Locale(tag) } catch { return undefined }
}

/** Whether `tag`'s language is written right to left. */
export const isRightToLeft = (tag: string) => RIGHT_TO_LEFT.has(localeOf(tag)?.language ?? '')

/**
 * The offered tag serving the first of `wanted` that any serves: matched exactly, else by language and script once
 * maximized (`zh-TW` finds `zh-Hant`, `pt-PT` finds `pt-BR`, `es-MX` finds `es-419`), else by language alone.
 * Undefined when none is served.
 */
export const bestLanguage = (wanted: readonly string[], offered: readonly string[]): string | undefined => {
  const candidates = offered.flatMap(tag => {
    const locale = localeOf(tag)
    if (!locale) return []
    const { language, script } = locale.maximize()
    return [{ tag, exact: locale.baseName, language, script }]
  })
  for (const tag of wanted) {
    const locale = localeOf(tag)
    if (!locale) continue
    const { language, script } = locale.maximize()
    const hit = candidates.find(candidate => candidate.exact === locale.baseName)
      ?? candidates.find(candidate => candidate.language === language && candidate.script === script)
      ?? candidates.find(candidate => candidate.language === language)
    if (hit) return hit.tag
  }
  return undefined
}

/** The language picked in Settings, or undefined for Automatic, a language not offered, or no storage. */
export const readPickedLanguage = (): string | undefined => {
  const kept = settings.getItem(LANGUAGE_KEY)
  return kept && OFFERED.includes(kept) ? kept : undefined
}

/** The language stub's text is shown in: the one picked, else the offered one best serving the browser's, else English. */
export const uiLanguage = (languages = browserLanguages(), offered = OFFERED) =>
  readPickedLanguage() ?? bestLanguage(languages, offered) ?? 'en'

/**
 * The locale dates, numbers and lists are written in: the browser's first language in `shown`'s language and
 * script, as it writes it, so an en-GB browser keeps 26/10/2026 and es-MX keeps 1,234.5; else `shown` itself.
 */
export const formatLocale = (shown = uiLanguage(), languages = browserLanguages()) => {
  const { language, script } = localeOf(shown)?.maximize() ?? {}
  return languages.find(tag => {
    const locale = localeOf(tag)?.maximize()
    return !!locale && locale.language === language && locale.script === script
  }) ?? shown
}

/** The language content is wanted in: the one picked, else the browser's first whatever it is, as it writes it (`fr-CA`), else English. */
export const contentLanguage = (languages: readonly string[] | undefined = browserLanguages()) =>
  readPickedLanguage() ?? languages?.[0] ?? 'en'
