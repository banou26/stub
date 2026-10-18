// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

// The settings page: a list of categories, and only the selected one's panel below it. FKN, the sites
// and the plugin runtime are faked; the URL's fragment is a stub `location`, and the events a
// navigation sends (`hashchange`, wouter's `pushState`) are sent by hand, as linkedom has neither.

vi.mock('../../../src/utils/fkn-backend', () => ({ detectBackend: async () => 'cloud' }))
vi.mock('../../../src/router/settings/wiring', () => ({
  crunchyroll: { signIn: async () => 'authed', signOut: async () => {} },
  prime: { signIn: async () => 'authed', signOut: async () => {} },
  sites: { isConnected: () => false, watch: () => () => {}, signIn: async () => 'authed', signOut: async () => {} },
  status: { read: () => undefined, watch: () => () => {}, check: async () => 'signed-in' },
}))
const plugins = vi.hoisted(() => ({ statuses: [] as object[] }))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => plugins.statuses,
  onPluginsChange: () => () => {},
  addPlugins: async () => {},
  installPlugin: async () => null,
  disablePlugin: async () => {},
}))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ ChevronDown: () => null, ChevronUp: () => null }))

const { default: Settings } = await import('../../../src/router/settings')

const at = { hash: '' }
const listeners = new Map<string, Set<(event?: object) => void>>()
const stored = new Map<string, string>()
beforeEach(() => {
  at.hash = ''
  listeners.clear()
  stored.clear()
  vi.stubGlobal('location', at)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  plugins.statuses = []
  vi.stubGlobal('addEventListener', (type: string, listener: () => void) => {
    listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
  })
  vi.stubGlobal('removeEventListener', (type: string, listener: () => void) => { listeners.get(type)?.delete(listener) })
})

/** Moves to `hash` and sends the one event that navigation sends. */
const go = (hash: string, event = 'hashchange') => act(async () => {
  at.hash = hash
  for (const listener of listeners.get(event) ?? []) listener()
})

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

const open = async (hash = '') => {
  at.hash = hash
  const host = mount(<Settings/>)
  hosts.push(host)
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
  return host
}

// linkedom implements no `checked` property, so Preact renders the attribute until a flip sets one
const isOn = (input: HTMLInputElement) => (input.checked as boolean | undefined) ?? input.hasAttribute('checked')

const shown = (host: HTMLElement) => ({
  panels: [...host.querySelectorAll('[data-section]')].map(panel => panel.getAttribute('data-section')),
  heading: host.querySelector('h2')?.textContent,
  current: [...host.querySelectorAll('nav a[aria-current="true"]')].map(link => link.textContent),
  accountRows: host.querySelectorAll('[data-account]').length,
})

test('lists every category as a link whose fragment picks it', async () => {
  const host = await open()
  expect([...host.querySelectorAll('nav a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([['Accounts', '#accounts'], ['Sources', '#sources'], ['Playback', '#playback']])
})

test('with no fragment, shows Accounts and only Accounts', async () => {
  expect(shown(await open())).toEqual({ panels: ['accounts'], heading: 'Accounts', current: ['Accounts'], accountRows: 5 })
})

test('#sources shows Sources and only Sources', async () => {
  expect(shown(await open('#sources'))).toEqual({ panels: ['sources'], heading: 'Sources', current: ['Sources'], accountRows: 0 })
})

test('#playback shows Playback and its one switch, autoplay, on until turned off', async () => {
  const host = await open('#playback')
  expect(shown(host)).toEqual({ panels: ['playback'], heading: 'Playback', current: ['Playback'], accountRows: 0 })
  const autoplay = () => host.querySelector<HTMLInputElement>('input[role="switch"]')!
  expect([...host.querySelectorAll('input[role="switch"]')].map(input => input.closest('label')?.textContent)).toEqual(['Autoplay next episode'])
  expect(host.querySelector('[data-section] p'), 'labels only').toBeNull()
  expect(isOn(autoplay())).toBe(true)
  await act(() => {
    Object.assign(autoplay(), { checked: false })
    autoplay().dispatchEvent(new Event('change', { bubbles: true }))
  })
  expect(isOn(autoplay())).toBe(false)
  expect(stored.get('stub.player.autoplay')).toBe('off')
  unmount(hosts.pop()!)
  expect(isOn((await open('#playback')).querySelector<HTMLInputElement>('input[role="switch"]')!), 'kept').toBe(false)
})

test('an open Playback follows autoplay turned off in another tab or on the FKN account', async () => {
  const host = await open('#playback')
  const autoplay = () => host.querySelector<HTMLInputElement>('input[role="switch"]')!
  expect(isOn(autoplay())).toBe(true)
  stored.set('stub.settings.account', JSON.stringify({ 'stub.player.autoplay': 'off' }))
  await act(async () => {
    for (const listener of listeners.get('storage') ?? []) (listener as (event: { key: string }) => void)({ key: 'stub.settings.account' })
  })
  expect(isOn(autoplay())).toBe(false)
})

const PLAY_ORDER_KEY = 'stub.sources.play-order'
const playOrder = (host: HTMLElement) => [...host.querySelectorAll('ol.play-order li')].map(row => row.querySelector('.name')?.textContent)
const move = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`ol.play-order button[aria-label="${label}"]`)!

test('#playback lists stub\'s three players and every added source, in the play order, the end buttons disabled', async () => {
  plugins.statuses = [
    { uri: 'https:stub.plugins.banou.dev', state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }] },
    { uri: 'npm:@spec/slow-source', state: 'connecting' },
  ]
  const host = await open('#playback')
  expect(host.querySelector('h3')?.textContent).toBe('Play order')
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Netflix', 'Nyaa'])
  expect([...host.querySelectorAll('ol.play-order button')].map(button => [button.getAttribute('aria-label'), button.getAttribute('aria-disabled')])).toEqual([
    ['Move Crunchyroll up', 'true'], ['Move Crunchyroll down', null],
    ['Move Prime Video up', null], ['Move Prime Video down', null],
    ['Move Netflix up', null], ['Move Netflix down', null],
    ['Move Nyaa up', null], ['Move Nyaa down', 'true'],
  ])
  await act(() => { move(host, 'Move Crunchyroll up').click() })
  await act(() => { move(host, 'Move Nyaa down').click() })
  expect(stored.has(PLAY_ORDER_KEY), 'an end button moves nothing').toBe(false)
})

test('a move swaps the row with the one beside it and is kept, and a reopened page reads it', async () => {
  plugins.statuses = [{ uri: 'https:stub.plugins.banou.dev', state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }] }]
  const host = await open('#playback')
  await act(() => { move(host, 'Move Nyaa up').click() })
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Nyaa', 'Netflix'])
  await act(() => { move(host, 'Move Crunchyroll down').click() })
  expect(playOrder(host)).toEqual(['Prime Video', 'Crunchyroll', 'Nyaa', 'Netflix'])
  expect(JSON.parse(stored.get(PLAY_ORDER_KEY)!)).toEqual(['amazon', 'cr', 'nyaa', 'nf'])
  expect(move(host, 'Move Prime Video up').getAttribute('aria-disabled')).toBe('true')
  expect(move(host, 'Move Crunchyroll up').getAttribute('aria-disabled')).toBeNull()
  unmount(hosts.pop()!)
  expect(playOrder(await open('#playback')), 'kept').toEqual(['Prime Video', 'Crunchyroll', 'Nyaa', 'Netflix'])
})

test('a source turned off is left out of the play order and keeps its rank against the others, and another tab\'s order is followed', async () => {
  stored.set('stub.sources.disabled', JSON.stringify(['amazon']))
  const host = await open('#playback')
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Netflix'])
  await act(() => { move(host, 'Move Netflix up').click() })
  expect(playOrder(host)).toEqual(['Netflix', 'Crunchyroll'])
  expect(JSON.parse(stored.get(PLAY_ORDER_KEY)!), 'Prime Video still below Crunchyroll').toEqual(['nf', 'cr', 'amazon'])

  await act(() => {
    stored.set(PLAY_ORDER_KEY, JSON.stringify(['cr']))
    for (const listener of listeners.get('storage') ?? []) listener({ key: PLAY_ORDER_KEY })
  })
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Netflix'])
})

test('with the FKN account\'s settings in use, a move changes the account\'s order, and an open list follows the account', async () => {
  const account = (order: string[]) => stored.set('stub.settings.account', JSON.stringify({ [PLAY_ORDER_KEY]: JSON.stringify(order) }))
  account(['nf', 'cr', 'amazon'])
  const host = await open('#playback')
  expect(playOrder(host)).toEqual(['Netflix', 'Crunchyroll', 'Prime Video'])
  await act(() => { move(host, 'Move Prime Video up').click() })
  expect(JSON.parse(JSON.parse(stored.get('stub.settings.account')!)[PLAY_ORDER_KEY])).toEqual(['nf', 'amazon', 'cr'])
  expect(stored.has(PLAY_ORDER_KEY), 'not this browser\'s own').toBe(false)

  await act(() => {
    account(['amazon'])
    for (const listener of listeners.get('storage') ?? []) listener({ key: 'stub.settings.account' })
  })
  expect(playOrder(host)).toEqual(['Prime Video', 'Crunchyroll', 'Netflix'])
})

for (const removed of ['#data', '#tracking']) {
  test(`${removed}, a category that is gone, shows Accounts`, async () => {
    expect(shown(await open(removed))).toEqual({ panels: ['accounts'], heading: 'Accounts', current: ['Accounts'], accountRows: 5 })
  })
}

test('a change of fragment switches the panel, and back', async () => {
  const host = await open()
  await go('#sources')
  expect(shown(host).panels).toEqual(['sources'])
  await go('#data')
  expect(shown(host).panels).toEqual(['accounts'])
})

test('a pushState that drops the fragment, as the header\'s Settings link sends, shows Accounts', async () => {
  const host = await open('#sources')
  await go('', 'pushState')
  expect(shown(host)).toEqual({ panels: ['accounts'], heading: 'Accounts', current: ['Accounts'], accountRows: 5 })
})

// a panel with that id would be a fragment target, which the browser scrolls to on a reload
test('no element carries an id a category link names, so following one scrolls nothing', async () => {
  for (const hash of ['', '#sources', '#playback']) {
    const host = await open(hash)
    expect(host.querySelector('#accounts, #sources, #playback'), hash || 'no fragment').toBeNull()
  }
})
