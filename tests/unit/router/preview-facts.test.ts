// The preview's line over its title and its side column (HOR-830), with the categories cleaned (HOR-829).
import { afterEach, expect, test } from 'vite-plus/test'

import { MediaSeason, MediaStatus, MediaType } from '../../../src/generated/graphql'
import { startLanguage } from '../../../src/i18n'
import { categories, filmFacts, filmLine, seriesFacts, seriesLine } from '../../../src/router/home/preview-facts'
import { runtimeText } from '../../../src/router/home/movie'
import { setSite, site } from '../../../src/site'
import { releaseDateLabel } from '../../../src/utils/release-date'

const SITE = site
afterEach(() => setSite(SITE))

const facts = (...args: Parameters<typeof seriesFacts>) => seriesFacts(...args).map(({ label, value }) => `${label}: ${value}`)

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

// round 3's Cinematic line, Split's star and chips (the owner, 2026-10-30)
test('a film\'s line names Movie, its release and its length, its side column its score and categories', () => {
  expect(filmLine(penguin)).toBe(`Movie · ${releaseDateLabel('2018-08-17')} · 2h`)
  expect(filmFacts(penguin)).toEqual({ score: '75%', genres: ['Fantasy', 'Mystery'], tags: ['Coming of Age'] })
  expect(filmLine({ type: MediaType.Movie }), 'Movie alone').toBe('Movie')
  expect(filmFacts({ type: MediaType.Movie })).toEqual({ score: undefined, genres: [], tags: [] })
})

// Made in Abyss: Awakening Mystery, 2026-10-22: AniList's 71 minutes, its episode none
test('a film\'s length is its episode\'s, else the media\'s', () => {
  expect(filmLine({ ...penguin, duration: 71, episodes: [{}] })).toMatch(/ · 1h 11m$/)
})

// the large date under the title names it until then
test('a film\'s line names its release once it is out, as of the time given', () => {
  const ahead = { ...penguin, status: MediaStatus.NotYetReleased, startDate: '2026-12-11' }
  expect(filmLine(ahead, new Date('2026-12-01T12:00:00Z'))).toBe('Movie · 2h')
  expect(filmLine(ahead, new Date('2026-12-12T12:00:00Z')), 'the control: out').toBe(`Movie · ${releaseDateLabel('2026-12-11')} · 2h`)
})

// AniList's own day for a film, and AniZip's air time for its episode falling on the day before in UTC
test('a film\'s line names its own release day, whatever day its episode airs', () => {
  const film = { type: MediaType.Movie, startDate: '2022-01-01T00:00:00Z', episodes: [{ releaseDate: '2021-12-31T15:30:00Z' }] }
  expect(filmLine(film, new Date('2026-01-01T00:00:00Z'))).toBe(`Movie · ${releaseDateLabel('2022-01-01')}`)
})

test('a series\' side column names its categories, when it aired and its score, and leaves out what no source gave', () => {
  const frieren = { type: MediaType.Tv, startDate: '2023-09-29', season: null, seasonYear: null, averageScore: 92, genres: ['Fantasy'], tags: ['Travel'], duration: 24 }
  expect(facts(frieren)).toEqual(['Genres: Fantasy', 'Tags: Travel', `Aired: ${releaseDateLabel('2023-09-29')}`, 'Score: 92%'])
  expect(facts({ type: MediaType.Tv })).toEqual([])
})

test('a series\' line names its format, release and episodes', () => {
  expect(seriesLine({ type: MediaType.Tv, startDate: '2023-09-29', episodeCount: 28 })).toBe(`TV Show · ${releaseDateLabel('2023-09-29')} · 28 Episodes`)
  expect(seriesLine({ type: MediaType.Tv, season: MediaSeason.Fall, seasonYear: 2023 })).toBe('TV Show · Fall 2023')
  expect(seriesLine({})).toBe('')
})

test('in German, the side columns\' labels and genres and both lines are German', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    const comedy = { ...penguin, genres: ['Comedy', 'Award Winning'] }
    expect(facts(comedy).slice(0, 3)).toEqual(['Genres: Komödie und Award Winning', 'Tags: Coming of Age', `Ausstrahlung: ${releaseDateLabel('2018-08-17', { locale: 'de' })}`])
    expect(filmFacts(comedy).genres, 'a genre a site offers, and one it does not as its source writes it').toEqual(['Komödie', 'Award Winning'])
    expect(filmLine(penguin)).toBe(`Film · ${releaseDateLabel('2018-08-17', { locale: 'de' })} · ${runtimeText(120)}`)
    expect(seriesLine({ type: MediaType.Tv, startDate: '2023-09-29', episodeCount: 28 })).toBe(`TV-Serie · ${releaseDateLabel('2023-09-29', { locale: 'de' })} · 28 Folgen`)
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})
