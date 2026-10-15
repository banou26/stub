// The Boys (on Prime Video in every country asked) and Frieren (on Prime Video in Japan alone) as
// JustWatch answered stub's own NODE_QUERY on 2026-10-16, once per viewer's country with Japan beside
// it (the US beside Japan), each offer kept as it came, season 1 and its first two episodes only.
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { pickCountry } from '../../../../src/sources/country'
import { resolvers } from '../../../../src/sources/justwatch/extractor'
import ANSWERS from '../../../fixtures/justwatch/prime-countries.json'
import { viewerIn } from './viewer'

const BOYS = 'jw:78125-104253'
const FRIEREN = 'jw:364792-373583'

const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
})
afterEach(() => { vi.unstubAllGlobals() })

/** The media for `uri`, answered with the recording of the countries the request asks, and those variables. */
const open = async (title: keyof typeof ANSWERS, uri: string) => {
  const asked: Record<string, string>[] = []
  const context = {
    fetch: async (url: string, init: { body: string }) => {
      if (url !== 'https://apis.justwatch.com/graphql') throw new Error(`fixture has no route for ${url}`)
      const { query, variables } = JSON.parse(init.body)
      asked.push({ ...variables, query })
      const answer = (ANSWERS[title] as Record<string, unknown>)[`${variables.offerCountry},${variables.extraCountry}`]
      if (!answer) throw new Error(`no ${title} recorded for ${variables.offerCountry} with ${variables.extraCountry}`)
      return { json: async () => answer }
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context).next()
  return { media: value.media as GQLMedia, asked }
}

/** Every Prime Video link the media carries: the title's, then each episode's as `<number> <url>`. */
const prime = (media: GQLMedia) => [
  ...media.handles.filter(({ node }) => node.origin === 'amazon').map(({ node }) => `${node.url}`),
  ...media.episodes.filter(episode => episode.origin === 'amazon').map(episode => `${episode.episodeNumber} ${episode.url}`),
]

const gti = (id: string) => `amzn1.dv.gti.${id}`

test('a viewer in Canada gets The Boys on primevideo.com under Canada\'s ids, and none of Japan\'s', async () => {
  viewerIn('America/Toronto')
  const { media, asked } = await open('the-boys', BOYS)
  expect(asked[0]).toMatchObject({ country: 'US', offerCountry: 'CA', extraCountry: 'JP' })
  expect(prime(media)).toEqual([
    `https://app.primevideo.com/detail?gti=${gti('9ab600aa-6625-b547-cfc0-190e3ad8a27d')}`,
    `1 https://app.primevideo.com/watch?gti=${gti('9ab600aa-6625-b547-cfc0-190e3ad8a27d')}`,
    `2 https://app.primevideo.com/watch?gti=${gti('5ab600aa-5887-e35c-6326-4420b567cfb9')}`,
  ])
  expect(media.episodes.find(episode => episode.origin === 'amazon' && episode.episodeNumber === 2)?.uri)
    .toBe(`amazon:${gti('5ab600aa-5887-e35c-6326-4420b567cfb9')}`)
})

// Canada's own Prime package is `prv` beside `pva`; in the Netherlands it is `prv` alone
test('a viewer in the Netherlands gets The Boys through primevideo.com\'s own package', async () => {
  viewerIn('Europe/Amsterdam')
  const { media } = await open('the-boys', BOYS)
  expect(prime(media)).toEqual([
    `https://app.primevideo.com/detail?gti=${gti('9ab600aa-6625-b547-cfc0-190e3ad8a27d')}`,
    `1 https://app.primevideo.com/watch?gti=${gti('9ab600aa-6625-b547-cfc0-190e3ad8a27d')}`,
    `2 https://app.primevideo.com/watch?gti=${gti('5ab600aa-5887-e35c-6326-4420b567cfb9')}`,
  ])
})

// four Amazon sites carry their own Prime Video; every other country is on primevideo.com
test('each country keeps its own Prime Video site\'s links alone', async () => {
  const cases = [
    ['America/Toronto', 'app.primevideo.com', '5ab600aa-5887-e35c-6326-4420b567cfb9'],
    ['Europe/London', 'watch.amazon.co.uk', '5ab600aa-5887-e35c-6326-4420b567cfb9'],
    ['Europe/Berlin', 'watch.amazon.de', '5ab600aa-5887-e35c-6326-4420b567cfb9'],
    ['America/New_York', 'watch.amazon.com', '5ab600aa-5887-e35c-6326-4420b567cfb9'],
    ['Asia/Tokyo', 'watch.amazon.co.jp', 'af8a98f3-4e50-41ee-a721-1c1a939b2283'],
  ] as const
  for (const [zone, host, second] of cases) {
    viewerIn(zone)
    const links = prime((await open('the-boys', BOYS)).media)
    expect(links, zone).toHaveLength(3)
    expect(links.filter(link => new URL(link.split(' ').at(-1)!).host !== host), `${zone}: only ${host}`).toEqual([])
    expect(links[2], zone).toBe(`2 https://${host}/watch?gti=${gti(second)}`)
  }
})

// Frieren is on Prime Video in Japan alone: Canada's and the US's offers name only the Crunchyroll
// channel, which stub skips, so the Japanese one used to play for them
test('a title on Prime Video in Japan alone gets no Prime Video link outside Japan', async () => {
  for (const zone of ['America/Toronto', 'America/New_York']) {
    viewerIn(zone)
    const { media } = await open('frieren', FRIEREN)
    expect(prime(media), zone).toEqual([])
    expect(media.episodes.filter(episode => episode.origin === 'jw'), `${zone}: the episodes are all there`).toHaveLength(2)
  }
})

test('the country picked in Settings is asked instead of the time zone\'s', async () => {
  viewerIn('America/Toronto')
  pickCountry('GB')
  const { media, asked } = await open('the-boys', BOYS)
  expect(asked[0]).toMatchObject({ country: 'US', offerCountry: 'GB', extraCountry: 'JP' })
  expect(prime(media)[2]).toBe(`2 https://watch.amazon.co.uk/watch?gti=${gti('5ab600aa-5887-e35c-6326-4420b567cfb9')}`)
})

// the relay answers a request from its copy only when the whole body matches, so this is also what
// keeps one viewer's country from reading another's offers
test('every offer, the title\'s and each episode\'s, is read in the viewer\'s country, and the title itself in the US', async () => {
  viewerIn('America/Toronto')
  const { asked } = await open('the-boys', BOYS)
  const bound = (pattern: RegExp) => [...asked[0]!.query!.matchAll(pattern)].map(match => match[1])
  expect(bound(/(?<!extraOffers: )\boffers\(\s*country: \$(\w+)/g)).toEqual(['offerCountry', 'offerCountry'])
  expect(bound(/extraOffers: offers\(\s*country: \$(\w+)/g)).toEqual(['extraCountry', 'extraCountry'])
  expect(new Set(bound(/content\(country: \$(\w+)/g))).toEqual(new Set(['country']))
})

test('a viewer in Japan is asked Japan with the US beside it', async () => {
  viewerIn('Asia/Tokyo')
  const { asked } = await open('the-boys', BOYS)
  expect(asked[0]).toMatchObject({ country: 'US', offerCountry: 'JP', extraCountry: 'US' })
})

// JustWatch keeps no catalogue for the US territories or Vietnam, and answers them no offers and no error
test('a viewer in a country JustWatch does not cover is asked the US, and keeps Prime Video on their own site alone', async () => {
  viewerIn('America/Puerto_Rico')
  const inPuertoRico = await open('the-boys', BOYS)
  expect(inPuertoRico.asked[0]).toMatchObject({ country: 'US', offerCountry: 'US', extraCountry: 'JP' })
  expect(prime(inPuertoRico.media)[2]).toBe(`2 https://watch.amazon.com/watch?gti=${gti('5ab600aa-5887-e35c-6326-4420b567cfb9')}`)

  viewerIn('Asia/Ho_Chi_Minh')
  const inVietnam = await open('the-boys', BOYS)
  expect(inVietnam.asked[0]).toMatchObject({ country: 'US', offerCountry: 'US', extraCountry: 'JP' })
  expect(prime(inVietnam.media), 'primevideo.com is Vietnam\'s, and neither country asked is on it').toEqual([])
  const frieren = await open('frieren', FRIEREN)
  expect(frieren.media.handles.map(({ node }) => node.origin), 'the US\'s other services stay').toContain('nf')
})
