// Black Mirror from a search on the series site, on 2026-10-31, as the sources answered: the six catalogues' show, and
// Watchmode's 2011 film of the same name, which is another work (its own IMDb id, `tt2492564`). The film's date is a
// year, so no gate had anything to say, and the title match hung it under the show. The show then opened as the film,
// which the series site does not keep: the page got no answer at all, and TVmaze's wait read the film, so no season came.
import { afterAll, afterEach, beforeAll, expect, test } from 'vite-plus/test'

import { setSite } from '../../../../src/site'
import { resolvers as tvmaze } from '../../../../src/sources/tvmaze/extractor'
import { enableGraph } from '../../../../src/worker/graph'
import { closeGraph } from '../../../../src/worker/graph/engine'
import { ingestAnswers } from '../../../../src/worker/graph/ingest'
import { episodesOf, resolveMedia } from '../../../../src/worker/graph/read'
import { resetPassState, runPlugins } from '../../../../src/worker/graph/plugins/runner'
import { DEFAULT_PLUGINS } from '../../../../src/worker/graph/scheduler'
import TVMAZE_SHOW from '../../../fixtures/tvmaze/black-mirror-show.json'
import SEARCH from './plugins/__fixtures__/black-mirror-search.json'
import { answer, episode, media, partOf, rowsOf, sameAs, title } from './plugins/fixtures'

const ADDRESS = 'ag:(imdb:tt2085059,omdb:tt2085059,simkl:4921,tmdb:42009,tvdb:253463,tvmaze:305,watchmode:0314872)'
const FILM = 'watchmode:02659721'

const pass = async (rows: Record<string, unknown>[]) => {
  await ingestAnswers(await Promise.all(rows.map(row => answer('media', row, 'MEDIA_PAGE'))))
  resetPassState()
  const report = await runPlugins(DEFAULT_PLUGINS, { reason: 'manual' }, { audit: true })
  expect(report.runs.filter(run => run.failed).map(run => `${run.id}: ${run.failed}`)).toEqual([])
}

beforeAll(async () => {
  await enableGraph(true)
  await pass(SEARCH)
}, 300_000)

afterAll(async () => { await closeGraph() })
afterEach(() => { setSite('stub') })

test('a show opens as the show, not as a film of its name and year', async () => {
  const page = await resolveMedia(ADDRESS)
  expect(page?.categories).toEqual(['SERIES'])
  expect(page?.uri).toContain('tvmaze:305')
})

test('the film keeps its own page, and the refusal is on record', async () => {
  expect((await resolveMedia(FILM))?.categories).toEqual(['MOVIE'])
  const links = await rowsOf(
    `MATCH (a:Media {uri: $film})-[l:LINK]->(b:Media {uri: 'imdb:tt2085059'})
     RETURN l.kind AS kind, l.status AS status, l.reason AS reason`,
    { film: FILM }
  )
  expect(links).toEqual([{ kind: 'SAME_AS', status: 'refused', reason: 'format' }])
})

test('TVmaze finds the first season from the show the address opens, and the film stays out of it', async () => {
  const context = { fetch: async () => ({ json: async () => TVMAZE_SHOW }), findAggregatedMedia: resolveMedia, listenForMediaChanges: async function* () {} }
  const { value } = await (tvmaze.Subscription as any).media.subscribe(undefined, { input: { uri: ADDRESS } }, context).next()
  expect(value.media?.uri).toBe('tvmaze:305-s1')

  await pass([JSON.parse(JSON.stringify(value.media))])
  const page = await resolveMedia(ADDRESS)
  expect(page?.uri).toBe('ag:(tvmaze:305-s1)')
  expect(page?.categories).toEqual(['SERIES'])
  expect(page?.type).toBeNull()
  expect((await resolveMedia(FILM))?.uri).toBe(`ag:(${FILM})`)
})

test('an anime show keeps its title join with a film, as anime catalogues file films under SERIES', async () => {
  const shared = { titles: [title('en', 'Shared Name')], startDate: '2012' }
  await pass([
    media('anilist:3001', { ...shared, type: 'MOVIE', categories: ['ANIME', 'MOVIE'] }),
    media('tmdb:3002', { ...shared, scope: 'CONTAINER', categories: ['ANIME', 'SERIES'] }),
  ])
  const links = await rowsOf(
    `MATCH (a:Media {uri: 'anilist:3001'})-[l:LINK]->(b:Media {uri: 'tmdb:3002'}) WHERE l.kind = 'PART_OF'
     RETURN l.status AS status, l.reason AS reason`
  )
  expect(links).toEqual([{ status: 'active', reason: 'cross-scope' }])
})

test('a film keeps its title join with a row no source files as a show', async () => {
  const shared = { titles: [title('en', 'Named Film')], startDate: '2013' }
  await pass([
    media('jw:4001', { ...shared, type: 'MOVIE', categories: ['MOVIE'] }),
    media('tvmaze:4002', shared),
  ])
  const links = await rowsOf(
    `MATCH (:Media {uri: 'jw:4001'})-[l:LINK]-(:Media {uri: 'tvmaze:4002'})
     RETURN l.kind AS kind, l.status AS status, l.reason AS reason`
  )
  expect(links).toEqual([{ kind: 'SAME_AS', status: 'active', reason: 'exact' }])
})

test('a site that does not keep the run a show follows to draws the show', async () => {
  await pass([
    media('tmdb:2001', { scope: 'CONTAINER', categories: ['SERIES'], titles: [title('en', 'Named Show')] }),
    media('jw:2002', { type: 'MOVIE', categories: ['MOVIE'], titles: [title('en', 'Another Name')], handles: [partOf(media('tmdb:2001'))] }),
  ])
  const opened = async (site: Parameters<typeof setSite>[0]) => {
    setSite(site)
    return (await resolveMedia('tmdb:2001'))?.categories
  }
  expect(await opened('stub')).toEqual(['MOVIE'])
  expect(await opened('movie')).toEqual(['MOVIE'])
  expect(await opened('series')).toEqual(['SERIES'])
})

test('a site that does not keep a show\'s earliest run opens the earliest run it does keep', async () => {
  const season = (uri: string, ordinal: number, startDate?: string) => media(uri, {
    scope: 'RUN', categories: ['SERIES'], titles: [title('en', `Other Show Season ${ordinal}`)], startDate,
    handles: [partOf(media('tmdb:2101'))],
    episodes: [1, 2].map(number => episode(`${uri}e${number}`, uri, { episodeNumber: number, titles: [title('en', `Part ${number}`)] })),
  })
  await pass([
    media('tmdb:2101', { scope: 'CONTAINER', categories: ['SERIES'], titles: [title('en', 'Other Show')], startDate: '2010-03-15' }),
    media('jw:2102', { type: 'MOVIE', categories: ['MOVIE'], titles: [title('en', 'Its Pilot Film')], startDate: '2009-06-15', handles: [partOf(media('tmdb:2101'))] }),
    // a lower key than the first season's, so the day decides: an undated run comes last, and then the later season
    season('jw:2100', 3),
    season('jw:2103', 2, '2012-03-15'),
    season('tvmaze:2104', 1, '2010-03-15'),
    // a run's day is its earliest member's
    media('tmdb:2105', { categories: ['SERIES'], titles: [title('en', 'Other Show Season 1')], startDate: '2013-03-15', handles: [sameAs(media('tvmaze:2104'))] }),
    // a show under this show, however early, is not a run to open
    media('imdb:tt2106', { categories: ['SERIES'], titles: [title('en', 'A Show Before It')], startDate: '2008-03-15', handles: [partOf(media('tmdb:2101'))] }),
  ])
  const opened = async (site: Parameters<typeof setSite>[0]) => {
    setSite(site)
    const view = await resolveMedia('tmdb:2101')
    return { uri: view?.uri, episodes: (await episodesOf(String(view?._id))).length }
  }
  expect(await opened('series')).toEqual({ uri: 'ag:(tmdb:2105,tvmaze:2104)', episodes: 2 })
  expect(await opened('movie')).toEqual({ uri: 'ag:(jw:2102)', episodes: 0 })
})

test('runs of one day open by key, as `preferredRunOf` orders them', async () => {
  const season = (uri: string, ordinal: number) => media(uri, {
    scope: 'RUN', categories: ['SERIES'], titles: [title('en', `Tied Show Season ${ordinal}`)], startDate: '2015-03-15',
    handles: [partOf(media('tmdb:5001'))],
  })
  await pass([
    media('tmdb:5001', { scope: 'CONTAINER', categories: ['SERIES'], titles: [title('en', 'Tied Show')], startDate: '2015-03-15' }),
    media('jw:5002', { type: 'MOVIE', categories: ['MOVIE'], titles: [title('en', 'Its Tied Film')], startDate: '2014-03-15', handles: [partOf(media('tmdb:5001'))] }),
    season('tvmaze:5004', 2),
    season('tmdb:5003', 1),
  ])
  setSite('series')
  expect((await resolveMedia('tmdb:5001'))?.uri).toBe('ag:(tmdb:5003)')
})
