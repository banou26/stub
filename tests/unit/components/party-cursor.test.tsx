// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { PartyMessage } from '../../../src/party/protocol'
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
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { default: PartyCursor } = await import('../../../src/components/party-cursor')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

describe('the host\'s cursor on a follower\'s page', () => {
  test('carries the host\'s typed name, else the default name of its member id', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.join(INVITE)
    let seq = 0
    const hostSays = (message: PartyMessage) =>
      act(() => { seq++; fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: seq, text: encodePartyMessage(message) }, replayed: false }) })
    hostSays({ t: 'state', path: '/watch/a/b', y: 0, grants: { all: [], by: {} } })
    const location = memoryLocation({ path: '/watch/a/b' })
    const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><PartyCursor/></Router>)
    hosts.push(host)

    hostSays({ t: 'cursor', x: 0.5, y: 0.5 })
    expect(host.querySelector('.tag')?.textContent).toBe(defaultName('host'))
    hostSays({ t: 'name', name: 'Hana' })
    hostSays({ t: 'cursor', x: 0.6, y: 0.5 })
    expect(host.querySelector('.tag')?.textContent).toBe('Hana')
  })
})
