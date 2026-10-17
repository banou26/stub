import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { firstUnreleased, unreleasedEpisodes } from '../../../src/router/home/episodes'

type Input = Parameters<typeof firstUnreleased>[0]

const unreleased = (input: Input, now: Date) =>
  unreleasedEpisodes(input, now).flatMap((out, index) => out ? [input.episodes[index]!.episodeNumber] : [])

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

// Kusuriya no Hitorigoto 3rd Season, measured 2026-10-11: Kitsu lists 12 bare episodes, AniZip dates 1 to 4
const DATES: Record<number, string> = { 1: '2026-10-02', 2: '2026-10-09', 3: '2026-10-16', 4: '2026-10-23' }
const measured = range(1, 12).map(episodeNumber => ({ episodeNumber, releaseDate: DATES[episodeNumber] }))
const undated = range(1, 12).map(episodeNumber => ({ episodeNumber }))
const now = new Date('2026-10-11T12:00:00Z')
const TZ = process.env.TZ
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ }
}
const nextAiringEpisode = { episodeNumber: 3, airingAt: 'Fri, 16 Oct 2026 14:00:00 GMT' }

test('the measured show: 1 and 2 are out, 3 to 12 are unreleased', () => {
  expect(unreleased({ status: 'RELEASING', nextAiringEpisode, episodes: measured }, now)).toEqual(range(3, 12))
})

test('without AniList the date on episode 3 gives the same rows', () => {
  expect(unreleased({ episodes: measured }, now)).toEqual(range(3, 12))
})

test('a show not started has every episode unreleased', () => {
  expect(unreleased({ status: 'NOT_YET_RELEASED', episodes: undated }, now)).toEqual(range(1, 12))
})

test('a run with no dates and no schedule dims nothing, finished or not', () => {
  expect(unreleased({ status: 'FINISHED', episodes: undated }, now)).toEqual([])
  expect(unreleased({ status: 'RELEASING', episodes: undated }, now)).toEqual([])
})

test('an episode dated in the past stays released whatever its number', () => {
  const episodes = [...undated.slice(0, 6), { episodeNumber: 7, releaseDate: '2026-10-01' }]
  expect(unreleased({ nextAiringEpisode, episodes }, now)).toEqual([3, 4, 5, 6])
})

test('an episode dated today with no time is out, as a film is, and one with a later hour today is not until that hour', () => {
  expect(unreleased({ episodes: [{ episodeNumber: 1, releaseDate: '2026-10-11' }] }, now)).toEqual([])
  const later = [{ episodeNumber: 1, releaseDate: '2026-10-11T15:00:00Z' }]
  expect(unreleased({ episodes: later }, now), 'a later hour the same day').toEqual([1])
  expect(unreleased({ episodes: later }, new Date('2026-10-11T15:00:00Z'))).toEqual([])
})

// AniZip's air times for The Apothecary Diaries season 3 (Fridays 14:00 UTC, 23:00 JST), with no AniList schedule
test('a row with an air time turns on at that instant, east and west of Greenwich', () => {
  const episodes = [1, 2, 3, 4].map(episodeNumber => ({ episodeNumber, releaseDate: new Date(Date.UTC(2026, 9, 2 + 7 * (episodeNumber - 1), 14)).toISOString() }))
  for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
    expect(inZone(zone, () => unreleased({ status: 'RELEASING', episodes }, new Date('2026-10-16T13:59:00Z'))), zone).toEqual([3, 4])
    expect(inZone(zone, () => unreleased({ status: 'RELEASING', episodes }, new Date('2026-10-16T14:00:00Z'))), zone).toEqual([4])
  }
})

test('a row dated a day with no time is ahead until that day begins where the viewer is', () => {
  const episodes = [{ episodeNumber: 1, releaseDate: '2026-10-09' }, { episodeNumber: 2, releaseDate: '2026-10-16' }]
  // 01:00 JST on the 16th, still 09:00 on the 15th in Los Angeles
  const at = new Date('2026-10-15T16:00:00Z')
  expect(inZone('Asia/Tokyo', () => unreleased({ episodes }, at))).toEqual([])
  expect(inZone('America/Los_Angeles', () => unreleased({ episodes }, at))).toEqual([2])
})

test('once the next episode\'s time has passed it is out and the one after it is next', () => {
  const justAired = new Date('2026-10-16T14:05:00Z')
  expect(unreleased({ status: 'RELEASING', nextAiringEpisode, episodes: undated }, justAired)).toEqual(range(4, 12))
})

test('on the airing day the next episode stays unreleased until its time, though a source dates it today', () => {
  const airingDay = new Date('2026-10-16T10:00:00Z')
  // already the 17th at UTC+14, and still the 16th at UTC-7
  for (const zone of ['Pacific/Kiritimati', 'America/Los_Angeles', 'Asia/Tokyo']) {
    expect(inZone(zone, () => unreleased({ status: 'RELEASING', nextAiringEpisode, episodes: measured }, airingDay)), zone).toEqual(range(3, 12))
  }
})

// AniList's time against AniZip's for the next episode, 2026-10-17
test('the episode AniList schedules is out at AniList\'s time, though another source times it earlier or later that day', () => {
  const airingAt = '2026-10-17T14:00:00Z'
  const timed = (releaseDate: string) => ({ nextAiringEpisode: { episodeNumber: 3, airingAt }, episodes: [{ episodeNumber: 3, releaseDate }] })
  expect(unreleased(timed('2026-10-17T10:00:00Z'), new Date('2026-10-17T12:00:00Z')), 'Black Clover 2nd Season, AniZip 4 h early').toEqual([3])
  expect(unreleased(timed('2026-10-17T10:00:00Z'), new Date(airingAt))).toEqual([])
  expect(unreleased(timed('2026-10-17T00:00:00Z'), new Date('2026-10-17T09:30:00Z')), 'Apple TV\'s midnight UTC').toEqual([3])
  const later = { nextAiringEpisode: { episodeNumber: 3, airingAt: '2026-10-18T08:00:00Z' }, episodes: [{ episodeNumber: 3, releaseDate: '2026-10-18T09:30:00Z' }] }
  expect(unreleased(later, new Date('2026-10-18T07:59:00Z'))).toEqual([3])
  expect(unreleased(later, new Date('2026-10-18T08:30:00Z')), 'Aoashi 2nd Season, AniZip 1.5 h late').toEqual([])
  expect(unreleased(timed('2026-10-16T14:00:00Z'), new Date('2026-10-17T12:00:00Z')), 'a source a day ahead of a stale schedule').toEqual([])
})

const ZONES = ['UTC', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago']

// A Sunday 09:00 JST broadcast is 00:00 UTC Sunday and a 12:00 JST one 03:00 UTC, while a US source dates
// either by the Saturday: Apple TV as that day's midnight UTC, JustWatch as the bare date
test('a day a source names for AniList\'s next episode does not put it out before AniList\'s time, in any zone', () => {
  const stamped = (releaseDate: string, airingAt: string) => ({
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: 3, airingAt },
    episodes: [{ episodeNumber: 2 }, { episodeNumber: 3, releaseDate }],
  })
  const appleTv = stamped('2026-10-17T00:00:00.000Z', 'Sun, 18 Oct 2026 00:00:00 GMT')
  const justWatch = stamped('2026-10-17', 'Sun, 18 Oct 2026 03:00:00 GMT')
  for (const zone of ZONES) {
    expect(inZone(zone, () => unreleased(appleTv, new Date('2026-10-17T12:00:00Z'))), `Apple TV, ${zone}`).toEqual([3])
    expect(inZone(zone, () => unreleased(appleTv, new Date('2026-10-18T00:00:00Z'))), `Apple TV at AniList's time, ${zone}`).toEqual([])
    expect(inZone(zone, () => unreleased(justWatch, new Date('2026-10-17T16:00:00Z'))), `a date, ${zone}`).toEqual([3])
    expect(inZone(zone, () => unreleased(justWatch, new Date('2026-10-18T03:00:00Z'))), `a date at AniList's time, ${zone}`).toEqual([])
  }
})

// a break week AniList has not caught up with: it still names Friday's slot while a source has the next one
test('a source dating AniList\'s next episode a day or more after AniList\'s time keeps it unreleased until then', () => {
  const late = {
    status: 'RELEASING',
    nextAiringEpisode: { episodeNumber: 3, airingAt: 'Fri, 16 Oct 2026 14:00:00 GMT' },
    episodes: [{ episodeNumber: 2, releaseDate: '2026-10-09T14:00:00Z' }, { episodeNumber: 3, releaseDate: '2026-10-23T14:00:00Z' }],
  }
  expect(unreleased(late, new Date('2026-10-17T12:00:00Z'))).toEqual([3])
  expect(unreleased(late, new Date('2026-10-23T14:00:00Z'))).toEqual([])
})

test('AniList\'s next episode outranks a status still saying the show has not started', () => {
  const premiere = { episodeNumber: 2, airingAt: 'Fri, 09 Oct 2026 14:00:00 GMT' }
  const afterPremiere = new Date('2026-10-03T12:00:00Z')
  expect(unreleased({ status: 'NOT_YET_RELEASED', nextAiringEpisode: premiere, episodes: undated }, afterPremiere)).toEqual(range(2, 12))
})

test('a media\'s rows read its status, its schedule and, for a row with no date, the first date a source gives', () => {
  expect(unreleasedEpisodes({ status: 'NOT_YET_RELEASED', episodes: undated }, now).every(Boolean)).toBe(true)
  expect(unreleasedEpisodes({ nextAiringEpisode, episodes: undated }, now).map((out, i) => out && i + 1).filter(Boolean)).toEqual(range(3, 12))
  const sourced = [{ episodeNumber: 1 }, { episodeNumber: 2, handles: [{ node: {} }, { node: { releaseDate: '2026-10-16' } }] }]
  expect(unreleasedEpisodes({ episodes: sourced }, now)).toEqual([false, true])
})

// the rows the modal and the title page share cannot be imported here (see modal-media.test.ts), so
// their wiring is read off the source
const modal = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-details.tsx', import.meta.url)), 'utf-8')

test('the rows ask the schedule and dim an unreleased row, keeping a known title', () => {
  expect(modal).toMatch(/nextAiringEpisode \{\s*episodeNumber\s*airingAt\s*\}/)
  expect(modal, 'the rows read the shared rule').toContain('unreleasedEpisodes(media, new Date(now))')
  expect(modal, 'the next episode takes AniList\'s time while that decides it').toContain('airingAt ?? releasedAtOf(episode)')
  expect(modal).toContain('airingAt={scheduledAt(episode, media.nextAiringEpisode)}')
  expect(modal, 'a known title is drawn as it was').toContain('<div className="title">{episode.titles?.at(0)?.title ?? (unreleased ? \'Unreleased episode\' : `Episode ${index + 1}`)}</div>')
  expect(modal).toContain('<div className={unreleased ? \'episode unreleased\' : \'episode\'}>')
  expect(modal).toMatch(/&\.unreleased \{\s*opacity: 0\.45;/)
})

test('an unreleased row draws no watch link and no source picker', () => {
  expect(modal).toMatch(/episode\.uri && !unreleased\s*\?\s*\(\s*<Link\s+className="episode-link"/)
  expect(modal).toContain('unreleased ? [] : watchSources(episode, mediaUri, origins, backend)')
  expect(modal).toContain('unreleased={unreleased[index]!}')
})
