import { expect, test } from 'vite-plus/test'

import { titleLanguage } from '../../../src/utils/title-language'

// HOR-1026 (stub in the viewer's language): a native title carries its own `lang`, so a Chinese page draws a Japanese
// title with Japanese glyphs
test('stub\'s title tags read as the BCP 47 tag of their lang attribute', () => {
  expect(['jp', 'jp-en', 'ja', 'en', 'zh-Hant'].map(titleLanguage)).toEqual(['ja', 'ja-Latn', 'ja', 'en', 'zh-Hant'])
})

test('no tag, or one naming no language, is no lang at all', () => {
  expect([undefined, null, '', 'not a tag'].map(titleLanguage)).toEqual([undefined, undefined, undefined, undefined])
})
