// The data build's own checks on the offline history: every answerable record reaches the history with its AniDB
// id, and a history that heads next to no show with AniDB's title refuses the build rather than shipping.
import { expect, test } from 'vite-plus/test'

import { buildExtract, refusal } from '../../../../scripts/build-anime-data.mjs'
import { historyShards, type AnidbTitle } from '../../../../scripts/offline-pick'

const BEBOP = {
  title: 'Cowboy Bebop',
  type: 'TV',
  picture: 'https://cdn.myanimelist.net/images/anime/4/19644.jpg',
  sources: ['https://myanimelist.net/anime/1', 'https://anilist.co/anime/1', 'https://kitsu.app/anime/1', 'https://anidb.net/anime/23'],
  animeSeason: { year: 1998, season: 'SPRING' },
}

// Mutation: push the history record without its AniDB id.
test('a record outside the bundled seasons reaches the history with its ids, AniDB\'s included', () => {
  const { history, seasons } = buildExtract([BEBOP], { lastUpdate: '2026-10-19' }, '2026-43')
  expect(history).toEqual([{ t: 'Cowboy Bebop', ty: 'TV', p: '4/19644.jpg', ml: 1, al: 1, ku: 1, ad: 23 }])
  expect(seasons).toEqual({})
})

const HEALTHY = { indexRows: 24_461, seasons: 6, anidbTitles: 12_075 }

// Mutation: drop the AniDB floor.
test('a history heading fewer than 10,000 shows with AniDB\'s title refuses the build', () => {
  expect(refusal(HEALTHY)).toBeUndefined()
  expect(refusal({ ...HEALTHY, anidbTitles: 9_999 })).toMatch(/only 9999 history titles from AniDB.*Run the Offline history workflow/)
  // an empty AniDB asset, as a first publish AniDB refused leaves it, gives no AniDB title at all
  const { counts } = historyShards(
    [{ t: 'Kidou Senshi Gundam', ty: 'TV', p: '', ml: 80, ad: 63 }],
    new Map<number, AnidbTitle[]>(),
    new Map(),
  )
  expect(refusal({ ...HEALTHY, anidbTitles: counts.anidbTitles })).toMatch(/only 0 history titles from AniDB/)
  // control: the same record with AniDB's titles counts one
  expect(historyShards([{ t: 'Kidou Senshi Gundam', ty: 'TV', p: '', ml: 80, ad: 63 }], new Map([[63, [['official', 'en', 'Mobile Suit Gundam'] as AnidbTitle]]]), new Map()).counts.anidbTitles).toBe(1)
})

// Mutations: drop the index floor; drop the seasons floor.
test('too few index rows or seasons refuse the build too', () => {
  expect(refusal({ ...HEALTHY, indexRows: 14_999 })).toMatch(/only 14999 index rows/)
  expect(refusal({ ...HEALTHY, seasons: 2 })).toMatch(/only 2 seasons/)
})
