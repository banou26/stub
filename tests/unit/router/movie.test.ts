// A movie's page shows one line of facts and a play bar instead of a series' episode list (HOR-329).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { MediaCategory, MediaType } from '../../../src/generated/graphql'
import { isMovieMedia, isUpcoming, movieFacts, releaseSide, runtimeText } from '../../../src/router/home/movie'
import { releaseDateLabel } from '../../../src/utils/release-date'

test('a runtime reads in hours and minutes, and none reads as nothing', () => {
  expect(runtimeText(112)).toBe('1h 52m')
  expect(runtimeText(120)).toBe('2h')
  expect(runtimeText(45)).toBe('45m')
  expect([runtimeText(61), runtimeText(600), runtimeText(1)]).toEqual(['1h 1m', '10h', '1m'])
  for (const none of [0, -3, null, undefined]) expect(runtimeText(none), String(none)).toBeUndefined()
})

// HOR-1017: the release date under the preview's title, the film's as precisely as its sources date it
test('the facts line names the format, the release date, the runtime and three genres at most', () => {
  expect(movieFacts({ released: '2026-12-11', runtime: 112, genres: ['Mystery', 'Drama', 'Romance', 'Historical'] }))
    .toEqual(['Movie', releaseDateLabel('2026-12-11'), '1h 52m', 'Mystery, Drama, Romance'])
  expect(movieFacts({ released: '2026-12' })).toEqual(['Movie', releaseDateLabel('2026-12')])
  expect(movieFacts({ released: '2026' })).toEqual(['Movie', '2026'])
})

test('a fact a source did not give is left out rather than shown empty', () => {
  expect(movieFacts({})).toEqual(['Movie'])
  expect(movieFacts({ released: 'not a date', runtime: 0, genres: [] })).toEqual(['Movie'])
  expect(movieFacts({ released: '2024-07-26T15:00:00.000Z' })).toEqual(['Movie', releaseDateLabel('2024-07-26T15:00:00.000Z')])
})

const TZ = process.env.TZ
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ }
}
// the first moment of 2021-12-24 in each zone
const MIDNIGHT = { 'America/Los_Angeles': '2021-12-24T08:00:00Z', 'Asia/Tokyo': '2021-12-23T15:00:00Z' } as const
const before = (iso: string) => new Date(Date.parse(iso) - 1000)

test('a day with no time is out from the start of that day where the viewer is, whatever the hour', () => {
  for (const [zone, midnight] of Object.entries(MIDNIGHT)) {
    expect(inZone(zone, () => isUpcoming('2021-12-24', before(midnight))), zone).toBe(true)
    expect(inZone(zone, () => isUpcoming('2021-12-24', new Date(midnight))), `${zone}: the day itself is out`).toBe(false)
    expect(inZone(zone, () => isUpcoming('2021-12-01', new Date(midnight))), zone).toBe(false)
  }
})

// AniList's Hina (anilist 164194) is dated 2026 and not out on 2026-10-17, while TMDB dates every film by its year
test('a year or a month alone is ahead before it begins, maybe out during it, and out once it is over, where the viewer is', () => {
  for (const zone of Object.keys(MIDNIGHT)) {
    expect(inZone(zone, () => releaseSide('2026', new Date(2025, 11, 31, 23, 59))), zone).toBe(1)
    expect(inZone(zone, () => releaseSide('2026', new Date(2026, 0, 1))), zone).toBe(0)
    expect(inZone(zone, () => releaseSide('2026', new Date(2026, 11, 31, 23, 59))), zone).toBe(0)
    expect(inZone(zone, () => releaseSide('2026', new Date(2027, 0, 1))), zone).toBe(-1)
    expect(inZone(zone, () => releaseSide('2026-12', new Date(2026, 10, 30, 23, 59))), zone).toBe(1)
    expect(inZone(zone, () => releaseSide('2026-12', new Date(2026, 11, 31, 12))), zone).toBe(0)
    expect(inZone(zone, () => releaseSide('2026-12', new Date(2027, 0, 1))), zone).toBe(-1)
    expect(inZone(zone, () => releaseSide('2027-03', new Date(2027, 1, 28, 12))), zone).toBe(1)
  }
})

// AniList's schedule airing a film at 00:30 JST on New Year's Day 2027
test('a film\'s date is the day its air time falls on where the viewer is, and a day\'s own day everywhere', () => {
  expect(inZone('Asia/Tokyo', () => movieFacts({ released: 'Thu, 31 Dec 2026 15:30:00 GMT' }))).toEqual(['Movie', releaseDateLabel('2027-01-01')])
  expect(inZone('America/Los_Angeles', () => movieFacts({ released: 'Thu, 31 Dec 2026 15:30:00 GMT' }))).toEqual(['Movie', releaseDateLabel('2026-12-31')])
  expect(inZone('America/Los_Angeles', () => movieFacts({ released: '2027-01-01' })), 'the control: a day').toEqual(['Movie', releaseDateLabel('2027-01-01')])
})

// anizip's `airDateUtc` for Jujutsu Kaisen 0: 00:30 JST on Dec 24
test('an exact air time is out from that instant, in every zone', () => {
  for (const zone of Object.keys(MIDNIGHT)) {
    expect(inZone(zone, () => isUpcoming('2021-12-23T15:30:00Z', before('2021-12-23T15:30:00Z'))), zone).toBe(true)
    expect(inZone(zone, () => isUpcoming('2021-12-23T15:30:00Z', new Date('2021-12-23T15:30:00Z'))), zone).toBe(false)
    expect(inZone(zone, () => isUpcoming('Thu, 23 Dec 2021 15:30:00 GMT', before('2021-12-23T15:30:00Z'))), `${zone}: AniList's shape`).toBe(true)
  }
})

test('nothing is upcoming without a date', () => {
  expect(isUpcoming(undefined)).toBe(false)
  expect(isUpcoming('garbage')).toBe(false)
})

test('a film draws as a film by its format, and a series of one episode stays a series', () => {
  expect(isMovieMedia({ categories: [MediaCategory.Anime, MediaCategory.Movie] })).toBe(true)
  expect(isMovieMedia({ type: MediaType.Movie, categories: [MediaCategory.Anime, MediaCategory.Series] }), 'the type alone').toBe(true)
  expect(isMovieMedia({ type: MediaType.Tv, categories: [MediaCategory.Anime, MediaCategory.Series] }), 'a series of one episode').toBe(false)
  expect(isMovieMedia({ type: MediaType.Tv, categories: [MediaCategory.Anime, MediaCategory.Movie] }), 'a source calling a series a film').toBe(false)
  expect(isMovieMedia({})).toBe(false)
})

// Spirited Away, 2026-10-12: AniZip lists "Complete Movie" and "Part 1 of 2" to "Part 4 of 4"
test('a film AniZip lists in several parts is still a film', () => {
  const spiritedAway = { type: MediaType.Movie, categories: [MediaCategory.Anime, MediaCategory.Movie], episodes: Array.from({ length: 10 }, () => ({})) }
  expect(isMovieMedia(spiritedAway)).toBe(true)
})

// the modal and the title page cannot be imported here (urql's CommonJS `require('react')`, see
// modal-media.test.ts), so their wiring is read off the source, each line with the series path beside
// it as the control
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../src/${path}`, import.meta.url)), 'utf-8')
const modal = read('router/home/media-modal.tsx')
const page = read('router/title/index.tsx')

test('a movie of one episode gets the play bar and the Watched toggle, and no episode list', () => {
  expect(modal).toContain('const isMovie = Boolean(data?.media && isMovieMedia(data.media))')
  expect(modal).toMatch(/isMovie && media\s*\?\s*\(\s*<MoviePlay/)
  // the offers have a default, so dropping the media's handles would still compile
  expect(modal, 'a film\'s offers hang off the media').toContain('useWatchSources(film, media?.uri ?? \'\', media?.handles)')
  expect(modal).toMatch(/<MediaTracking[^>]*movie=\{isMovie\}/)
  expect(modal).toMatch(/isMovie \|\| !data\?\.media \? undefined : \(\s*<div className="episode-list">\s*\{current \? <Episodes [^>]*media=\{current\}/)
  expect(read('router/home/media-details.tsx'), 'the series path still renders its rows').toMatch(/<Episode\s+key=/)
})

test('the title page draws no episode list for a movie either', () => {
  expect(page).toContain('const isMovie = Boolean(media && isMovieMedia(media))')
  expect(page).toMatch(/<MediaTracking[^>]*movie=\{isMovie\}/)
  expect(page).toMatch(/media && !isMovie\s*\?\s*\(\s*<section data-episodes>\s*<h2>\{intl\.formatMessage\(\{ id: 'Episodes', defaultMessage: 'Episodes' \}\)\}<\/h2>\s*\{current \? <Episodes media=\{current\}/)
})
