// The full page for one title, opened from the modal's More details link (HOR-348).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { MediaSeason, MediaStatus, MediaType } from '../../../src/generated/graphql'
import { getRoutePath, getRouterRoutePath, Route } from '../../../src/router/path'
import { currentEpisode, playLabel, playTarget, secondTitle, titleChips, titleFacts, watchedEpisode } from '../../../src/router/title/facts'

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

const TZ = process.env.TZ
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ }
}
const aired = (media: Parameters<typeof titleFacts>[0]) => titleFacts(media, { locale: 'en-US' }).find(({ label }) => label === 'Aired')?.value

test('a film\'s duration is its length, not an episode\'s', () => {
  expect(titleFacts({ type: MediaType.Movie, duration: 120 })).toEqual([{ label: 'Format', value: 'Movie' }, { label: 'Length', value: '120 min' }])
})

test('Ratings is one line of each site\'s score, after the source and before the genres', () => {
  const ratings = [
    { source: 'IMDb', value: 8, scale: 10 },
    { source: 'TMDB', value: 8.727, scale: 10 },
    { source: 'Rotten Tomatoes', value: 92, scale: 100 },
    { source: 'JustWatch', value: 95, scale: 100 },
  ]
  expect(titleFacts({ sourceMaterial: 'MANGA', genres: ['Drama'], ratings })).toEqual([
    { label: 'Source', value: 'Manga' },
    { label: 'Ratings', value: 'IMDb 8.0 · TMDB 8.7 · Rotten Tomatoes 92% · JustWatch 95%' },
    { label: 'Genres', value: 'Drama' },
  ])
  expect(titleFacts({ ratings: [] }), 'no site, no line').toEqual([])
})

test('the source material reads as words', () => {
  expect(titleFacts({ sourceMaterial: 'LIGHT_NOVEL' })).toEqual([{ label: 'Source', value: 'Light novel' }])
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

test('Aired names one day when the run started and ended on it, and no end while it airs', () => {
  expect(aired({ startDate: '2024-08-30', endDate: '2024-08-30' })).toBe('Aug 30, 2024')
  for (const status of [MediaStatus.Releasing, MediaStatus.NotYetReleased]) {
    expect(aired({ status, startDate: '2026-10-02', endDate: 'Fri, 18 Dec 2026 15:00:00 GMT' }), status).toBe('Oct 2, 2026')
  }
})

test('the second title is the first that reads differently from the main one', () => {
  expect(secondTitle(FRIEREN.titles)).toBe('Sousou no Frieren')
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
  expect(secondTitle(titles)).toBe('機動戦士ガンダム 鉄血のオルフェンズ')
  expect(titleFacts({ titles }).at(-1)).toEqual({
    label: 'Also known as',
    value: 'Mobile Suit Gundam: Iron Blooded Orphans, Kidou Senshi Gundam: Tekketsu no Orphans',
  })
  expect(secondTitle([{ language: 'en', title: 'Monster' }, { language: 'jp-en', title: 'Monster' }, { language: 'en', title: 'MONSTER!' }]), 'a title reading the same is never second')
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
  expect(modal).toContain('<Link className="more" href={`${getRoutePath(Route.TITLE, { uri: media?.uri ?? params.uri })}${search}`}>More details</Link>')
  expect(modal).toContain('const search = carriedSearch(useSearch())')
})
