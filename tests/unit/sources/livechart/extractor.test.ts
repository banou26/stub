// LiveChart's season pages: the cards of a saved copy of one (tests/fixtures/livechart), and hand-written rows.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vite-plus/test'

import { MediaType } from '../../../../src/generated/graphql'
import { normalizeAnime, parseSeasonPage, premieredInSeason, resolvers, type LiveChartAnime } from '../../../../src/sources/livechart/extractor'
import { animeSeasonOf } from '../../../../src/sources/season'

const FALL_2026 = { season: 'fall', year: 2026 } as const

// https://www.livechart.me/fall-2026/tv on 2026-11-09, trimmed to seven cards
const PAGE = readFileSync(new URL('../../../fixtures/livechart/fall-2026-tv.html', import.meta.url), 'utf8')
// https://www.livechart.me/winter-2027/tv on 2026-11-09, trimmed to two cards that link no MyAnimeList entry
const WINTER = readFileSync(new URL('../../../fixtures/livechart/winter-2027-tv.html', import.meta.url), 'utf8')

// a row may carry more than the source reads
const anime = (fields: Partial<LiveChartAnime> & Record<string, unknown> = {}): LiveChartAnime => ({
  id: 12001,
  type: MediaType.Tv,
  romaji_title: 'Kousoku Hikousen',
  english_title: 'The Fast Airship',
  native_title: '高速飛行船',
  synopsis: 'A courier crosses the sea of clouds.',
  premiere_date: '2026-10-08T15:00:00.000000000Z',
  premiere_date_precision: 3,
  episode_count: 12,
  avg_rating: 8.2,
  poster_image_large: 'https://u.livechart.me/anime/12001/poster_image/0f.webp/large.jpg',
  mal_url: 'https://myanimelist.net/anime/61001',
  ...fields,
})

/** Every url asked for, each tab answered with its page in `pages` (an empty grid otherwise), or with `status`. */
const rig = (pages: Record<string, string> = { tv: PAGE }, status = 200) => {
  const urls: string[] = []
  const ctx = {
    fetch: async (url: string) => {
      urls.push(url)
      return { ok: status === 200, status, text: async () => pages[url.split('/').at(-1)!] ?? '<main></main>' }
    },
  } as never
  return { urls, ctx }
}

const pageNodes = async (input: Record<string, unknown>, ctx: never) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return (value?.mediaPage?.nodes ?? []) as ReturnType<typeof normalizeAnime>[]
}

describe('a row', () => {
  test('carries its titles, synopsis, cover, count, score and the season it was listed under', () => {
    const media = normalizeAnime(anime(), FALL_2026)

    expect(media.uri).toBe('livechart:12001')
    expect(media.url).toBe('https://www.livechart.me/anime/12001')
    expect(media.score).toBe(0.6)
    expect(media.titles).toEqual([
      { language: 'en', title: 'The Fast Airship', score: 0.6 },
      { language: 'jp-en', title: 'Kousoku Hikousen', score: 0.6 },
      { language: 'jp', title: '高速飛行船', score: 0.6 },
    ])
    expect(media.descriptions).toEqual([{ language: 'en', description: 'A courier crosses the sea of clouds.', score: 0.6 }])
    expect(media.covers).toEqual([{ url: 'https://u.livechart.me/anime/12001/poster_image/0f.webp/large.jpg', score: 0.6 }])
    expect(media.episodeCount).toBe(12)
    expect(media.averageScore, 'rated out of 10').toBe(82)
    expect(media.season).toBe('FALL')
    expect(media.seasonYear).toBe(2026)
  })

  test('an avg_rating of 0 is a title nobody rated, not a score of 0', () => {
    expect(normalizeAnime(anime({ avg_rating: 0 }), FALL_2026).averageScore).toBeUndefined()
  })

  test('the start date is the day in Japan, and a month alone is no date', () => {
    expect(normalizeAnime(anime(), FALL_2026).startDate, 'Japanese midnight, the evening before in UTC').toBe('2026-10-09')
    expect(normalizeAnime(anime({ premiere_date: '2026-10-03T13:30:00.000000000Z', premiere_date_precision: 4 }), FALL_2026).startDate).toBe('2026-10-03')
    for (const premiere_date_precision of [2, 1, 0, null]) {
      expect(normalizeAnime(anime({ premiere_date: '2026-11-01T00:00:00.000000000Z', premiere_date_precision }), FALL_2026).startDate, String(premiere_date_precision)).toBeUndefined()
    }
  })

  test('a row with no type claims no format at all', () => {
    const { type, categories } = normalizeAnime(anime({ type: undefined }), FALL_2026)
    expect({ type, categories }).toEqual({ type: undefined, categories: ['ANIME'] })
  })
})

describe('a season page', () => {
  const cards = parseSeasonPage(PAGE, MediaType.Tv)
  const card = (id: number) => cards.find(card => card.id === id)!

  test('reads every card, and not the tutorial card after them', () => {
    expect(cards.map(card => card.id)).toEqual([13508, 13631, 13514, 12991, 319, 13383, 12611])
  })

  test("a card's titles, synopsis without its credit, poster, count, rating, premiere and catalogue links", () => {
    expect(card(13508)).toEqual({
      id: 13508,
      type: 'TV',
      romaji_title: 'Doumo, Suki na Hito ni Horegusuri wo Irai sareta Majo desu.',
      english_title: 'Hello, I Am a Witch and My Crush Wants Me to Make a Love Potion!',
      native_title: 'どうも、好きな人に惚れ薬を依頼された魔女です。',
      synopsis: expect.stringMatching(/^"I want you to make a love potion\."\n\nThe Good Witch of the Lake's four-year crush [^]*\n\nThis is the heartwarming story of a shut-in witch [^]* starts from a love potion\.$/),
      premiere_date: '2026-10-05T12:30:00.000Z',
      premiere_date_precision: 4,
      episode_count: 12,
      avg_rating: '7.78',
      poster_image_large: 'https://u.livechart.me/anime/13508/poster_image/9ab193bca2aae2d30fc7eb493442892c.webp/large.jpg',
      mal_url: 'https://myanimelist.net/anime/63409',
      anilist_url: 'https://anilist.co/anime/207191',
    })
    expect(normalizeAnime(card(13508), FALL_2026).averageScore).toBe(78)
  })

  test('an entity in an attribute is read as its character', () => {
    expect(card(13514).romaji_title).toMatch(/ Arayuru Mono ni "Kyouka Point" wo Fuyo /)
  })

  test('a card with no synopsis, no rating and no episode count says nothing for them', () => {
    expect(card(13631)).toMatchObject({ synopsis: undefined, avg_rating: undefined, episode_count: undefined })
    expect(card(13631).english_title).toBe('With Vengeance, Sincerely, Your Broken Saintess Season 2')
  })

  test("an editor's note above the synopsis is no part of it", () => {
    expect(card(13383).synopsis).toMatch(/^Victory over the Demon King [^]* her story’s just begun\.$/)
    expect(card(12611).synopsis, 'a note and no synopsis').toBeUndefined()
  })

  // Detective Conan's card prints "Began Winter 1996" and holds October 3, 2026, its first episode of the season, as
  // its premiere value. Read as a premiere, that puts a 1996 show on the fall 2026 row.
  test('a run carried over from an earlier season has no date', () => {
    expect(card(319).premiere_date).toBeUndefined()
    expect(premieredInSeason(card(319), FALL_2026)).toBe(false)
  })
})

describe('the handle a row mints', () => {
  test('its MyAnimeList id, as the same run', () => {
    const { handles } = normalizeAnime(anime(), FALL_2026)

    expect(handles.map(handle => [handle.relation, handle.node.uri, handle.node.scope, handle.node.url])).toEqual([
      ['SAME_AS', 'mal:61001', 'RUN', 'https://myanimelist.net/anime/61001'],
    ])
  })

  // Shaped like the entry the season walk caught on 2026-10-10: one LiveChart row naming part five of a
  // film series on MyAnimeList and part one on Kitsu. Minting all of them welded the two parts, so the
  // row names one catalogue and nothing else.
  test('never the AniList, Kitsu or AniDB link beside it, which can name another run', () => {
    const { handles } = normalizeAnime(anime({
      mal_url: 'https://myanimelist.net/anime/61005',
      anilist_url: 'https://anilist.co/anime/190001',
      kitsu_url: 'https://kitsu.app/anime/50001',
      anidb_url: 'http://anidb.net/a19001',
    }), FALL_2026)
    expect(handles.map(handle => handle.node.uri)).toEqual(['mal:61005'])
    expect(normalizeAnime(parseSeasonPage(PAGE)[0]!, FALL_2026).handles.map(handle => handle.node.uri), 'a card linking both').toEqual(['mal:63409'])
  })

  // Sekiro: No Defeat links AniList alone, and with no handle it stood as a second card beside AniList's anilist:197620
  test('its AniList id on a card with no MyAnimeList link, and nothing on a card with neither', async () => {
    const nodes = await pageNodes({ season: 'WINTER', seasonYear: 2027 }, rig({ tv: WINTER }).ctx)

    expect(nodes.map(node => [node.uri, node.handles.map(handle => [handle.relation, handle.node.uri, handle.node.scope, handle.node.url])])).toEqual([
      ['livechart:13819', [['SAME_AS', 'anilist:197620', 'RUN', 'https://anilist.co/anime/197620']]],
      ['livechart:13799', []],
    ])
  })

  // An id read off the wrong shape is a string every record carrying that shape shares, and a
  // SAME_AS handle unions them all for good. So anything but the measured shape mints nothing.
  test('a link not in the shape LiveChart publishes mints nothing', () => {
    for (const mal_url of [
      'https://myanimelist.net/anime/61001/Kousoku_Hikousen',
      'https://myanimelist.net/manga/61001',
      'https://myanimelist.net/anime/',
      'https://x.test/?u=https://myanimelist.net/anime/61001',
      null,
    ]) {
      expect(normalizeAnime(anime({ mal_url }), FALL_2026).handles, String(mal_url)).toEqual([])
    }
    for (const anilist_url of [
      'https://anilist.co/anime/197620/SEKIRO-NO-DEFEAT',
      'https://anilist.co/manga/197620',
      'https://anilist.co/anime/',
      'https://x.test/?u=https://anilist.co/anime/197620',
      null,
    ]) {
      expect(normalizeAnime(anime({ mal_url: null, anilist_url }), FALL_2026).handles, String(anilist_url)).toEqual([])
    }
  })
})

describe('which titles a season keeps', () => {
  test('only the ones that premiered in it, counted from its first day in Japan', () => {
    const at = (premiere_date: string | null) => premieredInSeason(anime({ premiere_date }), FALL_2026)

    expect(at('1996-01-08T10:30:00.000000000Z'), 'a long runner still listed').toBe(false)
    expect(at('2026-07-04T15:00:00.000000000Z'), 'last season, still airing').toBe(false)
    expect(at('2026-09-30T14:59:00.000000000Z'), 'one minute before October in Japan').toBe(false)
    expect(at('2026-09-30T15:00:00.000000000Z'), 'midnight on October 1 in Japan, still September in UTC').toBe(true)
    expect(at('2026-12-31T14:00:00.000000000Z')).toBe(true)
    expect(at(null), 'no date says nothing about which season').toBe(false)
  })

  test('the season page drops the rest before they become rows', async () => {
    const nodes = await pageNodes({ season: 'FALL', seasonYear: 2026 }, rig().ctx)
    expect(nodes.map(node => node.uri), 'not the late-September premiere, nor Detective Conan').toEqual(['livechart:13508', 'livechart:13631', 'livechart:13514', 'livechart:13383', 'livechart:12611'])
  })

  test('the winter cut is January 1, in Japan', () => {
    const winter = { season: 'winter', year: 2027 } as const
    expect(premieredInSeason(anime({ premiere_date: '2026-12-31T15:00:00.000000000Z' }), winter)).toBe(true)
    expect(premieredInSeason(anime({ premiere_date: '2026-12-31T14:59:00.000000000Z' }), winter)).toBe(false)
  })
})

describe('what is asked', () => {
  test('a named season is its page, one request per tab', async () => {
    const { urls, ctx } = rig()
    const nodes = await pageNodes({ season: 'FALL', seasonYear: 2026, status: 'FINISHED' }, ctx)

    expect(urls).toEqual([
      'https://www.livechart.me/fall-2026/tv',
      'https://www.livechart.me/fall-2026/movies',
      'https://www.livechart.me/fall-2026/ovas',
    ])
    expect(nodes.length).toBe(5)
  })

  test('RELEASING with no season named asks for the clock season', async () => {
    const { urls, ctx } = rig({})
    const now = animeSeasonOf()
    await pageNodes({ status: 'RELEASING' }, ctx)
    expect(urls).toEqual(['tv', 'movies', 'ovas'].map(tab => `https://www.livechart.me/${now.season}-${now.year}/${tab}`))
  })

  // OVAs holds ONAs, OVAs and specials together, a mix that once put a film on the Series tab, so it names nothing
  test('each tab names the format of its cards, but OVAs', async () => {
    for (const [tab, type, categories] of [
      ['tv', 'TV', ['ANIME', 'SERIES']],
      ['movies', 'MOVIE', ['ANIME', 'MOVIE']],
      ['ovas', undefined, ['ANIME']],
    ] as const) {
      const [node] = await pageNodes({ season: 'FALL', seasonYear: 2026 }, rig({ [tab]: PAGE }).ctx)
      expect({ type: node!.type, categories: node!.categories }, tab).toEqual({ type, categories })
    }
  })

  test('half a season, or a search, asks nothing', async () => {
    for (const input of [{ season: 'WINTER', status: 'RELEASING' }, { seasonYear: 2019, status: 'RELEASING' }, { search: 'airship' }]) {
      const { urls, ctx } = rig()
      expect(await pageNodes(input, ctx), JSON.stringify(input)).toEqual([])
      expect(urls, JSON.stringify(input)).toEqual([])
    }
  })

  test('a refused request is an empty season, not an error', async () => {
    expect(await pageNodes({ season: 'FALL', seasonYear: 2026 }, rig({ tv: PAGE }, 429).ctx)).toEqual([])
  })
})
