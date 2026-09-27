// How an AniList answer becomes a stub list entry, and a stub write an AniList one.
import { describe, expect, test } from 'vitest'

import { listEntryOf, readResponse, saveRequest, scoreLabel } from '../../../../src/sources/anilist/list-api'
import { FRIEREN, FRIEREN_ENTRY, SIGNED_OUT_BODY } from './list-fixtures'

const argumentsOf = (query: string) => /SaveMediaListEntry\(([^)]*)\)/.exec(query)?.[1]?.split(', ').map(arg => arg.split(':')[0])

describe('a save as AniList takes it', () => {
  test('sends the fields named and no other, the score as scoreRaw on the 0 to 100 scale', () => {
    const built = saveRequest(154587, { status: 'REWATCHING', progress: 3, score: 85 })
    if ('error' in built) throw new Error(built.error)

    expect(built.request.variables).toEqual({ mediaId: 154587, status: 'REPEATING', progress: 3, scoreRaw: 85 })
    expect(argumentsOf(built.request.query)).toEqual(['mediaId', 'status', 'progress', 'scoreRaw'])
    expect(built.request.query).toContain('$scoreRaw: Int')
  })

  test.each([
    ['WATCHING', 'CURRENT'],
    ['REWATCHING', 'REPEATING'],
    ['PLANNING', 'PLANNING'],
    ['COMPLETED', 'COMPLETED'],
    ['PAUSED', 'PAUSED'],
    ['DROPPED', 'DROPPED'],
  ] as const)('writes %s as %s, and reads it back as %s', (status, anilist) => {
    const built = saveRequest(1, { status })
    if ('error' in built) throw new Error(built.error)
    expect(built.request.variables!.status).toBe(anilist)
    expect(listEntryOf('POINT_100', FRIEREN, { ...FRIEREN_ENTRY, status: anilist }).status).toBe(status)
  })

  test('an explicit null clears the score, the counts and the dates, and cannot clear a status', () => {
    const built = saveRequest(1, { status: null, progress: null, score: null, rewatchCount: null, startedAt: null, completedAt: { year: 2026, month: 9 } })
    if ('error' in built) throw new Error(built.error)
    expect(built.request.variables).toEqual({
      mediaId: 1,
      progress: 0,
      scoreRaw: 0,
      repeat: 0,
      startedAt: { year: null, month: null, day: null },
      completedAt: { year: 2026, month: 9, day: null },
    })
  })

  // an entry the viewer keeps private on AniList stays private whatever stub saves on it
  test('never sends private, notes or custom lists', () => {
    const built = saveRequest(1, { status: 'COMPLETED', progress: 28, score: 90, rewatchCount: 1 })
    if ('error' in built) throw new Error(built.error)
    expect(argumentsOf(built.request.query)).not.toContain('private')
    expect(built.request.query).not.toMatch(/\$(private|notes|customLists|hiddenFromStatusLists)/)
  })

  test.each([
    [{ progress: -1 }, 'Progress'],
    [{ progress: 1.5 }, 'Progress'],
    [{ score: 101 }, 'score'],
    [{ rewatchCount: -2 }, 'rewatch'],
  ])('refuses %o before anything is sent', (entry, reason) => {
    const built = saveRequest(1, entry)
    expect('error' in built && built.error).toContain(reason)
  })
})

describe('an AniList entry as stub shows it', () => {
  test('keeps its own id, its own episode count and the score both ways', () => {
    expect(listEntryOf('POINT_10_DECIMAL', FRIEREN, FRIEREN_ENTRY)).toEqual({
      _id: 'anilist:398761234',
      tracker: 'anilist',
      mediaUri: 'anilist:154587',
      status: 'WATCHING',
      progress: 12,
      score: 85,
      scoreLabel: '8.5 / 10',
      startedAt: { year: 2026, month: 1, day: 10 },
      completedAt: null,
      rewatchCount: 0,
      updatedAt: '2026-09-20T12:00:00.000Z',
      url: 'https://anilist.co/anime/154587',
      title: 'Sousou no Frieren',
      cover: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg',
      episodeCount: 28,
    })
  })

  test('reads AniList 0 as no score', () => {
    const entry = listEntryOf('POINT_100', FRIEREN, { ...FRIEREN_ENTRY, score: 0, scoreRaw: 0 })
    expect(entry.score).toBeNull()
    expect(entry.scoreLabel).toBeNull()
  })

  test.each([
    [85, 'POINT_100', '85 / 100'],
    [8.5, 'POINT_10_DECIMAL', '8.5 / 10'],
    [9, 'POINT_10', '9 / 10'],
    [4, 'POINT_5', '4 / 5'],
    [1, 'POINT_3', ':('],
    [2, 'POINT_3', ':|'],
    [3, 'POINT_3', ':)'],
    [0, 'POINT_10', null],
  ])('labels %s in %s as %s', (score, format, label) => {
    expect(scoreLabel(score, format)).toBe(label)
  })
})

describe('what an AniList answer said', () => {
  test('a 401 is signed out, as anilist.co answered a signed-out Viewer', () => {
    expect(readResponse(401, SIGNED_OUT_BODY)).toEqual({ kind: 'signed-out' })
    expect(readResponse(200, { errors: [{ message: 'Unauthorized.', status: 401 }], data: null })).toEqual({ kind: 'signed-out' })
  })

  test('a 429 is a rate limit, in the status or in the body', () => {
    expect(readResponse(429, null)).toEqual({ kind: 'rate-limited' })
    expect(readResponse(200, { errors: [{ message: 'Too Many Requests.', status: 429 }] })).toEqual({ kind: 'rate-limited' })
  })

  test('errors inside a 200 are errors, with what AniList said', () => {
    const validation = { errors: [{ message: 'validation', status: 400, validation: { id: ['The selected id is invalid.'] } }], data: { DeleteMediaListEntry: null } }
    expect(readResponse(400, validation)).toEqual({ kind: 'error', message: 'AniList answered 400: validation The selected id is invalid.' })
    expect(readResponse(200, { data: null })).toEqual({ kind: 'error', message: 'AniList answered 200 with nothing to read' })
  })

  test('data is data', () => {
    expect(readResponse(200, { data: { Viewer: { id: 1 } } })).toEqual({ kind: 'data', data: { Viewer: { id: 1 } } })
  })
})
