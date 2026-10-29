// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createPartyStore } from '../../../src/party/store'
import { encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { default: PartyCursor } = await import('../../../src/components/party-cursor')

const PAGE = '/watch/a/b'
const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('a follower sees the host\'s pointer tagged with the host\'s name, else as the host', async () => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  const location = memoryLocation({ path: PAGE })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><PartyCursor/></Router>))
  hosts.push(host)
  let seq = 0
  const says = (message: PartyMessage) => act(() => {
    seq++
    fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: seq, text: encodePartyMessage(message) }, replayed: false })
  })
  says({ t: 'state', path: PAGE, y: 0 })
  says({ t: 'cursor', x: 0.5, y: 0.5 })
  expect(host.querySelector('.tag')?.textContent).toBe('host')
  says({ t: 'name', name: 'Mika' })
  says({ t: 'cursor', x: 0.6, y: 0.5 })
  expect(host.querySelector('.tag')?.textContent).toBe('Mika')
})
