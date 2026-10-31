// JustWatch's search on the page of a show it files beside another of that name or under a longer one. The entries are
// what its API answered on 2026-10-31, cut to what the gate reads.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'

type Season = [number: number, episodes: number, year: number]
type Hit = { objectId: number, title: string, tmdbId?: string, imdbId: string, seasons: Season[], film?: number }

const SKINS_2007: Hit = { objectId: 22034, title: 'Skins', tmdbId: '900', imdbId: 'tt0840196', seasons: [[1, 9, 2007], [2, 10, 2008], [3, 10, 2009], [4, 8, 2010], [5, 8, 2011], [6, 10, 2012], [7, 6, 2013]] }
const SKINS_2011: Hit = { objectId: 33406, title: 'Skins', tmdbId: '34390', imdbId: 'tt1755893', seasons: [[1, 10, 2011]] }
const SHAMELESS_2011: Hit = { objectId: 20660, title: 'Shameless', tmdbId: '34307', imdbId: 'tt1586680', seasons: [[1, 12, 2011], [2, 12, 2012], [3, 12, 2013], [8, 12, 2017]] }
const SHAMELESS_2004: Hit = { objectId: 22329, title: 'Shameless', tmdbId: '1906', imdbId: 'tt0377260', seasons: [[1, 7, 2004], [8, 22, 2011]] }
const ARCANE: Hit = { objectId: 222333, title: 'Arcane: League of Legends', tmdbId: '94605', imdbId: 'tt11126994', seasons: [[1, 9, 2021], [2, 9, 2024]] }
const THE_OFFICE: Hit = { objectId: 22138, title: 'The Office', tmdbId: '2316', imdbId: 'tt0386676', seasons: [[1, 6, 2005], [2, 22, 2005], [3, 23, 2006]] }
const MONEY_HEIST: Hit = { objectId: 56768, title: 'Money Heist', tmdbId: '71446', imdbId: 'tt6468322', seasons: [[1, 13, 2017], [2, 9, 2017], [3, 8, 2019]] }

const seasonId = (hit: Hit, number: number) => hit.objectId * 100 + number

const idOf = (hit: Hit) => `${hit.film ? 'tm' : 'ts'}${hit.objectId}`

const node = (hit: Hit, query: string) => ({
  id: idOf(hit),
  objectId: hit.objectId,
  objectType: hit.film ? 'MOVIE' : 'SHOW',
  content: {
    title: hit.title,
    fullPath: `/us/tv-show/${hit.objectId}`,
    posterUrl: null,
    shortDescription: null,
    originalReleaseYear: hit.film ?? hit.seasons[0]?.[2],
    externalIds: { imdbId: hit.imdbId, .../(?<!tmdb: )externalIds \{\s+tmdbId/.test(query) ? { tmdbId: hit.tmdbId } : {} },
    ...query.includes('tmdb: externalIds') ? { tmdb: { tmdbId: hit.tmdbId } } : {},
  },
  offers: [],
  extraOffers: [],
  seasons: hit.seasons.map(([seasonNumber, totalEpisodeCount, originalReleaseYear]) => ({
    objectId: seasonId(hit, seasonNumber),
    totalEpisodeCount,
    content: { seasonNumber, isReleased: true, originalReleaseYear },
    episodes: [],
  })),
})

// answers what the query names and nothing more, so a search that stops asking for TMDB's id stops receiving it
const jw = (hits: Hit[]) => async (_: string, init?: { body: string }) => ({
  json: async () => {
    const { query, variables } = JSON.parse(init!.body) as { query: string, variables: { nodeId?: string } }
    return query.includes('GetSearchTitles')
      ? { data: { popularTitles: { edges: hits.map(hit => ({ node: node(hit, query) })) } } }
      : { data: { node: node(hits.find(hit => idOf(hit) === variables.nodeId)!, query) } }
  },
})

const answer = async (uri: string, cluster: Record<string, unknown>, hits: Hit[]) => {
  const context = { findAggregatedMedia: async () => cluster, listenForMediaChanges: async function* () {}, fetch: jw(hits) }
  const { value } = await (resolvers as any).Subscription.media.subscribe(undefined, { input: { uri } }, context).next()
  return value.media as { uri: string, handles: { relation: string, node: { uri: string } }[] } | null
}

const imdbOf = (media: Awaited<ReturnType<typeof answer>>) =>
  media?.handles.filter(handle => handle.node.uri.startsWith('imdb:')).map(handle => `${handle.relation} ${handle.node.uri}`)

const cluster = (title: string, startDate: string, episodeCount: number, handles: unknown[] = []) => ({
  categories: ['SERIES'], titles: [{ title }], startDate, episodeCount, handles,
})

test('TMDB\'s id takes the show of the page over an older one of that name dated in its years', async () => {
  const media = await answer('ag:(tmdb:34390-s1)', cluster('Skins', '2011-01-17', 10), [SKINS_2007, SKINS_2011])
  expect(media?.uri).toBe(`jw:33406-${seasonId(SKINS_2011, 1)}`)
  expect(imdbOf(media)).toEqual(['PART_OF imdb:tt1755893'])
})

test('a later season of the older show is told from the newer show the same way', async () => {
  const media = await answer('ag:(tmdb:1906-s8)', cluster('Shameless', '2011-01-10', 22), [SHAMELESS_2011, SHAMELESS_2004])
  expect(media?.uri).toBe(`jw:22329-${seasonId(SHAMELESS_2004, 8)}`)
  expect(imdbOf(media)).toEqual(['PART_OF imdb:tt0377260'])
})

test('an entry naming another show is refused even with nothing better found, as is its IMDb id', async () => {
  expect(await answer('ag:(tmdb:34390-s1)', cluster('Skins', '2011-01-17', 10), [SKINS_2007])).toBeNull()
})

test('the page\'s IMDb id, from TVmaze, does the same on an address naming no TMDB show', async () => {
  const known = cluster('Skins', '2011-01-17', 10, [{ relation: 'PART_OF', node: { origin: 'imdb', id: 'tt1755893' } }])
  const media = await answer('ag:(tvmaze:2008-s1)', known, [SKINS_2007, SKINS_2011])
  expect(media?.uri).toBe(`jw:33406-${seasonId(SKINS_2011, 1)}`)
})

test('TMDB\'s id links an entry whose title the gate refuses', async () => {
  const media = await answer('ag:(tmdb:94605-s1)', cluster('Arcane', '2021-11-06', 9), [ARCANE])
  expect(media?.uri).toBe(`jw:222333-${seasonId(ARCANE, 1)}`)
  expect(imdbOf(media)).toEqual(['PART_OF imdb:tt11126994'])
})

test('on a show TMDB\'s id settles, its season number places a season two years share', async () => {
  const media = await answer('ag:(tmdb:2316-s2)', cluster('The Office', '2005-09-20', 22), [THE_OFFICE])
  expect(media?.uri).toBe(`jw:22138-${seasonId(THE_OFFICE, 2)}`)
  expect(imdbOf(media)).toEqual(['PART_OF imdb:tt0386676'])
})

test('and a season JustWatch lists shorter, in a year two seasons share', async () => {
  const media = await answer('ag:(tmdb:71446-s1)', cluster('Money Heist', '2017-05-02', 15), [MONEY_HEIST])
  expect(media?.uri).toBe(`jw:56768-${seasonId(MONEY_HEIST, 1)}`)
})

test('the number stops at the picker\'s rules: a season longer than the run, or dated another year, stays unplaced', async () => {
  expect(await answer('ag:(tmdb:2316-s3)', cluster('The Office', '2006-09-21', 20), [THE_OFFICE])).toBeNull()
  expect(await answer('ag:(tmdb:71446-s3)', cluster('Money Heist', '2022-04-05', 8), [MONEY_HEIST])).toBeNull()
})

test('with no id to settle the show, the number is not read', async () => {
  const { tmdbId: _, ...unnamed } = THE_OFFICE
  expect(await answer('ag:(tmdb:2316-s2)', cluster('The Office', '2005-09-20', 22), [unnamed])).toBeNull()
})

test('with no id to go on, the title and the date decide as before', async () => {
  const media = await answer('ag:(appletv:skins-s1)', cluster('Skins', '2011-01-27', 8), [SKINS_2007])
  expect(media?.uri).toBe(`jw:22034-${seasonId(SKINS_2007, 5)}`)
})

test('a film\'s TMDB id is another id space, so one sharing the show\'s number proves nothing', async () => {
  const film: Hit = { objectId: 7, title: 'Skins', tmdbId: '34390', imdbId: 'tt0000007', seasons: [], film: 2011 }
  const media = await answer('ag:(tmdb:34390-s1)', cluster('Skins', '2011-01-17', 10), [film, SKINS_2011])
  expect(media?.uri).toBe(`jw:33406-${seasonId(SKINS_2011, 1)}`)
})

test('a search answers no TMDB link, which stays the title page\'s', async () => {
  const context = { fetch: jw([{ objectId: 7, title: 'Dune', tmdbId: '693134', imdbId: 'tt15239678', seasons: [], film: 2024 }]) }
  const { value } = await (resolvers as any).Subscription.mediaPage.subscribe(undefined, { input: { search: 'Dune' } }, context).next()
  const [film] = value.mediaPage.nodes as { handles: { node: { uri: string } }[] }[]
  expect(film?.handles.filter(handle => handle.node.uri.startsWith('tmdb:'))).toEqual([])
})
