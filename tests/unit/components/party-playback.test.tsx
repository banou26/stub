// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { EmbedTracks, TrackKind } from '../../../src/embed-tracks'
import type { Grants, PartyMessage, PlaybackState, PlayerAsk } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { render } from 'preact'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { ASK_HOLD_MS, ASK_THROTTLE_MS, SETTLE_MS } from '../../../src/party/playback'
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

const fakeTracks = () => {
  let listener: ((tracks: EmbedTracks) => void) | undefined
  const link = {
    onTracks: (next: (tracks: EmbedTracks) => void) => { listener = next; return () => { listener = undefined } },
    select: vi.fn<(kind: TrackKind, id: string | null) => void>(),
    dispose: () => {},
  }
  return { link, serve: (tracks: EmbedTracks) => act(() => { listener?.(tracks) }) }
}

const playing = (time: number) => ({ paused: false, time, rate: 1 })
const paused = (time: number) => ({ paused: true, time, rate: 1 })

let seq = 0
const say = (fake: ReturnType<typeof fakeRoom>, from: string, message: PartyMessage) =>
  act(() => { seq++; fake.emit({ type: 'message', message: { seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })
const asks = (fake: ReturnType<typeof fakeRoom>) => fake.sent.map(text => decodePartyMessage(text)).filter((message): message is PlayerAsk => message?.t === 'ask' && message.c !== 'go')
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
const follow = async (grants: { all: Grants['all'], by?: Grants['by'] }, tracks?: ReturnType<typeof fakeTracks>) => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  const player = fakeLink()
  hosts.push(mount(<PartyPlayback link={player.link} tracks={tracks?.link}/>))
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
    await wait(ASK_THROTTLE_MS)
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.s.paused)).toEqual([true, false])
  })

  test('a granted seek asks the host, and is left alone', async () => {
    const { fake, player } = await follow({ all: ['seek'] })
    player.report(playing(40))
    expect(asks(fake)).toEqual([{ t: 'ask', c: 'seek', path: PATH, s: { ...playing(40), at: NOW + 100 } }])
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('a granted speed change asks the host', async () => {
    const { fake, player } = await follow({ all: ['rate'] })
    player.report({ ...playing(10.1), rate: 1.5 })
    expect(asks(fake)).toMatchObject([{ t: 'ask', c: 'rate', s: { rate: 1.5 } }])
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('a speed change by a member denied it is undone', async () => {
    const { fake, player } = await follow({ all: ['rate'], by: { me: { rate: false } } })
    player.report({ ...playing(10.1), rate: 1.5 })
    expect(asks(fake)).toEqual([])
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ rate: 1 })
  })

  // a held seek key: the room admits ten messages a second from a member, chat included
  test('ten seeks in 100 ms ask once at once and once more at the end, with the last', async () => {
    const { fake, player } = await follow({ all: ['seek'] })
    for (let step = 1; step <= 10; step++) {
      player.report(playing(10 + step * 10))
      await wait(10)
    }
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.s.time)).toEqual([20])
    await wait(ASK_THROTTLE_MS)
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.s.time)).toEqual([20, 110])
  })

  // per control: shared across controls, the speed change would replace the seek before it went out
  test('a seek then a speed change inside the throttle both ask at once', async () => {
    const { fake, player } = await follow({ all: ['seek', 'rate'] })
    player.report(playing(40))
    await wait(10)
    player.report({ ...playing(40.01), rate: 1.5 })
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.c)).toEqual(['seek', 'rate'])
  })

  test('a trailing ask still waiting when the player goes is never sent', async () => {
    const { fake, player } = await follow({ all: ['seek'] })
    player.report(playing(40))
    await wait(10)
    player.report(playing(80))
    unmount(hosts.pop()!)
    await wait(1_000)
    expect(asks(fake).map(ask => ask?.t === 'ask' && ask.s.time)).toEqual([40])
  })

  // A torrent player seeking into a range it has not buffered answers the follower's own correction
  // seconds later, by when the host has moved on: read as the person, the party jumps back to it.
  test('a correction seek that lands after the settle window is not the person seeking', async () => {
    const { fake, player } = await follow({ all: ['seek'] })
    say(fake, 'host', { t: 'playback', s: { ...playing(40.1), at: Date.now() } })
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    await wait(SETTLE_MS + 500)
    player.report(playing(40.1))
    expect(asks(fake)).toEqual([])
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

describe('a follower not following playback', () => {
  const unfollow = async () => {
    const following = await follow({ all: ['play'] })
    act(() => { current.store.setFollowing(false) })
    return following
  }

  test('does not apply the host\'s playback', async () => {
    const { fake, player } = await unfollow()
    say(fake, 'host', { t: 'playback', s: { ...paused(10.2), at: Date.now() } })
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('pauses for itself: nothing is asked and nothing is undone', async () => {
    const { fake, player } = await unfollow()
    player.report(paused(10.1))
    await wait(ASK_HOLD_MS)
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('an ask still holding when it stops following does not re-apply the host at the hold\'s end', async () => {
    const { player } = await follow({ all: ['play'] })
    player.report(paused(10.1))
    act(() => { current.store.setFollowing(false) })
    await wait(ASK_HOLD_MS)
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('following again applies where the host is now', async () => {
    const { fake, player } = await unfollow()
    say(fake, 'host', { t: 'playback', s: { ...playing(20), at: Date.now() } })
    await wait(5_000)
    act(() => { current.store.setFollowing(true) })
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ paused: false, time: 25 })
  })

  test('Catch up follows again and applies where the host is, once', async () => {
    const { fake, player } = await unfollow()
    say(fake, 'host', { t: 'playback', s: { ...paused(30), at: Date.now() } })
    act(() => { current.store.replay() })
    expect(current.store.following()).toBe(true)
    expect(player.link.apply.mock.calls.map(([s]) => [s.paused, s.time])).toEqual([[true, 30]])
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
  const granted = async () => {
    const hosting = await host()
    current.store.setGrants({ all: ['play', 'seek', 'rate'], by: {} })
    say(hosting.fake, 'host', decodePartyMessage(hosting.fake.sent.at(-1)!)!)
    return hosting
  }

  test('a granted ask moves the host\'s player', async () => {
    const { fake, player } = await host()
    player.report(playing(10))
    await wait(1_000)
    say(fake, 'ann', ask(true))
    expect(player.link.apply).toHaveBeenCalledWith({ paused: true, time: 11, rate: 1, at: NOW + 1_000 }, true)
  })

  test('a granted seek or speed ask moves the host\'s player', async () => {
    const { fake, player } = await granted()
    player.report(playing(10))
    say(fake, 'ann', { t: 'ask', c: 'seek', path: PATH, s: { ...playing(40), at: Date.now() } })
    expect(player.link.apply).toHaveBeenLastCalledWith({ paused: false, time: 40, rate: 1, at: NOW }, true)
    say(fake, 'ann', { t: 'ask', c: 'rate', path: PATH, s: { ...playing(10), rate: 1.5, at: Date.now() } })
    expect(player.link.apply).toHaveBeenLastCalledWith({ paused: false, time: 10, rate: 1.5, at: NOW }, true)
  })

  // a go names a page, not a player state: PartySync takes the host there, and the player is left alone
  test('a granted go for the host\'s own page is not for the host\'s player', async () => {
    const { fake, player } = await host()
    current.store.setGrants({ all: ['go'], by: {} })
    say(fake, 'host', decodePartyMessage(fake.sent.at(-1)!)!)
    player.report(playing(10))
    say(fake, 'ann', { t: 'ask', c: 'go', path: PATH })
    expect(player.link.apply).not.toHaveBeenCalled()
  })

  test('an ungranted seek ask is not for the host\'s player', async () => {
    const { fake, player } = await host()
    player.report(playing(10))
    say(fake, 'ann', { t: 'ask', c: 'seek', path: PATH, s: { ...playing(40), at: Date.now() } })
    expect(player.link.apply).not.toHaveBeenCalled()
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

describe('the party\'s tracks', () => {
  const SUBTITLES = ['English', 'Spanish', 'Japanese']
  const served = (subtitles: string | null, audio = 'Japanese', busy = false): EmbedTracks => ({
    subtitles: { ids: SUBTITLES, selected: subtitles },
    audio: { ids: ['Japanese', 'English'], selected: audio },
    busy,
  })
  const following = async () => {
    const tracks = fakeTracks()
    const { fake, player } = await follow({ all: ['play'] }, tracks)
    say(fake, 'host', { t: 'state', path: PATH, y: 0, s: { ...playing(10.1), at: Date.now() }, sub: 'Spanish', audio: 'English', grants: { all: ['play'], by: {} } })
    player.link.apply.mockClear()
    return { fake, player, tracks }
  }

  test('a member\'s player is put on the party\'s subtitles and audio', async () => {
    const { tracks } = await following()
    tracks.serve(served('English'))
    expect(tracks.link.select.mock.calls).toEqual([['subtitles', 'Spanish'], ['audio', 'English']])
    expect([current.store.mine('subtitles'), current.store.mine('audio')]).toEqual(['party', 'party'])
  })

  // CR's own menu takes seconds per try, and a track it refused stays refused
  test('a switch the player did not make is not asked again', async () => {
    const { tracks } = await following()
    tracks.serve(served('English'))
    tracks.serve(served('English', 'Japanese', true))
    tracks.serve(served('English'))
    expect(tracks.link.select).toHaveBeenCalledTimes(2)
  })

  test('a pick in the player\'s own menu is the member\'s, and the party moving does not undo it', async () => {
    const { fake, tracks } = await following()
    tracks.serve(served('English'))
    tracks.serve(served('Spanish', 'English'))
    expect(current.store.mine('subtitles')).toBe('party')
    tracks.serve(served('Japanese', 'English'))
    expect(current.store.mine('subtitles')).toBe('Japanese')
    tracks.link.select.mockClear()
    say(fake, 'host', { t: 'state', path: PATH, y: 0, sub: 'English', audio: 'English' })
    expect(tracks.link.select).not.toHaveBeenCalled()
  })

  test('the member\'s own choice from the widget is selected, and Party goes back to the party\'s', async () => {
    const { tracks } = await following()
    tracks.serve(served('Spanish', 'English'))
    act(() => { current.store.setMine('subtitles', null) })
    expect(tracks.link.select).toHaveBeenLastCalledWith('subtitles', null)
    tracks.serve(served(null, 'English'))
    act(() => { current.store.setMine('subtitles', 'party') })
    expect(tracks.link.select).toHaveBeenLastCalledWith('subtitles', 'Spanish')
  })

  test('after a switch the player refused, Party still goes back to the party\'s', async () => {
    const { tracks } = await following()
    tracks.serve(served('English', 'English'))
    tracks.serve(served('English', 'English', true))
    tracks.serve(served('English', 'English'))
    tracks.serve(served('Japanese', 'English'))
    expect(current.store.mine('subtitles')).toBe('Japanese')
    tracks.link.select.mockClear()
    act(() => { current.store.setMine('subtitles', 'party') })
    expect(tracks.link.select.mock.calls).toEqual([['subtitles', 'Spanish']])
  })

  test('after a switch the player refused, picking that track in its menu is the member\'s own', async () => {
    const { fake, tracks } = await following()
    tracks.serve(served('English', 'English'))
    tracks.serve(served('English', 'English', true))
    tracks.serve(served('English', 'English'))
    say(fake, 'host', { t: 'state', path: PATH, y: 0, sub: 'English', audio: 'English' })
    tracks.link.select.mockClear()
    tracks.serve(served('Spanish', 'English'))
    expect(current.store.mine('subtitles')).toBe('Spanish')
    expect(tracks.link.select).not.toHaveBeenCalled()
  })

  test('a busy follower applies nothing and reads nothing as the person, then applies the host', async () => {
    const { fake, player, tracks } = await following()
    tracks.serve(served('Spanish', 'English', true))
    say(fake, 'host', { t: 'playback', s: { ...playing(20), at: Date.now() } })
    player.report(paused(5))
    expect(asks(fake)).toEqual([])
    expect(player.link.apply).not.toHaveBeenCalled()
    tracks.serve(served('Spanish', 'English'))
    expect(player.link.apply).toHaveBeenCalledTimes(1)
    expect(player.link.apply.mock.calls[0]![0]).toMatchObject({ paused: false, time: 20 })
  })

  describe('the host', () => {
    const hosting = async () => {
      const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host', 'ann'] })
      current.store = createPartyStore(api(fake.room), memoryStorage())
      await current.store.create()
      const player = fakeLink()
      const tracks = fakeTracks()
      hosts.push(mount(<PartyPlayback link={player.link} tracks={tracks.link}/>))
      tracks.serve(served('English'))
      player.report(playing(10))
      const playbacks = () => fake.sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'playback')
      return { fake, player, tracks, playbacks }
    }

    // a Crunchyroll switch reloads the stream and puts it back where it was when the switch began
    test('sends no playback while busy, and afterwards seeks back to where the party is', async () => {
      const { player, tracks, playbacks } = await hosting()
      tracks.serve(served('English', 'Japanese', true))
      await wait(2_000)
      player.report(playing(9))
      expect(playbacks()).toHaveLength(1)
      tracks.serve(served('English'))
      expect(player.link.apply).toHaveBeenCalledWith({ paused: false, time: 12, rate: 1, at: NOW + 2_000 }, true)
    })

    test('a host back within the tolerance is left alone', async () => {
      const { player, tracks } = await hosting()
      tracks.serve(served('English', 'Japanese', true))
      await wait(2_000)
      player.report(playing(11.8))
      tracks.serve(served('English'))
      expect(player.link.apply).not.toHaveBeenCalled()
    })

    test('a pause while busy reaches the party once the switch ends', async () => {
      const { player, tracks, playbacks } = await hosting()
      tracks.serve(served('English', 'Japanese', true))
      await wait(1_000)
      player.report(paused(11))
      tracks.serve(served('English'))
      expect(playbacks().at(-1)).toMatchObject({ s: { paused: true, time: 11 } })
    })

    test('a granted seek applied while busy is not undone when the switch ends', async () => {
      const { fake, player, tracks } = await hosting()
      current.store.setGrants({ all: ['seek'], by: {} })
      say(fake, 'host', decodePartyMessage(fake.sent.at(-1)!)!)
      tracks.serve(served('English', 'Japanese', true))
      say(fake, 'ann', { t: 'ask', c: 'seek', path: PATH, s: { ...playing(60), at: Date.now() } })
      player.link.apply.mockClear()
      await wait(1_000)
      player.report(playing(61))
      tracks.serve(served('English'))
      expect(player.link.apply).not.toHaveBeenCalled()
    })

    test('leaving the watch page takes the player\'s tracks away', async () => {
      await hosting()
      expect(current.store.playerTracks()).toBeDefined()
      unmount(hosts.pop()!)
      expect(current.store.playerTracks()).toBeUndefined()
    })

    test('a new player is not sent back to where the last one told the party it was', async () => {
      const { player, tracks } = await hosting()
      const next = fakeLink()
      act(() => { render(<PartyPlayback link={next.link} tracks={tracks.link}/>, hosts.at(-1)!) })
      tracks.serve(served('English', 'Japanese', true))
      next.report(playing(0))
      tracks.serve(served('English'))
      expect(next.link.apply).not.toHaveBeenCalled()
      expect(player.link.apply).not.toHaveBeenCalled()
    })
  })
})
