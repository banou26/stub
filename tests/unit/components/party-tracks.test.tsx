// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { PartyMessage } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { createPartyStore } from '../../../src/party/store'
import { decodePartyMessage, encodePartyMessage } from '../../../src/party/protocol'
import { api, fakeRoom, INVITE, memoryStorage } from '../party/fake-room'

const current = vi.hoisted(() => ({ store: undefined as unknown as PartyStore }))
vi.mock('../../../src/party', () => ({ party: new Proxy({}, { get: (_, key) => current.store[key as keyof PartyStore] }) }))

const { default: PartyTracks } = await import('../../../src/components/party-tracks')

const TRACKS = {
  subtitles: { ids: ['English', 'Spanish'], selected: 'English' },
  audio: { ids: ['Japanese', 'English'], selected: 'Japanese' },
  busy: false,
}

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

let seq = 0
const render = async (self: string, said: PartyMessage[] = []) => {
  const fake = fakeRoom({ self, owner: 'host', members: ['host', 'me'] })
  current.store = createPartyStore(api(fake.room), memoryStorage())
  await (self === 'host' ? current.store.create() : current.store.join(INVITE))
  const say = (message: PartyMessage) => act(() => {
    seq++
    fake.emit({ type: 'message', message: { envelope: null, seq, from: 'host', at: seq, text: encodePartyMessage(message) }, replayed: false })
  })
  for (const message of said) say(message)
  const host = mount(<PartyTracks/>)
  hosts.push(host)
  act(() => { current.store.setPlayerTracks(TRACKS) })
  const select = (label: string) => [...host.querySelectorAll('label')].find(candidate => candidate.textContent?.startsWith(label))?.querySelector('select') ?? undefined
  const options = (label: string) => [...select(label)?.querySelectorAll('option') ?? []].map(option => option.textContent)
  // linkedom's select reads `value` off a `selected` attribute and cannot be set, so a pick is the change event alone
  const pick = (label: string, value: unknown) => act(() => {
    const target = select(label)!
    Object.defineProperty(target, 'value', { configurable: true, value: JSON.stringify(value) })
    target.dispatchEvent(new Event('change'))
  })
  const sent = () => fake.sent.map(text => decodePartyMessage(text))
  return { host, select, options, pick, say, sent }
}

describe('the party\'s tracks in the widget', () => {
  test('the host chooses the party\'s subtitles and audio, and Off is for subtitles only', async () => {
    const { options, pick, sent } = await render('host')
    expect(options('Party subtitles')).toEqual(['Not set', 'English', 'Spanish', 'Off'])
    expect(options('Party audio')).toEqual(['Not set', 'Japanese', 'English'])
    pick('Party subtitles', null)
    expect(sent().at(-1)).toMatchObject({ t: 'state', sub: null })
    pick('Party audio', 'English')
    expect(sent().at(-1)).toMatchObject({ t: 'state', sub: null, audio: 'English' })
  })

  test('My subtitles lists the party\'s choice first, then the player\'s tracks, then Off, and picks this member\'s own', async () => {
    const { options, pick } = await render('me', [{ t: 'state', path: '/', y: 0, sub: 'Spanish', audio: 'Japanese' }])
    expect(options('My subtitles')).toEqual(['Party (Spanish)', 'English', 'Spanish', 'Off'])
    expect(options('My audio')).toEqual(['Party (Japanese)', 'Japanese', 'English'])
    expect(current.store.mine('subtitles')).toBe('party')
    pick('My subtitles', 'English')
    expect(current.store.mine('subtitles')).toBe('English')
  })

  test('a follower without Subtitles reads the party\'s choice, one with it asks the host', async () => {
    const plain = await render('me', [{ t: 'state', path: '/', y: 0, sub: 'Spanish' }])
    expect(plain.select('Party subtitles')).toBeUndefined()
    expect(plain.host.textContent).toContain('Party subtitlesSpanish')
    unmount(hosts.pop()!)

    const granted = await render('me', [{ t: 'state', path: '/', y: 0, sub: 'Spanish', grants: { all: ['subs'], by: {} } }])
    expect(granted.select('Party audio')).toBeUndefined()
    granted.pick('Party subtitles', 'English')
    expect(granted.sent().at(-1)).toEqual({ t: 'ask', c: 'subs', sub: 'English' })
  })

  test('a choice this player does not have is still listed', async () => {
    const { options } = await render('me', [{ t: 'state', path: '/', y: 0, sub: 'French', grants: { all: ['subs'], by: {} } }])
    expect(options('Party subtitles')).toEqual(['French', 'English', 'Spanish', 'Off'])
    act(() => { current.store.setMine('subtitles', 'German') })
    expect(options('My subtitles')).toEqual(['Party (French)', 'German', 'English', 'Spanish', 'Off'])
  })

  test('nothing without a player that serves tracks', async () => {
    const { host } = await render('host')
    act(() => { current.store.setPlayerTracks(undefined) })
    expect(host.textContent).toBe('')
  })
})
