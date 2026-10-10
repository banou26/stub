// Adding and removing a source: the list in this browser and everything listening to it move at once,
// while FKN's connection and uninstall may never answer.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { ENABLED_PLUGINS_KEY } from '../../src/plugin-list'

const fkn = vi.hoisted(() => ({
  // FKN never answers here, which is what a page with no broker sees
  uninstall: vi.fn((_uri: string) => new Promise<void>(() => {})),
  connect: vi.fn(() => new Promise(() => {})),
  install: vi.fn(async (uri: string) => ({ uri })),
}))
vi.mock('@fkn/lib', () => ({ packages: { uninstall: fkn.uninstall, connect: fkn.connect, install: fkn.install, pick: vi.fn() } }))
vi.mock('../../src/worker', () => ({ registerRemoteSource: vi.fn(), unregisterRemoteSource: vi.fn() }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
})

// imported with nothing added, so loading it connects nothing
const { disablePlugin, installPlugin, onPluginsChange, pluginStatuses } = await import('../../src/plugins')

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

test('adding settles once FKN has installed the package, and the list shows the connection it started', async () => {
  const added = 'npm:@banou/three'
  const settled = await Promise.race([installPlugin(added), new Promise(resolve => setTimeout(resolve, 200, 'still waiting'))])
  expect(settled).toBe(added)
  expect(fkn.connect).toHaveBeenCalledWith(added, expect.anything())
  expect(pluginStatuses().find(plugin => plugin.uri === added)?.state).toBe('connecting')
})
