// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { defaultName } from '@banou/fkn-social/names'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { createPartyStore } from '../../../src/party/store'
import { encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ MessageCircle: () => null, Send: () => null, X: () => null }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

// linkedom lays nothing out, so an element has no scrollTo for the panel's keep-at-the-bottom
Object.assign(Element.prototype, { scrollTo: () => {} })

const { default: PartyChat } = await import('../../../src/components/party-chat')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

/** A guest's chat, with any member able to say something in it. */
const chatting = async () => {
  const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'alex', 'bob'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await current.store.join(INVITE)
  const host = mount(<PartyChat/>)
  hosts.push(host)
  let seq = 0
  const say = (from: string, message: PartyMessage) =>
    act(() => { seq++; fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })
  const open = () => act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Show chat"]')!.click() })
  const lines = () => [...host.querySelectorAll('.line')].map(line => [line.className, line.textContent])
  return { host, say, open, lines }
}

describe('who said it', () => {
  test('a member who typed no name, the host included, reads as the default name of their member id', async () => {
    const { say, open, lines } = await chatting()
    say('host', { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play'], by: {} } })
    say('host', { t: 'chat', text: 'starting' })
    say('bob', { t: 'chat', text: 'ok' })
    say('bob', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: true, time: 1, rate: 1, at: 1 } })
    say('alex', { t: 'name', name: 'Alex' })
    say('alex', { t: 'chat', text: 'hi' })
    open()
    expect(lines()).toEqual([
      ['line', `${defaultName('host')}starting`],
      ['line', `${defaultName('bob')}ok`],
      ['line action', `${defaultName('bob')} paused`],
      ['line', 'Alexhi'],
    ])
  })
})

describe('an action line', () => {
  test('reads as the member doing it, apart from what was said, and counts as unread', async () => {
    const { host, say, open, lines } = await chatting()
    say('host', { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play'], by: {} } })
    say('alex', { t: 'name', name: 'Alex' })
    say('alex', { t: 'chat', text: 'ready?' })
    say('me', { t: 'chat', text: 'yes' })
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: true, time: 1, rate: 1, at: 1 } })
    expect(host.querySelector('.unread')?.textContent).toBe('2')
    // a pause then a resume is one line, so one unread
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: false, time: 1, rate: 1, at: 1 } })
    expect(host.querySelector('.unread')?.textContent).toBe('2')

    open()
    expect(lines()).toEqual([
      ['line', 'Alexready?'],
      ['line self', 'youyes'],
      ['line action', 'Alex resumed'],
    ])
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Hide chat"]')!.click() })
    expect(host.querySelector('.unread')).toBeNull()
    // a line that was already read and is replaced is news again
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: true, time: 1, rate: 1, at: 1 } })
    expect(host.querySelector('.unread')?.textContent).toBe('1')
  })
})
