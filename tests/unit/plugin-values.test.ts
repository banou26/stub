// What the viewer entered for a source, in the real src/plugins.ts with FKN and the worker faked: handed to the source
// on every connection and when saved, kept for that source alone, and gone with the source. How it follows the FKN
// account is ./plugin-values-sync.test.ts; here it is what a source connected in this page is handed of it.
import { inspect } from 'node:util'
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_PLUGINS_KEY, ACCOUNT_VALUES_KEY, ENABLED_PLUGINS_KEY, loadPluginValues, PLUGIN_VALUES_KEY } from '../../src/plugin-list'
import { SOURCES_PATH, VALUES_PATH } from '../../src/plugin-sync'

const fkn = vi.hoisted(() => ({
  uninstall: vi.fn(async (_uri: string) => {}),
  connect: vi.fn(),
  install: vi.fn(async (uri: string): Promise<{ uri: string } | null> => ({ uri })),
  list: vi.fn(async (): Promise<{ uri: string }[]> => []),
}))
vi.mock('@fkn/lib', () => ({ packages: { uninstall: fkn.uninstall, connect: fkn.connect, install: fkn.install, list: fkn.list, pick: vi.fn() } }))

const worker = vi.hoisted(() => ({
  registerRemoteSource: vi.fn(async (_port: unknown, _uri: string, _values?: object): Promise<object> => ({ ok: { sources: [], rejected: [], settings: [] } })),
  unregisterRemoteSource: vi.fn(),
  configureRemoteSource: vi.fn(async (_uri: string, _values: object) => {}),
}))
vi.mock('../../src/worker', () => worker)

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

const { checkSources, configurePlugin, disablePlugin, installPlugin, onPluginsChange, pluginStatuses } = await import('../../src/plugins')

const SOURCE = 'npm:@spec/asking'
const OTHER = 'npm:@spec/other'
const VALUES = { address: 'https://server.spec.test', apiKey: 'a-saved-value' }
const FIELDS = [{ key: 'address', label: 'Address', kind: 'url', required: true }]

const keep = (values: Record<string, object>) => stored.set(PLUGIN_VALUES_KEY, JSON.stringify(values))
const kept = () => JSON.parse(stored.get(PLUGIN_VALUES_KEY) ?? '{}') as Record<string, object>
const handed = (uri: string) => worker.registerRemoteSource.mock.calls.filter(call => call[1] === uri).map(call => call[2])

/** Has FKN connect every source, and answers with what closes each connection, in order. */
const connecting = () => {
  const closes: (() => void)[] = []
  fkn.connect.mockImplementation(async () => ({ port: {}, closed: new Promise<void>(close => { closes.push(close) }) }))
  return closes
}

const signOutOfAlice = async () => {
  account.browser.account.signOut()
  await checkSources()
}

beforeEach(() => {
  stored.clear()
  account.world.storageOf('alice').clear()
  worker.registerRemoteSource.mockClear()
  worker.configureRemoteSource.mockClear()
  fkn.list.mockReset()
  fkn.list.mockResolvedValue([])
})

test('a source is handed the values saved for it when it connects, and only those', async () => {
  connecting()
  keep({ [SOURCE]: VALUES, [OTHER]: { apiKey: 'not-its-own' } })
  await installPlugin(SOURCE)
  await vi.waitFor(() => expect(handed(SOURCE)).toEqual([VALUES]))
  await disablePlugin(SOURCE)
})

test('what is kept but cannot be read counts as no values, and the source still connects and leaves', async () => {
  connecting()
  stored.set(PLUGIN_VALUES_KEY, '{not json')
  await installPlugin(SOURCE)
  await vi.waitFor(() => expect(handed(SOURCE)).toEqual([{}]))
  await disablePlugin(SOURCE)
  expect(stored.has(PLUGIN_VALUES_KEY)).toBe(false)
})

test('the page learns what a source asks for once it connected', async () => {
  connecting()
  worker.registerRemoteSource.mockResolvedValueOnce({ ok: { sources: [], rejected: [], settings: FIELDS } })
  await installPlugin(SOURCE)
  await vi.waitFor(() => expect(pluginStatuses().find(plugin => plugin.uri === SOURCE)?.settings).toEqual(FIELDS))
  await disablePlugin(SOURCE)
})

test('a reconnect hands the values over again, as they are by then', async () => {
  const closes = connecting()
  keep({ [SOURCE]: VALUES })
  await installPlugin(SOURCE)
  await vi.waitFor(() => expect(handed(SOURCE)).toHaveLength(1))

  await configurePlugin(SOURCE, { apiKey: 'a-newer-value' })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers()
  try {
    closes[0]!()
    await vi.advanceTimersByTimeAsync(3_000)
    expect(handed(SOURCE)).toEqual([VALUES, { apiKey: 'a-newer-value' }])
  } finally {
    vi.useRealTimers()
    warn.mockRestore()
    await disablePlugin(SOURCE)
  }
})

test('saving keeps the values on this device and hands them over at once, leaving other sources\' alone', async () => {
  keep({ [OTHER]: { apiKey: 'its-own' } })
  await configurePlugin(SOURCE, VALUES)
  expect(kept()).toEqual({ [OTHER]: { apiKey: 'its-own' }, [SOURCE]: VALUES })
  expect(worker.configureRemoteSource).toHaveBeenCalledExactlyOnceWith(SOURCE, VALUES)
})

test('saving nothing keeps nothing, and hands the source that nothing', async () => {
  keep({ [SOURCE]: VALUES })
  await configurePlugin(SOURCE, {})
  expect(stored.has(PLUGIN_VALUES_KEY)).toBe(false)
  expect(worker.configureRemoteSource).toHaveBeenCalledExactlyOnceWith(SOURCE, {})
})

test('removing a source removes its values, and no other source\'s', async () => {
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify([SOURCE, OTHER]))
  keep({ [SOURCE]: VALUES, [OTHER]: { apiKey: 'its-own' } })
  await disablePlugin(SOURCE)
  expect(kept()).toEqual({ [OTHER]: { apiKey: 'its-own' } })
  await disablePlugin(OTHER)
  expect(stored.has(PLUGIN_VALUES_KEY), 'nothing left under the key').toBe(false)
})

test('a source the account\'s list dropped leaves with its values', async () => {
  fkn.connect.mockImplementation(() => new Promise(() => {}))
  const holds = (list: string[]) => account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify(list), updatedAt: new Date(0).toISOString() })
  holds([SOURCE, OTHER])
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    keep({ [SOURCE]: VALUES, [OTHER]: { apiKey: 'its-own' } })
    holds([OTHER])
    await checkSources()
    expect(loadPluginValues(SOURCE)).toEqual({})
    expect(loadPluginValues(OTHER)).toEqual({ apiKey: 'its-own' })
    expect(account.world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(VALUES.apiKey)
  } finally {
    account.browser.account.signOut()
    await checkSources()
    expect(loadPluginValues(OTHER), 'the last source left at the sign out').toEqual({})
    expect(stored.has(PLUGIN_VALUES_KEY)).toBe(false)
  }
})

test('a source removed on another site of this app leaves with its values when FKN no longer holds it', async () => {
  fkn.connect.mockImplementation(async () => { throw new Error(`'${SOURCE}' is not installed by this app`) })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    stored.set(ENABLED_PLUGINS_KEY, JSON.stringify([]))
    keep({ [SOURCE]: VALUES })
    await installPlugin(SOURCE)
    await vi.waitFor(() => expect(stored.has(PLUGIN_VALUES_KEY)).toBe(false))
    expect(pluginStatuses().map(plugin => plugin.uri)).toEqual([])
  } finally {
    warn.mockRestore()
  }
})

const file = (path: string, value: unknown) =>
  account.world.storageOf('alice').set(path, { text: JSON.stringify(value), updatedAt: new Date(0).toISOString() })

test('a source first connected here after another site saved its values takes them on connect', async () => {
  connecting()
  file(SOURCES_PATH, [SOURCE])
  file(VALUES_PATH, { [SOURCE]: { apiKey: [VALUES.apiKey, 1_000] } })
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await vi.waitFor(() => expect(handed(SOURCE)).toEqual([{ apiKey: VALUES.apiKey }]))
    expect(worker.configureRemoteSource, 'there on connect, so nothing to hand after it').not.toHaveBeenCalled()
  } finally {
    await signOutOfAlice()
  }
})

test('a source already connected takes what another site saved, once, and no other source is told', async () => {
  connecting()
  file(SOURCES_PATH, [SOURCE, OTHER])
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await vi.waitFor(() => expect(pluginStatuses().map(plugin => plugin.state)).toEqual(['connected', 'connected']))
    worker.configureRemoteSource.mockClear()

    const told = vi.fn()
    const unsubscribe = onPluginsChange(told)
    file(VALUES_PATH, { [SOURCE]: { apiKey: [VALUES.apiKey, 1_000] } })
    await checkSources()
    await checkSources()
    unsubscribe()
    expect(worker.configureRemoteSource).toHaveBeenCalledExactlyOnceWith(SOURCE, { apiKey: VALUES.apiKey })
    expect(told, 'the open form hears it').toHaveBeenCalled()
  } finally {
    await signOutOfAlice()
  }
})

test('what the account sends while a source registers reaches it once it can take it', async () => {
  connecting()
  file(SOURCES_PATH, [SOURCE])
  let registered = (_: object) => {}
  worker.registerRemoteSource.mockImplementationOnce(() => new Promise(resolve => { registered = resolve }))
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await vi.waitFor(() => expect(handed(SOURCE)).toEqual([{}]))

    file(VALUES_PATH, { [SOURCE]: { apiKey: [VALUES.apiKey, 1_000] } })
    await checkSources()
    // the real worker has no `configure` to call before the registration gets that far
    expect(worker.configureRemoteSource).not.toHaveBeenCalled()
    registered({ ok: { sources: [], rejected: [], settings: [] } })
    await vi.waitFor(() => expect(worker.configureRemoteSource).toHaveBeenCalledExactlyOnceWith(SOURCE, { apiKey: VALUES.apiKey }))
  } finally {
    await signOutOfAlice()
  }
})

test('signed in, saving reaches the account and the source at once, and a sign out takes it from this browser', async () => {
  connecting()
  file(SOURCES_PATH, [SOURCE])
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await configurePlugin(SOURCE, VALUES)
    await checkSources()
    await checkSources()
    expect(JSON.parse(account.world.storageOf('alice').get(VALUES_PATH)!.text)[SOURCE].apiKey[0]).toBe(VALUES.apiKey)
    expect(worker.configureRemoteSource, 'its own save is not handed back').toHaveBeenCalledExactlyOnceWith(SOURCE, VALUES)
    expect(stored.has(PLUGIN_VALUES_KEY), 'the account\'s, not this device\'s own').toBe(false)
  } finally {
    await signOutOfAlice()
  }
  expect(stored.has(ACCOUNT_VALUES_KEY)).toBe(false)
  expect(JSON.stringify([...stored])).not.toContain(VALUES.apiKey)
  expect(account.world.storageOf('alice').get(VALUES_PATH)!.text, 'the account keeps them').toContain(VALUES.apiKey)
})

test('what the viewer entered reaches the values file alone, and never a line of the console', async () => {
  fkn.connect.mockImplementation(async () => { throw new Error('no frame') })
  fkn.list.mockResolvedValue([{ uri: SOURCE }])
  const lines = vi.fn()
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(level => vi.spyOn(console, level).mockImplementation(lines))
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    await installPlugin(SOURCE)
    await configurePlugin(SOURCE, VALUES)
    await checkSources()
    await vi.waitFor(() => expect(account.world.storageOf('alice').get(VALUES_PATH)?.text).toContain(VALUES.apiKey))
    expect(account.world.storageOf('alice').get(SOURCES_PATH)?.text).not.toContain(VALUES.apiKey)
    expect(stored.get(ACCOUNT_PLUGINS_KEY)).not.toContain(VALUES.apiKey)
    expect(inspect(lines.mock.calls, { depth: 8 })).not.toContain(VALUES.apiKey)
  } finally {
    for (const spy of spies) spy.mockRestore()
    await disablePlugin(SOURCE)
    await signOutOfAlice()
  }
})
