// The build's id merge (scripts/merge-ids.mjs): an id two shows claim is cleared from both, in every
// column, Anime News Network's included.
import { expect, test } from 'vite-plus/test'

import { encodeIndex, mergeIds } from '../../../../scripts/merge-ids.mjs'

// manami rows are [mal, anilist, kitsu, anidb, ann]; arm entries carry mal and anilist only
const ARM = [{ mal_id: 1, anilist_id: 1 }, { mal_id: 5114, anilist_id: 5114 }]

// Mutation: drop 'ann' from COLUMNS and the claimed id ships on both rows.
test('an ANN id two rows claim is cleared from both, as an AniDB one is', () => {
  const { kept, cleared } = mergeIds(ARM, [[1, 1, 1, 23, 13], [5114, 5114, 3936, 23, 13], [16498, 16498, 7442, 9541, 14950]])

  expect(kept.map(({ mal, anidb, ann }) => [mal, anidb, ann])).toEqual([[1, 0, 0], [5114, 0, 0], [16498, 9541, 14950]])
  expect(cleared).toBe(4)
  expect(encodeIndex(kept).ann).toEqual([0, 0, 14950])
})
