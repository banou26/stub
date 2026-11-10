/**
 * A season page lists, labels and ranks the same shows whether the tab opened it fresh or reached it from another
 * season.
 *
 * Shaped on Summer and Fall 2026 as their sources answered on 2026-11-10. MyAnimeList's page for each lists
 * Steel Ball Run (`mal:61469`, an ONA airing across both), and the bundled data holds it in both buckets, at 0.67
 * of Summer's top and 1 of Fall's. Kaiju No. 8: Narumi's Week at Work (`mal:63138`) is on MyAnimeList's Summer page
 * alone, and in both buckets. Each answer stamps the season it was asked for and its share of it, the home row asks
 * for the season running now (Fall), and the answer log folds a byte-identical re-fetch nowhere, so Home, then
 * Summer, then Fall left each row reading Summer.
 */
import { beforeAll, expect, test } from 'vite-plus/test'

import { enableGraph } from '../../../../src/worker/graph'
import { applyMediaSorts } from '../../../../src/worker/store/filter'
import { pageAfter } from './page-visits'
import { media, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

type Season = 'SUMMER' | 'FALL'

const row = (uri: string, season: Season, fields: Record<string, unknown>) =>
  media(uri, { type: 'ONA', season, seasonYear: 2026, categories: ['ANIME', 'SERIES'], ...fields })

const SHARE = { SUMMER: { steelBallRun: 0.67, kaiju: 0.0657 }, FALL: { steelBallRun: 1, kaiju: 0.111 } }

const steelBallRun = (season: Season) => [
  row('mal:61469', season, {
    score: 0.9,
    followers: 256087,
    popularity: SHARE[season].steelBallRun,
    titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.9)],
  }),
  row('offline:mal-61469', season, {
    score: 0.2,
    followers: 256087,
    popularity: SHARE[season].steelBallRun,
    titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.2)],
    handles: [sameAs(media('mal:61469')), sameAs(media('anilist:190327'))],
  }),
]

const offlineKaiju = (season: Season) => row('offline:mal-63138', season, {
  score: 0.2,
  followers: 25115,
  popularity: SHARE[season].kaiju,
  titles: [title('en', 'Kaiju No. 8: Narumi\'s Week at Work', 0.2)],
  handles: [sameAs(media('mal:63138')), sameAs(media('anilist:204431')), sameAs(media('kitsu:50452'))],
})

const malKaiju = row('mal:63138', 'SUMMER', {
  score: 0.9,
  followers: 25115,
  popularity: SHARE.SUMMER.kaiju,
  titles: [title('en', 'Kaiju No. 8: Narumi\'s Week at Work', 0.9)],
})

// Answered on the Fall page but stated in Summer by every source: the filter must still keep it off.
const summerOnly = row('kitsu:1', 'SUMMER', { score: 0.3, titles: [title('en', 'Summer Only', 0.3)] })

const ANSWERS: Record<Season, Record<string, unknown>[]> = {
  SUMMER: [...steelBallRun('SUMMER'), offlineKaiju('SUMMER'), malKaiju],
  FALL: [...steelBallRun('FALL'), offlineKaiju('FALL'), summerOnly],
}

/**
 * The shows the last visited page lists after the pages before it, in its order, each by the MyAnimeList id its
 * members name with the season and the share it is drawn with.
 */
const listed = async (seasons: Season[]): Promise<string[]> => {
  const input = { season: seasons.at(-1), seasonYear: 2026, sorts: ['POPULARITY_DESC'] }
  const page = applyMediaSorts(await pageAfter(seasons.map(season => ANSWERS[season]), input), input)
  return page.map(card => [
    [...new Set(card.members.map(uri => uri.replace(/^offline:mal-/, 'mal:')))].filter(uri => uri.startsWith('mal:')).join(),
    card.season,
    card.seasonYear,
    card.popularity,
  ].join(' '))
}

// Mutation: drop `seasonPairs` from the season check in store/filter.ts, or stop `mergeMediaFields` keeping the pairs,
// and the Fall page after Summer loses both shows; draw a row with its own season rather than the pair it matched,
// and they read Summer there; keep no share in a pair, and they rank by Summer's.
test('Fall after Home and Summer lists what a fresh Fall lists', async () => {
  const fresh = await listed(['FALL'])
  expect(fresh, 'the control: a fresh Fall lists both, as Fall, and not the Summer-only row').toEqual([
    'mal:61469 FALL 2026 1',
    'mal:63138 FALL 2026 0.111',
  ])
  expect(await listed(['FALL', 'SUMMER', 'FALL']), 'the home row asks for Fall first').toEqual(fresh)
  expect(await listed(['SUMMER', 'FALL'])).toEqual(fresh)
})

test('and Summer after Fall lists what a fresh Summer lists', async () => {
  const fresh = await listed(['SUMMER'])
  expect(fresh, 'the control: a fresh Summer lists both, as Summer').toEqual([
    'mal:61469 SUMMER 2026 0.67',
    'mal:63138 SUMMER 2026 0.0657',
  ])
  expect(await listed(['SUMMER', 'FALL', 'SUMMER'])).toEqual(fresh)
  expect(await listed(['FALL', 'SUMMER'])).toEqual(fresh)
})
