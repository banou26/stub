// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { PartyStore } from '../../../src/party/store'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { createPartyStore } from '../../../src/party/store'
import { encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

// the REAL store, over a fake room each test builds, behind the module the page imports
const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ Ban: () => null, Check: () => null, Copy: () => null, LogOut: () => null, UserX: () => null }))
vi.mock('../../../src/party', async () => ({
  party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }),
  partyLink: (await import('../../../src/party/invite')).partyLink,
}))

const { default: Party } = await import('../../../src/router/party')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

/** The party page at `hash`, over a store `start` moved. */
const page = async (hash: string, start: (store: PartyStore) => Promise<unknown> | void = () => {}) => {
  Object.assign(globalThis, { location: { origin: 'https://stub.test', hash } })
  await start(current.store)
  const location = memoryLocation({ path: '/party' })
  const host = mount(<Router hook={location.hook} searchHook={location.searchHook}><Party/></Router>)
  hosts.push(host)
  await settle()
  return host
}
const room = (self: string, members: string[], joinError?: Parameters<typeof api>[1]) => {
  const fake = fakeRoom({ self, owner: 'host', members })
  current.store = createPartyStore(api(fake.room, joinError), memoryStorage())
  return fake
}
const status = (host: HTMLElement) => host.querySelector('.status')!.textContent

describe('the party page\'s English', () => {
  test('out of a party, its heading, and why it is not in one', async () => {
    room('me', ['host', 'me'])
    const host = await page('')
    expect(host.querySelector('.heading')?.textContent).toBe('Watch together')
    expect(status(host)).toBe('You are not in a party. Start one from the header.')
    unmount(hosts.pop()!)
    expect(status(await page('#not-an-invite'))).toBe('This invite link is broken. Ask the host for a new one.')
  })

  test('joining, and why a join failed or a party ended', async () => {
    current.store = createPartyStore({ available: async () => true, create: () => new Promise(() => {}), join: () => new Promise(() => {}) } as unknown as Parameters<typeof createPartyStore>[0], memoryStorage())
    expect(status(await page('', store => { void store.join(INVITE) }))).toBe('Joining the party…')
    unmount(hosts.pop()!)
    expect(status(await page(`#${INVITE}`))).toBe('Joining the party…')
    unmount(hosts.pop()!)

    const failed = [
      ['not-found', 'That party has ended.'], ['bad-key', 'The invite link is not valid.'], ['invalid', 'The invite link is broken.'],
      ['full', 'The party is full.'], ['blocked', 'You cannot join this party.'], ['unavailable', 'Parties are not available right now. Is FKN connected?'],
      ['rate-limited', 'Something went wrong.'],
    ] as const
    for (const [code, reason] of failed) {
      room('me', ['host', 'me'], code)
      expect(status(await page('', store => store.join(INVITE))), code).toBe(`Could not join. ${reason} OK`)
      unmount(hosts.pop()!)
      room('me', ['host', 'me'], code)
      expect(status(await page(`#${INVITE}`)), code).toBe(`Could not join. ${reason}`)
      unmount(hosts.pop()!)
    }

    const fake = room('me', ['host', 'me'])
    expect(status(await page('', async store => { await store.join(INVITE); fake.end('ended') }))).toBe('The party ended. OK')
  })

  test('a follower, with and without the invite it came by', async () => {
    room('me', ['host', 'me'])
    expect(status(await page(`#${INVITE}`))).toBe('You are in. Waiting for the host…')
    unmount(hosts.pop()!)
    room('me', ['host', 'me'])
    const host = await page('', store => store.join(INVITE))
    expect(status(host)).toBe('You are following the host. Go home')
    expect(host.querySelector('.status a')?.textContent).toBe('Go home')
    expect(host.querySelector('.section:last-child button')?.textContent).toBe(' Leave party')
  })

  test('the host\'s page: a name, the invite, who is in, and the door', async () => {
    const fake = room('host', ['host', 'ann'])
    const host = await page('', async store => {
      await store.create()
      fake.emit({ type: 'message', message: { envelope: null, seq: 1, from: 'ann', at: 1, text: encodePartyMessage({ t: 'name', name: 'Ann' }) }, replayed: false })
    })
    expect(status(host)).toBe('You are hosting.')
    expect([...host.querySelectorAll('.section > .label')].map(label => label.textContent)).toEqual(['Your name', 'Invite link', 'In the party (2)'])
    const [name, link] = [...host.querySelectorAll('.field input')]
    expect([name!.getAttribute('placeholder'), name!.getAttribute('aria-label'), link!.getAttribute('aria-label')]).toEqual(['What the party should call you', 'Your name', 'Invite link'])
    expect([...host.querySelectorAll('.field button')].map(button => button.textContent)).toEqual([' Save', ' Copy'])
    expect([...host.querySelectorAll('.row .badge')].map(badge => badge.textContent)).toEqual(['host', 'you'])
    expect([...host.querySelectorAll('.row')].at(-1)?.textContent).toBe('Annann Kick Ban')
    expect(host.querySelector('.section:last-child button')?.textContent).toBe(' End party')
  })
})
