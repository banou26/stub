// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('lucide-react', () => ({ ChevronDown: () => null, Search: () => null, Settings: () => null, X: () => null }))
vi.mock('../../../src/components/account-widget', () => ({ default: () => null, menuStyle: [] }))
vi.mock('../../../src/components/party-widget', () => ({ default: () => null }))
vi.mock('../../../src/site', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/site')>()
  return { ...real, site: 'movie', siteLinks: real.siteLinksOf(new URL('https://movies.fkn.app/')) }
})

const { Header } = await import('../../../src/components/header')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
})

// fake timers, so the press's own timer runs only when a test lets it; linkedom stamps an event with
// Date.now(), so moving the system time alone is time passing on a page too busy to run that timer
const open = () => {
  vi.useFakeTimers()
  const location = memoryLocation({ path: '/settings', record: true })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><Header/></Router>))
  hosts.push(host)
  const logo = host.querySelector<HTMLElement>('.logo')!
  const fire = (type: string) => act(() => {
    logo.dispatchEvent(Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0 }))
  })
  const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
  return { history: location.history!, fire, wait }
}

const menu = () => document.querySelector('[role="menu"]')

test('a long press opens the site menu from its timer while held, and the release does not go home', () => {
  const { history, fire, wait } = open()
  fire('pointerdown')
  wait(500)
  expect(menu()).not.toBeNull()
  fire('pointerup')
  fire('click')
  expect(history).toEqual(['/settings'])
})

test('a long press whose timer has not run by the release, as on a busy page, opens the menu then and does not go home', () => {
  const { history, fire } = open()
  fire('pointerdown')
  vi.setSystemTime(Date.now() + 600)
  fire('pointerup')
  fire('click')
  expect(menu()).not.toBeNull()
  expect(history).toEqual(['/settings'])
})

test('a short tap whose timer ran before its release, as on a busy touch screen, closes the menu it opened and goes home', () => {
  const { history, fire, wait } = open()
  const pressed = Date.now()
  fire('pointerdown')
  wait(500)
  expect(menu()).not.toBeNull()
  vi.setSystemTime(pressed + 50)
  fire('pointerup')
  fire('click')
  expect(menu()).toBeNull()
  expect(history).toEqual(['/settings', '/'])
})

test('a short tap on the wordmark leaves a menu the arrow opened alone', () => {
  const { history, fire } = open()
  act(() => { document.querySelector<HTMLElement>('.sites-toggle')!.click() })
  expect(menu()).not.toBeNull()
  fire('pointerdown')
  fire('pointerup')
  fire('click')
  expect(menu()).not.toBeNull()
  expect(history).toEqual(['/settings'])
})

test('a second press before the first is released ends it, so its timer opens nothing', () => {
  const { history, fire, wait } = open()
  fire('pointerdown')
  fire('pointerdown')
  fire('pointercancel')
  wait(600)
  expect(menu()).toBeNull()
  expect(history).toEqual(['/settings'])
})

test('a menu closed while the long press that opened it is still held stays closed on its release', () => {
  const { fire, wait } = open()
  fire('pointerdown')
  wait(500)
  expect(menu()).not.toBeNull()
  act(() => { document.dispatchEvent(Object.assign(new Event('keydown', { bubbles: true }), { key: 'Escape' })) })
  expect(menu()).toBeNull()
  wait(300)
  fire('pointerup')
  expect(menu()).toBeNull()
})

test('a short tap goes home, and its timer opens nothing later', () => {
  const { history, fire, wait } = open()
  fire('pointerdown')
  wait(100)
  fire('pointerup')
  fire('click')
  wait(1000)
  expect(menu()).toBeNull()
  expect(history).toEqual(['/settings', '/'])
})

test('a press that leaves the wordmark opens nothing, even released back on it after the hold', () => {
  const { history, fire, wait } = open()
  fire('pointerdown')
  fire('pointerleave')
  wait(600)
  fire('pointerup')
  fire('click')
  expect(menu()).toBeNull()
  expect(history).toEqual(['/settings', '/'])
})

// HOR-1026 (stub in the viewer's language): the four sites' English on movies.fkn.app, pinned before it moves into messages
test('its English: the field, the arrow and the four sites in the bar and the menu', () => {
  open()
  const host = hosts.at(-1)!
  expect(host.querySelector('form input')?.getAttribute('placeholder')).toBe('Search movies…')
  expect(host.querySelector('.sites-toggle')?.getAttribute('aria-label')).toBe('Sites')
  expect([...host.querySelectorAll('nav.sites a')].map(link => link.textContent)).toEqual(['Movies', 'Series', 'Anime', 'All'])
  act(() => { host.querySelector<HTMLElement>('.sites-toggle')!.click() })
  expect([...menu()!.querySelectorAll('a')].map(link => link.textContent)).toEqual(['Movies', 'Series', 'Anime', 'All'])
})
