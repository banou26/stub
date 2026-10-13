import { describe, expect, test } from 'vite-plus/test'

import { SCORE, recordId, seasonKey, seasonMedia, seasonPage, type ManamiRecord } from '../../../../src/sources/offline/normalize'
import SAMPLES from '../../../fixtures/descriptions/samples.json'

const record = (overrides: Partial<ManamiRecord> = {}): ManamiRecord => ({
  t: 'Some Show',
  ty: 'TV',
  p: '1234/56789.jpg',
  ml: 51478,
  ...overrides,
})

describe('seasonKey', () => {
  // animeSeasonOf answers in lower case and the generated bundle is keyed in upper case, so this is
  // the one place the two spellings meet. Getting it wrong returns undefined for every season, which
  // renders as an empty row rather than as an error.
  test('upper-cases the season to match the bundle key', () => {
    expect(seasonKey({ season: 'summer', year: 2026 })).toBe('2026-SUMMER')
    expect(seasonKey({ season: 'fall', year: 2027 })).toBe('2027-FALL')
  })
})

describe('recordId', () => {
  // Identity is borrowed in a fixed order so one show keeps one uri across builds. If this order
  // ever varied, a rebuild would issue a different uri for the same show and the store would treat
  // it as a new media.
  test('prefers myanimelist, then anilist, then kitsu', () => {
    expect(recordId(record({ ml: 1, al: 2, ku: 3 }))).toBe('mal-1')
    expect(recordId(record({ ml: undefined, al: 2, ku: 3 }))).toBe('anilist-2')
    expect(recordId(record({ ml: undefined, al: undefined, ku: 3 }))).toBe('kitsu-3')
  })

  test('has no identity without a catalog id', () => {
    expect(recordId(record({ ml: undefined, al: undefined, ku: undefined }))).toBeUndefined()
  })
})

describe('seasonMedia', () => {
  test('carries every catalog id as a handle, which is what merges it', () => {
    const media = seasonMedia(record({ ml: 51478, al: 142051, ku: 47450 }))!
    expect(media.handles.map(handle => handle.node.origin).sort()).toEqual(['anilist', 'kitsu', 'mal'])
    expect(media.handles.find(handle => handle.node.origin === 'anilist')?.node.id).toBe('142051')
  })

  // and asks for the LARGE spelling while it is there: the plain one manami stores is 225x318 and the
  // `l` one is 425x600, measured across six bundle images 2026-09-06
  test('restores the cover prefix the build strips, at the large size', () => {
    expect(seasonMedia(record())!.covers[0]?.url).toBe('https://cdn.myanimelist.net/images/anime/1234/56789l.webp')
  })

  // 380 of 874 rows in the shipped bundle are this case: manami took the picture from somewhere that
  // is not MyAnimeList, so the build's prefix strip did nothing and re-adding it here would produce
  // `cdn.myanimelist.net/images/anime/https://media.kitsu.app/...`.
  test('leaves a picture that is already a full url alone', () => {
    const kitsu = 'https://media.kitsu.app/anime/50809/poster_image/small-b269a50b.jpg'
    expect(seasonMedia(record({ p: kitsu }))!.covers[0]?.url).toBe(kitsu)
    const ann = 'https://cdn.animenewsnetwork.com/thumbnails/max500x600/encyc/A29823-188936182.jpg'
    expect(seasonMedia(record({ p: ann }))!.covers[0]?.url).toBe(ann)
  })

  // A dump can be weeks old, so it must lose every scalar tiebreak against a live source. Raising
  // this to anilist's 0.9 would also push these titles into the six-slot cluster profile the fuzzy
  // merge compares on, which is the mechanism behind the digit-residue regression.
  test('scores below every live source, on the media and on each item', () => {
    const media = seasonMedia(record())!
    expect(SCORE).toBeLessThan(0.3)
    expect(media.score).toBe(SCORE)
    expect(media.titles[0]?.score).toBe(SCORE)
    expect(media.covers[0]?.score).toBe(SCORE)
  })

  // manami's own status is a snapshot from the dump's cut date: the 2026-07-04 dump marks 192 of its
  // 219 SUMMER 2026 entries UPCOMING, and all of them were airing six weeks later. Carrying it would
  // let a stale value win against a live source that knows better.
  test('claims no status, no dates and no popularity', () => {
    const media = seasonMedia(record())
    expect(media?.status).toBeUndefined()
    expect(media?.startDate).toBeUndefined()
    expect(media?.endDate).toBeUndefined()
    expect(media?.popularity).toBeUndefined()
  })

  test('converts the 1 to 10 score onto the schema 0 to 100 scale', () => {
    expect(seasonMedia(record({ sc: 7.42 }))!.averageScore).toBe(74)
    expect(seasonMedia(record({ sc: undefined }))!.averageScore).toBeUndefined()
  })

  test('files a movie as a movie and everything else as a series', () => {
    expect(seasonMedia(record({ ty: 'MOVIE' }))!.categories).toContain('MOVIE')
    expect(seasonMedia(record({ ty: 'TV' }))!.categories).toContain('SERIES')
    expect(seasonMedia(record({ ty: 'ONA' }))!.categories).toContain('SERIES')
  })

  // An unknown type must still produce a media. manami emits UNKNOWN, and dropping those would lose
  // real entries from the row for a field nothing renders.
  test('keeps a record whose type it does not recognise', () => {
    const media = seasonMedia(record({ ty: 'UNKNOWN' }))
    expect(media).toBeDefined()
    expect(media!.type).toBeUndefined()
  })
})

describe('seasonPage', () => {
  // The duplicate control. A record with no id cannot union with anything, so if another source
  // already describes that show the user sees it twice with no way for the store to know.
  test('drops records carrying no catalog id at all', () => {
    const page = seasonPage([
      record({ t: 'Mergeable' }),
      record({ t: 'Orphan', ml: undefined, al: undefined, ku: undefined }),
    ])
    expect(page).toHaveLength(1)
    expect(page[0]?.titles[0]?.title).toBe('Mergeable')
  })

  test('is empty rather than throwing on an empty season', () => {
    expect(seasonPage([])).toEqual([])
  })
})

// The bundle's ORDER only decides the cold paint while every row lacks a popularity, because the
// listing sorts on it with a stable sort. Publishing the member count makes the order explicit: a
// bundled row keeps its place once live rows with popularity arrive, instead of being swept to the
// tail. Safe at the offline score of 0.2 because jikan publishes the same MyAnimeList count at 0.9
// and wins the aggregate, so the value can only ever be restated, never contradicted.
test('a seasonal row publishes the member count the build attached', () => {
  expect(seasonMedia({ t: 'Mushoku Tensei III', ty: 'TV', p: '', ml: 59193, pop: 254638 })?.popularity)
    .toBe(254638)
})

test('a row the count did not cover publishes none, rather than a zero that outranks nothing', () => {
  expect(seasonMedia({ t: 'Obscure Short', ty: 'TV', p: '', ml: 1 })?.popularity).toBeUndefined()
})

// The homepage hero renders nothing until a live source answers, because `theaterCandidates` keeps
// only media carrying BOTH titles and shortDescriptions, and manami has no synopsis of any kind. A
// trailer is preferred rather than required, so a synopsis alone is what makes the hero paint cold.
// It comes from the same read of MyAnimeList's season page as the member counts.
test('a seasonal row publishes the synopsis the hero selects on', () => {
  const media = seasonMedia({ t: 'Mushoku Tensei III', ty: 'TV', p: '', ml: 59193, sy: 'Third season of Mushoku Tensei.' })

  expect(media?.shortDescriptions?.[0]?.shortDescription).toBe('Third season of Mushoku Tensei.')
  expect(media?.shortDescriptions?.[0]?.language, 'the hero reads the first entry, so it needs a shape').toBe('en')
})

test('a seasonal synopsis is published without the credit ending it', () => {
  const media = seasonMedia(record({ sy: SAMPLES.malSpyFamily.description }))

  expect(media?.shortDescriptions?.[0]?.shortDescription).toMatch(/family life\.$/)
})

test('a row with no synopsis publishes none, so the hero simply does not pick it', () => {
  const media = seasonMedia({ t: 'Obscure', ty: 'TV', p: '', ml: 2 })

  expect(media?.shortDescriptions).toEqual([])
})
