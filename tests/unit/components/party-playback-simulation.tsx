import type { LinkableMedia } from '../../../src/party/bridge'
import type { PartyMessage, PlaybackState } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { act } from 'preact/test-utils'
import { vi } from 'vite-plus/test'

import PartyPlayback from '../../../src/components/party-playback'
import { linkMedia } from '../../../src/party/bridge'
import { advance } from '../../../src/party/playback'
import { decodePartyMessage, encodePartyMessage, NO_GRANTS } from '../../../src/party/protocol'
import { createPartyStore } from '../../../src/party/store'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'
import { mount, unmount } from './dom'

// A watch party of two in fake time: the guest is the real PartyPlayback over the real store and a real link
// (src/party/bridge.ts), and the host is a player whose link's reports go out as `playback`, with a `state` every
// ten seconds and a `pong` for each of the guest's clock pings, as the host's own page sends them. Run under
// vi.useFakeTimers(), with `src/party` mocked to the store `simulate` hands its caller.
//
// What makes the drift a guest measures noisy is modelled on what reaches it in stub:
//  - a player read through @banou/media-player's remote mirror says where it was at its last snapshot, which comes
//    with each `timeupdate`, every 250 ms in Chrome, so a heartbeat reads a time up to a quarter second old while a
//    report made on an event reads it fresh;
//  - a message waits 40 ms plus a random delay of 60 ms on average, and one in fifty waits a second more, in order;
//  - the host's clock is 1.5 s ahead of the guest's, and the guest measures it over those same delays;
//  - a write to the mirror reaches the far player 10 ms later, and a seek holds it still for 300 ms more (or `seekMs`),
//    the mirror saying it is seeking until it lands.

/** What to throw at the party. Times are in seconds from the start. */
export type Scenario = {
  minutes: number
  seed?: number
  /** The guest's decoder running fast (above 0) or slow, as a share of its speed: 0.001 is a millisecond a second. */
  decoderDrift?: number
  /** When the guest's player stalls, and for how long. */
  stalls?: [at: number, seconds: number][]
  /** When the host seeks, and by how much. */
  hostSeeks?: [at: number, by: number][]
  /** The host's speed throughout. */
  rate?: number
  /** How long a seek holds the guest's player still before it plays, in milliseconds. */
  seekMs?: number
}

/** What the guest's player went through, and how far it was from the host's, sampled every 100 ms. */
export type Run = {
  rateChanges: number
  seeks: number
  /** each speed the guest's player was set to, in order */
  rates: number[]
  /** the distance between the two players, in seconds: mean, 95th percentile, largest, largest over the last minute */
  meanDrift: number
  p95Drift: number
  maxDrift: number
  lastMinuteMax: number
}

const PATH = '/watch/a/b'
const HOST_AHEAD_MS = 1_500
const TIMEUPDATE_MS = 250
const WRITE_MS = 10
const SEEK_MS = 300
const STATE_MS = 10_000
const SAMPLE_MS = 100

const random = (seed: number) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** A player behind a remote mirror: the far player plays on, the mirror says what it last heard. */
const player = (rand: () => number, speedError = 0, seekMs = SEEK_MS) => {
  let position = 0
  let since = Date.now()
  let rate = 1
  let stalledUntil = 0
  const truth = () => position + Math.max(0, Date.now() - Math.max(since, stalledUntil)) / 1000 * rate * (1 + speedError)
  const settle = () => { position = truth(); since = Date.now() }
  const shown = { time: 0, rate: 1 }
  // a write the far player has not taken yet outranks what it last said, as on the mirror
  let seeking: number | undefined
  let inFlight = 0
  const refresh = () => { shown.time = seeking ?? truth() }
  const counts = { rateChanges: 0, seeks: 0, rates: [] as number[] }
  setTimeout(() => setInterval(refresh, TIMEUPDATE_MS), rand() * TIMEUPDATE_MS)
  const target = new EventTarget()
  const fire = (type: string) => { refresh(); target.dispatchEvent(new Event(type)) }
  // accessors, which Object.assign would read once and copy as plain values
  const media = Object.defineProperties(target, {
    paused: { value: false },
    ended: { value: false },
    seeking: { get: () => inFlight > 0 },
    currentTime: {
      get: () => shown.time,
      set: (time: number) => {
        shown.time = seeking = time
        counts.seeks++
        inFlight++
        // the far player is there once it takes the write, and stands still until the seek lands
        setTimeout(() => {
          seeking = undefined
          settle()
          position = time
          stalledUntil = Math.max(stalledUntil, Date.now() + seekMs)
          refresh()
        }, WRITE_MS)
        setTimeout(() => { inFlight--; fire('seeked') }, WRITE_MS + seekMs)
      },
    },
    playbackRate: {
      get: () => shown.rate,
      set: (next: number) => {
        if (Math.abs(next - shown.rate) > 1e-9) { counts.rateChanges++; counts.rates.push(next) }
        shown.rate = next
        setTimeout(() => { settle(); rate = next; fire('ratechange') }, WRITE_MS)
      },
    },
    play: { value: async () => {} },
    pause: { value: () => {} },
  }) as unknown as LinkableMedia
  return {
    media,
    counts,
    truth,
    stall: (seconds: number) => { settle(); stalledUntil = Date.now() + seconds * 1000 },
    seekBy: (by: number) => { media.currentTime = truth() + by },
  }
}

/** Plays `scenario` and says what the guest's player went through. `useStore` is handed the store `src/party` must be. */
export const simulate = async (scenario: Scenario, useStore: (store: PartyStore) => void): Promise<Run> => {
  const rand = random(scenario.seed ?? 1)
  const delay = () => 40 + -Math.log(1 - rand()) * 60 + (rand() < 0.02 ? 1_000 : 0)
  const hostNow = () => Date.now() + HOST_AHEAD_MS
  const onHostClock = (state: PlaybackState) => ({ ...state, at: state.at + HOST_AHEAD_MS })

  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  const store = createPartyStore(api(fake.room), memoryStorage())
  useStore(store)
  let seq = 0
  let delivered = 0
  // the room delivers in order
  const deliver = (message: PartyMessage) => {
    delivered = Math.max(delivered, Date.now() + delay())
    setTimeout(() => {
      seq++
      fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: seq, text: encodePartyMessage(message) }, replayed: false })
    }, delivered - Date.now())
  }
  fake.room.send.mockImplementation(async (text: string) => {
    const message = decodePartyMessage(text)
    if (message?.t === 'ping') setTimeout(() => deliver({ t: 'pong', n: message.n, at: message.at, host: hostNow() }), delay())
  })
  await store.join(INVITE)

  const host = player(rand)
  const guest = player(rand, scenario.decoderDrift, scenario.seekMs)
  if (scenario.rate) host.media.playbackRate = scenario.rate
  const hostLink = linkMedia(host.media)
  const guestLink = linkMedia(guest.media)
  let last: PlaybackState | undefined
  let lastAt = 0
  const state = (): PartyMessage => ({ t: 'state', path: PATH, y: 0, grants: NO_GRANTS, ...last ? { s: onHostClock(advance(last, lastAt, Date.now())) } : {} })
  hostLink.onReport(report => { last = report; lastAt = Date.now(); deliver({ t: 'playback', s: onHostClock(report) }) })
  deliver(state())
  setInterval(() => deliver(state()), STATE_MS)
  const page = mount(<PartyPlayback link={guestLink}/>)

  for (const [at, seconds] of scenario.stalls ?? []) setTimeout(() => guest.stall(seconds), at * 1000)
  for (const [at, by] of scenario.hostSeeks ?? []) setTimeout(() => host.seekBy(by), at * 1000)
  const drifts: number[] = []
  setInterval(() => drifts.push(Math.abs(host.truth() - guest.truth())), SAMPLE_MS)
  for (let second = 0; second < scenario.minutes * 60; second++) await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })

  unmount(page)
  hostLink.dispose()
  guestLink.dispose()
  await store.leave()
  const sorted = [...drifts].sort((a, b) => a - b)
  return {
    ...guest.counts,
    meanDrift: drifts.reduce((sum, drift) => sum + drift, 0) / drifts.length,
    p95Drift: sorted[Math.floor(sorted.length * 0.95)]!,
    maxDrift: sorted.at(-1)!,
    lastMinuteMax: Math.max(...drifts.slice(-60_000 / SAMPLE_MS)),
  }
}
