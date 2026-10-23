// The offline history is stub's own result: each gathered input becomes the media stub's own source answers for
// it, and stub's own merge picks the title, cover, banner and description, as it picks them for a page.
import { expect, test } from 'vite-plus/test'

import { anizipTitles, historyShards, pick, type AnidbTitle, type HistoryRecord, type KitsuRow } from '../../../../scripts/offline-pick'

const GUNDAM: HistoryRecord = { t: 'Kidou Senshi Gundam', ty: 'TV', p: '1426/112393.jpg', ml: 80, ku: 80, ad: 63 }
const GUNDAM_ANIDB: AnidbTitle[] = [['syn', 'en', 'MSG'], ['official', 'en', 'Mobile Suit Gundam'], ['official', 'ja', '機動戦士ガンダム']]
const kitsuRow = (id: number, attributes: Record<string, unknown>): KitsuRow => ({ id: String(id), attributes })
const GUNDAM_KITSU = kitsuRow(80, {
  titles: { en: 'Mobile Suit Gundam (TV)', en_jp: 'Kidou Senshi Gundam' },
  canonicalTitle: 'Kidou Senshi Gundam',
  synopsis: 'The year is Universal Century 0079.',
  posterImage: { original: 'https://media.kitsu.app/anime/80/poster_image/a.jpg' },
  coverImage: { original: 'https://media.kitsu.app/anime/cover_images/80/original.jpg' },
})

// Mutations: take the last unofficial title; take official titles only.
test('AniDB\'s titles pass as api.ani.zip passes them: per language the official one, else the first in the file', () => {
  expect(anizipTitles([['syn', 'en', 'Space Cowboy'], ['official', 'en', 'Cowboy Bebop'], ['syn', 'ja', 'カウボーイ'], ['short', 'ja', 'CB']]))
    .toEqual({ en: 'Cowboy Bebop', ja: 'カウボーイ' })
  expect(anizipTitles([['main', 'x-jat', 'Cowboy Bebop']])).toEqual({})
})

// Mutation: leave the anizip member out.
test('a show heads with AniDB\'s English title over Kitsu\'s and the dump\'s, as anizip outranks both on the page', () => {
  expect(pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU).title).toEqual({ value: 'Mobile Suit Gundam', origin: 'anizip' })
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU).title).toEqual({ value: 'Mobile Suit Gundam (TV)', origin: 'kitsu' })
})

// Mutation: build the anizip member's titles apart from the anizip source's own.
test('an AniDB title escaped once more than XML takes reads as the anizip source decodes it on the page', () => {
  const nine = { t: 'Nine (Original Ban)', ty: 'MOVIE', p: '', ml: 9242, ad: 9242 }
  expect(pick(nine, [['official', 'ja', 'ナイン &lt;オリジナル版&gt;']]).title).toEqual({ value: 'ナイン <オリジナル版>', origin: 'anizip' })
})

// Mutation: drop the MyAnimeList id condition.
test('AniDB\'s titles take part only for a show with a MyAnimeList id, the only address the live anizip source answers', () => {
  const noMal = { t: 'Kidou Senshi Gundam', ty: 'TV', p: '', al: 80, ad: 63 }
  expect(pick(noMal, GUNDAM_ANIDB).title).toEqual({ value: 'Kidou Senshi Gundam', origin: 'offline' })
})

// Mutations: leave out the MyAnimeList cover member; give it to every dump picture.
test('a dump picture on MyAnimeList\'s CDN is the cover over Kitsu\'s poster, and any other loses to it', () => {
  expect(pick(GUNDAM, undefined, GUNDAM_KITSU).cover).toEqual({ value: 'https://cdn.myanimelist.net/images/anime/1426/112393l.webp', origin: 'mal' })
  const planet = { ...GUNDAM, p: 'https://cdn.anime-planet.com/anime/primary/mobile-suit-gundam.jpg' }
  expect(pick(planet, undefined, GUNDAM_KITSU).cover).toEqual({ value: 'https://media.kitsu.app/anime/80/poster_image/a.jpg', origin: 'kitsu' })
})

test('the banner and the description are the merge\'s first, here Kitsu\'s', () => {
  const { banner, description } = pick(GUNDAM, GUNDAM_ANIDB, GUNDAM_KITSU)
  expect(banner).toEqual({ value: 'https://media.kitsu.app/anime/cover_images/80/original.jpg', origin: 'kitsu' })
  expect(description).toEqual({ value: 'The year is Universal Century 0079.', origin: 'kitsu' })
  expect(pick({ t: 'A', ty: 'TV', p: '' }).description).toBeUndefined()
})

const shardsOf = () => historyShards(
  [
    GUNDAM,
    // the same key again: the first record keeps it
    { ...GUNDAM, t: 'Gundam (duplicate)' },
    // no MyAnimeList id, reached from its Kitsu id
    { t: 'Daicon III Opening Animation', ty: 'SPECIAL', p: '', al: 300, ku: 7 },
    // a title Kitsu gives the same as the dump: nothing stored for it
    { t: 'Cowboy Bebop', ty: 'TV', p: '4/19644.jpg', ml: 1, ku: 1 },
  ],
  new Map([[63, GUNDAM_ANIDB]]),
  new Map([[80, GUNDAM_KITSU], [1, kitsuRow(1, { titles: { en: 'Cowboy Bebop' }, canonicalTitle: 'Cowboy Bebop' })]]),
)

// Mutations: store AniDB's title in the Kitsu set; store a title equal to the dump's; let a duplicate key overwrite.
test('each set holds only what stub\'s rules took from its source', () => {
  const { sets, counts } = shardsOf()
  expect(sets.dump[80]).toEqual({ 'mal-80': ['Kidou Senshi Gundam', '1426/112393.jpg'] })
  expect(sets.anidb[80]).toEqual({ 'mal-80': 'Mobile Suit Gundam' })
  expect(sets.kitsu[80]).toEqual({ 'mal-80': { b: 'cover_images/80/original.jpg', d: 'The year is Universal Century 0079.' } })
  expect(sets.dump[1]).toEqual({ 'mal-1': ['Cowboy Bebop', '4/19644.jpg'] })
  expect(sets.anidb[1]).toEqual({})
  expect(sets.kitsu[1]).toEqual({})
  expect(counts).toEqual({ records: 3, anidbTitles: 1, kitsuTitles: 0, kitsuCovers: 0, banners: 1, descriptions: 1 })
})

// Mutations: drop the pointers; point every record's Kitsu id.
test('a record with no MyAnimeList id is also reached from its Kitsu id, and only such a record', () => {
  const { sets } = shardsOf()
  expect(sets.dump[7]).toEqual({ 'kitsu-7': 'anilist-300' })
  expect(sets.dump[44]).toEqual({ 'anilist-300': ['Daicon III Opening Animation', ''] })
  expect(Object.keys(sets.dump[80]!)).toEqual(['mal-80'])
})

// Mutation: write the picked title into the dump's entry.
test('the ODbL set holds the dump\'s own title and picture, never AniDB\'s or Kitsu\'s content', () => {
  const dump = JSON.stringify(shardsOf().sets.dump)
  for (const text of ['Mobile Suit Gundam', 'Universal Century', 'cover_images']) expect(dump).not.toContain(text)
})
