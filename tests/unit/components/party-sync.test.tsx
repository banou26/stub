// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyMessageMeta } from '../../../src/party/store'

const sent = vi.hoisted(() => [] as { t: string, path?: string }[])
// what the store tells: by then it has dropped an ask its sender was not granted
const told = vi.hoisted(() => new Set<(message: PartyMessage, meta: PartyMessageMeta) => void>())
vi.mock('../../../src/party', () => ({
  party: {
    getState: () => ({ status: 'active', role: 'host', invite: 'room' }),
    subscribe: () => () => {},
    onMessage: (listener: (message: PartyMessage, meta: PartyMessageMeta) => void) => { told.add(listener); return () => { told.delete(listener) } },
    setLocation: () => {},
    send: (message: { t: string, path?: string }) => { sent.push(message) },
    hostPath: () => undefined,
  },
}))
vi.mock('../../../src/party/scroll', () => ({ scrollFraction: () => 0, scrollRoom: () => 0, scrollTo: () => {} }))

const { default: PartySync } = await import('../../../src/components/party-sync')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  sent.length = 0
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

  // two followers asking at once, or one asking for where the host already is, must not cost the host its Back
  test('a go for the page the host is on leaves its history alone', async () => {
    const location = memoryLocation({ path: '/watch/a/b', record: true })
    hosts.push(mount(<Router hook={location.hook} searchHook={location.searchHook}><PartySync/></Router>))

    act(() => { for (const listener of told) listener({ t: 'ask', c: 'go', path: '/watch/a/b' }, { replayed: false, from: 'ann', self: false }) })
    expect(location.history).toEqual(['/watch/a/b'])
  })
})
