// TMDB's show and season-list pages on 2026-10-12, cut to the lines this source reads. The show page
// links only its latest season (Squid Game's links season 3 alone), and the season list links every
// season with its episode count, under a slug for a show with an English title
// (`/tv/1396-breaking-bad/season/5`).
import { readFileSync } from 'node:fs'
import { print } from 'graphql'
import { expect, test } from 'vite-plus/test'

import { GetMediaDetailsDocument } from '../../../../src/generated/graphql'
import { resolvers } from '../../../../src/sources/tmdb/extractor'
import { payloads, providerServer } from '../../worker/yoga-client'

const SHOWS: Record<string, string> = { 93405: 'squid-game', 1396: 'breaking-bad' }

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')

const CARD = { scope: 'CONTAINER', titles: [{ title: 'Squid Game' }] }

// Squid Game's card from search live on 2026-10-12, its page following to TVmaze's season 1 once that answered
const SEARCH_CARD = 'ag:(imdb:tt10919420,omdb:tt10919420,simkl:1360242,tmdb:93405,trakt:squid-game,tvdb:383275,tvmaze:43687)'

// `known` is what the page reads about the asked uri; a list is read in turn, each later one a change
const context = (known: unknown, paths: string[] = []) => {
  const views = Array.isArray(known) ? [...known] : [known]
  return {
    findAggregatedMedia: async () => views[0],
    listenForMediaChanges: async function* () {
      while (views.length > 1) {
        views.shift()
        yield views[0]
      }
    },
    fetch: async (url: string) => {
      paths.push(url.replace('https://www.themoviedb.org', ''))
      const [, id, page] = url.match(/^https:\/\/www\.themoviedb\.org\/tv\/(\d+)(\/seasons)?\?language=en-US$/) ?? []
      // a season's own page answers one episode: its episodes are not what this pins
      const body = id ? fixture(`${page ? 'seasons' : 'show'}-${SHOWS[id]}`)
        : /\/season\/\d+\?/.test(url) ? '<div class="card" data-episode-number="1"><h3><a href="#">One</a></h3></div>'
        : ''
      return { ok: true, status: 200, text: async () => body }
    },
  }
}

const ask = async (uri: string, known?: unknown) => {
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const { value } = await subscribe(undefined, { input: { uri } }, context(known)).next()
  return value.media
}

test('a show with three seasons lists three, each linking its own run', async () => {
  const media = await ask('tmdb:93405-s2')
  expect(media.uri).toBe('tmdb:93405-s2')
  expect(media.seasons).toEqual([
    { number: 1, uri: 'tmdb:93405-s1' },
    { number: 2, uri: 'tmdb:93405-s2' },
    { number: 3, uri: 'tmdb:93405-s3' },
  ])
})

test('a show listed under a slug lists its seasons too, and not its specials', async () => {
  const media = await ask('tmdb:1396-s1')
  expect(media.seasons.map((season: { uri: string }) => season.uri))
    .toEqual(['tmdb:1396-s1', 'tmdb:1396-s2', 'tmdb:1396-s3', 'tmdb:1396-s4', 'tmdb:1396-s5'])
})

test('the show\'s own card is answered as the show, listing its seasons and naming nothing else', async () => {
  const media = await ask('tmdb:93405', CARD)
  expect(media.uri).toBe('tmdb:93405')
  expect(media.scope).toBe('CONTAINER')
  expect(media.handles).toEqual([])
  expect(media.seasons.map((season: { uri: string }) => season.uri)).toEqual(['tmdb:93405-s1', 'tmdb:93405-s2', 'tmdb:93405-s3'])
})

// The details page's document asks every handle's episodes too, and a bare show id asking them used to
// fetch every season of the show.
test('the details document fetches the asked season\'s page alone, and the show\'s card none', async () => {
  const pagesFor = async (uri: string, known?: unknown) => {
    const paths: string[] = []
    const server = providerServer('tmdb', resolvers, context(known, paths))
    const { results } = await payloads(server, print(GetMediaDetailsDocument), { input: { uri }, descriptionInput: {} }, 1)
    expect(results[0].data?.media?.uri).toBe(uri)
    return paths.filter(path => path.includes('/season/')).map(path => path.replace('?language=en-US', ''))
  }
  expect(await pagesFor('tmdb:93405-s2')).toEqual(['/tv/93405/season/2'])
  expect(await pagesFor('tmdb:93405', CARD)).toEqual([])
})

test('control: a run with nothing to place a season by still gets none', async () => {
  expect(await ask(SEARCH_CARD, { scope: 'RUN', titles: [{ title: 'Squid Game' }] })).toBeNull()
  expect(await ask(SEARCH_CARD, [CARD, { scope: 'RUN', titles: [{ title: 'Squid Game' }] }]), 'after a container view').toBeNull()
})

test('a run is placed by the episode count the season list names, fetching that season\'s page alone', async () => {
  const paths: string[] = []
  const subscribe = (resolvers.Subscription as any).media.subscribe
  const run = { scope: 'RUN', titles: [{ title: 'Squid Game' }], episodeCount: 7 }
  const { value } = await subscribe(undefined, { input: { uri: SEARCH_CARD } }, context(run, paths)).next()
  expect(value.media.uri).toBe('tmdb:93405-s2')
  expect(paths.map(path => path.replace('?language=en-US', ''))).toEqual(['/tv/93405', '/tv/93405/seasons', '/tv/93405/season/2'])
})

test('the show\'s own address is answered as the show, with nothing else to wait for', async () => {
  const media = await ask('tmdb:93405')
  expect(media.uri).toBe('tmdb:93405')
  expect(media.seasons).toHaveLength(3)
})

test('a card naming other sources waits past the show for the run its page follows to', async () => {
  const media = await ask(SEARCH_CARD, [CARD, { scope: 'RUN', titles: [{ title: 'Squid Game Season 2' }] }])
  expect(media.uri).toBe('tmdb:93405-s2')
})

test('a card naming other sources is answered as the show when no run comes', async () => {
  expect((await ask(SEARCH_CARD, CARD)).uri).toBe('tmdb:93405')
})

// JustWatch links a film as `tmdb:movie-<id>`, and this source reads shows only: alone in an address
// the id was fetched as a show's card, `/tv/movie-693134`, a miss on every title view
test('a film\'s link asks TMDB nothing, alone or beside other sources', async () => {
  for (const uri of ['tmdb:movie-693134', 'ag:(jw:1133934,tmdb:movie-693134)']) {
    const paths: string[] = []
    const subscribe = (resolvers.Subscription as any).media.subscribe
    const { value } = await subscribe(undefined, { input: { uri } }, context({ scope: 'RUN', categories: ['MOVIE'] }, paths)).next()
    expect(value.media, uri).toBeNull()
    expect(paths, uri).toEqual([])
  }
})
