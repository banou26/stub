// This source's media id is an IMDb id, which is the one origin worker/store/db.ts exempts outright
// because IMDb models no seasons at all. So the media is SHOW level by construction.
//
// Every media in this store is one run, so `episodeNumber` is within-season. `db.ts` hangs a
// HAS_EPISODE edge off this uri for each episode and `Media.episodes` groups the union by
// episodeNumber ALONE, so the row count becomes the LONGEST season and whatever else the cluster holds
// shares rows with a season nobody asked for. Measured live 2026-08-31 through the same mechanism:
// 24 rows on a 14 episode season page.
//
// The fixtures were recorded signed out from IMDb's own GraphQL on 2026-10-07, with no key, and trimmed.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { resolvers, name, originUrl } from '../../../../src/sources/omdb/extractor'

const GRAPHQL = 'https://caching.graphql.imdb.com/'

type Row = { uri?: string, scope?: string, categories: string[], averageScore?: number, startDate?: string, titles: { title: string }[], handles: { node: { uri: string, scope?: string } }[], episodes?: { uri: string, seasonNumber?: number, episodeNumber?: number, releaseDate?: string }[], episodeCount?: number }
type Sent = { url: string, method?: string, headers: Record<string, string>, body: { query: string, variables: Record<string, string> } }

const fixture = (file: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${file}.json`, import.meta.url), 'utf8'))
const BY_ID: Record<string, string> = { tt22248376: 'series-frieren', tt7366338: 'miniseries-chernobyl', tt1375666: 'film-inception' }

const recorded = (sent: Sent[]) => ({
  fetch: async (url: string, init: { method?: string, headers?: Record<string, string>, body: string }) => {
    const body = JSON.parse(init.body) as Sent['body']
    sent.push({ url, method: init.method, headers: init.headers ?? {}, body })
    if (url !== GRAPHQL) throw new Error(`fixture has no route for ${url}`)
    const file = body.variables.q === 'frieren' ? 'search-frieren' : BY_ID[body.variables.id ?? '']
    return { json: async () => (file ? fixture(file) : { data: { title: null } }) }
  },
}) as never

const mediaFor = async (id: string, sent: Sent[] = []) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `omdb:${id}` } }, recorded(sent)).next()
  return value?.media as Row | null
}

const searchFor = async (search: string, sent: Sent[] = []) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search } }, recorded(sent)).next()
  return value?.mediaPage?.nodes as Row[]
}

test('every read is one POST to IMDb\'s own GraphQL with the web app\'s client name and no key', async () => {
  const sent: Sent[] = []
  await mediaFor('tt22248376', sent)
  await searchFor('frieren', sent)

  expect(sent).toHaveLength(2)
  for (const request of sent) {
    expect(request.method).toBe('POST')
    expect(request.headers['x-imdb-client-name']).toBe('imdb-web-next-localized')
    expect(request.url).not.toContain('apikey')
  }
  expect(sent[0]!.body.variables).toEqual({ id: 'tt22248376' })
  expect(sent[1]!.body.variables).toEqual({ q: 'frieren' })
})

test('a recorded series reads its title, rating, day and poster', async () => {
  const media = await mediaFor('tt22248376')

  expect(media!.uri).toBe('omdb:tt22248376')
  expect(media!.titles.map(title => title.title)).toEqual(["Frieren: Beyond Journey's End"])
  expect(media!.averageScore).toBe(89)
  expect(media!.startDate).toBe('2023-09-29')
  expect(media!.categories).toEqual(['SERIES'])
})

// The guard. Three seasons flattened into one list is not this run's episode list, it is three runs'.
test('a series with several seasons contributes NO episode list', async () => {
  const media = await mediaFor('tt22248376')

  expect(fixture('series-frieren').data.title.episodes.seasons, 'the fixture spans seasons, or this proves nothing').toHaveLength(3)
  expect(media!.episodes ?? []).toEqual([])
  expect(media!.episodeCount).toBeUndefined()
})

// The control, and the reason this is a check on the season count rather than a blanket refusal: one
// season is one run, so its list is honest and is kept.
test('a single-season series keeps its episodes, being one run', async () => {
  const media = await mediaFor('tt7366338')

  expect(media!.episodes!.map(episode => `${episode.seasonNumber}x${episode.episodeNumber}`)).toEqual(['1x1', '1x2', '1x3'])
  expect(media!.episodeCount).toBe(3)
  expect(media!.episodes![0]!.uri).toBe('omdb:tt8162428')
  expect(media!.episodes![0]!.releaseDate).toBe('2019-05-06')
})

test('a film gets its single synthetic episode', async () => {
  const media = await mediaFor('tt1375666')

  expect(media!.categories).toEqual(['MOVIE'])
  expect(media!.episodes).toHaveLength(1)
  expect(media!.episodeCount).toBe(1)
})

// Scope. The row is keyed by an IMDb id, and IMDb models no seasons, so a series row is the show and
// its imdb handle is the show's id: both CONTAINER. A film's imdb id names the film: both RUN.
test('a series row and its imdb handle are scoped CONTAINER, a single-season one too', async () => {
  for (const id of ['tt22248376', 'tt7366338']) {
    const media = await mediaFor(id)
    expect(media!.scope, id).toBe('CONTAINER')
    expect(media!.handles.map(handle => handle.node.uri)).toEqual([`imdb:${id}`])
    expect(media!.handles[0]!.node.scope, id).toBe('CONTAINER')
  }
})

test('a film row and its imdb handle are scoped RUN', async () => {
  const media = await mediaFor('tt1375666')

  expect(media!.scope).toBe('RUN')
  expect(media!.handles.map(handle => handle.node.uri)).toEqual(['imdb:tt1375666'])
  expect(media!.handles[0]!.node.scope).toBe('RUN')
})

test('an id IMDb names no title for is no media', async () => {
  expect(await mediaFor('tt0000000')).toBeNull()
})

// The search path reads each hit's type and mints through the same normalizer.
test('search rows follow their type, a TV movie being a film', async () => {
  const rows = await searchFor('frieren')
  const byId = Object.fromEntries(rows.map(row => [row.uri, row]))

  expect(rows.map(row => row.uri)).toEqual(['omdb:tt22248376', 'omdb:tt31076325', 'omdb:tt0056514', 'omdb:tt34754926'])
  expect(byId['omdb:tt22248376']!.scope).toBe('CONTAINER')
  expect(byId['omdb:tt31076325']!.scope).toBe('RUN')
  expect(byId['omdb:tt31076325']!.handles[0]!.node.scope).toBe('RUN')
  expect(byId['omdb:tt34754926']!.scope, 'a miniseries is a series').toBe('CONTAINER')
})

test('a hit that is no film or series, an episode or a game, is no row', async () => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const ctx = {
    fetch: async () => ({ json: async () => ({ data: { mainSearch: { edges: [
      { node: { entity: { id: 'tt1', titleType: { id: 'tvEpisode' }, titleText: { text: 'An episode' } } } },
      { node: { entity: { id: 'tt2', titleType: { id: 'videoGame' }, titleText: { text: 'A game' } } } },
      { node: { entity: { id: 'tt3', titleType: { id: 'movie' }, titleText: { text: 'A film' } } } },
    ] } } }) }),
  } as never
  const { value } = await subscribe(undefined, { input: { search: 'x' } }, ctx).next()

  expect((value.mediaPage.nodes as Row[]).map(row => row.uri)).toEqual(['omdb:tt3'])
})

test('the source names IMDb, whose data it reads', () => {
  expect(name).toBe('IMDb')
  expect(originUrl).toBe('https://www.imdb.com')
})
