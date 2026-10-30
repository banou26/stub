import { expect, test } from 'vite-plus/test'

import { titleLanguage } from '../../../src/utils/title-language'

// HOR-1026 (stub in the viewer's language): a native title carries its own `lang`, so a Chinese page draws a Japanese
// title with Japanese glyphs
test('stub\'s title tags read as the BCP 47 tag of their lang attribute', () => {
  expect([
    { language: 'jp', title: 'スペック・レイト' },
    { language: 'jp-en', title: 'Shingeki no Kyojin' },
    { language: 'ja', title: '呪術廻戦' },
    { language: 'en', title: 'Attack on Titan' },
    { language: 'zh-Hant', title: '魔道祖師' },
  ].map(titleLanguage)).toEqual(['ja', 'ja-Latn', 'ja', 'en', 'zh-Hant'])
})

// every source tags a donghua's Chinese title `jp`, which drew Han characters as Japanese on a Chinese page
test('a native title is Japanese by its kana and Korean by its Hangul, and Han characters alone keep the page\'s lang', () => {
  expect([
    { language: 'jp', title: '進撃の巨人' },
    { language: 'jp', title: '나 혼자만 레벨업' },
    { language: 'jp', title: '魔道祖师' },
    { language: 'jp', title: '呪術廻戦' },
  ].map(titleLanguage)).toEqual(['ja', 'ko', undefined, undefined])
})

test('no tag, or one naming no language, is no lang at all', () => {
  expect([undefined, null, '', 'not a tag'].map(language => titleLanguage({ language, title: 'Spec' }))).toEqual([undefined, undefined, undefined, undefined])
})
