// The audio and subtitle languages a player starts in, set in Settings or by a pick in a player, settings that follow
// the FKN account (../settings-sync.test.ts follows them to the account's file).
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { LANGUAGE_KEY } from '../../../src/i18n/languages'
import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import {
  ALWAYS_SUBTITLES_KEY, AUDIO_LANGUAGE_KEY, keepAlwaysSubtitles, keepAudioLanguage, keepSubtitleLanguage, ORIGINAL,
  readTrackLanguages, SUBTITLE_LANGUAGE_KEY, watchTrackLanguages,
} from '../../../src/utils/track-languages'

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

test('Automatic is the viewer\'s language for both, with subtitles hidden where the audio plays in it, and nothing stored', () => {
  expect(readTrackLanguages()).toEqual({ audio: 'fr-CA', subtitles: 'fr-CA', alwaysSubtitles: false })
  stored.set(LANGUAGE_KEY, 'de')
  expect(readTrackLanguages(), 'the language picked in Settings').toEqual({ audio: 'de', subtitles: 'de', alwaysSubtitles: false })
  expect([...stored.keys()]).toEqual([LANGUAGE_KEY])
})

test('Original is no audio language, off is null, and a language is kept as given, a player\'s pick or a Settings tag', () => {
  keepAudioLanguage(ORIGINAL)
  keepSubtitleLanguage(null)
  keepAlwaysSubtitles(true)
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: null, alwaysSubtitles: true })
  expect(Object.fromEntries(stored)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'original', [SUBTITLE_LANGUAGE_KEY]: 'off', [ALWAYS_SUBTITLES_KEY]: 'on' })
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage('en')
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: 'en', alwaysSubtitles: true })
})

test('Automatic and off for always show subtitles store nothing', () => {
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage('English')
  keepAlwaysSubtitles(true)
  keepAudioLanguage(undefined)
  keepSubtitleLanguage(undefined)
  keepAlwaysSubtitles(false)
  expect(stored.size).toBe(0)
})

test('signed in, the account\'s languages are read and a pick changes them, not this device\'s own', () => {
  stored.set(AUDIO_LANGUAGE_KEY, 'English')
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'off' }))
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: null, alwaysSubtitles: false })
  keepSubtitleLanguage('Deutsch')
  expect(JSON.parse(stored.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'Deutsch' })
  expect(stored.has(SUBTITLE_LANGUAGE_KEY)).toBe(false)
})

test('read from anything holding them under their keys, as the embed reads its url, Automatic in the language given', () => {
  const params = new URLSearchParams({ [AUDIO_LANGUAGE_KEY]: 'original', [ALWAYS_SUBTITLES_KEY]: 'on' })
  expect(readTrackLanguages(key => params.get(key), 'ja')).toEqual({ audio: undefined, subtitles: 'ja', alwaysSubtitles: true })
})

test('a watcher hears each of the three, and nothing once stopped', () => {
  const heard = vi.fn()
  const stop = watchTrackLanguages(heard)
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  keepAlwaysSubtitles(true)
  expect(heard).toHaveBeenCalledTimes(3)
  stop()
  keepAudioLanguage('English')
  expect(heard).toHaveBeenCalledTimes(3)
})

test('storage that throws reads as Automatic, and a pick kept in it throws nothing', () => {
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
  expect(readTrackLanguages()).toEqual({ audio: 'fr-CA', subtitles: 'fr-CA', alwaysSubtitles: false })
  expect(() => { keepAudioLanguage('Japanese'); keepSubtitleLanguage(null); keepAlwaysSubtitles(true) }).not.toThrow()
})
