import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { bestLanguage, contentLanguage, formatLocale, isRightToLeft, LANGUAGE_KEY, OFFERED, readPickedLanguage, uiLanguage } from '../../../src/i18n/languages'

// the planned list: wave 1, then the right to left pair, and two whose old tags browsers still send
const PLANNED = ['en', 'es-419', 'pt-BR', 'fr', 'de', 'it', 'ru', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'tr', 'pl', 'ar', 'he', 'id', 'fil']

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  vi.stubGlobal('navigator', { languages: ['fr-CA', 'en'] })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the best match of the browser\'s languages', () => {
  test.each([
    ['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-Hant', 'zh-Hant'],
    ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'], ['zh', 'zh-Hans'],
    ['pt', 'pt-BR'], ['pt-PT', 'pt-BR'], ['pt-BR', 'pt-BR'],
    ['es', 'es-419'], ['es-ES', 'es-419'], ['es-MX', 'es-419'], ['es-AR', 'es-419'],
    ['iw', 'he'], ['in', 'id'], ['tl', 'fil'],
    ['en-GB', 'en'], ['en', 'en'], ['fr-CA', 'fr'], ['de-AT', 'de'], ['ar-EG', 'ar'], ['ja-JP', 'ja'], ['ko-KR', 'ko'],
  ])('%s is served by %s', (wanted, served) => {
    expect(bestLanguage([wanted], PLANNED)).toBe(served)
  })

  test('the first language served wins, in the browser\'s order', () => {
    expect(bestLanguage(['th', 'fr-CA', 'en'], PLANNED)).toBe('fr')
    expect(bestLanguage(['en', 'fr-CA'], PLANNED)).toBe('en')
  })

  test('exact, then language and script, then language alone', () => {
    expect(bestLanguage(['en-GB'], ['en', 'en-GB'])).toBe('en-GB')
    expect(bestLanguage(['zh-TW'], ['zh-Hans', 'zh-Hant'])).toBe('zh-Hant')
    expect(bestLanguage(['zh-TW'], ['zh-Hans'])).toBe('zh-Hans')
    expect(bestLanguage(['sr-Latn'], ['sr', 'sr-Latn'])).toBe('sr-Latn')
    expect(bestLanguage(['sr-Latn-RS'], ['sr-Cyrl', 'sr-Latn'])).toBe('sr-Latn')
  })

  test('none served, or a tag that is not one, is skipped', () => {
    expect(bestLanguage(['th', 'vi'], PLANNED)).toBeUndefined()
    expect(bestLanguage(['*', 'not a tag', 'de'], PLANNED)).toBe('de')
    expect(bestLanguage([], PLANNED)).toBeUndefined()
  })
})

describe('the language shown', () => {
  test('nothing is offered but English yet', () => {
    expect(OFFERED).toEqual(['en'])
    expect(uiLanguage()).toBe('en')
  })

  test('the best match among the offered, else English', () => {
    expect(uiLanguage(['fr-CA', 'en'], PLANNED)).toBe('fr')
    expect(uiLanguage(['th'], PLANNED)).toBe('en')
  })

  test('a language picked wins once offered, and one not offered is not read', () => {
    stored.set(LANGUAGE_KEY, 'en')
    expect(readPickedLanguage()).toBe('en')
    expect(uiLanguage(['fr-CA'], PLANNED)).toBe('en')
    stored.set(LANGUAGE_KEY, 'fr')
    expect(readPickedLanguage()).toBeUndefined()
  })
})

describe('the locale dates and numbers are written in', () => {
  const date = new Date(2026, 9, 26)

  test('the browser\'s own tag for the language shown', () => {
    expect(formatLocale('en', ['en-GB', 'en-US'])).toBe('en-GB')
    expect(new Intl.DateTimeFormat(formatLocale('en', ['en-GB'])).format(date)).toBe('26/10/2026')
    expect(formatLocale('es-419', ['es-MX'])).toBe('es-MX')
    expect(new Intl.NumberFormat(formatLocale('es-419', ['es-MX'])).format(1234.5)).toBe('1,234.5')
    expect(new Intl.NumberFormat(formatLocale('es-419', ['es-AR'])).format(1234.5)).toBe('1.234,5')
    expect(formatLocale('pt-BR', ['pt-PT'])).toBe('pt-PT')
  })

  test('the same script too, so a Simplified page never takes the Traditional tag', () => {
    expect(formatLocale('zh-Hans', ['zh-TW', 'zh-CN'])).toBe('zh-CN')
    expect(formatLocale('zh-Hant', ['zh-CN'])).toBe('zh-Hant')
  })

  test('else the language shown itself, which bare English writes the US way', () => {
    expect(formatLocale('en', ['fr-FR'])).toBe('en')
    expect(new Intl.DateTimeFormat(formatLocale('en', [])).format(date)).toBe('10/26/2026')
    expect(formatLocale('es-419', ['not a tag'])).toBe('es-419')
  })

  test('the browser\'s languages are read when none are given', () => {
    vi.stubGlobal('navigator', { languages: ['en-AU'] })
    expect(formatLocale()).toBe('en-AU')
  })
})

describe('the language content is wanted in', () => {
  test('the browser\'s first whatever it is, as it writes it, else English', () => {
    expect(contentLanguage()).toBe('fr-CA')
    expect(contentLanguage(['th-TH', 'en'])).toBe('th-TH')
    expect(contentLanguage([])).toBe('en')
    vi.stubGlobal('navigator', undefined)
    expect(contentLanguage()).toBe('en')
  })

  test('a language picked wins over the browser\'s', () => {
    stored.set(LANGUAGE_KEY, 'en')
    expect(contentLanguage(['th-TH'])).toBe('en')
  })
})

test('right to left by language, whatever the region or old tag', () => {
  expect(['ar', 'ar-EG', 'he', 'iw', 'fa-IR', 'ur'].map(isRightToLeft)).toEqual([true, true, true, true, true, true])
  expect(['en', 'ja', 'zh-Hant', 'tr', 'not a tag'].map(isRightToLeft)).toEqual([false, false, false, false, false])
})
