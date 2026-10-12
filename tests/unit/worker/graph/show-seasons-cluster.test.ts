// Squid Game as search found it live on 2026-10-12: one card carrying tvmaze, imdb, omdb, trakt, tvdb,
// simkl and tmdb ids, whose page follows to TVmaze's season 1. TMDB is asked about that card and
// answers its season 1, which has to land in that run for the page to carry the seasons.
import { afterAll, beforeAll, expect, test } from 'vite-plus/test'

import { readFileSync } from 'node:fs'

import { resolvers } from '../../../../src/sources/tmdb/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import { answer, media, sameAs, title } from './plugins/fixtures'

const CARD = 'ag:(imdb:tt10919420,omdb:tt10919420,simkl:1360242,tmdb:93405,trakt:squid-game,tvdb:383275,tvmaze:43687)'

const fixture = (name: string) => readFileSync(new URL(`../../../fixtures/tmdb/${name}.html`, import.meta.url), 'utf8')

// each season's episode count and first air date, as TMDB lists them
const SEASONS: Record<string, [number, string]> = { 1: [9, 'September 17, 2021'], 2: [7, 'December 26, 2024'], 3: [6, 'June 27, 2025'] }

const seasonPage = (season: string) => {
  const [count, date] = SEASONS[season]!
  return Array.from({ length: count }, (_, index) =>
    `<div class="card" data-episode-number="${index + 1}"><h3><a href="#">Episode ${index + 1}</a></h3><span class="date">${date}</span></div>`
  ).join('')
}

const IMDB = sameAs(media('imdb:tt10919420', { scope: null }))

const show = (uri: string, startDate?: string) =>
  media(uri, { scope: 'CONTAINER', categories: ['SERIES'], titles: [title('en', 'Squid Game')], startDate, handles: uri.startsWith('tmdb:') ? [] : [IMDB] })

const RUN = media('tvmaze:43687-s1', {
  categories: ['SERIES'], titles: [title('en', 'Squid Game')], startDate: '2021-09-17', episodeCount: 9, handles: [IMDB],
})

/** What TMDB answers about the card once the page has followed to TVmaze's run. */
const tmdbAnswer = async () => {
  const context = {
    findAggregatedMedia: async () => ({ scope: 'RUN', titles: [{ title: 'Squid Game' }], episodeCount: 9 }),
    listenForMediaChanges: async function* () {},
    fetch: async (url: string) => {
      const path = url.replace('https://www.themoviedb.org', '').replace(/\?.*$/, '')
      const season = path.match(/^\/tv\/93405\/season\/(\d+)$/)?.[1]
      const body = path === '/tv/93405' ? fixture('show-squid-game')
        : path === '/tv/93405/seasons' ? fixture('seasons-squid-game')
        : season ? seasonPage(season)
        : ''
      return { ok: true, status: 200, text: async () => body }
    },
  }
  const { value } = await (resolvers.Subscription as any).media.subscribe(undefined, { input: { uri: CARD } }, context).next()
  return value.media
}

beforeAll(async () => {
  await enableGraph(true)
  const search = [
    show('tmdb:93405', '2021-01-01'), show('omdb:tt10919420', '2021-01-01'), show('simkl:1360242'),
    show('trakt:squid-game', '2021-09-17T08:00:00.000Z'), show('tvdb:383275', '2021-09-17'), show('tvmaze:43687', '2021-09-17'),
  ]
  const tmdb = await tmdbAnswer()
  expect(tmdb.uri).toBe('tmdb:93405-s1')
  await ingestAnswers([
    ...await Promise.all(search.map(row => answer('media', row, 'MEDIA_PAGE'))),
    await answer('media', RUN),
    await answer('media', tmdb),
  ])
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}, 300_000)

afterAll(async () => { await closeGraph() })

test('the card\'s page is the first season, carrying TMDB\'s season and every season of the show', async () => {
  const page = await resolveMedia(CARD) as { seasons?: { uri: string }[], handles: { relation: string, node: { uri: string } }[] } | undefined
  const members = page?.handles.filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri)
  expect(members).toContain('tvmaze:43687-s1')
  expect(members).toContain('tmdb:93405-s1')
  expect(page?.seasons?.map(season => season.uri)).toEqual(['tmdb:93405-s1', 'tmdb:93405-s2', 'tmdb:93405-s3'])
})
