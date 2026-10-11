// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { PartyStore } from '../../../src/party/store'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, memoryStorage } from '../party/fake-room'

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Check: () => null, Clapperboard: () => null, FastForward: () => null, Gauge: () => null, MessageCircle: () => null, Play: () => null, Send: () => null, X: () => null }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { default: PartyGrants } = await import('../../../src/components/party-grants')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const hosting = async () => {
  const members = ['host', 'ann', 'sam1234567']
  const fake = fakeRoom({ self: 'host', owner: 'host', members })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.create()
  fake.emit({ type: 'message', message: { seq: 1, from: 'ann', at: 1, text: encodePartyMessage({ t: 'name', name: 'Ann' }) }, replayed: false })
  const host = mount(<PartyGrants/>)
  hosts.push(host)
  await act(() => new Promise(resolve => setTimeout(resolve, 0)))
  const cell = (label: string, control = 'Play/pause') => host.querySelector<HTMLButtonElement>(`button[aria-label="${control}, ${label}"]`)!
  const click = (label: string, control?: string) => act(() => { cell(label, control).click() })
  return { fake, members, host, cell, click }
}

describe('the host hands out controls', () => {
  test('a row per follower, named as chat names them, under All followers', async () => {
    const { host } = await hosting()
    expect([...host.querySelectorAll('tbody th')].map(row => row.textContent)).toEqual(['All followers', 'Ann', 'sam123'])
  })

  test('All followers gives a control to every follower, and tells the party', async () => {
    const { fake, click, cell } = await hosting()
    click('All followers')
    expect(current.store.issued()).toEqual({ all: ['play'], by: {} })
    expect(decodePartyMessage(fake.sent.at(-1)!)).toMatchObject({ t: 'state', grants: { all: ['play'], by: {} } })
    expect(cell('All followers').getAttribute('aria-pressed')).toBe('true')
    // a follower with no entry of its own follows the row above
    expect(cell('Ann').getAttribute('aria-pressed')).toBe('true')
    expect(cell('Ann').dataset.grant).toBe('all')
  })

  // "everyone except Sam": a follower's cell can take away what all followers have, in one click
  test('a follower\'s cell turns off what all followers have, then on, then back to all followers', async () => {
    const { click, cell } = await hosting()
    click('All followers')
    click('Ann')
    expect(current.store.issued()).toEqual({ all: ['play'], by: { ann: { play: false } } })
    expect(cell('Ann').getAttribute('aria-pressed')).toBe('false')
    expect(cell('Ann').dataset.grant).toBe('off')
    expect(cell('sam123').getAttribute('aria-pressed')).toBe('true')
    click('Ann')
    expect(current.store.issued()).toEqual({ all: ['play'], by: { ann: { play: true } } })
    expect(cell('Ann').dataset.grant).toBe('on')
    click('Ann')
    expect(current.store.issued()).toEqual({ all: ['play'], by: {} })
    expect(cell('Ann').dataset.grant).toBe('all')
  })

  test('a follower\'s cell turns on what all followers lack, then off, then back to all followers', async () => {
    const { click, cell } = await hosting()
    click('Ann')
    expect(current.store.issued()).toEqual({ all: [], by: { ann: { play: true } } })
    expect(cell('Ann').getAttribute('aria-pressed')).toBe('true')
    click('Ann')
    expect(current.store.issued()).toEqual({ all: [], by: { ann: { play: false } } })
    expect(cell('Ann').dataset.grant).toBe('off')
    click('Ann')
    expect(current.store.issued()).toEqual({ all: [], by: {} })
  })

  test('Seek, Episode and Speed are columns of their own, three-state like Play/pause', async () => {
    const { click, cell, host } = await hosting()
    expect([...host.querySelectorAll('thead th')].map(th => th.getAttribute('title'))).toEqual([null, 'Play/pause', 'Seek', 'Episode', 'Speed'])
    click('All followers', 'Seek')
    click('Ann', 'Speed')
    click('sam123', 'Seek')
    click('Ann', 'Episode')
    expect(current.store.issued()).toEqual({ all: ['seek'], by: { ann: { rate: true, go: true }, sam1234567: { seek: false } } })
    expect(cell('Ann', 'Seek').dataset.grant).toBe('all')
    expect(cell('sam123', 'Seek').dataset.grant).toBe('off')
    expect(cell('Ann', 'Play/pause').getAttribute('aria-pressed')).toBe('false')
  })

  // the store is the only copy: a grid keeping its own would hand a departed member's entry back
  test('a member who left is not put back by the next click', async () => {
    const { fake, members, click } = await hosting()
    click('sam123')
    members.splice(members.indexOf('sam1234567'), 1)
    act(() => { fake.emit({ type: 'left', id: 'sam1234567', reason: 'left' }) })
    click('All followers')
    expect(current.store.issued()).toEqual({ all: ['play'], by: {} })
    expect(decodePartyMessage(fake.sent.at(-1)!)).toMatchObject({ grants: { all: ['play'], by: {} } })
  })
})
