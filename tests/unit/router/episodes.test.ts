import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vite-plus/test'

import { firstUnreleased, isUnreleased } from '../../../src/router/home/episodes'

type Input = Parameters<typeof firstUnreleased>[0]

const unreleased = (input: Input, now: Date) => {
  const first = firstUnreleased(input, now)
  return input.episodes.filter(episode => isUnreleased(episode, first, now)).map(episode => episode.episodeNumber)
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

// Kusuriya no Hitorigoto 3rd Season, measured 2026-10-11: Kitsu lists 12 bare episodes, AniZip dates 1 to 4
const DATES: Record<number, string> = { 1: '2026-10-02', 2: '2026-10-09', 3: '2026-10-16', 4: '2026-10-23' }
const measured = range(1, 12).map(episodeNumber => ({ episodeNumber, releaseDate: DATES[episodeNumber] }))
const undated = range(1, 12).map(episodeNumber => ({ episodeNumber }))
const now = new Date('2026-10-11T12:00:00Z')
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

test('a finished run with no dates and no schedule dims nothing', () => {
  expect(unreleased({ status: 'FINISHED', episodes: undated }, now)).toEqual([])
})

test('an episode dated in the past stays released whatever its number', () => {
  const episodes = [...undated.slice(0, 6), { episodeNumber: 7, releaseDate: '2026-10-01' }]
  expect(unreleased({ nextAiringEpisode, episodes }, now)).toEqual([3, 4, 5, 6])
})

test('an episode dated today is out, as a film is', () => {
  expect(unreleased({ episodes: [{ episodeNumber: 1, releaseDate: '2026-10-11' }] }, now)).toEqual([])
  expect(unreleased({ episodes: [{ episodeNumber: 1, releaseDate: '2026-10-11T15:00:00Z' }] }, now), 'a later hour the same day').toEqual([])
})

test('once the next episode\'s time has passed it is out and the one after it is next', () => {
  const justAired = new Date('2026-10-16T14:05:00Z')
  expect(unreleased({ status: 'RELEASING', nextAiringEpisode, episodes: undated }, justAired)).toEqual(range(4, 12))
})

test('on the airing day the next episode stays unreleased until its time, though a source dates it today', () => {
  const airingDay = new Date('2026-10-16T10:00:00Z')
  expect(unreleased({ status: 'RELEASING', nextAiringEpisode, episodes: measured }, airingDay)).toEqual(range(3, 12))
})

test('AniList\'s next episode outranks a status still saying the show has not started', () => {
  const premiere = { episodeNumber: 2, airingAt: 'Fri, 09 Oct 2026 14:00:00 GMT' }
  const afterPremiere = new Date('2026-10-03T12:00:00Z')
  expect(unreleased({ status: 'NOT_YET_RELEASED', nextAiringEpisode: premiere, episodes: undated }, afterPremiere)).toEqual(range(2, 12))
})

// media-modal.tsx cannot be imported here (see modal-media.test.ts), so its wiring is read off the source
const modal = readFileSync(fileURLToPath(new URL('../../../src/router/home/media-modal.tsx', import.meta.url)), 'utf-8')

test('the modal asks the schedule and dims an unreleased row, keeping a known title', () => {
  expect(modal).toMatch(/nextAiringEpisode \{\s*episodeNumber\s*airingAt\s*\}/)
  expect(modal, 'the status reaches the rule').toContain('firstUnreleased({ status: data?.media?.status, nextAiringEpisode: nextAiring')
  expect(modal, 'the next episode takes AniList\'s time').toContain('releasedAtOf(episode) ?? airingAt')
  expect(modal).toMatch(/airingAt=\{episode\.episodeNumber === nextAiring\?\.episodeNumber \? nextAiring\?\.airingAt : undefined\}/)
  expect(modal).toContain('<div className="title">{unreleased ? \'Unreleased episode\' : `Episode ${index + 1}`}</div>')
  expect(modal, 'a known title is drawn as it was').toContain('<div className="title">{episode.titles.at(0)?.title}</div>')
  expect(modal).toContain('<div className={unreleased ? \'episode unreleased\' : \'episode\'}>')
  expect(modal).toMatch(/&\.unreleased \{\s*opacity: 0\.45;/)
})

test('an unreleased row draws no watch link and no source picker', () => {
  expect(modal).toMatch(/episode\.uri && !unreleased\s*\?\s*\(\s*<Link\s+className="episode-link"/)
  expect(modal).toContain('useWatchSources(unreleased ? undefined : episode, mediaUri)')
  expect(modal).toMatch(/unreleased=\{isUnreleased\(/)
})
