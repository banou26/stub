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
