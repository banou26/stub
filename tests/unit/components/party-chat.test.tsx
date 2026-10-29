// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { PartyMessage, PlaybackState } from '../../../src/party/protocol'
import type { PartyStore } from '../../../src/party/store'

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
const { startLanguage } = await import('../../../src/i18n')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

describe('an action line', () => {
  test('reads as the member doing it, apart from what was said, and counts as unread', async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'alex'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.join(INVITE)
    const host = mount(withIntl(<PartyChat/>))
    hosts.push(host)
    let seq = 0
    const say = (from: string, message: PartyMessage) =>
      act(() => { seq++; fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })

    say('host', { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play'], by: {} } })
    say('alex', { t: 'name', name: 'Alex' })
    say('alex', { t: 'chat', text: 'ready?' })
    say('me', { t: 'chat', text: 'yes' })
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: true, time: 1, rate: 1, at: 1 } })
    expect(host.querySelector('.unread')?.textContent).toBe('2')
    // a pause then a resume is one line, so one unread
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: { paused: false, time: 1, rate: 1, at: 1 } })
    expect(host.querySelector('.unread')?.textContent).toBe('2')

    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Show chat"]')!.click() })
    expect([...host.querySelectorAll('.line')].map(line => [line.className, line.textContent])).toEqual([
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

describe('the chat\'s English', () => {
  const joined = async () => {
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'alex', 'sam1234567'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.join(INVITE)
    const host = mount(withIntl(<PartyChat/>))
    hosts.push(host)
    let seq = 0
    const say = (from: string, message: PartyMessage) =>
      act(() => { seq++; fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })
    say('host', { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['play', 'seek', 'go', 'rate', 'subs', 'audio'], by: {} } })
    say('alex', { t: 'name', name: 'Alex' })
    return { host, say }
  }
  const at = (s: Partial<PlaybackState>): PlaybackState => ({ paused: false, time: 0, rate: 1, at: 1, ...s })

  test('each ask reads as its member doing it: a name, the host, the start of an id, or you', async () => {
    const { host, say } = await joined()
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: at({ paused: true }) })
    say('host', { t: 'ask', c: 'play', path: '/watch/a/b', s: at({}) })
    say('sam1234567', { t: 'ask', c: 'seek', path: '/watch/a/b', s: at({ time: 754.9 }) })
    say('me', { t: 'ask', c: 'seek', path: '/watch/a/b', s: at({ time: 3_725 }) })
    say('alex', { t: 'ask', c: 'rate', path: '/watch/a/b', s: at({ rate: 1.5 }) })
    say('host', { t: 'ask', c: 'rate', path: '/watch/a/b', s: at({ rate: 1.2999999 }) })
    say('sam1234567', { t: 'ask', c: 'go', path: '/watch/a/c' })
    say('me', { t: 'ask', c: 'subs', sub: 'English' })
    say('alex', { t: 'ask', c: 'subs', sub: null })
    say('host', { t: 'ask', c: 'audio', audio: 'Japanese' })
    say('sam1234567', { t: 'ask', c: 'audio', audio: null })
    say('me', { t: 'ask', c: 'rate', path: '/watch/a/b', s: at({ rate: 2 }) })
    say('alex', { t: 'ask', c: 'play', path: '/watch/a/b', s: at({}) })
    say('me', { t: 'ask', c: 'play', path: '/watch/a/b', s: at({ paused: true }) })
    say('sam1234567', { t: 'ask', c: 'seek', path: '/watch/a/b', s: at({ time: 9 }) })
    say('me', { t: 'ask', c: 'go', path: '/watch/a/c' })
    say('host', { t: 'ask', c: 'subs', sub: 'Spanish (Latin America)' })
    say('me', { t: 'ask', c: 'audio', audio: null })
    say('alex', { t: 'ask', c: 'seek', path: '/watch/a/b', s: at({ time: 0 }) })
    act(() => { host.querySelector<HTMLButtonElement>('button[aria-label="Show chat"]')!.click() })
    expect([...host.querySelectorAll('.line.action')].map(line => line.textContent)).toEqual([
      'Alex paused',
      'host resumed',
      'sam123 skipped to 12:34',
      'you skipped to 1:02:05',
      'Alex set speed to 1.5x',
      'host set speed to 1.3x',
      'sam123 changed the episode',
      'you set subtitles to English',
      'Alex turned subtitles off',
      'host set audio to Japanese',
      'sam123 turned audio off',
      'you set speed to 2x',
      'Alex resumed',
      'you paused',
      'sam123 skipped to 0:09',
      'you changed the episode',
      'host set subtitles to Spanish (Latin America)',
      'you turned audio off',
      'Alex skipped to 0:00',
    ])
  })

  test('the panel, its lines\' names and its form', async () => {
    const { host, say } = await joined()
    const toggle = () => host.querySelector<HTMLButtonElement>('button.toggle')!
    expect(toggle().getAttribute('aria-label')).toBe('Show chat')
    act(() => { toggle().click() })
    expect(toggle().getAttribute('aria-label')).toBe('Hide chat')
    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Party chat')
    expect(host.querySelector('.head')?.textContent).toBe('Party chat')
    expect(host.querySelector('.head button')?.getAttribute('aria-label')).toBe('Close chat')
    expect(host.querySelector('.empty')?.textContent).toBe('Nothing said yet.')
    const input = host.querySelector('form input')!
    expect([input.getAttribute('placeholder'), input.getAttribute('aria-label')]).toEqual(['Say something', 'Chat message'])
    expect(host.querySelector('form button')?.getAttribute('aria-label')).toBe('Send')
    say('host', { t: 'chat', text: 'hi' })
    say('alex', { t: 'chat', text: 'hello' })
    say('sam1234567', { t: 'chat', text: 'yo' })
    say('me', { t: 'chat', text: 'hey' })
    expect([...host.querySelectorAll('.line .who')].map(who => who.textContent)).toEqual(['host', 'Alex', 'sam123', 'you'])
    expect(host.querySelector('.empty')).toBeNull()
  })
})

// what crosses the room is the ask: each app writes its sentence in the language it shows
describe('in another language', () => {
  afterEach(() => startLanguage({ language: 'en', languages: ['en-US'] }))
  const at = (s: Partial<PlaybackState>): PlaybackState => ({ paused: false, time: 0, rate: 1, at: 1, ...s })
  const shown = async (language: string, languages = [language]) => {
    await startLanguage({ language, languages })
    const fake = fakeRoom({ self: 'me', owner: 'host', members: ['host', 'me', 'alex'] })
    current.store = createPartyStore(api(fake.room), memoryStorage())
    await current.store.join(INVITE)
    const host = mount(withIntl(<PartyChat/>))
    hosts.push(host)
    let seq = 0
    const say = (from: string, message: PartyMessage) =>
      act(() => { seq++; fake.emit({ type: 'message', message: { envelope: null, seq, from, at: seq, text: encodePartyMessage(message) }, replayed: false }) })
    say('host', { t: 'state', path: '/watch/a/b', y: 0, grants: { all: ['seek', 'rate', 'subs'], by: {} } })
    say('alex', { t: 'name', name: 'Alex' })
    say('alex', { t: 'ask', c: 'rate', path: '/watch/a/b', s: at({ rate: 1.5 }) })
    say('me', { t: 'ask', c: 'seek', path: '/watch/a/b', s: at({ time: 3_725 }) })
    say('host', { t: 'ask', c: 'subs', sub: 'English' })
    say('host', { t: 'chat', text: 'hi' })
    act(() => { host.querySelector<HTMLButtonElement>('button.toggle')!.click() })
    return [
      host.querySelector('.head')?.textContent,
      ...[...host.querySelectorAll('.line.action')].map(line => line.textContent),
      ...[...host.querySelectorAll('.line .who')].map(who => who.textContent),
    ]
  }

  test('German writes its own sentences, numbers and names, the track as the player names it', async () => {
    expect(await shown('de')).toEqual(['Party-Chat', 'Alex hat die Geschwindigkeit auf 1,5x gesetzt', 'du bist zu 1:02:05 gesprungen', 'der Host hat die Untertitel auf English gestellt', 'Host'])
  })

  test.each([
    ['fr', 'l’hôte a choisi les sous-titres English'],
    ['es-419', 'el anfitrión puso los subtítulos en English'],
    ['it', 'l’host ha impostato i sottotitoli su English'],
    ['pt-BR', 'o anfitrião mudou as legendas para English'],
  ])('a host with no name does something in %s with the article its sentence needs', async (language, line) => {
    expect((await shown(language)).at(-2)).toBe(line)
  })

  test('an English browser outside the US writes the clock as stub always has, and the speed in its own English', async () => {
    expect(await shown('en', ['en-DK'])).toEqual(['Party chat', 'Alex set speed to 1,5x', 'you skipped to 1:02:05', 'host set subtitles to English', 'host'])
  })

  test('Russian, with no past tense that would need the member\'s gender', async () => {
    expect(await shown('ru')).toEqual(['Чат комнаты', 'Alex: скорость 1,5x', 'вы перешли к 1:02:05', 'ведущий: субтитры English', 'ведущий'])
  })
})
