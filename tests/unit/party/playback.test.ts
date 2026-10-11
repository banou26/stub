// The one number that decides between a follower that stutters on every heartbeat and one that
// drifts is here, so it is pinned with the cases on both sides of it.
import { describe, expect, test } from 'vite-plus/test'

import type { PlaybackState } from '../../../src/party/protocol'

import { NUDGE_FLOOR_S, NUDGE_RATE, SEEK_TOLERANCE_S, advance, askedState, expectedTime, personAction, playbackCorrection } from '../../../src/party/playback'

const NOW = 1_788_700_000_000

describe('expectedTime', () => {
  test('a playing report is moved forward by the time since it was made', () => {
    expect(expectedTime({ paused: false, time: 100, rate: 1, at: NOW - 500 }, NOW)).toBeCloseTo(100.5)
    expect(expectedTime({ paused: false, time: 100, rate: 2, at: NOW - 500 }, NOW)).toBeCloseTo(101)
  })

  test('a paused report does not move', () => {
    expect(expectedTime({ paused: true, time: 100, rate: 1, at: NOW - 30_000 }, NOW)).toBe(100)
  })

  // The host's clock and the follower's are different clocks. A report that looks minutes old is a
  // clock that is minutes off, not a video that played for minutes, and moving it forward by that
  // much would seek every follower to the wrong place on every heartbeat.
  test('the move forward is capped, so clock skew reads as transit', () => {
    expect(expectedTime({ paused: false, time: 100, rate: 1, at: NOW - 600_000 }, NOW)).toBeCloseTo(102)
    expect(expectedTime({ paused: false, time: 100, rate: 1, at: NOW + 600_000 }, NOW)).toBe(100)
  })
})

describe('playbackCorrection', () => {
  const wanted = { paused: false, time: 100, rate: 1, at: NOW }

  // Three tiers, and the middle one is the point: a follower that is merely close used to be left
  // close for ever, drifting inside the tolerance band with every heartbeat handing it back.
  test('a follower under the floor is left alone', () => {
    expect(playbackCorrection({ paused: false, time: 100 + NUDGE_FLOOR_S / 2, rate: 1 }, wanted, NOW)).toEqual({})
    expect(playbackCorrection({ paused: false, time: 100 - NUDGE_FLOOR_S / 2, rate: 1 }, wanted, NOW)).toEqual({})
  })

  test('a follower inside the tolerance closes the gap by rate, not by seeking', () => {
    // behind the host, so it runs fast until it is level
    expect(playbackCorrection({ paused: false, time: 100 - 0.3, rate: 1 }, wanted, NOW)).toEqual({ rate: NUDGE_RATE })
    // ahead of it, so it runs slow
    expect(playbackCorrection({ paused: false, time: 100 + 0.3, rate: 1 }, wanted, NOW)).toEqual({ rate: 1 / NUDGE_RATE })
    // and a nudge that did its job hands the rate back rather than leaving the player fast
    expect(playbackCorrection({ paused: false, time: 100, rate: NUDGE_RATE }, wanted, NOW)).toEqual({ rate: 1 })
  })

  test('a nudge follows the host\'s own rate rather than replacing it', () => {
    const fast = { ...wanted, rate: 2 }
    expect(playbackCorrection({ paused: false, time: 99.7, rate: 2 }, fast, NOW)).toEqual({ rate: 2 * NUDGE_RATE })
  })

  test('a paused follower is never nudged, since a rate has nothing to act on', () => {
    const stopped = { ...wanted, paused: true }
    expect(playbackCorrection({ paused: true, time: 100 - 0.3, rate: 1 }, stopped, NOW)).toEqual({})
  })

  test('and one outside it is seeked to where the host is', () => {
    expect(playbackCorrection({ paused: false, time: 100 + SEEK_TOLERANCE_S + 0.1, rate: 1 }, wanted, NOW)).toEqual({ seek: 100 })
    expect(playbackCorrection({ paused: false, time: 0, rate: 1 }, wanted, NOW)).toEqual({ seek: 100 })
  })

  test('play, pause and rate follow the host, each only when it differs', () => {
    expect(playbackCorrection({ paused: true, time: 100, rate: 1 }, wanted, NOW)).toEqual({ play: true })
    expect(playbackCorrection({ paused: false, time: 100, rate: 1 }, { ...wanted, paused: true }, NOW)).toEqual({ pause: true })
    expect(playbackCorrection({ paused: false, time: 100, rate: 1 }, { ...wanted, rate: 1.5 }, NOW)).toEqual({ rate: 1.5 })
    expect(playbackCorrection({ paused: true, time: 0, rate: 1 }, { ...wanted, rate: 1.5 }, NOW)).toEqual({ seek: 100, play: true, rate: 1.5 })
  })

  // The host answers a follower's speed ask with this against its own last report, whose time is up
  // to a quarter second stale, and nothing corrects the host afterwards: a nudge here would leave the
  // whole party at 1.575.
  test('a new speed is set exactly, never nudged in the same step', () => {
    expect(playbackCorrection({ paused: false, time: 100 - 0.2, rate: 1 }, { ...wanted, rate: 1.5 }, NOW)).toEqual({ rate: 1.5 })
    expect(playbackCorrection({ paused: false, time: 100 + 0.2, rate: 1.5 }, wanted, NOW)).toEqual({ rate: 1 })
  })
})

// A follower re-applies what the host last said whenever its own player reports, which can be many
// seconds later. Re-applied as received, a playing state seeks the player BACK by that much; found
// in review, 2026-09-07.
describe('advance', () => {
  const heard = { paused: false, time: 100, rate: 1, at: NOW - 3_000 }

  test('a playing state moves forward by the time since it was heard, on the follower’s own clock', () => {
    expect(advance(heard, NOW - 5_000, NOW)).toEqual({ paused: false, time: 105, rate: 1, at: NOW })
    expect(advance({ ...heard, rate: 2 }, NOW - 5_000, NOW)).toEqual({ paused: false, time: 110, rate: 2, at: NOW })
  })

  test('a paused state does not move, and a clock that went backwards moves nothing', () => {
    expect(advance({ ...heard, paused: true }, NOW - 60_000, NOW).time).toBe(100)
    expect(advance(heard, NOW + 1_000, NOW).time).toBe(100)
  })

  test('re-applying an advanced state seeks nothing on a follower that kept up', () => {
    const local = { paused: false, time: 105.2, rate: 1 }
    expect(playbackCorrection(local, advance(heard, NOW - 5_000, NOW), NOW).seek).toBeUndefined()
    // and as received, the same follower would have been seeked back five seconds
    expect(playbackCorrection(local, heard, NOW).seek).toBeDefined()
  })
})

describe('personAction', () => {
  const playing = { paused: false, time: 100, rate: 1, at: NOW }
  const paused = { ...playing, paused: true }
  /** The same player `ms` later, having played on. */
  const later = (ms: number, change = {}) => ({ ...playing, time: 100 + ms / 1000, at: NOW + ms, ...change })

  test('a pause away from a playing host is the person using play', () => {
    expect(personAction(playing, paused, playing)).toEqual(['play'])
    expect(personAction(paused, playing, paused)).toEqual(['play'])
  })

  // the host paused and this player is answering it, however late
  test('a pause the host also wants is nobody', () => {
    expect(personAction(playing, paused, paused)).toEqual([])
  })

  test('a report that played on is nobody', () => {
    expect(personAction(playing, later(5_000), later(5_000))).toEqual([])
  })

  // A stall leaves the player far behind the host with its time standing still. Read by distance
  // from the host, a granted follower whose player stalled would seek the whole party back.
  test('a stall is not a seek, however far behind the host it leaves the player', () => {
    expect(personAction(playing, { ...playing, at: NOW + 5_000 }, later(5_000))).toEqual([])
  })

  test('a jump 10 s back or 30 s forward is a seek', () => {
    expect(personAction(playing, later(1_000, { time: 91 }), later(1_000))).toEqual(['seek'])
    expect(personAction(playing, later(1_000, { time: 131 }), later(1_000))).toEqual(['seek'])
    // a 5 s skip back (media-player's arrow key) made 4.6 s after the last report
    expect(personAction(playing, later(4_600, { time: 99.6 }), later(4_600))).toEqual(['seek'])
    // and a paused player moved is one too
    expect(personAction(paused, { ...paused, time: 130, at: NOW + 1_000 }, paused)).toEqual(['seek'])
  })

  // the host seeked and this player is answering it
  test('a jump that lands where the host is is nobody', () => {
    expect(personAction(playing, later(1_000, { time: 131 }), later(1_000, { time: 131 }))).toEqual([])
  })

  // a nudge is the party closing a gap, never the person
  test('a nudged rate is not a speed change, 1.5 against 1 is', () => {
    expect(personAction(playing, { ...playing, rate: NUDGE_RATE }, playing)).toEqual([])
    expect(personAction({ ...playing, rate: NUDGE_RATE }, playing, playing)).toEqual([])
    expect(personAction(playing, { ...playing, rate: 1 / NUDGE_RATE }, playing)).toEqual([])
    expect(personAction(playing, { ...playing, rate: 1.5 }, playing)).toEqual(['rate'])
    // and following the host's own new speed is nobody
    expect(personAction(playing, { ...playing, rate: 1.5 }, { ...playing, rate: 1.5 })).toEqual([])
  })

  // the host's new speed lands while this player still reports its old one, or its own nudge
  test('a rate that stayed within a nudge of the last report is nobody, whatever the host wants', () => {
    expect(personAction(playing, playing, { ...playing, rate: 1.5 })).toEqual([])
    expect(personAction(playing, { ...playing, rate: NUDGE_RATE }, { ...playing, rate: 1.5 })).toEqual([])
  })
})

describe('askedState', () => {
  const ask = (c: 'play' | 'seek' | 'rate', s: Partial<PlaybackState>) => ({ t: 'ask' as const, c, path: '/', s: { paused: false, time: 3, rate: 1, at: NOW, ...s } })

  test('the host\'s own player, moved to now, with only the asked control changed', () => {
    expect(askedState({ paused: false, time: 100, rate: 1.5, at: NOW - 2_000 }, ask('play', { paused: true }), NOW)).toEqual({ paused: true, time: 103, rate: 1.5, at: NOW })
    expect(askedState({ paused: false, time: 100, rate: 1, at: NOW - 2_000 }, ask('rate', { rate: 1.5 }), NOW)).toEqual({ paused: false, time: 102, rate: 1.5, at: NOW })
    expect(askedState({ paused: true, time: 100, rate: 1, at: NOW - 2_000 }, ask('seek', { paused: true, time: 40 }), NOW)).toEqual({ paused: true, time: 40, rate: 1, at: NOW })
  })

  test('nothing when the host already does what was asked', () => {
    expect(askedState({ paused: true, time: 100, rate: 1, at: NOW }, ask('play', { paused: true }), NOW)).toBeUndefined()
    expect(askedState({ paused: false, time: 100, rate: 1, at: NOW }, ask('play', { paused: false }), NOW)).toBeUndefined()
    expect(askedState({ paused: false, time: 100, rate: 1.5, at: NOW }, ask('rate', { rate: 1.5 }), NOW)).toBeUndefined()
    expect(askedState({ paused: false, time: 100, rate: 1, at: NOW }, ask('seek', { time: 100.3 }), NOW)).toBeUndefined()
  })

  // an ask that sat a minute somewhere must not throw the party a minute past where the person put it
  test('a seek asked 60 s ago moves the host at most 2 s past it', () => {
    expect(askedState({ paused: false, time: 500, rate: 1, at: NOW }, ask('seek', { time: 100, at: NOW - 60_000 }), NOW)?.time).toBe(102)
  })
})
