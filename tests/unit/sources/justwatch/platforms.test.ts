// Three films as JustWatch answered stub's own NODE_QUERY on 2026-10-12 (US, with JP as the second
// region), each offer kept as it came. Between them they name every platform JustWatch lists that stub
// maps to a link-only origin, plus the resale channels that must stay unmapped.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/justwatch/extractor'
import THE_ONE_I_LOVE from '../../../fixtures/justwatch/the-one-i-love.json'
import ALL_IS_LOST from '../../../fixtures/justwatch/all-is-lost.json'
import NINJA_SCROLL from '../../../fixtures/justwatch/ninja-scroll.json'

type Offer = { monetizationType: string, standardWebURL: string | null, package: { shortName: string } }
type Answer = { data: { node: { objectId: number, offers: Offer[], extraOffers: Offer[] } } }

const handlesOf = async (answer: Answer) => {
  const context = {
    fetch: async (url: string) => {
      if (url === 'https://apis.justwatch.com/graphql') return { json: async () => answer }
      throw new Error(`fixture has no route for ${url}`)
    },
  }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `jw:${answer.data.node.objectId}` } }, context).next()
  return ((value?.media?.handles ?? []) as { relation: string, node: { origin: string, id: string, url: string } }[])
    .filter(handle => handle.node.origin !== 'jw')
    .map(({ relation, node }) => `${node.origin}:${node.id} ${relation} ${node.url}`)
    .sort()
}

const withOffers = (answer: Answer, keep: (offer: Offer) => boolean): Answer => ({
  data: { node: { ...answer.data.node, offers: answer.data.node.offers.filter(keep), extraOffers: answer.data.node.extraOffers.filter(keep) } },
})

test('each platform offer becomes its own origin, under the id its deep link carries', async () => {
  expect(await handlesOf(THE_ONE_I_LOVE)).toEqual([
    'amazon:amzn1.dv.gti.6c1f193c-a76b-4a32-b462-9d86abd6f8e6 SAME_AS https://watch.amazon.com/detail?gti=amzn1.dv.gti.6c1f193c-a76b-4a32-b462-9d86abd6f8e6',
    'amcplus:1073975 SAME_AS https://www.amcplus.com/movies/the-one-i-love--1073975',
    'hoopla:14973116 SAME_AS https://www.hoopladigital.com/title/14973116?utm_source=justwatch',
    'philo:U2hvdzo2MDg1NDg4OTk2NDg1MTAxMjk SAME_AS https://www.philo.com/player/show/U2hvdzo2MDg1NDg4OTk2NDg1MTAxMjk',
    'plex:5d9f3963b0262f001f6ef055 SAME_AS https://watch.plex.tv/movie/the-one-i-love-2014?autoplay=1&utm_content=5d9f3963b0262f001f6ef055&utm_medium=deeplink&utm_source=justWatch-v2-catalog',
    'roku:49b3bfb619ab57f7bd19a194f3a0d7e9 SAME_AS https://therokuchannel.roku.com/details/49b3bfb619ab57f7bd19a194f3a0d7e9/the-one-i-love?source=bing',
    'tubi:465330 SAME_AS https://tubitv.com/movies/465330',
  ])
  expect(await handlesOf(ALL_IS_LOST)).toEqual([
    'hoopla:19645924 SAME_AS https://www.hoopladigital.com/title/19645924?utm_source=justwatch',
    'philo:U2hvdzo2MDg1NDg4OTk2NDg0NDM1MDU SAME_AS https://www.philo.com/player/show/U2hvdzo2MDg1NDg4OTk2NDg0NDM1MDU',
    'plex:5d7769c47a53e9001e6efe36 SAME_AS https://watch.plex.tv/movie/all-is-lost?autoplay=1&utm_content=5d7769c47a53e9001e6efe36&utm_medium=deeplink&utm_source=justWatch-v2-catalog',
    'pluto:5e972482868ca8001a04ad03 SAME_AS https://pluto.tv/us/movies/5e972482868ca8001a04ad03/#open',
    'roku:54d292739ead505886772a48e4af8d59 SAME_AS https://therokuchannel.roku.com/details/54d292739ead505886772a48e4af8d59/all-is-lost?source=bing',
    'starz:51102 SAME_AS https://www.starz.com/us/en/movies/51102',
    'tubi:348089 SAME_AS https://tubitv.com/movies/348089',
  ])
  expect(await handlesOf(NINJA_SCROLL)).toEqual([
    'hidive:715215 SAME_AS https://www.hidive.com/interstitial/715215',
  ])
})

// Prime Video's ad tier is Prime Video, the same deep link under another package name.
test('the prime video ad tier is prime video', async () => {
  expect(await handlesOf(withOffers(THE_ONE_I_LOVE, offer => offer.package.shortName === 'pva'))).toEqual([
    'amazon:amzn1.dv.gti.6c1f193c-a76b-4a32-b462-9d86abd6f8e6 SAME_AS https://watch.amazon.com/detail?gti=amzn1.dv.gti.6c1f193c-a76b-4a32-b462-9d86abd6f8e6',
  ])
})

// A resale channel plays on the reseller's site, so its deep link carries the reseller's id: the AMC+
// and Starz Apple TV channels link tv.apple.com, the AMC+ Roku channel links The Roku Channel's own
// title, and the HIDIVE, AMC+, Starz and other Amazon channels link watch.amazon.com.
test('a resale channel mints nothing, for the platform it resells or for the reseller', async () => {
  const RESALE = ['aat', 'szt', 'ark', 'azp', 'saz', 'hda', 'alg', 'hwy']
  const resale = (offer: Offer) => RESALE.includes(offer.package.shortName)
  for (const answer of [THE_ONE_I_LOVE, ALL_IS_LOST, NINJA_SCROLL]) {
    expect(withOffers(answer, resale).data.node.offers.length, 'the fixture carries a resale offer').toBeGreaterThan(0)
    expect(await handlesOf(withOffers(answer, resale))).toEqual([])
  }
})
