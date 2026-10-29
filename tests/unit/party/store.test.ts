// The state machine, driven through a fake room: who may speak, who is ignored, what a joiner is
// told, what ends the party, and what a reload gets back. The real rooms api is @fkn/lib, which
// cannot load here, and none of this depends on it.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { api, fakeRoom, INVITE, memoryStorage } from './fake-room'
import { CLOCK_SAMPLES, CLOCK_SPACING_MS, createPartyStore, NAME_HEARTBEAT_MS, PARTY_NAME_KEY, PARTY_SESSION_KEY, STATE_HEARTBEAT_MS, STATUS_GAP_MS, STATUS_HEARTBEAT_MS, type PartyState } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const lastSent = (sent: string[]) => decodePartyMessage(sent.at(-1)!)

describe('hosting', () => {
  test('creating makes this app the host and remembers the invite', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const storage = memoryStorage()
    const rooms = api(fake.room)
    const party = createPartyStore(rooms, storage)

    await party.create()
    await settle()

    expect(party.getState()).toEqual({ status: 'active', role: 'host', invite: INVITE, members: 1, self: 'me', owner: 'me' })
    expect(storage.store.get(PARTY_SESSION_KEY)).toBe(INVITE)
  })

  // Two classes on the wire. Steering (nav, scroll, cursor, playback, state) is the host's; talking
  // (chat, name) is anyone's. A guest's steering is dropped before it is sent, so a guest cannot even
  // try to move the party.
  test('a host steers and talks; a guest only talks', async () => {
    const asHost = fakeRoom({ self: 'me', owner: 'me' })
    const host = createPartyStore(api(asHost.room), memoryStorage())
    await host.create()
    host.send({ t: 'nav', path: '/search' })
    host.send({ t: 'chat', text: 'hi' })
    expect(asHost.sent.map(text => decodePartyMessage(text)?.t)).toEqual(['nav', 'chat'])

    const asGuest = fakeRoom({ self: 'me', owner: 'them' })
    const guest = createPartyStore(api(asGuest.room), memoryStorage())
    await guest.join(INVITE)
    guest.send({ t: 'nav', path: '/search' })
    guest.send({ t: 'cursor', x: 0.5, y: 0.5 })
    guest.send({ t: 'playback', s: { paused: true, time: 1, rate: 1, at: 1 } })
    guest.send({ t: 'chat', text: 'hello' })
    guest.send({ t: 'name', name: 'Ann' })
    expect(asGuest.sent.map(text => decodePartyMessage(text)?.t)).toEqual(['chat', 'name'])
  })

  // What a joiner needs is where the party is NOW. The host's app keeps reporting that, and the
  // answer is built from the latest report, not from whatever was last sent.
  test('a joiner is told where the party is, from the latest report', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setLocation('/watch/a/b', 0.25)
    party.setPlayback({ paused: false, time: 42, rate: 1, at: 1 })

    fake.join('guest')
    fake.emit({ type: 'joined', member: { id: 'guest', permissions: { send: false, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 } })
    await settle()

    // the playback went out moved to NOW on the host's clock, not as the player reported it: the
    // joiner is handed the second the party is at, not the second it was at when the host last heard
    const told = lastSent(fake.sent) as Extract<ReturnType<typeof decodePartyMessage>, { t: 'state' }>
    expect(told).toMatchObject({ t: 'state', path: '/watch/a/b', y: 0.25 })
    expect(told.s!.paused).toBe(false)
    expect(told.s!.time).toBeGreaterThanOrEqual(42)
    expect(told.s!.time).toBeLessThan(43)
    expect((party.getState() as Extract<PartyState, { status: 'active' }>).members).toBe(2)

    // off the watch page the snapshot carries no playback, so a joiner is not handed a stale one
    party.setPlayback(undefined)
    fake.emit({ type: 'joined', member: { id: 'other', permissions: { send: false, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 } })
    await settle()
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/watch/a/b', y: 0.25 })
  })

  // A follower coming back inside the api's hold is not a joiner: nobody is told it left or returned,
  // and its rebuilt store has heard nothing. The host saying where the party is on a clock is what
  // reaches it. Pinned with the timer, and with the timer STOPPING when the party ends, since a host
  // that kept sending into a room it left would be the store's own leak.
  test('a host repeats where the party is on a clock, and stops when it leaves', async () => {
    vi.useFakeTimers()
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setLocation('/search?q=a', 0.5)
    expect(fake.sent).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS)
    expect(fake.sent).toHaveLength(1)
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/search?q=a', y: 0.5 })
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS)
    expect(fake.sent).toHaveLength(2)

    await party.leave()
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS * 3)
    expect(fake.sent).toHaveLength(2)
    // the timer itself, not just its silence: `send` refuses after the room is gone, so a leaked
    // interval sends nothing and would pass the count above while ticking for the life of the tab
    expect(vi.getTimerCount()).toBe(0)
  })

  test('and a guest does not', async () => {
    vi.useFakeTimers()
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS * 2)
    // by kind, not by silence: a guest does time the host's clock, and that is not steering
    expect(fake.sent.filter(text => decodePartyMessage(text)?.t === 'state')).toHaveLength(0)
  })

  // The api hands the sender its own message back with the same seq. A host that followed itself
  // would navigate to where it already is on every move, and scroll to where it already scrolled.
  // Its own chat it DOES hear, because that echo is how a line renders once, in the api's order.
  test('a host does not hear its own steering, and does hear its own chat', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    const heard = vi.fn()
    party.onMessage(heard)

    fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'me', at: 1, text: encodePartyMessage({ t: 'nav', path: '/x' }) } , replayed: false })
    expect(heard).not.toHaveBeenCalled()
    fake.emit({ type: 'message', message: { envelope: null, seq: 2, from: 'me', at: 5, text: encodePartyMessage({ t: 'chat', text: 'hi all' }) } , replayed: false })
    expect(heard).toHaveBeenCalledWith({ t: 'chat', text: 'hi all' }, { replayed: false, from: 'me', self: true })
    expect(party.chat()).toEqual([{ seq: 2, from: 'me', name: undefined, text: 'hi all', at: 5, self: true }])
  })

  test('a host hears a guest talk, and kicks or bans by id', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    const heard = vi.fn()
    party.onMessage(heard)

    fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'g1', at: 1, text: encodePartyMessage({ t: 'name', name: 'Ann' }) } , replayed: false })
    fake.emit({ type: 'message', message: { envelope: null, seq: 2, from: 'g1', at: 2, text: encodePartyMessage({ t: 'chat', text: 'yo' }) } , replayed: false })
    expect(party.chat()).toEqual([{ seq: 2, from: 'g1', name: 'Ann', text: 'yo', at: 2, self: false }])
    expect(await party.roster()).toEqual([
      { id: 'me', name: undefined, host: true, self: true },
      { id: 'g1', name: 'Ann', host: false, self: false },
    ])

    await party.kick('g1')
    expect(fake.room.remove).toHaveBeenCalledWith('g1')
    await party.ban('g1')
    expect(fake.room.block).toHaveBeenCalledWith('g1')
  })
})

afterEach(() => { vi.useRealTimers() })

describe('following', () => {
  test('joining makes this app a guest, and only the host is heard', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    const heard = vi.fn()
    party.onMessage(heard)

    await party.join(INVITE)
    await settle()
    expect(party.getState()).toEqual({ status: 'active', role: 'guest', invite: INVITE, members: 2, self: 'me', owner: 'host' })

    fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'host', at: 1, text: encodePartyMessage({ t: 'nav', path: '/x' }) } , replayed: false })
    fake.emit({ type: 'message', message: { envelope: null, seq: 2, from: 'someone', at: 1, text: encodePartyMessage({ t: 'nav', path: '/y' }) } , replayed: false })
    fake.emit({ type: 'message', message: { envelope: null, seq: 3, from: 'host', at: 1, text: 'not a party message' } , replayed: false })
    expect(heard).toHaveBeenCalledTimes(1)
    expect(heard).toHaveBeenCalledWith({ t: 'nav', path: '/x' }, { replayed: false, from: 'host', self: false })
  })

  // The room lets everyone send now, so the class check on receipt is the whole defence: another
  // guest saying "go here" or "pause" is heard as nothing, while the same guest saying hello is heard.
  test('another guest is heard talking and never steering', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'other'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    const heard = vi.fn()
    party.onMessage(heard)

    const say = (seq: number, from: string, message: Parameters<typeof encodePartyMessage>[0]) =>
      fake.emit({ type: 'message', message: { envelope: null, seq, from, at: 1, text: encodePartyMessage(message) } , replayed: false })
    say(1, 'other', { t: 'nav', path: '/evil' })
    say(2, 'other', { t: 'scroll', y: 1 })
    say(3, 'other', { t: 'cursor', x: 0, y: 0 })
    say(4, 'other', { t: 'playback', s: { paused: true, time: 0, rate: 1, at: 1 } })
    say(5, 'other', { t: 'state', path: '/evil', y: 0 })
    expect(heard).not.toHaveBeenCalled()
    expect(party.hostPath()).toBeUndefined()

    say(6, 'other', { t: 'chat', text: 'hello' })
    expect(heard).toHaveBeenCalledWith({ t: 'chat', text: 'hello' }, { replayed: false, from: 'other', self: false })
  })

  test('a name given is announced, remembered for next time, and said again when someone joins', async () => {
    const storage = memoryStorage()
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), storage)
    await party.join(INVITE)
    party.setName('Ann')
    expect(lastSent(fake.sent)).toEqual({ t: 'name', name: 'Ann' })
    expect(storage.store.get('stub-party-name')).toBe('Ann')

    fake.emit({ type: 'joined', member: { id: 'new', permissions: { send: true, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 } })
    expect(fake.sent.filter(text => decodePartyMessage(text)?.t === 'name')).toHaveLength(2)

    // and a tab that remembered one introduces itself on the way in
    const again = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const rejoined = createPartyStore(api(again.room), storage)
    await rejoined.join(INVITE)
    expect(lastSent(again.sent)).toEqual({ t: 'name', name: 'Ann' })
  })

  // The other side of a reload: the member who reloaded heard no introductions, and a `joined` for it
  // never fires inside the hold, so everyone says their name again on a clock. Nameless members say
  // nothing, and the clock stops with the party.
  test('a name is said again every half minute, by anyone who has one, until they leave', async () => {
    vi.useFakeTimers()
    const storage = memoryStorage()
    storage.setItem('stub-party-name', 'Ann')
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), storage)
    await party.join(INVITE)
    const names = () => fake.sent.filter(text => decodePartyMessage(text)?.t === 'name').length
    expect(names()).toBe(1)
    await vi.advanceTimersByTimeAsync(NAME_HEARTBEAT_MS * 2)
    expect(names()).toBe(3)
    await party.leave()
    await vi.advanceTimersByTimeAsync(NAME_HEARTBEAT_MS * 2)
    expect(names()).toBe(3)
    expect(vi.getTimerCount()).toBe(0)

    const quiet = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const nameless = createPartyStore(api(quiet.room), memoryStorage())
    await nameless.join(INVITE)
    await vi.advanceTimersByTimeAsync(NAME_HEARTBEAT_MS * 2)
    expect(quiet.sent.filter(text => decodePartyMessage(text)?.t === 'name')).toHaveLength(0)
  })

  // A room outlives its owner and a party does not: nobody else can ever send, so a room whose host is
  // gone is a room where nothing will happen again.
  test('the host leaving ends the party for a guest, who leaves the room', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)

    fake.emit({ type: 'left', id: 'host', reason: 'left' })
    await settle()

    expect(party.getState()).toEqual({ status: 'ended', reason: 'host-left' })
    expect(fake.room.leave).toHaveBeenCalled()
  })

  test('another guest leaving only moves the count', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'other'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    await settle()
    expect((party.getState() as Extract<PartyState, { status: 'active' }>).members).toBe(3)

    fake.room.members = async () => [{ id: 'host', permissions: { send: true, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 }, { id: 'me', permissions: { send: false, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 }]
    fake.emit({ type: 'left', id: 'other', reason: 'left' })
    await settle()
    expect(party.getState()).toMatchObject({ status: 'active', members: 2 })
  })

  test('replay says the last of each thing the host said, the nav first', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    const heard: unknown[] = []
    party.onMessage(message => heard.push(message))

    const say = (seq: number, message: Parameters<typeof encodePartyMessage>[0]) =>
      fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: 1, text: encodePartyMessage(message) } , replayed: false })
    say(1, { t: 'scroll', y: 0.1 })
    say(2, { t: 'nav', path: '/a' })
    say(3, { t: 'scroll', y: 0.9 })
    say(4, { t: 'nav', path: '/b' })
    heard.length = 0

    party.replay()
    expect(heard).toEqual([{ t: 'nav', path: '/b' }, { t: 'scroll', y: 0.9 }])
  })

  // A `state` goes out on a ten second heartbeat and a `scroll` twice a second while the host moves,
  // so the position on a replayed state is routinely the older of the two. Catch up placed followers
  // at the top of a page the host was 1,080px down, whenever no heartbeat fell between the host's
  // move and the ask (measured 2026-09-08).
  describe('the position a replayed state carries', () => {
    const caughtUp = async (says: Parameters<typeof encodePartyMessage>[0][]) => {
      const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
      const party = createPartyStore(api(fake.room), memoryStorage())
      await party.join(INVITE)
      const heard: unknown[] = []
      party.onMessage(message => heard.push(message))
      says.forEach((message, index) =>
        fake.emit({ type: 'message', message: { envelope: null, seq: index + 1, from: 'host', at: 1, text: encodePartyMessage(message) }, replayed: false }))
      heard.length = 0
      party.replay()
      return heard
    }

    test('is the later scroll, when the host moved after the state went out', async () => {
      const heard = await caughtUp([{ t: 'state', path: '/a', y: 0 }, { t: 'scroll', y: 0.42 }])
      expect(heard).toEqual([{ t: 'state', path: '/a', y: 0.42 }, { t: 'scroll', y: 0.42 }])
    })

    test('is the state\'s own, when the state is the later of the two', async () => {
      const heard = await caughtUp([{ t: 'scroll', y: 0.42 }, { t: 'state', path: '/a', y: 0.9 }])
      expect(heard).toEqual([{ t: 'state', path: '/a', y: 0.9 }, { t: 'scroll', y: 0.42 }])
    })

    test('is the state\'s own when no scroll was ever heard', async () => {
      const heard = await caughtUp([{ t: 'state', path: '/a', y: 0.3 }])
      expect(heard).toEqual([{ t: 'state', path: '/a', y: 0.3 }])
    })

    test('leaves everything else on the state alone, so a playback is not lost to a scroll', async () => {
      const heard = await caughtUp([
        { t: 'state', path: '/a', y: 0, s: { paused: false, time: 5, rate: 1, at: 12 } },
        { t: 'scroll', y: 0.42 },
      ])
      expect(heard).toEqual([
        { t: 'state', path: '/a', y: 0.42, s: { paused: false, time: 5, rate: 1, at: 12 } },
        { t: 'scroll', y: 0.42 },
      ])
    })
  })

  test('a replay is marked as one, so a guest can tell being caught up from the host moving', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    const heard = vi.fn()
    party.onMessage(heard)

    fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'host', at: 1, text: encodePartyMessage({ t: 'nav', path: '/a' }) } , replayed: false })
    expect(heard).toHaveBeenLastCalledWith({ t: 'nav', path: '/a' }, { replayed: false, from: 'host', self: false })
    party.replay()
    expect(heard).toHaveBeenLastCalledWith({ t: 'nav', path: '/a' }, { replayed: true, from: 'host', self: false })
  })

  // A scroll and a playback are for the page the host is on. The store keeps the latest of each kind,
  // so the path has to come from whichever of `nav` and `state` arrived LAST, not from a fixed one.
  test('hostPath is the path the host named most recently, from either message that carries one', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    expect(party.hostPath()).toBeUndefined()

    const say = (seq: number, message: Parameters<typeof encodePartyMessage>[0]) =>
      fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: 1, text: encodePartyMessage(message) } , replayed: false })
    say(1, { t: 'state', path: '/a', y: 0 })
    expect(party.hostPath()).toBe('/a')
    say(2, { t: 'nav', path: '/b' })
    expect(party.hostPath()).toBe('/b')
    say(3, { t: 'state', path: '/c', y: 0 })
    expect(party.hostPath()).toBe('/c')
    say(4, { t: 'nav', path: '/d' })
    say(5, { t: 'state', path: '/d', y: 0 })
    say(6, { t: 'nav', path: '/e' })
    expect(party.hostPath()).toBe('/e')
  })
})

describe('the joiner snapshot moves with the clock', () => {
  test('a playing report heard seconds ago is handed on seconds ahead, a paused one as it was', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setPlayback({ paused: false, time: 100, rate: 1, at: 1 })
    await vi.advanceTimersByTimeAsync(4_000)
    fake.emit({ type: 'joined', member: { id: 'g', permissions: { send: true, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 } })
    const playing = lastSent(fake.sent) as { s: { time: number, at: number } }
    expect(playing.s.time).toBeCloseTo(104, 2)
    expect(playing.s.at).toBe(1_004_000)

    party.setPlayback({ paused: true, time: 200, rate: 1, at: 1 })
    await vi.advanceTimersByTimeAsync(4_000)
    fake.emit({ type: 'joined', member: { id: 'h', permissions: { send: true, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 } })
    expect((lastSent(fake.sent) as { s: { time: number } }).s.time).toBe(200)
  })
})

describe('moderation is the host\'s', () => {
  test('a guest asking to kick or ban asks nothing of the room', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'other'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    await party.kick('other')
    await party.ban('other')
    expect(fake.room.remove).not.toHaveBeenCalled()
    expect(fake.room.block).not.toHaveBeenCalled()
  })
})

describe('ending and failing', () => {
  test('the room closing ends the party with its reason and forgets the invite', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const storage = memoryStorage()
    const party = createPartyStore(api(fake.room), storage)
    await party.join(INVITE)
    expect(storage.store.has(PARTY_SESSION_KEY)).toBe(true)

    fake.end('removed')
    await settle()
    expect(party.getState()).toEqual({ status: 'ended', reason: 'removed' })
    expect(storage.store.has(PARTY_SESSION_KEY)).toBe(false)

    party.dismiss()
    expect(party.getState()).toEqual({ status: 'idle' })
  })

  test('a refused join fails with the room code, never with the message', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host' })
    const party = createPartyStore(api(fake.room, 'full'), memoryStorage())
    await party.join(INVITE)
    expect(party.getState()).toEqual({ status: 'failed', code: 'full' })
  })

  test('leaving is immediate and remembered as such', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const storage = memoryStorage()
    const party = createPartyStore(api(fake.room), storage)
    await party.create()
    await party.leave()
    expect(party.getState()).toEqual({ status: 'ended', reason: 'left' })
    expect(fake.room.leave).toHaveBeenCalledTimes(1)
    expect(storage.store.has(PARTY_SESSION_KEY)).toBe(false)
  })
})

describe('resuming', () => {
  // fkn.app hands a tab that rejoins through the invite its own seat back, so the seat decides the role
  test('a host\'s store rebuilt from its saved session rejoins through the invite as the host', async () => {
    const storage = memoryStorage()
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const rooms = api(fake.room)
    await createPartyStore(rooms, storage).create()

    const party = createPartyStore(rooms, storage)
    await party.resume()
    expect(rooms.join).toHaveBeenCalledWith(INVITE)
    expect(party.getState()).toMatchObject({ status: 'active', role: 'host', self: 'me' })
  })

  test('a follower comes back as a follower', async () => {
    const storage = memoryStorage()
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const rooms = api(fake.room)
    await createPartyStore(rooms, storage).join(INVITE)

    const party = createPartyStore(rooms, storage)
    await party.resume()
    expect(rooms.join).toHaveBeenNthCalledWith(2, INVITE)
    expect(party.getState()).toMatchObject({ status: 'active', role: 'guest', self: 'me' })
  })

  // A resume that finds nothing is a party that ended while the tab was closed. There is nothing to
  // announce on a page that never showed one, and a "party failed" on every cold load would be noise.
  test('a party that is gone resumes to nothing, quietly', async () => {
    const storage = memoryStorage()
    storage.setItem(PARTY_SESSION_KEY, INVITE)
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room, 'not-found'), storage)

    await party.resume()
    expect(party.getState()).toEqual({ status: 'idle' })
    expect(storage.store.has(PARTY_SESSION_KEY)).toBe(false)
  })

  test('nothing remembered is nothing done', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const rooms = api(fake.room)
    const party = createPartyStore(rooms, memoryStorage())
    await party.resume()
    expect(rooms.join).not.toHaveBeenCalled()
    expect(party.getState()).toEqual({ status: 'idle' })
  })
})

// A follower has to turn the host's `at` into a position on its own clock, and one message can never
// separate clock skew from transit. Timing a round trip can, which is what these drive.
describe('timing the host clock', () => {
  const pingsIn = (sent: string[]) =>
    sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'ping')

  test('a guest asks, a host does not', async () => {
    vi.useFakeTimers()
    try {
      const asGuest = fakeRoom({ self: 'them', owner: 'host' })
      const guest = createPartyStore(api(asGuest.room), memoryStorage())
      await guest.join(INVITE)
      await vi.advanceTimersByTimeAsync(CLOCK_SAMPLES * CLOCK_SPACING_MS + 100)
      expect(pingsIn(asGuest.sent)).toHaveLength(CLOCK_SAMPLES)

      const asHost = fakeRoom({ self: 'me', owner: 'me' })
      const host = createPartyStore(api(asHost.room), memoryStorage())
      await host.create()
      await vi.advanceTimersByTimeAsync(CLOCK_SAMPLES * CLOCK_SPACING_MS + 100)
      // the host IS the reference; asking itself what time it is would measure nothing
      expect(pingsIn(asHost.sent)).toHaveLength(0)
      expect(host.hostClock()).toBeUndefined()
    } finally { vi.useRealTimers() }
  })

  test('a host answers a guest ping with its own clock and the asker\'s stamp', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const host = createPartyStore(api(fake.room), memoryStorage())
    await host.create()
    await settle()

    fake.emit({ type: 'message', message: { envelope: null, from: 'them', seq: 1, at: Date.now(), text: encodePartyMessage({ t: 'ping', n: 7, at: 1_000 }) } , replayed: false })
    await settle()

    const pong = lastSent(fake.sent)
    expect(pong?.t).toBe('pong')
    // the asker's stamp comes back untouched: it is the only thing that identifies its own trip
    expect(pong).toMatchObject({ t: 'pong', n: 7, at: 1_000 })
    expect((pong as { host: number }).host).toBeGreaterThan(1_000)
  })

  test('a guest turns the reply into an offset it can use', async () => {
    const fake = fakeRoom({ self: 'them', owner: 'host' })
    const guest = createPartyStore(api(fake.room), memoryStorage())
    await guest.join(INVITE)
    await settle()

    expect(guest.hostClock(), 'nothing is assumed before anything is measured').toBeUndefined()
    const ping = pingsIn(fake.sent)[0] as { n: number, at: number }
    expect(ping).toBeDefined()
    // a host whose clock reads a full hour ahead, answering at once
    fake.emit({ type: 'message', message: { envelope: null, from: 'host', seq: 1, at: Date.now(), text: encodePartyMessage({ t: 'pong', n: ping.n, at: ping.at, host: ping.at + 3_600_000 }) } , replayed: false })
    await settle()

    const clock = guest.hostClock()
    expect(clock).toBeDefined()
    expect(clock!.offset).toBeGreaterThan(3_600_000 - 1_000)
    expect(clock!.offset).toBeLessThan(3_600_000 + 1_000)
  })

  test('a reply to somebody else\'s question is not this guest\'s trip', async () => {
    const fake = fakeRoom({ self: 'them', owner: 'host' })
    const guest = createPartyStore(api(fake.room), memoryStorage())
    await guest.join(INVITE)
    await settle()
    const ping = pingsIn(fake.sent)[0] as { n: number, at: number }

    // right nonce, a stamp this guest never sent: another member's trip, timed on another clock
    fake.emit({ type: 'message', message: { envelope: null, from: 'host', seq: 1, at: Date.now(), text: encodePartyMessage({ t: 'pong', n: ping.n, at: ping.at + 5_000, host: ping.at + 9_000 }) } , replayed: false })
    // and an unknown nonce
    fake.emit({ type: 'message', message: { envelope: null, from: 'host', seq: 2, at: Date.now(), text: encodePartyMessage({ t: 'pong', n: 999_999, at: ping.at, host: ping.at }) } , replayed: false })
    await settle()

    expect(guest.hostClock()).toBeUndefined()
  })

  test('a pong from anyone but the host is ignored', async () => {
    const fake = fakeRoom({ self: 'them', owner: 'host' })
    const guest = createPartyStore(api(fake.room), memoryStorage())
    await guest.join(INVITE)
    await settle()
    const ping = pingsIn(fake.sent)[0] as { n: number, at: number }

    fake.emit({ type: 'message', message: { envelope: null, from: 'someone-else', seq: 1, at: Date.now(), text: encodePartyMessage({ t: 'pong', n: ping.n, at: ping.at, host: ping.at + 60_000 }) } , replayed: false })
    await settle()

    expect(guest.hostClock(), 'anyone could offer a clock; only the host has the one that counts').toBeUndefined()
  })

  test('leaving forgets the clock, since the next party is another machine', async () => {
    const fake = fakeRoom({ self: 'them', owner: 'host' })
    const guest = createPartyStore(api(fake.room), memoryStorage())
    await guest.join(INVITE)
    await settle()
    const ping = pingsIn(fake.sent)[0] as { n: number, at: number }
    fake.emit({ type: 'message', message: { envelope: null, from: 'host', seq: 1, at: Date.now(), text: encodePartyMessage({ t: 'pong', n: ping.n, at: ping.at, host: ping.at + 5_000 }) } , replayed: false })
    await settle()
    expect(guest.hostClock()).toBeDefined()

    await guest.leave()
    await settle()
    expect(guest.hostClock()).toBeUndefined()
  })
})

describe('grants', () => {
  const PLAYED = { paused: true, time: 12, rate: 1, at: 1 }
  const say = (fake: ReturnType<typeof fakeRoom>, seq: number, from: string, message: Parameters<typeof encodePartyMessage>[0]) =>
    fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false })
  const granted = (all: 'play'[], by: Record<string, { play?: boolean }> = {}) => ({ t: 'state' as const, path: '/watch/a/b', y: 0, grants: { all, by } })
  const ask = { t: 'ask' as const, c: 'play' as const, path: '/watch/a/b', s: PLAYED }
  const member = (id: string) => ({ id, permissions: { send: true, receive: true, remove: false, block: false }, maxMessageBytes: 262_144 })

  test('a guest may play once the owner says so, and never because another member did', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'other'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    const states = vi.fn()
    party.subscribe(states)
    expect(party.may('play')).toBe(false)

    say(fake, 1, 'other', granted(['play']))
    expect(party.may('play')).toBe(false)
    say(fake, 2, 'host', granted([], { me: { play: true } }))
    expect(party.may('play')).toBe(true)
    // so every `useParty` reader, the widget's "You can" among them, re-renders, but not on every
    // heartbeat that carries the same grants
    expect(states).toHaveBeenCalledTimes(1)
    say(fake, 3, 'host', granted([], { me: { play: true } }))
    expect(states).toHaveBeenCalledTimes(1)
    say(fake, 4, 'host', granted(['play'], { me: { play: false } }))
    expect(party.may('play')).toBe(false)
  })

  // Every member judges an ask against the same grants, in room order, the host included: an ask the
  // room ordered before a revoke was made under the grant, whatever the host clicked meanwhile.
  test('the host judges an ask by its own echo, not by what it just set', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setGrants({ all: ['play'], by: {} })
    expect(party.issued()).toEqual({ all: ['play'], by: {} })
    say(fake, 1, 'g1', ask)
    expect(party.chat()).toEqual([])
    say(fake, 2, 'me', lastSent(fake.sent)!)

    party.setGrants({ all: [], by: {} })
    say(fake, 3, 'g1', ask)
    expect(party.chat().map(line => line.ask)).toEqual([ask])
    say(fake, 4, 'me', lastSent(fake.sent)!)
    say(fake, 5, 'g1', { ...ask, s: { ...PLAYED, paused: false } })
    expect(party.chat().map(line => line.ask)).toEqual([ask])
  })

  test('the grants ride every state: at once when set, to a joiner, and on the heartbeat', async () => {
    vi.useFakeTimers()
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setLocation('/watch/a/b', 0)
    const grants = { all: [], by: { g1: { play: true } } }
    party.setGrants(grants)
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/watch/a/b', y: 0, grants })
    fake.emit({ type: 'joined', member: member('g2') })
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/watch/a/b', y: 0, grants })
    fake.sent.length = 0
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS)
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/watch/a/b', y: 0, grants })
  })

  test('a fresh party hands out nothing', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me' })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    fake.emit({ type: 'joined', member: member('g1') })
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/', y: 0 })
    say(fake, 1, 'g1', ask)
    expect(party.chat()).toEqual([])
  })

  test('a granted ask is a chat line and is told; an ungranted one is neither', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'ann', 'sam'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    const heard = vi.fn()
    party.onMessage(heard)
    say(fake, 1, 'ann', { t: 'name', name: 'Ann' })
    say(fake, 2, 'host', granted(['play'], { sam: { play: false } }))
    heard.mockClear()

    say(fake, 3, 'sam', ask)
    expect(heard).not.toHaveBeenCalled()
    expect(party.chat()).toEqual([])

    say(fake, 4, 'ann', ask)
    expect(heard).toHaveBeenCalledWith(ask, { replayed: false, from: 'ann', self: false })
    expect(party.chat()).toEqual([{ seq: 4, from: 'ann', name: 'Ann', at: 4, self: false, ask }])
  })

  test('the same member using the same control again replaces its line', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'ann', 'sam'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    say(fake, 1, 'host', granted(['play']))
    say(fake, 2, 'ann', ask)
    const resumed = { ...ask, s: { ...PLAYED, paused: false } }
    say(fake, 3, 'ann', resumed)
    expect(party.chat().map(line => [line.from, line.ask])).toEqual([['ann', resumed]])
    say(fake, 4, 'sam', ask)
    say(fake, 5, 'ann', ask)
    expect(party.chat().map(line => [line.from, line.ask])).toEqual([['ann', resumed], ['sam', ask], ['ann', ask]])
  })

  // A kick or a block arrives as `left` too. Kept, the entries of everyone who ever came and went
  // would pass the decoder's hundred and every `state` would carry no grants at all.
  test('a member leaving takes its entry with it, and the party is told', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1', 'g2'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setGrants({ all: [], by: { g1: { play: true } } })
    fake.sent.length = 0

    fake.emit({ type: 'left', id: 'g2', reason: 'left' })
    expect(fake.sent).toHaveLength(0)
    fake.emit({ type: 'left', id: 'g1', reason: 'removed' })
    expect(party.issued()).toEqual({ all: [], by: {} })
    expect(lastSent(fake.sent)).toEqual({ t: 'state', path: '/', y: 0, grants: { all: [], by: {} } })
  })

  // the same tab comes back with the same member id once the seat hold has passed
  test('a denial outlasts the member leaving, so "everyone except Sam" holds when Sam comes back', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'sam'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setGrants({ all: ['play'], by: { sam: { play: false } } })
    say(fake, 1, 'me', lastSent(fake.sent)!)
    fake.emit({ type: 'left', id: 'sam', reason: 'left' })
    say(fake, 2, 'me', lastSent(fake.sent)!)
    fake.emit({ type: 'joined', member: member('sam') })
    say(fake, 3, 'sam', ask)
    expect(party.issued()).toEqual({ all: ['play'], by: { sam: { play: false } } })
    expect(party.chat()).toEqual([])
  })

  test('nothing of it is stored: the tab keeps its invite and its name, no more', async () => {
    const storage = memoryStorage()
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1'] })
    const party = createPartyStore(api(fake.room), storage)
    await party.create()
    party.setName('Ann')
    party.setGrants({ all: ['play'], by: { g1: { play: false } } })
    say(fake, 1, 'me', lastSent(fake.sent)!)
    say(fake, 2, 'g1', ask)
    expect([...storage.store.keys()].sort()).toEqual([PARTY_NAME_KEY, PARTY_SESSION_KEY].sort())
  })
})

describe('Follow playback', () => {
  test('lives in memory for the party only: nothing is stored, and the next party follows again', async () => {
    const storage = memoryStorage()
    const party = createPartyStore(api(fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] }).room), storage)
    await party.join(INVITE)
    expect(party.following()).toBe(true)
    party.setFollowing(false)
    expect(party.following()).toBe(false)
    expect([...storage.store.keys()]).toEqual([PARTY_SESSION_KEY])
    await party.join(INVITE)
    expect(party.following()).toBe(true)
  })
})

describe('the party\'s tracks', () => {
  const say = (fake: ReturnType<typeof fakeRoom>, seq: number, from: string, message: Parameters<typeof encodePartyMessage>[0]) =>
    fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false })
  const hosting = async (grants = { all: ['subs' as const, 'audio' as const], by: { sam: { subs: false, audio: false } } }) => {
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'ann', 'sam'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.create()
    party.setGrants(grants)
    say(fake, 1, 'me', lastSent(fake.sent)!)
    fake.sent.length = 0
    return { fake, party }
  }

  test('the host sets them on every state, and learns them from its own echo like everyone', async () => {
    vi.useFakeTimers()
    const { fake, party } = await hosting()
    party.setPartyTrack('subtitles', null)
    party.setPartyTrack('audio', 'Japanese')
    expect(lastSent(fake.sent)).toMatchObject({ t: 'state', sub: null, audio: 'Japanese' })
    expect(party.partyTrack('subtitles')).toBeUndefined()
    say(fake, 2, 'me', lastSent(fake.sent)!)
    expect([party.partyTrack('subtitles'), party.partyTrack('audio')]).toEqual([null, 'Japanese'])
    fake.sent.length = 0
    await vi.advanceTimersByTimeAsync(STATE_HEARTBEAT_MS)
    expect(lastSent(fake.sent)).toMatchObject({ sub: null, audio: 'Japanese' })
  })

  test('the host applies a granted subtitles or audio ask, and not an ungranted one', async () => {
    const { fake, party } = await hosting()
    say(fake, 2, 'sam', { t: 'ask', c: 'subs', sub: 'German' })
    say(fake, 3, 'sam', { t: 'ask', c: 'audio', audio: 'German' })
    expect(fake.sent).toEqual([])
    say(fake, 4, 'ann', { t: 'ask', c: 'subs', sub: 'English' })
    expect(lastSent(fake.sent)).toMatchObject({ t: 'state', sub: 'English' })
    say(fake, 5, 'ann', { t: 'ask', c: 'audio', audio: 'Japanese' })
    expect(lastSent(fake.sent)).toMatchObject({ t: 'state', sub: 'English', audio: 'Japanese' })
    expect(party.chat().map(line => line.ask)).toEqual([{ t: 'ask', c: 'subs', sub: 'English' }, { t: 'ask', c: 'audio', audio: 'Japanese' }])
  })

  test('a follower knows them from the owner only, and asks for one only when granted', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    say(fake, 1, 'other', { t: 'state', path: '/', y: 0, sub: 'German' })
    expect(party.partyTrack('subtitles')).toBeUndefined()
    say(fake, 2, 'host', { t: 'state', path: '/', y: 0, sub: 'English', grants: { all: ['subs'], by: {} } })
    expect(party.partyTrack('subtitles')).toBe('English')
    fake.sent.length = 0
    party.setPartyTrack('audio', 'Japanese')
    expect(fake.sent).toEqual([])
    party.setPartyTrack('subtitles', null)
    expect(lastSent(fake.sent)).toEqual({ t: 'ask', c: 'subs', sub: null })
    say(fake, 3, 'host', { t: 'state', path: '/', y: 0, grants: { all: ['audio'], by: {} } })
    party.setPartyTrack('audio', 'English')
    expect(lastSent(fake.sent)).toEqual({ t: 'ask', c: 'audio', audio: 'English' })
  })

  test('a host\'s next party starts with no tracks set', async () => {
    const first = fakeRoom({ self: 'me', owner: 'me', members: ['me'] })
    const next = fakeRoom({ self: 'me', owner: 'me', members: ['me'] })
    const rooms = api(first.room)
    const party = createPartyStore(rooms, memoryStorage())
    await party.create()
    party.setPartyTrack('subtitles', 'English')
    party.setPartyTrack('audio', 'Japanese')
    await party.leave()
    rooms.create.mockResolvedValueOnce(next.room)
    await party.create()
    party.setGrants({ all: [], by: {} })
    expect(lastSent(next.sent)).toMatchObject({ t: 'state' })
    expect(lastSent(next.sent)).not.toHaveProperty('sub')
    expect(lastSent(next.sent)).not.toHaveProperty('audio')
  })

  test('a member\'s own choice lives in memory for the party only: nothing is stored, and it ends with the party', async () => {
    const storage = memoryStorage()
    const party = createPartyStore(api(fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] }).room), storage)
    await party.join(INVITE)
    expect([party.mine('subtitles'), party.mine('audio')]).toEqual(['party', 'party'])
    party.setMine('subtitles', null)
    party.setMine('audio', 'English')
    expect([party.mine('subtitles'), party.mine('audio')]).toEqual([null, 'English'])
    expect([...storage.store.keys()]).toEqual([PARTY_SESSION_KEY])
    await party.leave()
    expect([party.mine('subtitles'), party.mine('audio')]).toEqual(['party', 'party'])
  })
})

describe('a follower\'s status', () => {
  const NOW = 1_788_700_000_000
  const PAGE = '/watch/a/b'
  const READY = { s: 'ready', path: PAGE, time: 100, rate: 1 } as const
  const say = (fake: ReturnType<typeof fakeRoom>, seq: number, from: string, message: Parameters<typeof encodePartyMessage>[0]) =>
    fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false })
  const said = (fake: ReturnType<typeof fakeRoom>) => fake.sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'status')

  /** A guest whose host is on `hostPath`. */
  const following = async (hostPath = PAGE) => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    const party = createPartyStore(api(fake.room), memoryStorage())
    await party.join(INVITE)
    say(fake, 1, 'host', { t: 'state', path: hostPath, y: 0 })
    return { fake, party }
  }

  test('a guest says it at once and not again while nothing changes', async () => {
    const { fake, party } = await following()
    party.setStatus({ s: 'loading', path: PAGE, time: 100, rate: 0 })
    expect(said(fake)).toEqual([{ t: 'status', s: 'loading', path: PAGE, time: 100, rate: 0 }])
    await vi.advanceTimersByTimeAsync(3_000)
    party.setStatus({ s: 'loading', path: PAGE, time: 100, rate: 0 })
    party.setStatus({ s: 'loading', path: PAGE, time: 100.4, rate: 0 })
    expect(said(fake)).toHaveLength(1)
  })

  test(`a change goes out at most once per ${STATUS_GAP_MS} ms, the latest last, moved on to when it leaves`, async () => {
    const { fake, party } = await following()
    party.setStatus({ s: 'loading', path: PAGE, time: 100, rate: 0 })
    await vi.advanceTimersByTimeAsync(500)
    party.setStatus({ s: 'ready', path: PAGE, time: 100, rate: 0 })
    await vi.advanceTimersByTimeAsync(500)
    party.setStatus(READY)
    expect(said(fake)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(STATUS_GAP_MS - 1_000)
    expect(said(fake)).toEqual([
      { t: 'status', s: 'loading', path: PAGE, time: 100, rate: 0 },
      { t: 'status', ...READY, time: 101 },
    ])
  })

  test(`said again every ${STATUS_HEARTBEAT_MS / 1000} s while the host is on a watch page, and not while it is elsewhere`, async () => {
    const { fake, party } = await following()
    party.setStatus(READY)
    await vi.advanceTimersByTimeAsync(STATUS_HEARTBEAT_MS)
    expect(said(fake)).toEqual([{ t: 'status', ...READY }, { t: 'status', ...READY, time: 110 }])
    say(fake, 2, 'host', { t: 'nav', path: '/search?q=a' })
    await vi.advanceTimersByTimeAsync(STATUS_HEARTBEAT_MS * 2)
    expect(said(fake)).toHaveLength(2)
  })

  test('a guest that never said one is away, once the host is on a watch page', async () => {
    const { fake } = await following('/search?q=a')
    await vi.advanceTimersByTimeAsync(STATUS_HEARTBEAT_MS)
    expect(said(fake)).toEqual([])
    say(fake, 2, 'host', { t: 'nav', path: PAGE })
    await vi.advanceTimersByTimeAsync(STATUS_HEARTBEAT_MS)
    expect(said(fake)).toEqual([{ t: 'status', s: 'away' }])
  })

  test('the host says none, and keeps each follower\'s with when it was heard, in memory only', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const storage = memoryStorage()
    const fake = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1', 'g2'] })
    const party = createPartyStore(api(fake.room), storage)
    await party.create()
    party.setLocation(PAGE, 0)
    party.setStatus(READY)
    await vi.advanceTimersByTimeAsync(STATUS_HEARTBEAT_MS)
    expect(said(fake)).toEqual([])

    say(fake, 1, 'g1', { t: 'status', ...READY })
    say(fake, 2, 'g2', { t: 'status', s: 'away' })
    expect(party.statuses().get('g1')).toEqual({ status: READY, at: NOW + STATUS_HEARTBEAT_MS })
    expect(party.statuses().get('g2')).toEqual({ status: { s: 'away' }, at: NOW + STATUS_HEARTBEAT_MS })
    expect([...storage.store.keys()]).toEqual([PARTY_SESSION_KEY])

    fake.emit({ type: 'left', id: 'g1', reason: 'left' })
    expect([...party.statuses().keys()]).toEqual(['g2'])
  })

  test('a guest keeps nobody\'s, and a host\'s next party starts with none', async () => {
    const { fake, party: guest } = await following()
    say(fake, 2, 'other', { t: 'status', ...READY })
    expect(guest.statuses().size).toBe(0)

    const first = fakeRoom({ self: 'me', owner: 'me', members: ['me', 'g1'] })
    const rooms = api(first.room)
    const host = createPartyStore(rooms, memoryStorage())
    await host.create()
    say(first, 1, 'g1', { t: 'status', ...READY })
    expect(host.statuses().size).toBe(1)
    await host.leave()
    rooms.create.mockResolvedValueOnce(fakeRoom({ self: 'me', owner: 'me', members: ['me'] }).room)
    await host.create()
    expect(host.statuses().size).toBe(0)
  })
})
