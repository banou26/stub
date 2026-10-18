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
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => [],
  onPluginsChange: () => () => {},
  addPlugins: async () => {},
  installPlugin: async () => null,
  disablePlugin: async () => {},
}))

const { default: Settings } = await import('../../../src/router/settings')

const at = { hash: '' }
const listeners = new Map<string, Set<() => void>>()
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
