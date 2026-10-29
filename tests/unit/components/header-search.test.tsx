// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('lucide-react', () => ({ ChevronDown: () => null, ListVideo: () => null, Search: () => null, Settings: () => null, X: () => null }))
vi.mock('../../../src/components/account-widget', () => ({ default: () => null }))
vi.mock('../../../src/components/party-widget', () => ({ default: () => null }))

const { Header } = await import('../../../src/components/header')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
})

// fake timers, so a navigation that waited on any timer would not happen at all
const open = (path: string) => {
  vi.useFakeTimers()
  const location = memoryLocation({ path, record: true })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><Header/></Router>))
  hosts.push(host)
  const box = host.querySelector<HTMLInputElement>('input[aria-label="Search"]')!
  const type = (value: string) => act(() => {
    box.value = value
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
  return { history: location.history!, type }
}

describe('the header search box', () => {
  test('the first keystroke opens the search page at once, as a new history entry', () => {
    const { history, type } = open('/')
    type('m')
    expect(history).toEqual(['/', '/search?q=m'])
  })

  test('every later keystroke replaces, so Back still returns to where the search started', () => {
    const { history, type } = open('/')
    type('m')
    type('mu')
    type('mushoku')
    expect(history).toEqual(['/', '/search?q=mushoku'])
  })

  test('carries the other filters forward', () => {
    const { history, type } = open('/search?season=WINTER&year=2020')
    type('x')
    expect(history).toEqual(['/search?q=x&season=WINTER&year=2020'])
  })

  test('clearing the box on the search page clears the query, and keeps the filters', () => {
    const { history, type } = open('/search?q=x&year=2020')
    type('')
    expect(history).toEqual(['/search?year=2020'])
  })

  test('clearing it anywhere else goes nowhere', () => {
    const { history, type } = open('/')
    type('  ')
    type('')
    expect(history).toEqual(['/'])
  })
})

// HOR-1026 (stub in the viewer's language): the bar's English on stub.fkn.app, pinned before it moves into messages
test('its English: the wordmark, the field and the buttons', () => {
  open('/')
  const host = hosts.at(-1)!
  const box = host.querySelector('form input')!
  expect([box.getAttribute('placeholder'), box.getAttribute('aria-label')]).toEqual(['Search anime, shows, movies…', 'Search'])
  expect(host.querySelector('.logo')?.textContent).toBe('stub')
  expect(host.querySelector('.search-close')?.getAttribute('aria-label')).toBe('Close search')
  expect(host.querySelector('.search-toggle')?.getAttribute('aria-label')).toBe('Search')
  const settings = host.querySelector('.actions a[href="/settings"]')!
  expect([settings.getAttribute('aria-label'), settings.getAttribute('title')]).toEqual(['Settings', 'Settings'])
  const list = host.querySelector('.actions a[href="/list"]')!
  expect([list.getAttribute('aria-label'), list.getAttribute('title')]).toEqual(['My list', 'My list'])
})
