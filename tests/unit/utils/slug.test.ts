import { expect, test } from 'vite-plus/test'

import { nameSegment, slugOf } from '../../../src/utils/slug'

test.each([
  ['Frieren: Beyond Journey\'s End', 'frieren-beyond-journeys-end'],
  ['Pokémon', 'pokemon'],
  ['Ōkami Kodomo no Ame to Yuki', 'okami-kodomo-no-ame-to-yuki'],
  ['Re:ZERO -Starting Life in Another World-', 're-zero-starting-life-in-another-world'],
  ['ＳＰＹ×ＦＡＭＩＬＹ', 'spy-family'],
  ['Æon Flux', 'aeon-flux'],
  ['86 EIGHTY-SIX', '86-eighty-six'],
  ['.hack//Sign', 'hack-sign'],
  ['鬼滅の刃 無限列車編', '鬼滅の刃-無限列車編'],
  ['मिर्ज़ापुर', 'मिर्ज़ापुर'],
  ['!!!', ''],
  [undefined, ''],
])('%s is named %s', (title, slug) => {
  expect(slugOf(title)).toBe(slug)
})

test('a long title is cut at a word, and one with no word break at 60 letters', () => {
  expect(slugOf('Kono Subarashii Sekai ni Shukufuku wo! Kurenai Densetsu and more words beyond sixty'))
    .toBe('kono-subarashii-sekai-ni-shukufuku-wo-kurenai-densetsu-and')
  expect(Array.from(slugOf('あ'.repeat(80)))).toHaveLength(60)
})

test('a name in no Latin letters is a valid address segment that reads back as it', () => {
  const segment = nameSegment('葬送のフリーレン')
  expect(segment).toBe('/%E8%91%AC%E9%80%81%E3%81%AE%E3%83%95%E3%83%AA%E3%83%BC%E3%83%AC%E3%83%B3')
  const url = new URL(`https://stub.fkn.app/title/ag:(anilist:154587)${segment}`)
  expect(url.pathname).toBe(`/title/ag:(anilist:154587)${segment}`)
  expect(decodeURI(url.pathname.split('/').at(-1)!)).toBe('葬送のフリーレン')
  expect(nameSegment('!!!'), 'no name, no segment').toBe('')
})
