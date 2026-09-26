// The summary is for display only and each answer stands alone, so what is pinned here is what the
// summary may combine and what it must never look like.
import { describe, expect, test } from 'vitest'

import type { ListEntry, Tracker, TrackerAnswer } from '../../../src/generated/schema/types.generated'

import { aggregateTracking, summaryId } from '../../../src/tracking/aggregate'

const URI = 'ag:(anilist:1,mal:10)'

const tracker = (id: string, scoreScale = 'POINT_100'): Tracker =>
  ({ id, name: id, icon: null, color: null, signedIn: true, account: null, canWrite: true, scoreScale })

const listed = (id: string, entry: Partial<ListEntry>, scale?: string): TrackerAnswer => ({
  _id: `answer:${id}:${URI}`,
  tracker: tracker(id, scale),
  state: 'LISTED',
  entry: { _id: `${id}:entry`, tracker: id, ...entry },
  candidates: [],
  error: null,
  pending: 0,
})

const at = (minute: number) => new Date(Date.UTC(2026, 8, 27, 12, minute)).toISOString()

describe('the summary', () => {
  test('takes the highest progress, the status set beside it, the newest score, and says where the answers differ', () => {
    const { summary, disagreements } = aggregateTracking(URI, [
      listed('stub', { status: 'WATCHING', progress: 5, score: 80, updatedAt: at(1) }),
      listed('other', { status: 'COMPLETED', progress: 12, score: 90, updatedAt: at(2) }),
    ])

    expect(summary).toMatchObject({ status: 'COMPLETED', progress: 12, score: 90, updatedAt: at(2) })
    expect(disagreements).toEqual(['STATUS', 'PROGRESS', 'SCORE'])
  })

  test('its _id is one no tracker\'s entry uses, so a normalising cache never folds it into one of them', () => {
    const answers = [
      listed('stub', { progress: 5, updatedAt: at(2) }),
      listed('other', { progress: 3, updatedAt: at(1) }),
    ]
    const { summary } = aggregateTracking(URI, answers)

    expect(summary?._id).toBe(summaryId(URI))
    for (const answer of answers) expect(summary?._id).not.toBe(answer.entry?._id)
  })

  test('combines only answers whose episode counts agree, so a 24 episode entry and a 12 episode part are not added up', () => {
    const { summary, disagreements } = aggregateTracking(URI, [
      listed('stub', { progress: 12, episodeCount: 12, updatedAt: at(2) }),
      listed('other', { progress: 18, episodeCount: 24, updatedAt: at(1) }),
    ])

    expect(summary).toMatchObject({ progress: 12, episodeCount: 12 })
    expect(disagreements, 'progress on two different counts is not a disagreement').toEqual([])
  })

  test('an answer that does not know its count is comparable to any', () => {
    const { summary } = aggregateTracking(URI, [
      listed('stub', { progress: 4, episodeCount: 12, updatedAt: at(2) }),
      listed('other', { progress: 6, updatedAt: at(1) }),
    ])

    expect(summary).toMatchObject({ progress: 6, episodeCount: 12 })
  })

  test('scores are compared at the coarsest scale among them', () => {
    const { disagreements } = aggregateTracking(URI, [
      listed('stub', { score: 88, updatedAt: at(2) }),
      listed('ten', { score: 90, updatedAt: at(1) }, 'POINT_10'),
    ])

    expect(disagreements).toEqual([])
  })
})

describe('answers that are not listed', () => {
  test('an AMBIGUOUS answer is shown as itself and summarised with nothing', () => {
    const ambiguous: TrackerAnswer = {
      _id: `answer:other:${URI}`,
      tracker: tracker('other'),
      state: 'AMBIGUOUS',
      entry: null,
      candidates: ['anilist:1', 'anilist:2'],
      error: null,
      pending: 0,
    }
    const tracking = aggregateTracking(URI, [listed('stub', { progress: 2, updatedAt: at(1) }), ambiguous])

    expect(tracking.answers.map(answer => answer.state)).toEqual(['LISTED', 'AMBIGUOUS'])
    expect(tracking.answers[1]!.candidates).toEqual(['anilist:1', 'anilist:2'])
    expect(tracking.summary).toMatchObject({ progress: 2 })
  })

  test('nothing listed anywhere is no summary at all', () => {
    const tracking = aggregateTracking(URI, [{ ...listed('stub', {}), state: 'NOT_LISTED', entry: null }])

    expect(tracking.summary).toBeNull()
    expect(tracking.disagreements).toEqual([])
  })
})
