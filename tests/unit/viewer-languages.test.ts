// The languages a source added in Settings is handed: tags a plugin compares, from the picks HOR-1015 keeps as the
// player reported them (../utils/track-languages.test.ts).
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { LANGUAGE_KEY } from '../../src/i18n/languages'
import { keepAudioLanguage, keepSubtitleLanguage } from '../../src/utils/track-languages'
import { heldViewerLanguages, holdViewerLanguages, viewerLanguages, watchViewerLanguages } from '../../src/viewer-languages'

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

test('nothing picked hands the content language alone', () => {
  expect(viewerLanguages()).toEqual({ language: 'fr-CA' })
})

test('a language picked in Settings is the content language handed', () => {
  stored.set(LANGUAGE_KEY, 'en')
  expect(viewerLanguages()).toEqual({ language: 'en' })
})

test('the picks are handed as tags, whether the player reported a tag or a name, and subtitles off as null', () => {
  keepAudioLanguage('jpn')
  keepSubtitleLanguage('Português (Brasil)')
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', audio: 'ja', subtitles: 'pt-BR' })
  keepAudioLanguage('English (US)')
  keepSubtitleLanguage(null)
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', audio: 'en-US', subtitles: null })
})

test("a pick naming no language, a track's own title, is left out", () => {
  keepAudioLanguage('Commentary')
  keepSubtitleLanguage('Signs & Songs')
  expect(viewerLanguages()).toEqual({ language: 'fr-CA' })
})

test('a watcher hears each pick, and nothing once stopped', () => {
  const heard = vi.fn()
  const stop = watchViewerLanguages(heard)
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  expect(heard).toHaveBeenCalledTimes(2)
  stop()
  keepAudioLanguage('English')
  expect(heard).toHaveBeenCalledTimes(2)
})

test('the worker hands what the page held, else the browser\'s language alone', () => {
  expect(heldViewerLanguages()).toEqual({ language: 'fr-CA' })
  holdViewerLanguages({ language: 'de-DE', audio: 'ja', subtitles: null })
  expect(heldViewerLanguages()).toEqual({ language: 'de-DE', audio: 'ja', subtitles: null })
})
