// The audio and subtitle languages last picked in a player, kept in this browser beside the volume.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, keepAudioLanguage, keepSubtitleLanguage, readTrackLanguages } from '../../../src/utils/track-languages'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

test('none until one is picked, then the pick, with subtitles off kept apart from none', () => {
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: undefined })
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: null })
  expect(stored.get(SUBTITLE_LANGUAGE_KEY)).toBe('off')
  keepSubtitleLanguage('English')
  expect(readTrackLanguages()).toEqual({ audio: 'Japanese', subtitles: 'English' })
  expect(stored.get(AUDIO_LANGUAGE_KEY)).toBe('Japanese')
})

test('storage that throws reads as none, and a pick kept in it throws nothing', () => {
  const blocked = () => { throw new Error('blocked') }
  vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
  expect(readTrackLanguages()).toEqual({ audio: undefined, subtitles: undefined })
  expect(() => { keepAudioLanguage('Japanese'); keepSubtitleLanguage(null) }).not.toThrow()
})
