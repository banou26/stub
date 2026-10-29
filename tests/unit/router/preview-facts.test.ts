// The preview's side column and a series' line over its title (HOR-830), with the categories cleaned (HOR-829).
import { afterEach, expect, test } from 'vite-plus/test'

import { MediaSeason, MediaStatus, MediaType } from '../../../src/generated/graphql'
import { startLanguage } from '../../../src/i18n'
import { categories, previewFacts, seriesLine } from '../../../src/router/home/preview-facts'
import { setSite, site } from '../../../src/site'
import { releaseDateLabel } from '../../../src/utils/release-date'

const SITE = site
afterEach(() => setSite(SITE))

const facts = (...args: Parameters<typeof previewFacts>) => previewFacts(...args).map(({ label, value }) => `${label}: ${value}`)

// Frieren's genres as the merge gives them, 2026-10-26: AniList's, MAL's, Kitsu's and JustWatch's together
test('every genre once, then the first five tags no genre names', () => {
  setSite('anime')
  expect(categories(
    ['Adventure', 'Award Winning', 'Drama', 'Fantasy', 'Shounen', 'Comedy', 'Science-Fiction', 'Sci-Fi', 'Action & Adventure', 'Animation', 'Anime'],
    ['Travel', 'Magic', 'Fantasy', 'Elf', 'Female Protagonist', 'Philosophy', 'Time Skip'],
  )).toEqual({
    genres: ['Adventure', 'Award Winning', 'Drama', 'Fantasy', 'Shounen', 'Comedy', 'Science-Fiction'],
    tags: ['Travel', 'Magic', 'Elf', 'Female Protagonist', 'Philosophy'],
  })
})

test('a name met before in another ending is left out, and a combined genre none of whose parts is listed alone stays', () => {
  expect(categories(['Medical', 'Action & Adventure', 'Sports'], ['Medicine', 'Sport', 'Politics', 'Politics'])).toEqual({
    genres: ['Medical', 'Action & Adventure', 'Sports'],
    tags: ['Politics'],
  })
})

test('Animation is left out on the anime site only, where every title is', () => {
  setSite('movie')
  expect(categories(['Animation', 'Family'], ['Anime']).genres, 'the control: a film site keeps it').toEqual(['Animation', 'Family'])
  setSite('anime')
  expect(categories(['Animation', 'Family'], ['Anime'])).toEqual({ genres: ['Family'], tags: [] })
})

const penguin = {
  type: MediaType.Movie, status: MediaStatus.Finished, startDate: '2018-08-17', duration: 118, averageScore: 75,
  genres: ['Fantasy', 'Mystery'], tags: ['Coming of Age'], episodes: [{ runtime: 120 }],
}

test('a film\'s side column names its format, release, length, categories and score', () => {
  expect(facts(penguin, true)).toEqual([
    'Format: Movie', `Released: ${releaseDateLabel('2018-08-17')}`, 'Length: 2h', 'Genres: Fantasy, Mystery', 'Tags: Coming of Age', 'Score: 75%',
  ])
})

// Made in Abyss: Awakening Mystery, 2026-10-22: AniList's 71 minutes, its episode none
test('a film\'s length is its episode\'s, else the media\'s', () => {
  expect(facts({ ...penguin, duration: 71, episodes: [{}] }, true)).toContain('Length: 1h 11m')
})

test('a film not out yet reads Releases, as of the time given', () => {
  const ahead = { ...penguin, status: MediaStatus.NotYetReleased, startDate: '2026-12-11' }
  expect(facts(ahead, true, new Date('2026-12-01T12:00:00Z'))[1]).toBe(`Releases: ${releaseDateLabel('2026-12-11')}`)
  expect(facts(ahead, true, new Date('2026-12-12T12:00:00Z'))[1], 'the control: out').toBe(`Released: ${releaseDateLabel('2026-12-11')}`)
})

// AniList's own day for a film, and AniZip's air time for its episode falling on the day before in UTC
test('a film\'s side column names its own release day, whatever day its episode airs', () => {
  const film = { type: MediaType.Movie, startDate: '2022-01-01T00:00:00Z', episodes: [{ releaseDate: '2021-12-31T15:30:00Z' }] }
  expect(facts(film, true)[1]).toBe(`Released: ${releaseDateLabel('2022-01-01')}`)
})

test('a series\' side column names its categories, when it aired and its score, and leaves out what no source gave', () => {
  const frieren = { type: MediaType.Tv, startDate: '2023-09-29', season: null, seasonYear: null, averageScore: 92, genres: ['Fantasy'], tags: ['Travel'], duration: 24 }
  expect(facts(frieren, false)).toEqual(['Genres: Fantasy', 'Tags: Travel', `Aired: ${releaseDateLabel('2023-09-29')}`, 'Score: 92%'])
  expect(facts({ type: MediaType.Tv }, false)).toEqual([])
  expect(facts({ type: MediaType.Movie }, true), 'a film\'s format alone').toEqual(['Format: Movie'])
})

test('a series\' line names its format, release and episodes', () => {
  expect(seriesLine({ type: MediaType.Tv, startDate: '2023-09-29', episodeCount: 28 })).toBe(`TV Show · ${releaseDateLabel('2023-09-29')} · 28 Episodes`)
  expect(seriesLine({ type: MediaType.Tv, season: MediaSeason.Fall, seasonYear: 2023 })).toBe('TV Show · Fall 2023')
  expect(seriesLine({})).toBe('')
})

test('in German, the side column\'s labels and a series\' line are German', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    expect(previewFacts(penguin, true).map(({ label }) => label)).toEqual(['Format', 'Erschienen', 'Länge', 'Genres', 'Tags', 'Bewertung'])
    expect(seriesLine({ type: MediaType.Tv, startDate: '2023-09-29', episodeCount: 28 })).toBe(`TV-Serie · ${releaseDateLabel('2023-09-29', { locale: 'de' })} · 28 Folgen`)
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})
