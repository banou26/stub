import { describe, expect, test } from 'vite-plus/test'

import { shownStatus } from '../../../../src/party/status'
import { getRoutePath, Route } from '../../../../src/router/path'
import { builtInSources } from '../../../../src/sources/built-in'
import { expandPath, shortenPath } from '../../../../src/utils/share-link'
import { type AggregatedUri, fromAggregatedUri, isAggregatedUri, matchAggregatedUris, watchEpisodeUri } from '../../../../src/utils/uri'

const mediaUri = 'ag:(anilist:178789,kitsu:49002,mal:59193)'
const own = ['anizip:18104-1', 'cr:GX1', 'kitsu:1036601', 'nf:81']
// the shape of the link the owner shared: 29 of an indexer's releases of one episode, a file of a batch among them
const releases = [...Array.from({ length: 28 }, (_, at) => `nyaa:${2070689 + at}`), 'nyaa:2115493-2']
const everyId = `ag:(${[...own, ...releases].join(',')})`
const short = `ag:(${own.join(',')})`
const playing = 'nyaa:2070695'

describe('the episode part of a watch address', () => {
  test('names the episode by stub\'s own sources, not by the 29 releases an added source lists', () => {
    expect(getRoutePath(Route.WATCH, { mediaUri, episodeUri: everyId, sourceUri: playing })).toBe(`/watch/${mediaUri}/${short}/${playing}`)
    expect(getRoutePath(Route.WATCH, { mediaUri, episodeUri: everyId })).toBe(`/watch/${mediaUri}/${short}`)
  })

  test('leaves out any added source\'s rows, a lone one too, whatever it is called', () => {
    expect(watchEpisodeUri('ag:(anizip:1-1,animetosho:9)')).toBe('ag:(anizip:1-1)')
    expect(watchEpisodeUri('ag:(animetosho:7,anizip:1-1,cr:GX1,my-indexer:2,my-indexer:3)')).toBe('ag:(anizip:1-1,cr:GX1)')
  })

  test('keeps exactly one id of an episode only added sources know, and the same one every time', () => {
    const one = watchEpisodeUri('ag:(animetosho:7,nyaa:1,nyaa:2)')
    expect(fromAggregatedUri(one as AggregatedUri)?.handleUris).toHaveLength(1)
    expect(isAggregatedUri(one)).toBe(true)
    expect(watchEpisodeUri(one)).toBe(one)
    expect(matchAggregatedUris(one as AggregatedUri, 'ag:(animetosho:7,nyaa:1,nyaa:2)')).toBe(true)
  })

  test('is what it was for every source stub ships, byte for byte', () => {
    for (const { origin } of builtInSources) {
      const uri = `ag:(${origin}:1-1,${origin}:2-1)`
      expect(getRoutePath(Route.WATCH, { mediaUri, episodeUri: uri, sourceUri: `${origin}:1-1` })).toBe(`/watch/${mediaUri}/${uri}/${origin}:1-1`)
    }
    // out of `fromAggregatedUri`'s order, and spelled as an old link spells a row or a run
    for (const uri of ['ag:(nf:81,cr:GX1,anilist:1-1)', 'anilist:1-1', 'ag:(anilist:1)-5', 'ag:()', 'not a uri']) expect(watchEpisodeUri(uri)).toBe(uri)
  })

  test('finds an episode that holds more ids than it names, and no other', () => {
    expect(matchAggregatedUris(everyId as AggregatedUri, watchEpisodeUri(everyId) as AggregatedUri)).toBe(true)
    expect(matchAggregatedUris('ag:(anizip:18104-2,cr:GX2,kitsu:1036602,nf:82)', watchEpisodeUri(everyId) as AggregatedUri)).toBe(false)
  })

  test('stays the same as the release playing changes, and as an address already short is written again', () => {
    const on = (sourceUri: string, episodeUri = everyId) => getRoutePath(Route.WATCH, { mediaUri, episodeUri, sourceUri }).split('/')[3]
    expect(new Set([on('nyaa:2070689'), on(playing), on('cr:GX1'), on(playing, short)])).toEqual(new Set([short]))
  })

  // a party compares addresses as written: a follower reads as away, or as still on its way, on any other spelling
  test('is the same for a host whose page lists the releases and a guest whose page does not, as the party compares them', () => {
    const host = getRoutePath(Route.WATCH, { mediaUri, episodeUri: everyId, sourceUri: playing })
    const guest = getRoutePath(Route.WATCH, { mediaUri, episodeUri: short, sourceUri: playing })
    expect(shownStatus({ s: 'ready', path: guest }, 0, host).s).toBe('ready')
  })
})

describe('a share link to a watch address', () => {
  const address = (episodeUri: string) => getRoutePath(Route.WATCH, { mediaUri, episodeUri, sourceUri: playing })

  test('opens the short address it packs', () => {
    expect(expandPath(shortenPath(address(everyId))!)).toBe(`/watch/${mediaUri}/${short}/${playing}`)
  })

  test('from an address with every id still opens that address', () => {
    const old = `/watch/${mediaUri}/${everyId}/${playing}`
    expect(expandPath(shortenPath(old)!)).toBe(old)
  })

  test('of an episode only an added source knows round-trips', () => {
    const only = address(`ag:(${releases.join(',')})`)
    expect(only).toBe(`/watch/${mediaUri}/ag:(nyaa:2070689)/${playing}`)
    expect(expandPath(shortenPath(only)!)).toBe(only)
  })

  test('is less than half the code it was', () => {
    const old = `/watch/${mediaUri}/${everyId}/${playing}`
    expect(shortenPath(address(everyId))!.length).toBeLessThan(shortenPath(old)!.length / 2)
  })
})
