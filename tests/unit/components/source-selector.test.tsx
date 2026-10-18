// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))

const { default: SourceSelector } = await import('../../../src/components/source-selector')
const { HIDDEN_ICONS_KEY, setIconShown } = await import('../../../src/sources/hidden-icons')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const release = (uri: string) => ({ uri, label: uri, href: `/watch/m/e/${uri}`, external: false, active: false })
const sources = [
  { id: 'nf', name: 'Netflix', href: '/watch/m/e/nf:81', external: false, active: false },
  { id: 'hulu', name: 'Hulu', href: 'https://www.hulu.com/watch/1', external: true, active: false },
  { id: 'nyaa', name: 'Nyaa', href: '/watch/m/e/nyaa:a', external: false, active: false, releases: [release('nyaa:a'), release('nyaa:b')] },
]

const selector = (props: Partial<Parameters<typeof SourceSelector>[0]> = {}) => {
  const location = memoryLocation({ path: '/watch/m/e/cr:1', record: true })
  const host = mount(<Router hook={location.hook}><SourceSelector sources={sources} {...props}/></Router>)
  hosts.push(host)
  const click = (selector: string) => {
    const event = Object.assign(new Event('click', { bubbles: true, cancelable: true }), { button: 0 })
    act(() => { host.querySelector(selector)!.dispatchEvent(event) })
    return event.defaultPrevented
  }
  return { host, location, click }
}

// a full load restarts the worker, and with it the Netflix match the click came from (Frieren, 2026-10-12)
test('picking a source in stub is a client side navigation', () => {
  const { host, location, click } = selector()
  expect(click('a[title="Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
  expect(host.querySelector('a[title="Hulu"]')?.getAttribute('target')).toBe('_blank')
})

test('picking one of a source\'s releases is a client side navigation', () => {
  const { location, click } = selector()
  click('button[title="2 releases on Nyaa"]')
  expect(click('a[title="nyaa:b"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nyaa:b')
})

test('picking a compact source icon is a client side navigation', () => {
  const { location, click } = selector({ compact: true })
  expect(click('a[title="Watch on Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
})

const chipNames = (host: HTMLElement) => [...host.querySelectorAll('a.chip')].map(chip => chip.querySelector('.name')?.textContent)

test('the chips name every source, where the compact row stops at five', () => {
  const six = ['Netflix', 'Hulu', 'Tubi', 'Plex', 'Hoopla', 'HIDIVE'].map((name, index) =>
    ({ id: name.toLowerCase(), name, href: `https://${name.toLowerCase()}.example/${index}`, external: true, active: false }))
  expect(selector({ sources: six, compact: true }).host.querySelectorAll('a.src'), 'the control: compact draws five').toHaveLength(5)
  expect(chipNames(selector({ sources: six, chips: true }).host)).toEqual(six.map(source => source.name))
})

test('a chip for a source in stub is a client side navigation, and one for a site opens it in a new tab', () => {
  const { host, location, click } = selector({ chips: true })
  expect(click('a.chip[href="/watch/m/e/nf:81"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
  expect(host.querySelector('a.chip[href="https://www.hulu.com/watch/1"]')?.getAttribute('target')).toBe('_blank')
  expect(host.querySelector('a.chip[href="/watch/m/e/nyaa:a"]')?.getAttribute('target'), 'several releases open the watch page').toBeNull()
})

test('the chips hold one placeholder while sources may still land, and draw nothing once none came', () => {
  const held = selector({ sources: [], chips: true, pending: true }).host
  expect(held.querySelectorAll('.pending')).toHaveLength(1)
  expect(selector({ sources: [], chips: true }).host.innerHTML).toBe('')
  expect(selector({ chips: true, pending: true }).host.querySelector('.pending'), 'sources replace it').toBeNull()
})

describe('a hidden source icon', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
    // another tab's change arrives as a storage event on this page's window, and node's globalThis has no listeners
    vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
    vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('leaves the compact row on screen, from this tab or another, and stays in the full list', () => {
    const compact = selector({ compact: true }).host
    const full = selector().host
    const netflix = () => compact.querySelector('a[title="Watch on Netflix"]')
    expect(netflix(), 'the control: shown before it is hidden').not.toBeNull()
    act(() => setIconShown('nf', false))
    expect(netflix()).toBeNull()
    expect(compact.querySelector('a[title="Watch on Hulu"]')).not.toBeNull()
    expect(full.querySelector('a[title="Netflix"]'), 'still offered where a source is picked').not.toBeNull()
    stored.delete(HIDDEN_ICONS_KEY)
    act(() => { window.dispatchEvent(Object.assign(new Event('storage'), { key: HIDDEN_ICONS_KEY })) })
    expect(netflix(), 'shown again by another tab').not.toBeNull()
  })

  test('draws no chip', () => {
    const { host } = selector({ chips: true })
    expect(chipNames(host), 'the control: drawn while shown').toEqual(['Netflix', 'Hulu', 'Nyaa'])
    act(() => setIconShown('nf', false))
    expect(chipNames(host)).toEqual(['Hulu', 'Nyaa'])
  })
})
