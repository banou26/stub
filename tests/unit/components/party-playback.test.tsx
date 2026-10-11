// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { PartyMessage, PlaybackState } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { ASK_HOLD_MS, SETTLE_MS } from '../../../src/party/playback'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

// the REAL store, over a fake room each test builds, behind the module every component imports
const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { default: PartyPlayback } = await import('../../../src/components/party-playback')

const PATH = '/watch/a/b'
const NOW = 1_788_700_000_000

const fakeLink = () => {
  let listener: ((state: PlaybackState) => void) | undefined
  let ended = false
  const link = {
    apply: vi.fn<(state: PlaybackState, measured?: boolean) => void>(),
    onReport: (next: (state: PlaybackState) => void) => { listener = next; return () => { listener = undefined } },
    ended: () => ended,
    dispose: () => {},
  }
  return {
    link,
    report: (state: Omit<PlaybackState, 'at'>) => act(() => { listener?.({ ...state, at: Date.now() }) }),
    end: () => { ended = true },
  }
}

const playing = (time: number) => ({ paused: false, time, rate: 1 })
const paused = (time: number) => ({ paused: true, time, rate: 1 })

let seq = 0
const say = (fake: ReturnType<typeof fakeRoom>, from: string, message: PartyMessage) =>
  act(() => { seq++; fake.emit({ type: 'message', message: { seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })
const asks = (fake: ReturnType<typeof fakeRoom>) => fake.sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'ask')
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

const hosts: HTMLElement[] = []
const activation = { isActive: true }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  Object.assign(globalThis, { location: { pathname: PATH, search: '' } })
  activation.isActive = true
  Object.defineProperty(globalThis.navigator, 'userActivation', { configurable: true, value: activation })
})
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
})

/** A follower on the host's page, its player playing level with the host's. */
const follow = async (grants: { all: 'play'[], by?: Record<string, { play?: boolean }> }) => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  const player = fakeLink()
  hosts.push(mount(<PartyPlayback link={player.link}/>))
  player.report(playing(10))
  say(fake, 'host', { t: 'state', path: PATH, y: 0, s: { ...playing(10), at: Date.now() }, grants: { by: {}, ...grants } })
  await wait(100)
  player.link.apply.mockClear()
  return { fake, player }
}

describe('a follower', () => {
  test('a granted pause asks the host once, and is left alone', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.report(paused(10.1))
    expect(asks(fake)).toEqual([{ t: 'ask', c: 'play', path: PATH, s: { ...paused(10.1), at: NOW + 100 } }])
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('the host is not applied while the ask is out, and is once it times out', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.report(paused(10.1))
    say(fake, 'host', { t: 'playback', s: { ...playing(10.2), at: Date.now() } })
    expect(player.link.apply).not.toHaveBeenCalled()
    await wait(ASK_HOLD_MS)
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ paused: false })
  })

  // against the host's stale state the resume looks like nothing, and the person's resume is lost
  // when the host's pause lands
  test('a pause then a resume while the ask is out are both asked', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.report(paused(10.1))
    await wait(200)
    player.report(playing(10.1))
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.s.paused)).toEqual([true, false])
  })

  test('a pause the player made by itself, with no click or key press, is undone and asks nothing', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    activation.isActive = false
    player.report(paused(10.1))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ paused: false })
  })

  test('an ungranted pause is undone at once and asks nothing', async () => {
    const { fake, player } = await follow({ all: [], by: { other: { play: true } } })
    player.report(paused(10.1))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ paused: false })
  })

  test('a member denied what all followers have is undone too', async () => {
    const { fake, player } = await follow({ all: ['play'], by: { me: { play: false } } })
    player.report(paused(10.1))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).toHaveBeenCalledTimes(1)
  })

  // A player can wobble while it answers a correction (Netflix plays for a moment on a seek while
  // paused); read as the person, a granted follower would ask the party to resume.
  test('a report moving away just after the host paused it is undone, not asked', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    say(fake, 'host', { t: 'playback', s: { ...paused(10.2), at: Date.now() } })
    player.report(paused(10.2))
    await wait(500)
    player.report(playing(10.2))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply.mock.calls.at(-1)![0]).toMatchObject({ paused: true })
  })

  // a pause then a resume late in the hold: the resume would otherwise snap back to the host's answer
  // to the pause before the host's answer to the resume lands
  test('an ask while the ask is out holds the player for the whole wait again', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.report(paused(10.1))
    await wait(300)
    say(fake, 'host', { t: 'playback', s: { ...paused(10.1), at: Date.now() } })
    await wait(2_200)
    player.report(playing(10.1))
    await wait(700)
    player.report(playing(10.8))
    expect(asks(fake)).toHaveLength(2)
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  // Netflix's seek while paused plays for a moment, which a granted follower would otherwise ask the
  // party to follow
  test('a report moving away just after the host seeked it is undone, not asked', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    say(fake, 'host', { t: 'playback', s: { ...paused(10), at: Date.now() } })
    player.report(paused(10))
    await wait(SETTLE_MS)
    say(fake, 'host', { t: 'playback', s: { ...paused(15), at: Date.now() } })
    await wait(500)
    player.report(playing(15))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply.mock.calls.at(-1)![0]).toMatchObject({ paused: true, time: 15 })
  })

  // the browser pauses an ended player itself, so a follower whose episode ends first would
  // otherwise pause the party just before the end, at nearly every episode
  test('an ended player\'s pause is neither asked nor undone', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.end()
    player.report(paused(1_420))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).not.toHaveBeenCalled()
  })
  // play() on an ended player starts it over from 0, so a host a moment behind would flash it back
  // to the episode's start
  test('an ended player is not restarted in place, and still follows a host that seeks away', async () => {
    const { fake, player } = await follow({ all: ['play'] })
    player.end()
    player.report(paused(1_420))
    say(fake, 'host', { t: 'playback', s: { ...playing(1_419.9), at: Date.now() } })
    expect(player.link.apply).not.toHaveBeenCalled()
    say(fake, 'host', { t: 'playback', s: { ...playing(600), at: Date.now() } })
    expect(player.link.apply).toHaveBeenCalledTimes(1)
  })
})

describe('the host', () => {
  const host = async () => {
    const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host', 'ann'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.create()
    current.store.setGrants({ all: ['play'], by: {} })
    say(fake, 'host', decodePartyMessage(fake.sent.at(-1)!)!)
    const player = fakeLink()
    hosts.push(mount(<PartyPlayback link={player.link}/>))
    return { fake, player }
  }
  const ask = (pause: boolean) => ({ t: 'ask' as const, c: 'play' as const, path: PATH, s: { ...playing(10), paused: pause, at: Date.now() } })

  test('a granted ask moves the host\'s player', async () => {
    const { fake, player } = await host()
    player.report(playing(10))
    await wait(1_000)
    say(fake, 'ann', ask(true))
    expect(player.link.apply).toHaveBeenCalledWith({ paused: true, time: 11, rate: 1, at: NOW + 1_000 }, true)
  })

  test('an ask its player already does is left alone', async () => {
    const { fake, player } = await host()
    player.report(paused(10))
    say(fake, 'ann', ask(true))
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('an ask from another page is not for this player', async () => {
    const { fake, player } = await host()
    player.report(playing(10))
    say(fake, 'ann', { ...ask(true), path: '/watch/a/c' })
    expect(player.link.apply).not.toHaveBeenCalled()
  })
})
