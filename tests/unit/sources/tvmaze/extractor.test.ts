// A tvmaze id is a SHOW id: '52279' is every season of Mushoku Tensei at once, and it was fuzzy merged
// into season 1's cluster on the live site while season 3 asserted sameness through it. Only the
// '-s<n>' form names one run. So the bare row, the search row and the show's imdb handle all go out
// scoped CONTAINER, and the store keeps them out of every run's identity space.
//
// Which season a media or a `similarMedia` caller means is decided by the shared picker over what the
// embedded episode list says about every season: its size, its earliest airdate, its episode titles.
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/tvmaze/extractor'

const API = 'https://api.tvmaze.com'

// season 1 aired 2021-01-01 and 02, season 2 2022-01-01 to 03, season 3 2023-01-01
const episode = (season: number, number: number) => ({ id: season * 100 + number, name: `S${season}E${number}`, season, number, airdate: `20${20 + season}-01-${String(number).padStart(2, '0')}` })

const SHOW = {
  id: 52279,
  url: 'https://www.tvmaze.com/shows/52279/mushoku-tensei-jobless-reincarnation',
  name: 'Mushoku Tensei: Jobless Reincarnation',
  premiered: '2021-01-11',
  externals: { imdb: 'tt13303712' },
  rating: { average: 7.7 },
  _embedded: { episodes: [episode(1, 1), episode(1, 2), episode(2, 1), episode(2, 2), episode(2, 3), episode(3, 1)] },
}

// a show tvmaze lists with NO episodes yet, so no season can be named for it
const EMPTY_SHOW = { id: 99, name: 'Announced Show', premiered: null, externals: { imdb: null }, _embedded: { episodes: [] } }

// One season carrying each shape tvmaze publishes: an `airdate` naming a DAY, an `airstamp` naming an
// INSTANT beside it, and an episode with neither. The two shapes render differently on purpose
// (utils/release-date.ts formats a bare YYYY-MM-DD in UTC and a timestamp where the viewer is), so the
// shape tvmaze used is the shape that has to come out.
const DATED_SHOW = {
  id: 77,
  name: 'Dated Show',
  premiered: '2021-01-11',
  externals: { imdb: null },
  _embedded: {
    episodes: [
      { id: 771, name: 'a day', season: 1, number: 1, airdate: '2021-01-11' },
      { id: 772, name: 'a day and an instant', season: 1, number: 2, airdate: '2021-01-18', airstamp: '2021-01-18T15:30:00+09:00' },
      { id: 773, name: 'no date at all', season: 1, number: 3, airdate: null },
    ],
  },
}

// misses are COLLECTED rather than thrown: `api` swallows a rejection with `.catch(() => undefined)`,
// so a drifted fixture would return no media and fail on a line that says nothing about the fixture.
const context = (misses: string[], known?: unknown) => ({
  key: () => undefined,
  fetch: async (url: string) => {
    if (url.startsWith(`${API}/shows/52279?embed=episodes`)) return { ok: true, status: 200, json: async () => SHOW }
    if (url.startsWith(`${API}/shows/99?embed=episodes`)) return { ok: true, status: 200, json: async () => EMPTY_SHOW }
    if (url.startsWith(`${API}/shows/77?embed=episodes`)) return { ok: true, status: 200, json: async () => DATED_SHOW }
    if (url.startsWith(`${API}/search/shows?q=`)) return { ok: true, status: 200, json: async () => [{ show: SHOW }] }
    misses.push(url)
    return { ok: false, status: 404, json: async () => ({}) }
  },
  // what the aggregated media already knows, if anything; the listener ends at once so nothing waits
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
}) as never

type Row = { uri: string, scope?: string, episodes: unknown[], handles: { relation: string, node: { uri: string, scope?: string } }[] }

const mediaOrNull = async (uri: string, known?: unknown): Promise<Row | null> => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(misses, known)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  return value?.media ?? null
}

const mediaFor = async (uri: string, known?: unknown): Promise<Row> => {
  const media = await mediaOrNull(uri, known)
  expect(media, 'the media itself must exist for its scope to mean anything').not.toBeNull()
  return media!
}

const searchRows = async (): Promise<Row[]> => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'mushoku' } }, context(misses)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  return value.mediaPage.nodes
}

type Ask = { showId: string, startDate?: string, titles?: string[], episodeCount?: number, episodeTitles?: string[] }

const askSeason = async (input: Ask): Promise<Row | null> => {
  const misses: string[] = []
  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  const { value } = await subscribe(undefined, { input }, context(misses)).next()
  expect(misses, 'the fixture has drifted: these urls had no route').toEqual([])
  return value?.similarMedia ?? null
}

test('a season-scoped media is a RUN', async () => {
  const media = await mediaFor('tvmaze:52279-s3')

  expect(media.uri).toBe('tvmaze:52279-s3')
  expect(media.scope).toBe('RUN')
})

test('the imdb handle is the SHOW\'s id, so it is a CONTAINER even on a run', async () => {
  const media = await mediaFor('tvmaze:52279-s3')

  const imdb = media.handles.find(handle => handle.node.uri === 'imdb:tt13303712')
  expect(imdb, 'the fixture carries an imdb external, so the handle must be minted').toBeDefined()
  expect(imdb!.node.scope).toBe('CONTAINER')
})

test('a search row carries the bare show id and is a CONTAINER', async () => {
  const rows = await searchRows()

  expect(rows.map(row => row.uri)).toEqual(['tvmaze:52279'])
  expect(rows[0]!.scope).toBe('CONTAINER')
  expect(rows[0]!.handles.map(handle => handle.node.scope)).toEqual(['CONTAINER'])
})

// tvmaze rates out of ten (7.7) and averageScore is a whole percent, an Int: the unscaled 7.7 failed the
// whole answer with "Int cannot represent non-integer value" on a live "frieren" search (2026-10-10)
test('a rating out of ten becomes a whole percent, on a search row and on a media', async () => {
  const [row] = await searchRows() as (Row & { averageScore?: number })[]
  const media = await mediaFor('tvmaze:52279-s3') as Row & { averageScore?: number }

  expect(row!.averageScore).toBe(77)
  expect(media.averageScore).toBe(77)
})

// getMedia hands back the bare id when the show has no season to pick (no episodes at all), so the
// media path can mint a show-level row too, and it has to say so.
test('a media-path row that falls back to the bare show id is a CONTAINER', async () => {
  const media = await mediaFor('tvmaze:99')

  expect(media.uri).toBe('tvmaze:99')
  expect(media.scope).toBe('CONTAINER')
})

// THE MEDIA PATH. A count with no ordinal is tried against the FIRST season only, and with several
// seasons only an exact count is accepted. The unique-count pick this replaces would have taken
// season 3 for a run of 1 (the only season holding exactly 1), which is the Mushoku coincidence.
test('the media path takes the first season on an exact count, and never another season by unique count', async () => {
  const first = await mediaFor('tvmaze:52279', { titles: [{ title: 'Mushoku Tensei: Jobless Reincarnation' }], episodeCount: 2 })
  expect(first.uri).toBe('tvmaze:52279-s1')

  expect(
    await mediaOrNull('tvmaze:52279', { titles: [{ title: 'Mushoku Tensei: Jobless Reincarnation' }], episodeCount: 1 }),
    'season 3 holds exactly 1 episode, and it is never reached by count'
  ).toBeNull()
})

// SIMILAR MEDIA, rule by rule. The answer is a RUN with the season's own episodes and the show's imdb
// handle only, which is a CONTAINER and derives to an edge.
test('similarMedia answers the season whose premiere is within the window', async () => {
  const media = await askSeason({ showId: '52279', startDate: '2022-01-03' })

  expect(media?.uri).toBe('tvmaze:52279-s2')
  expect(media?.scope).toBe('RUN')
  expect(media?.episodes).toHaveLength(3)
  expect(media?.handles.map(handle => [handle.node.uri, handle.relation, handle.node.scope])).toEqual([['imdb:tt13303712', 'SAME_AS', 'CONTAINER']])
})

test('a day outside every window refuses, whatever the ordinal would have said', async () => {
  expect(await askSeason({ showId: '52279', startDate: '2022-06-15', titles: ['Show Season 2'], episodeCount: 3 })).toBeNull()
})

// Three real episode titles that are season 2's establish it where the count alone would not (the
// first season holds 2, not 3, so the first-season rule refuses).
test('episode titles pick the season', async () => {
  expect(await askSeason({ showId: '52279', episodeCount: 3 }), 'the control: count alone refuses').toBeNull()

  const media = await askSeason({ showId: '52279', episodeCount: 3, episodeTitles: ['S2E1', 'S2E2', 'S2E3'] })
  expect(media?.uri).toBe('tvmaze:52279-s2')
})

// And decisively the other way: titles no season carries refuse the season the ordinal would take.
test('episode titles sharing none with any season refuse, whatever the ordinal says', async () => {
  expect(await askSeason({ showId: '52279', titles: ['Show Season 2'], episodeCount: 3, episodeTitles: ['Alpha', 'Beta', 'Gamma'] })).toBeNull()
})

test('an ordinal the titles agree on picks its season when the count fits', async () => {
  const media = await askSeason({ showId: '52279', titles: ['Show Season 2'], episodeCount: 3 })

  expect(media?.uri).toBe('tvmaze:52279-s2')
})

// Season 2 holds 3 against a caller's 2: a season holding more episodes than the run holds other runs
// too. The year (2022, season 2 alone) would otherwise have named it.
test('a fold is refused', async () => {
  expect(await askSeason({ showId: '52279', startDate: '2022-01-01', titles: ['Show Season 2'], episodeCount: 2 })).toBeNull()
})

test('the one season dated our year answers a year-only date with a count; a count with no ordinal takes the first season only', async () => {
  expect((await askSeason({ showId: '52279', startDate: '2023-01-01', episodeCount: 1 }))?.uri).toBe('tvmaze:52279-s3')
  expect(await askSeason({ showId: '52279', startDate: '2023-01-01' }), 'a year with no count cannot show season 3 is not a fold').toBeNull()

  expect((await askSeason({ showId: '52279', titles: ['Mushoku Tensei'], episodeCount: 2 }))?.uri).toBe('tvmaze:52279-s1')
  expect(await askSeason({ showId: '52279', titles: ['Mushoku Tensei'], episodeCount: 1 }), 'never season 3 by count').toBeNull()
})

// THE EPISODE DATE. tvmaze fetched `airdate` and dropped it, so this source contributed nothing to
// the date alignment `store/consensus.ts` pairs episodes by. Both shapes go out as themselves: the day
// stays a day, and the instant is normalised to ISO rather than truncated to the day it falls on,
// which is not the same day in every zone (15:30 on the 18th in Tokyo is 06:30 on the 18th in UTC).
test('an episode carries the date tvmaze published, a day as a day and an instant as an instant', async () => {
  const media = await mediaFor('tvmaze:77')
  const dates = (media.episodes as { releaseDate?: string }[]).map(episode => episode.releaseDate)

  expect(dates).toEqual(['2021-01-11', '2021-01-18T06:30:00.000Z', undefined])
})

test('an episode tvmaze has no date for carries none', async () => {
  const media = await mediaFor('tvmaze:77')
  const undated = (media.episodes as { releaseDate?: string }[])[2]

  expect(undated!.releaseDate, 'a missing date is left missing, never invented').toBeUndefined()
})

// THE NO-COUNT SITE. `aggregateMedia` always emits `episodes: []`, so reading a count off that list
// turned "no count" into ZERO, and zero vetoes every candidate through `foldVetoed` (`theirs > 0` is
// true of every season), so every season of every show was refused and the refusal looked exactly like
// tvmaze having nothing to say. Absent and zero are two different states here (01 edge cases, case 23).
const AGGREGATE = { titles: [{ title: 'Mushoku Tensei: Jobless Reincarnation' }], startDate: '2022-01-03', episodes: [] }

test('an aggregated media with no count asks with no count rather than with zero', async () => {
  const media = await mediaFor('tvmaze:52279', { ...AGGREGATE, episodeCount: null })

  expect(media.uri).toBe('tvmaze:52279-s2')
})

// The control, and the reason this is not "stop reading episodeCount": a count the aggregate really
// declares still vetoes a season holding more episodes than the run.
test('a count the aggregate really declares is still read', async () => {
  expect(
    await mediaOrNull('tvmaze:52279', { ...AGGREGATE, episodeCount: 2 }),
    'season 2 holds 3 against a run of 2, which is a fold'
  ).toBeNull()
})

test('similarMedia is null for a show with no episodes and an unknown show, and yields exactly once', async () => {
  expect(await askSeason({ showId: '99', startDate: '2022-01-03', titles: ['Announced Show'], episodeCount: 12 })).toBeNull()

  const subscribe = (resolvers.Subscription as any).similarMedia.subscribe
  const unknown = subscribe(undefined, { input: { showId: '404', startDate: '2022-01-03' } }, context([]))
  expect((await unknown.next()).value?.similarMedia ?? null).toBeNull()
  expect((await unknown.next()).done).toBe(true)

  const answered = subscribe(undefined, { input: { showId: '52279', startDate: '2022-01-03' } }, context([]))
  expect((await answered.next()).done).toBe(false)
  expect((await answered.next()).done).toBe(true)
})
