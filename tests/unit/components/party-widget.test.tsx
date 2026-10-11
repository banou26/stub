// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from './dom'

import type { Grants, PartyMessage } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

// the REAL store, over a fake room each test builds, behind the module every component imports
const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Check: () => null, Clapperboard: () => null, Copy: () => null, FastForward: () => null, Gauge: () => null, LogOut: () => null, Play: () => null, Radio: () => null, Users: () => null, X: () => null }))
vi.mock('../../../src/party', () => ({
  party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }),
  partyLink: () => 'link',
}))

// the invite link reads the page's origin
Object.assign(globalThis, { location: { origin: 'https://stub.test' } })

const { default: PartyWidget } = await import('../../../src/components/party-widget')

const HOST_PAGE = '/watch/a/b'
const PLAY = 'Play for everyone'

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

/** A follower on `page` whose host is on HOST_PAGE, with the widget's menu open. */
const following = async (page: string, grants: Grants) => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  fake.emit({ type: 'message', message: { seq: 1, from: 'host', at: 1, text: encodePartyMessage({ t: 'state', path: HOST_PAGE, y: 0, grants }) }, replayed: false })
  const location = memoryLocation({ path: page })
  const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>)
  hosts.push(host)
  act(() => { button(host, 'Following2')!.click() })
  const asks = () => fake.sent.map(text => decodePartyMessage(text)).filter(message => message?.t === 'ask')
  const hostSays = (message: PartyMessage) => act(() => {
    fake.emit({ type: 'message', message: { seq: 2, from: 'host', at: 2, text: encodePartyMessage(message) }, replayed: false })
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
    const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><PartyWidget/></Router>)
    hosts.push(host)
    act(() => { [...host.querySelectorAll('button')].find(candidate => candidate.textContent?.startsWith('Hosting'))!.click() })
    expect(document.body.textContent).toContain('You are hosting')
    expect(toggle()).toBeNull()
  })
})
