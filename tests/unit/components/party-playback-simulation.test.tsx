// FIRST: ./dom installs the document @emotion/react reads at module scope.
import './dom'

import type { PartyStore } from '../../../src/party/store'
import type { Run, Scenario } from './party-playback-simulation'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { NUDGE_RATE } from '../../../src/party/playback'

// STUB-363 (watch-together sync changes the playback speed too often): a party of two through the real follower,
// with the delays and the stale readings a party meets in stub (see ./party-playback-simulation.tsx). Measured
// 2026-11-05 before the change, the same runs moved the follower's speed 25 to 34 times a minute, between 0.952,
// 1 and 1.05, and seeked it every minute or two with nothing to follow. STUB-366 (the torrent player follows a watch
// party without constant speed changes): the same through a source package's player, measured 2026-11-06 before the
// change at 19 to 28 speed changes a minute with nothing to follow, 925 seeks in five minutes at 2x, and 140 in three
// with seeks that take 6 s.

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { simulate } = await import('./party-playback-simulation')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_788_700_000_000)
  Object.assign(globalThis, { location: { pathname: '/watch/a/b', search: '' } })
  // nobody touches the player: every change it sees is the sync's
  Object.defineProperty(globalThis.navigator, 'userActivation', { configurable: true, value: { isActive: false } })
})
afterEach(() => { vi.useRealTimers() })

const SEEDS = [1, 2, 3]
// a package's heartbeat reads the mirror at the same point of its cycle every time, so its drift is read up to a
// quarter second off for minutes, where stub's own embed is read afresh at each apply
describe.each([{ player: 'stub\'s own', plugin: false, decoderMax: 0.5 }, { player: 'a source package\'s', plugin: true, decoderMax: 0.6 }])('a follower on $player player kept with the host', ({ plugin, decoderMax }) => {
  // one after another: they share the fake clock and the store `src/party` stands for
  const runs = async (scenario: Scenario) => {
    const done: Run[] = []
    for (const seed of SEEDS) done.push(await simulate({ ...scenario, seed, plugin }, store => { current.store = store }))
    return done
  }

  test('is left alone through ten minutes of jitter', async () => {
    for (const run of await runs({ minutes: 10 })) expect(run).toMatchObject({ rateChanges: 0, seeks: 0 })
  })

  // 0.1% is a millisecond a second, far worse than two audio clocks drift apart
  test('catches a decoder drifting once in ten minutes, and stays well under a second from the host', async () => {
    for (const run of await runs({ minutes: 10, decoderDrift: 0.001 })) {
      expect(run).toMatchObject({ rateChanges: 2, seeks: 0 })
      expect(run.maxDrift).toBeLessThan(decoderMax)
    }
  })

  test('closes a 2 s stall with one catch-up and goes back to the host\'s speed', async () => {
    for (const run of await runs({ minutes: 3, stalls: [[30, 2]] })) {
      expect(run).toMatchObject({ rates: [NUDGE_RATE, 1], seeks: 0 })
      expect(run.lastMinuteMax).toBeLessThan(0.1)
    }
  })

  test('follows the host\'s 10 s jump, or 2 s one back, with one seek and no speed change', async () => {
    for (const run of [...await runs({ minutes: 3, hostSeeks: [[30, 10]] }), ...await runs({ minutes: 3, hostSeeks: [[30, -2]] })]) {
      expect(run).toMatchObject({ rateChanges: 0, seeks: 1 })
      expect(run.lastMinuteMax).toBeLessThan(0.1)
    }
  })

  // what a reading is off by is time, which at 2x is twice the media
  test('at 2x takes the host\'s speed and is left alone through five minutes of jitter', async () => {
    for (const run of await runs({ minutes: 5, rate: 2 })) expect(run).toMatchObject({ rates: [2], seeks: 0 })
  })

  // Measured 2026-11-06 before the change: 31 seeks in three minutes, each sent again before the last one landed,
  // and the follower never played
  test('whose seeks take 6 s to land follows the host\'s jump with two seeks and one catch-up at most', async () => {
    for (const run of await runs({ minutes: 3, seekMs: 6_000, hostSeeks: [[30, 10]] })) {
      expect(run.seeks).toBe(2)
      expect(run.rateChanges).toBeLessThanOrEqual(2)
      expect(run.lastMinuteMax).toBeLessThan(0.5)
    }
  })
})
