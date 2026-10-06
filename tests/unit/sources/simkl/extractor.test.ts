// Simkl keeps a SEPARATE record per run of an anime, which is what stub wants, and then puts the
// SHOW's tmdb id on every one of them. Measured live: all five Mushoku Tensei runs carry
// `tmdb:94664`. A handle is an identity claim, so minting it says the five runs are one media, and
// `upsertMedia` unions them at insert time. Simkl's own `season` field cannot scope it either: it is
// null on the first runs and repeats `2` across three of them.
//
// A movie record is no better and fails differently. TMDB numbers movies and tv shows in separate
// sequences that both start at 1, measured 2026-09-04: themoviedb.org/movie/550 is Fight Club and
// /tv/550 is Till Death Us Do Part. Stub's uri is `tmdb:550` for both.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vite-plus/test'

import { resolvers } from '../../../../src/sources/simkl/extractor'

const API = 'https://api.simkl.com'

// the id block simkl really publishes on an anime run, trimmed to what buildHandles reads
const IDS = { simkl: 1080329, imdb: 'tt13303712', tmdb: '94664', mal: '39535', anilist: '108465', kitsu: '42323' }

type Row = { uri?: string, scope?: string, handles: { node: { uri: string, origin: string, id: string, scope?: string } }[], episodes?: { releaseDate?: string }[] }

const context = (type: 'tv' | 'anime' | 'movies', ids: Record<string, unknown> = IDS, episodes: readonly object[] = []) => ({
  fetch: async (url: string) => {
    // BEFORE the detail routes: an episodes url starts with `/tv/` and `/anime/` too, so the miss
    // branch below would answer it and the list could never be anything but empty.
    if (url.startsWith(`${API}/anime/episodes/`) || url.startsWith(`${API}/tv/episodes/`)) {
      return { json: async () => episodes }
    }
    const detail = `${API}/${type}/1080329?extended=full`
    if (url === detail) {
      return {
        json: async () => ({
          title: 'Mushoku Tensei: Jobless Reincarnation',
          ids,
          first_aired: '2021-01-11',
        }),
      }
    }
    // every other detail path is a miss, which is how getMedia walks tv -> anime -> movies
    if (url.startsWith(`${API}/tv/`) || url.startsWith(`${API}/anime/`) || url.startsWith(`${API}/movies/`)) {
      return { json: async () => undefined }
    }
    throw new Error(`fixture has no route for ${url}`)
  },
}) as never

const mediaFor = async (type: 'tv' | 'anime' | 'movies', ids?: Record<string, unknown>, episodes?: readonly object[]) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'simkl:1080329' } }, context(type, ids, episodes)).next()
  const media = value?.media as Row | null
  expect(media, 'the media itself must exist').not.toBeNull()
  return media!
}

const handlesFor = async (type: 'anime' | 'movies', ids?: Record<string, unknown>) =>
  // handles are edges now: { node, relation }. These assertions are about WHICH ids get minted, so
  // they read the nodes; the relation each one carries is asserted where it is the point.
  (await mediaFor(type, ids)).handles.map(handle => handle.node)

const handle = (media: Row, origin: string) => {
  const found = media.handles.map(handle => handle.node).find(node => node.origin === origin)
  expect(found, `no ${origin} handle was minted`).toBeDefined()
  return found!
}

test('an anime run does not mint the show-level tmdb id it carries', async () => {
  const handles = await handlesFor('anime')

  expect(handles.map(handle => handle.uri)).not.toContain('tmdb:94664')
  expect(handles.filter(handle => handle.origin === 'tmdb')).toEqual([])
})

// A film's tmdb id is in a different sequence from a series', and stub's uri cannot tell them apart,
// so this one is refused for a reason the anime case does not share. Both refusals are the same line.
test('a movie does not mint its tmdb id either, the sequences being separate', async () => {
  const handles = await handlesFor('movies', { ...IDS, tmdb: '550' })

  expect(handles.map(handle => handle.uri)).not.toContain('tmdb:550')
  expect(handles.filter(handle => handle.origin === 'tmdb')).toEqual([])
})

// The control, and the reason this is a refusal of ONE origin rather than of simkl's id block. Every
// other id simkl publishes is per-run and clusters correctly, so a run where these vanish too has
// broken the source rather than fixed the weld.
test('every other id simkl publishes is still minted', async () => {
  const uris = (await handlesFor('anime')).map(handle => handle.uri)

  expect(uris).toContain('mal:39535')
  expect(uris).toContain('anilist:108465')
  expect(uris).toContain('kitsu:42323')
  expect(uris).toContain('imdb:tt13303712')
})

// Scope, from simkl's own grammar. A tv record is one SHOW with every season under it (the episodes
// endpoint answers with a season field), so the row is a container and the imdb id on it is the
// show's. An anime record is one RUN, which is the reason simkl is worth reading at all: Mushoku
// Tensei is five records here, each with its own mal, anilist and kitsu id, while the imdb id on all
// five is the one show-level tt13303712.
test('a tv record is a show, so its row and imdb handle are scoped CONTAINER', async () => {
  const media = await mediaFor('tv', { simkl: 1080329, imdb: 'tt0903747' })

  expect(media.scope).toBe('CONTAINER')
  expect(handle(media, 'imdb').scope).toBe('CONTAINER')
})

test('an anime record is one run: RUN row, RUN mal/anilist/kitsu, CONTAINER imdb', async () => {
  const media = await mediaFor('anime')

  expect(media.scope).toBe('RUN')
  expect(handle(media, 'mal').scope).toBe('RUN')
  expect(handle(media, 'anilist').scope).toBe('RUN')
  expect(handle(media, 'kitsu').scope).toBe('RUN')
  expect(handle(media, 'imdb').scope).toBe('CONTAINER')
})

// A film is a run and its imdb id names the film itself, so nothing on a movie is a container.
test('a movie is a run and its imdb handle follows it', async () => {
  const media = await mediaFor('movies', { simkl: 1080329, imdb: 'tt0137523' })

  expect(media.scope).toBe('RUN')
  expect(handle(media, 'imdb').scope).toBe('RUN')
})

// THE EPISODE DATE. Simkl fetched `date` and dropped it, so this source contributed nothing to the
// date alignment `store/consensus.ts` pairs episodes by. `date` arrives in either shape and the two
// are not interchangeable: a bare YYYY-MM-DD is rendered as that calendar day in UTC while a timestamp
// is rendered where the viewer is, so a day parsed into an instant shows a day early west of
// Greenwich. Each shape goes out as itself, and an episode simkl dates with nothing gets nothing.
test('an episode carries simkl\'s date, a day as a day and a timestamp as an instant', async () => {
  const media = await mediaFor('anime', IDS, [
    { title: 'E1', season: 1, episode: 1, date: '2021-01-11' },
    { title: 'E2', season: 1, episode: 2, date: '2021-01-18T15:30:00Z' },
    { title: 'E3', season: 1, episode: 3 },
  ])

  expect((media.episodes ?? []).map(episode => episode.releaseDate)).toEqual(['2021-01-11', '2021-01-18T15:30:00.000Z', undefined])
})

test('an episode simkl has no date for carries none', async () => {
  const media = await mediaFor('anime', IDS, [{ title: 'E1', season: 1, episode: 1 }])

  expect((media.episodes ?? [])[0]!.releaseDate, 'a missing date is left missing, never invented').toBeUndefined()
})

// An anime record lists its specials after its episodes, numbered from 1 again and with no season:
// Frieren (1990194) answered 28 episodes and 25 "Magic Episode" specials through the relay on
// 2026-10-07. Read as numbers they took the ids and numbers of episodes 1 to 25, and a 28 episode
// run counted 53.
test('a special is not numbered as an episode of the run, nor counted in it', async () => {
  const media = await mediaFor('anime', IDS, [
    { title: 'The Journey\'s End', episode: 1, type: 'episode', date: '2023-09-29T23:00:00+09:00' },
    { title: 'It Didn\'t Have to Be Magic...', episode: 2, type: 'episode', date: '2023-09-29T23:00:00+09:00' },
    { title: 'Magic Episode 1: Magic to Say What You Are Thinking', episode: 1, type: 'special', date: '2023-10-11T23:00:00+09:00' },
    { title: 'Magic Episode 2: Magic to Just Remove Alcohol from Booze', episode: 2, type: 'special', date: '2023-10-25T23:00:00+09:00' },
  ]) as unknown as { episodeCount?: number, episodes: { uri: string, episodeNumber?: number }[] }

  expect(new Set(media.episodes.map(episode => episode.uri)).size, 'one id per episode').toBe(4)
  expect(media.episodes.map(episode => episode.episodeNumber)).toEqual([1, 2, undefined, undefined])
  expect(media.episodeCount).toBe(2)
})

// Search reads simkl.com's own form, whose rows name their type in their url.
test('search rows are scoped by the type their url names', async () => {
  const hits: Record<string, unknown> = {
    tv: { i1: { id: '1', url: '/tv/1/breaking-bad', titles: { m: 'Breaking Bad' } } },
    anime: { i2: { id: '2', url: '/anime/2/mushoku-tensei', titles: { m: 'Mushoku Tensei' } } },
    movies: { i3: { id: '3', url: '/movies/3/fight-club', titles: { m: 'Fight Club' } } },
  }
  const ctx = {
    fetch: async (url: string, init?: { body?: string }) => {
      if (url !== `${SITE}/ajax/full/search.php`) throw new Error(`fixture has no route for ${url}`)
      return { json: async () => hits[new URLSearchParams(init?.body).get('type')!] }
    },
  } as never
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'x' } }, ctx).next()
  const rows = value?.mediaPage?.nodes as Row[]
  const byId = Object.fromEntries(rows.map(row => [row.uri, row]))

  expect(byId['simkl:1']!.scope).toBe('CONTAINER')
  expect(byId['simkl:2']!.scope).toBe('RUN')
  expect(byId['simkl:3']!.scope).toBe('RUN')
})

// Recorded signed out on 2026-10-07 with no client id, trimmed: simkl.com's search form for "frieren"
// in each type, and api.simkl.com's detail and episodes of anime 1990194.
const SITE = 'https://simkl.com'
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./__fixtures__/${name}.json`, import.meta.url), 'utf8'))
type Sent = { url: string, method?: string, headers: Record<string, string>, body?: string }

const recorded = (sent: Sent[]) => ({
  fetch: async (url: string, init?: { method?: string, headers?: Record<string, string>, body?: string }) => {
    sent.push({ url, method: init?.method, headers: init?.headers ?? {}, body: init?.body })
    const body =
      url === `${SITE}/ajax/full/search.php` ? fixture(`site-search-frieren-${new URLSearchParams(init?.body).get('type')}`)
      : url === `${API}/anime/1990194?extended=full` ? fixture('anime-1990194')
      : url === `${API}/anime/episodes/1990194?extended=full` ? fixture('anime-episodes-1990194')
      : url.startsWith(`${API}/tv/1990194`) || url.startsWith(`${API}/movies/1990194`) ? fixture('wrong-type')
      : undefined
    if (body === undefined) throw new Error(`fixture has no route for ${url}`)
    return { json: async () => body }
  },
}) as never

test('search posts simkl.com\'s own form, with its origin and referer and no client id', async () => {
  const sent: Sent[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  const { value } = await subscribe(undefined, { input: { search: 'frieren' } }, recorded(sent)).next()
  const rows = value.mediaPage.nodes as (Row & { titles: { title: string }[], covers: { url: string }[] })[]

  expect(rows.map(row => row.uri)).toEqual(['simkl:1990194', 'simkl:2595284', 'simkl:3063278', 'simkl:523278'])
  expect(rows[0]!.titles.map(title => title.title)).toEqual(['Sousou no Frieren', "Frieren: Beyond Journey's End"])
  expect(rows[0]!.covers[0]!.url).toBe('https://simkl.in/posters/14/14625673bbdc6b52ea_m.jpg')
  expect(sent.map(request => new URLSearchParams(request.body).get('type')).sort()).toEqual(['anime', 'movies', 'tv'])
  for (const request of sent) {
    expect(request.method).toBe('POST')
    expect(request.headers.origin).toBe(SITE)
    expect(request.headers.referer).toBe(`${SITE}/search/`)
    expect(new URLSearchParams(request.body).get('s')).toBe('frieren')
    expect(Object.keys(request.headers).map(name => name.toLowerCase())).not.toContain('simkl-api-key')
  }
})

// search.min.js posts { s, type, more, sort } through jQuery, which adds X-Requested-With on a
// same-origin request and sends an undefined `more` as `more=`
test('search sends the fields and headers simkl.com\'s own search sends', async () => {
  const sent: Sent[] = []
  const subscribe = (resolvers.Subscription as any).mediaPage.subscribe
  await subscribe(undefined, { input: { search: 'frieren' } }, recorded(sent)).next()

  expect(sent.length, 'control: search posted something').toBeGreaterThan(0)
  for (const request of sent) {
    expect([...new URLSearchParams(request.body).keys()]).toEqual(['s', 'type', 'more', 'sort'])
    expect(request.headers['x-requested-with']).toBe('XMLHttpRequest')
  }
})

test('a recorded anime reads with no client id: its ids, its decoded English title and its episodes', async () => {
  const sent: Sent[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri: 'simkl:1990194' } }, recorded(sent)).next()
  const media = value.media as Row & { titles: { title: string }[] }

  expect(media.uri).toBe('simkl:1990194')
  expect(media.scope).toBe('RUN')
  expect(media.titles.map(title => title.title)).toEqual(['Sousou no Frieren', "Frieren: Beyond Journey's End"])
  expect(media.handles.map(handle => handle.node.uri).sort()).toEqual(['anilist:154587', 'imdb:tt22248376', 'kitsu:46474', 'mal:52991'])
  expect(media.episodes).toHaveLength(3)
  expect(media.episodes![0]!.releaseDate).toBe('2023-09-29T14:00:00.000Z')
  for (const request of sent) expect(Object.keys(request.headers), request.url).toEqual([])
})
