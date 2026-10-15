// JustWatch has no season-level node, so the offers it publishes belong to the SHOW. `normalizeMedia`
// builds one media per season out of that one node, and every one of them is handed the SAME offer
// list. A show-level offer is therefore the provider's TITLE, carried as PART_OF: two runs of one show
// share the link and neither claims to be it. The season suffix that used to scope it (`nf:80123-2` on
// season 2) wrote JustWatch's numbering into an id space where unogs writes Netflix's, and Netflix
// folds two anime cours into one season, so the two numberings named different runs under one uri.
// The precise run is `similarMedia`'s to name, asked of the provider's own source with evidence.
//
// Crunchyroll's offers are `/watch/<episodeId>` urls that get resolved through Crunchyroll itself.
// That resolution answers with the season of THAT episode, which is one specific season of the show,
// and the show-level offer hands it to every season media alike, so a pinned season never takes it.
import { expect, test } from 'vite-plus/test'

import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { resolvers } from '../../../../src/sources/justwatch/extractor'
import { viewerIn } from './viewer'

const JW_API = 'https://apis.justwatch.com/graphql'
const CMS = 'https://www.crunchyroll.com/content/v2/cms'

// the real affiliate wrapper, because the extractor unwraps `?u=` before reading the url
const CR_OFFER = 'https://crunchyroll.pxf.io/xk92Nv?u=https%3A%2F%2Fwww.crunchyroll.com%2Fwatch%2FGEPISODE1'
const NF_OFFER = 'https://www.netflix.com/title/80123456'

const season = (objectId: number, seasonNumber: number) => ({
  objectId,
  totalEpisodeCount: 12,
  content: { seasonNumber, isReleased: true, originalReleaseYear: 2020 + seasonNumber },
  episodes: [],
})

const node = {
  id: 'ts12345',
  objectId: 12345,
  objectType: 'SHOW',
  content: {
    title: 'A Show With Several Seasons',
    fullPath: '/us/tv-show/a-show',
    posterUrl: null,
    shortDescription: 'A show.',
    originalReleaseYear: 2021,
  },
  offers: [
    { monetizationType: 'FLATRATE', standardWebURL: CR_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
    { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
  ],
  // the second licensing region the query now asks for; empty here so the fixtures below that do not
  // exercise it read exactly as they did before
  extraOffers: [] as { monetizationType: string, standardWebURL: string, package: { clearName: string, shortName: string } }[],
  seasons: [season(111, 2), season(222, 3)],
}

// Every url the resolver can reach, answered from a table. An unlisted url throws rather than
// returning an empty payload, so a fixture that has drifted fails loudly instead of quietly
// producing the absence this file asserts.
const film = {
  id: 'tm999',
  objectId: 999,
  objectType: 'MOVIE',
  content: {
    title: 'A Film',
    fullPath: '/us/movie/a-film',
    posterUrl: null,
    shortDescription: 'A film.',
    originalReleaseYear: 2020,
  },
  offers: [
    { monetizationType: 'FLATRATE', standardWebURL: CR_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
  ],
  extraOffers: [] as { monetizationType: string, standardWebURL: string, package: { clearName: string, shortName: string } }[],
  seasons: [],
}

const context = (which: typeof node | typeof film = node) => ({
  fetch: async (url: string) => {
    if (url === JW_API) return { json: async () => ({ data: { node: which } }) }
    if (url === 'https://www.crunchyroll.com/auth/v1/token') {
      return { json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }
    }
    // the episode the show-level offer links to. It belongs to ONE season, GSEASON2, whichever season
    // media is being built.
    if (url.startsWith(`${CMS}/objects/GEPISODE1`)) {
      return { json: async () => ({ data: [{ episode_metadata: { series_id: 'GSERIES', season_id: 'GSEASON2' } }] }) }
    }
    throw new Error(`fixture has no route for ${url}`)
  },
}) as never

const handlesFor = async (uri: string, which?: typeof node | typeof film) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(which)).next()
  // handles are edges now: { node, relation }. These assertions are about WHICH ids get minted, so
  // they read the nodes; the relation each one carries is asserted where it is the point.
  return ((value?.media?.handles ?? []) as { node: { uri: string, origin: string, id: string } }[])
    .map(handle => handle.node)
}

const idFor = (handles: { origin: string, id: string }[], origin: string) =>
  handles.filter(handle => handle.origin === origin).map(handle => handle.id)

// The weld. Both uris name the same JustWatch node and different seasons of it, which is what the
// `-<seasonObjectId>` scoping is for, and both used to come back holding `cr:GSERIES-GSEASON2`.
// `upsertMedia` unions on a shared handle and `graph.link` has no inverse, so season 2 and season 3
// became one media for the session.
test('two seasons of one show do not come back holding the same crunchyroll handle', async () => {
  const two = await handlesFor('jw:12345-111')
  const three = await handlesFor('jw:12345-222')

  const shared = idFor(two, 'cr').filter(id => idFor(three, 'cr').includes(id))
  expect(shared, 'a handle on both seasons welds them permanently').toEqual([])
})

// The same show-level offer on both seasons, as a CONTAINER edge on each: the link is shared, the
// identity is not. It used to be `80123456-2` and `80123456-3`, JustWatch's ordinals in Netflix's id
// space, where unogs mints `80123456-<netflix season>`; Netflix's season 2 of Mushoku Tensei holds two
// anime cours, so the same uri named two different runs and `graph.link` has no inverse.
test('a netflix offer off a show-level node is the TITLE, PART_OF, on every season: the link is shared and the identity is not', async () => {
  const { edges: two } = await scopedEdgesFor('jw:12345-111', node)
  const { edges: three } = await scopedEdgesFor('jw:12345-222', node)

  for (const edges of [two, three]) {
    const netflix = edges.filter(edge => edge.node.origin === 'nf')
    expect(netflix.map(edge => edge.node.id), 'the bare title id, no numbering of anyone\'s').toEqual(['80123456'])
    expect(netflix[0]!.relation, 'a show-level offer is containment, never identity').toBe('PART_OF')
    expect(netflix[0]!.node.scope).toBe('CONTAINER')
  }

  // the control: a FILM's netflix offer names exactly that film, so it keeps the identity
  const filmOnNetflix = {
    ...film,
    offers: [{ monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } }],
  }
  const { edges: filmEdges } = await scopedEdgesFor('jw:999', filmOnNetflix)
  const netflix = filmEdges.find(edge => edge.node.origin === 'nf')
  expect(netflix?.node.id).toBe('80123456')
  expect(netflix?.relation, 'a film is exact under its bare id').toBe('SAME_AS')
  expect(netflix?.node.scope).toBe('RUN')
})

// The control, and the reason the refusal is scoped to a pinned season rather than applied to every
// crunchyroll offer. A film has no season to be confused with, `showRequiresSeason` lets it through
// with a null seasonNumber, and the episode its offer links to is the film itself. That handle is
// honest and it survives: a run where both this and the weld test go quiet has broken the path, not
// fixed the bug.
test('a film still takes the crunchyroll handle its own offer resolves to', async () => {
  const handles = await handlesFor('jw:999', film)

  expect(idFor(handles, 'cr')).toEqual(['GSERIES-GSEASON2'])
})

// A crunchyroll offer that is a /series/ url rather than a /watch/ one. `providerContentId` refuses it
// outright, because `extractContentId` reads a cr id from /series/ and nothing else, so every cr id
// reaching it names a SHOW and, on Crunchyroll, that show's films. That refusal used to be a DROP.
//
// It is a demotion now: the film or run is genuinely PART OF that series, so the link stays on the page
// while the claim does not. Fifteen Dragon Ball Z films share /series/GQWH0M1GG, which is why it can
// never be an identity.
const CR_SERIES_OFFER = 'https://www.crunchyroll.com/series/GQWH0M1GG/dragon-ball-z-movies'

test('a crunchyroll series offer is kept as PART_OF rather than dropped', async () => {
  const filmWithSeriesOffer = {
    ...film,
    offers: [
      { monetizationType: 'FLATRATE', standardWebURL: CR_SERIES_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
    ],
  }

  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'jw:999' } }, context(filmWithSeriesOffer)).next()
  const edges = (value?.media?.handles ?? []) as { relation: string, node: { origin: string, id: string } }[]

  const cr = edges.find(edge => edge.node.origin === 'cr')
  expect(cr, 'the link must survive, which is the change').toBeDefined()
  expect(cr!.node.id).toBe('GQWH0M1GG')
  expect(cr!.relation, 'it names the whole collection, so it may never be an identity').toBe('PART_OF')
})

// The scope stamp. Every handle this source mints is a RUN except the one above: a bare /series/ id
// names the show, so the node has to leave here scoped CONTAINER, which is what keeps it out of every
// run's identity space in the store. Both halves are read off the edge so a stamp that lands on the
// wrong node, or on none, fails here rather than as a weld on the live site.
const scopedEdgesFor = async (uri: string, which: typeof node | typeof film) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(which)).next()
  return {
    media: value?.media as { scope: string } | undefined,
    edges: (value?.media?.handles ?? []) as { relation: string, node: { origin: string, id: string, scope: string } }[],
  }
}

test('a crunchyroll series offer leaves as a CONTAINER, and everything season scoped stays a RUN', async () => {
  const filmWithSeriesOffer = {
    ...film,
    offers: [
      { monetizationType: 'FLATRATE', standardWebURL: CR_SERIES_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
    ],
  }
  const { media, edges } = await scopedEdgesFor('jw:999', filmWithSeriesOffer)
  const series = edges.find(edge => edge.node.origin === 'cr')
  expect(series?.node.id).toBe('GQWH0M1GG')
  expect(series?.node.scope, 'a /series/ id is one id for every run of the show').toBe('CONTAINER')
  expect(media?.scope, 'the film itself is one run').toBe('RUN')

  // the control: a film's own resolved crunchyroll season names one run, and a run that came out
  // CONTAINER would silently lose every SAME_AS it should have taken. This is the proof a film still
  // mints an identity at all.
  const { edges: filmEdges } = await scopedEdgesFor('jw:999', film)
  const resolved = filmEdges.find(edge => edge.node.origin === 'cr')
  expect(resolved?.node.id).toBe('GSERIES-GSEASON2')
  expect(resolved?.node.scope).toBe('RUN')
  expect(resolved?.relation).toBe('SAME_AS')

  // the season media itself is a run; the netflix TITLE it hangs under is not
  const { media: seasonTwo, edges: seasonEdges } = await scopedEdgesFor('jw:12345-111', node)
  expect(seasonTwo?.scope).toBe('RUN')
  const netflix = seasonEdges.find(edge => edge.node.origin === 'nf')
  expect(netflix?.node.id).toBe('80123456')
  expect(netflix?.node.scope).toBe('CONTAINER')
  expect(netflix?.relation).toBe('PART_OF')
})

// THE TITLE, which this source computed and then dropped until 2026-09-12. Two rules in one assertion,
// and the synthesized "<show> Season <n>" is still gone: the media takes the SEASON's own title when
// JustWatch gives it one naming more than a position, and the SHOW's otherwise, so JustWatch's ordinal
// never enters a cluster's title set while the row is still findable by `plugin:title`.
//
// Mutation: delete the `titles` line in `normalizeMedia` and the first two go red; drop the `!` from
// `isOnlySeasonLabel` and the last two swap.
const mediaFor = async (uri: string, which: typeof node | typeof film = node) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(which)).next()
  return value?.media as GQLMedia
}

const titlesOf = (media: GQLMedia | undefined) => (media?.titles ?? []).map(title => title.title)

test('a season media carries a title: its own when it names one, the show\'s otherwise, never an ordinal', async () => {
  // the season JustWatch titles with nothing at all
  expect(titlesOf(await mediaFor('jw:12345-111')), 'the show\'s, so the row is findable by title')
    .toEqual(['A Show With Several Seasons'])

  const named = {
    ...node,
    seasons: [{ ...season(111, 2), content: { ...season(111, 2).content, title: 'The War Arc' } }, season(222, 3)],
  }
  expect(titlesOf(await mediaFor('jw:12345-111', named as typeof node)), 'a season title naming more than a position wins')
    .toEqual(['The War Arc'])

  const positional = {
    ...node,
    seasons: [{ ...season(111, 2), content: { ...season(111, 2).content, title: 'Season 2' } }, season(222, 3)],
  }
  const fallback = await mediaFor('jw:12345-111', positional as typeof node)
  expect(titlesOf(fallback), 'a bare position label is an ordinal this source does not trust')
    .toEqual(['A Show With Several Seasons'])
  expect(titlesOf(fallback)).not.toContainEqual(expect.stringMatching(/season\s+\d/i))

  // and the show CONTAINER still carries the show's own title, which is the node similarMedia is asked of
  const show = (await mediaFor('jw:12345-111')).handles.find(handle => handle.node.origin === 'jw')
  expect(show?.node.titles.map(title => title.title)).toEqual(['A Show With Several Seasons'])
  expect((await mediaFor('jw:12345-111')).handles.flatMap(handle => handle.node.titles).map(title => title.title))
    .not.toContainEqual(expect.stringMatching(/season\s+\d/i))
})

// A film keeps what it had: its own title on the media, and the same title on the one synthetic episode
// the playback path reads. That episode used to be the ONLY place a JustWatch title survived.
test('a film keeps its title, on the media and on its one episode', async () => {
  const media = await mediaFor('jw:999', film)

  expect(titlesOf(media)).toEqual(['A Film'])
  expect((media.episodes ?? []).map(episode => (episode?.titles ?? []).map(title => title.title)))
    .toEqual([['A Film']])
})

// The graph reads a film's kind off `type` alone, so an untyped film skips guard 9 and a series can
// claim it (2026-10-12).
test('a film is typed MOVIE and a season is not typed', async () => {
  expect((await mediaFor('jw:999', film)).type).toBe('MOVIE')
  expect((await mediaFor('jw:12345-111')).type, 'the control: a season').toBeUndefined()
})

// THE DATE. `${year}-01-01` is the exact spelling the store reads as no day at all, and it was every
// JustWatch row's date because nothing asked for the day. The day is asked for now, at season level.
//
// Mutation: drop `originalReleaseDate` from the NODE_QUERY season block, or make `dayOrYear` ignore its
// day, and the first assertion goes back to 2022-01-01.
const dated = (day: string | null) => ({
  ...node,
  content: { ...node.content, originalReleaseDate: '2021-04-01' },
  seasons: [
    { ...season(111, 2), content: { ...season(111, 2).content, originalReleaseDate: day } },
    season(222, 3),
  ],
})

test('a season media takes the season\'s own day, and falls back to its year and never to the show\'s day', async () => {
  expect((await mediaFor('jw:12345-111', dated('2022-07-06') as typeof node)).startDate).toBe('2022-07-06')

  const undated = await mediaFor('jw:12345-111', dated(null) as typeof node)
  expect(undated.startDate, 'year precision, awaiting startDatePrecision: never the show\'s 2021-04-01')
    .toBe('2022-01-01')

  // the control: a film has no season, so the show-level day IS its own and is taken
  const film2026 = { ...film, content: { ...film.content, originalReleaseDate: '2020-02-26' } }
  expect((await mediaFor('jw:999', film2026 as typeof film)).startDate).toBe('2020-02-26')
})

// The episode dates `plugin:range` pairs a folded packaging's rows on. JustWatch carries them on the
// episode list NODE_QUERY already fetches, and none of them reached us before 2026-09-12.
//
// Mutation: drop `releaseDate` from `normalizeEpisode` and the first assertion is [undefined, undefined].
test('episodes carry the day they aired, and an undated one is absent rather than invented', async () => {
  const episodes = [
    { objectId: 1, content: { title: 'One', episodeNumber: 1, seasonNumber: 2, isReleased: true, shortDescription: null, originalReleaseDate: '2022-07-06', runtime: 24 } },
    { objectId: 2, content: { title: 'Two', episodeNumber: 2, seasonNumber: 2, isReleased: true, shortDescription: null, originalReleaseDate: null, runtime: 24 } },
  ]
  const listed = { ...node, seasons: [{ ...season(111, 2), episodes }, season(222, 3)] }

  const media = await mediaFor('jw:12345-111', listed as unknown as typeof node)
  expect((media.episodes ?? []).map(episode => episode?.releaseDate)).toEqual(['2022-07-06', undefined])
})

// The query has to ASK for the days, and a fixture answers whatever it is sent, so every assertion above
// would stay green against a query that never requested one.
test('the node query asks for the season and episode release days', async () => {
  const bodies: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const ctx = {
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== JW_API) throw new Error(`fixture has no route for ${url}`)
      bodies.push(init?.body ?? '')
      return { json: async () => ({ data: { node: { ...node, offers: [], extraOffers: [] } } }) }
    },
  } as never

  await subscribe(undefined, { input: { uri: 'jw:12345-111' } }, ctx).next()

  const query = JSON.parse(bodies[0] ?? '{}').query ?? ''
  expect(query, 'the node query ran').toContain('GetTitleNode')
  expect([...query.matchAll(/originalReleaseDate/g)].length, 'the work, the season and the episode')
    .toBeGreaterThanOrEqual(3)
})

// What makes JustWatch askable: the worker asks `similarMedia` of CONTAINER origins only, and it is
// also what lets the container space union `jw:<objectId>` with `cr:<series>` and `tvmaze:<show>` on
// a title, so a run PART_OF any one of them reaches JustWatch's offers.
test('a season media is PART_OF its show node, scoped CONTAINER', async () => {
  const { edges } = await scopedEdgesFor('jw:12345-111', node)
  const show = edges.find(edge => edge.node.origin === 'jw')
  expect(show?.node.id).toBe('12345')
  expect(show?.relation).toBe('PART_OF')
  expect(show?.node.scope).toBe('CONTAINER')

  // a film is its own node, and hangs under nothing
  const { edges: filmEdges } = await scopedEdgesFor('jw:999', film)
  expect(filmEdges.find(edge => edge.node.origin === 'jw')).toBeUndefined()
})

// `similarMedia`: another origin's run page describing ITS run, asking which JustWatch season is the
// same run. The rules are shared (../similar.ts); what this file owns is the candidates it builds
// from the node (a count, a year, no finer date) and a refusal being null rather than the show.
const askSimilar = async (which: typeof node | typeof film, input: Record<string, unknown>) => {
  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  const yields: { similarMedia: GQLMedia | null }[] = []
  for await (const value of subscribe(undefined, { input }, context(which))) yields.push(value)
  return { yields, answer: yields[0]?.similarMedia ?? null }
}

test('similarMedia names the season the evidence establishes and refuses a fold', async () => {
  const ordinal = await askSimilar(node, { showId: '12345', titles: ['A Show Season 3'], episodeCount: 12 })
  expect(ordinal.answer?.uri).toBe('jw:12345-222')
  expect(ordinal.answer?.scope).toBe('RUN')
  expect(ordinal.answer?.handles.map(handle => handle.relation), 'nothing in the answer names another run')
    .toEqual(ordinal.answer?.handles.map(() => 'PART_OF'))

  const fold = await askSimilar(node, { showId: '12345', titles: ['A Show Season 2'], episodeCount: 10 })
  expect(fold.answer, 'JustWatch season 2 holds 12 over our 10: several runs in one season').toBeNull()
  expect(fold.yields, 'a refusal still yields once').toEqual([{ similarMedia: null }])

  // JustWatch has a year and nothing finer, so the year rule is its date axis: the one season dated
  // our year, with no ordinal to read and a count that does not tell 12 from 12
  const year = await askSimilar(node, { showId: '12345', startDate: '2023-01-01', titles: ['A Show'], episodeCount: 12 })
  expect(year.answer?.uri, 'season 222 is the 2023 one').toBe('jw:12345-222')

  const movie = await askSimilar(film, { showId: '999', titles: ['A Film'], episodeCount: 1 })
  expect(movie.yields, 'a film has no seasons to pick between').toEqual([{ similarMedia: null }])
})

// A `totalEpisodeCount` of 0 is a season JustWatch has not listed yet, offered to the picker as no
// count. Until 2026-09-05 the one season dated our year answered without a count to check, so two runs
// of that year with any lengths both took the unlisted season.
test('similarMedia never answers an unlisted season by its year alone', async () => {
  const unlisted = { ...node, seasons: [season(111, 2), { ...season(222, 3), totalEpisodeCount: 0 }] }

  expect((await askSimilar(unlisted, { showId: '12345', startDate: '2023-01-01', titles: ['A Show'], episodeCount: 12 })).answer).toBeNull()
  expect((await askSimilar(unlisted, { showId: '12345', startDate: '2023-01-01', titles: ['A Show'], episodeCount: 24 })).answer).toBeNull()
  expect(
    (await askSimilar(unlisted, { showId: '12345', startDate: '2022-01-01', titles: ['A Show'], episodeCount: 12 })).answer?.uri,
    'the control: the listed season of our year, holding our count, still answers'
  ).toBe('jw:12345-111')
})

// The media path goes through the same picker. A unique episode count used to pick a season on its
// own (../season.ts, `pickSeasonByEpisodeCount`), and a unique count is a number, not an identity:
// with several seasons only the FIRST may be a run whose title names no season, by an exact count.
const knowing = (which: typeof node, known: Record<string, unknown>) => ({
  fetch: (context(which) as { fetch: unknown }).fetch,
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
}) as never

test('the media path picks its season through the shared picker: a season a unique count used to pick is refused', async () => {
  const uneven = { ...node, seasons: [{ ...season(111, 2), totalEpisodeCount: 13 }, season(222, 3)] }
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const uri = 'ag:(anilist:1,jw:12345)'

  const { value: refused } = await subscribe(undefined, { input: { uri } }, knowing(uneven, { titles: [{ title: 'A Show' }], episodeCount: 12 })).next()
  expect(refused?.media, 'the first season is 13, so a run of 12 with no ordinal is not placed by the season that happens to hold 12').toBeNull()

  // the control: an agreed ordinal with a count the season does not exceed still places the run
  const { value: placed } = await subscribe(undefined, { input: { uri } }, knowing(uneven, { titles: [{ title: 'A Show Season 3' }], episodeCount: 12 })).next()
  expect(placed?.media?.uri).toBe('jw:12345-222')
})

// A bare id names two unrelated titles: `tm188787` is Ninja Scroll and `ts188787` is another show
// (2026-10-12), so a re-asked grown uri reads which node it means from what the cluster is.
test('a re-asked bare id asks the film node for a film cluster, and the show node for a show', async () => {
  const asked: string[] = []
  const nodes: Record<string, unknown> = { tm999: film, ts999: node, ts12345: node }
  const ctx = (known: Record<string, unknown>) => ({
    findAggregatedMedia: async () => known,
    listenForMediaChanges: async function* () {},
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== JW_API) return (context(film) as { fetch: (url: string) => unknown }).fetch(url)
      const { nodeId } = JSON.parse(init?.body ?? '{}').variables
      asked.push(nodeId)
      return { json: async () => ({ data: { node: nodes[nodeId] } }) }
    },
  }) as never
  const subscribe = (resolvers.Subscription as any).media.subscribe

  const { value: movie } = await subscribe(
    undefined, { input: { uri: 'ag:(anilist:617,jw:999)' } }, ctx({ categories: ['ANIME', 'MOVIE'] })
  ).next()
  expect(asked).toEqual(['tm999'])
  expect(movie?.media?.uri).toBe('jw:999')

  asked.length = 0
  const { value: show } = await subscribe(
    undefined, { input: { uri: 'ag:(anilist:1,jw:12345)' } },
    ctx({ categories: ['ANIME', 'SERIES'], titles: [{ title: 'A Show Season 3' }], episodeCount: 12 })
  ).next()
  expect(asked, 'the control: a show cluster still asks the show node').toEqual(['ts12345'])
  expect(show?.media?.uri).toBe('jw:12345-222')
})

// A JustWatch offer is scoped to ONE country, and the extractor asked US only. Anime is licensed per
// region, so the US catalogue is blind to most of Netflix's anime: measured 2026-09-09, The Elusive
// Samurai is `cra itu cru amz` in US and carries `nf:81907835` only in JP, and Mushoku Tensei's
// Netflix offer (`nf:80987039`) exists in JP alone. The seed built 2026-09-05 held both, minted off
// unogs' `/api/search`, which now answers `fail:unogskey` to every caller including unogs' own page,
// so the id has to come from the offer or from nowhere.
//
// The second country rides on the same request as an aliased `extraOffers` selection, and its offers
// are concatenated after the primary's. `buildOffersAsHandles` dedupes by package shortName, so this
// can only ADD a service, never repoint one that both countries carry.
test('a netflix offer that only the second licensing region carries still mints its handle', async () => {
  const jpOnlyNetflix = {
    ...node,
    // the US catalogue: Crunchyroll, and no Netflix at all
    offers: [
      { monetizationType: 'FLATRATE', standardWebURL: CR_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
    ],
    extraOffers: [
      { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
    ],
  }

  const { edges } = await scopedEdgesFor('jw:12345-111', jpOnlyNetflix)
  expect(idFor(edges.map(edge => edge.node), 'nf'), 'the JP-only netflix title id').toEqual(['80123456'])

  // the control that proves the assertion above is about the second region and not about the fixture
  // simply carrying Netflix somewhere: with the SAME offers and no second region, nothing mints.
  const { edges: usOnly } = await scopedEdgesFor('jw:12345-111', { ...jpOnlyNetflix, extraOffers: [] })
  expect(idFor(usOnly.map(edge => edge.node), 'nf'), 'no netflix offer in either region').toEqual([])
})

// A service both regions carry keeps the VIEWER's region url, here the primary's, because a deep link
// is regional and the id read off it is not always. Netflix's is worldwide, but Amazon numbers per
// storefront, so the order the two lists are concatenated in is load bearing rather than incidental.
test('a service in both regions keeps the primary region url, and the second only adds', async () => {
  viewerIn('America/New_York')
  const bothRegions = {
    ...node,
    offers: [
      { monetizationType: 'FLATRATE', standardWebURL: 'https://www.netflix.com/title/11111111', package: { clearName: 'Netflix', shortName: 'nfx' } },
    ],
    extraOffers: [
      { monetizationType: 'FLATRATE', standardWebURL: 'https://www.netflix.com/title/99999999', package: { clearName: 'Netflix', shortName: 'nfa' } },
      { monetizationType: 'FLATRATE', standardWebURL: 'https://www.disneyplus.com/browse/entity-abc123', package: { clearName: 'Disney+', shortName: 'dnp' } },
    ],
  }

  const { edges } = await scopedEdgesFor('jw:12345-111', bothRegions)
  expect(idFor(edges.map(edge => edge.node), 'nf'), 'the primary region wins the shared service').toEqual(['11111111'])
  expect(idFor(edges.map(edge => edge.node), 'disney'), 'and the region-only service is still added').toEqual(['abc123'])
})

// The queries have to ASK for the second region, and a fixture answers whatever it is sent, so the
// tests above would stay green against a query that never requested it. This reads the request body.
test('both queries ask for a second licensing region', async () => {
  const bodies: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const ctx = {
    fetch: async (url: string, init?: { body?: string }) => {
      if (url === JW_API) {
        bodies.push(init?.body ?? '')
        return { json: async () => ({ data: { node } }) }
      }
      if (url === 'https://www.crunchyroll.com/auth/v1/token') {
        return { json: async () => ({ access_token: 'test-token', expires_in: 3600 }) }
      }
      if (url.startsWith(`${CMS}/objects/GEPISODE1`)) {
        return { json: async () => ({ data: [{ episode_metadata: { series_id: 'GSERIES', season_id: 'GSEASON2' } }] }) }
      }
      throw new Error(`fixture has no route for ${url}`)
    },
  } as never

  await subscribe(undefined, { input: { uri: 'jw:12345-111' } }, ctx).next()

  expect(bodies.length, 'the node query ran').toBeGreaterThan(0)
  for (const body of bodies) {
    const { query, variables } = JSON.parse(body)
    expect(query, 'the second region is selected under its own alias').toContain('extraOffers: offers(country: $extraCountry')
    expect(variables.extraCountry, 'and a country is actually bound to it').toBeTruthy()
    expect(variables.extraCountry).not.toBe(variables.offerCountry)
  }
})

// JustWatch FOLDS anime cours the same way Netflix does, so a run that is one cour matches none of its
// seasons and `pickSimilarSeason` returns undefined. Measured live 2026-09-10 on Mushoku Tensei:
// JustWatch publishes seasons of 23, 24 and 14 against cours of 11/12/12/12/14, the title gate passes
// (`scored=1`) and the date gate passes (`dated=true`), and the season pick then refuses. Only the cour
// whose length happened to equal a JustWatch season (14 against 14) survived, which is exactly why
// Netflix appeared on the last season of the show and on none of the earlier ones: the OFFERS hang off
// the show node, so refusing the node threw away the `nf:` id with it.
//
// The show now comes back as a CONTAINER instead. Refusing the SEASON is still right, and none of this
// claims to be the run.
import { showAsContainer } from '../../../../src/sources/justwatch/extractor'

const showNode = (offers: { monetizationType: string, standardWebURL: string, package: { clearName: string, shortName: string } }[]) => ({
  id: 'ts222366',
  objectId: 222366,
  objectType: 'SHOW',
  content: {
    title: 'Mushoku Tensei: Jobless Reincarnation',
    fullPath: '/us/tv-show/mushoku-tensei',
    posterUrl: null,
    shortDescription: 'A show whose seasons fold two cours each.',
    originalReleaseYear: 2021,
  },
  offers,
  extraOffers: [],
  seasons: [],
})

const bare = () => ({ fetch: async (url: string) => { throw new Error(`no route for ${url}`) } }) as never

test('a show whose season cannot be established still yields its netflix id, as a container', async () => {
  const media = await showAsContainer(showNode([
    { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
  ]) as never, bare())

  expect(media?.scope, 'a show is never a run: this is what keeps it out of every cour\'s identity space').toBe('CONTAINER')
  expect(media?.id, 'the bare node id, with no season suffix').toBe('222366')

  const netflix = (media?.handles ?? []).filter(handle => handle.node.origin === 'nf')
  expect(netflix.map(handle => handle.node.id), 'the netflix title id the offers carry').toEqual(['80123456'])
  // container to container is an identity between two SHOWS, which unions in the container space and
  // never in a run's. That union is how the cour reaches the id at all.
  expect(netflix[0]!.relation).toBe('SAME_AS')
})

// The trap this replaced: `buildOffersAsHandles` resolves a crunchyroll /watch/ url through Crunchyroll
// to get a series id, and that answers with the SEASON the episode is in, which is a RUN. Claiming the
// SHOW is that season is a cross-scope weld, and `graph.link` has no inverse. The fixture routes the
// crunchyroll calls, so a resolution attempt would SUCCEED here rather than throw: if the gate is
// removed this test goes red on a real handle, not on an error.
test('a show container never claims to be a crunchyroll season', async () => {
  const media = await showAsContainer(showNode([
    { monetizationType: 'FLATRATE', standardWebURL: CR_OFFER, package: { clearName: 'Crunchyroll', shortName: 'cru' } },
    { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
  ]) as never, context())

  expect(idFor((media?.handles ?? []).map(handle => handle.node), 'cr'), 'no season id on a show').toEqual([])
  expect(idFor((media?.handles ?? []).map(handle => handle.node), 'nf'), 'and the netflix id still lands').toEqual(['80123456'])
})

// A container naming no provider id is noise: the cluster already reaches the show through crunchyroll's
// and tvmaze's containers, so one more adds nothing a reader could act on.
test('a show with no offers worth minting yields nothing at all', async () => {
  expect(await showAsContainer(showNode([]) as never, bare())).toBeNull()
  const unmapped = await showAsContainer(showNode([
    { monetizationType: 'FLATRATE', standardWebURL: 'https://happyon.jp/title/12345', package: { clearName: 'Hulu Japan', shortName: 'hlu' } },
  ]) as never, bare())
  expect(unmapped, 'a host `extractContentId` does not know mints no id').toBeNull()
})

// The container is HELD, never returned early. A franchise is routinely split across several catalogue
// entries and the runners-up are checked for exactly that reason, so returning the first candidate
// whose season folds would beat a later entry that matches a season exactly, trading a run for a
// container. That is the one way this fallback could make results worse than refusing outright.
const searchContext = (nodes: Record<string, unknown>[], known: Record<string, unknown>) => ({
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string, init?: { body?: string }) => {
    if (url !== JW_API) throw new Error(`fixture has no route for ${url}`)
    const body = init?.body ?? ''
    if (body.includes('GetSearchTitles')) {
      return { json: async () => ({ data: { popularTitles: { edges: nodes.map(node => ({ node })) } } }) }
    }
    const nodeId = JSON.parse(body).variables.nodeId
    const node = nodes.find(candidate => candidate.id === nodeId)
    if (!node) throw new Error(`fixture has no node ${nodeId}`)
    return { json: async () => ({ data: { node } }) }
  },
}) as never

const candidate = (id: number, seasons: { n: number, count: number }[], offers: unknown[] = []) => ({
  id: `ts${id}`,
  objectId: id,
  objectType: 'SHOW',
  content: {
    title: 'A Folding Show', fullPath: `/us/tv-show/${id}`, posterUrl: null,
    shortDescription: 'x', originalReleaseYear: 2023,
  },
  offers,
  extraOffers: [],
  seasons: seasons.map(({ n, count }) => ({
    id: `s${id}-${n}`, objectId: id * 10 + n, totalEpisodeCount: count,
    content: { title: `Season ${n}`, seasonNumber: n, isReleased: true, originalReleaseYear: 2023 },
    episodes: [],
  })),
})

test('a later candidate that matches a season exactly beats an earlier one that only folds', async () => {
  const folded = candidate(1111, [{ n: 1, count: 24 }], [
    { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
  ])
  const exact = candidate(2222, [{ n: 1, count: 12 }])
  const known = {
    uri: 'ag:(anilist:999)', titles: [{ title: 'A Folding Show' }],
    startDate: '2023-07-09', episodeCount: 12,
  }

  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(
    undefined, { input: { uri: 'ag:(anilist:999)' } }, searchContext([folded, exact], known)
  ).next()

  expect(value?.media?.origin).toBe('jw')
  expect(value?.media?.scope, 'the exact season is a RUN, not the folded show container').toBe('RUN')
  expect(String(value?.media?.id), 'the SECOND candidate, whose season matches the run').toContain('2222')
})

// The other half of the same rule: when nothing matches a season, the held container is what comes back
// rather than null. Without it the offers, and with them the netflix id, are lost entirely.
test('when no candidate matches a season, the held container is returned', async () => {
  const folded = candidate(1111, [{ n: 1, count: 24 }], [
    { monetizationType: 'FLATRATE', standardWebURL: NF_OFFER, package: { clearName: 'Netflix', shortName: 'nfx' } },
  ])
  const known = {
    uri: 'ag:(anilist:999)', titles: [{ title: 'A Folding Show' }],
    startDate: '2023-07-09', episodeCount: 12,
  }

  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(
    undefined, { input: { uri: 'ag:(anilist:999)' } }, searchContext([folded], known)
  ).next()

  expect(value?.media?.scope).toBe('CONTAINER')
  expect(idFor((value?.media?.handles ?? []).map((h: any) => h.node), 'nf')).toEqual(['80123456'])
})
