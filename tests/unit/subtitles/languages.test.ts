import { describe, expect, test } from 'vite-plus/test'

import { normalizeSubtitleLanguage, subtitleLanguageLabel } from '../../../src/subtitles/languages'

describe('normalizeSubtitleLanguage', () => {
  test('normalizes Stremio OpenSubtitles ISO 639-2 codes and regional aliases', () => {
    expect(normalizeSubtitleLanguage('eng')).toBe('en')
    expect(normalizeSubtitleLanguage('fre')).toBe('fr')
    expect(normalizeSubtitleLanguage('ger')).toBe('de')
    expect(normalizeSubtitleLanguage('cze')).toBe('cs')
    expect(normalizeSubtitleLanguage('slo')).toBe('sk')
    expect(normalizeSubtitleLanguage('pob')).toBe('pt-BR')
    expect(normalizeSubtitleLanguage('spl')).toBe('es-419')
  })

  test('normalizes Simplified and Traditional Chinese tags and labels', () => {
    expect(normalizeSubtitleLanguage('zho')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('chi')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('zh')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('chs')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('简体')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('双语')).toBe('zh-Hans')
    expect(normalizeSubtitleLanguage('zht')).toBe('zh-Hant')
    expect(normalizeSubtitleLanguage('cht')).toBe('zh-Hant')
    expect(normalizeSubtitleLanguage('繁体')).toBe('zh-Hant')
  })

  test('falls back to und on empty or unrecognized input', () => {
    expect(normalizeSubtitleLanguage('')).toBe('und')
    expect(normalizeSubtitleLanguage(null)).toBe('und')
    expect(normalizeSubtitleLanguage('invalid-token-999')).toBe('und')
  })
})

describe('subtitleLanguageLabel', () => {
  test('formats readable names using the requested locale', () => {
    expect(subtitleLanguageLabel('eng', 'en')).toBe('English')
    expect(subtitleLanguageLabel('pob', 'en')).toContain('Portuguese')
    expect(subtitleLanguageLabel('und', 'en')).toBe('Unknown')
  })
})
