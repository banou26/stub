import { describe, expect, test } from 'vite-plus/test'

import type { CompactAnswer, CompactTracking, Row } from '../../../src/tracking/compact'

import { patchFor } from '../../../src/tracking/compact'
import { WATCHED_AT, watchedFields, watchedPatches } from '../../../src/tracking/watched'

const entry = (status: string | null, progress: number, total: number | null = 12) => ({ status, progress, total })
const at = (episode: number, played = 0.9) => ({ played, episode })

describe('watchedFields', () => {
  test(`an episode counts once ${WATCHED_AT * 100}% of it has played, and not before`, () => {
    expect(WATCHED_AT).toBe(0.85)
    expect(watchedFields(at(5, 0.84), entry('WATCHING', 4))).toBeUndefined()
    expect(watchedFields(at(5, 0.85), entry('WATCHING', 4))).toEqual({ progress: 5 })
  })

  test('a show on no list is added as Watching, at the episode', () => {
    expect(watchedFields(at(5), entry(null, 0))).toEqual({ progress: 5, status: 'WATCHING' })
  })

  test('its last episode marks it Completed, listed or not', () => {
    expect(watchedFields(at(12), entry(null, 0))).toEqual({ progress: 12, status: 'COMPLETED' })
    expect(watchedFields(at(12), entry('WATCHING', 11))).toEqual({ progress: 12, status: 'COMPLETED' })
  })

  test('Plan to watch, Paused and Dropped become Watching; Watching and Rewatching keep their status', () => {
    for (const status of ['PLANNING', 'PAUSED', 'DROPPED']) expect(watchedFields(at(5), entry(status, 2)), status).toEqual({ progress: 5, status: 'WATCHING' })
    for (const status of ['WATCHING', 'REWATCHING']) expect(watchedFields(at(5), entry(status, 2)), status).toEqual({ progress: 5 })
  })

  test('a Completed show is left untouched on a rewatch', () => {
    expect(watchedFields(at(1), entry('COMPLETED', 12))).toBeUndefined()
    expect(watchedFields(at(12), entry('COMPLETED', 3))).toBeUndefined()
  })

  test('the count only rises: an episode at or under the progress writes nothing', () => {
    expect(watchedFields(at(5), entry('WATCHING', 5))).toBeUndefined()
    expect(watchedFields(at(3), entry('PAUSED', 7))).toBeUndefined()
  })

  // Made in Abyss season 2 on anime.fkn.app, 2026-10-15: episodes 1 to 12, then 14 and 15, on a 12 episode entry
  test('an episode past the tracker\'s count is skipped, never clamped to the last one', () => {
    expect(watchedFields(at(14), entry('WATCHING', 11))).toBeUndefined()
    expect(watchedFields(at(15), entry(null, 0))).toBeUndefined()
    // the control: the row's own write path clamps it, which would read as the whole show watched
    const answer = { state: 'LISTED', candidates: [], tracker: { id: 'a', name: 'a', canWrite: true }, entry: { status: 'WATCHING', progress: 11 } } as CompactAnswer
    const row: Row = { status: 'WATCHING', progress: 11, score: null, total: 12, differs: [] }
    expect(patchFor(answer, { progress: 14 }, row)).toEqual({ progress: 12 })
  })

  test('no episode number, or one that is not a whole episode, writes nothing', () => {
    expect(watchedFields({ played: 1 }, entry(null, 0))).toBeUndefined()
    expect(watchedFields(at(0), entry(null, 0))).toBeUndefined()
    expect(watchedFields(at(5.5), entry('WATCHING', 5))).toBeUndefined()
  })

  test('with no count anywhere, the episode is written and nothing is ever Completed', () => {
    expect(watchedFields(at(300), entry('WATCHING', 299, null))).toEqual({ progress: 300 })
  })

  test('a movie is Completed with progress 1, unless it already is', () => {
    expect(watchedFields({ played: 0.9, movie: true }, entry(null, 0, 1))).toEqual({ status: 'COMPLETED', progress: 1 })
    expect(watchedFields({ played: 0.9, movie: true }, entry('PLANNING', 0, null))).toEqual({ status: 'COMPLETED', progress: 1 })
    expect(watchedFields({ played: 0.9, movie: true }, entry('COMPLETED', 1, 1))).toBeUndefined()
    expect(watchedFields({ played: 0.5, movie: true }, entry(null, 0, 1))).toBeUndefined()
  })
})

const answer = (id: string, state: string, entry?: CompactAnswer['entry'], extra: Partial<CompactAnswer> = {}): CompactAnswer =>
  ({ state, candidates: [], tracker: { id, name: id, canWrite: true }, entry, ...extra })
const tracking = (...answers: CompactAnswer[]): CompactTracking => ({ summary: null, disagreements: [], answers })

describe('watchedPatches', () => {
  test('each checked tracker gets what its own entry needs', () => {
    expect(watchedPatches(at(5), tracking(
      answer('anilist', 'LISTED', { status: 'WATCHING', progress: 4, episodeCount: 12 }),
      answer('mal', 'LISTED', { status: 'PLANNING', progress: 0, episodeCount: 12 }),
      answer('stub', 'NOT_LISTED'),
      answer('kitsu', 'LISTED', { status: 'WATCHING', progress: 7, episodeCount: 12 }),
    ), {}, 12)).toEqual({
      anilist: { progress: 5 },
      mal: { progress: 5, status: 'WATCHING' },
      stub: { progress: 5, status: 'WATCHING' },
    })
  })

  // a paused or failing one is in, for the page to say it was not saved; only a writable one is sent it
  test('only to the trackers checked in the row: not one unchecked, signed out or read only', () => {
    expect(watchedPatches(at(5), tracking(
      answer('anilist', 'NOT_LISTED'),
      answer('mal', 'SIGNED_OUT'),
      answer('kitsu', 'PAUSED'),
      answer('annict', 'ERROR'),
      answer('simkl', 'NOT_LISTED', null, { tracker: { id: 'simkl', name: 'simkl', canWrite: false, readOnly: true } }),
      answer('stub', 'NOT_LISTED'),
    ), { anilist: false }, 12)).toEqual({
      kitsu: { progress: 5, status: 'WATCHING' },
      annict: { progress: 5, status: 'WATCHING' },
      stub: { progress: 5, status: 'WATCHING' },
    })
  })

  // Crunchyroll's own history: its progress shows in the row and never changes the others by itself
  test('never to a read-only tracker, behind, listing nothing or failing, and the others go by their own entries', () => {
    const readOnly = (state: string, entry?: CompactAnswer['entry'], error?: string) =>
      answer('cr', state, entry, { error, tracker: { id: 'cr', name: 'Crunchyroll', canWrite: false, readOnly: true } })
    const others = [answer('anilist', 'LISTED', { status: 'WATCHING', progress: 3, episodeCount: 12 }), answer('stub', 'NOT_LISTED')]
    for (const cr of [readOnly('LISTED', { progress: 2 }), readOnly('NOT_LISTED'), readOnly('ERROR', null, 'Crunchyroll answered 503')]) {
      expect(watchedPatches(at(5), tracking(...others, cr), { cr: true }, 12), cr.state).toEqual({
        anilist: { progress: 5 },
        stub: { progress: 5, status: 'WATCHING' },
      })
    }
    const ahead = { summary: { status: 'WATCHING', progress: 8, episodeCount: 12 }, disagreements: ['PROGRESS'], answers: [...others, readOnly('LISTED', { progress: 8 })] }
    expect(watchedPatches(at(5), ahead, {}, 12), 'its progress ahead of the others raises nothing').toEqual({
      anilist: { progress: 5 },
      stub: { progress: 5, status: 'WATCHING' },
    })
  })

  test('not to a tracker that has not answered yet, nor to one with no id for the media', () => {
    expect(watchedPatches(at(5), tracking(
      answer('anilist', 'LOADING'),
      answer('mal', 'NO_ID'),
      answer('stub', 'NOT_LISTED'),
    ), {}, 12)).toEqual({ stub: { progress: 5, status: 'WATCHING' } })
  })

  test('a show the row reads as Completed is left untouched on every tracker, the ones that do not list it too', () => {
    const answers = [
      answer('anilist', 'LISTED', { status: 'COMPLETED', progress: 12, episodeCount: 12 }),
      answer('mal', 'LISTED', { status: 'WATCHING', progress: 5, episodeCount: 12 }),
      answer('stub', 'NOT_LISTED'),
    ]
    const completed = { summary: { status: 'COMPLETED', progress: 12, episodeCount: 12 }, disagreements: ['STATUS', 'PROGRESS'], answers }
    expect(watchedPatches(at(1), completed, {}, 12)).toEqual({})
    expect(watchedPatches(at(6), completed, {}, 12)).toEqual({})
    // the control: read tracker by tracker, the rewatch would add it to the others
    expect(watchedPatches(at(6), { ...completed, summary: null }, {}, 12)).toEqual({ mal: { progress: 6 }, stub: { progress: 6, status: 'WATCHING' } })
  })

  test('not to a tracker that counts the media in other episodes than the page', () => {
    expect(watchedPatches(at(5), tracking(
      answer('anilist', 'NOT_LISTED', null, { episodeCount: 24 }),
      answer('mal', 'NOT_LISTED', null, { episodeCount: 12 }),
    ), {}, 12)).toEqual({ mal: { progress: 5, status: 'WATCHING' } })
  })

  test('the last episode is read on the tracker\'s own count, else the page\'s', () => {
    expect(watchedPatches(at(12), tracking(answer('stub', 'NOT_LISTED')), {}, 12)).toEqual({ stub: { progress: 12, status: 'COMPLETED' } })
    expect(watchedPatches(at(12), tracking(answer('stub', 'NOT_LISTED')), {}, null)).toEqual({ stub: { progress: 12, status: 'WATCHING' } })
  })
})
