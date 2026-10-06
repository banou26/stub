// Watchmode's source rows are provider deep links, and the id used to be read as
// `new URL(webUrl).pathname.split('/').filter(Boolean).at(-1)`: a positional read with no shape test.
// The last path segment is the id for almost none of these hosts.
//
//   watch.amazon.com/detail?gti=<id>     pathname '/detail', so EVERY Amazon title minted `amazon:detail`
//   crunchyroll.com/series/<id>/<slug>   the last segment is the SLUG, shared by every run of the show
//   hulu.com/series/<uuid>               a container uuid, shared by every season
//
// It now reads through justwatch/id.ts's `extractContentId`, which shape tests per host, and then
// `providerContentId`, which refuses crunchyroll outright. This file also has no season concept
// anywhere in it, which is why no season number is passed and the crunchyroll refusal fires.
//
// And every id that survives off a SERIES is minted PART_OF, because a watchmode series record IS the
// show: `nf:80987039` off one names the Netflix title, not this run. That relation is what let the
// source be plugged back in at all, so it is asserted here rather than left implied. A film's
// per-title id is the film's own, and is asserted as such at the bottom.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/watchmode/extractor'

const GATEWAY = 'https://gateway.watchmode.com/trpc'
const SERIES = '03000345'
const FILM = '01000345'

type Edge = { relation: string, node: { uri: string, origin: string, id: string, scope?: string } }

const answer = (json: unknown) => ({ json: async () => ({ result: { data: { json } } }) })
const inputOf = (url: string) => JSON.parse(new URL(url).searchParams.get('input')!).json

const source = (webLink: string) => ({ providerID: 1, name: 'x', type: 'sub', region: 'US', webLink })

const context = (providers: { webLink: string }[]) => ({
  fetch: async (url: string) => {
    if (url.startsWith(`${GATEWAY}/gateway.fetchTitlePageProviders?`)) return answer({ consolidatedProviders: providers })
    throw new Error(`fixture has no route for ${url}`)
  },
}) as never

const mediaFor = async (providers: { webLink: string }[], id = SERIES) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: `watchmode:${id}` } }, context(providers)).next()
  return value?.media as { uri: string, scope: string, categories: string[], handles: Edge[] } | null
}

const edgesFor = async (providers: { webLink: string }[], id?: string) => (await mediaFor(providers, id))?.handles ?? []

// Most assertions here are about WHICH ids get minted, so they read the nodes. The relation is asserted
// on its own, below, because it is what let this source be plugged back in.
const handlesFor = async (providers: { webLink: string }[], id?: string) => (await edgesFor(providers, id)).map(handle => handle.node)

const searchContext = (results: Record<string, unknown>[]) => ({
  fetch: async (url: string) => {
    if (url.startsWith(`${GATEWAY}/gateway.quickSearch?`)) return answer({ results })
    throw new Error(`fixture has no route for ${url}`)
  },
}) as never

const searchRowsFor = async (results: Record<string, unknown>[]) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'a show' } }, searchContext(results)).next()
  return (value?.mediaPage?.nodes ?? []) as { id: string, scope: string, handles: Edge[] }[]
}

test('every handle it mints off a series is PART_OF, never SAME_AS', async () => {
  const edges = await edgesFor([source('https://www.netflix.com/title/80987039')])

  expect(edges.length, 'control: it must mint something, or the assertion below is vacuous').toBeGreaterThan(0)
  expect([...new Set(edges.map(edge => edge.relation))]).toEqual(['PART_OF'])
})

// The weld with the widest blast radius: one handle for every Amazon title Watchmode has ever listed.
test('an amazon deep link yields its gti, never the literal word "detail"', async () => {
  const handles = await handlesFor([
    source('https://watch.amazon.com/detail?gti=amzn1.dv.gti.80d4a3ed-21d5-4ed1-b3f4-054b29da3ec2'),
  ])

  expect(handles.map(handle => handle.uri)).not.toContain('amazon:detail')
  expect(handles.map(handle => handle.id)).toContain('amzn1.dv.gti.80d4a3ed-21d5-4ed1-b3f4-054b29da3ec2')
})

// Two different Amazon titles must not collapse onto one handle, which is what the old read did to
// every single one of them.
test('two different amazon titles do not share a handle', async () => {
  const first = await handlesFor([source('https://watch.amazon.com/detail?gti=amzn1.dv.gti.AAA')])
  const second = await handlesFor([source('https://watch.amazon.com/detail?gti=amzn1.dv.gti.BBB')])

  const shared = first.map(h => h.uri).filter(uri => second.map(h => h.uri).includes(uri) && uri.startsWith('amazon:'))
  expect(shared).toEqual([])
})

// A crunchyroll series url names the show, and on Crunchyroll it names the show's films too. There is
// no season number here to scope it with, so providerContentId refuses it outright.
test('a crunchyroll series link mints nothing, neither the slug nor the series id', async () => {
  const handles = await handlesFor([
    source('https://www.crunchyroll.com/series/GY5P48XEY/demon-slayer-kimetsu-no-yaiba'),
  ])

  expect(handles.map(handle => handle.id)).not.toContain('demon-slayer-kimetsu-no-yaiba')
  expect(handles.filter(handle => handle.origin === 'cr')).toEqual([])
})

// The fallback used to mint the WATCHMODE title id under the provider's origin, asserting an id from
// one space inside another. Netflix ids are integers too, so `nf:345` can name a real, unrelated title.
test('a url with no readable id mints nothing, never the watchmode id', async () => {
  const handles = await handlesFor([source('https://www.netflix.com/browse')])

  expect(handles.map(handle => handle.uri)).not.toContain(`nf:${SERIES}`)
  expect(handles.filter(handle => handle.origin === 'nf')).toEqual([])
})

// tmdb, and the two cases fail differently, which is why one survives as PART_OF and one does not.
//
// A TV id names the SHOW, so PART_OF is exactly true: this record is part of that. A MOVIE id is in a
// DIFFERENT SEQUENCE that also starts at 1, measured 2026-09-04: themoviedb.org/movie/550 is Fight Club
// and /tv/550 is Till Death Us Do Part. Stub's uri is `tmdb:550` for both, so a PART_OF there would
// point at the wrong ROW, which is not a weaker claim but a wrong one.
test('a tmdb tv id is kept as PART_OF, and a tmdb movie id is refused outright', async () => {
  const [series] = await searchRowsFor([{ combinedID: SERIES, name: 'A Show', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'tv' }])
  const tmdbEdge = series!.handles.find(edge => edge.node.origin === 'tmdb')
  expect(tmdbEdge?.node.id).toBe('550')
  expect(tmdbEdge?.relation).toBe('PART_OF')

  const [film] = await searchRowsFor([{ combinedID: FILM, name: 'A Film', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'movie' }])
  expect(film!.handles.filter(handle => handle.node.origin === 'tmdb')).toEqual([])
})

// The control. imdb survives because worker/store/db.ts declines to LINK a show-level origin, so it is
// carried without being asserted, and a netflix title id reads correctly off its own url shape. A run
// where these vanish too has broken the source rather than fixed the weld.
test('imdb and a readable netflix id are still minted', async () => {
  const [row] = await searchRowsFor([{ combinedID: SERIES, name: 'A Show', imdbId: 'tt1234567' }])
  expect(row!.handles.map(handle => handle.node.uri)).toEqual(['imdb:tt1234567'])

  const handles = await handlesFor([source('https://www.netflix.com/title/80987039')])
  expect(handles.map(handle => handle.uri)).toContain('nf:80987039')
})

// The scope stamp. Watchmode has no season concept, so a series record IS the show and its row is a
// CONTAINER: one id for every run. A film is its own single run. The id's prefix says which.
test('a series detail row is a CONTAINER and a film detail row is a RUN', async () => {
  const series = await mediaFor([])
  expect(series?.scope, 'one watchmode id for every run of the show').toBe('CONTAINER')
  expect(series?.categories).toEqual(['SERIES'])

  const film = await mediaFor([], FILM)
  expect(film?.scope, 'control: a film is one run').toBe('RUN')
  expect(film?.categories).toEqual(['MOVIE'])
})

test('a series search row is a CONTAINER and a film search row is a RUN', async () => {
  const rows = await searchRowsFor([
    { combinedID: SERIES, name: 'A Show', imdbId: 'tt1111111' },
    { combinedID: FILM, name: 'A Film', imdbId: 'tt2222222' },
  ])
  const byId = Object.fromEntries(rows.map(row => [row.id, row]))
  expect(byId[SERIES]?.scope).toBe('CONTAINER')
  expect(byId[FILM]?.scope, 'control: a film is one run').toBe('RUN')
  // the imdb handle on a search row also arrives stamped, by partOf
  expect(byId[FILM]?.handles.map(handle => handle.node.scope)).toEqual(['CONTAINER'])
})

test('every handle node it mints arrives scoped CONTAINER', async () => {
  const [row] = await searchRowsFor([{ combinedID: SERIES, name: 'A Show', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'tv' }])
  const edges = [...row!.handles, ...await edgesFor([source('https://www.netflix.com/title/80987039')])]

  expect(edges.map(edge => edge.node.origin).sort()).toEqual(['imdb', 'nf', 'tmdb'])
  expect([...new Set(edges.map(edge => edge.node.scope))]).toEqual(['CONTAINER'])
})

// A film's Netflix id IS the film, the same per-title allowlist kitsu measured (nf /title/, nf /watch/).
// Minted PART_OF it arrived stamped CONTAINER, the flip is sticky in the store, and a film unogs and
// justwatch mint under that exact id as its own run lost its Netflix identity for every later
// claimant: the film's cluster sat in two spaces at once.
test('a film\'s netflix title id is SAME_AS and a RUN, while a series keeps PART_OF', async () => {
  const film = await edgesFor([source('https://www.netflix.com/title/70000022')], FILM)
  const netflix = film.find(edge => edge.node.origin === 'nf')
  expect(netflix?.relation).toBe('SAME_AS')
  expect(netflix?.node.scope).toBe('RUN')

  // and not for a segment nobody measured as per-title: a hulu /movie/ uuid stays a link
  const hulu = await edgesFor([source('https://www.hulu.com/movie/b7f3f6d2-1c2e-4f3a-9a1b-2c3d4e5f6a7b')], FILM)
  expect(hulu.find(edge => edge.node.origin === 'hulu')?.relation).toBe('PART_OF')

  const series = await edgesFor([source('https://www.netflix.com/title/70000022')])
  expect(series.find(edge => edge.node.origin === 'nf')?.relation, 'control: a series id names the show').toBe('PART_OF')
})

// Recorded signed out on 2026-10-07 with no key, trimmed: the gateway www.watchmode.com's own client
// calls, for the quick searches "frieren" and "inception" and the providers of each first hit.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))

const recorded = (sent: string[]) => ({
  fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
    sent.push(url)
    expect(init?.headers, 'no key, no sign-in').toBeUndefined()
    const procedure = new URL(url).pathname.split('/').at(-1)
    const input = inputOf(url)
    const name =
      procedure === 'gateway.quickSearch' ? `quick-search-${input.q}`
      : procedure === 'gateway.fetchTitlePageProviders' ? `providers-${{ '03195245': 'frieren', '01182444': 'inception' }[input.combinedTitleID as string]}`
      : undefined
    return { json: async () => fixture(name!) }
  },
}) as never

test('search asks the site\'s quick search and mints each hit under its combined id', async () => {
  const sent: string[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'inception' } }, recorded(sent)).next()
  const rows = value.mediaPage.nodes as { uri: string, startDate?: string, covers: { url: string }[], titles: { title: string }[] }[]

  expect(sent.map(url => new URL(url).pathname)).toEqual(['/trpc/gateway.quickSearch'])
  expect(inputOf(sent[0]!)).toEqual({ q: 'inception', type: 1 })
  expect(rows.map(row => row.uri)).toEqual(['watchmode:01182444', 'watchmode:01670721', 'watchmode:01863076'])
  expect(rows[0]!.titles.map(title => title.title)).toEqual(['Inception'])
  expect(rows[0]!.startDate).toBe('2010-01-01')
  expect(rows[0]!.covers.map(cover => cover.url)).toEqual(['https://cdn.watchmode.com/posters/01182444_poster_w185.jpg'])
  expect(rows[2]!.covers, 'a title with no poster names blank.gif, which is no cover').toEqual([])
})

test('a recorded title\'s links come from its title page providers, every region\'s', async () => {
  const sent: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'watchmode:03195245' } }, recorded(sent)).next()
  const media = value.media as { uri: string, scope: string, handles: Edge[] }

  expect(inputOf(sent[0]!)).toEqual({ combinedTitleID: '03195245' })
  expect(media.uri).toBe('watchmode:03195245')
  expect(media.scope).toBe('CONTAINER')
  const origins = [...new Set(media.handles.map(handle => handle.node.origin))].sort()
  expect(origins).toEqual(expect.arrayContaining(['amazon', 'hulu', 'nf']))
  expect([...new Set(media.handles.map(handle => handle.relation))]).toEqual(['PART_OF'])
})

test('a recorded film is one run with its single episode', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'watchmode:01182444' } }, recorded([])).next()
  const media = value.media as { scope: string, episodes: unknown[], handles: Edge[] }

  expect(media.scope).toBe('RUN')
  expect(media.episodes).toHaveLength(1)
  expect(media.handles.find(handle => handle.node.uri === 'nf:70131314')?.relation).toBe('SAME_AS')
})
