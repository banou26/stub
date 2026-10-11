import { expect, test } from 'vite-plus/test'

import { languageCode } from '../../../src/sources/credits'

test('every source\'s word for a language is its primary subtag', () => {
  expect(languageCode('Japanese'), 'AniList and MyAnimeList').toBe('ja')
  expect(languageCode('ja_jp'), 'Kitsu').toBe('ja')
  expect(languageCode('JA'), 'Anime News Network').toBe('ja')
  expect(languageCode('Portuguese')).toBe('pt')
})

test('a word that is not a known language stays as written', () => {
  expect(languageCode('Klingon')).toBe('Klingon')
})
