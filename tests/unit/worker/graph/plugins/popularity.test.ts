import { expect, test } from 'vite-plus/test'

import { aggregateFields } from '../../../../../src/worker/graph/plugins/fields'

const member = (uri: string, score: number, popularity: number) => {
  const origin = uri.slice(0, uri.indexOf(':'))
  return { uri, origin, id: uri.slice(origin.length + 1), owned: true, score, raw: { uri, origin, popularity }, fieldSeq: {} }
}

const popularity = (...members: ReturnType<typeof member>[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
  members,
  related: [],
  relations: [],
  locationOrigin: '',
}).popularity

// Fall 2026, 2026-10-17: with Kitsu answering before AniList, I'm Dating a Dark Summoner dropped from place 43 to
// about 120 for a second, its bundled 22,442 replaced by Kitsu's user count
test('kitsu\'s count gives way to the bundle\'s, though kitsu scores above it', () => {
  expect(popularity(member('offline:mal-1', 0.2, 22_442), member('kitsu:1', 0.3, 280))).toBe(22_442)
  expect(popularity(member('kitsu:1', 0.3, 280), member('offline:mal-1', 0.2, 22_442), member('anilist:1', 0.8, 22_500)), 'the control: AniList\'s still wins').toBe(22_500)
  expect(popularity(member('kitsu:1', 0.3, 84)), 'and kitsu\'s stands when it is the only count').toBe(84)
})
