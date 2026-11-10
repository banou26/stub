// Recorded signed out on 2026-10-07, with no key, trimmed: thetvdb.com's own search for "frieren" among
// series, and the same search asked for series 424536 by id. series-391612 is Frieden (Labyrinth of Peace), the first
// hit of the same search on 2026-11-10, trimmed to what the extractor reads, with its titles and overviews in 7 languages.
// series-81189 is Breaking Bad, asked by id on 2026-11-10, trimmed the same way to its English, French, both Portuguese
// and Chinese entries, the long overviews to their first sentence.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers, origin } from '../../../../src/sources/tvdb/extractor'
import { makeMedia } from '../../../../src/sources/utils'

const SEARCH = 'https://api4.thetvdb.com/web/search/queries'

type Row = { uri?: string, scope?: string, url?: string, startDate?: string, titles: { language: string, title: string }[], descriptions: { language: string, description: string }[], handles: { node: { uri: string, scope?: string } }[], episodes?: unknown[] }
type Sent = { url: string, method?: string, headers: Record<string, string>, body: { requests: { indexName: string, params: { query: string, filters: string, hitsPerPage: number } }[] } }

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))

const recorded = (sent: Sent[], language?: string) => ({
  language,
  fetch: async (url: string, init: { method?: string, headers?: Record<string, string>, body: string }) => {
    const body = JSON.parse(init.body) as Sent['body']
    sent.push({ url, method: init.method, headers: init.headers ?? {}, body })
    if (url !== SEARCH) throw new Error(`fixture has no route for ${url}`)
    const { query, filters } = body.requests[0]!.params
    if (query === 'frieren' && filters === 'type:series') return { json: async () => fixture('search-frieren') }
    if (query === '' && filters === 'type:series AND id:424536') return { json: async () => fixture('series-424536') }
    if (query === '' && filters === 'type:series AND id:391612') return { json: async () => fixture('series-391612') }
    if (query === '' && filters === 'type:series AND id:81189') return { json: async () => fixture('series-81189') }
    return { json: async () => ({ results: [{ hits: [] }] }) }
  },
}) as never

const mediaFor = async (uri: string, sent: Sent[] = [], language?: string) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, recorded(sent, language)).next()
  return value?.media as Row | null
}

const searchFor = async (search: string, sent: Sent[] = [], language?: string) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search } }, recorded(sent, language)).next()
  return value?.mediaPage?.nodes as Row[]
}

// a filter the index stopped honouring answers some other series, which must not stand in for this one
test('a search that answers another series than the one asked is no media', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const ignoresFilter = { fetch: async () => ({ json: async () => fixture('search-frieren') }) } as never
  const { value } = await subscribe(undefined, { input: { uri: 'tvdb:1' } }, ignoresFilter).next()

  expect(fixture('search-frieren').results[0].hits.length, 'control: the answer carries series').toBeGreaterThan(0)
  expect(value?.media).toBeNull()
})

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

// Mutation: return `media` from `withTranslation` as it came, and a French viewer's page stays English.
test('a French viewer gets the series\' French title and overview beside the English, from the answer already read', async () => {
  const sent: Sent[] = []
  const media = await mediaFor('tvdb:391612', sent, 'fr-CA')
  expect(sent).toHaveLength(1)
  expect(media!.titles).toEqual([
    { language: 'en', title: 'Labyrinth of Peace', score: 0.3 },
    { language: 'en', title: 'Frieden', score: 0.3 },
    { language: 'fr', title: 'Le prix de la paix', score: 0.03, class: 'TRANSLATED' },
  ])
  expect(media!.descriptions.map(({ language, description }) => `${language} ${description.slice(0, 22)}`))
    .toEqual(['en Year 1945. The war is ', 'fr Printemps 1945 - enfin'])
})

// Mutation: drop the comparison with the media's own titles in `withTranslation`, and Frieden's German viewer, its
// English viewer and Frieren's Japanese viewer each get a "translation" that is a title the series has already.
test('a title the series has already is no translation: its own name, and the English', async () => {
  const german = await mediaFor('tvdb:391612', [], 'de-CH')
  expect(german!.titles.map(({ title }) => title)).toEqual(['Labyrinth of Peace', 'Frieden'])
  expect(german!.descriptions.map(({ language }) => language), 'its German overview is a synopsis still').toEqual(['en', 'de'])
  const asBefore = await mediaFor('tvdb:391612')
  expect(await mediaFor('tvdb:391612', [], 'en-GB')).toMatchObject({ titles: asBefore!.titles, descriptions: asBefore!.descriptions })
  expect((await mediaFor('tvdb:424536', [], 'ja-JP'))!.titles, 'Frieren\'s native name, no Japanese title before the owner decides')
    .toEqual((await mediaFor('tvdb:424536'))!.titles)
  expect((await mediaFor('tvdb:424536', [], 'de'))!.titles.at(-1), 'the control')
    .toEqual({ language: 'de', title: 'Frieren - Nach dem Ende der Reise', score: 0.03, class: 'TRANSLATED' })
})

// what keeps a search for a German title showing its series, the search page's relevance reading every title
test('a search hit carries its title in the viewer\'s language', async () => {
  const rows = await searchFor('frieren', [], 'de-DE')
  expect(rows.find(row => row.uri === 'tvdb:424536')!.titles.at(-1)).toEqual({ language: 'de', title: 'Frieren - Nach dem Ende der Reise', score: 0.03, class: 'TRANSLATED' })
})

type Texts = Pick<Row, 'titles' | 'descriptions'>
const shown = ({ titles, descriptions }: Texts) => [...titles.map(({ language, title }) => `${language} ${title}`), ...descriptions.map(({ language, description }) => `${language} ${description.slice(0, 12)}`)]

// Mutation: read TheTVDB's keys as Intl.Locale does, and its `pt` and `por` are both `pt`, so Portugal's, listed first,
// answers a Brazilian viewer: "Breaking Bad: Ruptura Total", and "cancro" for "câncer".
test('a Brazilian viewer gets Brazil\'s Portuguese, and Portugal\'s where TheTVDB has no other', async () => {
  expect(shown((await mediaFor('tvdb:81189', [], 'pt-BR'))!), 'its Brazilian title is the English')
    .toEqual(['en Breaking Bad', 'en When Walter ', 'pt-BR O drama "Bre'])
  expect(shown((await mediaFor('tvdb:81189', [], 'pt-PT'))!))
    .toEqual(['en Breaking Bad', 'pt-PT Breaking Bad: Ruptura Total', 'en When Walter ', 'pt-PT Um professor'])
  expect(shown((await mediaFor('tvdb:391612', [], 'pt-BR'))!).filter(text => text.startsWith('pt')))
    .toEqual(['pt-PT Paz', 'pt-PT 1945. A guer'])
})

// Mutation: read `zho` as any other key, and both Chinese viewers get Breaking Bad's Simplified title over its
// Traditional overview.
test('no Chinese, which TheTVDB writes in either script for either reader', async () => {
  const { translations, overviews } = fixture('series-81189').results[0].hits[0]
  expect([translations.zho, overviews.zho.slice(0, 6)], 'the setup: a Simplified title, a Traditional overview').toEqual(['绝命毒师', '《絕命毒師》'])
  const english = shown((await mediaFor('tvdb:81189'))!)
  for (const language of ['zh-Hans', 'zh-TW', 'zh-Hant']) expect(shown((await mediaFor('tvdb:81189', [], language))!), language).toEqual(english)
  expect(shown((await mediaFor('tvdb:81189', [], 'fr-FR'))!).at(-1), 'the control').toBe('fr La vie de Wa')
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

test('the site\'s missing-artwork stand-in is no poster', async () => {
  const hit = (id: number, image_url: string) => ({ id, name: `Series ${id}`, image_url })
  const answer = { results: [{ hits: [
    hit(1, 'https://artworks.thetvdb.com/banners/images/missing/series.jpg'),
    hit(2, 'https://artworks.thetvdb.com/banners/posters/5bd0dd7924433.jpg'),
  ] }] }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'series' } }, { fetch: async () => ({ json: async () => answer }) } as never).next()
  const covers = (value.mediaPage.nodes as { covers?: { url: string }[] }[]).map(row => row.covers?.map(cover => cover.url) ?? [])

  expect(covers).toEqual([[], ['https://artworks.thetvdb.com/banners/posters/5bd0dd7924433.jpg']])
})
