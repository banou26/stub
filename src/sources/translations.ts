// A show's title and synopsis in the viewer's language, where a source has them. A translated title ranks a
// tenth of its source's score and nothing compares it, so the stored order, every merge and every link a source makes
// stay the same whatever the viewer's language; only the worker's field resolvers put the viewer's language first.

import { bestLanguage, localeOf } from '../i18n/best-language'

const classOf = (title: object) => ('class' in title && title.class) || 'MAIN'

/** A source's title for the work in another language than its own: at a tenth of `score`, its main titles' score. */
export const translatedTitle = (language: string, title: string, score: number) =>
  ({ language, title, score: score / 10, class: 'TRANSLATED' as const })

/** The titles matching, merging and asking a catalogue read: every one but a translation. */
export const mainTitles = <T extends object>(titles: readonly T[] | null | undefined): T[] =>
  (titles ?? []).filter(title => classOf(title) === 'MAIN')

const inLanguage = <T extends { language: string }>(values: readonly T[], language: string) => {
  const tag = bestLanguage([language], [...new Set(values.map(value => value.language))])
  return tag ? values.filter(value => value.language === tag) : []
}

// No source translates into Japanese: a Japanese viewer reads a show's own Japanese title, AniDB's `ja` or the native
// title every other source tags `jp`. That tag is a Chinese or Korean work's native title too, so not one in Hangul.
const HANGUL = /\p{Script=Hangul}/u
const japanese = (title: { language: string, title?: string }) =>
  title.language === 'ja' || (title.language === 'jp' && !HANGUL.test(title.title ?? ''))

/**
 * `titles` with the best translation in `language` first and the rest as they are, or for a viewer reading Japanese
 * the show's own Japanese title first, or `titles` when it has neither.
 */
export const translationFirst = <T extends { language: string, title?: string }>(titles: T[], language: string): T[] => {
  const [translation] = inLanguage(titles.filter(title => classOf(title) === 'TRANSLATED'), language)
  const first = translation ?? (localeOf(language)?.language === 'ja' ? titles.find(japanese) : undefined)
  return first ? [first, ...titles.filter(title => title !== first)] : titles
}

/**
 * The synopses in `language` when any is, else every one. The first stands in for the synopsis leading every language,
 * at its score, which the home hero reads as how well sourced the show is (src/utils/theater.ts `fromGoodSource`).
 */
export const synopsesIn = <T extends { language: string, score?: number | null }>(synopses: T[], language: string): T[] => {
  const [first, ...rest] = inLanguage(synopses, language)
  return first ? [{ ...first, score: synopses[0]!.score }, ...rest] : synopses
}
