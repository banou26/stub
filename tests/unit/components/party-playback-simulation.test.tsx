// FIRST: ./dom installs the document @emotion/react reads at module scope.
import './dom'

import type { PartyStore } from '../../../src/party/store'
import type { Run, Scenario } from './party-playback-simulation'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { NUDGE_RATE } from '../../../src/party/playback'

// STUB-363 (watch-together sync changes the playback speed too often): a party of two through the real follower,
// with the delays and the stale readings a party meets in stub (see ./party-playback-simulation.tsx). Measured
// 2026-11-05 before the change, the same runs moved the follower's speed 25 to 34 times a minute, between 0.952,
// 1 and 1.05, and seeked it every minute or two with nothing to follow.

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
// one after another: they share the fake clock and the store `src/party` stands for
const runs = async (scenario: Scenario) => {
  const done: Run[] = []
  for (const seed of SEEDS) done.push(await simulate({ ...scenario, seed }, store => { current.store = store }))
  return done
}

describe('a follower kept with the host', () => {
  test('is left alone through ten minutes of jitter', async () => {
    for (const run of await runs({ minutes: 10 })) expect(run).toMatchObject({ rateChanges: 0, seeks: 0 })
  })

  // 0.1% is a millisecond a second, far worse than two audio clocks drift apart
  test('catches a decoder drifting once in ten minutes, and stays well under a second from the host', async () => {
    for (const run of await runs({ minutes: 10, decoderDrift: 0.001 })) {
      expect(run).toMatchObject({ rateChanges: 2, seeks: 0 })
      expect(run.maxDrift).toBeLessThan(0.5)
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
})
