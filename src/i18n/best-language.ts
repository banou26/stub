// Import free, so a source's extractor can match a language without loading the settings store: scripts/offline-pick.ts
// runs ani.zip's at build time, and every file it loads is part of the offline history's merge version.

/** `tag` as an Intl.Locale, or undefined when it names no language (`x-jat`, `not a tag`). */
export const localeOf = (tag: string) => {
  try { return new Intl.Locale(tag) } catch { return undefined }
}

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
