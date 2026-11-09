/**
 * A season page lists the same shows whether the tab opened it fresh or reached it from another season.
 *
 * Shaped on Summer and Fall 2026 as their sources answered on 2026-11-10. MyAnimeList's page for each lists
 * Steel Ball Run (`mal:61469`, an ONA airing across both), and the bundled data holds it in both buckets.
 * Kaiju No. 8: Narumi's Week at Work (`mal:63138`) is on MyAnimeList's Summer page alone, and in both buckets.
 * Each answer stamps the season it was asked for, the home row asks for the season running now (Fall), and
 * the answer log folds a byte-identical re-fetch nowhere, so before STUB-371 Home, then Summer, then Fall left
 * both shows off the Fall page.
 *
 * The answers go through the log as a page's do, so a re-fetch is deduplicated exactly as in the app.
 */
import { beforeAll, expect, test } from 'vite-plus/test'

import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'
import type { Media } from '../../../../src/generated/schema/types.generated'

import { enableGraph } from '../../../../src/worker/graph'
import { flushAnswers, recordAnswers } from '../../../../src/worker/graph/answers'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { createPageReader } from '../../../../src/worker/graph/read'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import { passSettled, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { pageRows } from '../../../../src/worker/store/filter'
import { media, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

type Season = 'SUMMER' | 'FALL'

const row = (uri: string, season: Season, fields: Record<string, unknown>) =>
  media(uri, { type: 'ONA', season, seasonYear: 2026, categories: ['ANIME', 'SERIES'], ...fields })

const steelBallRun = (season: Season) => [
  row('mal:61469', season, { score: 0.9, popularity: 256087, titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.9)] }),
  row('offline:mal-61469', season, {
    score: 0.2,
    popularity: 256087,
    titles: [title('en', 'Steel Ball Run: JoJo\'s Bizarre Adventure', 0.2)],
    handles: [sameAs(media('mal:61469')), sameAs(media('anilist:190327'))],
  }),
]

const offlineKaiju = (season: Season) => row('offline:mal-63138', season, {
  score: 0.2,
  popularity: 25115,
  titles: [title('en', 'Kaiju No. 8: Narumi\'s Week at Work', 0.2)],
  handles: [sameAs(media('mal:63138')), sameAs(media('anilist:204431')), sameAs(media('kitsu:50452'))],
})

const malKaiju = row('mal:63138', 'SUMMER', { score: 0.9, popularity: 25115, titles: [title('en', 'Kaiju No. 8: Narumi\'s Week at Work', 0.9)] })

// Answered on the Fall page but stated in Summer by every source: the filter must still keep it off.
const summerOnly = row('kitsu:1', 'SUMMER', { score: 0.3, titles: [title('en', 'Summer Only', 0.3)] })

const ANSWERS: Record<Season, Record<string, unknown>[]> = {
  SUMMER: [...steelBallRun('SUMMER'), offlineKaiju('SUMMER'), malKaiju],
  FALL: [...steelBallRun('FALL'), offlineKaiju('FALL'), summerOnly],
}

const PAGE_PATH = { prev: { prev: undefined, key: 'mediaPage', typename: 'Subscription' }, key: 'nodes', typename: 'MediaPage' }

/** One season page's answers, through the log and the ingest, settled. Answers its uris. */
const visit = async (season: Season): Promise<string[]> => {
  await recordAnswers({ path: PAGE_PATH, variableValues: {} }, 'Media', ANSWERS[season])
  await flushAnswers()
  await passSettled()
  return ANSWERS[season].map(answer => String(answer.uri))
}

/** The shows the last visited page lists after the pages before it, each by the MyAnimeList id its members name. */
const listed = async (seasons: Season[]): Promise<string[]> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ audit: false })
  try {
    let uris: string[] = []
    for (const season of seasons) uris = await visit(season)
    const cards = await createPageReader().read(uris)
    const page = pageRows(cards as unknown as (Media & ClusterCard)[], { season: seasons.at(-1), seasonYear: 2026 }, uris, 'anime')
    return page.map(card => [...new Set(card.members.map(uri => uri.replace(/^offline:mal-/, 'mal:')))].filter(uri => uri.startsWith('mal:')).join()).sort()
  } finally {
    stopScheduler()
  }
}

const BOTH = ['mal:61469', 'mal:63138']

// Mutation: drop `seasonPairs` from the season check in store/filter.ts, or stop `mergeMediaFields` keeping
// the pairs, and the Fall page after Summer loses both shows.
test('Fall after Home and Summer lists what a fresh Fall lists', async () => {
  const fresh = await listed(['FALL'])
  expect(fresh, 'the control: a fresh Fall lists both, and not the Summer-only row').toEqual(BOTH)
  expect(await listed(['FALL', 'SUMMER', 'FALL']), 'the home row asks for Fall first').toEqual(fresh)
  expect(await listed(['SUMMER', 'FALL'])).toEqual(fresh)
})

test('and Summer after Fall lists what a fresh Summer lists', async () => {
  const fresh = await listed(['SUMMER'])
  expect(fresh, 'the control: a fresh Summer lists both').toEqual(BOTH)
  expect(await listed(['SUMMER', 'FALL', 'SUMMER'])).toEqual(fresh)
  expect(await listed(['FALL', 'SUMMER'])).toEqual(fresh)
})
