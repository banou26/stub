// The bundled seasons take every season source stub reads live, so the first paint holds every show
// with the count, the cover and the title the page settles on: those of the highest scored source that
// lists it this season. For the count and the cover MyAnimeList (0.9), then AniList (0.8), then Kitsu
// (0.3); for the title MyAnimeList's English one (0.9), AniList's (0.8), MyAnimeList's romaji one (0.4),
// then Kitsu's (0.3).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { seasonMedia } from '../../../../src/sources/offline/normalize'
import { anilistPairs, anilistSeason, kitsuSeason, malSeason, malSeasons, seasonData, withMalSeasons } from '../../../../scripts/season-popularity.mjs'
import { seasonPageNumbers, seasonQuery } from '../../../../src/sources/kitsu/season-paging'
import { identify, type CatalogLookup } from '../../../../src/tracking/identity'
import { toAggregatedUri, type Uri } from '../../../../src/utils/uri'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const malPage = (name: string) => read(`../jikan/__fixtures__/${name}`)
// Real answers of 2026-10-16, trimmed to the rows these tests read: AniList's season browse page by page
// and Kitsu's eight season pages, as the live sources ask them.
const anilistSummer = JSON.parse(read('../anilist/__fixtures__/anilist-season-summer-2026.json'))
const anilistFall = JSON.parse(read('../anilist/__fixtures__/anilist-season-fall-2026.json'))
const kitsuSummer = JSON.parse(read('../kitsu/__fixtures__/kitsu-season-summer-2026.json'))

const record = (t: string, over: { ml?: number, al?: number, ku?: number, pop?: number } = {}) => ({ t, ty: 'TV', p: '', ...over })
// A Kitsu season page of `[id, title, { [externalSite]: externalId }, English title]`, each counted 50
const kitsuPage = (...shows: [number, string, Record<string, string>, string?][]) => ({
  data: shows.map(([id, canonicalTitle, mappings, en]) => ({ id: String(id), type: 'anime', attributes: { canonicalTitle, titles: { en }, subtype: 'TV', userCount: 50 },
    relationships: { mappings: { data: Object.keys(mappings).map(site => ({ id: `${id} ${site}` })) } } })),
  included: shows.flatMap(([id, , mappings]) => Object.entries(mappings).map(([externalSite, externalId]) =>
    ({ id: `${id} ${externalSite}`, type: 'mappings', attributes: { externalSite, externalId } }))),
})

const ANILIST = 'https://graphql.anilist.co'
const KITSU = 'https://kitsu.io/api/edge/anime?'
const MAL = 'https://myanimelist.net/anime/season/'

type Answers = Record<string, unknown[] | number | Error>

// Every season source as the build reads it. A season a source has no answer for is an empty one, and
// MyAnimeList answers a season it has no page for with a 303 to the season running now.
const sources = ({ mal = {}, anilist = {}, kitsu = {} }: { mal?: Record<string, string | number>, anilist?: Answers, kitsu?: Answers }) => {
  const asked: string[] = []
  const answer = (pages: unknown[] | number | Error | undefined, page: number, empty: unknown) => {
    if (pages instanceof Error) throw pages
    if (typeof pages === 'number') return new Response('', { status: pages })
    return Response.json(pages?.[page - 1] ?? empty)
  }
  const get = async (url: string, init?: RequestInit) => {
    if (url === ANILIST) {
      const { variables: { season, seasonYear, page } } = JSON.parse(init?.body as string)
      asked.push(`anilist ${seasonYear}-${season} ${page}`)
      return answer(anilist[`${seasonYear}-${season}`], page, { data: { Page: { pageInfo: { hasNextPage: false }, media: [] } } })
    }
    if (url.startsWith(KITSU)) {
      const params = new URL(url).searchParams
      const key = `${params.get('filter[seasonYear]')}-${params.get('filter[season]')?.toUpperCase()}`
      asked.push(`kitsu ${key} ${params.get('page[number]')}`)
      return answer(kitsu[key], Number(params.get('page[number]')), { data: [] })
    }
    asked.push(url)
    const page = mal[url.replace(MAL, '')]
    if (typeof page === 'number') return new Response('', { status: page })
    return page === undefined ? new Response(null, { status: 303, headers: { location: '/anime/season' } }) : new Response(page)
  }
  return { get, asked, of: (source: string) => asked.filter(line => line.startsWith(`${source} `)) }
}

const titlesAndCounts = (records: { t: string, pop?: number }[]) => records.map(entry => [entry.t, entry.pop])

test('AniList\'s season is read as the live source asks it, its 150 most popular, without its adult titles', async () => {
  const bodies: { query: string, variables: Record<string, unknown> }[] = []
  const get = async (url: string, init?: RequestInit) => {
    expect([url, init?.method]).toEqual([ANILIST, 'POST'])
    const body = JSON.parse(init?.body as string)
    bodies.push(body)
    return Response.json(anilistSummer[body.variables.page - 1])
  }

  const rows = await anilistSeason('2026-SUMMER', get)

  expect(bodies.map(body => body.variables)).toEqual([1, 2, 3].map(page => ({ season: 'SUMMER', seasonYear: 2026, page })))
  expect(bodies[0]!.query.replace(/\s+/g, ' ')).toContain('media(type: ANIME, season: $season, seasonYear: $seasonYear, sort: [POPULARITY_DESC])')
  expect(rows[0]).toEqual({
    t: 'Mushoku Tensei: Jobless Reincarnation Season 3',
    ty: 'TV',
    p: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx178789-hNXjKFzUq7mk.jpg',
    ep: 14,
    al: 178789,
    ml: 59193,
    sc: 8.6,
    pop: 171_252,
  })
  expect(rows.map(row => row.al), 'Onaji Zemi no Someya-san (208685) is marked adult').toEqual([178789, 135865, 207674, 214068])
})

test('a season AniList says ends on its first page is read in one request', async () => {
  let asked = 0
  const last = anilistSummer[2]

  const rows = await anilistSeason('2027-SUMMER', async () => (asked++, Response.json(last)))

  expect([asked, rows.map(row => row.al)]).toEqual([1, [214068]])
})

// Real rows of 2026-10-16: Delivery Kitten Unyan in AniList's Fall 2026 browse, a Detective Conan special in
// its Summer 2026 one
const anilistPage = (...media: unknown[]) => [{ data: { Page: { pageInfo: { hasNextPage: false }, media } } }]
const unyan = { id: 207217, idMal: 65079, isAdult: false, format: 'ONA', episodes: 3, popularity: 148, averageScore: null,
  title: { romaji: 'Koneko no Haitatsuin Uunyan (2026)', english: 'Delivery Kitten Unyan (2026)' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b207217-IxKfwpEZZzLh.png' } }
const conan = { id: 217126, idMal: 64913, isAdult: false, format: 'SPECIAL', episodes: 1, popularity: 772, averageScore: 64,
  title: { romaji: 'Meitantei Conan: 30-Gou Satsujin Jiken', english: null }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx217126-HRn0NsNpeUBb.jpg' } }

test('an AniList show is named by its English title, else its romaji one, as the live source names it', async () => {
  const rows = await anilistSeason('2026-FALL', async () => Response.json(anilistPage(unyan, conan)[0]))

  expect(rows.map(row => row.t)).toEqual(['Delivery Kitten Unyan (2026)', 'Meitantei Conan: 30-Gou Satsujin Jiken'])
})

test('a season AniList cannot answer is a failed read, never an empty season', async () => {
  await expect(anilistSeason('2026-SUMMER', async () => new Response('', { status: 429 })))
    .rejects.toThrow('AniList 2026-SUMMER page 1 answered HTTP 429')
  await expect(anilistSeason('2026-SUMMER', async () => Response.json({ data: null, errors: [{ message: 'Too Many Requests.', status: 429 }] })))
    .rejects.toThrow('AniList 2026-SUMMER page 1 answered no page (Too Many Requests.)')
})

test('Kitsu\'s season is read off the eight pages the live source asks, with the ids its mappings name', async () => {
  const asked: string[] = []
  const get = async (url: string) => {
    asked.push(url)
    return Response.json(kitsuSummer[Number(new URL(url).searchParams.get('page[number]')) - 1])
  }

  const rows = await kitsuSeason('2026-SUMMER', get)

  expect(asked).toEqual(seasonPageNumbers().map(page => `https://kitsu.io/api/edge${seasonQuery({ season: 'summer', year: 2026, page })}`))
  expect(rows.find(row => row.ku === 49002)).toEqual({
    t: 'Mushoku Tensei: Jobless Reincarnation Season 3',
    ty: 'TV',
    p: 'https://media.kitsu.app/anime/49002/poster_image/6d09b03ffdd5c49802ad21c160b72cb2.jpg',
    ep: 14,
    ku: 49002,
    al: 178789,
    ml: 59193,
    sc: 8.66,
    pop: 3689,
  })
  expect(rows.map(row => [row.ku, row.ml, row.al, row.ty])).toEqual([
    [44778, 49233, 135865, 'TV'],
    [49002, 59193, 178789, 'TV'],
    [50635, undefined, 210032, 'ONA'],
    // its AniList mapping reads `Keroro-Gunsou-Shin-Anime`, which names no AniList entry
    [48693, undefined, undefined, 'MOVIE'],
    [50931, 64522, undefined, 'ONA'],
  ])
  expect(rows.find(row => row.ku === 48693)?.t, 'with no English title, the canonical one').toBe('Shin Keroro Gunsou Movie: Fukkatsushite Sokkou Chikyuu Metsubou no Kiki de Arimasu!')
})

test('an empty English title is passed over, as the live sources pass it over', async () => {
  const anilist = await anilistSeason('2026-FALL', async () => Response.json(anilistPage({ ...conan, title: { ...conan.title, english: '' } })[0]))
  const kitsu = await kitsuSeason('2026-FALL', async () => Response.json(kitsuPage([50999, 'Meitantei Conan: 30-gou Satsujin Jiken', {}, ''])))

  expect([anilist[0]?.t, kitsu[0]?.t]).toEqual(['Meitantei Conan: 30-Gou Satsujin Jiken', 'Meitantei Conan: 30-gou Satsujin Jiken'])
})

test('a Kitsu show mapped to two MyAnimeList entries claims neither', async () => {
  const [page] = structuredClone(kitsuSummer) as { data: { id: string, relationships: { mappings: { data: { id: string }[] } } }[], included: unknown[] }[]
  const mushoku = page!.data.find(row => row.id === '49002')!
  mushoku.relationships.mappings.data.push({ id: 'second' })
  page!.included.push({ id: 'second', type: 'mappings', attributes: { externalSite: 'myanimelist/anime', externalId: '1' } })

  const rows = await kitsuSeason('2026-SUMMER', async (url: string) => Response.json(new URL(url).searchParams.get('page[number]') === '1' ? page : { data: [] }))

  const row = rows.find(entry => entry.ku === 49002)
  expect([row?.al, row?.ml]).toEqual([178789, undefined])
})

test('a Kitsu season with a page that fails is a failed read, so a season is never counted in part', async () => {
  const get = async (url: string) => {
    const page = Number(new URL(url).searchParams.get('page[number]'))
    return page === 4 ? new Response('', { status: 503 }) : Response.json(kitsuSummer[page - 1])
  }

  await expect(kitsuSeason('2026-SUMMER', get)).rejects.toThrow('answered HTTP 503')
})

test('every season source\'s shows are in the bundled season, each with the count and the title the settled page shows', async () => {
  const { get } = sources({ mal: { '2026/summer': malPage('mal-season-summer-2026.html') }, anilist: { '2026-SUMMER': anilistSummer }, kitsu: { '2026-SUMMER': kitsuSummer } })
  const seasons = { '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193, al: 178789 }), record('Youjo Senki II', { ml: 49233, al: 135865 })] }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })

  expect(titlesAndCounts(laid.seasons['2026-SUMMER'])).toEqual([
    // this page was read with no English titles, so the page settles on AniList's
    ['Mushoku Tensei: Jobless Reincarnation Season 3', 367_295],
    ['Steel Ball Run: JoJo no Kimyou na Bouken', 247_199],
    // MyAnimeList's Summer page does not list it, so the page settles on AniList's count and title, not Kitsu's
    ['Saga of Tanya the Evil Season 2', 97_874],
    // R18+ on MyAnimeList, ordinary on AniList
    ['KAMUI ---He\'s behind you', 21_883],
    ['Echo', 345],
    ['BAKI-DOU: The Invincible Samurai Part 2', 195],
    ['Shin Keroro Gunsou Movie: Fukkatsushite Sokkou Chikyuu Metsubou no Kiki de Arimasu!', 28],
    ['FBKingdom Story', 9],
  ])
  const added = laid.seasons['2026-SUMMER'].find(entry => entry.ku === 50635)!
  expect(seasonMedia(added, '2026-SUMMER')?.handles.map(handle => handle.node.uri), 'the ids Kitsu\'s answer joins on').toEqual(['anilist:210032', 'kitsu:50635'])
})

test('a show two sources list is one record, with the count of the higher scored one', async () => {
  const { get } = sources({ anilist: { '2026-SUMMER': anilistSummer }, kitsu: { '2026-SUMMER': kitsuSummer } })

  const laid = await seasonData({ '2026-SUMMER': [] }, [], { now: '2026-FALL', get, pauseMs: 0 })
  const named = (ml: number) => laid.seasons['2026-SUMMER'].filter(entry => entry.ml === ml || entry.ku === { 59193: 49002, 49233: 44778 }[ml])

  expect(named(59193).map(entry => [entry.al, entry.ml, entry.pop]), 'Kitsu 49002 names AniList 178789 and mal 59193').toEqual([[178789, 59193, 171_252]])
  expect(named(49233).map(entry => [entry.al, entry.ml, entry.pop])).toEqual([[135865, 49233, 97_874]])
})

// The live page keeps the count of the highest scored source that answers for this season, and the
// bundle's own count is scored below every live source.
test('a record MyAnimeList lists only on another season\'s page takes the count this season\'s sources show', async () => {
  const fall = malPage('mal-season-sections.html')
  const seasons = { '2026-SUMMER': [record('Youjo Senki II', { ml: 49233 })], '2026-FALL': [] }
  const members = (await malSeason('2026-FALL', async () => new Response(fall), 0)).get(49233)?.members
  const mal = { '2026/summer': malPage('mal-season-summer-2026.html'), '2026/fall': fall }

  const live = await seasonData(seasons, [], { now: '2026-FALL', get: sources({ mal, anilist: { '2026-SUMMER': anilistSummer } }).get, pauseMs: 0 })
  const down = await seasonData(seasons, [], { now: '2026-FALL', get: sources({ mal, anilist: { '2026-SUMMER': 502 } }).get, pauseMs: 0 })

  expect(live.seasons['2026-SUMMER'].find(entry => entry.ml === 49233)?.pop).toBe(97_874)
  expect(down.seasons['2026-SUMMER'].find(entry => entry.ml === 49233)?.pop, 'the control: MyAnimeList\'s Fall count').toBe(members)
  expect(members).toBeGreaterThan(0)
})

// Measured 2026-10-16: AniList's Fall 2026 browse lists Steel Ball Run's 2nd & 3rd STAGE (210482) with
// `idMal` 61469, the 1st stage, while the offline database pairs 61469 with 190327 and 210482 with 63825.
const steelBallRun = [{ mal: 61469, anilist: 190327, kitsu: 0 }, { mal: 63825, anilist: 210482, kitsu: 0 }]
const steelBallRunRows = steelBallRun.map(({ mal, anilist }) => [mal, anilist])
const lookup = { lookup: (origin: string, id: number) =>
  steelBallRun.find(row => row[origin as 'mal' | 'anilist'] === id) } as CatalogLookup
const cardUri = (entry: ReturnType<typeof record>, key: string) => {
  const media = seasonMedia(entry, key)!
  return toAggregatedUri([media.uri, ...media.handles.map(handle => handle.node.uri)] as Uri[])
}

test('an added show never names an id the trackers\' index pairs with another show', async () => {
  const { get } = sources({ anilist: { '2026-FALL': anilistFall } })

  const laid = await seasonData({ '2026-FALL': [] }, [], { now: '2026-FALL', rows: steelBallRunRows, get, pauseMs: 0 })

  expect(laid.seasons['2026-FALL'].map(entry => [entry.t, entry.al, entry.ml, entry.pop])).toEqual([
    ['STEEL BALL RUN JoJo\'s Bizarre Adventure 2nd - 3rd STAGE', 210482, undefined, 42_444],
  ])
  for (const entry of laid.seasons['2026-FALL']) expect(identify(cardUri(entry, '2026-FALL'), lookup).kind).not.toBe('ambiguous')
  expect(identify(cardUri(record('welded', { al: 210482, ml: 61469 }), '2026-FALL'), lookup).kind, 'the control: the pair AniList gives').toBe('ambiguous')
})

test('a show MyAnimeList adds names the AniList id the offline database pairs with it', async () => {
  const { get } = sources({ mal: { '2026/summer': malPage('mal-season-summer-2026.html') } })

  const laid = await seasonData({ '2026-SUMMER': [] }, [], { now: '2026-FALL', rows: steelBallRunRows, get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].find(entry => entry.ml === 61469)?.al).toBe(190327)
})

test('a show joins the bundled record its own id names, never the one its claimed id names', async () => {
  const { get } = sources({ anilist: { '2026-FALL': anilistFall } })
  const seasons = { '2026-FALL': [record('Steel Ball Run', { ml: 61469, al: 190327 }), record('Steel Ball Run 2nd Stage', { ml: 63825, al: 210482 })] }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })

  expect(laid.seasons['2026-FALL'].map(entry => [entry.t, entry.ml, entry.al, entry.pop])).toEqual([
    ['STEEL BALL RUN JoJo\'s Bizarre Adventure 2nd - 3rd STAGE', 63825, 210482, 42_444],
    ['Steel Ball Run', 61469, 190327, undefined],
  ])
})

// Measured 2026-10-16: the live Summer page shows both by MyAnimeList's English title. The live Fall page,
// which MyAnimeList's Fall page does not answer for either, shows AniList's English title for the first and
// Kitsu's for the second, whatever title another season's MyAnimeList card gives the record.
test('a show in two seasons carries in each the title that season\'s page settles on', async () => {
  const { get } = sources({
    mal: { '2026/summer': malPage('mal-season-summer-2026-english.html') },
    anilist: { '2026-SUMMER': anilistPage(conan), '2026-FALL': anilistPage(unyan) },
    kitsu: { '2026-FALL': [kitsuPage([50999, 'Meitantei Conan: 30-gou Satsujin Jiken', { 'myanimelist/anime': '64913' }, 'Detective Conan: The Counterfeit Case of Ultra 30'])] },
  })
  const seasons = {
    '2026-SUMMER': [record('Koneko no Haitatsuin Uunyan (2026)', { ml: 65079, al: 207217 }), record('Meitantei Conan: 30-gou Satsujin Jiken', { ml: 64913, al: 217126, ku: 50999 })],
    '2026-FALL': [record('Koneko no Haitatsuin Uunyan (2026)', { ml: 65079, al: 207217 })],
  }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })
  const titles = (key: string) => [64913, 65079].map(ml => laid.seasons[key].find(entry => entry.ml === ml)?.t)

  expect(titles('2026-SUMMER')).toEqual(['Detective Conan: The Counterfeit Case of Ultra 30', 'Delivery Kitten Unyan'])
  expect(titles('2026-FALL')).toEqual(['Detective Conan: The Counterfeit Case of Ultra 30', 'Delivery Kitten Unyan (2026)'])
})

// Measured 2026-10-16: MyAnimeList's Summer card shows this show in romaji only and AniList does not list
// it, so the live page settles on that romaji title (0.4) over the bundle's own (0.2). The Kitsu row is
// made up, to place Kitsu's title (0.3) below it.
test('a show AniList does not list takes MyAnimeList\'s romaji title over Kitsu\'s and its own', async () => {
  const kitsu = { '2026-SUMMER': [kitsuPage([51100, 'Bao Ke Meng Donghua Tujian 5', { 'myanimelist/anime': '65178' }])] }
  const seasons = { '2026-SUMMER': [record('Bao Ke Meng Donghua Tujian: Bu Qi Er Yu', { ml: 65178 })] }
  const title = async (mal: Record<string, string>) =>
    (await seasonData(seasons, [], { now: '2026-FALL', get: sources({ mal, kitsu }).get, pauseMs: 0 })).seasons['2026-SUMMER'].find(entry => entry.ml === 65178)?.t

  expect(await title({ '2026/summer': malPage('mal-season-summer-2026-english.html') })).toBe('Bao Ke Meng Donghua Tujian: Buqi Eryu')
  expect(await title({}), 'the control: with no MyAnimeList card, Kitsu\'s').toBe('Bao Ke Meng Donghua Tujian 5')
})

// Real rows and records of 2026-10-16, Summer 2026: the offline database holds each of the two shorts as
// two records with no id in common, and AniList's row or Kitsu's names both.
const kamui = { id: 207674, idMal: 63468, isAdult: false, format: 'TV_SHORT', episodes: 12, popularity: 21883, averageScore: 58,
  title: { romaji: 'Ushiro no Shoumen Kamui-san', english: 'KAMUI ---He\'s behind you' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx207674-BT8lFAwH1WrL.jpg' } }
const kamuiMini = { id: 213831, idMal: 64543, isAdult: false, format: 'TV_SHORT', episodes: 12, popularity: 1299, averageScore: 53,
  title: { romaji: 'Snack HAZAMA', english: 'Snack Hazama' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx213831-jrH7JR6feW1q.png' } }
const henchmen = { id: 213506, idMal: 64378, isAdult: false, format: 'TV_SHORT', episodes: null, popularity: 350, averageScore: null,
  title: { romaji: 'Hokuto no Ken: Kenou-gun Zako-tachi no Banka Part 2', english: null }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx213506-vr9kwJjMvXV8.jpg' } }
const kamuiMiniKitsu = (mappings: Record<string, string>) => kitsuPage([50954, 'Ushiro no Shoumen Kamui-san Mini Anime Gekijou', mappings])
const kamuiSeasons = () => ({ '2026-SUMMER': [
  record('Ushiro no Shoumen Kamui-san', { ml: 63468, al: 207674 }),
  record('Ushiro no Shoumen Kamui-san Mini Anime', { ml: 64543, al: 213831 }),
  { ...record('Ushiro no Shoumen Kamui-san Mini Anime Gekijou', { ku: 50954 }), ty: 'ONA' },
] })

test('a show the offline database holds as two records is one record once a source\'s row names both, the first one\'s', async () => {
  const { get } = sources({
    anilist: { '2026-SUMMER': anilistPage(kamuiMini, henchmen) },
    kitsu: { '2026-SUMMER': [kamuiMiniKitsu({ 'myanimelist/anime': '64543', 'anilist/anime': '213831' })] },
  })
  const [, mini, gekijou] = kamuiSeasons()['2026-SUMMER']
  const seasons = { '2026-SUMMER': [
    gekijou!,
    mini!,
    record('Hokuto no Ken: Kenougun Zako-tachi no Banka Part 2', { ml: 64378 }),
    { ...record('Elegy for the Henchmen: Fist of the North Star - Part II', { al: 213506, ku: 50803 }), ty: 'SPECIAL' },
  ] }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].map(entry => [entry.t, entry.ty, entry.ml, entry.al, entry.ku, entry.pop])).toEqual([
    ['Snack Hazama', 'ONA', 64543, 213831, 50954, 1299],
    ['Hokuto no Ken: Kenou-gun Zako-tachi no Banka Part 2', 'TV', 64378, 213506, 50803, 350],
  ])
})

// AniList 11 pairs Bridge's two records, then Kitsu 202 maps Other's mal id beside AniList 11.
test('two records joined into one hold every id of both against a later row\'s claims', async () => {
  const { get } = sources({
    anilist: { '2026-SUMMER': anilistPage({ ...henchmen, id: 11, idMal: 1 }) },
    kitsu: { '2026-SUMMER': [kitsuPage([202, 'Other', { 'myanimelist/anime': '2', 'anilist/anime': '11' }])] },
  })
  const seasons = { '2026-SUMMER': [record('Bridge', { ml: 1 }), record('Bridge', { al: 11 }), record('Other', { ml: 2 })] }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].map(entry => [entry.ml, entry.al, entry.ku])).toEqual([[1, 11, undefined], [2, undefined, undefined]])
})

// The show is R18+ on MyAnimeList, which plays no part here: no MyAnimeList page is read.
test('a show and its short stay two, also when a source names the short by the show\'s id', async () => {
  const shows = async (mappings: Record<string, string>) => {
    const { get } = sources({ anilist: { '2026-SUMMER': anilistPage(kamui, kamuiMini) }, kitsu: { '2026-SUMMER': [kamuiMiniKitsu(mappings)] } })
    const laid = await seasonData(kamuiSeasons(), [], { now: '2026-FALL', get, pauseMs: 0 })
    return laid.seasons['2026-SUMMER'].filter(entry => entry.ml).map(entry => [entry.ml, entry.al])
  }

  expect(await shows({ 'myanimelist/anime': '64543', 'anilist/anime': '213831' })).toEqual([[63468, 207674], [64543, 213831]])
  expect(await shows({ 'myanimelist/anime': '64543', 'anilist/anime': '207674' }), 'the short named by the show\'s AniList id').toEqual([[63468, 207674], [64543, 213831]])
})

// AniList 11 is mal 1 in the bundle, and the index pairs mal 1 with Kitsu 101: a Kitsu 202 claiming
// AniList 11 is another show, though no single row names both 202 and 11.
test('a claimed id is refused when another show holds it through a chain of pairs', async () => {
  const { get } = sources({ kitsu: { '2026-SUMMER': [kitsuPage([202, 'Chained', { 'anilist/anime': '11' }])] } })

  const laid = await seasonData({ '2026-SUMMER': [record('Bridge', { ml: 1, al: 11 })] }, [], { now: '2026-SUMMER', rows: [[1, 0, 101]], get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].map(entry => [entry.t, entry.ml, entry.al, entry.ku, entry.pop])).toEqual([
    ['Chained', undefined, undefined, 202, 50],
    ['Bridge', 1, 11, undefined, undefined],
  ])
})

// The title page reads a show off whichever bucket holds it first, and the store joins both records.
test('a show added to one season and claimed in another names the same AniList id in both', async () => {
  const claimed = kitsuPage([5, 'Moshi, Korekara Umarerunonara', { 'myanimelist/anime': '63739', 'anilist/anime': '999' }])
  const { get } = sources({ anilist: { '2026-SUMMER': anilistSummer }, kitsu: { '2026-FALL': [claimed] } })

  const laid = await seasonData({ '2026-SUMMER': [], '2026-FALL': [] }, [], { now: '2026-SUMMER', get, pauseMs: 0 })

  expect(laid.seasons['2026-SUMMER'].filter(entry => entry.ml === 63739).map(entry => entry.al)).toEqual([214068])
  expect(laid.seasons['2026-FALL'].map(entry => [entry.ku, entry.ml, entry.al])).toEqual([[5, 63739, undefined]])
})

// Measured 2026-10-17: MyAnimeList marks these R18+ and its live source leaves them out, while AniList or
// Kitsu list them as ordinary, so the live page shows them at AniList's count, else Kitsu's. The offline
// database bundles some with their Kitsu id alone (I'm Dating a Dark Summoner, Kitsu 50990), and Kitsu
// names some by their AniList id alone.
const kanojo = { id: 211877, idMal: 64131, isAdult: false, format: 'TV_SHORT', episodes: 12, popularity: 11386, averageScore: 49,
  title: { romaji: 'Kanojo no Tomodachi', english: 'My Girlfriend\'s Friend' }, coverImage: { extraLarge: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx211877-yWQ2r7XmWvG6.jpg' } }

test('a show MyAnimeList marks R18+ is in the season at AniList\'s count, else Kitsu\'s, when either lists it', async () => {
  const mal = { '2026/summer': malPage('mal-season-summer-2026.html'), '2026/fall': malPage('mal-season-fall-2026.html') }
  const kitsu = { '2026-FALL': [kitsuPage([50752, 'Kanojo no Tomodachi', { 'anilist/anime': '211877' }, 'My Girlfriend\'s Friend'])] }
  const seasons = () => ({ '2026-SUMMER': [record('Ushiro no Shoumen Kamui-san', { ml: 63468, al: 207674 })], '2026-FALL': [record('Kanojo no Tomodachi', { ku: 50752 })] })
  const laid = async (anilist: Answers) =>
    (await seasonData(seasons(), [], { now: '2026-FALL', rows: [[64131, 211877, 50752]], get: sources({ mal, anilist, kitsu }).get, pauseMs: 0 })).seasons
  const kanojoIn = (fall: { ml?: number, al?: number, ku?: number, pop?: number }[]) =>
    fall.filter(entry => entry.ku === 50752 || entry.al === 211877).map(entry => [entry.ku, entry.al, entry.ml, entry.pop])

  const both = await laid({ '2026-SUMMER': anilistSummer, '2026-FALL': anilistPage(kanojo) })
  const kitsuAlone = await laid({})

  expect(both['2026-SUMMER'].filter(entry => entry.al === 207674).map(entry => [entry.ml, entry.pop]), 'Kamui-san, ordinary on AniList').toEqual([[63468, 21_883]])
  expect(kanojoIn(both['2026-FALL']), 'Kanojo no Tomodachi, its bundled Kitsu record joined to AniList\'s').toEqual([[50752, 211877, 64131, 11_386]])
  expect(kanojoIn(kitsuAlone['2026-FALL']), 'Kanojo no Tomodachi, with Kitsu alone listing it').toEqual([[50752, undefined, undefined, 50]])
  expect(both['2026-SUMMER'].map(entry => entry.ml), 'Shoujo Ramune, R18+ and listed by no other source').not.toContain(32587)
  expect(both['2026-SUMMER'].map(entry => entry.al), 'Onaji Zemi no Someya-san, adult on AniList').not.toContain(208685)
})

test('a MyAnimeList card marked R18+ lends a record no count, title or cover', async () => {
  const mal = { '2026/summer': malPage('mal-season-summer-2026.html'), '2026/fall': malPage('mal-season-fall-2026.html') }
  const { get } = sources({ mal, anilist: { '2026-SUMMER': anilistSummer }, kitsu: { '2026-FALL': [kitsuPage([50752, 'Kanojo no Tomodachi', { 'myanimelist/anime': '64131' }, 'My Girlfriend\'s Friend'])] } })
  const card = async (page: keyof typeof mal, id: number) => {
    const { title, members, cover } = (await malSeason('2026-FALL', async () => new Response(mal[page]), 0)).get(id)!
    return [title, members, cover?.replace('https://cdn.myanimelist.net/images/anime/', '')]
  }

  const laid = await seasonData({ '2026-SUMMER': [], '2026-FALL': [] }, [], { now: '2026-FALL', get, pauseMs: 0 })
  const shown = (key: string, id: number) => laid.seasons[key].filter(entry => entry.ml === id).map(entry => [entry.t, entry.pop, entry.p])

  expect(shown('2026-FALL', 64131), 'Kitsu\'s').toEqual([['My Girlfriend\'s Friend', 50, '']])
  expect(shown('2026-SUMMER', 63468), 'AniList\'s').toEqual([['KAMUI ---He\'s behind you', 21_883, 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx207674-BT8lFAwH1WrL.jpg']])
  expect(await card('2026/fall', 64131), 'the control: the card\'s own').toEqual(['Kanojo no Tomodachi', 8068, '1413/159862l.webp'])
  expect(await card('2026/summer', 63468), 'the control: the card\'s own').toEqual(['Ushiro no Shoumen Kamui-san', 21_060, '1071/158366l.webp'])
})

test('a season source that is down leaves the seasons as MyAnimeList alone lays them, and is asked nothing more', async () => {
  const { get, of } = sources({
    mal: { '2026/summer': malPage('mal-season-summer-2026.html') },
    anilist: { '2026-FALL': 503, '2026-SUMMER': 503 },
    kitsu: { '2026-FALL': new TypeError('fetch failed'), '2026-SUMMER': new TypeError('fetch failed') },
  })
  const seasons = { '2026-FALL': [], '2026-SUMMER': [record('Mushoku Tensei III', { ml: 59193, al: 178789 }), record('Youjo Senki II', { ml: 49233, al: 135865 })] }

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })
  const alone = withMalSeasons(seasons, (await malSeasons(['2026-FALL', '2026-SUMMER'], sources({ mal: { '2026/summer': malPage('mal-season-summer-2026.html') } }).get, 0)).pages, '2026-FALL', anilistPairs([], []))

  expect(laid.seasons).toEqual(alone)
  expect(of('anilist')).toEqual(['anilist 2026-FALL 1'])
  expect(of('kitsu')).toEqual(seasonPageNumbers().map(page => `kitsu 2026-FALL ${page}`))
  expect([...laid.reads.anilist.failed.keys()]).toEqual(['2026-FALL', '2026-SUMMER'])
})

test('the three sources are read at once', async () => {
  const { get } = sources({})
  let answered = 0
  const firstAsked = new Map<string, number>()
  const counting = async (url: string, init?: RequestInit) => {
    const source = url === ANILIST ? 'anilist' : url.startsWith(KITSU) ? 'kitsu' : 'mal'
    if (!firstAsked.has(source)) firstAsked.set(source, answered)
    const response = await get(url, init)
    answered++
    return response
  }

  await seasonData({ '2026-SUMMER': [] }, [], { now: '2026-SUMMER', get: counting, pauseMs: 0 })

  expect(Object.fromEntries(firstAsked), 'answers handed out before each source was first asked').toEqual({ mal: 0, anilist: 0, kitsu: 0 })
})

test('the season running now is asked first, and past the time budget no source asks for another', async () => {
  const { get, of } = sources({ anilist: { '2026-FALL': anilistFall }, kitsu: { '2026-SUMMER': kitsuSummer } })
  const slow = async (url: string, init?: RequestInit) => {
    await new Promise(resolve => setTimeout(resolve, 5))
    return get(url, init)
  }

  const laid = await seasonData({ '2026-SUMMER': [], '2026-FALL': [] }, [], { now: '2026-FALL', get: slow, pauseMs: 0, budgetMs: 0 })

  expect(of('anilist')).toEqual(['anilist 2026-FALL 1', 'anilist 2026-FALL 2', 'anilist 2026-FALL 3'])
  expect(of('kitsu')).toEqual(seasonPageNumbers().map(page => `kitsu 2026-FALL ${page}`))
  expect(laid.reads.kitsu.failed.get('2026-SUMMER')?.message).toBe('not asked after 0 s')
})

test('a bundled record takes the cover of the highest scored source that lists it this season', async () => {
  const { get } = sources({ mal: { '2026/summer': malPage('mal-season-summer-2026.html') }, anilist: { '2026-SUMMER': anilistSummer }, kitsu: { '2026-SUMMER': kitsuSummer } })
  const seasons = { '2026-SUMMER': [
    { ...record('Mushoku Tensei III', { ml: 59193, al: 178789 }), p: '1000/100000.jpg' },
    { ...record('Youjo Senki II', { ml: 49233, al: 135865 }), p: '1000/100001.jpg' },
    { ...record('Shin Keroro Gunsou Movie', { ku: 48693 }), p: '1000/100002.jpg' },
    { ...record('Nobody lists it', { ml: 1 }), p: '1000/100003.jpg' },
  ] }
  const malCover = (await malSeason('2026-SUMMER', async () => new Response(malPage('mal-season-summer-2026.html')), 0)).get(59193)!.cover!

  const laid = await seasonData(seasons, [], { now: '2026-FALL', get, pauseMs: 0 })
  const cover = (catalogue: 'ml' | 'ku', id: number) => laid.seasons['2026-SUMMER'].find(entry => entry[catalogue] === id)?.p

  expect(cover('ml', 59193), 'MyAnimeList, AniList and Kitsu list it').toBe(malCover.replace('https://cdn.myanimelist.net/images/anime/', ''))
  expect(cover('ml', 49233), 'AniList and Kitsu list it').toBe('https://s4.anilist.co/file/anilistcdn/media/anime/cover/large/bx135865-T7XIPMAbqcxN.png')
  expect(cover('ku', 48693), 'only Kitsu lists it').toBe('https://media.kitsu.app/anime/48693/poster_image/1c76ba671262bed223765b8cb719b49a.jpg')
  expect(cover('ml', 1), 'the control: no source lists it').toBe('1000/100003.jpg')
})
