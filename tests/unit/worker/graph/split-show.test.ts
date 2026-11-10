/**
 * A show Kitsu maps under its MyAnimeList id twice is one card on a season page, whichever season the tab opened first.
 *
 * Ghost Meets Gal! as its sources answered on 2026-11-10: AniList lists 214703 in Summer 2026, naming MyAnimeList 64718;
 * Kitsu lists 50866 in Fall, mapping MyAnimeList 64718 and AniList 64718, which AniList does not have. The bundled data
 * holds the show in Summer with MyAnimeList 64718 and AniList 214703, and in Fall with Kitsu 50866 too. The home row
 * asks for the season running now (Fall), so Home, then Summer drew the show as two cards where a fresh Summer draws one.
 *
 * Kitsu's rows come out of its own extractor, from its answers as recorded, so the mapping it reads is the one tested.
 */
import { beforeAll, expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/kitsu/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { pageAfter } from './page-visits'
import { media, sameAs, title } from './plugins/fixtures'

beforeAll(async () => { await enableGraph(true) })

type Page = 'SUMMER 2026' | 'FALL 2026' | 'WINTER 2027' | 'SPRING 2013'
type Row = Record<string, unknown>
type Pages = Partial<Record<Page, () => Promise<Row[]>>>

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

const GAL: Pages = {
  'SUMMER 2026': async () => [
    row('anilist:214703', 'SUMMER 2026', 'Ghost Meets Gal!', { type: 'TV_SHORT', handles: [sameAs(media('mal:64718'))] }),
    row('offline:mal-64718', 'SUMMER 2026', 'Ghost Meets Gal!', {
      type: 'TV_SHORT',
      handles: [sameAs(media('mal:64718')), sameAs(media('anilist:214703'))],
    }),
  ],
  'FALL 2026': async () => [
    ...await kitsuSeason('FALL 2026', [
      kitsuRecord('50866', { canonicalTitle: 'Ghost Meets Gal!', titles: { en_jp: 'Ghost Meets Gal!' }, subtype: 'TV', startDate: '2026-09-05' }, [
        ['myanimelist/anime', '64718'],
        ['anilist/anime', '64718'],
      ]),
    ]),
    row('mal:64718', 'FALL 2026', 'Ghost Meets Gal!', {}),
    row('offline:mal-64718', 'FALL 2026', 'Ghost Meets Gal!', {
      handles: [sameAs(media('mal:64718')), sameAs(media('anilist:214703')), sameAs(media('kitsu:50866'))],
    }),
  ],
}

// An AniList id Kitsu maps with no MyAnimeList one beside it.
const SEKIRO: Pages = {
  'WINTER 2027': async () => [
    ...await kitsuSeason('WINTER 2027', [
      kitsuRecord('50104', { canonicalTitle: 'Sekiro: No Defeat', titles: { en: 'Sekiro: No Defeat' }, subtype: 'TV', startDate: '2027-01-08' }, [
        ['anilist/anime', '197620'],
      ]),
    ]),
    row('anilist:197620', 'WINTER 2027', 'Sekiro: No Defeat', { handles: [sameAs(media('mal:62312'))] }),
  ],
}

// An id AniList took from MyAnimeList, which Kitsu rightly maps under both.
const TITAN: Pages = {
  'SPRING 2013': async () => [
    ...await kitsuSeason('SPRING 2013', [
      kitsuRecord('7442', { canonicalTitle: 'Attack on Titan', titles: { en: 'Attack on Titan' }, subtype: 'TV', startDate: '2013-04-07' }, [
        ['myanimelist/anime', '16498'],
        ['anilist/anime', '16498'],
      ]),
    ]),
    row('anilist:16498', 'SPRING 2013', 'Attack on Titan', { handles: [sameAs(media('mal:16498'))] }),
  ],
}

/** The cards the last page visited lists after the pages before it, each as its members. */
const listed = async (show: Pages, pages: Page[]): Promise<string[][]> => {
  const answers: Row[][] = []
  for (const page of pages) answers.push(await show[page]!())
  return (await pageAfter(answers, seasonOf(pages.at(-1)!))).map(card => [...card.members].sort())
}

// Mutation: claim Kitsu's AniList mapping when it repeats its MyAnimeList one (`mappingHandles` in
// src/sources/kitsu/extractor.ts), and Summer after Fall draws the show as two cards.
test('Ghost Meets Gal! is one card on Summer after the Fall page, as on a fresh Summer', async () => {
  const fresh = await listed(GAL, ['SUMMER 2026'])
  expect(fresh, 'the control: a fresh Summer draws it once').toEqual([['anilist:214703', 'mal:64718', 'offline:mal-64718']])
  expect(await listed(GAL, ['FALL 2026', 'SUMMER 2026']), 'the home row asks for Fall first').toEqual([
    ['anilist:214703', 'kitsu:50866', 'mal:64718', 'offline:mal-64718'],
  ])
  expect(await listed(GAL, ['SUMMER 2026', 'FALL 2026', 'SUMMER 2026'])).toEqual([
    ['anilist:214703', 'kitsu:50866', 'mal:64718', 'offline:mal-64718'],
  ])
})

// Mutation: drop every AniList mapping Kitsu makes, and Sekiro's series is two cards.
test('Kitsu and AniList still share a card where Kitsu\'s AniList mapping is right', async () => {
  expect(await listed(TITAN, ['SPRING 2013']), 'an AniList id that is the MyAnimeList id').toEqual([['anilist:16498', 'kitsu:7442', 'mal:16498']])
  const winter = await listed(SEKIRO, ['WINTER 2027'])
  expect(winter.find(card => card.includes('kitsu:50104')), 'an AniList id alone').toContain('anilist:197620')
})
