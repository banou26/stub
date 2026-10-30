// HOR-1074 (new episodes of shows being watched): how many episodes of a work on the lists are out, and which
// works home's row holds.
import { describe, expect, test } from 'vite-plus/test'

import type { ListedWork, StoredWork } from '../../../src/router/home/new-episodes'

import { MOST, RECENT_MS, askedOfStore, newEpisodes, releasedByTrackers, releasedInStore, releasedOf } from '../../../src/router/home/new-episodes'

const NOW = new Date('2026-10-29T12:00:00.000Z')
const DAY = 86_400_000
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const ahead = (ms: number) => new Date(NOW.getTime() + ms).toISOString()

const work = (uri: string, fields: Partial<ListedWork> = {}, summary: Partial<ListedWork['summary']> = {}): ListedWork => ({
  uri,
  episodeCount: 12,
  mediaStatus: 'FINISHED',
  nextAiringEpisode: null,
  ...fields,
  summary: { status: 'WATCHING', progress: 3, episodeCount: 12, updatedAt: ago(400 * DAY), ...summary },
})

describe('what the trackers say is out', () => {
  test("of a show that ended, every episode by the tracker's count; of one not out yet, none", () => {
    expect(releasedByTrackers(work('mal:1'), NOW)).toEqual({ count: 12 })
    expect(releasedByTrackers(work('mal:1', { mediaStatus: 'NOT_YET_RELEASED' }), NOW)).toEqual({ count: 0 })
  })

  test("by AniList's schedule, every episode before the one it names next, and that one once its time passed", () => {
    expect(releasedByTrackers(work('anilist:1', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 6, airingAt: ahead(DAY) } }), NOW)).toEqual({ count: 5 })
    expect(releasedByTrackers(work('anilist:1', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 6, airingAt: ago(DAY) } }), NOW)).toEqual({ count: 6, at: ago(DAY) })
  })

  test('nothing of a show airing with no schedule, or one nobody says airs or ended', () => {
    expect(releasedByTrackers(work('mal:21', { mediaStatus: 'RELEASING', episodeCount: null }), NOW)).toBeUndefined()
    expect(releasedByTrackers(work('anilist:9', { mediaStatus: null }), NOW)).toBeUndefined()
  })
})

describe("what stub's merged data is asked", () => {
  test('only the Watching works the trackers cannot say enough of, that air or changed in the last 30 days', () => {
    const asked = askedOfStore([
      work('mal:21', { mediaStatus: 'RELEASING', episodeCount: null }),
      work('anilist:9', { mediaStatus: null }, { updatedAt: ago(2 * DAY) }),
      work('anilist:10', { mediaStatus: null }, { updatedAt: ago(RECENT_MS + DAY) }),
      work('mal:1'),
      work('anilist:2', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 6, airingAt: ahead(DAY) } }),
      work('mal:30', { mediaStatus: 'RELEASING' }, { status: 'PLANNING' }),
    ], NOW)
    expect(asked.map(({ uri }) => uri)).toEqual(['mal:21', 'anilist:9'])
  })

  test('says out every episode a source dates as passed, the newest by its date', () => {
    const media: StoredWork = {
      status: 'RELEASING',
      episodeCount: 12,
      nextAiringEpisode: null,
      episodes: [
        { episodeNumber: 1, releaseDate: ago(14 * DAY) },
        { episodeNumber: 2, releaseDate: ago(7 * DAY) },
        { episodeNumber: 3, releaseDate: ahead(DAY) },
      ],
    }
    expect(releasedInStore(media, NOW)).toEqual({ count: 2, at: ago(7 * DAY) })
  })

  test('counts no episode a source leaves undated while nothing dates one ahead', () => {
    const episodes = Array.from({ length: 12 }, (_, n) => ({ episodeNumber: n + 1, releaseDate: n < 5 ? ago((10 - n) * DAY) : null }))
    const airing: StoredWork = { status: 'RELEASING', episodeCount: 12, nextAiringEpisode: null, episodes }
    expect(releasedInStore(airing, NOW)).toEqual({ count: 5, at: ago(6 * DAY) })
    const watched = work('mal:21', { mediaStatus: 'RELEASING', episodeCount: null }, { progress: 5 })
    expect(newEpisodes([watched], listed => releasedOf(listed, airing, NOW), NOW), 'no card for episodes not out').toEqual([])
    expect(releasedInStore({ ...airing, status: 'FINISHED' }, NOW), 'the control: a show that ended has them all out').toEqual({ count: 12 })
    expect(releasedInStore({ ...airing, nextAiringEpisode: { episodeNumber: 13, airingAt: ahead(DAY) } }, NOW), "the control: AniList's schedule says they are out").toEqual({ count: 12 })
  })

  test("goes by AniList's schedule when it knows no episode's date", () => {
    expect(releasedInStore({ status: 'RELEASING', episodes: [], nextAiringEpisode: { episodeNumber: 9, airingAt: ahead(DAY) } }, NOW)).toEqual({ count: 8 })
  })

  test("is not read where a tracker counts the work in other episodes than it, as the title page's guard", () => {
    const media: StoredWork = { status: 'RELEASING', episodeCount: 12, episodes: [{ episodeNumber: 5, releaseDate: ago(DAY) }] }
    expect(releasedOf(work('mal:21', { mediaStatus: 'RELEASING' }, { episodeCount: 24 }), media, NOW)).toBeUndefined()
    expect(releasedOf(work('mal:21', { mediaStatus: 'RELEASING' }, { episodeCount: 12 }), media, NOW), 'the control: the same count reads it').toEqual({ count: 5, at: ago(DAY) })
    expect(releasedOf(work('mal:1'), media, NOW), "the trackers' own word comes first").toEqual({ count: 12 })
  })
})

describe('the row', () => {
  // the shape measured on a public MyAnimeList list on 2026-10-29: 191 Watching, 189 of them finished and almost
  // all behind, few changed in 30 days, and two still airing
  const backlog = Array.from({ length: 180 }, (_, n) => work(`mal:${1000 + n}`, {}, { progress: n % 12 }))
  const lists = [
    ...backlog,
    work('mal:1', {}, { updatedAt: ago(3 * DAY), progress: 4 }),
    work('mal:2', {}, { updatedAt: ago(10 * DAY), progress: 12 }),
    work('mal:3', {}, { status: 'REWATCHING', updatedAt: ago(1 * DAY), progress: 2 }),
    work('anilist:4', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 6, airingAt: ahead(2 * DAY) } }, { progress: 3, updatedAt: ago(60 * DAY) }),
    work('anilist:5', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 8, airingAt: ago(6 * 3_600_000) } }, { progress: 7, updatedAt: ago(90 * DAY) }),
    work('anilist:6', { mediaStatus: 'RELEASING', nextAiringEpisode: { episodeNumber: 2, airingAt: ahead(DAY) } }, { progress: 1 }),
    work('mal:7', {}, { status: 'COMPLETED', updatedAt: ago(DAY), progress: 0 }),
  ]

  test('holds the Watching and Rewatching shows behind that still air or changed in 30 days, newest first', () => {
    const row = newEpisodes(lists, listed => releasedByTrackers(listed, NOW), NOW)
    expect(row.map(({ work: { uri }, next, count }) => [uri, next, count])).toEqual([
      ['anilist:5', 8, 1],
      ['mal:3', 3, 10],
      ['mal:1', 5, 8],
      ['anilist:4', 4, 2],
    ])
  })

  test(`holds every one, more than the ${MOST} home's row shows`, () => {
    const recent = Array.from({ length: 30 }, (_, n) => work(`mal:${n}`, {}, { updatedAt: ago(n * 60_000), progress: 0 }))
    const row = newEpisodes(recent, listed => releasedByTrackers(listed, NOW), NOW)
    expect(row).toHaveLength(30)
    expect(row[0]!.work.uri).toBe('mal:0')
  })
})
