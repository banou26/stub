// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

const sent = vi.hoisted(() => [] as { t: string, path?: string }[])
vi.mock('../../../src/party', () => ({
  party: {
    getState: () => ({ status: 'active', role: 'host', invite: 'room' }),
    subscribe: () => () => {},
    onMessage: () => () => {},
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
})
