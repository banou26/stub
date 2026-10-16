// One stub media is one run, and Apple TV's bare content id is the id every season of a show shares.
// A row minted from that id names the show, so it goes out scoped CONTAINER and the store keeps it out
// of every run's identity space: the unscoped search row is exactly the shape that welded runs of one
// show together when it reached graph.link as a run. A film and a season-scoped row each name one run.
//
// Apple describes a season with a number and a premiere and nothing this source will vouch for beyond
// that (27.280% of its per-season episodes belong to another season), so the only evidence that can
// place a run here is a day inside the 45 day window: a year cannot show a count-less season is not a
// fold, so it only ever vetoes.
import { expect, test } from 'vite-plus/test'

import type { ExtractorServerContext } from '../../../../src/worker/extractor'
import { resolvers } from '../../../../src/sources/appletv/extractor'
import SLOW_HORSES from '../../../fixtures/appletv/slow-horses.json'
import THE_INSTIGATORS from '../../../fixtures/appletv/the-instigators.json'

const ATV = 'https://uts-api.itunes.apple.com/uts/v3'
const PARAMS = 'caller=web&sf=143441&v=58&pfm=web&locale=en-US&utsk=0'
const url = (path: string) => `${ATV}${path}${path.includes('?') ? '&' : '?'}${PARAMS}`

// throws on an unlisted url, so fixture drift fails loudly instead of reading as an empty answer
const ctxFor = (table: Record<string, unknown>, known?: unknown): ExtractorServerContext => ({
  fetch: (async (input: string) => {
    const key = typeof input === 'string' ? input : String(input)
    if (!(key in table)) throw new Error(`unstubbed url: ${key}`)
    return { json: async () => table[key], ok: true, status: 200 }
  }) as unknown as ExtractorServerContext['fetch'],
  // what the aggregated media already knows; the listener ends at once so a probe never waits
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
} as unknown as ExtractorServerContext)

const subscriptions = resolvers.Subscription as any

const first = async (iterator: AsyncIterator<any>): Promise<any> => (await iterator.next()).value

const searchPage = async (term: string, items: unknown[]) => {
  const ctx = ctxFor({ [url(`/search?searchTerm=${encodeURIComponent(term)}`)]: { data: { canvas: { shelves: [{ items }] } } } })
  const result = await first(subscriptions.mediaPage.subscribe(undefined, { input: { search: term } }, ctx))
  return result.mediaPage.nodes
}

const resolveMedia = async (uri: string, table: Record<string, unknown>, known?: unknown) => {
  const result = await first(subscriptions.media.subscribe(undefined, { input: { uri } }, ctxFor(table, known)))
  return result.media
}

type Ask = { showId: string, startDate?: string, titles?: string[], episodeCount?: number }

const askSeason = async (input: Ask, table: Record<string, unknown>) => {
  const result = await first(subscriptions.similarMedia.subscribe(undefined, { input }, ctxFor(table)))
  return result.similarMedia ?? null
}

const SHOW = 'umc.cmc.show'
const SEASON_1 = 'umc.cmc.show.season1'
const SEASON_2 = 'umc.cmc.show.season2'
const SEASON_3 = 'umc.cmc.show.season3'

// Two seasons in 2023, 182 days apart: a year cannot tell them apart, a day can. Season 1 is 2021's
// alone. Every season's `releaseDate` is epoch MILLISECONDS, as the endpoint answers it.
const showRoutes = () => ({
  [url(`/shows/${SHOW}`)]: {
    data: {
      content: { id: SHOW, type: 'Show', title: 'A Show', releaseDate: Date.UTC(2021, 0, 11) },
      seasons: {
        [SEASON_1]: { id: SEASON_1, seasonNumber: 1, releaseDate: Date.UTC(2021, 0, 11) },
        [SEASON_2]: { id: SEASON_2, seasonNumber: 2, releaseDate: Date.UTC(2023, 3, 3) },
        [SEASON_3]: { id: SEASON_3, seasonNumber: 3, releaseDate: Date.UTC(2023, 9, 2) },
      },
    },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_1}`)]: {
    data: { episodes: [{ id: 'ep-1-1', title: 'S1E1', seasonNumber: 1, episodeNumber: 1 }, { id: 'ep-1-2', title: 'S1E2', seasonNumber: 1, episodeNumber: 2 }] },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_2}`)]: {
    data: { episodes: [{ id: 'ep-2-1', title: 'S2E1', seasonNumber: 2, episodeNumber: 1 }] },
  },
  [url(`/shows/${SHOW}/episodes?selectedSeasonId=${SEASON_3}`)]: {
    data: { episodes: [{ id: 'ep-3-1', title: 'S3E1', seasonNumber: 3, episodeNumber: 1 }] },
  },
})

const movieRoutes = () => ({
  [url('/shows/umc.cmc.film')]: { code: 404, title: 'NotFound', message: 'show not found' },
  [url('/movies/umc.cmc.film')]: { data: { content: { id: 'umc.cmc.film', type: 'Movie', title: 'A Film', releaseDate: Date.UTC(2020, 5, 1) } } },
})

test('a search row for a Show carries the id every season shares, so it is a CONTAINER', async () => {
  const nodes = await searchPage('A Show', [{ id: SHOW, type: 'Show', title: 'A Show' }])

  expect(nodes.map((node: any) => node.uri)).toEqual([`appletv:${SHOW}`])
  expect(nodes[0].scope, 'the bare show id names every run of the show at once').toBe('CONTAINER')
})

// The controls. A film has no seasons to be confused between, and a season-scoped row names one
// season only; a run where either of those read CONTAINER has stamped everything rather than the show.
// A film's MOVIE type is what keeps a live-action film out of its anime's cluster, which the category
// alone does not.
test('a search row for a Movie names one run, typed MOVIE', async () => {
  const nodes = await searchPage('A Film', [{ id: 'umc.cmc.film', type: 'Movie', title: 'A Film' }])

  expect(nodes.map((node: any) => node.uri)).toEqual(['appletv:umc.cmc.film'])
  expect(nodes[0].scope).toBe('RUN')
  expect(nodes[0].type).toBe('MOVIE')
})

test('a season-scoped media names one run, and attaches only that season', async () => {
  const media = await resolveMedia(`appletv:${SHOW}-s2`, showRoutes())

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

test('a movie resolved by id names one run', async () => {
  const media = await resolveMedia('appletv:umc.cmc.film', movieRoutes())

  expect(media?.uri).toBe('appletv:umc.cmc.film')
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

// Recorded 2026-10-16 through the relay with the reader's own `/shows/<id>` and `/movies/<id>` requests.
// Each keeps every image its answer carries, so the test shows which one is read as the poster.
type Recorded = { data: { content: { id: string, type: string } } }

const recordedRoutes = (answer: Recorded) => {
  const { id, type } = answer.data.content
  return type === 'Movie'
    ? { [url(`/shows/${id}`)]: { code: 404, title: 'NotFound', message: 'show not found' }, [url(`/movies/${id}`)]: answer }
    : { [url(`/shows/${id}`)]: answer }
}

test.each([
  ['show', SLOW_HORSES, 'gaxT8-02hxIwn62aKXvgkA'],
  ['film', THE_INSTIGATORS, 'C0GzyIYIV0BPygvI8YWSAA'],
])('a recorded %s answer takes its tall image as a 2:3 poster', async (_, answer: Recorded, image) => {
  const media = await resolveMedia(`appletv:${answer.data.content.id}`, recordedRoutes(answer))

  expect(media?.covers?.map((cover: { url: string }) => cover.url)).toEqual([`https://is1-ssl.mzstatic.com/image/thumb/${image}/600x900tc.jpg`])
})

// THE MEDIA PATH picks its season through the shared picker, off what the aggregated media knows.
test('a media whose run is dated inside a season\'s window resolves to that season', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show' }], startDate: '2023-04-10' })

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.episodeCount).toBe(1)
})

// A show used to have no identity here when its season could not be placed, and a link to it vanished.
// The bare id IS the show, so it is answered as the show: a CONTAINER with no episodes, the shape
// tvmaze and unogs already answer, and the store keeps it as a container edge off the run.
test('a show whose season cannot be placed answers as the CONTAINER on the media path', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show' }] })

  expect(media?.uri).toBe(`appletv:${SHOW}`)
  expect(media?.scope).toBe('CONTAINER')
  expect(media?.episodes).toEqual([])
  expect(media?.episodeCount).toBeUndefined()
})

// Apple offers no episode count, so an ordinal in our title has nothing to be checked against and never
// picks on its own: "Season 2" of 8 episodes could as easily be Apple's season 2 of 25.
test('a title ordinal with a count is not enough here, because Apple vouches for no count', async () => {
  const media = await resolveMedia(`appletv:${SHOW}`, showRoutes(), { titles: [{ title: 'A Show Season 2' }], episodeCount: 8 })

  expect(media?.uri).toBe(`appletv:${SHOW}`)
  expect(media?.scope).toBe('CONTAINER')
  expect(await askSeason({ showId: SHOW, titles: ['A Show Season 2'], episodeCount: 8 }, showRoutes())).toBeNull()
})

// SIMILAR MEDIA: the one season of a show the caller's date establishes, as a run, or null.
test('similarMedia places a run by a day inside the window', async () => {
  const media = await askSeason({ showId: SHOW, startDate: '2023-04-10' }, showRoutes())

  expect(media?.uri).toBe(`appletv:${SHOW}-s2`)
  expect(media?.scope).toBe('RUN')
  expect(media?.handles).toEqual([])
  expect(media?.episodeCount).toBe(1)
})

// The window is the whole rule on a day: a day 100 days from every premiere is a disagreement about
// when the run started, and a title ordinal that would have named season 2 does not rescue it.
test('similarMedia refuses a day outside every window, whatever the title says', async () => {
  expect(await askSeason({ showId: SHOW, startDate: '2022-07-12', titles: ['A Show Season 2'], episodeCount: 1 }, showRoutes())).toBeNull()
})

// A `YYYY-01-01` names a year. 2023 holds two seasons, so it names neither; 2021 holds one, and it
// still names nothing here, because Apple vouches for no count and a season whose length is unknown
// cannot be shown not to be a fold. Until 2026-09-05 the 2021 ask answered season 1, and so did a
// second 2021 run of any length: two runs on one season.
test('similarMedia refuses a year-only date, whether the year holds one season or two', async () => {
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01' }, showRoutes())).toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01', titles: ['A Show'], episodeCount: 12 }, showRoutes())).toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2023-01-01', titles: ['A Show: Second Arc'], episodeCount: 8 }, showRoutes())).toBeNull()

  expect(await askSeason({ showId: SHOW, startDate: '2021-01-01' }, showRoutes()), 'one season in the year, and no count to check it by').toBeNull()
  expect(await askSeason({ showId: SHOW, startDate: '2021-01-01', titles: ['A Show'], episodeCount: 12 }, showRoutes())).toBeNull()

  const media = await askSeason({ showId: SHOW, startDate: '2021-01-11' }, showRoutes())
  expect(media?.uri, 'the control: the same season by a day inside its window').toBe(`appletv:${SHOW}-s1`)
})

test('similarMedia is null for a movie, a missing show and no evidence, and yields exactly once', async () => {
  expect(await askSeason({ showId: 'umc.cmc.film', startDate: '2020-06-01' }, movieRoutes())).toBeNull()
  expect(await askSeason({ showId: 'umc.cmc.gone', startDate: '2023-04-10' }, {
    [url('/shows/umc.cmc.gone')]: { code: 404 },
    [url('/movies/umc.cmc.gone')]: { code: 404 },
  })).toBeNull()
  expect(await askSeason({ showId: SHOW }, showRoutes())).toBeNull()

  for (const input of [{ showId: SHOW, startDate: '2023-04-10' }, { showId: SHOW }]) {
    const iterator = subscriptions.similarMedia.subscribe(undefined, { input }, ctxFor(showRoutes()))
    expect((await iterator.next()).done).toBe(false)
    expect((await iterator.next()).done).toBe(true)
  }
})
