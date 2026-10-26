// Stub's text in the viewer's language, through react-intl. Each message is written in the code in English, its
// defaultMessage, with that English as its id (`formatjs/enforce-id` with `[content]`, vite.config.ts, writes it), so
// English loads no catalogue; src/locales/<tag>.json holds each other language's text by id, and
// `npm run i18n:check` keeps the two in step.

import { createIntl, createIntlCache, type IntlShape } from 'react-intl'

import { formatLocale, isRightToLeft, uiLanguage } from './languages'

export { LANGUAGE_KEY, OFFERED, bestLanguage, contentLanguage, formatLocale, isRightToLeft, readPickedLanguage, uiLanguage } from './languages'

/** A language's text by message id. */
export type Catalogue = Readonly<Record<string, string>>

const cache = createIntlCache()

// the English is formatted in the browser's own English when that is what is shown, else in plain `en`
const intlOf = (language: string, locale: string, messages: Catalogue) =>
  createIntl({ locale, defaultLocale: language === 'en' ? locale : 'en', messages }, cache)

/**
 * The page's react-intl object, which RawIntlProvider hands to every component's useIntl(), for text written outside
 * a component. startLanguage() replaces it, so read it where the text is shown, never at module scope.
 */
export let intl: IntlShape = intlOf('en', 'en', {})

// one chunk per language, by its path as the pattern writes it
const CATALOGUES = import.meta.glob<Catalogue>('../locales/*.json', { import: 'default' })

/**
 * Shows `language` on this page from now on: loads its catalogue, makes `intl` write in it, with dates and numbers in
 * formatLocale(), and marks `<html>` with its `lang` and, right to left, its `dir`. A catalogue that fails to load
 * leaves the page in English until the next load. Returns the new `intl`.
 */
export const startLanguage = async ({ language = uiLanguage(), languages, catalogues = CATALOGUES, html = globalThis.document?.documentElement }: {
  language?: string
  /** The browser's languages, which formatLocale() reads. */
  languages?: readonly string[]
  /** Each catalogue's loader by its path, `../locales/<tag>.json`. */
  catalogues?: Readonly<Record<string, () => Promise<Catalogue>>>
  html?: HTMLElement
} = {}) => {
  const catalogue = language === 'en' ? {} : await catalogues[`../locales/${language}.json`]?.().catch(() => undefined)
  const shown = catalogue ? language : 'en'
  intl = intlOf(shown, formatLocale(shown, languages), catalogue ?? {})
  if (html) {
    html.lang = shown
    if (isRightToLeft(shown)) html.dir = 'rtl'
    else html.removeAttribute('dir')
  }
  return intl
}
