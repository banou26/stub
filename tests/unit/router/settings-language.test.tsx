// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { act } from 'preact/test-utils'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { LANGUAGE_KEY, startLanguage } from '../../../src/i18n'

const { LanguageSection } = await import('../../../src/router/settings/language')

// HOR-1026 (stub in the viewer's language): the Language setting, Automatic until one is picked, a pick reloading the
// tab once the FKN account has it (src/settings-sync.ts, tests/unit/settings-sync.test.ts)

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

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const render = () => {
  const saved = vi.fn(async () => {})
  const reload = vi.fn()
  const host = mount(withIntl(<><h2 id="settings-section-title">Language</h2><LanguageSection saved={saved} reload={reload}/></>))
  hosts.push(host)
  const select = host.querySelector('[data-setting="language"] select')!
  // linkedom's select reads `value` off a `selected` attribute and cannot be set, so a pick is the change event alone
  const pick = (value: string) => act(async () => {
    Object.defineProperty(select, 'value', { configurable: true, value })
    select.dispatchEvent(new Event('change'))
  })
  const options = () => [...select.querySelectorAll('option')].map(option => ({ value: option.value, text: option.textContent, lang: option.getAttribute('lang') }))
  return { host, select, pick, options, saved, reload }
}

test('Automatic names the browser\'s language, then English and wave 1, each in its own name and lang', () => {
  const { host, select, options } = render()
  expect(document.getElementById(select.getAttribute('aria-labelledby')!)?.textContent).toBe('Language')
  expect(options()).toEqual([
    { value: '', text: 'Automatic (Français)', lang: null },
    { value: 'de', text: 'Deutsch', lang: 'de' },
    { value: 'en', text: 'English', lang: 'en' },
    { value: 'es-419', text: 'Español latinoamericano', lang: 'es-419' },
    { value: 'fr', text: 'Français', lang: 'fr' },
    { value: 'it', text: 'Italiano', lang: 'it' },
    { value: 'pl', text: 'Polski', lang: 'pl' },
    { value: 'pt-BR', text: 'Português (Brasil)', lang: 'pt-BR' },
    { value: 'tr', text: 'Türkçe', lang: 'tr' },
    { value: 'ru', text: 'Русский', lang: 'ru' },
    { value: 'ko', text: '한국어', lang: 'ko' },
    { value: 'ja', text: '日本語', lang: 'ja' },
    { value: 'zh-Hans', text: '简体中文', lang: 'zh-Hans' },
    { value: 'zh-Hant', text: '繁體中文', lang: 'zh-Hant' },
  ])
  expect(host.querySelector('p'), 'a select, nothing to read').toBeNull()
})

test('a browser asking for no offered language reads Automatic (English)', () => {
  vi.stubGlobal('navigator', { languages: ['th-TH'] })
  expect(render().options()[0]!.text).toBe('Automatic (English)')
})

test('a pick writes the setting, waits on the account, then reloads the tab', async () => {
  const { select, pick, saved, reload } = render()
  await pick('de')
  expect(stored.get(LANGUAGE_KEY)).toBe('de')
  expect(saved).toHaveBeenCalledOnce()
  expect(reload).toHaveBeenCalledOnce()
  expect(saved.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]!)
  expect(select.hasAttribute('disabled'), 'no second pick while the tab reloads').toBe(true)
})

test('Automatic keeps nothing, and reloads into the browser\'s language', async () => {
  stored.set(LANGUAGE_KEY, 'de')
  const { pick, reload } = render()
  await pick('')
  expect(stored.has(LANGUAGE_KEY)).toBe(false)
  expect(reload).toHaveBeenCalledOnce()
})

describe('in German', () => {
  beforeAll(() => startLanguage({ language: 'de', languages: ['de-DE'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('Automatic reads in German, the languages still in their own names', () => {
    const texts = render().options().map(option => option.text)
    expect(texts.slice(0, 3)).toEqual(['Automatisch (Français)', 'Deutsch', 'English'])
  })
})
