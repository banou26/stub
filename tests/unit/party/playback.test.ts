// The numbers that decide between a follower that keeps changing speed and one that drifts are here, so they are
// pinned with the cases on both sides of them.
import { describe, expect, test } from 'vite-plus/test'

import type { PlaybackState } from '../../../src/party/protocol'

import type { Follow, PlaybackCorrection } from '../../../src/party/playback'

import { CATCH_UP_LIMIT_S, CATCH_UP_S, DEAD_BAND_S, FILTER_SIZE, NUDGE_RATE, SEEK_TOLERANCE_S, advance, askedState, expectedTime, followCorrection, personAction, playbackCorrection } from '../../../src/party/playback'

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

  // what the host's player does with a follower's ask, and what a follower does when the host moved
  test('seeks past the tolerance and leaves the player alone inside it, never off the host\'s speed', () => {
    expect(playbackCorrection({ paused: false, time: 100 - SEEK_TOLERANCE_S + 0.1, rate: 1 }, wanted, NOW)).toEqual({})
    expect(playbackCorrection({ paused: false, time: 100 + SEEK_TOLERANCE_S - 0.1, rate: 1 }, wanted, NOW)).toEqual({})
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
  // to a quarter second stale, and nothing corrects the host afterwards: a speed off the asked one here
  // would leave the whole party at it.
  test('a new speed is set exactly', () => {
    expect(playbackCorrection({ paused: false, time: 100 - 0.2, rate: 1 }, { ...wanted, rate: 1.5 }, NOW)).toEqual({ rate: 1.5 })
    expect(playbackCorrection({ paused: false, time: 100 + 0.2, rate: 1.5 }, wanted, NOW)).toEqual({ rate: 1 })
  })
})

type Change = { at: number, host?: Partial<PlaybackState>, seekBy?: number, stall?: number, jump?: number, misread?: number }

/**
 * A follower applying the host every two seconds for `seconds`, as its heartbeats and the host's messages have it
 * do, through `followCorrection`. The host plays on from 100 s, the follower's player at whatever speed the rule
 * left it; each change happens at its second: the host's state changes, the host seeks, the player stalls (and
 * stands still that long), the player jumps, or the host's report is off by that much for one apply. Says what the
 * rule did and where the two ended.
 */
const run = (seconds: number, changes: Change[] = [], host: Partial<PlaybackState> = {}) => {
  let wanted: PlaybackState = { paused: false, time: 100, rate: 1, at: NOW, ...host }
  const local = { paused: wanted.paused, time: 100, rate: wanted.rate }
  let follow: Follow | undefined
  const done: PlaybackCorrection[] = []
  for (let second = 0; second <= seconds; second += 2) {
    const now = NOW + second * 1000
    let misread = 0
    for (const change of changes.filter(change => change.at === second)) {
      wanted = { ...wanted, ...change.host, time: wanted.time + (change.seekBy ?? 0) }
      local.time -= change.stall ?? 0
      local.time += change.jump ?? 0
      misread += change.misread ?? 0
    }
    wanted = { ...wanted, at: now }
    const step = followCorrection(follow, local, { ...wanted, time: wanted.time + misread }, now)
    follow = step.follow
    const { correction } = step
    if (Object.keys(correction).length) done.push(correction)
    if (correction.seek !== undefined) local.time = correction.seek
    if (correction.rate !== undefined) local.rate = correction.rate
    if (correction.play) local.paused = false
    if (correction.pause) local.paused = true
    if (!wanted.paused) wanted = { ...wanted, time: wanted.time + 2 * wanted.rate }
    if (!local.paused) local.time += 2 * local.rate
  }
  return { done, drift: wanted.time - local.time }
}

describe('followCorrection', () => {
  test('a follower inside the dead band is left alone', () => {
    expect(run(120, [{ at: 10, stall: DEAD_BAND_S - 0.05 }]).done).toEqual([])
    expect(run(120, [{ at: 10, stall: -(DEAD_BAND_S - 0.05) }]).done).toEqual([])
  })

  // a host's player read up to a quarter second stale, and one report off by more than the band, are samples of five
  test('jitter alone, an outlier included, changes nothing', () => {
    const jitter = [0.2, -0.15, 0.1, -0.2, 0.45, 0.2, -0.1, 0.15, -0.2, 0.05].map((misread, index) => ({ at: 10 + index * 2, misread }))
    expect(run(120, [...jitter, ...jitter.map(change => ({ ...change, at: change.at + 40 }))]).done).toEqual([])
  })

  // a reading is off by time, so at 2x the same quarter second stale is half a second of media
  test('the same jitter at 2x changes nothing either', () => {
    const jitter = [0.4, -0.3, 0.2, -0.4, 0.9, 0.4, -0.2, 0.3, -0.4, 0.1].map((misread, index) => ({ at: 10 + index * 2, misread }))
    expect(run(120, [...jitter, ...jitter.map(change => ({ ...change, at: change.at + 40 }))], { rate: 2 }).done).toEqual([])
  })

  test('at 2x, a host report 0.4 s off is no jump of the host\'s, as at 1x', () => {
    expect(run(120, [{ at: 10, stall: 0.6 }, { at: 12, misread: 0.4 }]).done).toEqual([{ rate: NUDGE_RATE }, { rate: 1 }])
    expect(run(120, [{ at: 10, stall: 1.2 }, { at: 12, misread: 0.8 }], { rate: 2 }).done).toEqual([{ rate: 2 * NUDGE_RATE }, { rate: 2 }])
  })

  test('a steady 2 s drift is closed by one gentle catch-up, then the host\'s speed', () => {
    const { done, drift } = run(180, [{ at: 10, stall: 2 }])
    expect(done).toEqual([{ rate: NUDGE_RATE }, { rate: 1 }])
    expect(Math.abs(drift)).toBeLessThan(0.15)
  })

  test('the catch-up speed is scaled to the drift, either side of the host\'s speed', () => {
    const rates = (done: PlaybackCorrection[]) => done.map(correction => correction.rate?.toFixed(4))
    expect(rates(run(120, [{ at: 10, stall: 0.45 }]).done)).toEqual([(1 + 0.45 / CATCH_UP_S).toFixed(4), '1.0000'])
    expect(rates(run(120, [{ at: 10, stall: -0.45 }]).done)).toEqual([(1 / (1 + 0.45 / CATCH_UP_S)).toFixed(4), '1.0000'])
    const fast = run(120, [{ at: 10, stall: 2 }], { rate: 2 }).done
    expect(fast).toEqual([{ rate: 2 * NUDGE_RATE }, { rate: 2 }])
  })

  // most of the last FILTER_SIZE drifts out of the band, read again from nothing after the player changed
  test('a catch-up waits for the drift to stay out', () => {
    expect(run(12, [{ at: 10, stall: 2 }]).done).toEqual([])
    expect(run(14, [{ at: 10, stall: 2 }]).done).toEqual([{ rate: NUDGE_RATE }])
    const seeked = [{ at: 20, seekBy: 10 }, { at: 22, stall: 2 }]
    expect(run(20 + FILTER_SIZE * 2 - 2, seeked).done).toEqual([{ seek: 130 }])
    expect(run(20 + FILTER_SIZE * 2, seeked).done).toEqual([{ seek: 130 }, { rate: NUDGE_RATE }])
  })

  test('the host\'s 10 s jump, or 2 s one, is one seek at once', () => {
    expect(run(120, [{ at: 20, seekBy: 10 }])).toEqual({ done: [{ seek: 130 }], drift: 0 })
    expect(run(120, [{ at: 20, seekBy: -2 }])).toEqual({ done: [{ seek: 118 }], drift: 0 })
  })

  // a person's seek the host did not take, or the player rebuilding somewhere else: put back as the host's own jump
  test('the player\'s own jump of under 3 s either way is undone with one seek at once', () => {
    expect(run(120, [{ at: 20, jump: 2 }])).toEqual({ done: [{ seek: 120 }], drift: 0 })
    // back, it shows only once it lands behind where the player was last read: closer, it is a stall standing still
    expect(run(120, [{ at: 20, jump: -2.5 }])).toEqual({ done: [{ seek: 120 }], drift: 0 })
  })

  test('a stall past the limit is a seek, since a catch-up would take minutes', () => {
    expect(run(120, [{ at: 20, stall: CATCH_UP_LIMIT_S + 1 }])).toEqual({ done: [{ seek: 120 }], drift: 0 })
  })

  test('a paused follower is never caught up, and the host\'s pause is followed at once', () => {
    expect(run(120, [{ at: 10, stall: 0.45 }, { at: 12, host: { paused: true } }]).done).toEqual([{ pause: true }])
  })

  // paused, the gap would stay for as long as the party is
  test('the host\'s pause puts a follower a second off where the host paused', () => {
    expect(run(120, [{ at: 10, stall: 1 }, { at: 12, host: { paused: true } }])).toEqual({ done: [{ seek: 112, pause: true }], drift: 0 })
  })

  // following again or Catch up: the viewer asked to be with the host now, not in a minute
  test('exact puts a follower 2 s behind where the host is at once', () => {
    const { follow } = followCorrection(undefined, { paused: false, time: 100, rate: 1 }, { paused: false, time: 100, rate: 1, at: NOW }, NOW)
    const local = { paused: false, time: 100, rate: 1 }
    const wanted = { paused: false, time: 102, rate: 1, at: NOW + 2_000 }
    expect(followCorrection(follow, local, wanted, NOW + 2_000).correction).toEqual({})
    expect(followCorrection(follow, local, wanted, NOW + 2_000, true).correction).toEqual({ seek: 102 })
  })

  // a speed is no jump: the follower takes it without a seek, and closes what is left at the new speed
  test('the host\'s new speed mid catch-up is taken exactly, and the rest is caught up at it', () => {
    const { done, drift } = run(180, [{ at: 10, stall: 2 }, { at: 30, host: { rate: 1.5 } }])
    expect(done).toEqual([{ rate: NUDGE_RATE }, { rate: 1.5 }, { rate: 1.5 * NUDGE_RATE }, { rate: 1.5 }])
    expect(Math.abs(drift)).toBeLessThan(0.15)
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
