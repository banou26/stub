// Recorded signed out on 2026-10-07, with no key, trimmed: thetvdb.com's own search for "frieren" among
// series, and the same search asked for series 424536 by id.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { resolvers, origin } from '../../../../src/sources/tvdb/extractor'
import { makeMedia } from '../../../../src/sources/utils'

const SEARCH = 'https://api4.thetvdb.com/web/search/queries'

type Row = { uri?: string, scope?: string, url?: string, startDate?: string, titles: { language: string, title: string }[], handles: { node: { uri: string, scope?: string } }[], episodes?: unknown[] }
type Sent = { url: string, method?: string, headers: Record<string, string>, body: { requests: { indexName: string, params: { query: string, filters: string, hitsPerPage: number } }[] } }

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))

const recorded = (sent: Sent[]) => ({
  fetch: async (url: string, init: { method?: string, headers?: Record<string, string>, body: string }) => {
    const body = JSON.parse(init.body) as Sent['body']
    sent.push({ url, method: init.method, headers: init.headers ?? {}, body })
    if (url !== SEARCH) throw new Error(`fixture has no route for ${url}`)
    const { query, filters } = body.requests[0]!.params
    if (query === 'frieren' && filters === 'type:series') return { json: async () => fixture('search-frieren') }
    if (query === '' && filters === 'type:series AND id:424536') return { json: async () => fixture('series-424536') }
    return { json: async () => ({ results: [{ hits: [] }] }) }
  },
}) as never

const mediaFor = async (uri: string, sent: Sent[] = []) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, recorded(sent)).next()
  return value?.media as Row | null
}

const searchFor = async (search: string, sent: Sent[] = []) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search } }, recorded(sent)).next()
  return value?.mediaPage?.nodes as Row[]
}

test('search asks the site\'s own search for series, with no key and no sign-in', async () => {
  const sent: Sent[] = []
  const rows = await searchFor('frieren', sent)

  expect(rows.map(row => row.uri)).toEqual(['tvdb:391612', 'tvdb:424536', 'tvdb:354458'])
  expect(sent).toHaveLength(1)
  expect(sent[0]!.method).toBe('POST')
  expect(sent[0]!.body.requests[0]!.indexName).toBe('TVDB')
  expect(Object.keys(sent[0]!.headers).map(name => name.toLowerCase())).toEqual(['content-type'])
})

// Movies and series are numbered in separate sequences in the one index, so the id alone is not enough.
test('a media is read by asking the search for that series id, filtered to series', async () => {
  const sent: Sent[] = []
  const media = await mediaFor('tvdb:424536', sent)

  expect(sent.map(request => request.body.requests[0]!.params.filters)).toEqual(['type:series AND id:424536'])
  expect(media!.uri).toBe('tvdb:424536')
  expect(media!.url).toBe('https://thetvdb.com/dereferrer/series/424536')
  expect(media!.startDate).toBe('2023-09-29')
})

test('the English title is tagged en and the original name by the series\' own language', async () => {
  const media = await mediaFor('tvdb:424536')

  expect(media!.titles.map(({ language, title }) => [language, title])).toEqual([
    ['en', "Frieren: Beyond Journey's End"],
    ['jp', '葬送のフリーレン'],
  ])
})

test('an id the site has no series for is no media', async () => {
  expect(await mediaFor('tvdb:1')).toBeNull()
})

// `tvdb:<seriesId>` names the whole series and the imdb id on it is the series' too, so it may not
// enter a run's identity space: the row and the handle both go out CONTAINER.
test('the series row and its imdb handle are scoped CONTAINER, and no tmdb handle is minted', async () => {
  const media = await mediaFor('tvdb:424536')
  const remote = fixture('series-424536').results[0].hits[0].remote_ids as { sourceName: string }[]
  expect(remote.map(id => id.sourceName), 'the fixture carries a tmdb id, or the refusal below proves nothing').toContain('TheMovieDB.com')

  expect(media!.scope).toBe('CONTAINER')
  expect(media!.handles.map(handle => handle.node.uri)).toEqual(['imdb:tt22248376'])
  for (const handle of media!.handles) expect(handle.node.scope, handle.node.uri).toBe('CONTAINER')
})

test('every search hit is scoped CONTAINER', async () => {
  for (const row of await searchFor('frieren')) expect(row.scope, row.uri).toBe('CONTAINER')
})

test('a series names no episode list, the site naming its episodes only in the series\' own language', async () => {
  const media = await mediaFor('tvdb:424536')

  expect(media!.episodes ?? []).toEqual([])
})

// TVDB mints no run at all (it reads series only), so the RUN control is the helper's default: the
// stamp above is this source's, and the assertion would fail without it.
test('the helper defaults to RUN, so CONTAINER is this source saying so', () => {
  expect(makeMedia({ origin, id: '424536' }).scope).toBe('RUN')
})
