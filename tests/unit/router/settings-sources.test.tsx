// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { PluginStatus } from '../../../src/plugins'

// The Sources category of the settings page: the sources the viewer added from npm, and the way to add
// and remove them. FKN is faked: the plugin runtime is replaced by a list in memory.

const fake = vi.hoisted(() => ({
  statuses: [] as PluginStatus[],
  listeners: new Set<() => void>(),
}))
vi.mock('../../../src/plugins', () => ({
  pluginStatuses: () => fake.statuses,
  onPluginsChange: (listener: () => void) => {
    fake.listeners.add(listener)
    return () => { fake.listeners.delete(listener) }
  },
  addPlugins: vi.fn(async () => {}),
  enablePlugin: vi.fn(async () => null),
  disablePlugin: vi.fn(async () => {}),
}))

const { SourcesSection } = await import('../../../src/router/settings/sources')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  fake.statuses = []
})

const render = () => {
  const host = mount(<SourcesSection/>)
  hosts.push(host)
  return host
}

test('lists only the sources the viewer added, not the ones stub ships with', () => {
  fake.statuses = [{ uri: 'npm:@spec/one', state: 'connected', sources: [{ origin: 'one', name: 'One' }] }]
  const host = render()
  expect(host.querySelectorAll('[data-source]')).toHaveLength(0)
  expect(host.textContent).not.toContain('Built in')
  expect(host.textContent).not.toContain('Crunchyroll')
  expect(host.textContent).toContain('One')
})
