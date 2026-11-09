import { expect, test } from 'vite-plus/test'

import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'

const member = (uri: string, score: number, raw: Record<string, unknown>) => {
  const origin = uri.slice(0, uri.indexOf(':'))
  return { uri, origin, id: uri.slice(origin.length + 1), owned: true, score, raw: { uri, origin, ...raw }, fieldSeq: {} }
}

const aggregated = (...members: ReturnType<typeof member>[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
})

const followers = (...members: ReturnType<typeof member>[]) => aggregated(...members).followers

// Fall 2026, 2026-10-17: with Kitsu answering before AniList, I'm Dating a Dark Summoner dropped from place 43 to
// about 120 for a second, its bundled 22,442 replaced by Kitsu's user count
test('kitsu\'s count gives way to the bundle\'s, though kitsu scores above it', () => {
  expect(followers(member('offline:mal-1', 0.2, { followers: 22_442 }), member('kitsu:1', 0.3, { followers: 280 }))).toBe(22_442)
  expect(followers(member('kitsu:1', 0.3, { followers: 280 }), member('offline:mal-1', 0.2, { followers: 22_442 }), member('anilist:1', 0.8, { followers: 22_500 })), 'the control: AniList\'s still wins').toBe(22_500)
  expect(followers(member('kitsu:1', 0.3, { followers: 84 })), 'and kitsu\'s stands when it is the only count').toBe(84)
})

// Kitsu ranks its own catalogue and shares out its own, smaller following, so the share and the rank give way the
// same way the count does, to the bundle's below it too
test('the share of the season and the all-time rank give way past kitsu the same way', () => {
  const show = aggregated(
    member('kitsu:1', 0.3, { followers: 4_000, popularity: 1, popularityRank: 2_000 }),
    member('offline:mal-1', 0.2, { followers: 300_000, popularity: 0.8, popularityRank: 500 }),
  )
  expect([show.followers, show.popularity, show.popularityRank]).toEqual([300_000, 0.8, 500])

  const kitsuOnly = aggregated(member('kitsu:2', 0.3, { followers: 200, popularity: 0.05, popularityRank: 9_000 }), member('offline:mal-2', 0.2, {}))
  expect([kitsuOnly.followers, kitsuOnly.popularity, kitsuOnly.popularityRank], 'kitsu\'s stand where no other member has any').toEqual([200, 0.05, 9_000])
})
