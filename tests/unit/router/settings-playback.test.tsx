// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { act } from 'preact/test-utils'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { startLanguage } from '../../../src/i18n'
import { OFFERED } from '../../../src/i18n/languages'
import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import { ALWAYS_SUBTITLES_KEY, AUDIO_LANGUAGE_KEY, keepAudioLanguage, readTrackLanguages, SUBTITLE_LANGUAGE_KEY } from '../../../src/utils/track-languages'

const { PlaybackSection } = await import('../../../src/router/settings/playback')

// STUB-352 (players start in the viewer's language): Settings, Playback holds the audio and subtitle languages a player
// starts in and whether subtitles always show, the same settings a pick in a player writes
// (tests/unit/utils/track-languages.test.ts), which follow the FKN account (tests/unit/settings-sync.test.ts).

const stored = new Map<string, string>()
const listeners = new Set<(event: { key: string }) => void>()
beforeEach(() => {
  stored.clear()
  listeners.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  vi.stubGlobal('navigator', { languages: ['fr-CA', 'en'] })
  vi.stubGlobal('addEventListener', (type: string, listener: (event: { key: string }) => void) => { if (type === 'storage') listeners.add(listener) })
  vi.stubGlobal('removeEventListener', (_type: string, listener: (event: { key: string }) => void) => { listeners.delete(listener) })
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const render = () => {
  const host = mount(withIntl(<PlaybackSection/>))
  hosts.push(host)
  const select = (setting: string) => host.querySelector<HTMLSelectElement>(`[data-setting="${setting}"] select`)!
  // linkedom's select reads `value` off a `selected` attribute and cannot be set, so a pick is the change event alone
  const pick = (setting: string, value: string) => act(() => {
    Object.defineProperty(select(setting), 'value', { configurable: true, value })
    select(setting).dispatchEvent(new Event('change'))
  })
  const options = (setting: string) => [...select(setting).querySelectorAll('option')].map(option => [option.value, option.textContent])
  const always = () => [...host.querySelectorAll<HTMLInputElement>('input[role="switch"]')].find(input => input.closest('label')!.textContent === 'Always show subtitles')!
  const flip = (input: HTMLInputElement, on: boolean) => act(() => {
    Object.assign(input, { checked: on })
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  return { host, select, pick, options, always, flip }
}

test('each language select is labelled, offers Automatic naming the viewer\'s language, then its own row, then every offered language by name', () => {
  const { host, select, options } = render()
  const label = (setting: string) => document.getElementById(select(setting).getAttribute('aria-labelledby')!)?.textContent
  expect([label('audio-language'), label('subtitle-language')]).toEqual(['Audio language', 'Subtitle language'])
  for (const [setting, first] of [['audio-language', ['original', 'Original']], ['subtitle-language', ['off', 'Off']]] as const) {
    const listed = options(setting)
    expect(listed.slice(0, 2)).toEqual([['', 'Automatic (Canadian French)'], first])
    expect(listed).toHaveLength(OFFERED.length + 2)
    expect(new Set(listed.slice(2).map(([value]) => value))).toEqual(new Set(OFFERED))
    const names = listed.slice(2).map(([, name]) => name!)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(listed.find(([value]) => value === 'ja')?.[1]).toBe('Japanese')
  }
  expect(host.querySelector('p'), 'labels only').toBeNull()
})

test('a pick writes the setting a player starts in, and Automatic writes nothing', async () => {
  const { pick } = render()
  await pick('audio-language', 'original')
  await pick('subtitle-language', 'en')
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: 'en', alwaysSubtitles: false })
  await pick('audio-language', 'ja')
  await pick('subtitle-language', 'off')
  expect(Object.fromEntries(stored)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'ja', [SUBTITLE_LANGUAGE_KEY]: 'off' })
  expect(readTrackLanguages()).toEqual({ audio: 'ja', subtitles: null, alwaysSubtitles: false })
  await pick('audio-language', '')
  await pick('subtitle-language', '')
  expect(stored.size).toBe(0)
})

test('Always show subtitles is off until turned on, and writes nothing when off', async () => {
  const { always, flip } = render()
  expect(always().hasAttribute('checked')).toBe(false)
  await flip(always(), true)
  expect(stored.get(ALWAYS_SUBTITLES_KEY)).toBe('on')
  expect(readTrackLanguages().alwaysSubtitles).toBe(true)
  await flip(always(), false)
  expect(stored.has(ALWAYS_SUBTITLES_KEY)).toBe(false)
})

test('a language a player reported that no row is, is listed by its name, or as reported when it names none', () => {
  stored.set(AUDIO_LANGUAGE_KEY, 'English (US)')
  stored.set(SUBTITLE_LANGUAGE_KEY, 'Signs & Songs')
  const { options } = render()
  expect(options('audio-language')[2]).toEqual(['English (US)', 'American English'])
  expect(options('subtitle-language')[2]).toEqual(['Signs & Songs', 'Signs & Songs'])
})

test('a language a player reported that a row is adds no row of its own', () => {
  stored.set(AUDIO_LANGUAGE_KEY, 'jpn')
  stored.set(SUBTITLE_LANGUAGE_KEY, 'Français')
  const { options } = render()
  expect(options('audio-language')).toHaveLength(OFFERED.length + 2)
  expect(options('subtitle-language')).toHaveLength(OFFERED.length + 2)
})

test('an open Playback follows a pick made in a player and one on the FKN account', async () => {
  const { options } = render()
  await act(() => { keepAudioLanguage('Commentary') })
  expect(options('audio-language')[2]).toEqual(['Commentary', 'Commentary'])
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [SUBTITLE_LANGUAGE_KEY]: 'swa' }))
  await act(() => { for (const listener of listeners) listener({ key: ACCOUNT_SETTINGS_KEY }) })
  expect(options('subtitle-language')[2]).toEqual(['swa', 'Swahili'])
})

describe('in French', () => {
  beforeAll(() => startLanguage({ language: 'fr', languages: ['fr-FR'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('the rows read in French, each language named as a menu row writes it, with a capital', () => {
    const { host, options } = render()
    expect([...host.querySelectorAll('h3, label')].map(element => element.textContent)).toEqual([
      'Lecture automatique de l’épisode suivant', 'Langue audio', 'Langue des sous-titres', 'Toujours afficher les sous-titres',
    ])
    expect(options('audio-language').slice(0, 4)).toEqual([['', 'Automatique (Français canadien)'], ['original', 'Version originale'], ['de', 'Allemand'], ['en', 'Anglais']])
    expect(options('subtitle-language')[1]).toEqual(['off', 'Désactivés'])
  })
})
