// Adding and removing a source: the list in this browser and everything listening to it move at once,
// while FKN's connection and uninstall may never answer. And the FKN account's list, brought onto this
// site's shelf when it arrives.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { ENABLED_PLUGINS_KEY } from '../../src/plugin-list'
import { SOURCES_PATH } from '../../src/plugin-sync'

const fkn = vi.hoisted(() => ({
  // FKN never answers here, which is what a page with no broker sees
  uninstall: vi.fn((_uri: string) => new Promise<void>(() => {})),
  connect: vi.fn(() => new Promise(() => {})),
  install: vi.fn(async (uri: string): Promise<{ uri: string } | null> => ({ uri })),
}))
vi.mock('@fkn/lib', () => ({ packages: { uninstall: fkn.uninstall, connect: fkn.connect, install: fkn.install, pick: vi.fn() } }))
vi.mock('../../src/worker', () => ({ registerRemoteSource: vi.fn(), unregisterRemoteSource: vi.fn() }))

// FKN's storage faked at @fkn/lib's surface, signed out until a test signs in
const account = await vi.hoisted(async () => {
  const { fknWorld } = await import('./tracking/fkn-fake')
  const { fknTrackerCloud } = await import('../../src/tracking/fkn-cloud')
  const world = fknWorld()
  const browser = world.browser()
  return { world, browser, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }) }
})
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: account.cloud, onTrackerAccountChange: account.browser.onChange }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

// imported with nothing added, so loading it connects nothing
const { checkSources, disablePlugin, installPlugin, onPluginsChange, pluginStatuses } = await import('../../src/plugins')

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

test("the account's list installs what this site lacks without FKN's confirm, and drops what the account no longer lists", async () => {
  const kept = 'npm:@banou/kept'
  const dropped = 'npm:@banou/dropped'
  stored.clear()
  fkn.install.mockClear()
  fkn.connect.mockClear()
  const holds = (list: string[]) => account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify(list), updatedAt: new Date(0).toISOString() })
  holds([kept, dropped])
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    expect(fkn.install).toHaveBeenCalledWith(kept, { noConfirm: true })
    expect(fkn.install).toHaveBeenCalledWith(dropped, { noConfirm: true })
    await vi.waitFor(() => expect(fkn.connect).toHaveBeenCalledWith(dropped, expect.anything()))
    expect(pluginStatuses().map(plugin => plugin.uri)).toEqual([kept, dropped])

    // removed on another site
    holds([kept])
    const told = vi.fn(() => pluginStatuses().map(plugin => plugin.uri))
    const stop = onPluginsChange(told)
    await checkSources()
    stop()
    expect(told.mock.results.at(-1)?.value, 'whoever shows the list is told').toEqual([kept])
    expect(fkn.uninstall).toHaveBeenCalledWith(dropped)
    expect(fkn.uninstall).not.toHaveBeenCalledWith(kept)
    expect(pluginStatuses().map(plugin => plugin.uri)).toEqual([kept])
  } finally {
    account.browser.account.signOut()
    await checkSources()
  }
})

test("a source of the account's list FKN does not install is shown failed, and never connected", async () => {
  const refused = 'npm:@banou/refused'
  const declined = 'npm:@banou/declined'
  stored.clear()
  fkn.connect.mockClear()
  fkn.install.mockImplementationOnce(async () => { throw new Error('FKN could not install it') })
  fkn.install.mockImplementationOnce(async () => null)
  account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify([refused, declined]), updatedAt: new Date(0).toISOString() })
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await vi.waitFor(() => expect(pluginStatuses()).toEqual([
      { uri: refused, state: 'error', error: 'FKN could not install it' },
      { uri: declined, state: 'error', error: `FKN did not install '${declined}'` },
    ]))
    expect(fkn.connect).not.toHaveBeenCalled()
  } finally {
    account.browser.account.signOut()
    await checkSources()
  }
})
