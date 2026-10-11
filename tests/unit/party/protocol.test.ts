// A follower hands a decoded path straight to the router and a decoded state straight to its player,
// so the decoder is the one place that decides what a host can make a follower do.
import { describe, expect, test } from 'vite-plus/test'

import { CHAT_MAX_CHARS, NAME_MAX_CHARS, actionText, allowed, chatText, decodePartyMessage, displayName, encodePartyMessage, isAppPath, isHostOnly, PARTY_PROTOCOL, type PartyMessage } from '../../../src/party/protocol'

const PLAYBACK = { paused: false, time: 421.5, rate: 1, at: 1_788_700_000_000 }

describe('encode and decode', () => {
  test('every message round-trips', () => {
    const messages: PartyMessage[] = [
      { t: 'nav', path: '/search?season=FALL&year=2026' },
      { t: 'scroll', y: 0.42 },
      { t: 'playback', s: PLAYBACK },
      { t: 'state', path: '/watch/a/b', y: 0, s: PLAYBACK },
      { t: 'state', path: '/', y: 1 },
      { t: 'cursor', x: 0.25, y: 0.75 },
      { t: 'chat', text: 'hello there' },
      { t: 'name', name: 'Ann' },
      { t: 'ask', c: 'play', path: '/watch/a/b', s: PLAYBACK },
      { t: 'ask', c: 'seek', path: '/watch/a/b', s: PLAYBACK },
      { t: 'ask', c: 'rate', path: '/watch/a/b', s: { ...PLAYBACK, rate: 1.5 } },
      { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['seek', 'rate'], by: { sam: { seek: false }, ann: { rate: true } } } },
      { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play'], by: { sam: { play: false }, ann: {} } } },
    ]
    for (const message of messages) expect(decodePartyMessage(encodePartyMessage(message))).toEqual(message)
  })

  test('the version is on the wire, and another version is ignored', () => {
    expect(JSON.parse(encodePartyMessage({ t: 'scroll', y: 0 })).v).toBe(PARTY_PROTOCOL)
    expect(decodePartyMessage(JSON.stringify({ v: PARTY_PROTOCOL + 1, t: 'scroll', y: 0 }))).toBeUndefined()
  })

  test('anything that is not a message is nothing, never a throw', () => {
    for (const text of ['', 'hello', '{', 'null', '42', '[]', '{"v":1}', '{"v":1,"t":"dance"}']) {
      expect(() => decodePartyMessage(text), text).not.toThrow()
      expect(decodePartyMessage(text), text).toBeUndefined()
    }
  })

  test('a field of the wrong shape drops the whole message', () => {
    const bad = [
      { v: 1, t: 'scroll', y: 1.5 },
      { v: 1, t: 'scroll', y: -0.1 },
      { v: 1, t: 'scroll', y: '0.5' },
      { v: 1, t: 'playback', s: { ...PLAYBACK, rate: 0 } },
      { v: 1, t: 'playback', s: { ...PLAYBACK, time: -1 } },
      { v: 1, t: 'playback', s: { ...PLAYBACK, paused: 'no' } },
      { v: 1, t: 'playback', s: { ...PLAYBACK, at: Number.NaN } },
      { v: 1, t: 'state', path: '/', y: 0, s: { paused: true } },
      { v: 1, t: 'cursor', x: 2, y: 0 },
      { v: 1, t: 'cursor', x: 0.5 },
      { v: 1, t: 'chat', text: '   ' },
      { v: 1, t: 'chat', text: 42 },
      { v: 1, t: 'name', name: '' },
    ]
    for (const message of bad) expect(decodePartyMessage(JSON.stringify(message)), JSON.stringify(message)).toBeUndefined()
  })
})

describe('isAppPath', () => {
  test('a path inside the app', () => {
    expect(isAppPath('/')).toBe(true)
    expect(isAppPath('/media/anilist:1')).toBe(true)
    expect(isAppPath('/search?q=a%20b&genre=Action')).toBe(true)
  })

  // Every one of these is a string a browser reads as somewhere else, handed to a router that would
  // pass it on. A host must not be able to send a follower off the site.
  test('anything a browser would take somewhere else is refused', () => {
    for (const path of ['', 'search', '//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/a\nb', '/'.padEnd(3000, 'a')]) {
      expect(isAppPath(path), JSON.stringify(path)).toBe(false)
    }
    expect(decodePartyMessage(JSON.stringify({ v: 1, t: 'nav', path: '//evil.example' }))).toBeUndefined()
    expect(decodePartyMessage(JSON.stringify({ v: 1, t: 'state', path: 'https://evil.example', y: 0 }))).toBeUndefined()
  })
})

describe('the two classes', () => {
  test('steering is host only, talking is not', () => {
    expect(isHostOnly({ t: 'nav', path: '/' })).toBe(true)
    expect(isHostOnly({ t: 'scroll', y: 0 })).toBe(true)
    expect(isHostOnly({ t: 'cursor', x: 0, y: 0 })).toBe(true)
    expect(isHostOnly({ t: 'playback', s: PLAYBACK })).toBe(true)
    expect(isHostOnly({ t: 'state', path: '/', y: 0 })).toBe(true)
    expect(isHostOnly({ t: 'chat', text: 'hi' })).toBe(false)
    expect(isHostOnly({ t: 'name', name: 'Ann' })).toBe(false)
    expect(isHostOnly({ t: 'ask', c: 'play', path: '/', s: PLAYBACK })).toBe(false)
  })
})

describe('grants', () => {
  const state = (grants: unknown) => decodePartyMessage(JSON.stringify({ v: PARTY_PROTOCOL, t: 'state', path: '/watch/a/b', y: 0, grants }))

  // The next control added must not make every older follower drop every `state`: no joiner sync
  // and no Catch up until it updates.
  test('a control this version does not know is skipped, and the state survives', () => {
    expect(state({ all: ['play', 'teleport'], by: { sam: { teleport: true, play: false } } }))
      .toEqual({ t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play'], by: { sam: { play: false } } } })
  })

  test('grants of the wrong shape read as nobody may, and the state survives', () => {
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`member-${index}`, { play: true }]))
    for (const grants of ['play', { all: 'play', by: {} }, { all: [], by: [] }, { all: [], by: { sam: true } }, { all: [], by: { ['x'.repeat(129)]: { play: true } } }, { all: [], by: many }]) {
      expect(state(grants), JSON.stringify(grants).slice(0, 80)).toEqual({ t: 'state', path: '/watch/a/b', y: 0 })
    }
  })

  test('an ask for an unknown control, from off the app, or with a bad state is dropped', () => {
    for (const ask of [{ c: 'teleport', path: '/', s: PLAYBACK }, { c: 'play', path: '//evil.example', s: PLAYBACK }, { c: 'play', path: '/', s: { ...PLAYBACK, rate: 0 } }]) {
      expect(decodePartyMessage(JSON.stringify({ v: PARTY_PROTOCOL, t: 'ask', ...ask }))).toBeUndefined()
    }
  })

  test('allowed: a member\'s own entry wins, else all followers', () => {
    const grants = { all: ['play' as const], by: { sam: { play: false }, ann: {} } }
    expect(allowed(grants, 'ann', 'play')).toBe(true)
    expect(allowed(grants, 'bob', 'play')).toBe(true)
    expect(allowed(grants, 'sam', 'play')).toBe(false)
    expect(allowed({ all: [], by: { sam: { play: true } } }, 'sam', 'play')).toBe(true)
    expect(allowed({ all: [], by: { sam: { play: true } } }, 'bob', 'play')).toBe(false)
  })

  test('an ask reads as what it did', () => {
    expect(actionText({ t: 'ask', c: 'play', path: '/', s: { ...PLAYBACK, paused: true } })).toBe('paused')
    expect(actionText({ t: 'ask', c: 'play', path: '/', s: PLAYBACK })).toBe('resumed')
    expect(actionText({ t: 'ask', c: 'seek', path: '/', s: { ...PLAYBACK, time: 754.9 } })).toBe('skipped to 12:34')
    expect(actionText({ t: 'ask', c: 'seek', path: '/', s: { ...PLAYBACK, time: 3_725 } })).toBe('skipped to 1:02:05')
    expect(actionText({ t: 'ask', c: 'seek', path: '/', s: { ...PLAYBACK, time: 9 } })).toBe('skipped to 0:09')
    expect(actionText({ t: 'ask', c: 'rate', path: '/', s: { ...PLAYBACK, rate: 1.5 } })).toBe('set speed to 1.5x')
    expect(actionText({ t: 'ask', c: 'rate', path: '/', s: { ...PLAYBACK, rate: 2 } })).toBe('set speed to 2x')
    expect(actionText({ t: 'ask', c: 'rate', path: '/', s: { ...PLAYBACK, rate: 1.2999999 } })).toBe('set speed to 1.3x')
  })
})

describe('chatText and displayName', () => {
  test('trimmed, bounded, and nothing when there is nothing', () => {
    expect(chatText('  hello  ')).toBe('hello')
    expect(chatText('x'.repeat(CHAT_MAX_CHARS + 50))).toHaveLength(CHAT_MAX_CHARS)
    expect(chatText('   ')).toBeUndefined()
    expect(displayName('  Ann   Lee ')).toBe('Ann Lee')
    expect(displayName('n'.repeat(NAME_MAX_CHARS + 5))).toHaveLength(NAME_MAX_CHARS)
    expect(displayName('')).toBeUndefined()
  })

  // The decoder applies the same bound, so a line that arrives over the cap from a client that did
  // not bound it is cut rather than dropped: what was said still reaches the room.
  test('the decoder bounds what a sender did not', () => {
    const long = JSON.stringify({ v: PARTY_PROTOCOL, t: 'chat', text: 'y'.repeat(CHAT_MAX_CHARS + 100) })
    expect((decodePartyMessage(long) as { text: string }).text).toHaveLength(CHAT_MAX_CHARS)
  })
})
