// Stub's text in the viewer's language. The English in the code is each message's key, src/locales/<tag>.json holds
// each other language's text by that key, and scripts/i18n-check.mjs keeps the two in step (`npm run i18n:check`).

import type { ComponentChildren, VNode } from 'preact'

import IntlMessageFormat from 'intl-messageformat'

import { formatLocale, isRightToLeft, uiLanguage } from './languages'

export { LANGUAGE_KEY, OFFERED, bestLanguage, contentLanguage, formatLocale, isRightToLeft, readPickedLanguage, uiLanguage } from './languages'

declare const marked: unique symbol

/** A message's key marked by msg(), which t() accepts where it refuses a plain string. */
export type Message = string & { readonly [marked]: true }

/** A language's text by message key. */
export type Catalogue = Readonly<Record<string, string>>

type Value = string | number | bigint | boolean | null | undefined | Date
type RichValue = Value | VNode | ((chunks: (string | VNode)[]) => ComponentChildren)
type Values = Readonly<Record<string, RichValue>>
type Untyped = (message: string, values?: Values, context?: string) => ComponentChildren

// a literal or a msg() value, never the plain `string` that text built at runtime has
type Source<M extends string> = string extends M ? Message : M

/**
 * The text `message` reads in the language shown, ICU MessageFormat in both: `{x}` shows the value as given, `#` and
 * `{x, number}` are written in the language, and `plural` and `select` pick their branch. A value or a `<tag>` handler
 * may be an element, and the text then comes back as children. `context` tells apart two messages spelled alike.
 * Never at module scope: a module runs before the catalogue has loaded.
 */
export type Translate = {
  <M extends string>(message: M & Source<M>, values?: Readonly<Record<string, Value>>, context?: string): string
  <M extends string>(message: M & Source<M>, values: Readonly<Record<string, RichValue>>, context?: string): ComponentChildren
}

// gettext's separator, so a context never collides with a message's own text
const keyOf = (text: string, context?: string) => context === undefined ? text : `${context}\u0004${text}`

/** Marks `text` as a message, for a table read at render: t() translates the value where it is shown. */
export const msg = <M extends string>(text: M & (string extends M ? never : M), context?: string) => keyOf(text, context) as Message

// first strong isolate and pop directional isolate, so a Latin title keeps its own order inside a right to left sentence
const isolated = (values: Values) =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === 'string' ? `\u2068${value}\u2069` : value]))

type Options = { language: string, locale: string, catalogue: Catalogue }

const build = ({ language, locale, catalogue }: Options): Untyped => {
  const englishLocale = language === 'en' ? locale : 'en'
  const rightToLeft = isRightToLeft(language)
  const translations = new Map<string, IntlMessageFormat | null>()
  const sources = new Map<string, IntlMessageFormat | null>()
  const compiled = (cache: Map<string, IntlMessageFormat | null>, key: string, text: string | undefined, locale: string) => {
    if (text === undefined) return null
    let formatter = cache.get(key)
    if (formatter === undefined) {
      try { formatter = new IntlMessageFormat(text, locale) } catch { formatter = null }
      cache.set(key, formatter)
    }
    return formatter
  }
  const formatted = (formatter: IntlMessageFormat | null, values: Values | undefined) => {
    try { return formatter?.format<VNode>(values as Record<string, Value | VNode>) } catch { return undefined }
  }
  return (message, values, context) => {
    const key = keyOf(message, context)
    const english = key.slice(key.lastIndexOf('\u0004') + 1)
    const shown = values && rightToLeft ? isolated(values) : values
    return formatted(compiled(translations, key, catalogue[key], locale), shown)
      ?? formatted(compiled(sources, key, english, englishLocale), shown)
      ?? english
  }
}

/**
 * A t() for `language`: its catalogue's text, numbers and plurals written as `locale` writes them. A key the catalogue
 * lacks, a translation that does not parse, or a value missing renders the English, and the message's own text when
 * the English cannot be formatted either.
 */
export const translator = build as (options: Options) => Translate

let current = build({ language: 'en', locale: 'en', catalogue: {} })

/** The text `message` reads in the language this page shows; see Translate. */
export const t = ((message, values, context) => current(message, values, context)) as Untyped as Translate

// one chunk per language, by its path as the pattern writes it; English has none, its text being the code's
const CATALOGUES = import.meta.glob<Catalogue>('../locales/*.json', { import: 'default' })

/**
 * Shows `language` on this page from now on: loads its catalogue, points t() at it and marks `<html>` with its `lang`
 * and, right to left, its `dir`. A catalogue that fails to load leaves the page in English until the next load.
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
  current = build({ language: shown, locale: formatLocale(shown, languages), catalogue: catalogue ?? {} })
  if (!html) return
  html.lang = shown
  if (isRightToLeft(shown)) html.dir = 'rtl'
  else html.removeAttribute('dir')
}
