// The full page for one title, opened from the modal's More details link (HOR-348).
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test'

import { MediaSeason, MediaStatus, MediaType } from '../../../src/generated/graphql'
import { startLanguage } from '../../../src/i18n'
import { getRoutePath, getRouterRoutePath, Route } from '../../../src/router/path'
import { currentEpisode, playLabel, playTarget, ratingChips, releasedLabel, secondTitle, titleChips, titleFacts, watchedEpisode } from '../../../src/router/title/facts'

const LANGUAGES = readdirSync(fileURLToPath(new URL('../../../src/locales', import.meta.url)))
  .filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length))

// Frieren as AniList and the offline catalogue name it
const FRIEREN = {
  titles: [{ title: 'Frieren: Beyond Journey\'s End' }, { title: 'Sousou no Frieren' }, { title: '葬送のフリーレン' }, { title: 'Sousou no Frieren' }],
  type: MediaType.Tv,
  status: MediaStatus.Finished,
  episodeCount: 28,
  startDate: '2023-09-29',
  endDate: '2024-03-22',
  season: MediaSeason.Fall,
  seasonYear: 2023,
  genres: ['Adventure', 'Drama', 'Fantasy'],
  tags: ['Elf', 'Travel'],
  duration: 24,
  studios: ['Madhouse'],
  sourceMaterial: 'MANGA',
}

test('the chips name the episodes, the format and the status', () => {
  expect(titleChips(FRIEREN)).toEqual(['28 Episodes', 'TV Show', 'Finished'])
  expect(titleChips({ episodeCount: 1, type: MediaType.Movie }), 'one episode is not plural').toEqual(['1 Episode', 'Movie'])
})

test('a chip no source named is left out', () => {
  expect(titleChips({})).toEqual([])
  expect(titleChips({ episodeCount: 0, status: MediaStatus.Releasing })).toEqual(['Airing'])
})

test('the facts are labelled, in reading order', () => {
  expect(titleFacts(FRIEREN, { locale: 'en-US' })).toEqual([
    { label: 'Format', value: 'TV Show' },
    { label: 'Episodes', value: '28' },
    { label: 'Episode length', value: '24 min' },
    { label: 'Status', value: 'Finished' },
    { label: 'Aired', value: 'Sep 29, 2023 to Mar 22, 2024' },
    { label: 'Season', value: 'Fall 2023' },
    { label: 'Studios', value: 'Madhouse' },
    { label: 'Source', value: 'Manga' },
    { label: 'Genres', value: 'Adventure, Drama, Fantasy' },
    { label: 'Tags', value: 'Elf, Travel' },
    { label: 'Also known as', value: '葬送のフリーレン' },
  ])
})

test('a fact no source gave is left out rather than shown empty', () => {
  expect(titleFacts({})).toEqual([])
  expect(titleFacts({ titles: [{ title: 'One' }], genres: [], tags: [], studios: [], startDate: 'not a date', episodeCount: 0, duration: 0 })).toEqual([])
  expect(titleFacts({ startDate: '2026-10-02', status: MediaStatus.Releasing }, { locale: 'en-US' }), 'a run still airing has no end')
    .toEqual([{ label: 'Status', value: 'Airing' }, { label: 'Aired', value: 'Oct 2, 2026' }])
})

test('held, a fact every anime has stays in its place with no value until a source gives it', () => {
  expect(titleFacts({ type: MediaType.Tv, genres: ['Drama'], ratings: [] }, {}, true)).toEqual([
    { label: 'Format', value: 'TV Show' },
    { label: 'Episodes' },
    { label: 'Episode length' },
    { label: 'Status' },
    { label: 'Aired' },
    { label: 'Season' },
    { label: 'Studios' },
    { label: 'Source' },
    { label: 'Genres', value: 'Drama' },
    { label: 'Tags' },
    { label: 'Also known as' },
  ])
  expect(titleFacts(FRIEREN, { locale: 'en-US' }, true), 'the control: each given').toEqual(titleFacts(FRIEREN, { locale: 'en-US' }))
})

const TZ = process.env.TZ
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ }
}
const aired = (media: Parameters<typeof titleFacts>[0]) => titleFacts(media, { locale: 'en-US' }).find(({ label }) => label === 'Aired')?.value

test('a film\'s duration is its length, not an episode\'s', () => {
  expect(titleFacts({ type: MediaType.Movie, duration: 120 })).toEqual([{ label: 'Format', value: 'Movie' }, { label: 'Length', value: '120 min' }])
})

test('each site\'s rating is a chip to draw after the score, and not a fact', () => {
  const ratings = [
    { source: 'IMDb', value: 8, scale: 10 },
    { source: 'TMDB', value: 8.727, scale: 10 },
    { source: 'Rotten Tomatoes', value: 92, scale: 100 },
    { source: 'JustWatch', value: 95, scale: 100 },
  ]
  expect(ratingChips({ ratings })).toEqual(['IMDb 8.0', 'TMDB 8.7', 'Rotten Tomatoes 92%', 'JustWatch 95%'])
  expect(ratingChips({}), 'no site, no chip').toEqual([])
  expect(titleChips({ ...FRIEREN, ratings }), 'apart from the chips before the score').toEqual(titleChips(FRIEREN))
  expect(titleFacts({ sourceMaterial: 'MANGA', genres: ['Drama'], ratings })).toEqual([
    { label: 'Source', value: 'Manga' },
    { label: 'Genres', value: 'Drama' },
  ])
})

test('the source material reads as words', () => {
  expect(titleFacts({ sourceMaterial: 'LIGHT_NOVEL' })).toEqual([{ label: 'Source', value: 'Light novel' }])
})

const SOURCE_MATERIALS = ['ORIGINAL', 'MANGA', 'LIGHT_NOVEL', 'VISUAL_NOVEL', 'VIDEO_GAME', 'OTHER', 'NOVEL', 'DOUJINSHI', 'ANIME', 'WEB_NOVEL', 'LIVE_ACTION', 'GAME', 'COMIC', 'MULTIMEDIA_PROJECT', 'PICTURE_BOOK', 'AUDIO_DRAMA']

test('each source material AniList names reads as words, and one it may add later as its own word', () => {
  expect(SOURCE_MATERIALS.map(sourceMaterial => titleFacts({ sourceMaterial })[0]?.value)).toEqual([
    'Original', 'Manga', 'Light novel', 'Visual novel', 'Video game', 'Other', 'Novel', 'Doujinshi', 'Anime', 'Web novel', 'Live action', 'Game', 'Comic', 'Multimedia project', 'Picture book', 'Audio drama',
  ])
})

// One Piece's 1100 episodes, as the sources count them
test('a count past a thousand reads as the sources write it, with no grouping', () => {
  expect(titleChips({ episodeCount: 1100 })).toEqual(['1100 Episodes'])
  expect(titleFacts({ episodeCount: 1100, duration: 1500 })).toEqual([{ label: 'Episodes', value: '1100' }, { label: 'Episode length', value: '1500 min' }])
})

test('names are joined by a comma and a space, however many', () => {
  const named = (studios: string[]) => titleFacts({ studios }).at(0)?.value
  expect([named(['Sunrise']), named(['Sunrise', 'Bones']), named(['Sunrise', 'Bones', 'MAPPA'])]).toEqual(['Sunrise', 'Sunrise, Bones', 'Sunrise, Bones, MAPPA'])
  expect(titleFacts({ genres: ['Drama', 'Mystery'], tags: ['Elf', 'Travel', 'Magic'] })).toEqual([
    { label: 'Genres', value: 'Drama, Mystery' },
    { label: 'Tags', value: 'Elf, Travel, Magic' },
  ])
})

test('a percent rounds to a whole number and a score to one place, half up', () => {
  const ratings = [
    { source: 'Rotten Tomatoes', value: 14.5, scale: 100 },
    { source: 'Rotten Tomatoes', value: 92.4, scale: 100 },
    { source: 'IMDb', value: 7.25, scale: 10 },
    { source: 'TMDB', value: 8.05, scale: 10 },
    { source: 'IMDb', value: 0, scale: 10 },
    { source: 'Rotten Tomatoes', value: 100, scale: 100 },
  ]
  expect(ratingChips({ ratings })).toEqual(['Rotten Tomatoes 15%', 'Rotten Tomatoes 92%', 'IMDb 7.3', 'TMDB 8.1', 'IMDb 0.0', 'Rotten Tomatoes 100%'])
})

describe('in German', () => {
  beforeAll(() => startLanguage({ language: 'de', languages: ['de-DE'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test('the chips, the facts\' words, units, lists and dates are German', () => {
    expect(titleChips({ episodeCount: 1100 })).toEqual(['1100 Folgen'])
    expect(ratingChips({ ratings: [{ source: 'IMDb', value: 8.05, scale: 10 }, { source: 'Rotten Tomatoes', value: 92, scale: 100 }] })).toEqual(['IMDb 8,1', 'Rotten Tomatoes 92\u00a0%'])
    expect(titleFacts(FRIEREN, { locale: 'de-DE' })).toEqual([
      { label: 'Format', value: 'TV-Serie' },
      { label: 'Folgen', value: '28' },
      { label: 'Folgenlänge', value: '24 Min.' },
      { label: 'Status', value: 'Abgeschlossen' },
      { label: 'Ausstrahlung', value: '29. Sept. 2023 bis 22. März 2024' },
      { label: 'Saison', value: 'Herbst 2023' },
      { label: 'Studios', value: 'Madhouse' },
      { label: 'Vorlage', value: 'Manga' },
      { label: 'Genres', value: 'Abenteuer, Drama und Fantasy' },
      { label: 'Tags', value: 'Elf und Travel' },
      { label: 'Andere Titel', value: '葬送のフリーレン' },
    ])
  })
})

// French read "Œuvre originale: Œuvre originale" on an anime original
test('in no language does a source material read as the label beside it', async () => {
  expect(LANGUAGES.length).toBeGreaterThan(10)
  try {
    for (const language of LANGUAGES) {
      await startLanguage({ language, languages: [language] })
      const facts = SOURCE_MATERIALS.map(sourceMaterial => titleFacts({ sourceMaterial })[0]!)
      expect(facts.filter(({ label, value }) => value === label), language).toEqual([])
    }
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

// a source may date a show to its year or month alone, where French read "du 1998 au 1999"
test('French and Italian ranges read alike for years, months and days', async () => {
  const ranges = (locale: string) => [['1998', '1999'], ['1998-04', '1999-03'], ['1998-04-03', '1999-04-24']]
    .map(([startDate, endDate]) => titleFacts({ status: MediaStatus.Finished, startDate, endDate }, { locale }).at(-1)?.value)
  try {
    expect(ranges((await startLanguage({ language: 'fr', languages: ['fr-FR'] })).locale)).toEqual(['1998 - 1999', 'avr. 1998 - mars 1999', '3 avr. 1998 - 24 avr. 1999'])
    expect(ranges((await startLanguage({ language: 'it', languages: ['it-IT'] })).locale)).toEqual(['1998 - 1999', 'apr 1998 - mar 1999', '3 apr 1998 - 24 apr 1999'])
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

test('an upcoming start reads Releases', () => {
  expect(titleFacts({ type: MediaType.Movie, startDate: '2027-01-08' }, { locale: 'en-US' }, false, true)).toEqual([
    { label: 'Format', value: 'Movie' },
    { label: 'Releases', value: 'Jan 8, 2027' },
  ])
})

test('Aired is the day the source named, west of Greenwich too', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    // AniList's shape, then Jikan's
    expect(inZone(zone, () => aired({ startDate: 'Fri, 29 Sep 2023 00:00:00 GMT', endDate: 'Fri, 22 Mar 2024 00:00:00 GMT' })), zone)
      .toBe('Sep 29, 2023 to Mar 22, 2024')
    expect(inZone(zone, () => aired({ startDate: '2023-09-29T00:00:00+00:00', endDate: '2024-03-22T00:00:00+00:00' })), zone)
      .toBe('Sep 29, 2023 to Mar 22, 2024')
  }
})

// HOR-1017: the preview's release date, as precisely as the sources date the show
test('the release date is the start\'s day or month, else the season, else the year, and nothing undated', () => {
  const en = { locale: 'en-US' }
  expect(releasedLabel(FRIEREN, en)).toBe('Sep 29, 2023')
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    expect(inZone(zone, () => releasedLabel({ startDate: '2023-09-29T00:00:00.000Z' }, en)), `${zone}: AniList's day at midnight UTC`).toBe('Sep 29, 2023')
  }
  expect(releasedLabel({ ...FRIEREN, startDate: '2023-09' }, en)).toBe('Sep 2023')
  expect(releasedLabel({ ...FRIEREN, startDate: '2023' }, en), 'a season outranks a year').toBe('Fall 2023')
  expect(releasedLabel({ ...FRIEREN, startDate: null }, en)).toBe('Fall 2023')
  expect(releasedLabel({ startDate: '2027' }, en)).toBe('2027')
  expect(releasedLabel({ seasonYear: 2027 }, en)).toBe('2027')
  expect(releasedLabel({ startDate: 'not a date' }, en)).toBeUndefined()
  expect(releasedLabel({}, en)).toBeUndefined()
})

// AniList knowing only December 2021 for Jujutsu Kaisen 0, so `airedDate` gives its schedule's first airing, 00:30 JST on Dec 24
test('Aired names an air time\'s day where the viewer is, as the modal\'s Releases line does', () => {
  const startDate = 'Thu, 23 Dec 2021 15:30:00 GMT'
  expect(inZone('Asia/Tokyo', () => aired({ type: MediaType.Movie, startDate }))).toBe('Dec 24, 2021')
  expect(inZone('America/Los_Angeles', () => aired({ type: MediaType.Movie, startDate }))).toBe('Dec 23, 2021')
})

test('Aired names a year or a month alone as just that', () => {
  expect(aired({ startDate: '2027', status: MediaStatus.NotYetReleased })).toBe('2027')
  expect(aired({ startDate: '2026-04', endDate: '2027' })).toBe('Apr 2026 to 2027')
})

test('Aired names one day when the run started and ended on it, and no end while it airs', () => {
  expect(aired({ startDate: '2024-08-30', endDate: '2024-08-30' })).toBe('Aug 30, 2024')
  for (const status of [MediaStatus.Releasing, MediaStatus.NotYetReleased]) {
    expect(aired({ status, startDate: '2026-10-02', endDate: 'Fri, 18 Dec 2026 15:00:00 GMT' }), status).toBe('Oct 2, 2026')
  }
})

test('the second title is the first that reads differently from the main one', () => {
  expect(secondTitle(FRIEREN.titles)?.title).toBe('Sousou no Frieren')
  expect(secondTitle([{ title: 'Same' }, { title: 'Same' }])).toBeUndefined()
  expect(secondTitle(undefined)).toBeUndefined()
})

test('the second title is in another language than the main one, not a second English spelling of it', () => {
  // Iron-Blooded Orphans as ani.zip, MyAnimeList and AniList name it, in score order
  const titles = [
    { language: 'en', title: 'Mobile Suit Gundam: Iron-Blooded Orphans' },
    { language: 'en', title: 'Mobile Suit Gundam: Iron Blooded Orphans' },
    { language: 'ja', title: '機動戦士ガンダム 鉄血のオルフェンズ' },
    { language: 'jp-en', title: 'Kidou Senshi Gundam: Tekketsu no Orphans' },
  ]
  expect(secondTitle(titles)).toEqual({ language: 'ja', title: '機動戦士ガンダム 鉄血のオルフェンズ' })
  expect(titleFacts({ titles }).at(-1)).toEqual({
    label: 'Also known as',
    value: 'Mobile Suit Gundam: Iron Blooded Orphans, Kidou Senshi Gundam: Tekketsu no Orphans',
  })
  expect(secondTitle([{ language: 'en', title: 'Monster' }, { language: 'jp-en', title: 'Monster' }, { language: 'en', title: 'MONSTER!' }])?.title, 'a title reading the same is never second')
    .toBe('MONSTER!')
})

test('Play follows the tracking: Rewatch once completed, Continue once watched, Play otherwise', () => {
  expect(playLabel(undefined)).toBe('Play')
  expect(playLabel({ status: 'PLANNING', progress: 0 })).toBe('Play')
  expect(playLabel({ status: 'WATCHING', progress: 3 })).toBe('Continue')
  expect(playLabel({ status: 'COMPLETED', progress: 28 })).toBe('Rewatch')
})

test('Play opens the first episode, Continue the one after the progress, and neither an unreleased one', () => {
  const episodes = [1, 2, 3].map(episodeNumber => ({ episodeNumber, uri: `e${episodeNumber}`, unreleased: episodeNumber === 3 }))
  expect(playTarget(episodes, undefined)).toEqual({ label: 'Play', episodeUri: 'e1' })
  expect(playTarget(episodes, { status: 'WATCHING', progress: 1 })).toEqual({ label: 'Continue', episodeUri: 'e2' })
  expect(playTarget(episodes, { status: 'COMPLETED', progress: 3 })).toEqual({ label: 'Rewatch', episodeUri: 'e1' })
  expect(playTarget(episodes, { status: 'WATCHING', progress: 2 }), 'the next one is not out').toBeUndefined()
  expect(playTarget([{ episodeNumber: 1, uri: null, unreleased: false }], undefined), 'nowhere to watch it').toBeUndefined()
})

test('the episode list opens on the viewer\'s next episode, the last one listed before it, and the first otherwise', () => {
  const episodes = [...Array.from({ length: 1100 }, (_, index) => ({ episodeNumber: index + 1 })), { episodeNumber: null }]
  expect(currentEpisode(episodes, { status: 'WATCHING', progress: 600 })).toBe(600)
  expect(currentEpisode(episodes, { status: 'WATCHING', progress: 1100 }), 'caught up').toBe(1099)
  expect(currentEpisode(episodes, { status: 'WATCHING', progress: 1500 }), 'past the list').toBe(1099)
  expect(currentEpisode(episodes, undefined)).toBe(0)
  expect(currentEpisode(episodes, { status: 'PLANNING', progress: 0 })).toBe(0)
  expect(currentEpisode(episodes, { status: 'COMPLETED', progress: 1100 }), 'Rewatch opens the first').toBe(0)
})

test('an episode is watched at or under the progress, or once Completed, and never when the tracking counts other episodes', () => {
  expect(watchedEpisode(2, { status: 'WATCHING', progress: 2 })).toBe(true)
  expect(watchedEpisode(3, { status: 'WATCHING', progress: 2 })).toBe(false)
  expect(watchedEpisode(14, { status: 'COMPLETED', progress: 12 }), 'Completed, past the count').toBe(true)
  expect(watchedEpisode(1, undefined)).toBe(false)
  expect(watchedEpisode(0, { status: 'PLANNING', progress: 0 }), 'an episode 0 before anything is watched').toBe(false)
  expect(watchedEpisode(1, { status: 'WATCHING', progress: 2, episodeCount: 12 }, 12), 'the control: the same count').toBe(true)
  expect(watchedEpisode(1, { status: 'WATCHING', progress: 2, episodeCount: 24 }, 12)).toBe(false)
  expect(watchedEpisode(1, { status: 'COMPLETED', progress: 24, episodeCount: 24 }, 12)).toBe(false)
  expect(watchedEpisode(1, { status: 'WATCHING', progress: 2, episodeCount: 24 }, null), 'a page with no count').toBe(true)
})

test('the page is its own route, beside the modal\'s', () => {
  expect(getRoutePath(Route.TITLE, { uri: 'ag:(mal:1)' })).toBe('/title/ag:(mal:1)')
  expect(getRouterRoutePath(Route.TITLE)).toBe('/title/:uri')
  const router = readFileSync(fileURLToPath(new URL('../../../src/router/index.tsx', import.meta.url)), 'utf-8')
  expect(router).toContain('<WRoute path={getRouterRoutePath(Route.TITLE)} component={Title}/>')
})

// media-modal.tsx cannot be imported here (see modal-media.test.ts), so its link is read off the source
test('the modal links to the page for the address it has grown to, with the session\'s flags', () => {
  const modal = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)), 'utf-8')
  expect(modal).toContain('<Link className="more" href={`${getRoutePath(Route.TITLE, { uri: media?.uri ?? params.uri })}${search}`}>{intl.formatMessage({ id: \'More details\'')
  expect(modal).toContain('const search = carriedSearch(useSearch())')
})
