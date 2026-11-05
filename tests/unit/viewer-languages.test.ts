// The languages a source added in Settings is handed: tags a plugin compares, from the picks HOR-1015 keeps as the
// player reported them (../utils/track-languages.test.ts).
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { LANGUAGE_KEY } from '../../src/i18n/languages'
import { settings } from '../../src/settings-store'
import { keepAlwaysSubtitles, keepAudioLanguage, keepSubtitleLanguage } from '../../src/utils/track-languages'
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

test('nothing picked hands the content language alone, with subtitles not always shown', () => {
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', alwaysSubtitles: false })
})

test('a language picked in Settings is the content language handed', () => {
  stored.set(LANGUAGE_KEY, 'en')
  expect(viewerLanguages()).toEqual({ language: 'en', alwaysSubtitles: false })
})

test('the picks are handed as tags, whether the player reported a tag or a name, and subtitles off as null', () => {
  keepAudioLanguage('jpn')
  keepSubtitleLanguage('Português (Brasil)')
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', audio: 'ja', subtitles: 'pt-BR', alwaysSubtitles: false })
  keepAudioLanguage('English (US)')
  keepSubtitleLanguage(null)
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', audio: 'en-US', subtitles: null, alwaysSubtitles: false })
})

test('Automatic is left out, as the plugin reads the content language, and Original is said apart from the tags', () => {
  keepSubtitleLanguage(undefined)
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', alwaysSubtitles: false })
  keepAudioLanguage('original')
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', alwaysSubtitles: false, originalAudio: true })
  keepAudioLanguage('fr')
  expect(viewerLanguages(), 'the control: a language set in Settings is handed').toEqual({ language: 'fr-CA', audio: 'fr', alwaysSubtitles: false })
})

test('Always show subtitles is handed as set', () => {
  keepAlwaysSubtitles(true)
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', alwaysSubtitles: true })
  keepAlwaysSubtitles(false)
  expect(viewerLanguages().alwaysSubtitles).toBe(false)
})

test("a pick naming no language, a track's own title, is left out, the subtitles said to be one", () => {
  keepAudioLanguage('Commentary')
  keepSubtitleLanguage('Signs & Songs')
  expect(viewerLanguages()).toEqual({ language: 'fr-CA', alwaysSubtitles: false, titledSubtitles: true })
  keepSubtitleLanguage('fr')
  expect(viewerLanguages(), 'the control: a language is no title').toEqual({ language: 'fr-CA', subtitles: 'fr', alwaysSubtitles: false })
})

test('a watcher hears each pick, the language and Always show subtitles set in Settings included, and nothing once stopped', () => {
  const heard = vi.fn()
  const stop = watchViewerLanguages(heard)
  keepAudioLanguage('Japanese')
  keepSubtitleLanguage(null)
  keepAlwaysSubtitles(true)
  expect(heard).toHaveBeenCalledTimes(3)
  settings.setItem(LANGUAGE_KEY, 'ja')
  expect(heard).toHaveBeenCalledTimes(4)
  expect(viewerLanguages().language, 'what the worker is then handed').toBe('ja')
  stop()
  keepAudioLanguage('English')
  expect(heard).toHaveBeenCalledTimes(4)
})

test('the worker hands what the page held, else the browser\'s language alone', () => {
  expect(heldViewerLanguages()).toEqual({ language: 'fr-CA' })
  holdViewerLanguages({ language: 'de-DE', audio: 'ja', subtitles: null })
  expect(heldViewerLanguages()).toEqual({ language: 'de-DE', audio: 'ja', subtitles: null })
})
