// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

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
vi.mock('lucide-react', () => ({ ChevronDown: () => null, ChevronUp: () => null, GripVertical: () => null }))

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
  const host = mount(withIntl(<Settings/>))
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
  expect([...host.querySelectorAll('nav a')].map(link => [link.textContent, link.getAttribute('href')])).toEqual([['Sources', '#sources'], ['Playback', '#playback']])
})

test('names the page and its list of categories', async () => {
  const host = await open()
  expect(host.querySelector('h1')!.textContent).toBe('Settings')
  expect(host.querySelector('nav')!.getAttribute('aria-label')).toBe('Settings categories')
})

test('with no fragment, shows Sources and only Sources, its cards holding the sign-ins', async () => {
  expect(shown(await open())).toEqual({ panels: ['sources'], heading: 'Sources', current: ['Sources'], accountRows: 5 })
})

test('#sources shows Sources and only Sources', async () => {
  expect(shown(await open('#sources'))).toEqual({ panels: ['sources'], heading: 'Sources', current: ['Sources'], accountRows: 5 })
})

test('#playback shows Playback and its one switch, autoplay, on until turned off', async () => {
  const host = await open('#playback')
  expect(shown(host)).toEqual({ panels: ['playback'], heading: 'Playback', current: ['Playback'], accountRows: 0 })
  const autoplay = () => host.querySelector<HTMLInputElement>('input[role="switch"]')!
  expect([...host.querySelectorAll('input[role="switch"]')].map(input => input.closest('label')?.textContent)).toEqual(['Autoplay next episode'])
  expect(host.querySelector('[data-section] p'), 'labels only').toBeNull()
  expect(host.querySelector('ol'), 'the play order is on the source cards').toBeNull()
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
const playOrder = (host: HTMLElement) => [...host.querySelectorAll('ol.play-order > li')].map(card => card.querySelector('h4')?.textContent)
const move = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`ol.play-order .order button[aria-label="${label}"]`)!

// the owner, 2026-10-25 (HOR-1019): "we should be able to order the cards [...] and also probably have a ranking
// for preferred playback (for sources that don't offer playback the element would be hidden of course)"
test('Sources ranks the cards of stub\'s three players and every added source first, in the play order, numbered, the end buttons disabled', async () => {
  plugins.statuses = [
    { uri: 'https:stub.plugins.banou.dev', state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }] },
    { uri: 'npm:@spec/slow-source', state: 'connecting' },
  ]
  const host = await open('#sources')
  expect([...host.querySelectorAll('h3.part')].map(heading => heading.textContent)).toEqual(['Play order', 'Merge order', 'Other sources', 'Added'])
  const cardHeadings = [...host.querySelectorAll('[data-source] h2, [data-source] h3, [data-source] h4')]
  expect(new Set(cardHeadings.map(heading => heading.tagName)), 'a card\'s name is a level under its group\'s').toEqual(new Set(['H4']))
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Netflix', 'Nyaa'])
  expect([...host.querySelectorAll('ol.play-order > li .place')].map(place => place.textContent)).toEqual(['1', '2', '3', '4'])
  expect(host.querySelectorAll('ul.cards [aria-label^="Move "], ul.cards .place'), 'a source Play never tries has no place').toHaveLength(0)
  expect([...host.querySelectorAll('ol.play-order .order button')].map(button => [button.getAttribute('aria-label'), button.getAttribute('aria-disabled')])).toEqual([
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
  const host = await open('#sources')
  await act(() => { move(host, 'Move Nyaa up').click() })
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Nyaa', 'Netflix'])
  await act(() => { move(host, 'Move Crunchyroll down').click() })
  expect(playOrder(host)).toEqual(['Prime Video', 'Crunchyroll', 'Nyaa', 'Netflix'])
  expect(JSON.parse(stored.get(PLAY_ORDER_KEY)!)).toEqual(['amazon', 'cr', 'nyaa', 'nf'])
  expect(move(host, 'Move Prime Video up').getAttribute('aria-disabled')).toBe('true')
  expect(move(host, 'Move Crunchyroll up').getAttribute('aria-disabled')).toBeNull()
  unmount(hosts.pop()!)
  expect(playOrder(await open('#sources')), 'kept').toEqual(['Prime Video', 'Crunchyroll', 'Nyaa', 'Netflix'])
})

test('a source turned off keeps its card and its place, and another tab\'s order is followed', async () => {
  stored.set('stub.sources.disabled', JSON.stringify(['amazon']))
  const host = await open('#sources')
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Netflix'])
  expect(host.querySelector('[data-source="amazon"]')!.classList.contains('off')).toBe(true)
  await act(() => { move(host, 'Move Netflix up').click() })
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Netflix', 'Prime Video'])
  expect(JSON.parse(stored.get(PLAY_ORDER_KEY)!)).toEqual(['cr', 'nf', 'amazon'])

  await act(() => {
    stored.set(PLAY_ORDER_KEY, JSON.stringify(['amazon']))
    for (const listener of listeners.get('storage') ?? []) listener({ key: PLAY_ORDER_KEY })
  })
  expect(playOrder(host)).toEqual(['Prime Video', 'Crunchyroll', 'Netflix'])
})

test('with the FKN account\'s settings in use, a move changes the account\'s order, and an open list follows the account', async () => {
  const account = (order: string[]) => stored.set('stub.settings.account', JSON.stringify({ [PLAY_ORDER_KEY]: JSON.stringify(order) }))
  account(['nf', 'cr', 'amazon'])
  const host = await open('#sources')
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

const MERGE_ORDER_KEY = 'stub.sources.merge-order'
const mergeOrder = (host: HTMLElement) => [...host.querySelectorAll('ol.merge-order > li')].map(card => card.querySelector('h4')?.textContent)
const mergeMove = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`ol.merge-order .order button[aria-label="${label}"]`)!
const MERGED = ['MyAnimeList', 'AniZip', 'AniList', 'LiveChart', 'Crunchyroll', 'Kitsu', 'IMDb', 'Simkl', 'TMDB', 'Trakt', 'TheTVDB', 'TVmaze', 'Watchmode', 'Anime News Network', 'Apple TV+', 'JustWatch', 'Netflix', 'Offline database', 'Paramount+']

// the owner, 2026-10-26 (HOR-1030): "I feel like the card order should decide merge priority, yes, but by default,
// their card order is the order we defined, and most people aren't going to change the order, so our tuning will still
// be useful."
test('Merge order ranks every built-in source the merge weighs in today\'s order, numbered, a player there again with no switches or sign-in', async () => {
  const host = await open('#sources')
  expect(mergeOrder(host)).toEqual(MERGED)
  expect([...host.querySelectorAll('ol.merge-order > li .place')].map(place => place.textContent)).toEqual(MERGED.map((_, at) => String(at + 1)))
  const brief = [...host.querySelectorAll('ol.merge-order > li.brief')]
  expect(brief.map(card => card.getAttribute('data-source'))).toEqual(['cr', 'nf'])
  expect(brief.flatMap(card => [...card.querySelectorAll('input, [data-account]')]), 'its switches and sign-in are on its Play order card').toEqual([])
  expect([mergeMove(host, 'Move MyAnimeList up in the merge order'), mergeMove(host, 'Move Paramount+ down in the merge order')].map(button => button.getAttribute('aria-disabled'))).toEqual(['true', 'true'])
  expect(mergeMove(host, 'Move AniList up in the merge order').getAttribute('aria-disabled')).toBeNull()
  expect(stored.has(MERGE_ORDER_KEY)).toBe(false)
})

test('a merge move is kept as the whole order, leaves the play order, and another tab\'s order is followed', async () => {
  const host = await open('#sources')
  await act(() => { mergeMove(host, 'Move AniList up in the merge order').click() })
  await act(() => { mergeMove(host, 'Move AniList up in the merge order').click() })
  expect(mergeOrder(host).slice(0, 3)).toEqual(['AniList', 'MyAnimeList', 'AniZip'])
  expect(JSON.parse(stored.get(MERGE_ORDER_KEY)!)).toEqual(['anilist', 'mal', 'anizip', 'livechart', 'cr', 'kitsu', 'omdb', 'simkl', 'tmdb', 'trakt', 'tvdb', 'tvmaze', 'watchmode', 'ann', 'appletv', 'jw', 'nf', 'offline', 'paramount'])
  expect(playOrder(host)).toEqual(['Crunchyroll', 'Prime Video', 'Netflix'])
  expect(stored.has(PLAY_ORDER_KEY)).toBe(false)
  unmount(hosts.pop()!)
  expect(mergeOrder(await open('#sources')).slice(0, 3), 'kept').toEqual(['AniList', 'MyAnimeList', 'AniZip'])

  const followed = hosts.at(-1)!
  await act(() => {
    stored.set(MERGE_ORDER_KEY, JSON.stringify(['kitsu']))
    for (const listener of listeners.get('storage') ?? []) listener({ key: MERGE_ORDER_KEY })
  })
  expect(mergeOrder(followed).slice(0, 2)).toEqual(['Kitsu', 'MyAnimeList'])
})

for (const removed of ['#accounts', '#data', '#tracking']) {
  test(`${removed}, a category that is gone, shows Sources`, async () => {
    expect(shown(await open(removed))).toEqual({ panels: ['sources'], heading: 'Sources', current: ['Sources'], accountRows: 5 })
  })
}

test('a change of fragment switches the panel, and back', async () => {
  const host = await open()
  await go('#playback')
  expect(shown(host).panels).toEqual(['playback'])
  await go('#data')
  expect(shown(host).panels).toEqual(['sources'])
})

test('a pushState that drops the fragment, as the header\'s Settings link sends, shows Sources', async () => {
  const host = await open('#playback')
  await go('', 'pushState')
  expect(shown(host)).toEqual({ panels: ['sources'], heading: 'Sources', current: ['Sources'], accountRows: 5 })
})

// a panel with that id would be a fragment target, which the browser scrolls to on a reload
test('no element carries an id a category link names, so following one scrolls nothing', async () => {
  for (const hash of ['', '#sources', '#playback']) {
    const host = await open(hash)
    expect(host.querySelector('#accounts, #sources, #playback'), hash || 'no fragment').toBeNull()
  }
})
