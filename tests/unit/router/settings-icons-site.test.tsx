// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'

vi.mock('../../../src/plugins', () => ({ pluginStatuses: () => [], onPluginsChange: () => () => {}, addPlugins: async () => {}, installPlugin: async () => null, disablePlugin: async () => {} }))
vi.mock('../../../src/site', async importOriginal => {
  const real = await importOriginal<typeof import('../../../src/site')>()
  return { ...real, site: 'movie', siteAsks: (origin: string) => real.siteAsks(origin, 'movie') }
})

const { SourcesSection } = await import('../../../src/router/settings/sources')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('a site that never asks the anime catalogues still lists their icons, which it draws', () => {
  const host = mount(<SourcesSection/>)
  hosts.push(host)
  expect(host.querySelector('[data-source="mal"]'), 'the control: movies does not list MyAnimeList as a source').toBeNull()
  for (const origin of ['mal', 'anilist', 'cr']) expect(host.querySelector(`[data-icon="${origin}"]`), origin).not.toBeNull()
})
