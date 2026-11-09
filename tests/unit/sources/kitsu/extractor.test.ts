// Kitsu publishes a streaming link on every one of a show's season records, and it is always the
// SHOW's url. Measured 2026-08-31 off /anime/<id>/streaming-links: the identical
// `https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation` sits on
// kitsu:45950 (season 2), kitsu:47694 (season 2 part 2) and kitsu:49002 (season 3).
//
// Minting `cr:G24H1N3MP` off that welds all three permanently. Dropping it loses a real offer. This
// file pins the third path: the show goes out as PART_OF, a container edge the store never unions on,
// and the WORKER asks the owning origin for the precise run on the run's own page, with the whole
// cluster's evidence (worker/similar-consumer.ts). Nothing here asks, and nothing here claims.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/kitsu/extractor'

const API = 'https://kitsu.io/api/edge'

// the real links, verbatim, because the whole defect is what these urls' paths say
const CR_SHOW_URL = 'https://www.crunchyroll.com/series/G24H1N3MP/mushoku-tensei-jobless-reincarnation'
const NF_TITLE_URL = 'https://www.netflix.com/title/81006261'

const context = (
  { subtype, startDate, streams = [CR_SHOW_URL], counts = {} }:
  { subtype: string, startDate: string | null, streams?: string[], counts?: { userCount?: number, popularityRank?: number } }
) => ({
  fetch: async (url: string) => {
    const body =
      url.startsWith(`${API}/anime/49002/streaming-links`)
        ? { data: streams.map((stream, i) => ({ id: String(i), attributes: { url: stream } })) }
      : url.startsWith(`${API}/anime/49002/episodes`) ? { data: [] }
      : url.startsWith(`${API}/anime/49002`) ? {
        data: {
          id: '49002',
          attributes: {
            subtype,
            startDate,
            canonicalTitle: 'Mushoku Tensei: Jobless Reincarnation Season 3',
            titles: { en: 'Mushoku Tensei: Jobless Reincarnation Season 3' },
            episodeCount: 14,
            ...counts,
          },
          relationships: { mappings: { data: [] } },
        },
        included: [],
      }
      : undefined
    if (!body) throw new Error(`fixture has no route for ${url}`)
    return { json: async () => body }
  },
}) as never

type Edge = { relation: string, node: { uri: string, origin: string, id: string, scope?: string } }

const edgesFor = async (ctx: never) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'kitsu:49002' } }, ctx).next()
  return (value?.media?.handles ?? []) as Edge[]
}

/** the nodes, for assertions about WHICH ids get minted */
const handlesFor = async (ctx: never) => (await edgesFor(ctx)).map(handle => handle.node)

/** what this media claims to BE. The only relation that welds, so the only one these tests police. */
const sameAsFor = async (ctx: never) =>
  (await edgesFor(ctx)).filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node)

const expectContainerOnly = (edges: Edge[], origin: string, id: string) => {
  const edge = edges.find(handle => handle.node.origin === origin)
  expect(edge?.relation, 'the run IS part of that show, which is worth keeping').toBe('PART_OF')
  expect(edge?.node.id, 'the show id as published, never a season minted from it').toBe(id)
  // the show id is stamped into the CONTAINER space by `partOf`, so even a later source claiming
  // sameness with it is read as PART_OF by the store rather than welding this run to it
  expect(edge?.node.scope, 'a show id is every season at once').toBe('CONTAINER')
  expect(edges.filter(handle => handle.relation === 'SAME_AS'), 'the show id must never be claimed as this run').toEqual([])
}

test('a series link is carried as PART_OF its show; the worker asks the owning origin on the run\'s page', async () => {
  const edges = await edgesFor(context({ subtype: 'TV', startDate: '2026-07-04' }))

  expectContainerOnly(edges, 'cr', 'G24H1N3MP')
  expect(edges.map(handle => handle.node.uri)).not.toContain('cr:G24H1N3MP-GS00374452')
})

// The date used to decide whether this source asked the owning origin itself. The ask has moved to
// the worker, which asks with the cluster's best date rather than this record's, so the record's date
// changes nothing about what goes out: a container, with or without one.
test('with or without a start date the pointer is a container', async () => {
  for (const startDate of ['2026-07-04', null]) {
    expectContainerOnly(await edgesFor(context({ subtype: 'TV', startDate })), 'cr', 'G24H1N3MP')
  }
})

// A film that belongs to a running series gets the SERIES' url from Crunchyroll: all four Demon Slayer
// films link to /series/GY5P48XEY, and all fifteen Dragon Ball Z films to /series/GQWH0M1GG. So the
// subtype carve-out that used to sit here minted one id for fifteen films and welded them, the same
// defect the three Mushoku Tensei seasons had. A film has no season for the other source to place it
// into either, so the link is carried as containment and never asked about.
test('a film whose link names the show claims nothing', async () => {
  const edges = await edgesFor(context({ subtype: 'movie', startDate: '2020-10-16' }))

  // the weld this whole mechanism exists to avoid: fifteen Dragon Ball Z films share one /series/ id
  expect(edges.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri))
    .not.toContain('cr:G24H1N3MP')
  // and the film really IS part of that series, so the link is kept rather than thrown away
  expect(edges.find(handle => handle.node.origin === 'cr')?.relation).toBe('PART_OF')
})

// Netflix gives every title its own /title/<id>, film and show alike, so a film's Netflix link does
// name the film. This is why the refusal above is a filter on the url and not a blanket one on the
// subtype: a blanket refusal would cost every one of these for nothing.
test('a film whose link names the film itself is still minted directly', async () => {
  const ctx = () => context({ subtype: 'movie', startDate: '2020-10-16', streams: [CR_SHOW_URL, NF_TITLE_URL] })

  // the netflix one is an identity, the crunchyroll one is only a link, out of the same record
  expect((await handlesFor(ctx())).map(handle => handle.uri)).toContain('nf:81006261')
  expect((await sameAsFor(ctx())).map(handle => handle.uri)).toEqual(['nf:81006261'])
})

// The film gate, from the side every other test in this file is blind to. The non-film cases above
// all carry a crunchyroll /series/ link, which the ALLOWLIST refuses on shape as well, so they pass
// whether or not the gate exists. A netflix link is the case that separates them: `nf:title` is on
// the allowlist, so only the gate stops it being minted here.
//
// It has to stop it. A netflix /title/ id on a cour record is the WHOLE show's: measured 2026-09-04
// over 3000 kitsu records, nf:80135674 is published on all five seasons of Boku no Hero Academia, and
// 36 more ids are shared the same way. It goes out as the title, a container, and Netflix's own
// source is asked for the season by the worker.
test('a cour record carries its netflix title as a container rather than minting it', async () => {
  const edges = await edgesFor(context({ subtype: 'TV', startDate: '2026-07-04', streams: [NF_TITLE_URL] }))

  expectContainerOnly(edges, 'nf', '81006261')
  expect(edges.map(handle => handle.node.uri)).toEqual(['nf:81006261'])
})

// kitsu:49002 answered 3,843 users and rank 3,292 on 2026-11-09
test('a title carries its users and its all-time rank, and no share of a season', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const ctx = context({ subtype: 'TV', startDate: '2026-07-06', counts: { userCount: 3843, popularityRank: 3292 } })
  const { value } = await subscribe(undefined, { input: { uri: 'kitsu:49002' } }, ctx).next()

  expect([value.media.followers, value.media.popularityRank, value.media.popularity]).toEqual([3843, 3292, undefined])
})
