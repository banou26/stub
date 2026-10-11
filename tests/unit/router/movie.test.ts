// A movie's page shows one line of facts and a play bar instead of a series' episode list (HOR-329).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { MediaCategory } from '../../../src/generated/graphql'
import { isMovieMedia, isUpcoming, movieFacts, runtimeText } from '../../../src/router/home/movie'

test('a runtime reads in hours and minutes, and none reads as nothing', () => {
  expect(runtimeText(112)).toBe('1h 52m')
  expect(runtimeText(120)).toBe('2h')
  expect(runtimeText(45)).toBe('45m')
  for (const none of [0, -3, null, undefined]) expect(runtimeText(none), String(none)).toBeUndefined()
})

test('the facts line names the format, the year, the runtime and three genres at most', () => {
  expect(movieFacts({ released: '2026-12-11', runtime: 112, genres: ['Mystery', 'Drama', 'Romance', 'Historical'] }))
    .toEqual(['Movie', '2026', '1h 52m', 'Mystery, Drama, Romance'])
})

test('a fact a source did not give is left out rather than shown empty', () => {
  expect(movieFacts({})).toEqual(['Movie'])
  expect(movieFacts({ released: 'not a date', runtime: 0, genres: [] })).toEqual(['Movie'])
  expect(movieFacts({ released: '2024-07-26T15:00:00.000Z' })).toEqual(['Movie', '2024'])
})

test('a release is upcoming only while its day is still ahead, whatever the hour', () => {
  const now = new Date('2026-10-11T23:30:00Z')
  expect(isUpcoming('2026-12-11', now)).toBe(true)
  expect(isUpcoming('2026-10-12', now)).toBe(true)
  expect(isUpcoming('2026-10-11', now), 'the day itself is out').toBe(false)
  expect(isUpcoming('2026-10-01', now)).toBe(false)
  expect(isUpcoming(undefined, now)).toBe(false)
  expect(isUpcoming('garbage', now)).toBe(false)
})

test('a movie of one episode or none draws as a film, and one released in parts keeps its episodes', () => {
  const episode = {}
  expect(isMovieMedia({ categories: [MediaCategory.Anime, MediaCategory.Movie], episodes: [episode] })).toBe(true)
  expect(isMovieMedia({ categories: [MediaCategory.Movie], episodes: [] })).toBe(true)
  expect(isMovieMedia({ categories: [MediaCategory.Movie], episodes: [episode, episode] }), 'a film in parts').toBe(false)
  expect(isMovieMedia({ categories: [MediaCategory.Anime], episodes: [episode] }), 'a series of one episode').toBe(false)
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
  // JSX props are not type-checked here, so a dropped `handles` would still compile
  expect(modal, 'a film\'s offers hang off the media').toMatch(/<MoviePlay[^>]*handles=\{media\.handles\}/)
  expect(modal).toMatch(/<MediaTracking[^>]*movie=\{isMovie\}/)
  expect(modal).toContain('{isMovie || !data?.media ? undefined : <Episodes media={data.media}/>}')
  expect(read('router/home/media-details.tsx'), 'the series path still renders its rows').toMatch(/<Episode\s+key=/)
})

test('the title page draws no episode list for a movie either', () => {
  expect(page).toContain('const isMovie = Boolean(media && isMovieMedia(media))')
  expect(page).toMatch(/<MediaTracking[^>]*movie=\{isMovie\}/)
  expect(page).toMatch(/media && !isMovie && media\.episodes\.length\s*\?\s*\(\s*<section data-episodes>\s*<h2>Episodes<\/h2>\s*<Episodes media=\{media\}/)
})
