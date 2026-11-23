// Which Trakt show, season, episodes, or movie a media is, over saved public answers (__fixtures__/tracker).
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, test } from 'vite-plus/test'

import type { AnimeSeries } from '../../../../src/sources/anizip/extractor'
import type { CatalogLookup } from '../../../../src/tracking/identity'

import { targetOfKey, traktKeyOf, type IdentityReads, type TraktKey } from '../../../../src/sources/trakt/identity'
import { inEnglish } from '../../in-english'

const DIR = `${__dirname}/__fixtures__/tracker`
const saved = (name: string) => JSON.parse(readFileSync(`${DIR}/${name}`, 'utf8'))

const RUNS: AnimeSeries[] = readdirSync(DIR).filter(name => name.startsWith('anizip-')).map(saved)

const DUNE = { trakt: 486228, slug: 'dune-2021', title: 'Dune' }
const YOUR_NAME = { trakt: 247228, slug: 'your-name-2016', title: 'Your Name.' }

const ROUTES: Record<string, unknown> = {
  '/search/tvdb/424536?type=show': 'search-tvdb-424536.json',
  '/search/tvdb/267440?type=show': 'search-tvdb-267440.json',
  '/search/tvdb/405920?type=show': 'search-tvdb-405920.json',
  '/search/tmdb/120089?type=show': 'search-tmdb-120089.json',
  '/search/imdb/tt22248376?type=movie,show': 'search-imdb-tt22248376.json',
  '/search/imdb/tt13706018?type=movie,show': 'search-imdb-tt13706018.json',
  '/search/tmdb/438631?type=movie': [{ type: 'movie', movie: { title: 'Dune', ids: { trakt: 486228, slug: 'dune-2021' } } }],
  '/search/imdb/tt1160419?type=movie,show': [{ type: 'movie', movie: { title: 'Dune', ids: { trakt: 486228, slug: 'dune-2021' } } }],
  '/search/imdb/tt5311514?type=movie': [{ type: 'movie', movie: { title: 'Your Name.', ids: { trakt: 247228, slug: 'your-name-2016' } } }],
  '/shows/198225/seasons?extended=episodes': 'seasons-198225.json',
  '/shows/1420/seasons?extended=episodes': 'seasons-1420.json',
  '/shows/190742/seasons?extended=episodes': 'seasons-190742.json',
  '/shows/frieren-beyond-journey-s-end': '../show-frieren.json',
}

/** The saved answers by path, `runs` in place of ani.zip's own, and every read recorded. */
const fake = ({ runs = RUNS, routes = ROUTES }: { runs?: AnimeSeries[], routes?: Record<string, unknown> } = {}) => {
  const asked: string[] = []
  const reads: IdentityReads = {
    trakt: async <T>(path: string) => {
      asked.push(path)
      const route = routes[path]
      return (typeof route === 'string' ? saved(route) : route) as T | undefined
    },
    anizip: async (by, id) => {
      asked.push(`ani.zip ${by} ${id}`)
      return runs.find(run => String(run.mappings[`${by}_id`]) === id) ?? 'Not Found' as never
    },
  }
  return { reads, asked }
}

const FRIEREN = { trakt: 198225, slug: 'frieren-beyond-journey-s-end', title: "Frieren: Beyond Journey's End" }
const TITAN = { trakt: 1420, slug: 'attack-on-titan', title: 'Attack on Titan' }
const SPY = { trakt: 190742, slug: 'spy-x-family', title: 'SPY x FAMILY' }

const run = (id: string): TraktKey => ({ kind: 'run', by: 'anilist', id })

describe('what a media is asked by', () => {
  const ROWS = [
    { mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 },
    { mal: 59978, anilist: 182255, kitsu: 49240, anidb: 18886 },
  ]
  const catalog: CatalogLookup = { lookup: (origin, id) => ROWS.find(row => row[origin] === id) }

  test('a run by its AniList id, found through the catalogue when the media names only its MyAnimeList one', () => {
    expect(traktKeyOf('ag:(anilist:182255)', catalog)).toEqual({ kind: 'key', key: run('182255') })
    expect(traktKeyOf('ag:(mal:59978)', catalog)).toEqual({ kind: 'key', key: run('182255') })
    expect(traktKeyOf('ag:(mal:59978)')).toEqual({ kind: 'key', key: { kind: 'run', by: 'mal', id: '59978' } })
  })

  test('the run before the TMDB season of the same cluster', () => {
    expect(traktKeyOf('ag:(anilist:154587,tmdb:209867-s1)', catalog)).toEqual({ kind: 'key', key: run('154587') })
  })

  test('AMBIGUOUS where stub\'s own tracker is: a cluster that welded two runs', () => {
    expect(traktKeyOf('ag:(anilist:154587,mal:59978)', catalog)).toEqual({ kind: 'ambiguous', candidates: ['anilist:154587', 'mal:59978'] })
  })

  test('TMDB movie before season/show, then Trakt slug, IMDb, and OMDb tt id', () => {
    expect(traktKeyOf('ag:(tmdb:movie-438631,omdb:tt1160419)')).toEqual({ kind: 'key', key: { kind: 'movie', by: 'tmdb', id: '438631' } })
    expect(traktKeyOf('ag:(tmdb:120089-s2,imdb:tt13706018)')).toEqual({ kind: 'key', key: { kind: 'season', tmdb: '120089', season: 2 } })
    expect(traktKeyOf('ag:(trakt:frieren-beyond-journey-s-end,imdb:tt22248376)')).toEqual({ kind: 'key', key: { kind: 'show', by: 'trakt', id: 'frieren-beyond-journey-s-end' } })
    expect(traktKeyOf('ag:(imdb:tt22248376)')).toEqual({ kind: 'key', key: { kind: 'show', by: 'imdb', id: 'tt22248376' } })
    expect(traktKeyOf('omdb:tt1160419')).toEqual({ kind: 'key', key: { kind: 'show', by: 'imdb', id: 'tt1160419' } })
  })

  test('nothing to ask by: a bare TMDB id, or no id Trakt knows', () => {
    expect(traktKeyOf('ag:(tmdb:209867)')).toEqual({ kind: 'none' })
    expect(traktKeyOf('ag:(cr:GG5H5XQX4)')).toEqual({ kind: 'none' })
  })
})

describe('the range or movie a target resolves to', () => {
  test.each([
    ['154587', 'Frieren, its first run', FRIEREN, 1, 1, 28],
    ['182255', 'Frieren, its second run inside the same Trakt season', FRIEREN, 1, 29, 38],
    ['110277', 'Attack on Titan, The Final Season', TITAN, 4, 1, 16],
    ['131681', 'Attack on Titan, The Final Season Part 2', TITAN, 4, 17, 28],
    ['140960', 'SPY x FAMILY, its first cour', SPY, 1, 1, 12],
    ['142838', 'SPY x FAMILY, its second cour', SPY, 1, 13, 25],
  ])('AniList %s, %s', async (id, _name, show, season, from, to) => {
    expect(await targetOfKey(run(id), fake().reads)).toEqual({ kind: 'target', target: { kind: 'show', range: { show, season, from, to } } })
  })

  test("asks ani.zip, then Trakt's lookup by the TVDB show, then the show's season listing", async () => {
    const { reads, asked } = fake()
    await targetOfKey(run('182255'), reads)
    expect(asked).toEqual(['ani.zip anilist 182255', '/search/tvdb/424536?type=show', '/shows/198225/seasons?extended=episodes'])
  })

  test("a run Trakt splits over two seasons has no target", async () => {
    const seasons = saved('seasons-1420.json') as { number: number, episodes: { ids: { tvdb: number } }[] }[]
    const finalSeason = structuredClone(RUNS.find(each => each.mappings.anilist_id === 110277)!)
    finalSeason.episodes['16']!.tvdbId = seasons.find(each => each.number === 3)!.episodes[0]!.ids.tvdb
    expect(await targetOfKey(run('110277'), fake({ runs: [finalSeason] }).reads)).toMatchObject({ kind: 'none', why: inEnglish('Trakt splits this run over seasons 3 and 4') })
  })

  test("ani.zip's specials do not place a run", async () => {
    const seasons = saved('seasons-198225.json') as { number: number, episodes: { number: number, ids: { tvdb: number } }[] }[]
    const secondRun = structuredClone(RUNS.find(each => each.mappings.anilist_id === 182255)!)
    secondRun.episodes['S7']!.tvdbId = seasons.find(each => each.number === 1)!.episodes.find(each => each.number === 5)!.ids.tvdb
    expect(await targetOfKey(run('182255'), fake({ runs: [secondRun] }).reads)).toEqual({ kind: 'target', target: { kind: 'show', range: { show: FRIEREN, season: 1, from: 29, to: 38 } } })
  })

  test("a run with no matching episodes or no TVDB id has none, while an ani.zip MOVIE resolves via movie search", async () => {
    const unlisted = structuredClone(RUNS.find(each => each.mappings.anilist_id === 182255)!)
    for (const episode of Object.values(unlisted.episodes)) episode.tvdbId += 1_000_000_000
    expect(await targetOfKey(run('182255'), fake({ runs: [unlisted] }).reads)).toMatchObject({ kind: 'none' })

    const noTvdb = structuredClone(unlisted)
    noTvdb.mappings.thetvdb_id = null
    const { reads, asked } = fake({ runs: [noTvdb] })
    expect(await targetOfKey(run('182255'), reads)).toMatchObject({ kind: 'none' })
    expect(asked).toEqual(['ani.zip anilist 182255'])

    const animeMovie = structuredClone(RUNS[0]!)
    animeMovie.mappings = { anilist_id: 21519, type: 'MOVIE', imdb_id: 'tt5311514', themoviedb_id: 372058, thetvdb_id: null } as never
    expect(await targetOfKey(run('21519'), fake({ runs: [animeMovie] }).reads)).toEqual({ kind: 'target', target: { kind: 'movie', movie: YOUR_NAME } })
  })

  test('resolves TMDB movies and IMDb movies directly', async () => {
    expect(await targetOfKey({ kind: 'movie', by: 'tmdb', id: '438631' }, fake().reads)).toEqual({ kind: 'target', target: { kind: 'movie', movie: DUNE } })
    expect(await targetOfKey({ kind: 'show', by: 'imdb', id: 'tt1160419' }, fake().reads)).toEqual({ kind: 'target', target: { kind: 'movie', movie: DUNE } })
  })
})

describe('a season or whole show', () => {
  test("a TMDB season is Trakt's season of the same number, whole", async () => {
    expect(await targetOfKey({ kind: 'season', tmdb: '120089', season: 2 }, fake().reads)).toEqual({ kind: 'target', target: { kind: 'show', range: { show: SPY, season: 2, from: 1, to: 12 } } })
    expect(await targetOfKey({ kind: 'season', tmdb: '120089', season: 9 }, fake().reads)).toMatchObject({ kind: 'none', why: inEnglish('Trakt has no season 9 of this show') })
  })

  test('a whole show is its one regular season, by Trakt slug or IMDb id', async () => {
    const whole = { kind: 'target', target: { kind: 'show', range: { show: FRIEREN, season: 1, from: 1, to: 38 } } }
    expect(await targetOfKey({ kind: 'show', by: 'trakt', id: 'frieren-beyond-journey-s-end' }, fake().reads)).toEqual(whole)
    expect(await targetOfKey({ kind: 'show', by: 'imdb', id: 'tt22248376' }, fake().reads)).toEqual(whole)
  })

  test('a season Trakt lists with no episodes yet does not count', async () => {
    const routes = { ...ROUTES, '/shows/198225/seasons?extended=episodes': [...saved('seasons-198225.json'), { number: 2, episodes: [] }] }
    expect(await targetOfKey({ kind: 'show', by: 'trakt', id: 'frieren-beyond-journey-s-end' }, fake({ routes }).reads)).toEqual({ kind: 'target', target: { kind: 'show', range: { show: FRIEREN, season: 1, from: 1, to: 38 } } })
  })

  test('a show Trakt keeps in several seasons has none', async () => {
    expect(await targetOfKey({ kind: 'show', by: 'imdb', id: 'tt13706018' }, fake().reads)).toMatchObject({ kind: 'none', why: inEnglish('Trakt keeps this show in seasons: open one of them') })
  })

  test('no show for the id has none, and a read that failed rejects so it is asked again', async () => {
    expect(await targetOfKey({ kind: 'season', tmdb: '120089', season: 1 }, fake({ routes: { '/search/tmdb/120089?type=show': [] } }).reads)).toMatchObject({ kind: 'none', why: inEnglish('Trakt has no show for this media') })
    await expect(targetOfKey({ kind: 'season', tmdb: '120089', season: 1 }, fake({ routes: {} }).reads)).rejects.toThrow('Trakt did not answer /search/tmdb/120089')
  })
})
