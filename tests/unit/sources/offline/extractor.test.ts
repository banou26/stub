import { expect, test, vi } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/offline/extractor'

// Cowboy Bebop outside the season window, Frieren inside it; columns are [mal (delta coded), anilist, kitsu, anidb, ann]
vi.mock('../../../../src/generated/anime-index', () => ({
  default: { mal: [1, 52990], anilist: [1, 154587], kitsu: [1, 46474], anidb: [23, 17617], ann: [13, 25544] },
}))
vi.mock('../../../../src/generated/anime-seasons', () => ({
  default: { tag: 'test', updated: '', seasons: { '2026-FALL': [{ t: 'Frieren', ty: 'TV', p: '', ml: 52991, al: 154587, ku: 46474 }] } },
}))

const handlesOf = async (uri: string) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, { fetch: async () => new Response(null, { status: 404 }) } as never).next()
  return value.media.handles.map(({ node }: { node: { uri: string } }) => node.uri)
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
