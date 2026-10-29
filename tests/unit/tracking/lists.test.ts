// HOR-1064 (a My list page): every tracker's whole list joined into one row per work through the
// bundled id table, each row summarised by the title row's own rule.
import { expect, test } from 'vite-plus/test'

import type { ListEntry, ListItem, Tracker, TrackerList } from '../../../src/generated/schema/types.generated'
import type { CatalogLookup } from '../../../src/tracking/identity'

import { joinLists } from '../../../src/tracking/lists'

const ROWS = [
  { mal: 52991, anilist: 154587, kitsu: 46474, anidb: 17617 },
  { mal: 21, anilist: 21, kitsu: 12, anidb: 69 },
]
const catalog: CatalogLookup = { lookup: (origin, id) => ROWS.find(row => row[origin] === id) }

const tracker = (id: string, scoreScale = 'POINT_100'): Tracker =>
  ({ id, name: id, icon: null, color: null, signedIn: true, account: 'viewer', canWrite: true, scoreScale })

const entry = (tracker: string, mediaUri: string, fields: Partial<ListEntry> = {}): ListEntry =>
  ({ _id: `${tracker}:${mediaUri}`, tracker, mediaUri, status: 'WATCHING', progress: 3, score: null, updatedAt: '2026-10-01T00:00:00.000Z', episodeCount: 28, ...fields })

const item = (listed: ListEntry, facts: Partial<ListItem> = {}): ListItem =>
  ({ entry: listed, episodeCount: listed.episodeCount ?? null, mediaStatus: null, type: null, nextAiringEpisode: null, ...facts })

const list = (id: string, items: ListItem[], scale?: string): TrackerList => ({ _id: `list:${id}`, tracker: tracker(id, scale), state: 'LISTED', items })

test("a MyAnimeList entry and an AniList entry of one work are one row, at AniList's address, with a mark where they differ", () => {
  const rows = joinLists([
    list('anilist', [item(entry('anilist', 'anilist:154587', { progress: 5, updatedAt: '2026-10-20T00:00:00.000Z' }), { mediaStatus: 'RELEASING', type: 'TV', nextAiringEpisode: { episodeNumber: 6, airingAt: '2026-11-01T00:00:00.000Z' } })]),
    list('mal', [item(entry('mal', 'mal:52991', { progress: 4 }), { mediaStatus: 'FINISHED', type: 'ONA' })], 'POINT_10'),
  ], catalog)

  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    _id: 'row:anilist:154587',
    uri: 'anilist:154587',
    summary: { progress: 5, status: 'WATCHING' },
    disagreements: ['PROGRESS'],
    episodeCount: 28,
    mediaStatus: 'RELEASING',
    type: 'TV',
    nextAiringEpisode: { episodeNumber: 6 },
  })
  expect(rows[0]!.answers.map(answer => [answer.tracker.id, answer.state, answer.entry?.progress])).toEqual([['anilist', 'LISTED', 5], ['mal', 'LISTED', 4]])
})

test('an entry the table cannot place stays a row of its own, and so does every work only one tracker lists', () => {
  const rows = joinLists([
    list('anilist', [item(entry('anilist', 'anilist:999'))]),
    list('mal', [item(entry('mal', 'mal:999')), item(entry('mal', 'mal:21'))]),
  ], catalog)

  expect(rows.map(row => row.uri)).toEqual(['anilist:999', 'mal:999', 'anilist:21'])
  expect(rows.map(row => row.answers.length)).toEqual([1, 1, 1])
})

test('without the table, nothing is joined', () => {
  const rows = joinLists([list('anilist', [item(entry('anilist', 'anilist:21'))]), list('mal', [item(entry('mal', 'mal:21'))])])
  expect(rows.map(row => row.uri)).toEqual(['anilist:21', 'mal:21'])
})

test("a row with no tracker counting episodes counts the ones stub's own list last saw", () => {
  const [row] = joinLists([list('stub', [item(entry('stub', 'anilist:21', { episodeCount: null }), { episodeCount: 1155 })])], catalog)
  expect(row).toMatchObject({ episodeCount: 1155, summary: { episodeCount: null } })
})

test('one tracker holding two entries of one work gives its newest', () => {
  const [row, ...rest] = joinLists([list('stub', [
    item(entry('stub', 'mal:21', { progress: 1, updatedAt: '2026-09-01T00:00:00.000Z' })),
    item(entry('stub', 'anilist:21', { progress: 9, updatedAt: '2026-10-01T00:00:00.000Z' })),
  ])], catalog)
  expect(rest).toEqual([])
  expect(row!.answers.map(answer => answer.entry?.progress)).toEqual([9])
})
