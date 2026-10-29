// A movie's page shows its release and a play bar instead of a series' episode list (HOR-329).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { startLanguage } from '../../../src/i18n'

import { MediaCategory, MediaType } from '../../../src/generated/graphql'
import { filmDate, isMovieMedia, isUpcoming, releaseSide, runtimeText } from '../../../src/router/home/movie'
import { releaseDateLabel } from '../../../src/utils/release-date'

test('a runtime reads in hours and minutes, and none reads as nothing', () => {
  expect(runtimeText(112)).toBe('1h 52m')
  expect(runtimeText(120)).toBe('2h')
  expect(runtimeText(45)).toBe('45m')
  expect([runtimeText(61), runtimeText(600), runtimeText(1)]).toEqual(['1h 1m', '10h', '1m'])
  for (const none of [0, -3, null, undefined]) expect(runtimeText(none), String(none)).toBeUndefined()
})

// Canadian English writes "1h 52min", whichever English the browser writes dates in
test.each(['en-US', 'en-GB', 'en-CA', 'en-IN'])('%s writes a runtime as stub always did', async locale => {
  try {
    await startLanguage({ language: 'en', languages: [locale] })
    expect([runtimeText(112), runtimeText(45), runtimeText(120)]).toEqual(['1h 52m', '45m', '2h'])
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

const TZ = process.env.TZ
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ }
}
// the first moment of 2021-12-24 in each zone
const MIDNIGHT = { 'America/Los_Angeles': '2021-12-24T08:00:00Z', 'Asia/Tokyo': '2021-12-23T15:00:00Z' } as const
const before = (iso: string) => new Date(Date.parse(iso) - 1000)

// HOR-830: a film not out yet shows its date in large type, the day over its long form and how far off it is
test('a film\'s large date is its day over its long form and the days left, a month or a year alone over its Releases line', () => {
  const now = new Date('2026-10-30T12:00:00Z')
  inZone('UTC', () => {
    expect(filmDate('2026-12-11', now)).toEqual({ day: 'Dec 11', date: 'Friday, December 11, 2026', count: 'in 42 days', partial: false })
    expect([filmDate('2026-10-31', now)?.count, filmDate('2026-10-30', now)?.count]).toEqual(['tomorrow', 'today'])
    expect(filmDate('2027', now)).toEqual({ day: '2027', date: 'Releases 2027', partial: true })
    expect(filmDate('2027-04', now)).toEqual({ day: 'April', date: `Releases ${releaseDateLabel('2027-04')}`, partial: true })
    for (const none of [undefined, null, '', 'not a date']) expect(filmDate(none, now), String(none)).toBeUndefined()
  })
})

test('in German, a film\'s large date is German', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    const now = new Date('2026-10-30T12:00:00Z')
    expect(inZone('UTC', () => filmDate('2026-12-11', now))).toEqual({ day: '11. Dez.', date: 'Freitag, 11. Dezember 2026', count: 'in 42 Tagen', partial: false })
    expect(filmDate('2027', now)?.date).toBe('Erscheint: 2027')
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

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

// AniList's schedule airing a film at 00:30 JST on New Year's Day 2027, seen on Dec 30 where the viewer is
test('a film\'s large date is the day its air time falls on where the viewer is, and a day\'s own day everywhere', () => {
  const tokyo = inZone('Asia/Tokyo', () => filmDate('Thu, 31 Dec 2026 15:30:00 GMT', new Date(2026, 11, 30, 12)))
  expect([tokyo?.day, tokyo?.count]).toEqual(['Jan 1', 'in 2 days'])
  const losAngeles = inZone('America/Los_Angeles', () => filmDate('Thu, 31 Dec 2026 15:30:00 GMT', new Date(2026, 11, 30, 12)))
  expect([losAngeles?.day, losAngeles?.count]).toEqual(['Dec 31', 'tomorrow'])
  const day = inZone('America/Los_Angeles', () => filmDate('2027-01-01', new Date(2026, 11, 30, 12)))
  expect([day?.day, day?.date, day?.count], 'the control: a day').toEqual(['Jan 1', 'Friday, January 1, 2027', 'in 2 days'])
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
