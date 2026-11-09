// The season LISTING, from the resolver down: which season the walk asks Kitsu for, and what the rows
// it hands back are allowed to claim. season-paging.test.ts pins the url builder on its own; this file
// pins the two decisions above it, the ones a season-filtered `mediaPage` input can get wrong.
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/kitsu/extractor'
import { SEASON_PAGE_SIZE, seasonPageNumbers } from '../../../../src/sources/kitsu/season-paging'
import { animeSeasonOf } from '../../../../src/sources/season'

const row = (id: string) => ({
  id,
  attributes: { subtype: 'TV', status: 'current', canonicalTitle: `title ${id}`, titles: { en: `title ${id}` } },
  relationships: { mappings: { data: [] } },
})

/** Every url the source asked for, and one row on the first season page and on any search. */
const rig = () => {
  const urls: string[] = []
  const ctx = {
    fetch: async (url: string) => {
      urls.push(url)
      const answers = url.includes('page%5Bnumber%5D=1&') || url.includes('filter%5Btext%5D')
      return { json: async () => ({ data: answers ? [row('1')] : [], included: [] }) }
    },
  } as never
  return { urls, ctx }
}

type Node = { uri: string, season?: string | null, seasonYear?: number | null }

const pageNodes = async (input: Record<string, unknown>, ctx: never): Promise<Node[]> => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input }, ctx).next()
  return value?.mediaPage?.nodes ?? []
}

const seasonUrls = (urls: string[]) => urls.filter(url => url.includes('filter%5Bseason%5D'))

describe('which season the walk asks for', () => {
  // A named season is answered whatever the status, because a season is a listing and not a moment:
  // the input names WINTER 2024 and RELEASING is beside the point.
  test('an input naming a season and year asks for that season, under every status', async () => {
    for (const status of [undefined, 'RELEASING', 'FINISHED']) {
      const { urls, ctx } = rig()
      await pageNodes({ season: 'WINTER', seasonYear: 2024, status }, ctx)

      expect(seasonUrls(urls).length, `status ${status}`).toBe(seasonPageNumbers().length)
      for (const url of urls) {
        expect(url).toContain('filter%5Bseason%5D=winter')
        expect(url).toContain('filter%5BseasonYear%5D=2024')
      }
    }
  })

  // The control for the test above: 2024 is behind us and the clock only moves forward, so a fetcher
  // that still reads the clock names some other year and this assertion can fail.
  test('a named season is asked for without the current year appearing anywhere', async () => {
    const { urls, ctx } = rig()
    await pageNodes({ season: 'WINTER', seasonYear: 2024 }, ctx)

    expect(animeSeasonOf().year).not.toBe(2024)
    expect(urls.join(' ')).not.toContain(`filter%5BseasonYear%5D=${animeSeasonOf().year}`)
  })

  test('status RELEASING with no season named still asks for the clock season', async () => {
    const { urls, ctx } = rig()
    const now = animeSeasonOf()
    await pageNodes({ status: 'RELEASING' }, ctx)

    expect(seasonUrls(urls).length).toBe(seasonPageNumbers().length)
    for (const url of urls) {
      expect(url).toContain(`filter%5Bseason%5D=${now.season}`)
      expect(url).toContain(`filter%5BseasonYear%5D=${now.year}`)
    }
  })

  // A season with no year cannot be asked for (Kitsu takes the pair), and the clock's season is not an
  // answer to it: it is the wrong season, bought with eight requests, and it leaks on every axis the
  // store's filter cannot see. Nothing, or the search the caller also asked for.
  test('a season named with no year is never answered with the clock season', async () => {
    const { urls, ctx } = rig()
    const nodes = await pageNodes({ status: 'RELEASING', season: 'WINTER' }, ctx)

    expect(seasonUrls(urls)).toEqual([])
    expect(nodes).toEqual([])

    const search = rig()
    await pageNodes({ status: 'RELEASING', season: 'WINTER', search: 'mushoku tensei' }, search.ctx)
    expect(seasonUrls(search.urls)).toEqual([])
    expect(search.urls.join(' ')).toContain('filter%5Btext%5D=mushoku%20tensei')
  })

  // The mirror of the above. A year alone used to reach the clock branch and spend the whole 8 request
  // walk on the wrong season, whose rows the store's filter then dropped, so the cost was invisible.
  test('a year named with no season is never answered with the clock season either', async () => {
    const { urls, ctx } = rig()
    const nodes = await pageNodes({ status: 'RELEASING', seasonYear: 2019 }, ctx)

    expect(seasonUrls(urls), 'no walk at all, not a walk of the wrong season').toEqual([])
    expect(nodes).toEqual([])
  })

  // The paging spelling is season-paging.test.ts' subject; what is pinned here is that the named-season
  // path reaches it, over the whole walk, rather than growing a second url builder.
  test('the named-season walk pages by number and size, once per page', async () => {
    const { urls, ctx } = rig()
    await pageNodes({ season: 'FALL', seasonYear: 2025 }, ctx)

    const numbers = urls.map(url => Number(/page%5Bnumber%5D=(\d+)/.exec(url)?.[1]))
    expect(numbers.sort((a, b) => a - b)).toEqual(seasonPageNumbers())
    for (const url of urls) {
      expect(url).toContain(`page%5Bsize%5D=${SEASON_PAGE_SIZE}`)
      expect(url).not.toContain('page%5Boffset%5D')
      expect(url).not.toContain('page%5Blimit%5D')
    }
  })
})

describe('what a row may claim about its season', () => {
  // Kitsu publishes no season on an anime record. The season query filtered on one, so the rows it
  // returned are in it, and that is a fact about the request rather than a guess about the row.
  test('rows from a season query carry the season and year they were filtered on', async () => {
    const { ctx } = rig()
    const nodes = await pageNodes({ season: 'WINTER', seasonYear: 2024 }, ctx)

    expect(nodes.length).toBe(1)
    expect(nodes[0]!.season).toBe('WINTER')
    expect(nodes[0]!.seasonYear).toBe(2024)
  })

  test('the clock season walk stamps the clock season', async () => {
    const { ctx } = rig()
    const now = animeSeasonOf()
    const nodes = await pageNodes({ status: 'RELEASING' }, ctx)

    expect(nodes.length).toBe(1)
    expect(nodes[0]!.season).toBe(now.season.toUpperCase())
    expect(nodes[0]!.seasonYear).toBe(now.year)
  })

  // The search path has no filter behind it, so a stamp there would be an invention: `filter[text]`
  // returns titles from any season, and the store's season filter is strict enough to believe one.
  test('rows from a search carry no season', async () => {
    const { ctx } = rig()
    const nodes = await pageNodes({ search: 'mushoku tensei' }, ctx)

    expect(nodes.length).toBe(1)
    expect(nodes[0]!.season).toBeUndefined()
    expect(nodes[0]!.seasonYear).toBeUndefined()
  })
})

// Kitsu's Summer 2026 walk of 2026-10-16: Saga of Tanya the Evil II leads page 1 with 4,841 users, and BAKI-DOU
// Part 2, which no other source counts, is on page 4 with 195
describe('a season walk\'s popularity', () => {
  const pages = JSON.parse(readFileSync(new URL('./__fixtures__/kitsu-season-summer-2026.json', import.meta.url), 'utf8'))
  const ctx = {
    fetch: async (url: string) => ({ json: async () => pages[Number(new URL(url, 'https://kitsu.io').searchParams.get('page[number]')) - 1] }),
  } as never

  test('is each show\'s users over the most any show of the walk has, on whichever page', async () => {
    const nodes = await pageNodes({ season: 'SUMMER', seasonYear: 2026 }, ctx) as (Node & { followers?: number, popularity?: number })[]

    expect(nodes.map(node => [node.uri, node.followers, node.popularity])).toEqual([
      ['kitsu:44778', 4841, 1],
      ['kitsu:49002', 3689, 3689 / 4841],
      ['kitsu:50635', 195, 195 / 4841],
      ['kitsu:48693', 28, 28 / 4841],
      ['kitsu:50931', 9, 9 / 4841],
    ])
  })

  // page 1 holds the season's top, and without it BAKI-DOU's 195 users read as a share of 1
  test('a walk with a page that failed keeps its counts and sets no share', async () => {
    const failing = (failed: () => Promise<unknown>) => ({
      fetch: async (url: string) => {
        const page = Number(new URL(url, 'https://kitsu.io').searchParams.get('page[number]'))
        return page === 1 ? failed() : { json: async () => pages[page - 1] }
      },
    }) as never

    for (const [reason, failed] of [
      ['unreachable', () => Promise.reject(new TypeError('fetch failed'))],
      ['an error answer', async () => ({ json: async () => ({ errors: [{ status: '503' }] }) })],
    ] as const) {
      const nodes = await pageNodes({ season: 'SUMMER', seasonYear: 2026 }, failing(failed)) as (Node & { followers?: number, popularity?: number })[]
      expect(nodes.map(node => [node.uri, node.followers, node.popularity]), reason).toEqual([
        ['kitsu:50635', 195, undefined],
        ['kitsu:48693', 28, undefined],
        ['kitsu:50931', 9, undefined],
      ])
    }
  })

  test('a search is no season, so it sets none', async () => {
    const nodes = await pageNodes({ search: 'youjo senki' }, { fetch: async () => ({ json: async () => pages[0] }) } as never) as { popularity?: number }[]

    expect(nodes.length).toBe(2)
    expect(nodes.map(node => node.popularity)).toEqual([undefined, undefined])
  })
})
