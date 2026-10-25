// The audio and subtitle languages last picked in a player, settings that follow the FKN account
// (../settings-sync.test.ts follows them to the account's file).
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_SETTINGS_KEY } from '../../../src/settings-store'
import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, keepAudioLanguage, keepSubtitleLanguage, readTrackLanguages } from '../../../src/utils/track-languages'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

test('signed out, none until one is picked, then the pick on this device, with subtitles off kept apart from none', () => {
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: undefined })
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: null })
  expect(stored.get(SUBTITLE_LANGUAGE_KEY)).toBe('off')
  keepSubtitleLanguage('English')
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: 'English' })
  expect(stored.get(AUDIO_LANGUAGE_KEY)).toBe('Japanese')
})

test('signed in, the account\'s languages are read and a pick changes them, not this device\'s own', () => {
  stored.set(AUDIO_LANGUAGE_KEY, 'English')
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'off' }))
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: null })
  keepSubtitleLanguage('Deutsch')
  expect(JSON.parse(stored.get(ACCOUNT_SETTINGS_KEY)!)).toEqual({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'Deutsch' })
  expect(stored.has(SUBTITLE_LANGUAGE_KEY)).toBe(false)
})

test('read from anything holding them under their keys, as the embed reads its url', () => {
  const params = new URLSearchParams({ [AUDIO_LANGUAGE_KEY]: 'Japanese', [SUBTITLE_LANGUAGE_KEY]: 'off' })
  expect(readTrackLanguages(key => params.get(key))).toEqual({ audio: 'Japanese', subtitles: null })
})

test('storage that throws reads as none, and a pick kept in it throws nothing', () => {
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: undefined })
  expect(() => { keepAudioLanguage('Japanese'); keepSubtitleLanguage(null) }).not.toThrow()
})
