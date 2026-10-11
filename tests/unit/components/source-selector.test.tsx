// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))

const { default: SourceSelector } = await import('../../../src/components/source-selector')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const release = (uri: string) => ({ uri, label: uri, href: `/watch/m/e/${uri}`, external: false, active: false })
const sources = [
  { id: 'nf', name: 'Netflix', href: '/watch/m/e/nf:81', external: false, active: false },
  { id: 'hulu', name: 'Hulu', href: 'https://www.hulu.com/watch/1', external: true, active: false },
  { id: 'nyaa', name: 'Nyaa', href: '/watch/m/e/nyaa:a', external: false, active: false, releases: [release('nyaa:a'), release('nyaa:b')] },
]

const selector = (compact = false) => {
  const location = memoryLocation({ path: '/watch/m/e/cr:1', record: true })
  const host = mount(<Router hook={location.hook}><SourceSelector sources={sources} compact={compact}/></Router>)
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
  const { location, click } = selector(true)
  expect(click('a[title="Watch on Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
})
