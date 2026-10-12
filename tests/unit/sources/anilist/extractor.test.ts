// The Crunchyroll mapper used to import crunchyroll's `matchSeasonByDate` and `getMedia`, so one source
// walked another's API from inside its own resolver: outside the worker's budget, deduplicated by
// nothing, and reading only the date rule. It now asks `ctx.similarMedia`, which is budgeted,
// deduplicated and verified in one place (worker/extractor.ts) and reads every rule in sources/similar.ts.
//
// Driven through the real `media` subscription so the request context travels the way the consumer
// stamps it: `similarMediaFrom` reads a real hop off `input.context` and descends it with 'anilist' on
// the chain, instead of counting a context miss.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { createHash } from 'node:crypto'

import { closeRoot, openRoot } from '../../../../src/worker/request-context'
import { resolvers } from '../../../../src/sources/anilist/extractor'
import BEBOP from '../../../fixtures/credits/anilist-bebop.json'
import SAMPLES from '../../../fixtures/descriptions/samples.json'

const ANILIST = 'https://graphql.anilist.co/'

const ENGLISH = 'Mushoku Tensei: Jobless Reincarnation Season 3'
const ROMAJI = 'Mushoku Tensei III: Isekai Ittara Honki Dasu'
const NATIVE = '無職転生 Ⅲ ～異世界行ったら本気だす～'

// AniList's own shape for the season 3 record, trimmed to what fetchMedia reads. The external link is
// the one fact that makes the mapper run at all: siteId 5 is Crunchyroll, and the series id is in the url.
const MEDIA_178789 = {
  id: 178789,
  idMal: 59193,
  title: { english: ENGLISH, romaji: ROMAJI, native: NATIVE },
  startDate: { year: 2026, month: 7, day: 4 },
  endDate: { year: null, month: null, day: null },
  episodes: 14,
  format: 'TV',
  type: 'ANIME',
  status: 'RELEASING',
  siteUrl: 'https://anilist.co/anime/178789',
  externalLinks: [{ site: 'Crunchyroll', siteId: 5, url: 'https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation' }],
  airingSchedule: { edges: [] },
  coverImage: {},
  trailer: null,
  description: 'A show.',
  popularity: 1,
  averageScore: 80,
}

const CR_SEASON_3 = {
  uri: 'cr:G24H1N3MP-GS00374452',
  origin: 'cr',
  id: 'G24H1N3MP-GS00374452',
  scope: 'RUN',
  titles: [{ title: 'Mushoku Tensei: Jobless Reincarnation' }],
  handles: [],
}

// Every url the resolver reaches, recorded. Only AniList's endpoint is answered: anything else throws,
// so a mapper that still reaches for another source's API fails loudly and leaves the url in the list.
const context = (similarMedia: (...args: unknown[]) => Promise<unknown>) => {
  const urls: string[] = []
  const fetch = async (url: string) => {
    urls.push(url)
    if (url === ANILIST) return { status: 200, json: async () => ({ data: { Media: MEDIA_178789 } }) }
    throw new Error(`fixture has no route for ${url}`)
  }
  return { ctx: { fetch, similarMedia } as never, urls }
}

const roots: string[] = []
afterEach(() => {
  for (const rootId of roots.splice(0)) closeRoot(rootId)
  vi.useRealTimers()
})

const openMedia = async (ctx: never) => {
  const root = openRoot('MEDIA')
  roots.push(root.rootId)
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'anilist:178789', context: root } }, ctx).next()
  return { root, media: value.media }
}

const handleUris = (media: { handles: { node: { uri: string } }[] }) => media.handles.map(handle => handle.node.uri)

test('the crunchyroll link is handed to similarMedia with what anilist knows, and the answer is the handle', async () => {
  const similarMedia = vi.fn(async () => CR_SEASON_3)
  const { ctx, urls } = context(similarMedia)

  const { root, media } = await openMedia(ctx)

  expect(similarMedia).toHaveBeenCalledTimes(1)
  expect(similarMedia).toHaveBeenCalledWith('cr', expect.objectContaining({
    showId: 'G24H1N3MP',
    startDate: 'Sat, 04 Jul 2026 00:00:00 GMT',
    titles: [ENGLISH, ROMAJI, NATIVE],
    episodeCount: 14,
    context: root,
  }))
  expect(handleUris(media)).toContain('cr:G24H1N3MP-GS00374452')
  expect(handleUris(media)).toContain('mal:59193')
  expect([...new Set(urls)], 'the only API this source reaches is its own').toEqual([ANILIST])

  // The handle names the row and does not describe it. A handle node is written to the store as a row,
  // where an array of equal length replaces the one it finds: attached whole, the funnel's answer (titles
  // selected as `{ title }`) replaced crunchyroll's own titles, language and score gone (2026-09-05).
  const cr = media.handles.find((handle: { node: { uri: string } }) => handle.node.uri === 'cr:G24H1N3MP-GS00374452')
  expect(cr.relation).toBe('SAME_AS')
  expect(cr.node.titles, 'an identity handle carries no copy of the row it names').toEqual([])
  expect(cr.node.scope).toBe('RUN')
})

// The control: a refusal from the ask is not a failure of the resolver, which still answers with
// everything else it holds.
test('a refusal leaves the media with its other handles', async () => {
  const similarMedia = vi.fn(async () => undefined)
  const { ctx } = context(similarMedia)

  const { media } = await openMedia(ctx)

  expect(similarMedia).toHaveBeenCalledTimes(1)
  expect(media.uri).toBe('anilist:178789')
  expect(handleUris(media)).toEqual(['mal:59193'])
})

// The browse path, driven through the real `mediaPage` subscription. Every request body is kept, so a
// test reads the exact variables the resolver built rather than a helper's idea of them: the argument
// NAMES are AniList's (`format_in`, `genre_in`), and a wrong one costs the whole document.
const browseContext = (pageInfo: { lastPage?: number }, media: unknown[] = []) => {
  const requests: { query: string, variables: Record<string, unknown> }[] = []
  const fetch = async (url: string, init?: { body?: string }) => {
    if (url !== ANILIST) throw new Error(`fixture has no route for ${url}`)
    requests.push(JSON.parse(init?.body ?? '{}'))
    return { status: 200, json: async () => ({ data: { Page: { pageInfo, media } } }) }
  }
  return { ctx: { fetch } as never, requests }
}

const openMediaPage = (ctx: never, input: Record<string, unknown>) =>
  (resolvers.Subscription as any).mediaPage.subscribe(undefined, { input }, ctx).next()

const browsedNodes = async (media: unknown[], input: Record<string, unknown> = { season: 'SUMMER', seasonYear: 2026 }) => {
  const { ctx } = browseContext({ lastPage: 1 }, media)
  const { value } = await openMediaPage(ctx, input)
  return value.mediaPage.nodes
}

// One AniList row carrying the four fields the browse filters read. Two of its tags are flagged, one
// per flag, and one genre is empty: both are what the normalizer has to drop.
const PAGE_MEDIA = {
  id: 1,
  title: { romaji: 'A show' },
  format: 'TV',
  type: 'ANIME',
  status: 'FINISHED',
  season: 'SUMMER',
  seasonYear: 2026,
  genres: ['Action', 'Adventure', null, ''],
  tags: [
    { name: 'Isekai', isMediaSpoiler: false, isGeneralSpoiler: false },
    { name: 'Dead Protagonist', isMediaSpoiler: true, isGeneralSpoiler: false },
    { name: 'Time Loop', isMediaSpoiler: false, isGeneralSpoiler: true },
  ],
  startDate: { year: null, month: null, day: null },
  endDate: { year: null, month: null, day: null },
  externalLinks: [],
  airingSchedule: { edges: [] },
  coverImage: {},
  siteUrl: 'https://anilist.co/anime/1',
}

test('a filtered browse carries anilist own argument names, and drops the formats it has no name for', async () => {
  const { ctx, requests } = browseContext({ lastPage: 1 })

  await openMediaPage(ctx, {
    season: 'SUMMER',
    seasonYear: 2026,
    status: 'FINISHED',
    formats: ['TV', 'ANIME', 'MOVIE', 'LIVE_ACTION', 'TV_SHORT'],
    genres: ['Action'],
    tags: ['Isekai'],
  })

  expect(requests).toHaveLength(1)
  expect(requests[0]!.variables).toEqual({
    season: 'SUMMER',
    seasonYear: 2026,
    status: 'FINISHED',
    format_in: ['TV', 'MOVIE', 'TV_SHORT'],
    genre_in: ['Action'],
    tag_in: ['Isekai'],
    sort: ['POPULARITY_DESC'],
    page: 1,
  })
  expect(requests[0]!.query, 'a Page with no type argument answers manga formats too').toContain('type: ANIME')
})

test('a browse naming only formats anilist has no name for sends no format_in at all', async () => {
  const { ctx, requests } = browseContext({ lastPage: 1 })

  await openMediaPage(ctx, { formats: ['ANIME', 'LIVE_ACTION'] })

  expect(requests).toHaveLength(1)
  expect('format_in' in requests[0]!.variables, 'an empty list would filter everything out upstream').toBe(false)
})

test('genres, non spoiler tags, season and seasonYear survive normalization', async () => {
  const [node] = await browsedNodes([PAGE_MEDIA])

  expect(node.genres).toEqual(['Action', 'Adventure'])
  expect(node.tags).toEqual(['Isekai'])
  expect(node.tags, 'a tag flagged for this media names a twist').not.toContain('Dead Protagonist')
  expect(node.tags, 'and so does one flagged in general').not.toContain('Time Loop')
  expect(node.season).toBe('SUMMER')
  expect(node.seasonYear).toBe(2026)
})

test('a description arrives without the source credit ending it', async () => {
  const [node] = await browsedNodes([{ ...PAGE_MEDIA, description: SAMPLES.anilistFrieren.description }])

  expect(node.descriptions[0].description).toMatch(/new adventure…$/)
  expect(node.shortDescriptions[0].shortDescription).toMatch(/new adventure…$/)
})

test('a season the schema has no member for never reaches the store', async () => {
  const [node] = await browsedNodes([{ ...PAGE_MEDIA, season: 'AUTUMN' }])

  expect(node.season).toBeUndefined()
})

test('a tv short is emitted as TV_SHORT and still reads as a series', async () => {
  const [node] = await browsedNodes([{ ...PAGE_MEDIA, format: 'TV_SHORT' }])

  expect(node.type).toBe('TV_SHORT')
  expect(node.categories).toEqual(['ANIME', 'SERIES'])
})

test('cancelled and hiatus map through, so a filter naming either can match', async () => {
  const nodes = await browsedNodes([
    { ...PAGE_MEDIA, id: 1, status: 'CANCELLED' },
    { ...PAGE_MEDIA, id: 2, status: 'HIATUS' },
  ])

  expect(nodes.map((node: { status?: string }) => node.status)).toEqual(['CANCELLED', 'HIATUS'])
})

// Two clocks, deliberately in different seasons: one alone would pass on a clock that was never
// faked at all, for the three months the real date happens to agree with it.
// RELEASING used to be substituted here with the season the clock was in, because the home page said
// RELEASING and meant that. It names its season now, so the substitution had exactly one caller left,
// the search page's Airing control, where it was the whole bug: asking which shows are IN this season
// instead of which are releasing returned a page identical to an unfiltered season, and no
// long-running show could ever match.
test('a releasing browse asks for the status, not for the season the clock is in', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-02-10T12:00:00Z'))
  const { ctx, requests } = browseContext({ lastPage: 12 })

  await openMediaPage(ctx, { status: 'RELEASING' })

  expect(requests[0]!.variables.status).toBe('RELEASING')
  expect('season' in requests[0]!.variables).toBe(false)
  expect('seasonYear' in requests[0]!.variables).toBe(false)
  // no free text, so it still walks the three pages a listing gets
  expect(requests.map(request => request.variables.page)).toEqual([1, 2, 3])
})

// The home page's own ask, which is what the substitution used to serve. It names the pair outright,
// so the season reaches AniList as a season and no status rides along to narrow it: a season listing
// carries the runs that have not aired yet.
test('a named season is asked for as a season, with no status attached', async () => {
  const { ctx, requests } = browseContext({ lastPage: 12 })

  await openMediaPage(ctx, { season: 'SUMMER', seasonYear: 2026 })

  expect(requests[0]!.variables.season).toBe('SUMMER')
  expect(requests[0]!.variables.seasonYear).toBe(2026)
  expect('status' in requests[0]!.variables).toBe(false)
  expect(requests.map(request => request.variables.page)).toEqual([1, 2, 3])
})

test('a search asks for exactly one page, ranked by SEARCH_MATCH, and names no season', async () => {
  const { ctx, requests } = browseContext({ lastPage: 12 })

  await openMediaPage(ctx, { search: 'mushoku tensei' })

  expect(requests, 'a search is one request whatever the last page says').toHaveLength(1)
  expect(requests[0]!.variables.search).toBe('mushoku tensei')
  // the old search query carried `sort: SEARCH_MATCH` as a literal inside the document; folding the
  // two queries into one moved it into the variables, where it is easy to drop. Without it AniList
  // orders by id, and the one page a search fetches may not hold the title that was asked for.
  expect(requests[0]!.variables.sort).toEqual(['SEARCH_MATCH'])
  expect('season' in requests[0]!.variables).toBe(false)
})

test('an input naming nothing this source can browse yields nothing and asks nothing', async () => {
  const { ctx, requests } = browseContext({ lastPage: 12 })

  for (const input of [{}, { formats: [] }, { genres: [] }, { tags: [] }, { after: 3 }]) {
    const { done, value } = await openMediaPage(ctx, input)
    expect(done, `${JSON.stringify(input)} names no filter`).toBe(true)
    expect(value).toBeUndefined()
  }
  expect(requests).toEqual([])
})

// Three fields the search page's card and list modes lead with, all of them already inside the query
// AniList was answering, all of them dropped on the floor by the normalizer until 2026-09-06.
describe('what the card and list modes read', () => {
  const AIRING = {
    ...PAGE_MEDIA,
    status: 'RELEASING',
    averageScore: 84,
    coverImage: { extraLarge: 'https://img.test/cover.jpg', color: '#e4a15d' },
    airingSchedule: {
      edges: [
        { node: { airingAt: Date.parse('2026-09-13T15:30:00Z') / 1000, episode: 12 } },
        { node: { airingAt: Date.parse('2026-08-30T15:30:00Z') / 1000, episode: 10 } },
        { node: { airingAt: Date.parse('2026-09-06T15:30:00Z') / 1000, episode: 11 } },
      ],
    },
  }

  afterEach(() => { vi.useRealTimers() })

  test('the next airing is the soonest episode still ahead, never the first in the list', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))

    const [node] = await browsedNodes([AIRING])

    expect(node.nextAiringEpisode).toEqual({
      episodeNumber: 11,
      airingAt: new Date('2026-09-06T15:30:00Z').toUTCString(),
    })
  })

  test('a run with nothing left scheduled carries no next airing', async () => {
    const [node] = await browsedNodes([PAGE_MEDIA])
    expect(node.nextAiringEpisode).toBeUndefined()
  })

  // AniList is the ONLY source that publishes a cover colour, and the card and row tint every chip
  // with it, so losing it here is losing it everywhere.
  test('the cover carries anilist own average colour', async () => {
    const [node] = await browsedNodes([AIRING])
    expect(node.covers[0].color).toBe('#e4a15d')
  })

  test('averageScore stays the percentage anilist publishes', async () => {
    const [node] = await browsedNodes([AIRING])
    expect(node.averageScore).toBe(84)
  })
})

// Cowboy Bebop as AniList's details query answers it, trimmed to three characters and three staff
const creditsContext = () => {
  const bodies: string[] = []
  const fetch = async (url: string, init?: { body?: string }) => {
    if (url !== ANILIST) throw new Error(`fixture has no route for ${url}`)
    bodies.push(init?.body ?? '')
    const { query } = JSON.parse(init?.body ?? '{}') as { query: string }
    const { characters, staff, studios, ...media } = BEBOP
    return { status: 200, json: async () => ({ data: { Media: query.includes('characters(') ? BEBOP : media } }) }
  }
  return { ctx: { fetch, similarMedia: async () => undefined } as never, bodies }
}

const openBebop = async (ctx: never, details?: boolean) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'anilist:1', details } }, ctx).next()
  return value.media
}

test('the details answer carries the characters, their voice actors by language, the studios, length and source', async () => {
  const media = await openBebop(creditsContext().ctx, true)

  const spike = media.credits.characters[0]
  expect(spike.id).toBe('anilist:1')
  expect(spike.names[0]).toBe('Spike Spiegel')
  expect(spike.role).toBe('MAIN')
  expect(spike.voiceActors.filter((actor: { language: string }) => actor.language === 'ja').map((actor: { person: { id: string, name: string } }) => actor.person))
    .toEqual([expect.objectContaining({ id: 'anilist:95011', name: 'Kouichi Yamadera' })])
  expect(spike.voiceActors.filter((actor: { language: string }) => actor.language === 'en').map((actor: { person: { id: string } }) => actor.person.id))
    .toEqual(['anilist:95012'])
  expect(media.credits.staff[1]).toEqual(expect.objectContaining({ person: expect.objectContaining({ name: 'Shinichirou Watanabe' }), roles: ['Director'] }))
  expect(media.studios).toEqual(['Sunrise'])
  expect(media.duration).toBe(24)
  expect(media.sourceMaterial).toBe('ORIGINAL')
})

test('length and source ride on every answer, and the credits only on a details one', async () => {
  const media = await openBebop(creditsContext().ctx)

  expect(media.duration).toBe(24)
  expect(media.sourceMaterial).toBe('ORIGINAL')
  expect(media.credits).toBeUndefined()
  expect(media.studios).toBeUndefined()
})

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex')

// The relay caches on the whole request body, so the modal's and the listing's bodies must stay byte
// for byte what they were before credits existed. Hashes taken from 0.0.53's GET_MEDIA and BROWSE_QUERY.
test('the details query goes out only when asked, and the modal and listing bodies are unchanged', async () => {
  const { ctx, bodies } = creditsContext()
  await openBebop(ctx)
  await openBebop(ctx, true)
  expect(bodies).toHaveLength(2)
  expect(sha256(bodies[0]!), 'the modal body').toBe('442755783192b6dbf4201ac6fd17bd02840588585e2dc0b9fdb6d408d917e3e7')
  expect(bodies[1], 'the page body').toContain('characters(page: 1, perPage: 25')
  expect(bodies[1]).not.toBe(bodies[0])

  const browse = browseContext({ lastPage: 1 })
  await openMediaPage(browse.ctx, { season: 'SUMMER', seasonYear: 2026 })
  expect(sha256(JSON.stringify(browse.requests[0])), 'the listing body').toBe('4f568b202215e5d9325482c643c3cfb90966f63930b5387a87b2c8ef9314526d')
})
