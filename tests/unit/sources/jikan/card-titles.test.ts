// Which title a card shows: the first of its aggregated titles (`media-title.tsx`), which
// `aggregateFields` orders by each title's score. MyAnimeList's rows come from real myanimelist.net
// bytes through the source; the other sources' titles are the ones they answered for the same shows,
// 2026-10-16.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/jikan/extractor'
import { seasonMedia } from '../../../../src/sources/offline/normalize'
import { fromGoodSource } from '../../../../src/utils/theater'
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'

type Row = { uri: string, origin: string, score: number, titles: { language: string, title: string, score: number }[], shortDescriptions?: { shortDescription: string, score: number }[] }

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')

const malRows = async (input: Record<string, unknown>, body: string) => {
  const ctx = { fetch: async () => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) }) } as never
  const { value } = await (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input }, ctx).next()
  return new Map<string, Row>(value.mediaPage.nodes.map((node: Row) => [node.uri, node]))
}

const answered = (uri: string, score: number, ...titles: [string, string][]): Row => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  score,
  titles: titles.map(([language, title]) => ({ language, title, score })),
})

// a cluster of these members as the listing reads it
const aggregateOf = (...members: (Row | undefined)[]) => aggregateFields({
  cluster: { id: 'cl', aggUri: 'ag:()', scope: 'RUN', runLength: null, runLengthTier: null, runLengthWitnesses: 0, runLengthFrom: [], anomalies: [] },
  members: members.map(raw => {
    if (!raw) throw new Error('a member the fixture does not answer')
    return { uri: raw.uri, origin: raw.origin, id: raw.uri.slice(raw.uri.indexOf(':') + 1), owned: true, score: raw.score, raw, fieldSeq: {} }
  }),
  related: [],
  relations: [],
  locationOrigin: '',
})

// the aggregated titles of a cluster of these members, in the order a card reads them
const titlesOf = (...members: (Row | undefined)[]) => aggregateOf(...members).titles as Row['titles']

const cardTitle = (...members: (Row | undefined)[]) => titlesOf(...members)[0]?.title

test('a search card leads with the English title another source answers, as MyAnimeList\'s search names a show in romaji alone', async () => {
  const mal = await malRows({ search: 'gundam' }, fixture('mal-search-gundam.json'))

  expect(cardTitle(
    mal.get('mal:2581'),
    answered('anilist:2581', 0.8, ['en', 'Mobile Suit Gundam 00'], ['jp-en', 'Kidou Senshi Gundam 00'], ['jp', '機動戦士ガンダム00']),
    answered('kitsu:2346', 0.3, ['en', 'Mobile Suit Gundam 00'], ['ja', '機動戦士ガンダム00']),
  )).toBe('Mobile Suit Gundam 00')
  expect(cardTitle(
    mal.get('mal:93'),
    answered('anilist:93', 0.8, ['en', 'Mobile Suit Gundam Seed'], ['jp-en', 'Kidou Senshi Gundam SEED'], ['jp', '機動戦士ガンダムSEED']),
  )).toBe('Mobile Suit Gundam Seed')
  expect(cardTitle(
    mal.get('mal:31251'),
    answered('anilist:21268', 0.8, ['en', 'Mobile Suit GUNDAM Iron Blooded Orphans'], ['jp-en', 'Kidou Senshi Gundam: Tekketsu no Orphans'], ['jp', '機動戦士ガンダム 鉄血のオルフェンズ']),
  )).toBe('Mobile Suit GUNDAM Iron Blooded Orphans')
  expect(cardTitle(
    mal.get('mal:1090'),
    answered('anilist:1090', 0.8, ['en', 'Mobile Suit Gundam I'], ['jp-en', 'Kidou Senshi Gundam I'], ['jp', '機動戦士ガンダムⅠ']),
  )).toBe('Mobile Suit Gundam I')
  expect(cardTitle(
    mal.get('mal:23259'),
    answered('anilist:20658', 0.8, ['en', 'Gundam: Reconguista in G'], ['jp-en', 'Gundam: G no Reconguista'], ['jp', 'ガンダム Gのレコンギスタ']),
    answered('kitsu:8391', 0.3, ['en', 'Gundam Reconguista in G'], ['en', 'Gundam: G no Reconguista'], ['ja', 'ガンダム Gのレコンギスタ']),
  )).toBe('Gundam: Reconguista in G')
  expect(cardTitle(mal.get('mal:3927')), 'a show only MyAnimeList answered keeps the title it has').toBe('Kidou Senshi Gundam 00 Second Season')
})

test('a season card leads with the English title another source answers, as MyAnimeList\'s names a show in romaji alone', async () => {
  const mal = await malRows({ season: 'FALL', seasonYear: 2026 }, fixture('mal-season-fall-2026.html'))

  expect(cardTitle(
    mal.get('mal:54344'),
    answered('anilist:160803', 0.8, ['en', 'MAGICAL GIRL RAISING PROJECT restart'], ['jp-en', 'Mahou Shoujo Ikusei Keikaku: restart'], ['jp', '魔法少女育成計画 restart']),
  )).toBe('MAGICAL GIRL RAISING PROJECT restart')
  expect(cardTitle(
    mal.get('mal:64028'),
    answered('anilist:218011', 0.8, ['en', 'Raccoon Dog & Fox'], ['jp-en', 'Tanuki to Kitsune (TV)'], ['jp', 'タヌキとキツネ']),
    answered('offline:mal-64028', 0.2, ['en', 'Tanuki to Kitsune (TV)']),
  )).toBe('Raccoon Dog & Fox')
})

// The bundled season record carries the title its page settles on, and which source gave it (`ts`). Measured
// 2026-11-09: cards painted before AniList answered showed MyAnimeList's romaji, here "Tanuki to Kitsune (TV)", and
// switched a second or two later.
const bundled = (t: string, ts: 'al' | 'ml' | 'mr' | 'ku', ml = 64028) =>
  seasonMedia({ t, ts, ty: 'TV', p: '', ml, sy: 'The synopsis the build read.' }, '2026-FALL') as unknown as Row

test('a bundled season card paints the title its page settles on before AniList answers, over MyAnimeList\'s romaji', async () => {
  const mal = await malRows({ season: 'FALL', seasonYear: 2026 }, fixture('mal-season-fall-2026.html'))
  const anilist = answered('anilist:218011', 0.8, ['en', 'Raccoon Dog & Fox'], ['jp-en', 'Tanuki to Kitsune (TV)'], ['jp', 'タヌキとキツネ'])

  expect(cardTitle(mal.get('mal:64028'), bundled('Raccoon Dog & Fox', 'al'))).toBe('Raccoon Dog & Fox')
  expect(cardTitle(mal.get('mal:64028'), bundled('Raccoon Dog & Fox', 'al'), anilist)).toBe('Raccoon Dog & Fox')
  expect(cardTitle(answered('kitsu:1', 0.3, ['en', 'Tanuki and Fox']), bundled('Tanuki to Kitsune (TV)', 'mr')), 'MyAnimeList\'s romaji over Kitsu\'s')
    .toBe('Tanuki to Kitsune (TV)')
})

// The home hero holds a show as final once a source better than Kitsu has described it (`fromGoodSource`).
test('the home hero takes a bundled card for a good source only once a live one has described it', async () => {
  const mal = await malRows({ season: 'FALL', seasonYear: 2026 }, fixture('mal-season-fall-2026.html'))
  const good = (...members: (Row | undefined)[]) => fromGoodSource({ shortDescriptions: aggregateOf(...members).shortDescriptions as { score: number }[] })
  const card = bundled('MAGICAL GIRL RAISING PROJECT restart', 'al', 54344)
  const kitsu = { ...answered('kitsu:1', 0.3, ['en', 'Magical Girl Raising Project: Restart']), shortDescriptions: [{ shortDescription: 'The second season of Magical Girl Raising Project.', score: 0.3 }] }

  expect(good(card), 'the bundle alone, at AniList\'s title').toBe(false)
  expect(good(card, kitsu), 'with Kitsu').toBe(false)
  expect(good(card, kitsu, mal.get('mal:54344')), 'with MyAnimeList, which names it in romaji alone').toBe(true)
})
