// Removing an added source: the list in this browser and everything listening to it move at once, and
// FKN is asked to uninstall the package, which it may never answer.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { ENABLED_PLUGINS_KEY } from '../../src/plugin-list'

const fkn = vi.hoisted(() => ({
  // FKN never answers here, which is what a page with no broker sees
  uninstall: vi.fn((_uri: string) => new Promise<void>(() => {})),
  connect: vi.fn(() => new Promise(() => {})),
}))
vi.mock('@fkn/lib', () => ({ packages: { uninstall: fkn.uninstall, connect: fkn.connect, install: vi.fn(), pick: vi.fn() } }))
vi.mock('../../src/worker', () => ({ registerRemoteSource: vi.fn(), unregisterRemoteSource: vi.fn() }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
})

// imported with nothing added, so loading it connects nothing
const { disablePlugin, onPluginsChange, pluginStatuses } = await import('../../src/plugins')

const URIS = ['npm:@banou/one', 'npm:@banou/two']

beforeEach(() => {
  stored.clear()
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify(URIS))
  fkn.uninstall.mockClear()
})

test('whoever shows the list is told at once, not once FKN answers', async () => {
  const told = vi.fn(() => pluginStatuses().map(plugin => plugin.uri))
  const stop = onPluginsChange(told)
  try {
    void disablePlugin(URIS[0]!)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(told).toHaveBeenCalled()
    expect(told.mock.results.at(-1)!.value).toEqual([URIS[1]])
  } finally {
    stop()
  }
})
