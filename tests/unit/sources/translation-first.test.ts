import { expect, test } from 'vite-plus/test'

import { translatedTitle, translationFirst } from '../../../src/sources/translations'

const english = { language: 'en', title: 'Frieren: Beyond Journey\'s End', score: 1 }
const romaji = { language: 'jp-en', title: 'Sousou no Frieren', score: 1 }
const native = { language: 'jp', title: '葬送のフリーレン', score: 1 }

test('a Japanese viewer reads the native title every source tags `jp` first, and AniDB\'s `ja` likewise', () => {
  expect(translationFirst([english, romaji, native], 'ja-JP').map(({ title }) => title))
    .toEqual(['葬送のフリーレン', 'Frieren: Beyond Journey\'s End', 'Sousou no Frieren'])
  expect(translationFirst([english, { language: 'ja', title: '呪術廻戦', score: 1 }], 'ja')[0]!.title, 'in kanji alone').toBe('呪術廻戦')
  expect(translationFirst([english, romaji, native], 'en-US'), 'an English viewer: as they are').toEqual([english, romaji, native])
  expect(translationFirst([english, romaji, native], 'fr-FR'), 'a French viewer with no French title: as they are').toEqual([english, romaji, native])
})

test('a Korean work\'s native title, tagged `jp` too, is not a Japanese viewer\'s', () => {
  const korean = { language: 'jp', title: '나 혼자만 레벨업', score: 1 }
  expect(translationFirst([english, korean], 'ja-JP')).toEqual([english, korean])
})

test('a translation into Japanese, were a source to give one, leads over the native title', () => {
  const translated = translatedTitle('ja', 'フリーレン', 1)
  expect(translationFirst([english, native, translated], 'ja-JP')[0]).toBe(translated)
})
