// JustWatch's answers to stub's own listing and modal bodies on 2026-10-12, each search cut to its
// first results and each show to its first season.
import { expect, test } from 'vite-plus/test'

import { resolvers, showAsContainer } from '../../../../src/sources/justwatch/extractor'
import YOUR_NAME_SEARCH from '../../../fixtures/justwatch/your-name-search.json'
import DRIVE_MY_CAR_SEARCH from '../../../fixtures/justwatch/drive-my-car-search.json'
import IMMORTAL_KING from '../../../fixtures/justwatch/immortal-king.json'
import LOOKISM from '../../../fixtures/justwatch/lookism.json'
import ARCANE from '../../../fixtures/justwatch/arcane.json'
import LIVE_ACTION from '../../../fixtures/justwatch/live-action-search.json'

const context = (answer: unknown) => ({
  findAggregatedMedia: async () => null,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string) => {
    if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
    return { json: async () => answer }
  },
})

const listing = async (answer: unknown = YOUR_NAME_SEARCH) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'a title' } }, context(answer)).next()
  return value.mediaPage.nodes
}

const season = async (answer: { data: { node: { objectId: number, seasons: { objectId: number }[] } } }) => {
  const { objectId, seasons } = answer.data.node
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `jw:${objectId}-${seasons[0]!.objectId}` } }, context(answer)).next()
  return value.media
}

test('a Japanese animated film is anime and a film', async () => {
  const [yourName, callMeByYourName] = await listing()
  expect(yourName.titles[0].title).toBe('Your Name.')
  expect(yourName.categories).toEqual(['ANIME', 'MOVIE'])
  expect(callMeByYourName.categories).toEqual(['MOVIE'])
})

test('a Japanese film that is not animated is a film only', async () => {
  const [driveMyCar] = await listing(DRIVE_MY_CAR_SEARCH)
  expect(driveMyCar.titles[0].title).toBe('Drive My Car')
  expect(driveMyCar.categories).toEqual(['MOVIE'])
})

test('Chinese and Korean animation is anime', async () => {
  const immortalKing = await season(IMMORTAL_KING)
  const lookism = await season(LOOKISM)
  expect(immortalKing.titles[0].title).toBe('The Daily Life of the Immortal King')
  expect(immortalKing.categories).toEqual(['ANIME', 'SERIES'])
  expect(lookism.titles[0].title).toBe('Lookism')
  expect(lookism.categories).toEqual(['ANIME', 'SERIES'])
})

test('the show a season is part of, and a show with no matching season, are anime too', async () => {
  const show = (await season(IMMORTAL_KING)).handles.find((handle: any) => handle.relation === 'PART_OF' && handle.node.origin === 'jw')
  expect(show.node.categories).toEqual(['ANIME', 'SERIES'])

  const netflix = { monetizationType: 'FLATRATE', standardWebURL: 'https://www.netflix.com/title/80123456', package: { clearName: 'Netflix', shortName: 'nfx' } }
  const container = await showAsContainer({ ...IMMORTAL_KING.data.node, offers: [netflix], extraOffers: [] } as never, context(undefined) as never)
  expect(container?.categories).toEqual(['ANIME', 'SERIES'])
})

test('animation made in France and the US is a series only', async () => {
  const media = await season(ARCANE)
  expect(media.titles[0].title).toBe('Arcane: League of Legends')
  expect(media.categories).toEqual(['SERIES'])
})

// Avatar: The Last Airbender's countries on JustWatch US, 2026-10-12: animated in Korea for a US show
test('animation made partly in Korea for a US show is a series only', async () => {
  const avatar = structuredClone(ARCANE)
  avatar.data.node.content.productionCountries = ['KR', 'MY', 'SG', 'US']
  expect((await season(avatar)).categories).toEqual(['SERIES'])
})

test('a title takes JustWatch\'s genre names, without its Made in Europe region', async () => {
  const [yourName, callMeByYourName] = await listing()
  expect(callMeByYourName.genres).toEqual(['Drama', 'Romance'])
  expect(yourName.genres).toEqual(['Animation', 'Drama', 'Fantasy', 'Romance'])
  expect((await season(ARCANE)).genres).toEqual(['Action & Adventure', 'Animation', 'Drama', 'Fantasy', 'Science-Fiction'])
})

// each adaptation's live-action node from its search, with its Netflix offer only
test.each(LIVE_ACTION.data.popularTitles.edges)('the live-action $node.content.title ($node.content.originalReleaseYear) is not anime', async ({ node }) => {
  const media = node.objectType === 'MOVIE'
    ? (await listing({ data: { popularTitles: { edges: [{ node }] } } }))[0]
    : await showAsContainer(node as never, context(undefined) as never)
  expect(media.titles[0].title).toBe(node.content.title)
  expect(media.categories).toEqual([node.objectType === 'MOVIE' ? 'MOVIE' : 'SERIES'])
})
