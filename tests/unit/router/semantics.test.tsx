// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/router/page-under', () => ({
  useAppLocation: () => ['/', () => {}],
  usePageLocation: () => ['/', () => {}],
  usePageSearch: () => '',
  usePageUnder: () => undefined,
}))
vi.mock('../../../src/plugin-url', () => ({ pluginHref: (href: string) => href }))
vi.mock('../../../src/components/header', () => ({ default: () => <header/> }))
vi.mock('../../../src/components/footer', () => ({ default: () => <footer/> }))
vi.mock('../../../src/components/plugin-notice', () => ({ default: () => null }))
vi.mock('../../../src/router/home', () => ({ default: () => <div>Home page</div> }))
vi.mock('../../../src/router/home/media-modal', () => ({ default: () => null }))
vi.mock('../../../src/router/title', () => ({ default: () => null }))
vi.mock('../../../src/router/search', () => ({ default: () => null }))
vi.mock('../../../src/router/legal', () => ({ default: () => null }))
vi.mock('../../../src/router/privacy', () => ({ default: () => null }))
vi.mock('../../../src/router/settings', () => ({ default: () => null }))
vi.mock('../../../src/router/list', () => ({ default: () => null }))
vi.mock('../../../src/router/continue', () => ({ default: () => null }))
vi.mock('../../../src/router/watch', () => ({ default: () => null }))
vi.mock('../../../src/router/party', () => ({ default: () => null }))
vi.mock('../../../src/router/debug', () => ({ default: () => null }))
vi.mock('../../../src/router/not-found', () => ({ default: () => null }))
vi.mock('../../../src/components/party-sync', () => ({ default: () => null }))
vi.mock('../../../src/components/party-cursor', () => ({ default: () => null }))
vi.mock('../../../src/components/party-chat', () => ({ default: () => null }))
vi.mock('../../../src/components/scroll-reset', () => ({ default: () => null }))

const { default: RowTitle } = await import('../../../src/router/home/row-title')
const { default: RouterRoot } = await import('../../../src/router')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('RowTitle renders an h2 heading whether linked or plain', () => {
  const { hook } = memoryLocation({ path: '/' })
  const linked = mount(withIntl(<Router hook={hook}><RowTitle title="Current season" to="/search?season=FALL"/></Router>))
  hosts.push(linked)
  const h2Linked = linked.querySelector('h2.title')!
  expect(h2Linked).not.toBeNull()
  expect(h2Linked.querySelector('a')?.getAttribute('href')).toBe('/search?season=FALL')
  expect(h2Linked.textContent).toBe('Current season')

  const plain = mount(withIntl(<Router hook={hook}><RowTitle title="Popular"/></Router>))
  hosts.push(plain)
  const h2Plain = plain.querySelector('h2.title')!
  expect(h2Plain).not.toBeNull()
  expect(h2Plain.querySelector('a')).toBeNull()
  expect(h2Plain.textContent).toBe('Popular')
})

test('RouterRoot wraps page content in a main landmark', () => {
  const host = mount(withIntl(<RouterRoot/>))
  hosts.push(host)

  const main = host.querySelector('main.content')!
  expect(main).not.toBeNull()
  expect(main.textContent).toBe('Home page')
})
