import { languageTag } from '@banou/media-player/language'

const SUBTITLE_LANGUAGE_ALIASES: Record<string, string> = {
  pob: 'pt-BR',
  spl: 'es-419',
  zho: 'zh-Hans',
  chi: 'zh-Hans',
  zh: 'zh-Hans',
  'zh-cn': 'zh-Hans',
  'zh-sg': 'zh-Hans',
  chs: 'zh-Hans',
  sc: 'zh-Hans',
  '简体': 'zh-Hans',
  '简中': 'zh-Hans',
  '双语': 'zh-Hans',
  '默认': 'zh-Hans',
  zht: 'zh-Hant',
  cht: 'zh-Hant',
  tc: 'zh-Hant',
  'zh-tw': 'zh-Hant',
  'zh-hk': 'zh-Hant',
  '繁体': 'zh-Hant',
  '繁中': 'zh-Hant',
  '英文': 'en',
  '日文': 'ja',
  '韩文': 'ko',
}

export function normalizeSubtitleLanguage(raw: string | undefined | null): string {
  if (!raw) return 'und'
  const trimmed = raw.trim()
  if (!trimmed) return 'und'
  const lower = trimmed.toLowerCase()
  const directAlias = SUBTITLE_LANGUAGE_ALIASES[lower] ?? SUBTITLE_LANGUAGE_ALIASES[trimmed]
  if (directAlias) return directAlias

  const normalized = languageTag(trimmed)
  if (!normalized || normalized === 'und') return 'und'
  if (normalized === 'zh') return 'zh-Hans'
  return normalized
}

export function languagePreferenceIndex(language: string, preferred: readonly string[]): number {
  const exact = preferred.indexOf(language)
  if (exact !== -1) return exact * 2
  const base = language.split('-')[0]
  const baseIdx = preferred.findIndex(pref => pref.split('-')[0] === base)
  return baseIdx !== -1 ? baseIdx * 2 + 1 : preferred.length * 2
}

export function subtitleLanguageLabel(tag: string, locale = 'en'): string {
  const normalized = normalizeSubtitleLanguage(tag)
  if (normalized === 'und') return 'Unknown'
  try {
    const display = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(normalized)
    if (display) return display
  } catch {
    // Ignore malformed tags and fall back to the normalized tag below.
  }
  return normalized.toUpperCase()
}
