// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount, withIntl } from './dom'

import type { Grants, PartyMessage } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { inviteFromHash } from '../../../src/party/invite'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

// the REAL store, over a fake room each test builds, behind the module every component imports
const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ AudioLines: () => null, Captions: () => null, Check: () => null, CircleCheck: () => null, CircleDashed: () => null, Clapperboard: () => null, Copy: () => null, FastForward: () => null, Gauge: () => null, LoaderCircle: () => null, LogOut: () => null, Play: () => null, Radio: () => null, Users: () => null, X: () => null }))
vi.mock('../../../src/party', async () => ({
  party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }),
  partyLink: (await import('../../../src/party/invite')).partyLink,
}))
const added = vi.hoisted(() => ({ sources: [] as string[] }))
vi.mock('../../../src/plugin-list', () => ({ loadEnabled: () => added.sources }))

// the invite link reads the page's address
Object.assign(globalThis, { location: { origin: 'https://stub.test', href: 'https://stub.test/watch/a/b' } })

const { default: PartyWidget } = await import('../../../src/components/party-widget')

const HOST_PAGE = '/watch/a/b'
const PLAY = 'Play for everyone'

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!); added.sources = [] })

/** A follower on `page` whose host is on HOST_PAGE, with the widget's menu open. */
const following = async (page: string, grants: Grants) => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'host', at: 1, text: encodePartyMessage({ t: 'state', path: HOST_PAGE, y: 0, grants }) }, replayed: false })
  const location = memoryLocation({ path: page })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>))
  hosts.push(host)
  act(() => { button(host, 'Following2')!.click() })
  const asks = () => fake.sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'ask')
  const hostSays = (message: PartyMessage) => act(() => {
    fake.emit({ type: 'message', message: { envelope: null, seq: 2, from: 'host', at: 2, text: encodePartyMessage(message) }, replayed: false })
  })
  return { asks, hostSays, play: () => button(document.body, ` ${PLAY}`) }
}

describe('Play for everyone', () => {
  test('one click on another watch page asks the host to go there, once', async () => {
    const { asks, play } = await following('/watch/a/c?release=2', { all: ['go'], by: {} })
    act(() => { play()!.click() })
    expect(asks()).toEqual([{ t: 'ask', c: 'go', path: '/watch/a/c?release=2' }])
    expect(play()).toBeUndefined()
  })

  test('not without the Episode grant', async () => {
    const { play } = await following('/watch/a/c', { all: ['go'], by: { me: { go: false } } })
    expect(play()).toBeUndefined()
  })

  test('not on the host\'s own page', async () => {
    const { play } = await following(HOST_PAGE, { all: ['go'], by: {} })
    expect(play()).toBeUndefined()
  })

  // HOR-1106: its address carries its own sources, which are not the host's
  test('not on the host\'s own page with other sources than the host\'s', async () => {
    const { play } = await following(`${HOST_PAGE}?plugins=npm:b`, { all: ['go'], by: {} })
    expect(play()).toBeUndefined()
  })

  test('gone once the host comes to this page', async () => {
    const { hostSays, play } = await following('/watch/a/c', { all: ['go'], by: {} })
    expect(play()).toBeDefined()
    hostSays({ t: 'nav', path: '/watch/a/c' })
    expect(play()).toBeUndefined()
  })

  test('not off a watch page', async () => {
    const { play } = await following('/search?q=a', { all: ['go'], by: {} })
    expect(play()).toBeUndefined()
  })
})

describe('Follow playback', () => {
  const toggle = () => document.body.querySelector<HTMLInputElement>('input[role="switch"]')

  test('a follower follows by default, the switch shows what the store holds, and turns it off', async () => {
    await following(HOST_PAGE, { all: [], by: {} })
    expect(toggle()?.parentElement?.textContent).toBe('Follow playback')
    expect(toggle()?.hasAttribute('checked')).toBe(true)
    act(() => { current.store.setFollowing(false) })
    expect(toggle()?.hasAttribute('checked')).toBe(false)
    act(() => { current.store.replay() })
    expect(toggle()?.hasAttribute('checked')).toBe(true)
    act(() => { toggle()!.checked = false; toggle()!.dispatchEvent(new Event('change')) })
    expect(current.store.following()).toBe(false)
  })

  test('the host has no such switch', async () => {
    const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.create()
    const location = memoryLocation({ path: HOST_PAGE })
    const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>))
    hosts.push(host)
    act(() => { [...host.querySelectorAll('button')].find(candidate => candidate.textContent?.startsWith('Hosting'))!.click() })
    expect(document.body.textContent).toContain('You are hosting')
    expect(toggle()).toBeNull()
  })
})

describe('the host\'s count of where followers stand', () => {
  const hosting = async (page: string) => {
    const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host', 'ann', 'sam', 'kim', 'old'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.create()
    const location = memoryLocation({ path: page })
    const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>))
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))
    act(() => { [...host.querySelectorAll('button')].find(candidate => candidate.textContent?.startsWith('Hosting'))!.click() })
    let seq = 0
    const says = (from: string, message: PartyMessage) => act(() => {
      seq++
      fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false })
    })
    return { says, tally: () => document.body.querySelector('.tally')?.textContent }
  }

  test('how many are ready, loading and away, in words, as each follower says', async () => {
    const { says, tally } = await hosting(HOST_PAGE)
    expect(tally()).toBeUndefined()
    says('ann', { t: 'status', s: 'ready', path: HOST_PAGE, time: 10, rate: 0 })
    says('sam', { t: 'status', s: 'loading', path: HOST_PAGE })
    says('kim', { t: 'status', s: 'away' })
    expect(tally()).toBe('1 ready1 loading1 away')
    says('sam', { t: 'status', s: 'ready', path: HOST_PAGE, time: 10, rate: 0 })
    expect(tally()).toBe('2 ready1 away')
  })

  // HOR-1106: the host's address carries the host's sources, and a follower's status names the page without them
  test('a follower on the host\'s page counts as on it, whatever sources the host\'s address carries', async () => {
    const { says, tally } = await hosting(`${HOST_PAGE}?plugins=npm:a`)
    says('ann', { t: 'status', s: 'ready', path: HOST_PAGE, time: 10, rate: 0 })
    expect(tally()).toBe('1 ready')
  })

  test('not off a watch page', async () => {
    const { says, tally } = await hosting('/search?q=a')
    says('ann', { t: 'status', s: 'ready', path: HOST_PAGE, time: 10, rate: 0 })
    expect(tally()).toBeUndefined()
  })
})

// HOR-845: a follower without one of the host's sources had no player and was never offered it
describe('the invite link', () => {
  const invite = async () => {
    const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.create()
    const location = memoryLocation({ path: HOST_PAGE })
    const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>))
    hosts.push(host)
    act(() => { [...host.querySelectorAll('button')].find(candidate => candidate.textContent?.startsWith('Hosting'))!.click() })
    return document.body.querySelector<HTMLInputElement>('input[aria-label="Invite link"]')!.value
  }

  test('offers every source the host added, and keeps the invite in the fragment', async () => {
    added.sources = ['npm:@banou/stub-plugin', 'https:stub.plugins.banou.dev']
    const link = await invite()
    expect(link).toBe(`https://stub.test/party?plugins=https:stub.plugins.banou.dev&plugins=npm:@banou/stub-plugin#${INVITE}`)
    expect(inviteFromHash(new URL(link).hash, 'https://stub.test')).toBe(INVITE)
  })

  test('carries no query when the host added none', async () => {
    expect(await invite()).toBe(`https://stub.test/party#${INVITE}`)
  })
})

describe('the widget\'s English', () => {
  const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))
  /** The widget over a store `start` moved, at HOST_PAGE, its menu open when it has one. */
  const shown = async (start: (store: PartyStore) => Promise<unknown> | void) => {
    const location = memoryLocation({ path: HOST_PAGE })
    await start(current.store)
    const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>))
    hosts.push(host)
    await settle()
    const trigger = host.querySelector('button')!
    if (trigger.hasAttribute('aria-expanded') && trigger.getAttribute('aria-expanded') !== 'true') act(() => { trigger.click() })
    const menu = () => [...document.body.querySelectorAll('.title, .hint, .can, .follow, .actions button')].map(element => element.textContent)
    return { host, trigger, menu }
  }
  const room = (self: string, members: string[], joinError?: Parameters<typeof api>[1]) => {
    const fake = fakeRoom({ self, owner: 'host', members })
    current.store = createPartyStore(api(fake.room, joinError), memoryStorage())
    return fake
  }

  test('with no party, one button', async () => {
    room('host', ['host'])
    const { trigger } = await shown(() => {})
    expect([trigger.getAttribute('title'), trigger.textContent]).toEqual(['Watch party', 'Watch party'])
  })

  test('joining', async () => {
    current.store = createPartyStore({ available: async () => true, create: () => new Promise(() => {}), join: () => new Promise(() => {}) } as unknown as Parameters<typeof createPartyStore>[0], memoryStorage())
    const { trigger, menu } = await shown(store => { void store.join(INVITE) })
    expect(trigger.textContent).toBe('Joining…')
    expect(menu()).toEqual(['Joining the party…'])
  })

  test('the host, alone, then with one and with two followers', async () => {
    const fake = room('host', ['host'])
    const { trigger, menu } = await shown(store => store.create())
    expect(trigger.textContent).toBe('Hosting1')
    expect(menu()).toEqual(['You are hosting', 'Nobody has joined yet.', ' Party', ' End party'])
    expect([...document.body.querySelectorAll('.link [aria-label]')].map(element => element.getAttribute('aria-label'))).toEqual(['Invite link', 'Copy invite link'])
    for (const [id, hint] of [['ann', '1 person is following you.'], ['sam', '2 people are following you.']]) {
      fake.join(id!)
      act(() => { fake.emit({ type: 'joined', member: { id: id! } } as Parameters<typeof fake.emit>[0]) })
      await settle()
      expect(document.body.querySelector('.hint')?.textContent).toBe(hint)
    }
  })

  test('a follower, with every control', async () => {
    const fake = room('me', ['host', 'me'])
    const { trigger, menu } = await shown(async store => {
      await store.join(INVITE)
      fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'host', at: 1, text: encodePartyMessage({ t: 'state', path: '/watch/a/c', y: 0, grants: { all: ['play', 'seek', 'go', 'rate', 'subs', 'audio'], by: {} } }) }, replayed: false })
    })
    expect(trigger.textContent).toBe('Following2')
    expect(menu()).toEqual([
      'You are following the host', '2 in the party.', 'Follow playback', 'You can Play/pauseSeekEpisodeSpeedSubtitlesAudio',
      ` ${PLAY}`, 'Catch up', ' Party', ' Leave',
    ])
  })

  test('why a party ended, and why one could not start', async () => {
    const ended = [['left', 'You left the party.'], ['removed', 'You were removed from the party.'], ['blocked', 'You were removed from the party.'], ['ended', 'The party ended.'], ['unavailable', 'The party was lost. Parties are unavailable right now.']] as const
    for (const [reason, title] of ended) {
      const fake = room('me', ['host', 'me'])
      const { trigger, menu, host } = await shown(async store => { await store.join(INVITE); fake.end(reason) })
      expect([trigger.textContent, ...menu()], reason).toEqual(['Party over', title, 'OK'])
      unmount(hosts.splice(hosts.indexOf(host), 1)[0]!)
    }
    const fake = room('me', ['host', 'me'])
    const { trigger, menu, host } = await shown(async store => { await store.join(INVITE); fake.emit({ type: 'left', id: 'host' } as Parameters<typeof fake.emit>[0]) })
    expect([trigger.textContent, ...menu()]).toEqual(['Party over', 'The host left the party.', 'OK'])
    unmount(hosts.splice(hosts.indexOf(host), 1)[0]!)

    const failed = [
      ['not-found', 'That party has ended.'], ['bad-key', 'That invite link is not valid.'], ['invalid', 'That invite link is broken.'],
      ['full', 'That party is full.'], ['blocked', 'You cannot join that party.'], ['unavailable', 'Parties are not available right now. Is FKN connected?'],
      ['rate-limited', 'Too many attempts. Try again in a moment.'], ['denied', 'The party could not start.'],
    ] as const
    for (const [code, title] of failed) {
      room('me', ['host', 'me'], code)
      const { trigger, menu, host } = await shown(store => store.join(INVITE))
      expect([trigger.textContent, ...menu()], code).toEqual(['Party failed', title, 'OK'])
      unmount(hosts.splice(hosts.indexOf(host), 1)[0]!)
    }
  })
})
