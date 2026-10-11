import { expect, test } from 'vite-plus/test'

import { charactersByName, languageCode } from '../../../src/sources/credits'

test('every source\'s word for a language is its primary subtag', () => {
  expect(languageCode('Japanese'), 'AniList and MyAnimeList').toBe('ja')
  expect(languageCode('ja_jp'), 'Kitsu').toBe('ja')
  expect(languageCode('JA'), 'Anime News Network').toBe('ja')
  expect(languageCode('Portuguese')).toBe('pt')
})

test('a word that is not a known language stays as written', () => {
  expect(languageCode('Klingon')).toBe('Klingon')
})

// Free Solo on IMDb: all 13 cast rows are "Self", which grouped by part is one card stacking 13 people
test('a part that names no character makes no card', () => {
  const parts = ['Self', 'Himself', 'Herself - Guest', 'Walter White'].map((name, i) => ({ name, language: null, person: { id: `imdb:nm${i}`, name: `Person ${i}` } }))
  expect(charactersByName(parts).map(({ names }) => names)).toEqual([['Walter White']])
})
