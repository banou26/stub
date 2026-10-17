import { expect, test } from 'vite-plus/test'

import { orderKeys, settledOrder, type Orderable } from '../../../src/utils/settled-order'

const media = (id: string, popularity?: number) => ({ _id: id, uri: `anilist:${id}`, popularity })

// the season row's loop in src/router/home/index.tsx: each answer is ordered against what the last one held
const shown = (...answers: Orderable[][]) => {
  let placed: string[][] = []
  let ordered: Orderable[] = []
  for (const answer of answers) {
    ordered = settledOrder(answer, placed)
    placed = orderKeys(ordered)
  }
  return ordered.map(node => node._id)
}

test('a card the user has already seen keeps its place when the resolver reorders it', () => {
  const first = [media('a', 100), media('b', 90), media('c', 80)]
  // the resolver now ranks c above b, which is the 9 second swap that was measured
  const later = [media('a', 100), media('c', 95), media('b', 90)]

  expect(shown(first, later)).toEqual(['a', 'b', 'c'])
})

// The cold anime.fkn.app row measured 2026-10-13: the bundle had no count for the new season, so
// its first draw came in the bundle's rating order, and the counts that landed 2.6 s later lost.
test('a first draw with no popularity is not held, and the answer that brings the counts orders the row', () => {
  const bundle = [media('tetsuryou'), media('edgerunners'), media('rascal')]
  const counted = [media('apothecary', 96_056), media('edgerunners', 77_081), media('rascal', 5_000), media('tetsuryou', 800)]

  expect(shown(bundle, counted)).toEqual(['apothecary', 'edgerunners', 'rascal', 'tetsuryou'])
})

test('cards with a count hold still while those without one move into place as their counts land', () => {
  const first = [media('a', 100), media('b', 90), media('x'), media('y')]
  const later = [media('b', 300), media('y', 200), media('a', 100), media('x')]

  expect(shown(first, later)).toEqual(['a', 'b', 'y', 'x'])
})

test('a show that only appears later is appended, never inserted into what is on screen', () => {
  expect(shown([media('a', 100), media('b', 90)], [media('d', 999), media('a', 100), media('b', 90)]))
    .toEqual(['a', 'b', 'd'])
})

test('with nothing placed yet the resolver order is kept exactly', () => {
  const nodes = [media('x', 1), media('y', 2)]

  expect(settledOrder(nodes, []).map(node => node._id)).toEqual(['x', 'y'])
})

test('a card that disappears from the listing simply goes, and the rest hold their order', () => {
  const placed = orderKeys([media('a', 3), media('b', 2), media('c', 1)])

  expect(settledOrder([media('c', 1), media('a', 3)], placed).map(node => node._id)).toEqual(['a', 'c'])
})

test('placement falls back to the uri when a node carries no cluster id', () => {
  const placed = orderKeys([{ uri: 'mal:1', popularity: 2 }, { uri: 'mal:2', popularity: 1 }])

  expect(settledOrder([{ uri: 'mal:2', popularity: 9 }, { uri: 'mal:1', popularity: 2 }], placed).map(node => node.uri))
    .toEqual(['mal:1', 'mal:2'])
})

// measured 2026-10-17: a home page reload gave Steel Ball Run a new cluster id after its first draw, and it went
// from place 1 to about place 130, behind every card held by its old id
test('a card that gets a new cluster id keeps its place by the ids its address names', () => {
  const sbr = (id: string, popularity: number) => ({ _id: id, uri: 'ag:(anilist:190327,mal:61469)', popularity })
  const first = [sbr('cl:1', 900), media('b', 800), media('c', 700)]
  const later = [media('b', 800), media('c', 700), sbr('cl:9', 900)]

  expect(shown(first, later)).toEqual(['cl:9', 'b', 'c'])
})

test('a card that gains an id keeps its place by the ones it had', () => {
  const first = [{ _id: 'cl:1', uri: 'ag:(mal:61469)', popularity: 900 }, media('b', 800)]
  const later = [media('b', 800), { _id: 'cl:7', uri: 'ag:(anilist:190327,mal:61469)', popularity: 900 }]

  expect(shown(first, later)).toEqual(['cl:7', 'b'])
})

