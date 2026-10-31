// Dune: Part Two and Chernobyl as JustWatch answered stub's own NODE_DETAILS_QUERY on 2026-10-12, the
// form only the title page asks. The modal's and the listing's bodies are pinned beside them, since
// the relay caches on the whole body.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { parseCredits, resolvers } from '../../../../src/sources/justwatch/extractor'
import { NATIVE_ID_SPACES } from '../../../../src/worker/graph/plugins/origins'
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'
import DUNE from '../../../fixtures/justwatch/dune-part-two.json'
import CHERNOBYL from '../../../fixtures/justwatch/chernobyl.json'
import DUNE_CREDITS from '../../../fixtures/credits/jw-dune.json'
import { viewerIn } from './viewer'

const open = async (answer: unknown, uri: string, details?: boolean) => {
  const bodies: string[] = []
  const context = {
    // read only on an aggregated uri, to tell a film's `tm` node from a show's `ts`
    findAggregatedMedia: async () => ({ categories: ['MOVIE'] }),
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      bodies.push(init.body)
      return { json: async () => answer }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri, ...details === undefined ? {} : { details } } }, context).next()
  return { media: value.media, bodies }
}

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex')

test('a film\'s scores, backdrops and runtime come from the title page\'s answer', async () => {
  const { media, bodies } = await open(DUNE, 'ag:(jw:1133934)', true)
  expect(JSON.parse(bodies[0]!).variables.nodeId).toBe('tm1133934')
  expect(media.ratings).toEqual([
    { source: 'IMDb', value: 8.4, scale: 10 },
    { source: 'TMDB', value: 8.1, scale: 10 },
    { source: 'Rotten Tomatoes', value: 92, scale: 100 },
    { source: 'JustWatch', value: 95, scale: 100 },
  ])
  expect(media.duration).toBe(167)
  expect(media.banners.map(({ url }: { url: string }) => url)).toEqual([
    'https://images.justwatch.com/backdrop/310569186/s1920/dune-part-two-2023.jpg',
    'https://images.justwatch.com/backdrop/312420524/s1920/dune-part-two-2023.jpg',
    'https://images.justwatch.com/backdrop/312420522/s1920/dune-part-two-2023.jpg',
    'https://images.justwatch.com/backdrop/312156510/s1920/dune-part-two-2023.jpg',
    'https://images.justwatch.com/backdrop/312379440/s1920/dune-part-two-2023.jpg',
  ])
})

test('a show\'s runtime is not the season\'s length, and its ratings still come through', async () => {
  const { media } = await open(CHERNOBYL, 'jw:88632-104891', true)
  expect(media.duration).toBeUndefined()
  expect(media.ratings.map(({ source }: { source: string }) => source)).toEqual(['IMDb', 'TMDB', 'Rotten Tomatoes', 'JustWatch'])
})

// TMDB numbers films and shows in separate sequences, so a film's id is kept apart from a show's
test('a film\'s TMDB id links its /movie/ page and a show\'s its /tv/ page, both PART_OF', async () => {
  const tmdbLinks = (media: { handles: { relation: string, node: { origin: string, uri: string, url: string } }[] }) =>
    media.handles.filter(({ node }) => node.origin === 'tmdb').map(({ relation, node }) => `${relation} ${node.uri} ${node.url}`)
  const dune = await open(DUNE, 'jw:1133934', true)
  expect(JSON.parse(dune.bodies[0]!).query, 'the page asks for it').toMatch(/externalIds \{\s+tmdbId\s+\}/)
  expect(tmdbLinks(dune.media)).toEqual(['PART_OF tmdb:movie-693134 https://www.themoviedb.org/movie/693134'])
  expect(tmdbLinks((await open(CHERNOBYL, 'jw:88632-104891', true)).media)).toEqual(['PART_OF tmdb:87108 https://www.themoviedb.org/tv/87108'])
  expect(NATIVE_ID_SPACES.jw!.has('tmdb'), 'a TMDB id is JustWatch\'s own, not an echo of the address').toBe(true)
})

// the credits of the same answer, trimmed to the first eight actors
test('a film\'s actors stand under their parts with no language, and its director is staff', async () => {
  const { characters, staff } = parseCredits(DUNE_CREDITS)
  expect(characters).toHaveLength(8)
  expect(characters[0]).toEqual({ names: ['Paul Atreides'], voiceActors: [{ language: null, person: { id: 'jw:1696', name: 'Timothée Chalamet' } }] })
  expect(staff).toEqual([{ person: { id: 'jw:3669', name: 'Denis Villeneuve' }, roles: ['Director'] }])

  const answer = { data: { node: { ...DUNE.data.node, content: { ...DUNE.data.node.content, credits: DUNE_CREDITS } } } }
  const { media, bodies } = await open(answer, 'jw:1133934', true)
  expect(bodies[0]).toContain('credits {')
  expect(media.credits).toEqual({ characters, staff })
})

test('only an actor stands under a part: a director JustWatch gives a part is staff alone', () => {
  expect(parseCredits([{ role: 'DIRECTOR', name: 'Denis Villeneuve', characterName: 'Cameo', personId: 3669 }])).toEqual({
    characters: [],
    staff: [{ person: { id: 'jw:3669', name: 'Denis Villeneuve' }, roles: ['Director'] }],
  })
})

// Taken for a viewer in the US once offers were asked in the viewer's country. Every change here sends
// each JustWatch request past the relay's cache once, and each country is its own body.
test('the details form goes out only when asked, and the modal and listing bodies are pinned', async () => {
  viewerIn('America/New_York')
  const modal = await open(DUNE, 'jw:1133934')
  const page = await open(DUNE, 'jw:1133934', true)
  expect(sha256(modal.bodies[0]!), 'the modal body').toBe('dde0b504ca822fc386678a2ea39ac5dcbbdf061ea0029c1081ec429d6a386f5c')
  expect(page.bodies[0], 'the page body').toContain('scoring {')

  const listing: string[] = []
  const context = { fetch: async (_: string, init: { body: string }) => (listing.push(init.body), { json: async () => ({ data: { popularTitles: { edges: [] } } }) }) }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  await subscribe(undefined, { input: { search: 'Dune' } }, context).next()
  expect(sha256(listing[0]!), 'the listing body').toBe('93f123a924a7f67313ac046ed0fa6adab162f074d58f2efb33f4ebf9723e2344')
})

test('a title the page found by search asks the details form too', async () => {
  const bodies: string[] = []
  const context = {
    findAggregatedMedia: async () => ({ titles: [{ title: 'Dune: Part Two' }], startDate: '2024-02-27', categories: ['MOVIE'] }),
    listenForMediaChanges: async function* () {},
    fetch: async (_: string, init: { body: string }) => {
      bodies.push(init.body)
      return { json: async () => init.body.includes('GetSearchTitles') ? { data: { popularTitles: { edges: [{ node: DUNE.data.node }] } } } : DUNE }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'ag:(omdb:tt15239678)', details: true } }, context).next()
  expect(bodies.filter(body => body.includes('GetTitleNode')).every(body => body.includes('scoring {'))).toBe(true)
  expect(value.media.ratings).toHaveLength(4)
})

test('the modal and the page opening one title at once each send their own form', async () => {
  const [modal, page] = await Promise.all([open(DUNE, 'jw:1133934'), open(DUNE, 'jw:1133934', true)])
  expect(modal.bodies).toHaveLength(1)
  expect(page.bodies[0]).toContain('scoring {')
})

// 0.2 is the lowest score any other source but AniList gives a banner (unogs, Apple TV, offline), and on a tie
// `jw:` sorted first, so Netflix's own art lost to a backdrop
test('a backdrop comes after any other source\'s banner', async () => {
  const { media } = await open(DUNE, 'jw:1133934', true)
  const member = (uri: string, raw: Record<string, unknown>) => ({
    uri, origin: uri.slice(0, uri.indexOf(':')), id: uri.slice(uri.indexOf(':') + 1), owned: true, score: 0.2, raw, fieldSeq: {},
  })
  const row = aggregateFields({
    cluster: {
      id: 'cl:jw:1133934', aggUri: 'ag:(jw:1133934,nf:81546151)', scope: 'RUN', runLength: null, runLengthTier: null,
      runLengthWitnesses: 0, runLengthFrom: [], anomalies: [],
    },
    members: [member('jw:1133934', media), member('nf:81546151', { banners: [{ url: 'netflix-banner', score: 0.2 }] })],
    related: [],
    relations: [],
    locationOrigin: '',
  })
  expect((row.banners as { url: string }[])[0]!.url).toBe('netflix-banner')
  expect(row.banners).toHaveLength(6)
})
