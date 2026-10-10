// LiveChart's season list, on hand-written rows shaped like `/api/v1/anime` answered on 2026-10-10.
import { describe, expect, test } from 'vite-plus/test'

import { normalizeAnime, premieredInSeason, resolvers, type LiveChartAnime } from '../../../../src/sources/livechart/extractor'
import { animeSeasonOf } from '../../../../src/sources/season'

const FALL_2026 = { season: 'fall', year: 2026 } as const

// the answer carries more than the source reads, so a row here may too
const anime = (fields: Partial<LiveChartAnime> & Record<string, unknown> = {}): LiveChartAnime => ({
  id: 12001,
  romaji_title: 'Kousoku Hikousen',
  english_title: 'The Fast Airship',
  native_title: '高速飛行船',
  synopsis: 'A courier crosses the sea of clouds.',
  premiere_date: '2026-10-08T15:00:00.000000000Z',
  premiere_date_precision: 3,
  episode_count: 12,
  anime_type: 1,
  avg_rating: 8.2,
  poster_image_large: 'https://u.livechart.me/anime/12001/poster_image/0f.webp/large.jpg',
  mal_url: 'https://myanimelist.net/anime/61001',
  ...fields,
})

/** Every url asked for, answered with `items` (or the given status) on the season list. */
const rig = (items: LiveChartAnime[] = [anime()], status = 200) => {
  const urls: string[] = []
  const ctx = {
    fetch: async (url: string) => {
      urls.push(url)
      return { ok: status === 200, status, json: async () => ({ has_more: false, items }) }
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

  test('anime_type names the format, as measured against MyAnimeList', () => {
    const shaped = (anime_type: number | null) => {
      const { type, categories } = normalizeAnime(anime({ anime_type }), FALL_2026)
      return { type, categories }
    }
    expect(shaped(1)).toEqual({ type: 'TV', categories: ['ANIME', 'SERIES'] })
    expect(shaped(2)).toEqual({ type: 'MOVIE', categories: ['ANIME', 'MOVIE'] })
    expect(shaped(4)).toEqual({ type: 'ONA', categories: ['ANIME', 'SERIES'] })
  })

  // Type 5 was three films and one special on 2026-10-10, and type 3 one film. A row claiming SPECIAL
  // or SERIES for those at 0.6 outranks Kitsu's MOVIE in a cluster with no AniList or MyAnimeList
  // member, and moves the film to the Series tab. So they claim nothing and another member decides.
  test('a type the measurement does not settle claims no format at all', () => {
    for (const anime_type of [3, 5, 9, null]) {
      const { type, categories } = normalizeAnime(anime({ anime_type }), FALL_2026)
      expect({ type, categories }, String(anime_type)).toEqual({ type: undefined, categories: ['ANIME'] })
    }
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

  test('the season list drops the rest before they become rows', async () => {
    const { ctx } = rig([
      anime({ id: 1, premiere_date: '1996-01-08T10:30:00.000000000Z' }),
      anime({ id: 2 }),
    ])
    const nodes = await pageNodes({ season: 'FALL', seasonYear: 2026 }, ctx)
    expect(nodes.map(node => node.uri)).toEqual(['livechart:2'])
  })

  test('the winter cut is January 1, in Japan', () => {
    const winter = { season: 'winter', year: 2027 } as const
    expect(premieredInSeason(anime({ premiere_date: '2026-12-31T15:00:00.000000000Z' }), winter)).toBe(true)
    expect(premieredInSeason(anime({ premiere_date: '2026-12-31T14:59:00.000000000Z' }), winter)).toBe(false)
  })
})

describe('what is asked', () => {
  test('a named season is one request for the whole of it', async () => {
    const { urls, ctx } = rig()
    const nodes = await pageNodes({ season: 'FALL', seasonYear: 2026, status: 'FINISHED' }, ctx)

    expect(urls).toEqual(['https://www.livechart.me/api/v1/anime?season=fall&year=2026&limit=200'])
    expect(nodes.length).toBe(1)
  })

  test('RELEASING with no season named asks for the clock season', async () => {
    const { urls, ctx } = rig([])
    const now = animeSeasonOf()
    await pageNodes({ status: 'RELEASING' }, ctx)
    expect(urls).toEqual([`https://www.livechart.me/api/v1/anime?season=${now.season}&year=${now.year}&limit=200`])
  })

  test('half a season, or a search, asks nothing', async () => {
    for (const input of [{ season: 'WINTER', status: 'RELEASING' }, { seasonYear: 2019, status: 'RELEASING' }, { search: 'airship' }]) {
      const { urls, ctx } = rig()
      expect(await pageNodes(input, ctx), JSON.stringify(input)).toEqual([])
      expect(urls, JSON.stringify(input)).toEqual([])
    }
  })

  test('a refused request is an empty season, not an error', async () => {
    const { ctx } = rig([anime()], 429)
    expect(await pageNodes({ season: 'FALL', seasonYear: 2026 }, ctx)).toEqual([])
  })
})
