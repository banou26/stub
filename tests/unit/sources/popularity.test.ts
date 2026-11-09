import { expect, test } from 'vite-plus/test'

import { shareOf, withSeasonPopularity } from '../../../src/sources/popularity'

// the bundle can hold a show's MyAnimeList count from another season's page, above every count of this season's
test('a count above the season\'s most reads 1, never more', () => {
  expect(shareOf(400_000, 367_295)).toBe(1)
})

test('no count, a zero, or no season to measure against is no share, rather than a 0 that ranks', () => {
  expect([shareOf(undefined, 367_295), shareOf(0, 367_295), shareOf(1_000, 0), shareOf(1_000, undefined)]).toEqual([undefined, undefined, undefined, undefined])
  expect(withSeasonPopularity([{ followers: null }, { followers: 0 }])).toEqual([{ followers: null }, { followers: 0 }])
})
