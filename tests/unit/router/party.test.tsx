// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { PartyStore } from '../../../src/party/store'

import { defaultName } from '@banou/fkn-social/names'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createPartyStore } from '../../../src/party/store'
import { encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Ban: () => null, Check: () => null, Copy: () => null, LogOut: () => null, UserX: () => null }))
vi.mock('../../../src/party', () => ({
  party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }),
  partyLink: () => 'link',
}))

// the page reads an invite from the fragment, and builds its own link on the origin
Object.assign(globalThis, { location: { origin: 'https://stub.test', hash: '' } })

const { default: Party } = await import('../../../src/router/party')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

describe('who is in the party', () => {
  test('a member who typed no name reads as the default name of their member id, and the id is not shown', async () => {
    const fake = fakeRoom({ self: 'host', owner: 'host', members: ['host', 'ann', 'sam1234567'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.create()
    fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'ann', at: 1, text: encodePartyMessage({ t: 'name', name: 'Ann' }) }, replayed: false })
    const location = memoryLocation({ path: '/party' })
    const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><Party/></Router>)
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))

    const rows = [...host.querySelectorAll<HTMLElement>('.row')]
    expect(rows.map(row => row.querySelector('.name')?.textContent)).toEqual([defaultName('host'), 'Ann', defaultName('sam1234567')])
    expect(rows.map(row => row.querySelector('.badge')?.textContent)).toEqual(['host', undefined, undefined])
    expect(host.textContent).not.toContain('sam1234567')
  })

  test('the name box shows your own default name, the one the others see, until you type one', async () => {
    const fake = fakeRoom({ self: 'ann', owner: 'host', members: ['host', 'ann'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.join(INVITE)
    const location = memoryLocation({ path: '/party' })
    const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><Party/></Router>)
    hosts.push(host)
    await act(() => new Promise(resolve => setTimeout(resolve, 0)))

    expect(host.querySelector<HTMLInputElement>('input[aria-label="Your name"]')?.placeholder).toBe(defaultName('ann'))
  })
})
