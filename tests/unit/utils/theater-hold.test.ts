import { expect, test } from 'vite-plus/test'

import { THEATER_POOL_SIZE, holdTheaterPick, theaterKey } from '../../../src/utils/theater'

const media = (id: string, title = 't', score = 0.8) =>
  ({ _id: id, uri: `anilist:${id}`, titles: [{ title, score }], shortDescriptions: ['d'], trailers: ['v'] })
const always = (at: number) => () => at

// The hero re-rolled every time the candidate count grew, which on a cold load is several times a
// second: 22 candidates arrive from the bundle and live sources add more. Measured by the owner as
// "switches between 5 different anime in like 1s, and it ALWAYS happens".
test('the show already on screen is kept when more candidates arrive', () => {
  const first = [media('a'), media('b')]
  const chosen = holdTheaterPick(first, undefined, [], always(1))
  expect(theaterKey(chosen!)).toBe('b')

  const grown = [media('a'), media('b'), media('c'), media('d')]

  expect(theaterKey(holdTheaterPick(grown, chosen, [], always(0))!), 'a new pick would have given a')
    .toBe('b')
})

test('the show is kept even when the listing reorders under it, which an index could not do', () => {
  const a = media('a')
  const reordered = [media('c'), media('b'), a]

  expect(holdTheaterPick(reordered, a, [], always(0))).toBe(a)
})

// Measured 2026-10-10: the same pick swapped AniList's title for anizip's in place, 0.2 to 1.2 s
// after it was shown.
test('the show keeps the fields it was picked with when sources merge into the listing', () => {
  const anilist = media('a', 'Blue Box Season 2')
  const anizip = media('a', 'Blue Box (2026)', 0.9)

  expect(holdTheaterPick([anizip], anilist, [], always(0))).toBe(anilist)
})

// Measured 2026-10-10: shows ahead of the pick gained a trailer once AniList answered, which pushed
// it to index 11 to 14 of the candidates and re-picked at random.
test('a show pushed out of the pool is kept', () => {
  const held = media('held')
  const ahead = Array.from({ length: THEATER_POOL_SIZE }, (_, index) => media(`new-${index}`))

  expect(holdTheaterPick([...ahead, held], held, [], always(0))).toBe(held)
})

// The category tabs change the listing the hero is fed, and a show with no trailer stops being a
// candidate once any show has one.
test('a show that left the candidates is replaced', () => {
  const held = media('held')

  expect(theaterKey(holdTheaterPick([media('movie')], held, [], always(0))!)).toBe('movie')
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

test('a banned show is replaced, and banning is by show rather than by position', () => {
  const candidates = [media('a'), media('b')]

  expect(theaterKey(holdTheaterPick(candidates, candidates[0], ['a'], always(0))!)).toBe('b')
})

test('a replacement is picked from the pool only', () => {
  const candidates = Array.from({ length: THEATER_POOL_SIZE + 5 }, (_, index) => media(`${index}`))

  expect(theaterKey(holdTheaterPick(candidates, candidates[0], ['0'], always(99))!)).toBe(`${THEATER_POOL_SIZE - 1}`)
})

// With YouTube unreachable every embed is reported silent about 10 s after load, so every show in the
// pool is banned in turn while the listing stays full.
test('the last show stays when nothing unbanned is left to pick, or when the listing empties', () => {
  const a = media('a')
  expect(holdTheaterPick([a], a, ['a'])).toBe(a)
  expect(holdTheaterPick([], a)).toBe(a)
  expect(holdTheaterPick([a], undefined, ['a'])).toBeUndefined()
  expect(holdTheaterPick([], undefined)).toBeUndefined()
})
