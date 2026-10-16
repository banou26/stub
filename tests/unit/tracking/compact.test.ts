import { describe, expect, test, vi } from 'vite-plus/test'

import type { TrackerAnswer } from '../../../src/generated/schema/types.generated'
import type { CompactAnswer, Fields, Outcome, Row } from '../../../src/tracking/compact'

import { aggregateTracking } from '../../../src/tracking/aggregate'
import { createSaveQueue, patchFor, pickerScale, rowOf, rowOfEntry, targetOf, written } from '../../../src/tracking/compact'

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

  test('disagreeing entries give the highest progress, its status, the newest score, and flag each field', () => {
    const tracking = aggregateTracking('m', [
      listed('a', { status: 'PAUSED', progress: 11, score: 60, episodeCount: 14, updatedAt: '2026-09-02T00:00:00Z' }),
      listed('b', { status: 'WATCHING', progress: 13, score: 80, episodeCount: 14, updatedAt: '2026-09-01T00:00:00Z' }),
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

describe('rowOfEntry', () => {
  test("one tracker's own values, counted on its entry's episodes, else its count for the media, else the page's", () => {
    expect(rowOfEntry(answer('a', 'LISTED', { status: 'PAUSED', progress: 3, score: 60, episodeCount: 24 }, { episodeCount: 12 }), 14))
      .toEqual({ status: 'PAUSED', progress: 3, score: 60, total: 24, differs: [] })
    expect(rowOfEntry(answer('a', 'NOT_LISTED', null, { episodeCount: 12 }), 14)).toEqual({ status: null, progress: 0, score: null, total: 12, differs: [] })
    expect(rowOfEntry(answer('a', 'NOT_LISTED'), 14).total).toBe(14)
  })
})

describe('targetOf', () => {
  test('a writable tracker with no stored choice is checked, and a stored false is not', () => {
    expect(targetOf(answer('a', 'LISTED', {}), undefined)).toEqual({ kind: 'check', checked: true, sendable: true })
    expect(targetOf(answer('a', 'NOT_LISTED'), false)).toEqual({ kind: 'check', checked: false, sendable: false })
  })

  test('signed out is a log in, ambiguous cannot track', () => {
    expect(targetOf(answer('a', 'SIGNED_OUT'), undefined)).toEqual({ kind: 'login' })
    expect(targetOf(answer('a', 'AMBIGUOUS', null, { candidates: ['x', 'y'] }), true))
      .toEqual({ kind: 'cannot', reason: 'Names x and y, cannot tell which' })
  })

  test('a tracker that has not answered yet has nothing to check or send to', () => {
    expect(targetOf(answer('a', 'LOADING'), true)).toEqual({ kind: 'loading' })
  })

  test('paused and error are checkboxes that are not sent to', () => {
    expect(targetOf(answer('a', 'PAUSED'), undefined)).toEqual({ kind: 'check', checked: true, sendable: false })
    expect(targetOf(answer('a', 'ERROR'), undefined)).toEqual({ kind: 'check', checked: true, sendable: false })
  })

  // MyAnimeList and AniList answer a failed read without write access until they read the account
  test('paused and error from a tracker without write access are still the problem chip', () => {
    const unread = { tracker: { id: 'a', name: 'a', canWrite: false, scoreScale: 'POINT_100' } }
    expect(targetOf(answer('a', 'PAUSED', null, unread), undefined)).toEqual({ kind: 'check', checked: true, sendable: false })
    expect(targetOf(answer('a', 'ERROR', null, { ...unread, error: 'a answered 502' }), true)).toEqual({ kind: 'check', checked: true, sendable: false })
  })

  test('Crunchyroll, which keeps only some statuses, is a check like any tracker that can write', () => {
    const crunchyroll = { tracker: { id: 'cr', name: 'Crunchyroll', canWrite: true, statuses: ['PLANNING'], scoreScale: 'POINT_5' } }
    for (const state of ['LISTED', 'NOT_LISTED']) {
      expect(targetOf(answer('cr', state, null, crunchyroll), undefined), state).toEqual({ kind: 'check', checked: true, sendable: true })
    }
    expect(targetOf(answer('cr', 'LISTED', null, crunchyroll), false)).toEqual({ kind: 'check', checked: false, sendable: false })
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

  test('a removal goes to a tracker that lists the media, alone, and to no other', () => {
    expect(patchFor(answer('a', 'LISTED', { status: 'PAUSED', progress: 3 }), { remove: true }, row)).toEqual({ remove: true })
    expect(patchFor(answer('a', 'NOT_LISTED'), { remove: true }, row)).toBeUndefined()
  })

  test('a tracker counting other episodes gets no progress, but still its status', () => {
    const other = answer('a', 'LISTED', { episodeCount: 12 })
    expect(patchFor(other, { progress: 14 }, row)).toBeUndefined()
    expect(patchFor(other, { progress: 14, status: 'COMPLETED' }, row)).toEqual({ status: 'COMPLETED' })
  })

  test('so does one that lists nothing but counts other episodes', () => {
    const unlisted = answer('a', 'NOT_LISTED', null, { episodeCount: 28 })
    expect(patchFor(unlisted, { progress: 14 }, row)).toEqual({ status: 'WATCHING', score: 80 })
    expect(patchFor(answer('a', 'NOT_LISTED', null, { episodeCount: 14 }), { progress: 14 }, row), 'the control: the same count')
      .toEqual({ status: 'WATCHING', progress: 14, score: 80 })
  })

  test('progress is clamped to the total, and a null score stays an explicit null', () => {
    expect(patchFor(answer('a', 'LISTED', {}), { progress: 99 }, row)).toEqual({ progress: 14 })
    expect(patchFor(answer('a', 'LISTED', {}), { score: null }, row)).toEqual({ score: null })
  })

  // Crunchyroll: an episode marked watched there cannot be taken back, so only a change that carries
  // progress may mark one
  describe('to a tracker that keeps only some statuses', () => {
    const crunchyroll = (state: string, entry: CompactAnswer['entry'] = null) =>
      answer('cr', state, entry, { tracker: { id: 'cr', name: 'Crunchyroll', canWrite: true, statuses: ['PLANNING'], scoreScale: 'POINT_5' } })

    test('a change goes as only its own fields, listed or not: the row is never filled in', () => {
      for (const cr of [crunchyroll('NOT_LISTED'), crunchyroll('LISTED', { progress: 2 })]) {
        expect(patchFor(cr, { score: 60 }, row), cr.state).toEqual({ score: 60 })
        expect(patchFor(cr, { score: null }, row), cr.state).toEqual({ score: null })
        expect(patchFor(cr, { progress: 14 }, row), cr.state).toEqual({ progress: 14 })
        expect(patchFor(cr, { status: 'PLANNING' }, row), cr.state).toEqual({ status: 'PLANNING' })
      }
      expect(patchFor(answer('a', 'NOT_LISTED'), { score: 60 }, row), 'the control: any other tracker gets the row').toEqual({ status: 'WATCHING', progress: 13, score: 60 })
    })

    test('a status it keeps no place for is left out, and a change of nothing else is no write', () => {
      expect(patchFor(crunchyroll('LISTED', { progress: 2 }), { status: 'WATCHING' }, row)).toBeUndefined()
      expect(patchFor(crunchyroll('NOT_LISTED'), { status: 'COMPLETED', progress: 14 }, row)).toEqual({ progress: 14 })
      expect(patchFor(crunchyroll('NOT_LISTED'), { progress: 99 }, row), 'still clamped to the total').toEqual({ progress: 14 })
    })

    // a removal there takes the series off the Watchlist, and nothing else can come off
    test('a removal goes to it only while it holds Plan to watch', () => {
      expect(patchFor(crunchyroll('LISTED', { status: 'PLANNING' }), { remove: true }, row)).toEqual({ remove: true })
      expect(patchFor(crunchyroll('LISTED', { progress: 3, score: 80 }), { remove: true }, row), 'listed by episodes and stars alone').toBeUndefined()
      expect(patchFor(crunchyroll('NOT_LISTED'), { remove: true }, row)).toBeUndefined()
      expect(patchFor(answer('a', 'LISTED', { progress: 3 }), { remove: true }, row), 'the control: any other tracker listing it with no status').toEqual({ remove: true })
    })

    test("a new entry on another tracker never takes its Watchlist or stars, which are the whole series'", () => {
      const cr = { ...crunchyroll('LISTED'), _id: 'cr', entry: { _id: 'cr:1', status: 'PLANNING', progress: 0, score: 100 } } as unknown as TrackerAnswer
      const shown = rowOf(aggregateTracking('m', [cr]), 12)
      expect(shown).toMatchObject({ status: null, progress: 0, score: null })
      expect(patchFor(answer('anilist', 'NOT_LISTED'), { progress: 1 }, { ...shown, progress: 1 })).toEqual({ status: 'WATCHING', progress: 1 })
    })
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
  const setup = (steps?: (tracker: string) => boolean) => {
    vi.useFakeTimers()
    const pending: { tracker: string, fields: Fields, resolve: (outcome: Outcome) => void }[] = []
    const send = vi.fn((tracker: string, fields: Fields) => new Promise<Outcome>(resolve => { pending.push({ tracker, fields, resolve }) }))
    const queue = createSaveQueue({ send, steps })
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

  // Crunchyroll, where a save marks the one episode it names: folding 19 and 20 into 20 would skip 19
  test('a tracker that steps takes each raise of progress as a save of its own, in order, while the others fold', async () => {
    const { send, queue, settle } = setup(tracker => tracker === 'cr')
    for (const progress of [19, 20, 21]) {
      queue.stage({ cr: { progress }, anilist: { progress } }, false)
      await vi.advanceTimersByTimeAsync(300)
    }
    await vi.advanceTimersByTimeAsync(1000)
    expect(send.mock.calls).toEqual([['cr', { progress: 19 }], ['anilist', { progress: 21 }]])
    await settle(0, { outcome: 'SAVED' })
    await settle(2, { outcome: 'SAVED' })
    expect(send.mock.calls.filter(([tracker]) => tracker === 'cr')).toEqual([['cr', { progress: 19 }], ['cr', { progress: 20 }], ['cr', { progress: 21 }]])
    vi.useRealTimers()
  })

  test('on a tracker that steps, a failed raise keeps those behind it, and Retry or the next change sends it first', async () => {
    const { send, queue, settle } = setup(() => true)
    queue.stage({ cr: { progress: 19 } }, true)
    queue.stage({ cr: { progress: 20 } }, true)
    await settle(0, { outcome: 'FAILED', error: 'Crunchyroll answered 503' })
    expect(send, 'nothing goes past the failed one').toHaveBeenCalledTimes(1)
    expect(queue.state('cr').failed).toEqual({ fields: { progress: 19 }, error: 'Crunchyroll answered 503' })
    queue.retry('cr')
    await settle(1, { outcome: 'SAVED' })
    await settle(2, { outcome: 'FAILED', error: 'Crunchyroll answered 503' })
    queue.stage({ cr: { progress: 21 } }, true)
    await settle(3, { outcome: 'SAVED' })
    await settle(4, { outcome: 'SAVED' })
    expect(send.mock.calls.map(([, { progress }]) => progress)).toEqual([19, 19, 20, 20, 21])
    expect(queue.state('cr').failed).toBeUndefined()
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

  test("what fail kept is shaped for its tracker when it goes, on retry and under the next change, and a sent save's fields are not", async () => {
    vi.useFakeTimers()
    const send = vi.fn(async (_tracker: string, _fields: Fields): Promise<Outcome> => ({ outcome: 'SAVED' }))
    const shape = vi.fn((_tracker: string, { progress: _held, ...fields }: Fields) => fields)
    const queue = createSaveQueue({ send, shape })
    queue.fail('a', { progress: 14, score: 80 }, 'paused')
    queue.retry('a')
    queue.fail('b', { progress: 14 }, 'paused')
    queue.stage({ b: { status: 'WATCHING' } }, true)
    expect(send.mock.calls).toEqual([['a', { score: 80 }], ['b', { status: 'WATCHING' }]])
    expect(shape.mock.calls.map(([tracker]) => tracker)).toEqual(['a', 'b'])

    send.mockResolvedValueOnce({ outcome: 'FAILED', error: 'down' })
    queue.stage({ c: { progress: 5 } }, true)
    await vi.advanceTimersByTimeAsync(0)
    queue.retry('c')
    expect(send).toHaveBeenLastCalledWith('c', { progress: 5 })
    expect(shape).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  test('a removal and a change never fold into one write: the later one is what goes', async () => {
    const { send, queue, settle } = setup()
    queue.stage({ a: { progress: 5 } }, true)
    await settle(0, { outcome: 'FAILED', error: 'down' })
    queue.stage({ a: { remove: true } }, true)
    expect(send).toHaveBeenLastCalledWith('a', { remove: true })
    queue.stage({ a: { status: 'WATCHING' } }, true)
    await settle(1, { outcome: 'FAILED', error: 'down' })
    expect(send, 'the change made while the removal was out goes alone').toHaveBeenLastCalledWith('a', { status: 'WATCHING' })
    await settle(2, { outcome: 'FAILED', error: 'down' })
    queue.retry('a')
    expect(send).toHaveBeenLastCalledWith('a', { status: 'WATCHING' })
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

  test("dropping a tracker keeps what its card staged, even behind a send in flight, and drops the row's", async () => {
    const { send, queue, settle } = setup()
    queue.stage({ a: { progress: 5 } }, true, true)
    queue.stage({ a: { remove: true } }, true, true)
    queue.stage({ a: { status: 'PAUSED' } }, false)
    queue.drop('a')
    await settle(0, { outcome: 'SAVED' })
    expect(send.mock.calls).toEqual([['a', { progress: 5 }], ['a', { remove: true }]])
    vi.useRealTimers()
  })
})
