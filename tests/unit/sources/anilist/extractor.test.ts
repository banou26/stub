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
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'
import { unreleasedEpisodes } from '../../../../src/router/home/episodes'
import { neighbours } from '../../../../src/router/watch/neighbours'
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

// anilist:191656's links on 2026-10-29, and a streaming one marked disabled
const ICON = 'https://s4.anilist.co/file/anilistcdn/link/icon'
const LINKS_191656 = [
  { site: 'Official Site', siteId: 1, url: 'https://nama-anaru.com/', type: 'INFO', icon: null, isDisabled: false },
  { site: 'Twitter', siteId: 219, url: 'https://x.com/nama_anaru', type: 'SOCIAL', icon: `${ICON}/219-EwrfceXsqIWg.png`, isDisabled: false },
  { site: 'OceanVeil', siteId: 249, url: 'https://oceanveil.net/anime_titles/542', type: 'STREAMING', icon: `${ICON}/249-CFCxdC7MiNX3.png`, isDisabled: false },
  { site: 'Bilibili TV', siteId: 119, url: 'https://www.bilibili.tv/en/media/2433041', type: 'STREAMING', icon: `${ICON}/119-NCwGvCjFADGQ.png`, isDisabled: false },
  { site: 'iQ', siteId: 122, url: 'https://www.iq.com/album/28ki6pjn6a1', type: 'STREAMING', icon: `${ICON}/122-EPBJ2E0oPt5C.png`, isDisabled: false },
  { site: 'Netflix', siteId: 10, url: 'https://www.netflix.com/title/1', type: 'STREAMING', icon: `${ICON}/10-rVGPom8RCiwH.png`, isDisabled: true },
]

test('AniList\'s streaming links are the media\'s, and its other links and a disabled one are not', async () => {
  const fetch = async () => ({ status: 200, json: async () => ({ data: { Media: { ...MEDIA_178789, externalLinks: LINKS_191656 } } }) })
  const { media } = await openMedia({ fetch, similarMedia: async () => undefined } as never)
  expect(media.streamingLinks).toEqual([
    { site: 'OceanVeil', url: 'https://oceanveil.net/anime_titles/542', icon: `${ICON}/249-CFCxdC7MiNX3.png` },
    { site: 'Bilibili TV', url: 'https://www.bilibili.tv/en/media/2433041', icon: `${ICON}/119-NCwGvCjFADGQ.png` },
    { site: 'iQ', url: 'https://www.iq.com/album/28ki6pjn6a1', icon: `${ICON}/122-EPBJ2E0oPt5C.png` },
  ])
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

// The bundled season leaves these out (scripts/season-popularity.mjs), so a live season that kept them
// added them 1 to 5 s after its first paint: AniList marks 11 of the 16 cards Fall 2026 added late as
// adult (2026-10-17).
test('a season leaves out what AniList marks adult, and a search or a listing with no season keeps it', async () => {
  const shows = [{ ...PAGE_MEDIA, id: 1, isAdult: false }, { ...PAGE_MEDIA, id: 2, isAdult: true }]
  const { ctx, requests } = browseContext({ lastPage: 3 }, shows)
  const uris = (nodes: { uri: string }[]) => nodes.map(node => node.uri)

  const { value } = await openMediaPage(ctx, { season: 'FALL', seasonYear: 2026 })

  expect(requests[0]!.query, 'AniList answers only the fields asked for').toMatch(/\bisAdult\b/)
  expect(uris(value.mediaPage.nodes), 'one show from each of the 3 pages').toEqual(['anilist:1', 'anilist:1', 'anilist:1'])
  expect(uris(await browsedNodes(shows, { search: 'a show', season: 'FALL', seasonYear: 2026 }))).toEqual(['anilist:1', 'anilist:2'])
  expect(uris(await browsedNodes(shows, { genres: ['Romance'] }))).toEqual(['anilist:1', 'anilist:2'])
  expect(uris(await browsedNodes(shows, { seasonYear: 2026 }))).toEqual(['anilist:1', 'anilist:2'])
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
    nextAiringEpisode: { airingAt: Date.parse('2026-09-06T15:30:00Z') / 1000, episode: 11 },
  }

  afterEach(() => { vi.useRealTimers() })

  test('the next airing is the one anilist names', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-06T12:00:00Z'))

    const [node] = await browsedNodes([AIRING])

    expect(node.nextAiringEpisode).toEqual({
      episodeNumber: 11,
      airingAt: new Date('2026-09-06T15:30:00Z').toUTCString(),
    })
  })

  // One Piece, measured 2026-10-15: the schedule's first page is its 25 oldest entries, 1123 to 1147,
  // all aired, and the next is 1181 on 2027-01-03. AniZip dates 1 to 1180 and lists 1181 to 1184 bare,
  // Kitsu lists 1 to 1410 bare.
  test('a long run\'s next airing lies past the schedule\'s first page, and no row from it on is out', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T22:14:00Z'))
    const ONE_PIECE = {
      ...AIRING,
      id: 21,
      airingSchedule: {
        edges: Array.from({ length: 25 }, (_, i) => ({ node: { airingAt: 1743854400 + i * 7 * 86400, episode: 1123 + i } })),
      },
      nextAiringEpisode: { airingAt: 1798985760, episode: 1181 },
    }

    const [node] = await browsedNodes([ONE_PIECE])

    expect(node.nextAiringEpisode).toEqual({ episodeNumber: 1181, airingAt: 'Sun, 03 Jan 2027 14:16:00 GMT' })
    const episodes = Array.from({ length: 1410 }, (_, i) => ({ episodeNumber: i + 1, releaseDate: i < 1180 ? '2026-09-27' : undefined }))
    const media = { uri: 'anilist:21', status: node.status, nextAiringEpisode: node.nextAiringEpisode, episodes }
    expect(unreleasedEpisodes(media).indexOf(true), 'the first dimmed row').toBe(1180)
    expect(unreleasedEpisodes(media).slice(1180).every(Boolean)).toBe(true)
    expect(neighbours([undefined, media, undefined], 1179).next, 'Next from 1180').toBeUndefined()
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

// Measured 2026-10-25 on anime.fkn.app: with no other banner the home hero drew MyAnimeList's 425x600
// poster at 1920x1080 (Even the Student Council Has Its Holes!), while AniList's 1900x400 banner was
// asked for and dropped. Ranked at AniList's 0.8, it hid Kitsu's sharper ones on the title page.
test('AniList\'s banner comes after every other source\'s', async () => {
  const banner = 'https://s4.anilist.co/file/anilistcdn/media/anime/banner/195604-lQpCzTziSA17.jpg'
  const [node, bare] = await browsedNodes([{ ...PAGE_MEDIA, bannerImage: banner }, { ...PAGE_MEDIA, id: 2, bannerImage: null }])
  expect(bare.banners).toEqual([])

  const member = (uri: string, score: number, raw: Record<string, unknown>) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), owned: true, score, raw, fieldSeq: {},
  })
  const row = aggregateFields({
    cluster: {
      id: 'cl:anilist:1', aggUri: 'ag:(anilist:1,jw:1,kitsu:1)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    // the lowest banner scores of the other sources: the bundle's Kitsu banners, and JustWatch's backdrops
    members: [
      member('anilist:1', 0.8, node),
      member('kitsu:1', 0.2, { banners: [{ url: 'bundle-kitsu-banner', score: 0.2 }] }),
      member('jw:1', 0.2, { banners: [{ url: 'jw-backdrop', score: 0.1 }] }),
    ],
    related: [],
    relations: [],
    locationOrigin: '',
  })
  expect((row.banners as { url: string }[]).map(({ url }) => url)).toEqual(['bundle-kitsu-banner', 'jw-backdrop', banner])
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

// AniList's own schedule page holds a run's 25 oldest entries, all aired on a long one such as One Piece
test('the media query asks for the episodes AniList has not aired yet, and the media carries them in order', async () => {
  const bodies: string[] = []
  const upcoming = { nodes: [
    { episode: 4, airingAt: Date.parse('2026-10-23T14:00:00Z') / 1000 },
    null,
    { episode: 5, airingAt: Date.parse('2026-10-30T14:00:00Z') / 1000 },
  ] }
  const fetch = async (url: string, init?: { body?: string }) => {
    bodies.push(init?.body ?? '')
    return { status: 200, json: async () => ({ data: { Media: { ...MEDIA_178789, upcoming } } }) }
  }
  const { media } = await openMedia({ fetch, similarMedia: async () => undefined } as never)
  expect(JSON.parse(bodies[0]!).query).toMatch(/upcoming: airingSchedule\(notYetAired: true, perPage: 25\) \{\s*nodes \{\s*episode\s*airingAt\s*\}/)
  expect(media.airingSchedule).toEqual([
    { episodeNumber: 4, airingAt: 'Fri, 23 Oct 2026 14:00:00 GMT' },
    { episodeNumber: 5, airingAt: 'Fri, 30 Oct 2026 14:00:00 GMT' },
  ])
})

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex')

// The relay caches on the whole request body, so a change to the modal's or the listing's body sends
// every title's cached answer cold once. Hashes taken from 0.0.53's GET_MEDIA and BROWSE_QUERY plus the
// `nextAiringEpisode` field, the listing's `isAdult`, the modal's `upcoming` schedule, and `externalLinks`
// with what a streaming link needs, moved to the modal's alone since nothing reads them off a listing.
test('the details query goes out only when asked, and the modal and listing bodies are pinned', async () => {
  const { ctx, bodies } = creditsContext()
  await openBebop(ctx)
  await openBebop(ctx, true)
  expect(bodies).toHaveLength(2)
  expect(JSON.parse(bodies[0]!).query, 'the next airing is asked, not read off the schedule').toMatch(/nextAiringEpisode \{\s*airingAt\s*episode\s*\}/)
  expect(sha256(bodies[0]!), 'the modal body').toBe('d4f99cb31a675fc35d282850848443bfd00935847d52df6d2a8eb20a18231de2')
  expect(bodies[1], 'the page body').toContain('characters(page: 1, perPage: 25')
  expect(bodies[1]).not.toBe(bodies[0])

  const browse = browseContext({ lastPage: 1 })
  await openMediaPage(browse.ctx, { season: 'SUMMER', seasonYear: 2026 })
  expect(sha256(JSON.stringify(browse.requests[0])), 'the listing body').toBe('75c4edd6d344fdfabcb3cb3a5ff85c34105e4262b9a46b696277f563f2f78804')
})
