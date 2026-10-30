import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { memoryStorage } from '../party/fake-room'
import { fakeAnilist, RECOMMENDED } from './recommended-fakes'

// HOR-1087 (home's Recommended for you, from the viewer's list): which shows are asked about, AniList's picks summed
// and kept a day, and the picks shown.

const { KEPT_MS, KEPT_PICKS, SEEDS, SHOWN, askRecommended, keep, readKept, seedsOf, shownPicks, summedPicks } = await import('../../../src/router/home/recommended')

const DAY = 86_400_000
const at = (days: number) => new Date(Date.UTC(2026, 9, 31) - days * DAY).toISOString()
const work = (uri: string, status: string | null, score: number | null = null, updatedAt = at(1)) => ({ uri, summary: { status, score, updatedAt } })

// Frieren, Mushoku Tensei, Violet Evergarden, Re:ZERO's third season and Mushoku Tensei II's part two as AniList
// answered the row's own query (2026-10-31)
const FRIEREN = 154587
const MUSHOKU = 108465
const VIOLET = 21827
const RE_ZERO_3 = 163134
const MUSHOKU_2_2 = 166873
const RE_ZERO = 21355
const answer = (...ids: number[]) => ({ data: { Page: { media: ids.map(id => RECOMMENDED[id]!) } } })
const titleOf = ({ pick }: { pick: { title?: { english?: string | null, romaji?: string | null } | null } }) => pick.title?.english ?? pick.title?.romaji

afterEach(() => { vi.unstubAllGlobals() })

describe('the shows asked about', () => {
  test('are the ones liked: scored 7 out of 10 or more, else Watching, Rewatching or Completed, and on AniList', () => {
    expect(seedsOf([
      work('anilist:1', 'COMPLETED'),
      work('anilist:2', 'PLANNING'),
      work('anilist:3', 'DROPPED', 90),
      work('anilist:4', 'COMPLETED', 50),
      work('anilist:5', 'WATCHING'),
      work('anilist:6', 'REWATCHING'),
      work('anilist:7', 'PAUSED'),
      work('anilist:8', 'COMPLETED', 70),
      work('mal:9', 'COMPLETED'),
      work('kitsu:10', 'WATCHING'),
    ])).toEqual([1, 3, 5, 6, 8])
  })

  test(`are the ${SEEDS} best scored, then the latest changed`, () => {
    const works = [
      ...Array.from({ length: SEEDS }, (_, n) => work(`anilist:${100 + n}`, 'COMPLETED', null, at(n))),
      work('anilist:1', 'COMPLETED', null, at(SEEDS + 5)),
      work('anilist:2', 'COMPLETED', 80, at(400)),
    ]
    const seeds = seedsOf(works)
    expect(seeds).toHaveLength(SEEDS)
    expect(seeds, 'the scored one, though changed the longest ago').toContain(2)
    expect(seeds, 'the unscored one changed the longest ago').not.toContain(1)
    expect(seeds, 'and the unscored one changed after it, pushed out by the scored one').not.toContain(100 + SEEDS - 1)
  })
})

describe("AniList's picks", () => {
  test("are each work once with every seed's votes summed, the most voted first", () => {
    const picks = summedPicks(answer(FRIEREN, VIOLET), [])
    expect(picks.slice(0, 5).map(entry => [titleOf(entry), entry.rating])).toEqual([
      ['A Silent Voice', 1316],
      ['Delicious in Dungeon', 772],
      ['Vivy -Fluorite Eye\'s Song-', 732],
      // 507 from Frieren and 193 from Violet Evergarden, as Maquia's 235 and 340
      ['Wandering Witch: The Journey of Elaina', 700],
      ['Maquia: When the Promised Flower Blooms', 575],
    ])
  })

  test(`are ${KEPT_PICKS} at most, and none adult or rated 0 or below`, () => {
    const [first, second, ...rest] = RECOMMENDED[MUSHOKU]!.recommendations.nodes
    const many = { data: { Page: { media: [{ id: MUSHOKU, recommendations: { nodes: [
      { ...first, mediaRecommendation: { ...first!.mediaRecommendation, isAdult: true } },
      { ...second, rating: 0 },
      ...rest,
      ...Array.from({ length: KEPT_PICKS }, (_, n) => ({ rating: 1, mediaRecommendation: { id: 900_000 + n } })),
    ] } }] } } }
    const picks = summedPicks(many, [])
    expect(picks).toHaveLength(KEPT_PICKS)
    expect(picks.map(({ pick }) => pick.id)).not.toContain(first!.mediaRecommendation.id)
    expect(picks.map(({ pick }) => pick.id)).not.toContain(second!.mediaRecommendation.id)
  })

  test("leave out the seeds' own franchises, whose first seasons name neither a later season nor a seed", () => {
    const pickedBy = (seed: number) => RECOMMENDED[seed]!.recommendations.nodes.map(node => node.mediaRecommendation.id)
    expect(pickedBy(RE_ZERO_3), 'the control: one seed picks the first season of the other').toContain(MUSHOKU)
    expect(pickedBy(MUSHOKU_2_2), 'and the other way round').toContain(RE_ZERO)
    const ids = summedPicks(answer(RE_ZERO_3, MUSHOKU_2_2), []).map(({ pick }) => pick.id)
    expect(ids).not.toContain(MUSHOKU)
    expect(ids).not.toContain(RE_ZERO)
    expect(ids, 'the seeds themselves').not.toContain(MUSHOKU_2_2)
    expect(ids, 'the others stay').toEqual(expect.arrayContaining(pickedBy(RE_ZERO_3).filter(id => id !== MUSHOKU && id !== RE_ZERO).slice(0, 5)))
  })

  test("leave out a pick that reaches a seed's franchise only through another pick", () => {
    const relates = (relationType: string, id: number) => ({ relations: { edges: [{ relationType, node: { id } }] } })
    const media = [{ id: 1, ...relates('SOURCE', 10), recommendations: { nodes: [
      { rating: 9, mediaRecommendation: { id: 2, ...relates('SOURCE', 10) } },
      { rating: 8, mediaRecommendation: { id: 3, ...relates('PREQUEL', 2) } },
      { rating: 7, mediaRecommendation: { id: 4, ...relates('SOURCE', 40) } },
    ] } }]
    expect(summedPicks({ data: { Page: { media } } }, []).map(({ pick }) => pick.id)).toEqual([4])
  })

  test(`leave out what the lists hold before the ${KEPT_PICKS} are cut, so a long list still fills the row`, () => {
    const id = (n: number) => 900_000 + n
    const nodes = Array.from({ length: KEPT_PICKS * 2 }, (_, n) => ({ rating: KEPT_PICKS * 3 - n, mediaRecommendation: { id: id(n) } }))
    const works = Array.from({ length: KEPT_PICKS }, (_, n) => work(`anilist:${id(n)}`, 'PLANNING'))
    const picks = summedPicks({ data: { Page: { media: [{ id: 1, recommendations: { nodes } }] } } }, works)
    expect(picks).toHaveLength(KEPT_PICKS)
    expect(picks[0]!.pick.id, 'the first not on the lists').toBe(id(KEPT_PICKS))
  })

  test('are asked in one request from the browser, and a seed AniList does not have leaves the others', async () => {
    const anilist = fakeAnilist()
    const picks = await askRecommended([VIOLET, MUSHOKU, FRIEREN, 999_999_999], [], anilist.fetch)
    expect(anilist.asked).toEqual([{ url: 'https://graphql.anilist.co/', credentials: 'omit', ids: [VIOLET, MUSHOKU, FRIEREN, 999_999_999] }])
    expect(picks.map(titleOf)).toEqual(expect.arrayContaining(['A Silent Voice', 'Delicious in Dungeon', 'That Time I Got Reincarnated as a Slime']))
  })

  test('reject a failed request', async () => {
    await expect(askRecommended([FRIEREN], [], fakeAnilist({ status: 429 }).fetch)).rejects.toThrow('429')
  })
})

describe('the picks shown', () => {
  test("fold one franchise's seasons into its first, at its best pick's place", () => {
    const shown = shownPicks(summedPicks(answer(MUSHOKU), []), [])
    expect(shown.map(titleOf).slice(0, 3)).toEqual(['That Time I Got Reincarnated as a Slime', 'The Rising of the Shield Hero', 'The World\'s Finest Assassin Gets Reincarnated in Another World as an Aristocrat'])
    expect(shown[0]!.rating, 'its second season\'s').toBe(457)
    expect(shown.map(titleOf).filter(title => title?.includes('Slime'))).toHaveLength(1)
  })

  test(`leave out what the lists hold, by AniList id or MyAnimeList id, with its franchise, ${SHOWN} at most`, () => {
    const picks = summedPicks(answer(VIOLET, MUSHOKU), [])
    const shownWith = (...uris: string[]) => shownPicks(picks, uris.map(uri => work(uri, 'COMPLETED'))).map(titleOf)

    const none = shownWith()
    expect(none).toHaveLength(SHOWN)
    expect(none).toEqual(expect.arrayContaining(['Frieren: Beyond Journey’s End', 'A Silent Voice', 'That Time I Got Reincarnated as a Slime']))

    const listed = shownWith(`anilist:${FRIEREN}`, 'mal:28851')
    expect(listed).toHaveLength(SHOWN)
    // Frieren by AniList id, A Silent Voice by its MyAnimeList id
    expect(listed).not.toContain('Frieren: Beyond Journey’s End')
    expect(listed).not.toContain('A Silent Voice')
    expect(listed).toContain('That Time I Got Reincarnated as a Slime')

    // Slime's third season, which no pick is but the first names as its SEQUEL
    expect(shownWith('anilist:161802')).not.toContain('That Time I Got Reincarnated as a Slime')
    // its second season's part two, a pick folded into the card of the first, which names neither
    expect(shownWith('anilist:116742')).not.toContain('That Time I Got Reincarnated as a Slime')
  })
})

describe('the answer kept', () => {
  const NOW = Date.UTC(2026, 9, 31)
  const picks = summedPicks(answer(FRIEREN), [])

  test('serves the same shows for a day, and none other', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    keep([1, 2], picks, NOW)
    expect(readKept([1, 2], NOW + KEPT_MS - 1)).toEqual(picks)
    expect(readKept([1, 2], NOW + KEPT_MS), 'a day later').toBeUndefined()
    expect(readKept([1, 3], NOW + 1), 'other shows').toBeUndefined()
    expect(readKept([1], NOW + 1), 'fewer shows').toBeUndefined()
  })

  test('is none where storage refuses', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } })
    expect(() => keep([1], picks, NOW)).not.toThrow()
    expect(readKept([1], NOW)).toBeUndefined()
  })
})
