// What a follower tells the host about its player, and how the host reads it back. Pure, so the
// thresholds are pinned on values: the cases are the ones measured on torrents through
// torrent.fkn.app on 2026-10-20 and 2026-10-22, where the video said it had enough data with under
// 5 s loaded every time.
import { describe, expect, test } from 'vite-plus/test'

import { bufferedAhead, readiness, READY_AHEAD_S, shownStatus, STALL_AHEAD_S, statusMoved, statusTime } from '../../../src/party/status'

const PAGE = '/watch/a/b'
const buffer = (ranges: [number, number][], readyState = 4) => ({ time: 600, readyState, ranges })

describe('bufferedAhead', () => {
  test('the seconds held past a time, in the range holding it', () => {
    expect(bufferedAhead([[0, 31.5], [598, 640]], 600)).toBe(40)
    expect(bufferedAhead([[0, 31.5], [598, 640]], 100)).toBe(0)
    expect(bufferedAhead([], 600)).toBe(0)
  })

  // a follower is placed within the seek tolerance of the host, so its range can start just after
  // the host's second and still be the one it plays from
  test('a range starting just after the time still holds it', () => {
    expect(bufferedAhead([[600.3, 640]], 600)).toBeCloseTo(40)
    expect(bufferedAhead([[602, 640]], 600)).toBe(0)
  })
})

describe('readiness', () => {
  test('enough data with under 4 s loaded is still loading, the measured torrent case', () => {
    expect(readiness(undefined, buffer([[596.03, 600 + 3.97]]), 600)).toBe('loading')
  })

  test(`${READY_AHEAD_S} s loaded at the party's second is ready`, () => {
    expect(readiness(undefined, buffer([[590, 600 + READY_AHEAD_S]]), 600)).toBe('ready')
    expect(readiness('loading', buffer([[590, 600 + READY_AHEAD_S - 0.1]]), 600)).toBe('loading')
  })

  test('everything up to the end is ready, however little is left', () => {
    expect(readiness(undefined, buffer([[1400, 1420]]), 1417, 1420)).toBe('ready')
    expect(readiness(undefined, buffer([[1400, 1418]]), 1417, 1420)).toBe('loading')
  })

  // Two torrents through torrent.fkn.app (Sintel, and a 1080p mkv from the swarm), held paused 6 s
  // before the end, 2026-10-23: once loaded to the end, the last range ended exactly at the duration
  // the player reported, which moved there from the file's own when the stream ended.
  test('a torrent loaded to its end is ready, and one a moment short of it not yet', () => {
    expect(readiness(undefined, { time: 1415.418, readyState: 4, ranges: [[1414, 1421.5]] }, 1415.418, 1421.5)).toBe('ready')
    expect(readiness(undefined, { time: 1415.418, readyState: 4, ranges: [[1414, 1421.2]] }, 1415.418, 1421.5)).toBe('loading')
  })

  test(`ready stays ready down to ${STALL_AHEAD_S} s, so a follower playing on a thin buffer does not flicker`, () => {
    expect(readiness('ready', buffer([[590, 605]]), 600)).toBe('ready')
    expect(readiness('ready', buffer([[590, 600 + STALL_AHEAD_S - 0.1]]), 600)).toBe('loading')
  })

  test('a player waiting for data, or one that cannot say, is loading', () => {
    expect(readiness('ready', buffer([[590, 640]], 2), 600)).toBe('loading')
    expect(readiness('ready', undefined, 600)).toBe('loading')
  })
})

describe('statusTime', () => {
  test('moves by its rate since it was said, and a still player not at all', () => {
    expect(statusTime({ s: 'ready', path: PAGE, time: 100, rate: 1 }, 5_000)).toBe(105)
    expect(statusTime({ s: 'ready', path: PAGE, time: 100, rate: 1.5 }, 2_000)).toBe(103)
    expect(statusTime({ s: 'ready', path: PAGE, time: 100, rate: 0 }, 5_000)).toBe(100)
    expect(statusTime({ s: 'loading', path: PAGE }, 5_000)).toBeUndefined()
  })
})

describe('statusMoved', () => {
  const told = { s: 'ready', path: PAGE, time: 100, rate: 1 } as const

  test('a player going where the last status said is no news', () => {
    expect(statusMoved(told, { ...told, time: 105.4 }, 5_000)).toBe(false)
    expect(statusMoved(told, { ...told, time: 105.2, rate: 1.05 }, 5_000)).toBe(false)
    expect(statusMoved({ s: 'away' }, { s: 'away' }, 5_000)).toBe(false)
  })

  test('another state, another page, a seek, a pause or a time gained or lost is', () => {
    expect(statusMoved(told, { ...told, s: 'loading' }, 1_000)).toBe(true)
    expect(statusMoved(told, { ...told, path: '/watch/a/c', time: 101 }, 1_000)).toBe(true)
    expect(statusMoved(told, { ...told, time: 400 }, 1_000)).toBe(true)
    expect(statusMoved(told, { ...told, time: 100.2, rate: 0 }, 200)).toBe(true)
    expect(statusMoved({ ...told, rate: 0 }, { ...told, time: 100.2 }, 200)).toBe(true)
    expect(statusMoved(told, { ...told, time: 101.5 }, 0)).toBe(true)
    expect(statusMoved(told, { s: 'ready', path: PAGE }, 1_000)).toBe(true)
  })
})

describe('shownStatus', () => {
  test('a follower on the host\'s page shows its state and where its player is now', () => {
    expect(shownStatus({ s: 'ready', path: PAGE, time: 100, rate: 1 }, 3_000, PAGE)).toEqual({ s: 'ready', time: 103 })
    expect(shownStatus({ s: 'loading', path: PAGE }, 3_000, PAGE)).toEqual({ s: 'loading' })
    expect(shownStatus({ s: 'away', path: PAGE, time: 50, rate: 0 }, 3_000, PAGE)).toEqual({ s: 'away', time: 50 })
  })

  // the host moved on and the follower has not caught up yet: last episode's Ready is not this one's
  test('a status about another page is loading, and away stays away, with no time', () => {
    expect(shownStatus({ s: 'ready', path: '/watch/a/a', time: 1400, rate: 1 }, 1_000, PAGE)).toEqual({ s: 'loading' })
    expect(shownStatus({ s: 'away' }, 1_000, PAGE)).toEqual({ s: 'away' })
  })
})
