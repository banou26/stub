// Which Trakt show range or movie a stub media is. Stub keeps one broadcast run per media, and
// Trakt one show split into seasons that need not end where the runs do, so a show media is a
// RANGE of episodes inside one Trakt season, while a film (TMDB `movie-<id>`, IMDb/OMDb film, or
// ani.zip MOVIE) maps to a Trakt movie. Import free apart from uri/catalogue readers and i18n.

import type { Said } from '../../i18n/said'
import type { CatalogLookup } from '../../tracking/identity'
import type { AnimeSeries } from '../anizip/extractor'
import type { TraktMovie, TraktSearchResult, TraktSeason, TraktShow } from './api'

import { forPage } from '../../i18n/said'
import { identify } from '../../tracking/identity'

/**
 * What a media names that Trakt can be asked about, most precise first: a catalogue id of the run, a
 * TMDB movie (`tmdb:movie-<id>`) or season (`tmdb:<id>-s<n>`), or a whole show/title by Trakt slug or IMDb id.
 */
export type TraktKey =
  | { kind: 'run', by: 'anilist' | 'mal' | 'anidb', id: string }
  | { kind: 'season', tmdb: string, season: number }
  | { kind: 'movie', by: 'tmdb', id: string }
  | { kind: 'show', by: 'trakt' | 'imdb', id: string }

export type TraktKeyResult = { kind: 'key', key: TraktKey } | { kind: 'ambiguous', candidates: string[] } | { kind: 'none' }

const RUN_ORIGINS = ['anilist', 'mal', 'anidb'] as const

const TMDB_SEASON = /^tmdb:(\d+)-s(\d+)$/
const TMDB_MOVIE = /^tmdb:movie-(\d+)$/
const OMDB_IMDB = /^omdb:(tt\d+)$/

/**
 * The key a media is asked by, read off `identify`, so it is AMBIGUOUS exactly where stub's own
 * tracker is, a cluster that welded two runs included. Asks nothing.
 */
export const traktKeyOf = (uri: string, catalog?: CatalogLookup): TraktKeyResult => {
  const identity = identify(uri, catalog)
  if (identity.kind === 'ambiguous') return identity
  if (identity.kind === 'none') return { kind: 'none' }
  if (identity.kind === 'catalogue') {
    for (const by of RUN_ORIGINS) {
      const id = identity.ids.find(candidate => candidate.startsWith(`${by}:`))
      if (id) return { kind: 'key', key: { kind: 'run', by, id: id.slice(by.length + 1) } }
    }
  }
  const movie = identity.keys.map(key => TMDB_MOVIE.exec(key)).find(Boolean)
  if (movie) return { kind: 'key', key: { kind: 'movie', by: 'tmdb', id: movie[1]! } }
  const season = identity.keys.map(key => TMDB_SEASON.exec(key)).find(Boolean)
  if (season) return { kind: 'key', key: { kind: 'season', tmdb: season[1]!, season: Number(season[2]) } }
  for (const by of ['trakt', 'imdb'] as const) {
    const key = identity.keys.find(candidate => candidate.startsWith(`${by}:`))
    if (key) return { kind: 'key', key: { kind: 'show', by, id: key.slice(by.length + 1) } }
  }
  const omdb = identity.keys.map(key => OMDB_IMDB.exec(key)).find(Boolean)
  if (omdb) return { kind: 'key', key: { kind: 'show', by: 'imdb', id: omdb[1]! } }
  return { kind: 'none' }
}

/** The key as one string, the same for every media that names it. */
export const keyId = (key: TraktKey) =>
  key.kind === 'season' ? `tmdb:${key.tmdb}-s${key.season}`
  : key.kind === 'movie' ? `tmdb:movie-${key.id}`
  : `${key.by}:${key.id}`

export type TraktRef = { trakt: number, slug: string | null, title: string | null }
export type TraktShowRef = TraktRef
export type TraktMovieRef = TraktRef

/** Episodes `from` to `to` of `season`, Trakt's own numbering, both ends included. */
export type TraktRange = { show: TraktShowRef, season: number, from: number, to: number }

export type TraktTarget =
  | { kind: 'show', range: TraktRange }
  | { kind: 'movie', movie: TraktMovieRef }

export type TraktTargetResult = { kind: 'target', target: TraktTarget } | { kind: 'none', why: Said }

export type IdentityReads = {
  /** A public read of Trakt's API; undefined when it failed. */
  trakt: <T>(path: string) => Promise<T | undefined>
  /** ani.zip's answer for a run; rejects when it failed. */
  anizip: (by: 'anilist' | 'mal' | 'anidb', id: string) => Promise<AnimeSeries>
}

const NO_MOVIE = forPage.formatMessage({ id: 'Trakt has no movie for this media', defaultMessage: 'Trakt has no movie for this media' })
const NO_SHOW = forPage.formatMessage({ id: 'Trakt has no show for this media', defaultMessage: 'Trakt has no show for this media' })
const NO_TVDB = forPage.formatMessage({ id: 'ani.zip names no TVDB show for this run, which Trakt is asked by', defaultMessage: 'ani.zip names no TVDB show for this run, which Trakt is asked by' })
const NO_RUN_EPISODES = forPage.formatMessage({ id: "Trakt lists none of this run's episodes", defaultMessage: "Trakt lists none of this run's episodes" })
const MANY_SEASONS = forPage.formatMessage({ id: 'Trakt keeps this show in seasons: open one of them', defaultMessage: 'Trakt keeps this show in seasons: open one of them' })

const refOf = (entry: TraktShow | TraktMovie | undefined): TraktRef | undefined =>
  entry?.ids?.trakt === undefined ? undefined : { trakt: entry.ids.trakt, slug: entry.ids.slug ?? null, title: entry.title ?? null }

const needed = async <T>(reads: IdentityReads, path: string): Promise<T> => {
  const body = await reads.trakt<T>(path)
  if (body === undefined) throw new Error(`Trakt did not answer ${path.split('?')[0]}`)
  return body
}

const foundShow = async (reads: IdentityReads, path: string) =>
  refOf((await needed<TraktSearchResult[]>(reads, path)).find(result => result.show?.ids?.trakt !== undefined)?.show)

const foundMovie = async (reads: IdentityReads, path: string) =>
  refOf((await needed<TraktSearchResult[]>(reads, path)).find(result => result.movie?.ids?.trakt !== undefined)?.movie)

const span = (show: TraktShowRef, season: number, numbers: number[]): TraktTargetResult =>
  numbers.length
    ? { kind: 'target', target: { kind: 'show', range: { show, season, from: Math.min(...numbers), to: Math.max(...numbers) } } }
    : {
        kind: 'none',
        why: forPage.formatMessage(
          { id: 'Trakt lists no episodes in season {season} of this show', defaultMessage: 'Trakt lists no episodes in season {season} of this show' },
          { season },
        ),
      }

const animeMovieOf = async (run: AnimeSeries, reads: IdentityReads): Promise<TraktMovieRef | undefined> => {
  if (run.mappings.imdb_id) {
    const byImdb = await foundMovie(reads, `/search/imdb/${encodeURIComponent(run.mappings.imdb_id)}?type=movie`)
    if (byImdb) return byImdb
  }
  if (run.mappings.themoviedb_id) {
    const byTmdb = await foundMovie(reads, `/search/tmdb/${run.mappings.themoviedb_id}?type=movie`)
    if (byTmdb) return byTmdb
  }
  if (run.mappings.thetvdb_id) {
    const byTvdb = await foundMovie(reads, `/search/tvdb/${run.mappings.thetvdb_id}?type=movie`)
    if (byTvdb) return byTvdb
  }
  return undefined
}

/**
 * The Trakt show range or movie a key resolves to, or why it has none. Rejects when a read failed,
 * so the caller asks again later rather than keeping the miss.
 */
export const targetOfKey = async (key: TraktKey, reads: IdentityReads): Promise<TraktTargetResult> => {
  if (key.kind === 'movie') {
    const movie = await foundMovie(reads, `/search/tmdb/${key.id}?type=movie`)
    return movie ? { kind: 'target', target: { kind: 'movie', movie } } : { kind: 'none', why: NO_MOVIE }
  }

  let run: AnimeSeries | undefined
  let show: TraktShowRef | undefined

  if (key.kind === 'run') {
    run = await reads.anizip(key.by, key.id)
    if (run?.mappings?.type === 'MOVIE') {
      const movie = await animeMovieOf(run, reads)
      return movie ? { kind: 'target', target: { kind: 'movie', movie } } : { kind: 'none', why: NO_MOVIE }
    }
    if (!run?.mappings?.thetvdb_id) return { kind: 'none', why: NO_TVDB }
    show = await foundShow(reads, `/search/tvdb/${run.mappings.thetvdb_id}?type=show`)
  } else if (key.kind === 'season') {
    show = await foundShow(reads, `/search/tmdb/${key.tmdb}?type=show`)
  } else if (key.by === 'imdb') {
    const results = await needed<TraktSearchResult[]>(reads, `/search/imdb/${encodeURIComponent(key.id)}?type=movie,show`)
    const firstMovie = results.find(result => result.type === 'movie' && result.movie?.ids?.trakt !== undefined)?.movie
    const firstShow = results.find(result => result.type !== 'movie' && result.show?.ids?.trakt !== undefined)?.show
    // prefer exact type when Trakt returns one; if both exist without context, show only runs when movie is absent
    if (firstMovie && !firstShow) return { kind: 'target', target: { kind: 'movie', movie: refOf(firstMovie)! } }
    if (firstShow) show = refOf(firstShow)
    else if (firstMovie) return { kind: 'target', target: { kind: 'movie', movie: refOf(firstMovie)! } }
  } else {
    show = refOf(await needed<TraktShow>(reads, `/shows/${encodeURIComponent(key.id)}`))
  }

  if (!show) return { kind: 'none', why: NO_SHOW }
  const seasons = (await needed<TraktSeason[]>(reads, `/shows/${show.trakt}/seasons?extended=episodes`))
    .filter(season => (season.number ?? 0) > 0 && season.episodes?.length)
  const numbersOf = (season: TraktSeason) => (season.episodes ?? []).flatMap(episode => episode.number ?? [])

  if (run) {
    const places = new Map<number, { season: number, number: number }>()
    for (const season of seasons) {
      for (const episode of season.episodes ?? []) {
        if (episode.ids?.tvdb && episode.number) places.set(episode.ids.tvdb, { season: season.number!, number: episode.number })
      }
    }
    // only the numbered keys: ani.zip's specials (`S7`) can name a regular Trakt episode, as 182255's S7 names season 1 episode 36
    const placed = Object.entries(run.episodes ?? {}).flatMap(([number, episode]) => /^\d+$/.test(number) ? places.get(episode.tvdbId) ?? [] : [])
    if (!placed.length) return { kind: 'none', why: NO_RUN_EPISODES }
    const inSeasons = new Set(placed.map(place => place.season))
    if (inSeasons.size > 1) {
      return {
        kind: 'none',
        why: forPage.formatMessage(
          { id: 'Trakt splits this run over seasons {seasons}', defaultMessage: 'Trakt splits this run over seasons {seasons}' },
          { seasons: { list: [...inSeasons].sort((a, b) => a - b).map(String), join: 'and' } },
        ),
      }
    }
    return span(show, placed[0]!.season, placed.map(place => place.number))
  }
  if (key.kind === 'season') {
    const season = seasons.find(candidate => candidate.number === key.season)
    return season
      ? span(show, key.season, numbersOf(season))
      : {
          kind: 'none',
          why: forPage.formatMessage(
            { id: 'Trakt has no season {season} of this show', defaultMessage: 'Trakt has no season {season} of this show' },
            { season: key.season },
          ),
        }
  }
  if (seasons.length !== 1) return { kind: 'none', why: MANY_SEASONS }
  return span(show, seasons[0]!.number!, numbersOf(seasons[0]!))
}
