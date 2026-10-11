// Dune: Part Two and Chernobyl as JustWatch answered stub's own NODE_DETAILS_QUERY on 2026-10-12, the
// form only the title page asks. The modal's and the listing's bodies are pinned beside them, since
// the relay caches on the whole body.
import { createHash } from 'node:crypto'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import { aggregateFields } from '../../../../src/worker/graph/plugins/fields'
import DUNE from '../../../fixtures/justwatch/dune-part-two.json'
import CHERNOBYL from '../../../fixtures/justwatch/chernobyl.json'

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

// Taken once genre names and production countries joined both bodies, since a title's anime signal
// has to reach the modal and the listing too. Every change here sends each JustWatch request past the
// relay's cache once.
test('the details form goes out only when asked, and the modal and listing bodies are pinned', async () => {
  const modal = await open(DUNE, 'jw:1133934')
  const page = await open(DUNE, 'jw:1133934', true)
  expect(sha256(modal.bodies[0]!), 'the modal body').toBe('1ec0f18dc883939183ec3813a09765bef8449c0152d1f03c2a6c53afd44692f7')
  expect(page.bodies[0], 'the page body').toContain('scoring {')

  const listing: string[] = []
  const context = { fetch: async (_: string, init: { body: string }) => (listing.push(init.body), { json: async () => ({ data: { popularTitles: { edges: [] } } }) }) }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  await subscribe(undefined, { input: { search: 'Dune' } }, context).next()
  expect(sha256(listing[0]!), 'the listing body').toBe('df1297e746a82480e970a726429b65f153b80e89f220b5489bec7f75cd5cfd54')
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

// 0.2 is the lowest score any other source gives a banner (unogs, Apple TV, offline), and on a tie
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
