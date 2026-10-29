// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// HOR-1064 (a My list page): its link sits beside Settings on the sites that keep anime, the only thing the trackers list

vi.mock('lucide-react', () => ({ ChevronDown: () => null, ListVideo: () => null, Search: () => null, Settings: () => null, X: () => null }))
vi.mock('../../../src/components/account-widget', () => ({ default: () => null, menuStyle: [] }))
vi.mock('../../../src/components/party-widget', () => ({ default: () => null }))
vi.mock('@fkn/lib/react', () => ({ PoweredByFkn: () => null }))
const where = vi.hoisted(() => ({ site: 'anime' }))
vi.mock('../../../src/site', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/site')>()
  return { ...real, get site () { return where.site }, siteLinks: [] }
})

const { Header } = await import('../../../src/components/header')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const links = (site: string) => {
  where.site = site
  const location = memoryLocation({ path: '/' })
  const host = mount(withIntl(<Router hook={location.hook} searchHook={location.searchHook}><Header/></Router>))
  hosts.push(host)
  return [...host.querySelectorAll('.actions a')].map(link => link.getAttribute('href'))
}

test('the anime site and the all-in-one site link to My list beside Settings, and the film and series sites do not', () => {
  expect(links('anime')).toEqual(['/list', '/settings'])
  expect(links('stub')).toEqual(['/list', '/settings'])
  expect(links('movie')).toEqual(['/settings'])
  expect(links('series')).toEqual(['/settings'])
})
