// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyMessageMeta } from '../../../src/party/store'

const sent = vi.hoisted(() => [] as { t: string, path?: string, y?: number }[])
const located = vi.hoisted(() => [] as [string, number][])
const fraction = vi.hoisted(() => ({ y: 0 }))
const me = vi.hoisted(() => ({ role: 'host', hostPath: undefined as string | undefined }))
const scrolled = vi.hoisted(() => [] as number[])
// what the store tells: by then it has dropped an ask its sender was not granted
const told = vi.hoisted(() => new Set<(message: PartyMessage, meta: PartyMessageMeta) => void>())
vi.mock('../../../src/party', () => ({
  party: {
    getState: () => ({ status: 'active', role: me.role, invite: 'room' }),
    subscribe: () => () => {},
    onMessage: (listener: (message: PartyMessage, meta: PartyMessageMeta) => void) => { told.add(listener); return () => { told.delete(listener) } },
    setLocation: (path: string, y: number) => { located.push([path, y]) },
    send: (message: { t: string, path?: string }) => { sent.push(message) },
    hostPath: () => me.hostPath,
  },
}))
vi.mock('../../../src/party/scroll', () => ({ scrollFraction: () => fraction.y, scrollRoom: () => 0, scrollTo: (y: number) => { scrolled.push(y) } }))

const { default: PartySync } = await import('../../../src/components/party-sync')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  sent.length = 0
  located.length = 0
  fraction.y = 0
  me.role = 'host'
  me.hostPath = undefined
  scrolled.length = 0
})

const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

describe('the host', () => {
  // The room admits ten messages a second from each member, so a nav per keystroke gets the last
  // ones refused, and those carry the finished query.
  test('a word typed in the search box goes out as one nav, for the whole word', async () => {
    vi.useFakeTimers()
    const location = memoryLocation({ path: '/', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    await wait(1_000)
    sent.length = 0

    const word = 'mushoku tensei'
    for (let length = 1; length <= word.length; length++) {
      act(() => { location.navigate(`/search?${new URLSearchParams({ q: word.slice(0, length) })}`, { replace: length > 1 }) })
      await wait(50)
    }
    await wait(1_000)
    expect(sent.filter(message => message.t === 'nav')).toEqual([{ t: 'nav', path: '/search?q=mushoku+tensei' }])
  })

  test('any other move goes out at once', async () => {
    vi.useFakeTimers()
    const location = memoryLocation({ path: '/search?q=mushoku', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    await wait(1_000)
    sent.length = 0

    act(() => { location.navigate('/media/anilist:108465') })
    expect(sent.filter(message => message.t === 'nav')).toEqual([{ t: 'nav', path: '/media/anilist:108465' }])
  })

  // the follower's Play for everyone moves the host, and the host's own nav takes the party along
  test('a granted go takes the host there, even from the party page, and goes out as a nav', async () => {
    vi.useFakeTimers()
    const location = memoryLocation({ path: '/party', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    await wait(1_000)
    expect(sent).toEqual([])

    act(() => { for (const listener of told) listener({ t: 'ask', c: 'go', path: '/watch/a/b' }, { replayed: false, from: 'ann', self: false }) })
    expect(location.history.at(-1)).toBe('/watch/a/b')
    expect(sent.filter(message => message.t === 'nav')).toEqual([{ t: 'nav', path: '/watch/a/b' }])
  })

  // HOR-1011: the watch page scrolls down to its sources, and a guest following the host there would
  // lose the video the party is watching
  test('a scroll on the watch page stays the host\'s, and a guest joining there lands on the player', async () => {
    vi.useFakeTimers()
    fraction.y = 0.6
    const location = memoryLocation({ path: '/media/anilist:1', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    const scroll = async () => {
      act(() => { document.dispatchEvent(new Event('scroll')) })
      await wait(1_000)
    }
    await scroll()
    expect(sent.filter(message => message.t === 'scroll'), 'the control: a scroll elsewhere goes out').toEqual([{ t: 'scroll', y: 0.6 }])
    expect(located.at(-1)).toEqual(['/media/anilist:1', 0.6])

    sent.length = 0
    act(() => { location.navigate('/watch/a/b') })
    await scroll()
    expect(sent.filter(message => message.t === 'scroll')).toEqual([])
    expect(located.at(-1)).toEqual(['/watch/a/b', 0])
  })

  // HOR-1106: the address carries the host's own sources, which a follower's address does not share
  test('a page goes out without the host\'s sources in it', async () => {
    vi.useFakeTimers()
    const location = memoryLocation({ path: '/search?season=FALL&plugins=npm:a&year=2026', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    await wait(1_000)
    expect(sent.filter(message => message.t === 'nav')).toEqual([{ t: 'nav', path: '/search?season=FALL&year=2026' }])
    expect(located.at(-1)).toEqual(['/search?season=FALL&year=2026', 0])
  })

  // two followers asking at once, or one asking for where the host already is, must not cost the host its Back
  test('a go for the page the host is on leaves its history alone', async () => {
    const location = memoryLocation({ path: '/watch/a/b', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))

    act(() => { for (const listener of told) listener({ t: 'ask', c: 'go', path: '/watch/a/b' }, { replayed: false, from: 'ann', self: false }) })
    expect(location.history).toEqual(['/watch/a/b'])
  })
})

describe('a follower', () => {
  const hostSays = (message: PartyMessage) => act(() => { for (const listener of told) listener(message, { replayed: false, from: 'host', self: false }) })

  // HOR-1106: its address carries its own sources, which are not the host's
  test('whose sources differ from the host\'s follows the host\'s scroll on the host\'s page', async () => {
    me.role = 'guest'
    me.hostPath = '/search?season=FALL&year=2026'
    const location = memoryLocation({ path: '/search?season=FALL&year=2026&plugins=npm:b', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    hostSays({ t: 'scroll', y: 0.7 })
    expect(scrolled).toEqual([0.7])
    hostSays({ t: 'nav', path: '/search?season=FALL&year=2026' })
    expect(location.history, 'and is already there, so a nav moves nothing').toEqual(['/search?season=FALL&year=2026&plugins=npm:b'])
  })

  test('elsewhere keeps its own scroll', async () => {
    me.role = 'guest'
    me.hostPath = '/search?season=FALL&year=2026'
    const location = memoryLocation({ path: '/search?season=WINTER&year=2026&plugins=npm:b' })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))
    hostSays({ t: 'scroll', y: 0.7 })
    expect(scrolled).toEqual([])
  })
})
