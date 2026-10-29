/**
 * A title's language as stub's sources tag it (`jp` a Japanese native title, `jp-en` its romaji, `en`), as the BCP 47
 * tag its `lang` attribute takes, so a Chinese page draws a Japanese title with Japanese glyphs. Undefined when the tag
 * names no language.
 */
export const titleLanguage = (language: string | null | undefined): string | undefined => {
  if (!language) return undefined
  const tag = language === 'jp' ? 'ja' : language === 'jp-en' ? 'ja-Latn' : language
  try { return new Intl.Locale(tag).baseName } catch { return undefined }
}
