// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import type { AccountsProps } from '../../../src/router/settings/accounts'

vi.mock('../../../src/plugins', () => ({ pluginStatuses: () => [], onPluginsChange: () => () => {}, addPlugins: async () => {}, installPlugin: async () => null, disablePlugin: async () => {} }))
vi.mock('../../../src/site', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/site')>()
  return { ...real, site: 'movie', siteAsks: (origin: string) => real.siteAsks(origin, 'movie') }
})

const { SourcesSection } = await import('../../../src/router/settings/sources')
const { DISABLED_SOURCES_KEY } = await import('../../../src/sources/disabled-sources')

const ACCOUNTS: AccountsProps = {
  backend: 'cloud',
  crunchyroll: { signIn: async () => 'authed', signOut: async () => {} },
  prime: { signIn: async () => 'authed', signOut: async () => {} },
  sites: { isConnected: () => false, watch: () => () => {}, signIn: async () => 'authed', signOut: async () => {} },
  status: { read: () => undefined, watch: () => () => {}, refresh: () => {} },
}

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllGlobals()
})

test('a site that never asks the anime catalogues keeps a card for each icon it draws, with that switch alone and no sign-in', () => {
  const host = mount(<SourcesSection {...ACCOUNTS}/>)
  hosts.push(host)
  const labels = (origin: string) => [...host.querySelectorAll(`[data-source="${origin}"] .switches label`)].map(label => label.textContent)
  for (const origin of ['mal', 'anilist', 'cr']) {
    expect(labels(origin), origin).toEqual(['Icon'])
    expect(host.querySelector(`[data-source="${origin}"] [data-account]`), origin).toBeNull()
  }
  expect(host.querySelector('[data-source="kitsu"]'), 'an anime catalogue stub never draws has no card').toBeNull()
  expect(labels('tvdb'), 'the control').toEqual(['Source', 'Icon'])
  expect([...host.querySelectorAll('[data-account]')].map(account => account.getAttribute('data-account'))).toEqual(['netflix', 'prime'])
})

// the switches follow the account to every site, and movies never lists MyAnimeList to turn back off
test('Turn all on turns on the sources this site lists, and leaves an anime catalogue turned off elsewhere off', async () => {
  const stored = new Map([[DISABLED_SOURCES_KEY, '["mal","simkl"]']])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value) },
    removeItem: (key: string) => { stored.delete(key) },
  })
  const host = mount(<SourcesSection {...ACCOUNTS}/>)
  hosts.push(host)
  await act(() => { button(host, 'Turn all on')!.click() })
  expect(JSON.parse(stored.get(DISABLED_SOURCES_KEY)!)).toEqual(['mal'])
  expect(button(host, 'Turn all on')!.getAttribute('aria-disabled'), 'all of this site\'s on').toBe('true')
})
