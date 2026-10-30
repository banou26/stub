import { afterEach, expect, test, vi } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/offline/extractor'

// Cowboy Bebop outside the season window, Frieren inside it; columns are [mal (delta coded), anilist, kitsu, anidb, ann]
vi.mock('../../../../src/generated/anime-index', () => ({
  default: { mal: [1, 52990], anilist: [1, 154587], kitsu: [1, 46474], anidb: [23, 17617], ann: [13, 25544] },
}))
// Works bundled in two seasons, as the real bundle has some: Witch and Mercenary's listed out of calendar
// order, and Sekiro's across a new year with a different record in each
vi.mock('../../../../src/generated/anime-seasons', () => {
  const beyond = { t: 'To You in the Beyond', ty: 'TV', p: '', ml: 63423 }
  const witch = { t: 'Witch and Mercenary', ty: 'TV', p: '', ml: 63958 }
  const sekiro = (ty: string) => ({ t: 'Sekiro: No Defeat', ty, p: '', ml: 62312 })
  return {
    default: {
      tag: 'test',
      updated: '',
      seasons: {
        '2026-SUMMER': [beyond, sekiro('MOVIE'), { t: 'A Summer Show', ty: 'TV', p: '', ml: 61009 }],
        '2026-FALL': [{ t: 'Frieren', ty: 'TV', p: '', ml: 52991, al: 154587, ku: 46474 }, beyond],
        '2027-SPRING': [witch],
        '2027-WINTER': [witch, sekiro('TV')],
      },
    },
  }
})

// The history's shards: Cowboy Bebop (indexed, outside the season window), its film (no index row), a record with
// no MyAnimeList id reached from its Kitsu id, and Frieren, which the season bundle also holds
vi.mock('../../../../src/sources/offline/history-shards', () => {
  const sets: Record<string, Record<number, Record<string, unknown>>> = {
    dump: {
      1: { 'mal-1': ['Cowboy Bebop', '4/19644.jpg'] },
      5: { 'mal-5': ['Cowboy Bebop: Tengoku no Tobira', '1439/93480.jpg'] },
      7: { 'kitsu-7': 'anilist-300' },
      44: { 'anilist-300': ['Daicon III Opening Animation', ''] },
      127: { 'mal-52991': ['Sousou no Frieren', ''] },
    },
    stub: {
      1: { 'mal-1': { d: 'In the year 2071, humanity has colonized several of the planets.' } },
      5: { 'mal-5': { t: 'Cowboy Bebop: The Movie' } },
    },
  }
  return { loadShard: async (set: string, shard: number) => sets[set]?.[shard] && { records: sets[set]![shard] } }
})

afterEach(() => {
  vi.useRealTimers()
})

const mediaOf = async (uri: string) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, { fetch: async () => new Response(null, { status: 404 }) } as never).next()
  return value.media
}

const handlesOf = async (uri: string) =>
  (await mediaOf(uri)).handles.map(({ node }: { node: { uri: string } }) => node.uri)

const mediaOn = async (uri: string, today: string) => {
  vi.useFakeTimers({ now: Date.parse(today), toFake: ['Date'] })
  return mediaOf(uri)
}

const seasonOf = async (uri: string, today: string) => {
  const { season, seasonYear } = await mediaOn(uri, today)
  return `${season} ${seasonYear}`
}

// Mutation: drop the `row.ann` handle from `handleCarrier`.
test('a title outside the season window names its Anime News Network entry', async () => {
  expect(await handlesOf('mal:1')).toContain('ann:13')
})

// Mutation: return the seasonal record without the row's handles.
test('a title in the season window names its AniDB and Anime News Network entries, whichever uri asks', async () => {
  expect(await handlesOf('mal:52991')).toEqual(['mal:52991', 'anilist:154587', 'kitsu:46474', 'anidb:17617', 'ann:25544'])
  expect(await handlesOf('offline:mal-52991')).toEqual(['mal:52991', 'anilist:154587', 'kitsu:46474', 'anidb:17617', 'ann:25544'])
})

// Mutation: look the seasonal record's row up by every uri in the address.
test('a seasonal record never takes the handles of another show named in the same address', async () => {
  expect(await handlesOf('ag:(mal:1,offline:mal-52991)')).not.toContain('ann:13')
})

// Mutations: return the first bucket that lists the id; return the latest one; return the earliest one.
test('a work bundled in two seasons is filed in the current one', async () => {
  expect(await seasonOf('offline:mal-63423', '2026-10-17T12:00:00Z')).toBe('FALL 2026')
  expect(await seasonOf('offline:mal-63958', '2027-01-15T12:00:00Z')).toBe('WINTER 2027')
})

// Mutations: return the current bucket, else the latest; return the first one the bundle lists; the last one.
test('a work bundled in two seasons still to come is filed in the earlier', async () => {
  expect(await seasonOf('offline:mal-63423', '2026-05-01T12:00:00Z')).toBe('SUMMER 2026')
  expect(await seasonOf('offline:mal-63958', '2026-05-01T12:00:00Z')).toBe('WINTER 2027')
})

// Mutations: return the earliest bucket; drop the fallback to the latest.
test('a work bundled in two seasons already over is filed in the later', async () => {
  expect(await seasonOf('offline:mal-63423', '2027-01-15T12:00:00Z')).toBe('FALL 2026')
})

// Mutations: sort the seasons without their year; build the record from the first bucket that lists the id.
test('a work bundled in a season over and one to come across a new year takes the one to come, and its record', async () => {
  const { season, seasonYear, type } = await mediaOn('offline:mal-62312', '2026-10-17T12:00:00Z')
  expect({ season, seasonYear, type }).toEqual({ season: 'WINTER', seasonYear: 2027, type: 'TV' })
})

// Mutation: answer only the current season's bucket.
test('a work bundled only in an earlier season keeps it', async () => {
  expect(await seasonOf('offline:mal-61009', '2026-10-17T12:00:00Z')).toBe('SUMMER 2026')
})

// Mutation: answer the index row's carrier without its history record.
test('a title outside the season window answers its history record, with the index row\'s handles', async () => {
  const media = await mediaOf('mal:1')
  expect(media.titles.map(({ title }: { title: string }) => title)).toEqual(['Cowboy Bebop'])
  expect(media.covers.map(({ url }: { url: string }) => url)).toEqual(['https://cdn.myanimelist.net/images/anime/4/19644l.webp'])
  expect(media.descriptions.map(({ description }: { description: string }) => description)).toEqual(['In the year 2071, humanity has colonized several of the planets.'])
  expect(await handlesOf('mal:1')).toEqual(['mal:1', 'anilist:1', 'kitsu:1', 'anidb:23', 'ann:13'])
  expect((await mediaOf('offline:mal-1')).titles[0].title).toBe('Cowboy Bebop')
})

// Mutations: answer nothing when the index has no row; give the record handles beyond its own key's.
test('a show the index has no row for answers its history record, with its own catalogue id as its one handle', async () => {
  const media = await mediaOf('mal:5')
  expect([media.uri, media.titles[0].title]).toEqual(['offline:mal-5', 'Cowboy Bebop: The Movie'])
  expect(await handlesOf('mal:5')).toEqual(['mal:5'])
})

// Mutation: try only the first of the address's ids against the history.
test('an address whose first id the history lacks answers the record a later id names', async () => {
  const media = await mediaOf('ag:(anilist:999,mal:5)')
  expect([media.uri, media.titles[0].title]).toEqual(['offline:mal-5', 'Cowboy Bebop: The Movie'])
})

// Mutation: look a Kitsu id up only under its own key.
test('the Kitsu id of a record with no MyAnimeList id reaches it through the history', async () => {
  const media = await mediaOf('kitsu:7')
  expect([media.uri, media.titles[0].title]).toEqual(['offline:anilist-300', 'Daicon III Opening Animation'])
  expect(await handlesOf('kitsu:7')).toEqual(['anilist:300'])
})

// Mutation: ask the history before the season bundle.
test('a show the season bundle holds still answers its bundled record, not its history one', async () => {
  const media = await mediaOn('mal:52991', '2026-10-17T12:00:00Z')
  expect([media.titles[0].title, media.season, media.seasonYear]).toEqual(['Frieren', 'FALL', 2026])
})

// Mutation: answer from the history a show neither the index nor the history holds.
test('a show the history does not hold answers nothing', async () => {
  expect(await mediaOf('mal:9')).toBeNull()
})
