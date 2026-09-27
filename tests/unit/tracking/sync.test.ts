// Per-media sync as data: what copying one tracker's answer onto others changes, what it refuses, and
// how the writes go. Every expected value is written by hand.
import { describe, expect, test, vi } from 'vitest'

import type { SyncAnswer, SyncEntry } from '../../../src/tracking/sync'

import { applySync, differences, planSync, planTarget, sourceRefusal, targetRefusal } from '../../../src/tracking/sync'

const answer = (id: string, entry: SyncEntry | null, extra: Partial<SyncAnswer> & { scale?: string } = {}): SyncAnswer => ({
  state: entry ? 'LISTED' : 'NOT_LISTED',
  pending: 0,
  tracker: { id, name: id === 'anilist' ? 'AniList' : id === 'stub' ? 'Stub' : id, canWrite: true, scoreScale: extra.scale ?? 'POINT_100' },
  entry,
  ...extra,
})

const stub = answer('stub', { status: 'WATCHING', progress: 5, score: 80, startedAt: { year: 2026, month: 9, day: 1 }, episodeCount: 12 })
const anilist = answer('anilist', {
  status: 'COMPLETED',
  progress: 12,
  score: 90,
  scoreLabel: '9.0 / 10',
  startedAt: { year: 2026, month: 8, day: 30 },
  completedAt: { year: 2026, month: 9, day: 20 },
  rewatchCount: 1,
  episodeCount: 12,
}, { scale: 'POINT_10_DECIMAL' })

describe('what a sync changes on a target', () => {
  test('every field the source holds and the target does not, in the target\'s own terms', () => {
    const plan = planTarget(anilist, stub)

    expect(plan.changes).toEqual([
      { field: 'STATUS', from: 'Watching', to: 'Completed', backwards: false },
      { field: 'PROGRESS', from: '5 / 12', to: '12 / 12', backwards: false },
      { field: 'SCORE', from: '80%', to: '90%', backwards: false },
      { field: 'STARTED_AT', from: '2026-09-01', to: '2026-08-30', backwards: false },
      { field: 'COMPLETED_AT', from: null, to: '2026-09-20', backwards: false },
      { field: 'REWATCH_COUNT', from: null, to: '1', backwards: false },
    ])
    expect(plan.entry).toEqual({
      status: 'COMPLETED',
      progress: 12,
      score: 90,
      startedAt: { year: 2026, month: 8, day: 30 },
      completedAt: { year: 2026, month: 9, day: 20 },
      rewatchCount: 1,
    })
    expect(plan.held).toEqual([])
  })

  test('the other way, a move back is marked, and what the source leaves unset is never cleared', () => {
    const plan = planTarget(stub, anilist)

    expect(plan.changes).toEqual([
      { field: 'STATUS', from: 'Completed', to: 'Watching', backwards: true },
      { field: 'PROGRESS', from: '12 / 12', to: '5 / 12', backwards: true },
      { field: 'SCORE', from: '9.0 / 10', to: '8.0 / 10', backwards: false },
      { field: 'STARTED_AT', from: '2026-08-30', to: '2026-09-01', backwards: false },
    ])
    expect(plan.entry, 'no completedAt and no rewatchCount: the source has none to copy').toEqual({
      status: 'WATCHING',
      progress: 5,
      score: 80,
      startedAt: { year: 2026, month: 9, day: 1 },
    })
  })

  test('a field that agrees is not written, and nothing to change is no write at all', () => {
    const same = answer('other', { ...stub.entry })
    expect(planTarget(stub, same)).toEqual({ tracker: 'other', changes: [], held: [], entry: null })

    const oneOff = answer('other', { ...stub.entry, progress: 6 })
    expect(planTarget(stub, oneOff).entry).toEqual({ progress: 5 })
  })

  test('a target that lists nothing gets every field the source holds', () => {
    const plan = planTarget(stub, answer('anilist', null, { scale: 'POINT_10_DECIMAL' }))

    expect(plan.changes.map(({ field, from, to }) => [field, from, to])).toEqual([
      ['STATUS', null, 'Watching'],
      ['PROGRESS', null, '5 / 12'],
      ['SCORE', null, '8.0 / 10'],
      ['STARTED_AT', null, '2026-09-01'],
    ])
  })

  test('a date carrying a cache\'s __typename goes as its three parts alone', () => {
    const cached = answer('stub', { startedAt: { __typename: 'FuzzyDate', year: 2026, month: 9, day: null } as SyncEntry['startedAt'] })
    const plan = planTarget(cached, answer('other', null))

    expect(plan.entry).toEqual({ startedAt: { year: 2026, month: 9, day: null } })
    expect(plan.changes[0]).toMatchObject({ field: 'STARTED_AT', to: '2026-09' })
  })
})

describe('scores between scales', () => {
  test('go through 0 to 100 onto the target\'s scale, at the value the target will hold', () => {
    const source = answer('stub', { score: 87 })

    expect(planTarget(source, answer('ten', null, { scale: 'POINT_10' })).changes[0]).toMatchObject({ from: null, to: '8 / 10' })
    expect(planTarget(source, answer('ten', null, { scale: 'POINT_10' })).entry, 'AniList floors 87 to 8, and 80 reads as 8').toEqual({ score: 80 })
    expect(planTarget(source, answer('stars', null, { scale: 'POINT_5' })).entry).toEqual({ score: 80 })
    expect(planTarget(source, answer('faces', null, { scale: 'POINT_3' })).entry, 'measured to read as :)').toEqual({ score: 85 })
    expect(planTarget(source, answer('faces', null, { scale: 'POINT_3' })).changes[0]!.to).toBe(':)')
    expect(planTarget(source, answer('decimal', null, { scale: 'POINT_10_DECIMAL' })).entry).toEqual({ score: 87 })
  })

  test('are compared at the coarser of the two scales, either way round', () => {
    const fine = answer('stub', { score: 95 })
    const coarse = answer('ten', { score: 90, scoreLabel: '9 / 10' }, { scale: 'POINT_10' })

    expect(planTarget(fine, coarse).changes, '95 is a 9 on ten points').toEqual([])
    expect(planTarget(coarse, fine).changes, 'and a ten point 9 does not make 95 a 90').toEqual([])
    expect(planTarget(answer('stub', { score: 88 }), coarse).changes, 'the control: 88 is an 8').toEqual([
      { field: 'SCORE', from: '9 / 10', to: '8 / 10', backwards: false },
    ])
  })

  test('no score on the source is never a score of 0 on the target', () => {
    expect(planTarget(answer('stub', { score: 0, progress: 1 }), answer('other', { score: 70, progress: 1 })).entry).toBeNull()
  })
})

describe('what a sync refuses', () => {
  test('progress, when the two trackers count the episodes differently, and the rest still goes', () => {
    const whole = answer('anilist', { status: 'WATCHING', progress: 18, episodeCount: 24 })
    const part = answer('mal', { status: 'PAUSED', progress: 12, episodeCount: 12 })
    const plan = planTarget(whole, part)

    expect(plan.held).toEqual([{ field: 'PROGRESS', reason: 'AniList counts 24 episodes and mal counts 12, so progress is not copied' }])
    expect(plan.entry).toEqual({ status: 'WATCHING' })

    const unknown = answer('mal', { status: 'PAUSED', progress: 12 })
    expect(planTarget(whole, unknown).entry, 'the control: a count one side does not know is no refusal').toEqual({ status: 'WATCHING', progress: 18 })
  })

  test('a source with writes still waiting to be sent', () => {
    const waiting = { ...anilist, pending: 2 }

    expect(sourceRefusal(waiting)).toBe('AniList has 2 changes still waiting to be sent')
    expect(planSync([waiting, stub], 'anilist', ['stub'])).toEqual({ source: 'anilist', refusal: 'AniList has 2 changes still waiting to be sent', targets: [] })
    expect(sourceRefusal(anilist), 'the control: nothing waiting').toBeUndefined()
  })

  test('an AMBIGUOUS or SIGNED_OUT tracker is neither a source nor a target', () => {
    const ambiguous = answer('anilist', null, { state: 'AMBIGUOUS' })
    const signedOut = answer('mal', null, { state: 'SIGNED_OUT', tracker: { id: 'mal', name: 'MyAnimeList', canWrite: false } })

    expect(sourceRefusal(ambiguous)).toBe('AniList names two entries for this media and cannot tell which one is meant')
    expect(sourceRefusal(signedOut)).toBe('Sign in to MyAnimeList first')
    expect(targetRefusal(ambiguous)).toBe('AniList names two entries for this media and cannot tell which one is meant')
    expect(targetRefusal(signedOut)).toBe('Sign in to MyAnimeList first')

    expect(sourceRefusal({ ...anilist, state: 'AMBIGUOUS' }), 'whatever entry the answer still carries').toBe('AniList names two entries for this media and cannot tell which one is meant')

    const plan = planSync([stub, ambiguous, signedOut], 'stub', ['anilist', 'mal'])
    expect(plan.targets).toEqual([
      { tracker: 'anilist', refusal: 'AniList names two entries for this media and cannot tell which one is meant', changes: [], held: [], entry: null },
      { tracker: 'mal', refusal: 'Sign in to MyAnimeList first', changes: [], held: [], entry: null },
    ])
  })

  test('a tracker that lists nothing is a target and never a source: deletes are not synced', () => {
    const nothing = answer('anilist', null)
    expect(sourceRefusal(nothing)).toBe('AniList lists nothing for this media')
    expect(targetRefusal(nothing)).toBeUndefined()
  })

  test('a target that takes no writes', () => {
    const readOnly = answer('mal', { progress: 1 }, { tracker: { id: 'mal', name: 'MyAnimeList', canWrite: false } })
    expect(targetRefusal(readOnly)).toBe('MyAnimeList takes no writes')
    expect(sourceRefusal(readOnly), 'it can still be copied from').toBeUndefined()
  })

  test('the source is never its own target, and an unknown one is refused', () => {
    const plan = planSync([stub, anilist], 'anilist', ['anilist', 'stub', 'nope'])
    expect(plan.targets.map(({ tracker, refusal }) => [tracker, refusal])).toEqual([['stub', undefined], ['nope', 'There is no tracker called nope']])
  })
})

describe('where the trackers differ', () => {
  test('every field a sync would change, with each tracker\'s value in its own terms', () => {
    expect(differences([stub, anilist])).toEqual([
      { field: 'STATUS', cells: [{ tracker: 'stub', text: 'Watching' }, { tracker: 'anilist', text: 'Completed' }] },
      { field: 'PROGRESS', cells: [{ tracker: 'stub', text: '5 / 12' }, { tracker: 'anilist', text: '12 / 12' }] },
      { field: 'SCORE', cells: [{ tracker: 'stub', text: '80%' }, { tracker: 'anilist', text: '9.0 / 10' }] },
      { field: 'STARTED_AT', cells: [{ tracker: 'stub', text: '2026-09-01' }, { tracker: 'anilist', text: '2026-08-30' }] },
      { field: 'COMPLETED_AT', cells: [{ tracker: 'stub', text: null }, { tracker: 'anilist', text: '2026-09-20' }] },
      { field: 'REWATCH_COUNT', cells: [{ tracker: 'stub', text: null }, { tracker: 'anilist', text: '1' }] },
    ])
  })

  test('a tracker that lists nothing differs from one that does, and one that could not answer is left out', () => {
    const fields = differences([stub, answer('anilist', null), answer('mal', null, { state: 'AMBIGUOUS' })])
    expect(fields.map(({ field }) => field)).toEqual(['STATUS', 'PROGRESS', 'SCORE', 'STARTED_AT'])
    expect(fields[0]!.cells.map(({ tracker }) => tracker)).toEqual(['stub', 'anilist'])
  })

  test('nothing when fewer than two answered, or when they agree', () => {
    expect(differences([stub, answer('mal', null, { state: 'SIGNED_OUT' })])).toEqual([])
    expect(differences([stub, answer('other', { ...stub.entry })])).toEqual([])
  })
})

describe('applying a sync', () => {
  test('writes each target alone with its own write, and one failing does not stop the others', async () => {
    const third = answer('third', null)
    const fourth = answer('fourth', null)
    const plan = planSync([anilist, stub, third, fourth], 'anilist', ['stub', 'third', 'fourth'])
    const write = vi.fn(async (tracker: string) => {
      if (tracker === 'third') throw new Error('The list service answered 503')
      if (tracker === 'fourth') return [{ tracker, outcome: 'FAILED', error: 'Too many requests' }]
      return [{ tracker, outcome: 'SAVED', error: null }]
    })

    const outcomes = await applySync(plan, write)

    expect(outcomes).toEqual([
      { tracker: 'stub', outcome: 'SAVED', error: null },
      { tracker: 'third', outcome: 'FAILED', error: 'The list service answered 503' },
      { tracker: 'fourth', outcome: 'FAILED', error: 'Too many requests' },
    ])
    expect(write.mock.calls.map(([tracker]) => tracker)).toEqual(['stub', 'third', 'fourth'])
    expect(write).toHaveBeenCalledWith('stub', plan.targets[0]!.entry)
  })

  test('a write that failed before reaching any tracker is reported under the target it was for', async () => {
    const plan = planSync([anilist, stub], 'anilist', ['stub'])
    const outcomes = await applySync(plan, async () => [{ tracker: '', outcome: 'FAILED', error: 'The write did not reach the trackers' }])
    expect(outcomes).toEqual([{ tracker: 'stub', outcome: 'FAILED', error: 'The write did not reach the trackers' }])
  })

  test('writes nothing for a refused source, a refused target, or a target with nothing to change', async () => {
    const write = vi.fn(async (tracker: string) => [{ tracker, outcome: 'SAVED' }])

    await applySync(planSync([{ ...anilist, pending: 1 }, stub], 'anilist', ['stub']), write)
    await applySync(planSync([anilist, answer('stub', null, { state: 'SIGNED_OUT' })], 'anilist', ['stub']), write)
    await applySync(planSync([anilist, answer('same', { ...anilist.entry }, { scale: 'POINT_10_DECIMAL' })], 'anilist', ['same']), write)

    expect(write).not.toHaveBeenCalled()
  })
})
