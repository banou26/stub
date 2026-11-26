// A PART_OF node is a CONTAINER, and a container's own handles are claims about the container, not
// about the run that pointed at it. Carrying them into the store gives every run that points at one
// show a SAME_AS pair rooted at that same uri, and the union-find has no inverse, so the shows' own
// identities weld the runs together through the back door.
//
// The relation exists precisely so that pointing at a show cannot weld anything. Walking through it
// hands back the weld it was created to prevent.
import { expect, test } from 'vitest'

import { recursivelyUnwrapMediaHandles } from '../../../../src/worker/store/aggregate'

const node = (uri: string, handles: { node: any, relation: 'SAME_AS' | 'PART_OF' }[] = [], url?: string) => ({
  uri,
  origin: uri.slice(0, uri.indexOf(':')),
  id: uri.slice(uri.indexOf(':') + 1),
  handles,
  ...url ? { url } : {},
}) as any

const sameAs = (n: any) => ({ node: n, relation: 'SAME_AS' as const })
const partOf = (n: any) => ({ node: n, relation: 'PART_OF' as const })

const urisOf = (medias: any[]) => medias.map(m => m.uri).sort()

const CR_SERIES_URL = 'https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei'

test('a PART_OF node arrives as a row, carrying its url', () => {
  const unwrapped = recursivelyUnwrapMediaHandles(
    node('anilist:108465', [partOf(node('cr:G24H1N3MP', [], CR_SERIES_URL))])
  )

  expect(urisOf(unwrapped)).toEqual(['anilist:108465', 'cr:G24H1N3MP'])
  expect(unwrapped.find(m => m.uri === 'cr:G24H1N3MP')?.url, 'the url is the whole point of keeping it').toBe(CR_SERIES_URL)
})

test('a PART_OF node arrives with NO handles, so nothing links through it', () => {
  const unwrapped = recursivelyUnwrapMediaHandles(
    node('anilist:108465', [partOf(node('cr:G24H1N3MP', [sameAs(node('kitsu:42323'))], CR_SERIES_URL))])
  )

  expect(urisOf(unwrapped), 'the container\'s own claim must not become a row either').toEqual(['anilist:108465', 'cr:G24H1N3MP'])
  expect(unwrapped.find(m => m.uri === 'cr:G24H1N3MP')?.handles).toEqual([])
})

// The weld this prevents, in the shape a source actually produces it. Both runs point at ONE show, so
// both of the show's SAME_AS pairs are rooted at the same uri and the two kitsu ids land in one
// cluster. The pair loop in worker/extractor.ts reads `media.handles` off exactly these rows, so
// emptying them here is what stops the pair being made at all.
test('two runs pointing at one show contribute no pair through it', () => {
  const container = (claim: string) => node('cr:G24H1N3MP', [sameAs(node(claim))], CR_SERIES_URL)

  const pairsFrom = (media: any) =>
    recursivelyUnwrapMediaHandles(media)
      .flatMap(m => (m.handles ?? []).map((h: any) => [m.uri, h.node.uri, h.relation]))

  const seasonOne = pairsFrom(node('anilist:108465', [partOf(container('kitsu:42323'))]))
  const seasonThree = pairsFrom(node('anilist:178789', [partOf(container('kitsu:49002'))]))

  const rootedAtTheShow = [...seasonOne, ...seasonThree].filter(([from]) => from === 'cr:G24H1N3MP')
  expect(rootedAtTheShow, 'a pair rooted at the show welds every run that points at it').toEqual([])
})

// THE CONTROL, and without it the change above is indistinguishable from "stop walking handles".
// A SAME_AS handle is a claim about THIS media, so its own handles are still this media's business and
// the walk must go all the way down.
test('a SAME_AS handle is still walked to the bottom', () => {
  const unwrapped = recursivelyUnwrapMediaHandles(
    node('anilist:108465', [sameAs(node('kitsu:42323', [sameAs(node('mal:39535', [sameAs(node('anidb:14758'))]))]))])
  )

  expect(urisOf(unwrapped)).toEqual(['anidb:14758', 'anilist:108465', 'kitsu:42323', 'mal:39535'])
})

// Mixed, because a real media carries both and the cut has to land on exactly one of them.
test('a media carrying both keeps the SAME_AS subtree and cuts the PART_OF one', () => {
  const unwrapped = recursivelyUnwrapMediaHandles(
    node('anilist:108465', [
      sameAs(node('kitsu:42323', [sameAs(node('mal:39535'))])),
      partOf(node('cr:G24H1N3MP', [sameAs(node('tvmaze:52279'))], CR_SERIES_URL)),
    ])
  )

  expect(urisOf(unwrapped)).toEqual(['anilist:108465', 'cr:G24H1N3MP', 'kitsu:42323', 'mal:39535'])
})

// A handle that names no node is what a `stub-source@1` plugin sends: `handles: [Media!]!` was the
// schema those plugins were written against, so a bare row arrives where an edge is read. The unwrap
// dereferenced it and the shared insert batch rejected for every extractor in it, first-party sources
// included (2026-09-05, a catalog plugin on the deployed site). The boundary now converts the shape;
// this is the backstop for anything that still gets through.
test('a handle naming no node is skipped, and never fails the whole row', () => {
  const unwrapped = recursivelyUnwrapMediaHandles(
    node('extsrc:14758', [{ relation: 'SAME_AS' } as any, { uri: 'mal:39535', origin: 'mal', id: '39535' } as any, sameAs(node('anilist:108465'))])
  )
  expect(urisOf(unwrapped)).toEqual(['anilist:108465', 'extsrc:14758'])
})
