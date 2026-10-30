// every source tags a native title `jp`, a Chinese or Korean work's too: kana alone tells Japanese and Hangul Korean,
// so a title in Han characters alone keeps the page's lang rather than a guess
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
const HANGUL = /\p{Script=Hangul}/u

/**
 * A title's language as stub's sources tag it (`jp` a native title, `jp-en` its romaji, `en`), as the BCP 47 tag its
 * `lang` attribute takes, so a Chinese page draws a Japanese title with Japanese glyphs. Undefined when the tag names
 * no language, or a native title's script does not tell it.
 */
export const titleLanguage = ({ language, title }: { language?: string | null, title: string }): string | undefined => {
  if (!language) return undefined
  if (language === 'jp') return KANA.test(title) ? 'ja' : HANGUL.test(title) ? 'ko' : undefined
  try { return new Intl.Locale(language === 'jp-en' ? 'ja-Latn' : language).baseName } catch { return undefined }
}
