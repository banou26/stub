// A Netflix id with no season names the WHOLE title, and stub has no such thing: every media here is
// one run. This source resolves which Netflix season is ours and scopes the uri to it, but when it
// cannot, the answer has to be nothing rather than the show.
//
// It used to be the show. `resolveSeasonNumber` returning undefined fell straight through to
// `getMedia(id, ctx, undefined)`, which skipped the suffix and left the bare `nf:<showId>`, attached
// every season's episodes, and let the caller link the cluster's handles to it. Two runs of one show
// that both failed to resolve then carried the identical uri and union-find welded them, with no
// inverse. Measured over 33 multi-season Netflix series and 105 runs, that path was 30 of 41 welds.
import { expect, test } from 'vite-plus/test'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import type { Media as GQLMedia } from '../../../../src/generated/schema/types.generated'
import { getMedia, linkNetflix, resolvers, searchNodes } from '../../../../src/sources/unogs/extractor'

const UNOGS = 'https://unogs.com/api'

type Season = { season: number, episodes: number, numbered?: boolean }

const routes = (id: string, vtype: 'series' | 'movie', seasons: Season[]) => ({
  'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
  [`${UNOGS}/title/detail?netflixid=${id}`]: [{
    netflixid: Number(id),
    title: 'A Show',
    vtype,
    synopsis: 'A show.',
    year: '2021',
    img: '',
    runtime: '',
    avgrating: '',
    top250: 0,
    top250tv: 0,
    poster: '',
    clist: '',
    imdbid: '',
  }],
  [`${UNOGS}/title/bgimages?netflixid=${id}`]: {},
  [`${UNOGS}/title/episodes?netflixid=${id}`]: seasons.map(season => ({
    season: season.season,
    episodes: Array.from({ length: season.episodes }, (_, index) => ({
      epid: `${id}-s${season.season}e${index + 1}`,
      episode: index + 1,
      // `numbered` is Netflix's own listing for a folded season: it titles every episode `Episode N`,
      // which `isGenericEpisodeTitle` reads as a position and never as a name, so the season can be
      // measured about nothing (the cached payload for 81392609, 2026-09-13)
      title: season.numbered ? `Episode ${index + 1}` : `S${season.season}E${index + 1}`,
      synopsis: '',
      runtime: '',
      img: '',
    })),
  })),
})

// throws on an unlisted url, so fixture drift fails loudly instead of returning undefined and being
// read as "the source had nothing to say"
const ctxFor = (table: Record<string, unknown>): ExtractorServerContext => ({
  fetch: (async (url: string) => {
    const key = typeof url === 'string' ? url : String(url)
    if (!(key in table)) throw new Error(`unstubbed url: ${key}`)
    return { json: async () => table[key], ok: true, status: 200 }
  }) as unknown as ExtractorServerContext['fetch'],
} as unknown as ExtractorServerContext)

test('a series whose season could not be resolved mints NOTHING, not the show', async () => {
  const table = routes('70000001', 'series', [{ season: 1, episodes: 12 }, { season: 2, episodes: 13 }])
  const media = await getMedia('70000001', ctxFor(table), undefined, true)
  expect(media, 'a show-level media here is the uri that welds every run of the show').toBeUndefined()
})

test('a resolved season is scoped to that season and carries only its episodes', async () => {
  const table = routes('70000002', 'series', [{ season: 1, episodes: 12 }, { season: 2, episodes: 13 }])
  const media = await getMedia('70000002', ctxFor(table), 2, true)
  expect(media?.uri).toBe('nf:70000002-2')
  expect(media?.episodeCount, 'season 2 has 13, the union of both would be 25').toBe(13)
})

test('a movie is unaffected, having no season to be confused between', async () => {
  const table = routes('70000003', 'movie', [])
  const media = await getMedia('70000003', ctxFor(table), undefined, true)
  expect(media?.uri).toBe('nf:70000003')
  expect(media?.episodeCount).toBe(1)
})

// The direct-browse path attaches no cluster handles, so it cannot weld and must keep working: the
// user naming a Netflix title is entitled to see it even when no run of ours matches a season.
test('without requireSeason the show-level media is still returned, for a direct browse', async () => {
  const table = routes('70000004', 'series', [{ season: 1, episodes: 12 }, { season: 2, episodes: 13 }])
  const media = await getMedia('70000004', ctxFor(table), undefined, false)
  expect(media?.uri).toBe('nf:70000004')
})

// A SEASON-scoped media may never carry the SHOW's year. `normalizeTitle` stamps `title.year`,
// Netflix's year for the whole title, and until 2026-09-05 the season rewrite touched only the id.
//
// The damage is not inaccuracy, it is a WELD by a route that looks nothing like a date problem:
// `profileCluster` builds its `years` set from every member's startDate and `fuzzyMergeMediaClusters`
// buckets by year, so every season of a show landed in season 1's bucket, where a shared title is
// enough. Measured on production: `nf:80987039-3` carried 2021 and put Mushoku Tensei season 3 into
// season 1's bucket. tvmaze, appletv and tmdb each fixed this in their own file; this one was missed.
test('a season-scoped media asserts no start date, rather than the show year', async () => {
  const table = routes('70000005', 'series', [{ season: 1, episodes: 12 }, { season: 3, episodes: 14 }])
  const season = await getMedia('70000005', ctxFor(table), 3, true)

  expect(season?.uri).toBe('nf:70000005-3')
  expect(season?.startDate, "the show's year here buckets this run with season 1").toBeUndefined()
})

// The control: an unscoped browse still carries the show year, which is the only media it is true of.
// A run where both go quiet has removed the date everywhere rather than only where it lies.
test('the show-level media still carries the show year', async () => {
  const table = routes('70000006', 'series', [{ season: 1, episodes: 12 }, { season: 3, episodes: 14 }])
  const show = await getMedia('70000006', ctxFor(table), undefined, false)

  expect(show?.uri).toBe('nf:70000006')
  expect(show?.startDate, 'the only media the show year is true of, and never a January 1').toBe('2021')
})

// A bare `nf:<netflixid>` is the whole Netflix TITLE. For a film that is exact, and for a series it
// names every season at once, which is the id that welds them. The search endpoint returns no season
// information, so there is nothing to scope a series with and the honest answer is to not offer it.
//
// Measured on the deployed site before this: searching "Mushoku Tensei" put `nf:80987039` inside season
// 1's cluster with no media page ever opened (scripts/reproduce-season-weld.mjs, ARM A). justwatch has
// refused seasonless series from its own search for the same reason since `showRequiresSeason`.
test('a search returns films and refuses series, which have no season here to be scoped by', async () => {
  const results = [
    { nfid: 70000010, title: 'A Show', vtype: 'series', synopsis: '', img: '', year: 2021 },
    { nfid: 70000011, title: 'A Film', vtype: 'movie', synopsis: '', img: '', year: 2021 },
  ]
  const table = {
    'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
    [`${UNOGS}/search?limit=50&offset=0&query=anything&countrylist=&country_andorunique=&start_year=&end_year=&start_rating=&end_rating=&genrelist=&type=&audio=&subtitle=&audiosubtitle_andor=&person=&personid=&filterby=&orderby=`]: { results },
  }

  const nodes = await searchNodes('anything', ctxFor(table))

  expect(nodes.map(node => node.uri), 'the series id names every season of it at once').toEqual(['nf:70000011'])
})

// The control: a run where the film is dropped too has stopped the source contributing at all rather
// than stopping it lying, and nothing above would tell those apart.
test('a search of nothing but films still returns all of them', async () => {
  const results = [
    { nfid: 70000012, title: 'Film One', vtype: 'movie', synopsis: '', img: '', year: 2016 },
    { nfid: 70000013, title: 'Film Two', vtype: 'movie', synopsis: '', img: '', year: 2018 },
  ]
  const table = {
    'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
    [`${UNOGS}/search?limit=50&offset=0&query=films&countrylist=&country_andorunique=&start_year=&end_year=&start_rating=&end_rating=&genrelist=&type=&audio=&subtitle=&audiosubtitle_andor=&person=&personid=&filterby=&orderby=`]: { results },
  }

  const nodes = await searchNodes('films', ctxFor(table))
  expect(nodes.map(node => node.uri)).toEqual(['nf:70000012', 'nf:70000013'])
})

// A bare `nf:<netflixid>` on a series names every season at once, so it lives in the CONTAINER
// identity space: the store reads a run's sameness claim against it as PART_OF and never unions. The
// season rewrite is the only thing that turns that id into a run, and it has to say so, because scope
// is sticky toward CONTAINER in the store and a season row that inherited the show's scope would keep
// every anilist id it carries out of the run space for good.
test('a bare series id is scoped CONTAINER', async () => {
  const table = routes('70000020', 'series', [{ season: 1, episodes: 12 }, { season: 2, episodes: 13 }])
  const show = await getMedia('70000020', ctxFor(table), undefined, false)

  expect(show?.uri).toBe('nf:70000020')
  expect(show?.scope, 'the whole title, which several runs are part of').toBe('CONTAINER')
})

test('a season-scoped id is a RUN, whatever the title it came from', async () => {
  const table = routes('70000021', 'series', [{ season: 1, episodes: 12 }, { season: 2, episodes: 13 }])
  const season = await getMedia('70000021', ctxFor(table), 2, true)

  expect(season?.uri).toBe('nf:70000021-2')
  expect(season?.scope, 'one season of the title is one run').toBe('RUN')
})

// The controls: a film is exact under its bare id on both paths that mint one.
test('a film is a RUN under its bare id', async () => {
  const table = routes('70000022', 'movie', [])
  const film = await getMedia('70000022', ctxFor(table), undefined, true)
  expect(film?.uri).toBe('nf:70000022')
  expect(film?.scope).toBe('RUN')

  const results = [{ nfid: 70000023, title: 'A Film', vtype: 'movie', synopsis: '', img: '', year: 2021 }]
  const search = {
    'https://unogs.com/api/user': { token: { access_token: 'test-token' } },
    [`${UNOGS}/search?limit=50&offset=0&query=film&countrylist=&country_andorunique=&start_year=&end_year=&start_rating=&end_rating=&genrelist=&type=&audio=&subtitle=&audiosubtitle_andor=&person=&personid=&filterby=&orderby=`]: { results },
  }
  const nodes = await searchNodes('film', ctxFor(search))
  expect(nodes.map(node => [node.uri, node.scope])).toEqual([['nf:70000023', 'RUN']])
})

// The count-only pick welded Mushoku Tensei on the live site after every other route was closed
// (2026-09-05): Netflix lists the title as seasons of 24, 25 and 11 episodes, anime season 1 has 11
// and a title naming no season, so the count picked Netflix season 3 for it, and season 3's own page
// took the same id by its ordinal. A count is a number, not an identity.
const MUSHOKU: Season[] = [{ season: 1, episodes: 24 }, { season: 2, episodes: 25 }, { season: 3, episodes: 11 }]
const AG = 'ag:(anilist:108465,kitsu:42323)'

const knowing = (table: Record<string, unknown>, titles: string[], episodeCount: number, startDate?: string): ExtractorServerContext => ({
  ...ctxFor(table),
  findAggregatedMedia: async () => ({ titles: titles.map(title => ({ language: 'en', title })), episodeCount, startDate }),
  listenForMediaChanges: async function* () {},
} as unknown as ExtractorServerContext)

test('a run naming no season is not matched to a Netflix season by episode count alone', async () => {
  const ctx = knowing(routes('80987039', 'series', MUSHOKU), ['Mushoku Tensei: Jobless Reincarnation'], 11)
  const media = await linkNetflix('80987039', AG, ctx, 'series')
  expect(media?.uri, 'the whole title, never the season that happens to share a number').toBe('nf:80987039')
  expect(media?.scope).toBe('CONTAINER')
  expect(media?.episodes, 'a container carries no episode list').toEqual([])
  expect(media?.episodeCount).toBeUndefined()
})

test('a Netflix season holding more episodes than the run is a fold of several runs, so the title is the link', async () => {
  const ctx = knowing(routes('80987039', 'series', MUSHOKU), ['Mushoku Tensei: Jobless Reincarnation Season 2'], 13)
  const media = await linkNetflix('80987039', AG, ctx, 'series')
  expect(media?.uri, 'Netflix season 2 is 25 episodes, both halves of anime season 2 at once').toBe('nf:80987039')
  expect(media?.scope).toBe('CONTAINER')
})

test('control: titles agreeing on an ordinal Netflix has, no larger than the run, name that season', async () => {
  const ctx = knowing(routes('80987039', 'series', MUSHOKU), ['Mushoku Tensei: Jobless Reincarnation Season 3'], 14)
  const media = await linkNetflix('80987039', AG, ctx, 'series')
  expect(media?.uri).toBe('nf:80987039-3')
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount, 'only that season, still airing on Netflix').toBe(11)
})

test('control: a first season keeps its precise link when Netflix season 1 holds exactly its episodes', async () => {
  const ctx = knowing(routes('80987039', 'series', MUSHOKU), ['Some Show'], 24)
  const media = await linkNetflix('80987039', AG, ctx, 'series')
  expect(media?.uri).toBe('nf:80987039-1')
  expect(media?.scope).toBe('RUN')
})

test('titles that disagree on the season are a refusal to guess, and the title is the link', async () => {
  const ctx = knowing(routes('80987039', 'series', MUSHOKU), ['Some Show Season 2', 'Some Show Part 3'], 13)
  const media = await linkNetflix('80987039', AG, ctx, 'series')
  expect(media?.uri).toBe('nf:80987039')
  expect(media?.scope).toBe('CONTAINER')
})

test('a lone Netflix season of another length is the title, rather than nothing', async () => {
  const ctx = knowing(routes('70000011', 'series', [{ season: 1, episodes: 24 }]), ['Some Show'], 12)
  const media = await linkNetflix('70000011', AG, ctx, 'series')
  expect(media?.uri, 'the link survives as a container where it used to vanish').toBe('nf:70000011')
  expect(media?.scope).toBe('CONTAINER')
})

test('control: a film is itself, having no season to be confused between', async () => {
  const ctx = knowing(routes('70000012', 'movie', []), ['A Film'], 1)
  const media = await linkNetflix('70000012', AG, ctx, 'movie')
  expect(media?.uri).toBe('nf:70000012')
  expect(media?.scope).toBe('RUN')
})

// The media path reads the cluster's start date as evidence, and Netflix's title year is offered on
// its FIRST season only (it is the whole title's year, which is the first season's). A run dated
// another year that happens to hold exactly as many episodes as Netflix season 1 is a sequel with no
// ordinal in its title, and the year is the only thing that tells it from the first season.
test('the media path vetoes a first season dated another year, and keeps one dated ours', async () => {
  const later = knowing(routes('80987039', 'series', MUSHOKU), ['Some Show'], 24, '2024-01-01')
  const sequel = await linkNetflix('80987039', AG, later)
  expect(sequel?.uri, 'Netflix season 1 is a 2021 season, this run is 2024').toBe('nf:80987039')
  expect(sequel?.scope).toBe('CONTAINER')

  const same = knowing(routes('80987039', 'series', MUSHOKU), ['Some Show'], 24, '2021-07-04')
  const first = await linkNetflix('80987039', AG, same)
  expect(first?.uri, 'the control: a 2021 run of 24 is Netflix season 1').toBe('nf:80987039-1')
})

// `similarMedia`: another origin's run page describing ITS run, asking which Netflix season is the
// same run. The rules are shared (../similar.ts); what this file owns is the candidates it builds from
// the episodes payload and the refusal being null rather than the title.
const askSimilar = async (ctx: ExtractorServerContext, input: Record<string, unknown>) => {
  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  const yields: { similarMedia: GQLMedia | null }[] = []
  for await (const value of subscribe(undefined, { input }, ctx)) yields.push(value)
  return { yields, answer: yields[0]?.similarMedia ?? null }
}

test('similarMedia answers the season the evidence establishes, as a RUN with no handles', async () => {
  const ctx = ctxFor(routes('80987039', 'series', MUSHOKU))
  const { answer } = await askSimilar(ctx, {
    showId: '80987039', titles: ['Mushoku Tensei: Jobless Reincarnation Season 3'], episodeCount: 14
  })
  expect(answer?.uri).toBe('nf:80987039-3')
  expect(answer?.scope).toBe('RUN')
  expect(answer?.handles, 'the caller decides what to claim about the answer').toEqual([])
  expect(answer?.episodeCount, 'only that season').toBe(11)
})

test('similarMedia refuses a fold and a coincidence', async () => {
  const ctx = ctxFor(routes('80987039', 'series', MUSHOKU))
  const fold = await askSimilar(ctx, {
    showId: '80987039', titles: ['Mushoku Tensei: Jobless Reincarnation Season 2'], episodeCount: 13
  })
  expect(fold.answer, 'Netflix season 2 is 25 episodes, both halves of anime season 2 at once').toBeNull()

  const coincidence = await askSimilar(ctx, {
    showId: '80987039', titles: ['Mushoku Tensei: Jobless Reincarnation'], episodeCount: 11
  })
  expect(coincidence.answer, 'the one season holding 11 is not the run that holds 11').toBeNull()
})

// The same coincidence, with the evidence that does settle it: the episode titles. Netflix carries a
// title per episode and no date, so this is the axis that places a run whose own title names no season.
test('similarMedia matches by episode titles when the titles say no season', async () => {
  const ctx = ctxFor(routes('80987039', 'series', MUSHOKU))
  const { answer } = await askSimilar(ctx, {
    showId: '80987039',
    titles: ['Mushoku Tensei: Jobless Reincarnation'],
    episodeCount: 11,
    episodeTitles: Array.from({ length: 11 }, (_, index) => `S3E${index + 1}`)
  })
  expect(answer?.uri, 'eleven of season 3\'s eleven titles, where the count alone was refused above').toBe('nf:80987039-3')
})

test('similarMedia is null for a film title and for an unknown title, and yields exactly once', async () => {
  const film = await askSimilar(ctxFor(routes('70000012', 'movie', [])), { showId: '70000012', titles: ['A Film'], episodeCount: 1 })
  expect(film.yields, 'a film is not a container, so there is nothing to pick').toEqual([{ similarMedia: null }])

  const unknown = await askSimilar(
    ctxFor({ ...routes('70000099', 'series', []), [`${UNOGS}/title/detail?netflixid=70000099`]: [] }),
    { showId: '70000099', titles: ['Nothing'], episodeCount: 12 }
  )
  expect(unknown.yields).toEqual([{ similarMedia: null }])
})

// `containingMedia`: the other half of the fold (4.4), asked only where `similarMedia` answered null.
// Netflix folds Mushoku Tensei's first two anime runs into its season 1, which holds 24 over their 11
// and 12 and numbers every one of its episodes, so nothing about it can be measured on titles and the
// evidence is the year unOGS publishes for the whole title, which is its first season's.
const askContaining = async (ctx: ExtractorServerContext, input: Record<string, unknown>) => {
  const subscribe = (resolvers.Subscription as any).containingMedia.subscribe
  const yields: { containingMedia: GQLMedia | null }[] = []
  for await (const value of subscribe(undefined, { input }, ctx)) yields.push(value)
  return { yields, answer: yields[0]?.containingMedia ?? null }
}

const FOLDED: Season[] = [{ season: 1, episodes: 24, numbered: true }, { season: 2, episodes: 25 }, { season: 3, episodes: 11 }]

test('containingMedia answers the season that HOLDS the run, as a RUN carrying its own count', async () => {
  const ctx = ctxFor(routes('80987039', 'series', FOLDED))
  const { answer } = await askContaining(ctx, {
    showId: '80987039',
    titles: ['Mushoku Tensei: Jobless Reincarnation'],
    episodeCount: 11,
    startDate: '2021-01-11',
  })

  expect(answer?.uri, 'the season the fold veto refused as the run').toBe('nf:80987039-1')
  expect(answer?.scope, 'a season, never the bare title, which asserts nothing about where a run is').toBe('RUN')
  expect(answer?.handles, 'the caller decides what to claim about the answer, and it claims PART_OF').toEqual([])
  expect(answer?.episodeCount, 'the container\'s own length, which the placement reads').toBe(24)
  expect(answer?.episodes?.length).toBe(24)
})

test('containingMedia holds the second cour too, which its own title says is a part', async () => {
  const ctx = ctxFor(routes('80987039', 'series', FOLDED))
  const { answer } = await askContaining(ctx, {
    showId: '80987039',
    titles: ['Mushoku Tensei: Jobless Reincarnation Part 2'],
    episodeCount: 12,
    startDate: '2021-10-04',
  })
  expect(answer?.uri, 'both cours of anime season 1 are inside Netflix season 1').toBe('nf:80987039-1')
})

// The invariant, through the resolvers rather than the picker: one run never gets both answers.
test('a run whose season this source CAN name is given no container', async () => {
  const ctx = ctxFor(routes('80987039', 'series', FOLDED))
  const input = { showId: '80987039', titles: ['Mushoku Tensei: Jobless Reincarnation Season 3'], episodeCount: 14 }

  expect((await askSimilar(ctx, input)).answer?.uri, 'the control: it is season 3').toBe('nf:80987039-3')
  expect((await askContaining(ctx, input)).answer, 'and season 3 is not additionally inside anything').toBeNull()
})

test('containingMedia is null for a film and for a run no season can be shown to hold, and yields once', async () => {
  const film = await askContaining(ctxFor(routes('70000013', 'movie', [])), { showId: '70000013', titles: ['A Film'], episodeCount: 1 })
  expect(film.yields, 'a film has no seasons to hold anything').toEqual([{ containingMedia: null }])

  // the same show and the same run, dated a year Netflix's first season is not: the count fits the
  // fold on both seasons and nothing says which, so there is no container either
  const undated = await askContaining(ctxFor(routes('80987039', 'series', FOLDED)), {
    showId: '80987039', titles: ['Mushoku Tensei: Jobless Reincarnation'], episodeCount: 11, startDate: '2024-01-11',
  })
  expect(undated.yields).toEqual([{ containingMedia: null }])
})
