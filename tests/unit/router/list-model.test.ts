// HOR-1064 (a My list page): the tabs and their counts, the filter and the sorts, and where a + goes.
import { describe, expect, test } from 'vite-plus/test'

import type { CompactAnswer } from '../../../src/tracking/compact'
import type { ListedRow } from '../../../src/router/list/model'

import { offersOneMore, oneMore, shownRows, tabCounts, tabOf } from '../../../src/router/list/model'

const answer = (id: string, entry: CompactAnswer['entry'], extra: Partial<CompactAnswer> = {}): CompactAnswer => ({
  state: 'LISTED',
  candidates: [],
  tracker: { id, name: id, canWrite: true, scoreScale: 'POINT_100' },
  entry,
  ...extra,
})

const row = (title: string | null, summary: Partial<ListedRow['summary']> = {}, answers: CompactAnswer[] = [answer('mal', { status: summary.status, progress: summary.progress, episodeCount: 12 })]): ListedRow => ({
  uri: `mal:${title}`,
  episodeCount: 12,
  disagreements: [],
  answers,
  summary: { status: 'WATCHING', progress: 3, score: null, episodeCount: 12, updatedAt: '2026-10-01T00:00:00.000Z', title, ...summary },
})

const titles = (rows: ListedRow[]) => rows.map(listed => listed.summary.title)

describe('the tabs', () => {
  test('count Rewatching under Watching, and a row with no status under All alone', () => {
    const rows = [row('A'), row('B', { status: 'REWATCHING' }), row('C', { status: 'PLANNING' }), row('D', { status: 'DROPPED' }), row('E', { status: null })]
    expect(tabCounts(rows)).toEqual({ WATCHING: 2, PLANNING: 1, COMPLETED: 0, PAUSED: 0, DROPPED: 1, ALL: 5 })
    expect(titles(shownRows(rows, { tab: 'WATCHING', term: '', sort: 'title', locale: 'en' }))).toEqual(['A', 'B'])
    expect(titles(shownRows(rows, { tab: 'ALL', term: '', sort: 'title', locale: 'en' }))).toEqual(['A', 'B', 'C', 'D', 'E'])
    expect(tabOf('ALL'), 'All is a tab, never a status').toBeUndefined()
  })
})

describe('the filter and the sorts', () => {
  const rows = [
    row('Frieren', { score: 90, progress: 20, updatedAt: '2026-10-03T00:00:00.000Z' }),
    row('frieren 2', { score: null, progress: 1, updatedAt: null }),
    row('Bleach', { score: 70, progress: 300, updatedAt: '2026-10-05T00:00:00.000Z' }),
    row(null, { score: 80, progress: 5, updatedAt: '2026-10-04T00:00:00.000Z' }),
  ]
  const sorted = (sort: 'updated' | 'title' | 'score' | 'progress', term = '') => titles(shownRows(rows, { tab: 'ALL', term, sort, locale: 'en' }))

  test('keeps the titles holding the words, whatever their case', () => {
    expect(sorted('title', '  FRIEREN ')).toEqual(['Frieren', 'frieren 2'])
  })

  test('sort newest, highest and furthest first, and titles A to Z, with a row lacking the value last', () => {
    expect(sorted('updated')).toEqual(['Bleach', null, 'Frieren', 'frieren 2'])
    expect(sorted('score')).toEqual(['Frieren', null, 'Bleach', 'frieren 2'])
    expect(sorted('progress')).toEqual(['Bleach', 'Frieren', null, 'frieren 2'])
    expect(sorted('title')).toEqual(['Bleach', 'Frieren', 'frieren 2', null])
  })
})

describe('the +', () => {
  const two = row('Frieren', { progress: 5 }, [
    answer('anilist', { status: 'WATCHING', progress: 5, episodeCount: 12 }),
    answer('mal', { status: 'WATCHING', progress: 4, episodeCount: 12 }),
  ])

  test('writes one episode past the row to every tracker that lists it, as the title row would', () => {
    expect(oneMore(two, {})).toEqual({ anilist: { progress: 6 }, mal: { progress: 6 } })
  })

  test("follows the viewer's choices of where to write, and goes on from what the page already shows", () => {
    expect(oneMore(two, { mal: false })).toEqual({ anilist: { progress: 6 } })
    expect(oneMore(two, { mal: true }, 7)).toEqual({ anilist: { progress: 8 }, mal: { progress: 8 } })
  })

  test('is held back from a tracker that counts the work in other episodes, or that cannot write now', () => {
    const split = row('Frieren', { progress: 5 }, [
      answer('anilist', { status: 'WATCHING', progress: 5, episodeCount: 12 }),
      answer('mal', { status: 'WATCHING', progress: 5, episodeCount: 24 }),
      answer('stub', { status: 'WATCHING', progress: 5 }, { state: 'PAUSED' }),
    ])
    expect(oneMore(split, {})).toEqual({ anilist: { progress: 6 } })
  })

  test('is offered on Watching and Rewatching rows with an episode left, and on no other', () => {
    expect(offersOneMore(two)).toBe(true)
    expect(offersOneMore(row('A', { status: 'REWATCHING' }))).toBe(true)
    expect(offersOneMore(row('A', { status: 'PLANNING' }))).toBe(false)
    expect(offersOneMore(row('A', { progress: 12 }))).toBe(false)
    expect(offersOneMore(two, 12), 'nor once the page shows the last one').toBe(false)
    expect(offersOneMore({ ...row('A', { episodeCount: null }), episodeCount: null }), 'a count nobody knows has no last episode').toBe(true)
  })
})
