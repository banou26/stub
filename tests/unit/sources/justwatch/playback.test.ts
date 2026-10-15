// The Boys (Prime Video), Andor (Disney+) and Saltburn (Prime Video and Max, and rent or buy in Japan)
// as JustWatch answered stub's own NODE_QUERY on 2026-10-12, asked of apis.justwatch.com directly
// (US, with JP as the second country), each offer kept as it came. A viewer in Japan asks the other way
// round, so they are answered with the two swapped.
//
// Each season's first episode carries that season's gti rather than its own (The Boys S1E1 is season
// 1's 9ab600aa in the US and 82823414 in Japan, which is also the show's own offer). It is kept as
// JustWatch gives it.
import { expect, test } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { resolvers, showAsContainer } from '../../../../src/sources/justwatch/extractor'
import THE_BOYS from '../../../fixtures/justwatch/the-boys.json'
import ANDOR from '../../../fixtures/justwatch/andor.json'
import SALTBURN from '../../../fixtures/justwatch/saltburn.json'
import { viewerIn } from './viewer'

const swapped = (value: unknown): unknown =>
  Array.isArray(value) ? value.map(swapped)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key === 'offers' ? 'extraOffers' : key === 'extraOffers' ? 'offers' : key, swapped(inner)]))
    : value

const asked = (answer: unknown) => async (url: string, init: { body: string }) => {
  if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
  const { offerCountry, extraCountry } = JSON.parse(init.body).variables
  if (`${offerCountry},${extraCountry}` !== 'US,JP' && `${offerCountry},${extraCountry}` !== 'JP,US') throw new Error(`no answer recorded for ${offerCountry}`)
  return { json: async () => offerCountry === 'JP' ? swapped(answer) : answer }
}

const open = async (answer: unknown, uri: string): Promise<GQLMedia> => {
  const context = { fetch: asked(answer) }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context).next()
  return value.media
}

const played = (media: GQLMedia) => media.episodes
  .filter(episode => episode.origin !== 'jw')
  .map(episode => `${episode.mediaUri} ${episode.uri} ${episode.seasonNumber ?? '-'}x${episode.episodeNumber} ${episode.url}`)

const titleLinks = (media: GQLMedia) => media.handles
  .filter(({ node }) => ['amazon', 'disney', 'hbo'].includes(node.origin))
  .map(({ relation, node }) => `${node.uri} ${relation} ${node.url}`)

test('each episode of a season plays on Prime Video or Disney+ through its own deep link', async () => {
  viewerIn('America/New_York')
  const boys = await open(THE_BOYS, 'jw:78125-104253')
  expect(played(boys)).toHaveLength(8)
  expect(played(boys).slice(0, 3)).toEqual([
    'jw:78125-104253 amazon:amzn1.dv.gti.9ab600aa-6625-b547-cfc0-190e3ad8a27d 1x1 https://watch.amazon.com/watch?gti=amzn1.dv.gti.9ab600aa-6625-b547-cfc0-190e3ad8a27d',
    'jw:78125-104253 amazon:amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9 1x2 https://watch.amazon.com/watch?gti=amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9',
    'jw:78125-104253 amazon:amzn1.dv.gti.8eb600aa-6477-4687-a921-2a12646cb790 1x3 https://watch.amazon.com/watch?gti=amzn1.dv.gti.8eb600aa-6477-4687-a921-2a12646cb790',
  ])
  expect(boys.episodeCount, 'the season is still eight episodes long').toBe(8)

  const andor = await open(ANDOR, 'jw:85391-210776')
  expect(played(andor)).toHaveLength(12)
  expect(played(andor).slice(0, 2)).toEqual([
    'jw:85391-210776 disney:91310366-d44b-44a4-bdc4-71f999472826 1x1 https://www.disneyplus.com/play/91310366-d44b-44a4-bdc4-71f999472826',
    'jw:85391-210776 disney:ef6356d6-19c9-49c0-a633-fe5a4153316a 1x2 https://www.disneyplus.com/play/ef6356d6-19c9-49c0-a633-fe5a4153316a',
  ])
})

test('a season that arrived with no episodes plays them too', async () => {
  viewerIn('America/New_York')
  const season = { origin: 'jw', id: '78125-104253', uri: 'jw:78125-104253', categories: ['SERIES'], titles: [], episodes: [] }
  const episodes = await (resolvers.Media as any).episodes(season, {}, { fetch: asked(THE_BOYS) })
  expect(played({ episodes } as GQLMedia)).toHaveLength(8)
  expect(played({ episodes } as GQLMedia)[1]).toBe(
    'jw:78125-104253 amazon:amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9 1x2 https://watch.amazon.com/watch?gti=amzn1.dv.gti.5ab600aa-5887-e35c-6326-4420b567cfb9'
  )
})

// Max plays the film under another id than its title page's, so the title link keeps the page's
test('a film plays on each service through its deep link, and its title links stay on the title', async () => {
  viewerIn('America/New_York')
  const saltburn = await open(SALTBURN, 'jw:1349029')
  expect(played(saltburn)).toEqual([
    'jw:1349029 amazon:amzn1.dv.gti.d6674b8e-5b88-45be-9361-63dd98818413 -x1 https://watch.amazon.com/watch?gti=amzn1.dv.gti.d6674b8e-5b88-45be-9361-63dd98818413',
    'jw:1349029 hbo:7c9a9a6d-2383-483a-b59a-603b1eab3d20 -x1 https://play.hbomax.com/video/watch/7c9a9a6d-2383-483a-b59a-603b1eab3d20?utm_source=universal_search',
  ])
  expect(titleLinks(saltburn)).toEqual([
    'amazon:amzn1.dv.gti.d6674b8e-5b88-45be-9361-63dd98818413 SAME_AS https://watch.amazon.com/detail?gti=amzn1.dv.gti.d6674b8e-5b88-45be-9361-63dd98818413',
    'hbo:3b1e7e8e-d19f-4be3-bda0-859aa65b4a4e SAME_AS https://play.hbomax.com/show/3b1e7e8e-d19f-4be3-bda0-859aa65b4a4e?utm_source=universal_search',
  ])
  expect(saltburn.episodeCount).toBe(1)
})

test('the viewer\'s own country plays where it has the service, and the US where it has not', async () => {
  viewerIn('Asia/Tokyo')
  const boys = await open(THE_BOYS, 'jw:78125-104253')
  expect(played(boys)[1]).toBe(
    'jw:78125-104253 amazon:amzn1.dv.gti.af8a98f3-4e50-41ee-a721-1c1a939b2283 1x2 https://watch.amazon.co.jp/watch?gti=amzn1.dv.gti.af8a98f3-4e50-41ee-a721-1c1a939b2283'
  )
  expect(titleLinks(boys)).toEqual([
    'amazon:amzn1.dv.gti.82823414-0631-45c4-9659-24959d77b78f PART_OF https://watch.amazon.co.jp/detail?gti=amzn1.dv.gti.82823414-0631-45c4-9659-24959d77b78f',
  ])
  const show = await showAsContainer((swapped(THE_BOYS) as any).data.node, { fetch: asked(THE_BOYS) } as never)
  expect(titleLinks(show!)).toEqual([
    'amazon:amzn1.dv.gti.82823414-0631-45c4-9659-24959d77b78f SAME_AS https://watch.amazon.co.jp/detail?gti=amzn1.dv.gti.82823414-0631-45c4-9659-24959d77b78f',
  ])

  // Japan has no Max
  const saltburn = await open(SALTBURN, 'jw:1349029')
  expect(played(saltburn).filter(line => line.includes(' hbo:'))).toEqual([
    'jw:1349029 hbo:7c9a9a6d-2383-483a-b59a-603b1eab3d20 -x1 https://play.hbomax.com/video/watch/7c9a9a6d-2383-483a-b59a-603b1eab3d20?utm_source=universal_search',
  ])
})

// Japan sells Saltburn on Amazon to buy only (`amz`, gti ed457f7e), and Apple rents it in the US (`itu`).
// The US streams it on Prime Video, which a Japanese account does not play.
test('rent and buy offers stay unmapped, and another country\'s Prime Video is not the viewer\'s', async () => {
  viewerIn('Asia/Tokyo')
  const saltburn = await open(SALTBURN, 'jw:1349029')
  const urls = [...saltburn.handles.map(({ node }) => node.url), ...saltburn.episodes.map(episode => episode.url)]
  expect(urls.filter(url => url?.includes('ed457f7e') || url?.startsWith('https://tv.apple.com/'))).toEqual([])
  expect(urls.filter(url => url?.includes('d6674b8e'))).toEqual([])
  expect(played(saltburn).map(line => line.split(' ')[1]!.split(':')[0])).toEqual(['hbo'])
})
