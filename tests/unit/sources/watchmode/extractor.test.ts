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
// per-title id is the film's own, and is asserted as such below.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/watchmode/extractor'

const GATEWAY = 'https://gateway.watchmode.com/trpc'
const SERIES = '03000345'
const FILM = '01000345'
// what each fake title's own answer says it is
const FOLDER: Record<string, string> = { [SERIES]: 'tv', [FILM]: 'movie' }

type Edge = { relation: string, node: { uri: string, origin: string, id: string, scope?: string } }

// the site's client batches every call, so the gateway answers an array of one
const answer = (json: unknown) => ({ json: async () => [{ result: { data: { json } } }] })
const inputOf = (url: string) => JSON.parse(new URL(url).searchParams.get('input')!)['0'].json

const source = (webLink: string) => ({ providerID: 1, name: 'x', type: 'sub', region: 'US', webLink })

const context = (providers: { webLink: string }[]) => ({
  fetch: async (url: string) => {
    if (url.startsWith(`${GATEWAY}/gateway.fetchTitleDetails?`)) {
      return answer({ title: { slugTypeFolder: FOLDER[inputOf(url).combinedTitleID], consolidatedProviders: providers } })
    }
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

// Prime Video's ids are per country, and Watchmode lists every region's without saying whose, so its rows
// are left to JustWatch, which asks the viewer's country
test('a Prime Video row mints nothing, on an Amazon site or on primevideo.com', async () => {
  const handles = await handlesFor([
    source('https://watch.amazon.com/detail?gti=amzn1.dv.gti.80d4a3ed-21d5-4ed1-b3f4-054b29da3ec2'),
    source('https://app.primevideo.com/detail?gti=amzn1.dv.gti.9ab600aa-6625-b547-cfc0-190e3ad8a27d'),
    source('https://watch.amazon.de/detail?gti=amzn1.dv.gti.9ab600aa-6625-b547-cfc0-190e3ad8a27d'),
    source('https://www.netflix.com/title/80987039'),
  ])

  expect(handles.map(handle => handle.uri), 'control: the Netflix row still mints').toEqual(['nf:80987039'])
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

// A series record names the whole show, as its imdb id and its tmdb tv id do, so it claims to BE them;
// as PART_OF it was a show hanging off itself, a second card beside the real one. A film links to them.
//
// A tmdb MOVIE id is in a DIFFERENT SEQUENCE that also starts at 1, measured 2026-09-04:
// themoviedb.org/movie/550 is Fight Club and /tv/550 is Till Death Us Do Part. Stub's uri is `tmdb:550`
// for both, so any claim there would point at the wrong ROW.
test('a series claims its imdb and tmdb tv ids as the show, a film links its imdb id, a tmdb movie id is refused', async () => {
  const [series] = await searchRowsFor([{ combinedID: SERIES, slugTypeFolder: 'tv', name: 'A Show', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'tv' }])
  expect(series!.handles.map(edge => [edge.node.uri, edge.relation, edge.node.scope])).toEqual([
    ['imdb:tt1234567', 'SAME_AS', 'CONTAINER'],
    ['tmdb:550', 'SAME_AS', 'CONTAINER'],
  ])

  const [film] = await searchRowsFor([{ combinedID: FILM, slugTypeFolder: 'movie', name: 'A Film', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'movie' }])
  expect(film!.handles.map(edge => [edge.node.uri, edge.relation])).toEqual([['imdb:tt1234567', 'PART_OF']])
})

// The control. imdb is minted and a netflix title id reads correctly off its own url shape. A run where
// these vanish too has broken the source rather than fixed the weld.
test('imdb and a readable netflix id are still minted', async () => {
  const [row] = await searchRowsFor([{ combinedID: SERIES, slugTypeFolder: 'tv', name: 'A Show', imdbId: 'tt1234567' }])
  expect(row!.handles.map(handle => handle.node.uri)).toEqual(['imdb:tt1234567'])

  const handles = await handlesFor([source('https://www.netflix.com/title/80987039')])
  expect(handles.map(handle => handle.uri)).toContain('nf:80987039')
})

// Every region's links ride the gateway's answer, and a regional one puts its locale before the id.
// Read at a fixed index, these minted `nf:title` and `hbo:en`, one id shared by every title carrying
// such a link (Frieren's and Inception's title pages through the relay, 2026-10-07).
test('a regional link mints the title it names, never its locale or a path word', async () => {
  const handles = await handlesFor([
    source('https://www.netflix.com/be-en/title/81726714'),
    source('https://www.netflix.com/in/title/81726714'),
    source('https://www.hbomax.com/it/en/movie/14552c93-d318-4563-a00b-343df7e35d0b'),
    source('https://www.hbomax.com/at/en/movies/inception/14552c93-d318-4563-a00b-343df7e35d0b'),
  ])

  expect(handles.map(handle => handle.uri).sort()).toEqual(['hbo:14552c93-d318-4563-a00b-343df7e35d0b', 'nf:81726714'])
})

// The scope stamp. Watchmode has no season concept, so a series record IS the show and its row is a
// CONTAINER: one id for every run. A film is its own single run. The title's own answer says which.
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
    { combinedID: SERIES, slugTypeFolder: 'tv', name: 'A Show', imdbId: 'tt1111111' },
    { combinedID: FILM, slugTypeFolder: 'movie', name: 'A Film', imdbId: 'tt2222222' },
  ])
  const byId = Object.fromEntries(rows.map(row => [row.id, row]))
  expect(byId[SERIES]?.scope).toBe('CONTAINER')
  expect(byId[FILM]?.scope, 'control: a film is one run').toBe('RUN')
  // the imdb handle on a search row also arrives stamped, by partOf
  expect(byId[FILM]?.handles.map(handle => handle.node.scope)).toEqual(['CONTAINER'])
})

test('every handle node it mints arrives scoped CONTAINER', async () => {
  const [row] = await searchRowsFor([{ combinedID: SERIES, slugTypeFolder: 'tv', name: 'A Show', imdbId: 'tt1234567', tmdbId: 550, tmdbType: 'tv' }])
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

// Recorded signed out with no key, trimmed, from the gateway behind www.watchmode.com: the quick search
// "inception" on 2026-10-07, and on 2026-10-13 the quick searches "breaking bad", "the last of us" and
// "planet earth" and the title details of Frieren, Inception, The Last of Us and Breaking Bad Wolf.
// Each is the one entry of a batched answer, which is the same entry inside an array.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))

const recorded = (sent: string[], headers: Record<string, string>[] = []) => ({
  fetch: async (url: string, init?: { headers?: Record<string, string> }) => {
    sent.push(url)
    headers.push(init?.headers ?? {})
    const procedure = new URL(url).pathname.split('/').at(-1)
    const input = inputOf(url)
    const name =
      procedure === 'gateway.quickSearch' ? `quick-search-${input.q.replaceAll(' ', '-')}`
      : procedure === 'gateway.fetchTitleDetails' ? `title-details-${input.combinedTitleID}`
      : undefined
    return { json: async () => [fixture(name!)] }
  },
}) as never

// the site's client is createTRPCClient over httpBatchLink at this gateway, from www.watchmode.com
test('asks as www.watchmode.com\'s own client does: batched, from its origin, with no key or sign-in', async () => {
  const sent: string[] = []
  const headers: Record<string, string>[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  await subscribe(undefined, { input: { search: 'inception' } }, recorded(sent, headers)).next()

  expect(new URL(sent[0]!).searchParams.get('batch')).toBe('1')
  expect(JSON.parse(new URL(sent[0]!).searchParams.get('input')!)).toEqual({ 0: { json: { q: 'inception', type: 2 } } })
  expect(headers).toEqual([{ origin: 'https://www.watchmode.com' }])
})

test('search asks the site\'s quick search and mints each hit under its combined id', async () => {
  const sent: string[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'inception' } }, recorded(sent)).next()
  const rows = value.mediaPage.nodes as { uri: string, startDate?: string, covers: { url: string }[], titles: { title: string }[] }[]

  expect(sent.map(url => new URL(url).pathname)).toEqual(['/trpc/gateway.quickSearch'])
  expect(inputOf(sent[0]!)).toEqual({ q: 'inception', type: 2 })
  expect(rows.map(row => row.uri)).toEqual(['watchmode:01182444', 'watchmode:01670721', 'watchmode:01863076'])
  expect(rows[0]!.titles.map(title => title.title)).toEqual(['Inception'])
  expect(rows[0]!.startDate).toBe('2010-01-01')
  expect(rows[0]!.covers.map(cover => cover.url)).toEqual(['https://cdn.watchmode.com/posters/01182444_poster_w185.jpg'])
  expect(rows[2]!.covers, 'a title with no poster names blank.gif, which is no cover').toEqual([])
})

// "dune" as the gateway answered it on 2026-10-13 for each `type` it was asked: 1 (titles and people)
// carried four people among fifteen hits, 2 (titles only) fifteen titles.
test('search asks for titles only, so no person comes back as a show', async () => {
  const answers: Record<number, unknown> = { 1: fixture('quick-search-dune-titles-and-people'), 2: fixture('quick-search-dune-titles') }
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const context = { fetch: async (url: string) => ({ json: async () => [answers[inputOf(url).type]] }) } as never
  const { value } = await subscribe(undefined, { input: { search: 'dune' } }, context).next()
  const names = (value.mediaPage.nodes as { titles: { title: string }[] }[]).map(row => row.titles[0]?.title)

  expect(names, 'control: the titles still come back').toContain('Dune: Prophecy')
  for (const person of ['Dune Kossatz', 'Nea Dune', 'Claude Duneton', 'Ashley Dunec']) expect(names).not.toContain(person)
})

test('a recorded title\'s links come from its title page providers, every region\'s but Prime Video\'s', async () => {
  const sent: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'watchmode:03195245' } }, recorded(sent)).next()
  const media = value.media as { uri: string, scope: string, handles: Edge[] }

  expect(inputOf(sent[0]!)).toEqual({ combinedTitleID: '03195245' })
  expect(media.uri).toBe('watchmode:03195245')
  expect(media.scope).toBe('CONTAINER')
  const origins = [...new Set(media.handles.map(handle => handle.node.origin))].sort()
  expect(origins).toEqual(expect.arrayContaining(['hulu', 'nf']))
  expect(origins, 'its watch.amazon.com row is not the viewer\'s to know').not.toContain('amazon')
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

// A Watchmode id's leading digits do not say film or series: The Last of Us (2023, TV) is `01564613`,
// the film Breaking Bad Wolf `04146033`, a short film `02810545`, and a limited series `0554991`.
const searchKinds = async (query: string) => {
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: query } }, recorded([])).next()
  return value.mediaPage.nodes as { id: string, scope: string, categories: string[], handles: Edge[] }[]
}

test('a search hit is a film or a series as its answer says, whatever its id starts with', async () => {
  const rows = [...await searchKinds('the last of us'), ...await searchKinds('breaking bad'), ...await searchKinds('planet earth')]

  expect(Object.fromEntries(rows.map(row => [row.id, row.scope]))).toEqual({
    '01564613': 'CONTAINER', // The Last of Us, the HBO show
    '01402369': 'RUN',
    '02810545': 'RUN',
    '03173903': 'CONTAINER',
    '03203841': 'CONTAINER',
    '04146033': 'RUN',
    '0554991': 'CONTAINER',
    '03317920': 'CONTAINER',
    '01913415': 'RUN',
    '011104498': 'RUN',
    '0540528': 'CONTAINER', // a TV special with a season and an episode, which TMDB files as a movie
  })
  const show = rows.find(row => row.id === '01564613')!
  expect(show.categories).toEqual(['SERIES'])
  expect(show.handles.map(edge => [edge.node.uri, edge.relation])).toEqual([['imdb:tt3581920', 'SAME_AS'], ['tmdb:100088', 'SAME_AS']])
})

test('a title read by its id alone is a film or a series as its own answer says', async () => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const read = async (id: string) => {
    const sent: string[] = []
    const { value } = await subscribe(undefined, { input: { uri: `watchmode:${id}` } }, recorded(sent)).next()
    expect(sent.map(url => new URL(url).pathname)).toEqual(['/trpc/gateway.fetchTitleDetails'])
    const media = value.media as { scope: string, categories: string[], episodes?: unknown[] }
    return [media.scope, media.categories, media.episodes?.length ?? 0]
  }

  expect(await read('01564613'), 'The Last of Us, the show').toEqual(['CONTAINER', ['SERIES'], 0])
  expect(await read('04146033'), 'Breaking Bad Wolf, a film').toEqual(['RUN', ['MOVIE'], 1])
})
