// How a source asks for a show's title and synopsis in the viewer's language, and what of its answer it keeps. Apart
// from ./translations, which the offline history's merge loads: that merge's version hashes every file it loads
// (scripts/history-files.mjs), and nothing here changes a merge.

import type { Media as GQLMedia } from '../generated/schema/types.generated'

import { localeOf } from '../i18n/best-language'
import { translatedTitle } from './translations'
import { desc } from './utils'

// Not English, the language every source is asked in already. Not Japanese, until the owner decides whether a Japanese
// viewer sees anime titles in Japanese script: JustWatch's Japanese title for Frieren is a kana reading, そうそうのフリーレン.
// Not Chinese: asked `zh`, JustWatch answers one script for a viewer reading either, and mixes them, Frieren's title
// Traditional (葬送者芙莉蓮) and its synopsis Simplified (2026-11-10).
const UNASKED = new Set(['en', 'ja', 'zh'])

// The countries TMDB keeps a translation of a language for apart from its main one's. A viewer in any other is asked
// the main one's: asked de-AT, fr-BE or es-AR, TMDB answered Breaking Bad in English though it has it in German, French
// and Spanish (2026-11-10). Spanish outside Spain is asked Mexico's, which TMDB and IMDb keep as Latin America's.
const APART: Record<string, string> = { fr: 'CA', pt: 'PT' }

/**
 * The viewer's `language` as a source is asked a translation into it, with the country the source keeps it for:
 * `fr-FR`, `fr-CA`, `de-DE` for `de-AT`, `es-MX` for `es-419`. Undefined when the language is not asked.
 */
export const askedLocale = (language: string | undefined) => {
  const locale = language ? localeOf(language)?.maximize() : undefined
  if (!locale || UNASKED.has(locale.language)) return undefined
  const { language: asked, region } = locale
  const main = localeOf(asked)!.maximize().region
  const country = region === main || region === APART[asked] ? region : asked === 'es' ? 'MX' : main
  return new Intl.Locale(asked, country ? { region: country } : {})
}

/**
 * Whether `title` has a letter of `language`'s script: a romanization into Latin letters of a language written in
 * another has none. Intl names Korean's script `Kore`, Hangul with Han, which no letter is written in, and a script
 * like it with no letters of its own (Japanese's `Jpan`) reads as written.
 */
const writtenIn = (title: string, language: string) => {
  const script = localeOf(language)?.maximize().script
  try {
    return new RegExp(`\\p{Script=${script === 'Kore' ? 'Hangul' : script}}`, 'u').test(title)
  } catch {
    return true
  }
}

/**
 * `media` with a source's `title` and `synopsis` in `language`, the synopsis at `score` and the title a tenth of it,
 * each only where it is a translation: a source answers its own text where it has none, so one the media already
 * holds is none, and neither is a title in another script than the language's, a romanization (JustWatch's Arabic and
 * Hebrew for Frieren are "Sôsô No Furîren", 2026-11-10) or a name left in its original script.
 */
export const withTranslation = (media: GQLMedia, language: string, score: number, { title, synopsis }: { title?: string | null, synopsis?: string | null }): GQLMedia => {
  const titled = title && writtenIn(title, language) && !media.titles?.some(own => own.title === title)
  const { descriptions = [], shortDescriptions = [] } = desc(synopsis, score, language)
  const described = descriptions[0] && !media.descriptions?.some(own => own.description === descriptions[0]!.description)
  return {
    ...media,
    titles: [...media.titles ?? [], ...titled ? [translatedTitle(language, title, score)] : []],
    descriptions: [...media.descriptions ?? [], ...described ? descriptions : []],
    shortDescriptions: [...media.shortDescriptions ?? [], ...described ? shortDescriptions : []],
  }
}
