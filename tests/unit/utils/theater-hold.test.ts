import { expect, test } from 'vite-plus/test'

import { THEATER_POOL_SIZE, holdTheaterPick, theaterKey } from '../../../src/utils/theater'

const media = (id: string, title = 't', score = 0.8) => ({
  _id: id,
  uri: `ag:(anilist:${id})`,
  titles: [{ title, score }],
  shortDescriptions: ['d'],
  trailers: ['v'],
  handles: [{ relation: 'SAME_AS', node: { uri: `anilist:${id}` } }],
})
const always = (at: number) => () => at

// The hero re-rolled every time the candidate count grew, which on a cold load is several times a
// second: 22 candidates arrive from the bundle and live sources add more. Measured by the owner as
// "switches between 5 different anime in like 1s, and it ALWAYS happens".
test('the show already on screen is kept when more candidates arrive', () => {
  const first = [media('a'), media('b')]
  const chosen = holdTheaterPick(first, undefined, always(1))
  expect(theaterKey(chosen!)).toBe('b')

  const grown = [media('a'), media('b'), media('c'), media('d')]

  expect(theaterKey(holdTheaterPick(grown, chosen, always(0))!), 'a new pick would have given a')
    .toBe('b')
})

test('the show is kept even when the listing reorders under it, which an index could not do', () => {
  const a = media('a')
  const reordered = [media('c'), media('b'), a]

  expect(holdTheaterPick(reordered, a, always(0))).toBe(a)
})

// Measured 2026-10-10: the same pick swapped AniList's title for anizip's in place, 0.2 to 1.2 s
// after it was shown.
test('the show keeps the fields it was picked with when sources merge into the listing', () => {
  const anilist = media('a', 'Blue Box Season 2')
  const anizip = media('a', 'Blue Box (2026)', 0.9)

  expect(holdTheaterPick([anizip], anilist, always(0))).toBe(anilist)
})

// Measured 2026-10-10: shows ahead of the pick gained a trailer once AniList answered, which pushed
// it to index 11 to 14 of the candidates and re-picked at random.
test('a show pushed out of the pool is kept', () => {
  const held = media('held')
  const ahead = Array.from({ length: THEATER_POOL_SIZE }, (_, index) => media(`new-${index}`))

  expect(holdTheaterPick([...ahead, held], held, always(0))).toBe(held)
})

// The category tabs change the listing the hero is fed, and a show with no trailer stops being a
// candidate once any show has one.
test('a show that left the candidates is replaced', () => {
  const held = media('held')

  expect(theaterKey(holdTheaterPick([media('movie')], held, always(0))!)).toBe('movie')
})

// Measured 2026-10-10: Kitsu's fields for a new season are often a one-line placeholder synopsis and
// an announcement trailer, and AniList's replace them in the listing about a second later. Kitsu's
// mappings name AniList's id in the address before AniList has answered, so only the scores tell.
test('a show only Kitsu or the bundle has filled follows the listing until a better source fills it, then holds', () => {
  const seeded = { ...media('a', 'Tensei shitara Ken deshita 2', 0.2), uri: 'ag:(offline:mal-1)' }
  const kitsu = { ...media('a', 'Reincarnated as a Sword 2', 0.3), uri: 'ag:(anilist:1,kitsu:1,offline:mal-1)' }
  const anilist = media('a', 'Reincarnated as a Sword Season 2')
  const anizip = media('a', 'Reincarnated as a Sword (2026)', 0.9)

  expect(holdTheaterPick([kitsu], seeded)).toBe(kitsu)
  expect(holdTheaterPick([anilist], kitsu)).toBe(anilist)
  expect(holdTheaterPick([anizip], anilist)).toBe(anilist)
})

// The listing's id is the cluster's, and a merge of two clusters of one show retires one of them.
test('a show whose cluster merges with another of the same show is kept', () => {
  const merged = {
    ...media('other-cluster', 'Merged'),
    uri: 'ag:(anilist:held,tmdb:9)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'anilist:held' } }, { relation: 'SAME_AS', node: { uri: 'tmdb:9' } }],
  }
  const listing = [media('first'), merged]

  const held = media('held')
  expect(holdTheaterPick(listing, held, always(0))).toBe(held)
  expect(holdTheaterPick(listing, media('held', 't', 0.3), always(0)), 'a pick only Kitsu filled takes the merged fields').toBe(merged)
})

// Measured 2026-10-13 on series.fkn.app: reading the hero's show asked Apple TV, whose season 1 then took
// the show's card (`inAnswerOrder`), and the hero re-picked. JustWatch's titles score 0.2.
test('a show the listing draws as its season is kept as it was picked', () => {
  const show = { ...media('cl:jw:446463', "Widow's Bay", 0.2), handles: [{ relation: 'SAME_AS', node: { uri: 'jw:446463' } }] }
  const season = {
    ...media('cl:appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1', 'Widow\u2019s Bay', 0.2),
    handles: [
      { relation: 'SAME_AS', node: { uri: 'appletv:umc.cmc.1zzly0vah46bnvnwf0qkrjhh2-s1' } },
      { relation: 'PART_OF', node: { uri: 'jw:446463' } },
    ],
  }

  expect(holdTheaterPick([media('first', 't', 0.2), season], show, always(0))).toBe(show)
  const filled = { ...show, titles: [{ title: "Widow's Bay", score: 0.8 }] }
  expect(holdTheaterPick([media('first'), season], filled, always(0)), 'a pick a good source filled').toBe(filled)
  const ahead = Array.from({ length: THEATER_POOL_SIZE }, (_, index) => media(`new-${index}`, 't', 0.2))
  expect(holdTheaterPick([...ahead, season], show, always(0)), 'a season drawn past the pool').toBe(show)
})

test('a show that truly leaves the listing is replaced, whatever the seasons of other shows', () => {
  const held = media('held')
  const seasonOfAnother = { ...media('s1'), handles: [{ relation: 'SAME_AS', node: { uri: 'appletv:s1' } }, { relation: 'PART_OF', node: { uri: 'jw:other' } }] }

  expect(theaterKey(holdTheaterPick([seasonOfAnother, media('next')], held, always(1))!)).toBe('next')
})

// A film published under a series is PART_OF it, and so is every other film of that series.
test('another part of the series the held title is part of is another title', () => {
  const series = { relation: 'PART_OF', node: { uri: 'tmdb:collection-1' } }
  const held = { ...media('dune-2'), handles: [...media('dune-2').handles, series] }
  const other = { ...media('dune-1'), handles: [...media('dune-1').handles, series] }

  expect(theaterKey(holdTheaterPick([other], held, always(0))!)).toBe('dune-1')
})

// The hero is a highlight reel, not the whole season, and a pick function answering out of range
// must not produce an out-of-bounds index.
test('a replacement is picked from the pool only', () => {
  const candidates = Array.from({ length: THEATER_POOL_SIZE + 5 }, (_, index) => media(`${index}`))

  expect(theaterKey(holdTheaterPick(candidates, undefined, always(99))!)).toBe(`${THEATER_POOL_SIZE - 1}`)
  expect(theaterKey(holdTheaterPick(candidates, undefined, always(-3))!)).toBe('0')
})

test('the last show stays when the listing empties', () => {
  const a = media('a')
  expect(holdTheaterPick([], a)).toBe(a)
  expect(holdTheaterPick([], undefined)).toBeUndefined()
})
