// The two members of `MediaSort` pointed the wrong way from the commit that introduced them (793f3da,
// 2025-09-01) until 2026-09-12: `POPULARITY` sorted descending and `POPULARITY_DESC` ascending. It
// survived a year because the inversion was symmetric and both pages sent the bare member, so the
// only member whose name described the other one's behaviour was the only one nothing asked for.
// These pin the direction by the name, which is the part a reader trusts and cannot run.
import { describe, expect, test } from 'vite-plus/test'

import { applyMediaSorts } from '../../../../src/worker/store/filter'

// an aggregated row as the page receives it, cut down to the two fields a sort reads
const media = (uri: string, followers: number | null, popularity: number | null = null) => ({ uri, followers, popularity }) as any

const uris = (medias: { uri: string }[]) => medias.map(media => media.uri)

const page = [
  media('anilist:2', 40_000),
  media('anilist:1', 900_000),
  media('anilist:3', 7_000),
]

describe('applyMediaSorts', () => {
  test('POPULARITY sorts ascending, least popular first', () => {
    expect(uris(applyMediaSorts(page, { sorts: ['POPULARITY'] }))).toEqual(['anilist:3', 'anilist:2', 'anilist:1'])
  })

  // what the home row and the search page send, and the order they render without re-sorting
  test('POPULARITY_DESC sorts descending, most popular first', () => {
    expect(uris(applyMediaSorts(page, { sorts: ['POPULARITY_DESC'] }))).toEqual(['anilist:1', 'anilist:2', 'anilist:3'])
  })

  // A row 24 sources describe and none counted is unranked, not unpopular. Ascending used to read it
  // as zero and open the page on it; the home listing has always relied on descending burying it
  // (utils/settled-order.ts, measured 2026-09-06).
  test('a media with no count sorts last in both directions', () => {
    const withUnranked = [
      media('kitsu:4', null),
      media('anilist:2', 40_000),
      media('tmdb:5', 0),
      media('anilist:1', 900_000),
    ]
    expect(uris(applyMediaSorts(withUnranked, { sorts: ['POPULARITY'] })))
      .toEqual(['tmdb:5', 'anilist:2', 'anilist:1', 'kitsu:4'])
    expect(uris(applyMediaSorts(withUnranked, { sorts: ['POPULARITY_DESC'] })))
      .toEqual(['anilist:1', 'anilist:2', 'tmdb:5', 'kitsu:4'])
  })

  test('two unranked rows keep the order they arrived in, in both directions', () => {
    const unranked = [media('kitsu:4', null), media('tvdb:6', null), media('anilist:1', 900_000)]
    expect(uris(applyMediaSorts(unranked, { sorts: ['POPULARITY'] }))).toEqual(['anilist:1', 'kitsu:4', 'tvdb:6'])
    expect(uris(applyMediaSorts(unranked, { sorts: ['POPULARITY_DESC'] }))).toEqual(['anilist:1', 'kitsu:4', 'tvdb:6'])
  })

  test('the last member named decides, and an unknown one is ignored', () => {
    expect(uris(applyMediaSorts(page, { sorts: ['POPULARITY_DESC', 'POPULARITY'] })))
      .toEqual(['anilist:3', 'anilist:2', 'anilist:1'])
    expect(uris(applyMediaSorts(page, { sorts: ['SCORE_DESC' as string, 'POPULARITY_DESC'] })))
      .toEqual(['anilist:1', 'anilist:2', 'anilist:3'])
  })

  test('no sorts leaves the page in the order the filters left it', () => {
    expect(uris(applyMediaSorts(page, { sorts: [] }))).toEqual(uris(page))
    expect(uris(applyMediaSorts(page, { sorts: null }))).toEqual(uris(page))
    expect(uris(applyMediaSorts(page, { sorts: undefined }))).toEqual(uris(page))
  })

  // the resolver reassigns the result, but a caller that keeps the unsorted page must still have one
  test('the input array is not reordered', () => {
    const given = [media('anilist:2', 40_000), media('anilist:1', 900_000)]
    applyMediaSorts(given, { sorts: ['POPULARITY_DESC'] })
    expect(uris(given)).toEqual(['anilist:2', 'anilist:1'])
  })
})

// Summer 2026 (fixtures of 2026-10-16): MyAnimeList's most followed show has 367,295 members and Kitsu's 4,841 users,
// so BAKI-DOU Part 2, which only Kitsu counts, has 195 users and 4% of Kitsu's top, where a show with 5,000
// MyAnimeList members has 1.4% of MyAnimeList's.
describe('applyMediaSorts on one season', () => {
  const SUMMER = { season: 'SUMMER', seasonYear: 2026 }
  const season = [
    media('mal:63468', 5_000, 0.0136),
    media('kitsu:50635', 195, 0.0403),
    media('mal:59193', 367_295, 1),
    media('kitsu:48693', 28, 0.00578),
  ]

  test('the share of the season decides, so a show only Kitsu counts ranks beside MyAnimeList\'s', () => {
    expect(uris(applyMediaSorts(season, { sorts: ['POPULARITY_DESC'], ...SUMMER }))).toEqual(['mal:59193', 'kitsu:50635', 'mal:63468', 'kitsu:48693'])
    expect(uris(applyMediaSorts(season, { sorts: ['POPULARITY'], ...SUMMER }))).toEqual(['kitsu:48693', 'mal:63468', 'kitsu:50635', 'mal:59193'])
  })

  test('across seasons the follower count decides, since one season\'s share says nothing of another\'s', () => {
    const byCount = ['mal:59193', 'mal:63468', 'kitsu:50635', 'kitsu:48693']
    expect(uris(applyMediaSorts(season, { sorts: ['POPULARITY_DESC'] }))).toEqual(byCount)
    // half a pair is every SUMMER, or every season of 2026
    expect(uris(applyMediaSorts(season, { sorts: ['POPULARITY_DESC'], season: 'SUMMER' }))).toEqual(byCount)
    expect(uris(applyMediaSorts(season, { sorts: ['POPULARITY_DESC'], seasonYear: 2026 }))).toEqual(byCount)
  })

  // a show listed by a source that sets no share (a narrowed AniList browse) is counted and unshared
  test('a tie, and a show with a count and no share, go by the count, after every shared show', () => {
    const tied = [media('anilist:3', 9_000), media('kitsu:2', 4_841, 1), media('anilist:1', 120_000), media('mal:1', 367_295, 1)]
    expect(uris(applyMediaSorts(tied, { sorts: ['POPULARITY_DESC'], ...SUMMER }))).toEqual(['mal:1', 'kitsu:2', 'anilist:1', 'anilist:3'])
    expect(uris(applyMediaSorts(tied, { sorts: ['POPULARITY'], ...SUMMER }))).toEqual(['kitsu:2', 'mal:1', 'anilist:3', 'anilist:1'])
  })
})
