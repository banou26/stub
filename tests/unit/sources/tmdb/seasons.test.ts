// TMDB's show and season-list pages on 2026-10-12, cut to the lines this source reads. The show page
// links only its latest season (Squid Game's links season 3 alone), and the season list links every
// season, under a slug for a show with an English title (`/tv/1396-breaking-bad/season/5`).
import { readFileSync } from 'node:fs'
import { print } from 'graphql'
import { expect, test } from 'vite-plus/test'

import { GetMediaDetailsDocument } from '../../../../src/generated/graphql'
import { resolvers } from '../../../../src/sources/tmdb/extractor'
import { payloads, providerServer } from '../../worker/yoga-client'

const SHOWS: Record<string, string> = { 93405: 'squid-game', 1396: 'breaking-bad' }

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')

const CARD = { scope: 'CONTAINER', titles: [{ title: 'Squid Game' }] }

const context = (known: unknown, paths: string[] = []) => ({
  findAggregatedMedia: async () => known,
  listenForMediaChanges: async function* () {},
  fetch: async (url: string) => {
    paths.push(url.replace('https://www.themoviedb.org', ''))
    const [, id, page] = url.match(/^https:\/\/www\.themoviedb\.org\/tv\/(\d+)(\/seasons)?\?language=en-US$/) ?? []
    // a season's own page answers one episode: its episodes are not what this pins
    const body = id ? fixture(`${page ? 'seasons' : 'show'}-${SHOWS[id]}`)
      : /\/season\/\d+\?/.test(url) ? '<div class="card" data-episode-number="1"><h3><a href="#">One</a></h3></div>'
      : ''
    return { ok: true, status: 200, text: async () => body }
  },
})

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
  expect(await ask('tmdb:93405', { scope: 'RUN', titles: [{ title: 'Squid Game' }] })).toBeNull()
})
