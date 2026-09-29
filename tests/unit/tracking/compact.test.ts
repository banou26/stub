import { describe, expect, test, vi } from 'vitest'

import type { TrackerAnswer } from '../../../src/generated/schema/types.generated'
import type { CompactAnswer, Fields, Outcome, Row } from '../../../src/tracking/compact'

import { aggregateTracking } from '../../../src/tracking/aggregate'
import { createSaveQueue, patchFor, pickerScale, rowOf, targetOf, written } from '../../../src/tracking/compact'

const answer = (id: string, state: string, entry?: CompactAnswer['entry'], extra: Partial<CompactAnswer> = {}): CompactAnswer =>
  ({ state, candidates: [], tracker: { id, name: id, canWrite: true, scoreScale: 'POINT_100' }, entry, ...extra })

const listed = (id: string, entry: Record<string, unknown>, scoreScale = 'POINT_100') =>
  ({ state: 'LISTED', candidates: [], tracker: { id, name: id, canWrite: true, scoreScale }, entry: { _id: `${id}:1`, ...entry } }) as unknown as TrackerAnswer

const row: Row = { status: 'WATCHING', progress: 13, score: 80, total: 14, differs: [] }

describe('rowOf', () => {
  test('agreeing entries give their shared values, with nothing flagged', () => {
    const tracking = aggregateTracking('m', [
      listed('a', { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14 }),
      listed('b', { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14 }),
    ])
    expect(rowOf(tracking, 20)).toEqual({ status: 'WATCHING', progress: 13, score: 80, total: 14, differs: [] })
  })

  test('disagreeing entries give the highest progress, its status, the newest score, and flag only the row fields', () => {
    const tracking = aggregateTracking('m', [
      listed('a', { status: 'PAUSED', progress: 11, score: 60, episodeCount: 14, updatedAt: '2026-09-02T00:00:00Z', startedAt: { year: 2026 } }),
      listed('b', { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14, updatedAt: '2026-09-01T00:00:00Z', startedAt: { year: 2025 } }),
    ])
    const shown = rowOf(tracking)
    expect(shown).toMatchObject({ status: 'WATCHING', progress: 13, score: 60, total: 14 })
    expect(shown.differs.sort()).toEqual(['PROGRESS', 'SCORE', 'STATUS'])
  })

  test('nothing listed gives no status, 0 and the page total', () => {
    expect(rowOf(aggregateTracking('m', []), 28)).toEqual({ status: null, progress: 0, score: null, total: 28, differs: [] })
    expect(rowOf(undefined).total).toBe(null)
  })
})

describe('targetOf', () => {
  test('a writable tracker with no stored choice is checked, and a stored false is not', () => {
    expect(targetOf(answer('a', 'LISTED', {}), undefined)).toEqual({ kind: 'check', checked: true, sendable: true })
    expect(targetOf(answer('a', 'NOT_LISTED'), false)).toEqual({ kind: 'check', checked: false, sendable: false })
  })

  test('signed out is a log in, no id and ambiguous cannot track', () => {
    expect(targetOf(answer('a', 'SIGNED_OUT'), undefined)).toEqual({ kind: 'login' })
    expect(targetOf(answer('a', 'NO_ID'), true).kind).toBe('cannot')
    expect(targetOf(answer('a', 'AMBIGUOUS', null, { candidates: ['x', 'y'] }), true))
      .toEqual({ kind: 'cannot', reason: 'Names x and y, cannot tell which' })
  })

  test('paused and error are checkboxes that are not sent to', () => {
    expect(targetOf(answer('a', 'PAUSED'), undefined)).toEqual({ kind: 'check', checked: true, sendable: false })
    expect(targetOf(answer('a', 'ERROR'), undefined)).toEqual({ kind: 'check', checked: true, sendable: false })
  })
})

describe('patchFor', () => {
  test('a listed tracker gets only the changed fields, so a + carries no status or score', () => {
    expect(patchFor(answer('a', 'LISTED', { status: 'PAUSED', score: 40 }), { progress: 14 }, row)).toEqual({ progress: 14 })
    expect(patchFor(answer('a', 'LISTED', {}), { status: 'DROPPED' }, row)).toEqual({ status: 'DROPPED' })
  })

  test('a tracker that lists nothing gets the whole row, with Watching when the row has no status', () => {
    expect(patchFor(answer('a', 'NOT_LISTED'), { progress: 14 }, row)).toEqual({ status: 'WATCHING', progress: 14, score: 80 })
    expect(patchFor(answer('a', 'NOT_LISTED'), { progress: 1 }, { ...row, status: null, score: null }))
      .toEqual({ status: 'WATCHING', progress: 1 })
    expect(patchFor(answer('a', 'NOT_LISTED'), { status: 'PLANNING' }, row)).toEqual({ status: 'PLANNING', progress: 13, score: 80 })
  })

  test('a tracker counting other episodes gets no progress, but still its status', () => {
    const other = answer('a', 'LISTED', { episodeCount: 12 })
    expect(patchFor(other, { progress: 14 }, row)).toBeUndefined()
    expect(patchFor(other, { progress: 14, status: 'COMPLETED' }, row)).toEqual({ status: 'COMPLETED' })
  })

  test('progress is clamped to the total, and a null score stays an explicit null', () => {
    expect(patchFor(answer('a', 'LISTED', {}), { progress: 99 }, row)).toEqual({ progress: 14 })
    expect(patchFor(answer('a', 'LISTED', {}), { score: null }, row)).toEqual({ score: null })
  })
})

describe('pickerScale', () => {
  test('takes the coarsest scale among the trackers written to', () => {
    expect(pickerScale(['POINT_100', 'POINT_10'])).toEqual({ scale: 'POINT_10', mixed: true })
    expect(pickerScale(['POINT_10', 'POINT_3', 'POINT_5', 'POINT_10_DECIMAL'])!.scale).toBe('POINT_3')
    expect(pickerScale(['POINT_100'])).toEqual({ scale: 'POINT_100', mixed: false })
    expect(pickerScale([])).toBeUndefined()
  })

  test('writes each pick at the value that lands on its face', () => {
    expect(written(80, 'POINT_10')).toBe(80)
    expect(written(60, 'POINT_5')).toBe(60)
    expect(written(85, 'POINT_3')).toBe(85)
    expect(written(85, 'POINT_10_DECIMAL')).toBe(85)
    expect(written(87, 'POINT_10')).toBe(80)
  })
})

describe('the save queue', () => {
  const setup = () => {
    vi.useFakeTimers()
    const pending: { tracker: string, fields: Fields, resolve: (outcome: Outcome) => void }[] = []
    const send = vi.fn((tracker: string, fields: Fields) => new Promise<Outcome>(resolve => { pending.push({ tracker, fields, resolve }) }))
    const queue = createSaveQueue({ send })
    const settle = async (index: number, outcome: Outcome) => { pending[index]!.resolve(outcome); await vi.advanceTimersByTimeAsync(0) }
    return { send, queue, pending, settle }
  }

  test('three + clicks within a second give one send per tracker with the last value', async () => {
    const { send, queue } = setup()
    for (const progress of [14, 15, 16]) {
      queue.stage({ a: { progress }, b: { progress } }, false)
      await vi.advanceTimersByTimeAsync(300)
    }
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(send.mock.calls).toEqual([['a', { progress: 16 }], ['b', { progress: 16 }]])
    vi.useRealTimers()
  })

  test('a change made during a send goes after it, merged, and trackers do not wait on each other', async () => {
    const { send, queue, settle } = setup()
    queue.stage({ a: { progress: 1 }, b: { progress: 1 } }, true)
    queue.stage({ a: { status: 'WATCHING' } }, true)
    queue.stage({ a: { progress: 2 } }, true)
    expect(send).toHaveBeenCalledTimes(2)
    expect(queue.state('a').busy).toBe(true)
    await settle(1, { outcome: 'SAVED' })
    expect(queue.state('b').busy).toBe(false)
    expect(send).toHaveBeenCalledTimes(2)
    await settle(0, { outcome: 'SAVED' })
    expect(send).toHaveBeenLastCalledWith('a', { status: 'WATCHING', progress: 2 })
    vi.useRealTimers()
  })

  test('FAILED keeps the fields: retry resends them, and the next change carries them under newer values', async () => {
    const { send, queue, settle } = setup()
    queue.stage({ a: { progress: 5, score: 80 } }, true)
    await settle(0, { outcome: 'FAILED', error: 'wait a minute' })
    expect(queue.state('a').failed).toEqual({ fields: { progress: 5, score: 80 }, error: 'wait a minute' })
    queue.retry('a')
    expect(send).toHaveBeenLastCalledWith('a', { progress: 5, score: 80 })
    await settle(1, { outcome: 'FAILED', error: 'again' })
    queue.stage({ a: { progress: 6 } }, true)
    expect(send).toHaveBeenLastCalledWith('a', { progress: 6, score: 80 })
    await settle(2, { outcome: 'SAVED' })
    expect(queue.state('a').failed).toBeUndefined()
    vi.useRealTimers()
  })

  test('REFUSED drops the fields and leaves nothing to retry', async () => {
    const { send, queue, settle } = setup()
    queue.stage({ a: { status: 'REWATCHING' } }, true)
    await settle(0, { outcome: 'REFUSED', error: 'Only a completed entry can be rewatched' })
    expect(queue.state('a')).toEqual({ busy: false, failed: undefined, refused: 'Only a completed entry can be rewatched' })
    queue.retry('a')
    queue.stage({ a: { progress: 1 } }, true)
    expect(send).toHaveBeenLastCalledWith('a', { progress: 1 })
    vi.useRealTimers()
  })

  test('dropping a tracker forgets what waited for it, and flush sends the rest at once', async () => {
    const { send, queue } = setup()
    queue.stage({ a: { progress: 3 }, b: { progress: 3 } }, false)
    queue.drop('a')
    queue.flush()
    expect(send.mock.calls).toEqual([['b', { progress: 3 }]])
    vi.useRealTimers()
  })
})
