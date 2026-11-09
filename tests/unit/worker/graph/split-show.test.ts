/**
 * A show Kitsu maps under its MyAnimeList id twice is one card on a season page, whichever season the tab opened first.
 *
 * Ghost Meets Gal! as its sources answered on 2026-11-10: AniList lists 214703 in Summer 2026, naming MyAnimeList 64718;
 * Kitsu lists 50866 in Fall, mapping MyAnimeList 64718 and AniList 64718, which AniList does not have; the bundled data
 * holds the show in both seasons with AniList 214703 and Kitsu 50866. The home row asks for the season running now
 * (Fall), so Home, then Summer drew the show as two cards where a fresh Summer draws one.
 *
 * Kitsu's rows come out of its own extractor, from its answers as recorded, so the mapping it reads is the one tested.
 * The answers go through the log as a page's do.
 */
import { beforeAll, expect, test } from 'vite-plus/test'

import type { ClusterCard } from '../../../../src/worker/graph/plugins/fields'
import type { Media } from '../../../../src/generated/schema/types.generated'

import { resolvers } from '../../../../src/sources/kitsu/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { flushAnswers, recordAnswers } from '../../../../src/worker/graph/answers'
import { resetPassState } from '../../../../src/worker/graph/plugins/runner'
import { createPageReader } from '../../../../src/worker/graph/read'
import { graphReady, GRAPH_NODE_TABLES } from '../../../../src/worker/graph/schema'
import { passSettled, startScheduler, stopScheduler } from '../../../../src/worker/graph/scheduler'
import { pageRows } from '../../../../src/worker/store/filter'
import { media, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

type Page = 'SUMMER 2026' | 'FALL 2026' | 'SPRING 2013' | 'WINTER 2027'
type Row = Record<string, unknown>

const seasonOf = (page: Page) => {
  const [season, seasonYear] = page.split(' ')
  return { season: season!, seasonYear: Number(seasonYear) }
}

/** One Kitsu record as its season listing answers it, with its mappings included. */
const kitsuRecord = (id: string, attributes: Row, mappings: [string, string][]) => ({
  data: { id, type: 'anime', attributes, relationships: { mappings: { data: mappings.map((_, i) => ({ type: 'mappings', id: `${id}${i}` })) } } },
  included: mappings.map(([externalSite, externalId], i) => ({ id: `${id}${i}`, type: 'mappings', attributes: { externalSite, externalId } })),
})

/** Kitsu's rows for one season, read off `records` on the listing's first page by the Kitsu source. */
const kitsuSeason = async (page: Page, records: ReturnType<typeof kitsuRecord>[]): Promise<Row[]> => {
  const ctx = {
    fetch: async (url: string) => ({
      json: async () => url.includes('page%5Bnumber%5D=1&')
        ? { data: records.map(record => record.data), included: records.flatMap(record => record.included) }
        : { data: [], included: [] },
    }),
  } as never
  const { value } = await (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input: seasonOf(page) }, ctx).next()
  return JSON.parse(JSON.stringify(value.mediaPage.nodes))
}

const row = (uri: string, page: Page, name: string, fields: Row) =>
  media(uri, { type: 'TV', ...seasonOf(page), categories: ['ANIME', 'SERIES'], titles: [title('en', name, 0.8)], ...fields })

const GAL = 'Ghost Meets Gal!'
const TITAN = 'Attack on Titan'
const SEKIRO = 'Sekiro: No Defeat'

const ANSWERS: Record<Page, () => Promise<Row[]>> = {
  'SUMMER 2026': async () => [
    row('anilist:214703', 'SUMMER 2026', GAL, { type: 'TV_SHORT', handles: [sameAs(media('mal:64718'))] }),
    row('offline:mal-64718', 'SUMMER 2026', GAL, { type: 'TV_SHORT', handles: [sameAs(media('mal:64718')), sameAs(media('anilist:214703'))] }),
  ],
  'FALL 2026': async () => [
    ...await kitsuSeason('FALL 2026', [
      kitsuRecord('50866', { canonicalTitle: GAL, titles: { en_jp: GAL }, subtype: 'TV', startDate: '2026-09-05' }, [
        ['myanimelist/anime', '64718'],
        ['anilist/anime', '64718'],
      ]),
    ]),
    row('mal:64718', 'FALL 2026', GAL, {}),
    row('offline:mal-64718', 'FALL 2026', GAL, {
      handles: [sameAs(media('mal:64718')), sameAs(media('anilist:214703')), sameAs(media('kitsu:50866'))],
    }),
  ],
  // the controls: an id AniList took from MyAnimeList, which Kitsu rightly maps under both, and an AniList id Kitsu
  // maps with no MyAnimeList one beside it
  'SPRING 2013': async () => [
    ...await kitsuSeason('SPRING 2013', [
      kitsuRecord('7442', { canonicalTitle: TITAN, titles: { en: TITAN }, subtype: 'TV', startDate: '2013-04-07' }, [
        ['myanimelist/anime', '16498'],
        ['anilist/anime', '16498'],
      ]),
    ]),
    row('anilist:16498', 'SPRING 2013', TITAN, { handles: [sameAs(media('mal:16498'))] }),
  ],
  'WINTER 2027': async () => [
    ...await kitsuSeason('WINTER 2027', [
      kitsuRecord('50104', { canonicalTitle: SEKIRO, titles: { en: SEKIRO }, subtype: 'TV', startDate: '2027-01-08' }, [
        ['anilist/anime', '197620'],
      ]),
    ]),
    row('anilist:197620', 'WINTER 2027', SEKIRO, { handles: [sameAs(media('mal:62312'))] }),
  ],
}

const PAGE_PATH = { prev: { prev: undefined, key: 'mediaPage', typename: 'Subscription' }, key: 'nodes', typename: 'MediaPage' }

const visit = async (page: Page): Promise<string[]> => {
  const answers = await ANSWERS[page]()
  await recordAnswers({ path: PAGE_PATH, variableValues: {} }, 'Media', answers)
  await flushAnswers()
  await passSettled()
  return answers.map(answer => String(answer.uri))
}

/** The cards the last page visited lists after the pages before it, each as its members. */
const listed = async (pages: Page[]): Promise<string[][]> => {
  const { query } = await graphReady()
  for (const table of GRAPH_NODE_TABLES) await query(`MATCH (n:${table}) DETACH DELETE n`)
  resetPassState()
  startScheduler({ audit: false })
  try {
    let uris: string[] = []
    for (const page of pages) uris = await visit(page)
    const cards = await createPageReader().read(uris)
    return pageRows(cards as unknown as (Media & ClusterCard)[], seasonOf(pages.at(-1)!), uris, 'anime').map(card => [...card.members].sort())
  } finally {
    stopScheduler()
  }
}

// Mutation: claim Kitsu's AniList mapping when it repeats its MyAnimeList one (`mappingHandles` in
// src/sources/kitsu/extractor.ts), and Summer after Fall draws the show as two cards.
test('Ghost Meets Gal! is one card on Summer after the Fall page, as on a fresh Summer', async () => {
  const fresh = await listed(['SUMMER 2026'])
  expect(fresh, 'the control: a fresh Summer draws it once').toEqual([['anilist:214703', 'mal:64718', 'offline:mal-64718']])
  expect(await listed(['FALL 2026', 'SUMMER 2026']), 'the home row asks for Fall first').toEqual([
    ['anilist:214703', 'kitsu:50866', 'mal:64718', 'offline:mal-64718'],
  ])
  expect(await listed(['SUMMER 2026', 'FALL 2026', 'SUMMER 2026'])).toEqual([
    ['anilist:214703', 'kitsu:50866', 'mal:64718', 'offline:mal-64718'],
  ])
})

// Mutation: drop every AniList mapping Kitsu makes, and Sekiro's series is two cards.
test('Kitsu and AniList still share a card where Kitsu\'s AniList mapping is right', async () => {
  expect(await listed(['SPRING 2013']), 'an AniList id that is the MyAnimeList id').toEqual([['anilist:16498', 'kitsu:7442', 'mal:16498']])
  const winter = await listed(['WINTER 2027'])
  expect(winter.find(card => card.includes('kitsu:50104')), 'an AniList id alone').toContain('anilist:197620')
})
