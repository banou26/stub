// Adding and removing a source: the list in this browser and everything listening to it move at once,
// while FKN's connection and uninstall may never answer. And the FKN account's list, brought onto this
// site's shelf when it arrives. And a source FKN holds for this tab alone, which no list stub keeps names.
import { beforeEach, expect, test, vi } from 'vite-plus/test'

import { ACCOUNT_PLUGINS_KEY, ENABLED_PLUGINS_KEY } from '../../src/plugin-list'
import { SOURCES_PATH } from '../../src/plugin-sync'

type Held = { uri: string, version?: string | null, temporary?: true }

const fkn = vi.hoisted(() => ({
  // FKN never answers here, which is what a page with no broker sees
  uninstall: vi.fn((_uri: string) => new Promise<void>(() => {})),
  connect: vi.fn((_uri?: string): Promise<unknown> => new Promise(() => {})),
  install: vi.fn(async (uri: string, _options?: object): Promise<Held | null> => ({ uri })),
  list: vi.fn(async (): Promise<Held[]> => { throw new Error('no broker') }),
  supportsTemporary: vi.fn(async () => false),
}))
vi.mock('@fkn/lib', () => ({ packages: { ...fkn, pick: vi.fn() } }))
vi.mock('../../src/worker', () => ({ registerRemoteSource: vi.fn(), unregisterRemoteSource: vi.fn() }))

// FKN's storage faked at @fkn/lib's surface, signed out until a test signs in
const account = await vi.hoisted(async () => {
  const { fknWorld } = await import('./tracking/fkn-fake')
  const { fknTrackerCloud } = await import('../../src/tracking/fkn-cloud')
  const world = fknWorld()
  const browser = world.browser()
  return { world, browser, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }) }
})
vi.mock('../../src/tracking/fkn-cloud-live', () => ({ trackerCloud: account.cloud, onTrackerAccountChange: account.browser.onChange, unlockTracker: account.browser.account.unlock }))

const stored = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})
// every address mirrors every enabled source, so it says nothing of where one came from
const address = { href: 'https://anime.fkn.app/' }
vi.stubGlobal('location', address)

// imported with nothing added, so loading it connects nothing
const { addedByLink, checkSources, disablePlugin, enabledPluginUris, enablePlugin, installPlugin, makeTemporary, onPluginsChange, pluginStatuses } = await import('../../src/plugins')

const URIS = ['npm:@banou/one', 'npm:@banou/two']

beforeEach(() => {
  stored.clear()
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify(URIS))
  fkn.uninstall.mockClear()
})

/** FKN answering every uninstall and install, temporary ones included, each logged in order. Undone with `undo`. */
const answering = () => {
  const log: unknown[][] = []
  fkn.supportsTemporary.mockImplementation(async () => true)
  fkn.uninstall.mockImplementation(async uri => { log.push(['uninstall', uri]) })
  fkn.install.mockImplementation(async (uri, options) => {
    log.push(['install', uri, options])
    return (options as { temporary?: true } | undefined)?.temporary ? { uri, temporary: true } : { uri }
  })
  const undo = () => {
    fkn.supportsTemporary.mockImplementation(async () => false)
    fkn.uninstall.mockImplementation(() => new Promise<void>(() => {}))
    fkn.install.mockImplementation(async uri => ({ uri }))
  }
  return { log, undo }
}

const listOf = (name: string): unknown => {
  const file = account.world.storageOf(name).get(SOURCES_PATH)
  return file && JSON.parse(file.text)
}

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

// a link removes a source it added that cannot connect, so it needs the id and the failure both
test('enabling hands back the id FKN installed and the connection, which rejects when the source cannot connect', async () => {
  const broken = 'npm:@banou/broken'
  fkn.connect.mockImplementationOnce(async () => { throw new Error('failed to boot') })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const added = await enablePlugin(`${broken}@1.0.0`, { noConfirm: true })
    expect(fkn.install).toHaveBeenLastCalledWith(`${broken}@1.0.0`, { noConfirm: true })
    expect(added?.uri).toBe(`${broken}@1.0.0`)
    await expect(added!.connected).rejects.toThrow('failed to boot')
  } finally {
    void disablePlugin(`${broken}@1.0.0`)
    warn.mockRestore()
  }
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

test('where FKN cannot hold a source for one tab, a sign out keeps connected on this device what a link added, and uninstalls the rest', async () => {
  const linked = 'npm:@banou/linked'
  const other = 'npm:@banou/other'
  stored.clear()
  account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify([linked, other]), updatedAt: new Date(0).toISOString() })
  account.browser.account.signIn('alice')
  await checkSources()
  addedByLink(linked)
  fkn.uninstall.mockClear()

  address.href = `https://anime.fkn.app/title/1?plugins=${linked}&plugins=${other}`
  account.browser.account.signOut()
  await checkSources()
  address.href = 'https://anime.fkn.app/'

  expect(fkn.uninstall.mock.calls).toEqual([[other]])
  expect(pluginStatuses().map(plugin => plugin.uri)).toEqual([linked])
  expect(pluginStatuses()[0]!.state, 'its connection is left alone').toBe('connecting')
  expect(stored.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([linked]))
  expect(stored.has(ACCOUNT_PLUGINS_KEY)).toBe(false)
})

test('a source a link added, removed since and added back in Settings, goes at a sign out', async () => {
  const again = 'npm:@banou/again'
  stored.clear()
  account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify([again]), updatedAt: new Date(0).toISOString() })
  account.browser.account.signIn('alice')
  await checkSources()
  addedByLink(again)
  void disablePlugin(again)
  await checkSources()
  await installPlugin(again)
  await checkSources()
  fkn.uninstall.mockClear()

  account.browser.account.signOut()
  await checkSources()
  expect(fkn.uninstall.mock.calls).toEqual([[again]])
  expect(pluginStatuses()).toEqual([])
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
      { uri: refused, state: 'error' },
      { uri: declined, state: 'error' },
    ]))
    expect(fkn.connect).not.toHaveBeenCalled()
  } finally {
    account.browser.account.signOut()
    await checkSources()
  }
})

// The home trailer waits for a source's first connection only: a retry held it again for 120 s
// (measured 2026-10-25 on anime.fkn.app, a source FKN refused retried every 6 to 30 s).
test('a connection after the source failed, or after it closed, reads as a retry, and its first does not', async () => {
  const worker = await import('../../src/worker')
  const failing = 'npm:@banou/failing'
  const closing = 'npm:@banou/closing'
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify([failing, closing]))
  let close = () => {}
  const closed = new Promise<void>(resolve => { close = resolve })
  fkn.connect.mockImplementation(async (uri?: string) => {
    if (uri === failing) throw new Error(`'${failing}' is not installed by this app`)
    if (uri === closing) return { port: {}, closed }
    return new Promise(() => {})
  })
  vi.mocked(worker.registerRemoteSource).mockResolvedValue({ ok: { sources: [], rejected: [], settings: [] } })
  const seen = new Map<string, object[]>()
  const stop = onPluginsChange(() => {
    for (const { uri, ...status } of pluginStatuses()) {
      const before = seen.get(uri) ?? []
      if (JSON.stringify(before.at(-1)) !== JSON.stringify(status)) seen.set(uri, [...before, status])
    }
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers()
  try {
    await installPlugin(failing)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.get(failing)).toEqual([{ state: 'connecting' }, { state: 'error' }])
    await vi.advanceTimersByTimeAsync(6_000)
    expect(seen.get(failing)?.slice(2)).toEqual([{ state: 'connecting', retry: true }, { state: 'error' }])

    await installPlugin(closing)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.get(closing)).toEqual([{ state: 'connecting' }, { state: 'connected', sources: [], rejected: [], settings: [] }])
    close()
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.get(closing)?.at(-1)).toEqual({ state: 'connecting', retry: true })
  } finally {
    stop()
    void disablePlugin(failing)
    void disablePlugin(closing)
    vi.useRealTimers()
    warn.mockRestore()
    fkn.connect.mockImplementation(() => new Promise(() => {}))
    vi.mocked(worker.registerRemoteSource).mockReset()
  }
})

test('Make temporary uninstalls the source and installs it again for this tab alone, at its version, off every list stub keeps', async () => {
  const [one, two] = URIS as [string, string]
  stored.clear()
  account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify([one, two]), updatedAt: new Date(0).toISOString() })
  const { log, undo } = answering()
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    log.length = 0
    fkn.list.mockResolvedValueOnce([{ uri: one, version: '1.2.0' }, { uri: two, version: '0.1.0' }])

    await makeTemporary(one)
    await checkSources()
    expect(log).toEqual([['uninstall', one], ['install', one, { temporary: true, noConfirm: true, version: '1.2.0' }]])
    expect(listOf('alice'), 'the account no longer keeps it').toEqual([two])
    expect(JSON.parse(stored.get(ACCOUNT_PLUGINS_KEY)!)).toEqual([two])
    expect(JSON.parse(stored.get(ENABLED_PLUGINS_KEY) ?? '[]'), 'nor does this device').toEqual([])
    expect(pluginStatuses().map(({ uri, temporary }) => ({ uri, temporary }))).toEqual([{ uri: two }, { uri: one, temporary: true }])
    expect(enabledPluginUris(), 'the address still carries it').toContain(one)
    await vi.waitFor(() => expect(fkn.connect).toHaveBeenLastCalledWith(one, expect.anything()))

    log.length = 0
    await disablePlugin(one)
    expect(log, 'Remove takes it from FKN too').toEqual([['uninstall', one]])
    expect(enabledPluginUris()).toEqual([two])
  } finally {
    undo()
    account.browser.account.signOut()
    await checkSources()
  }
})

test('a source made temporary that the account\'s list brings back is kept again, and goes when the list drops it', async () => {
  const [one, two] = URIS as [string, string]
  stored.clear()
  const holds = (list: string[]) => account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify(list), updatedAt: new Date(0).toISOString() })
  holds([two])
  const { log, undo } = answering()
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    stored.set(ENABLED_PLUGINS_KEY, JSON.stringify([one]))
    await makeTemporary(one)
    await checkSources()
    log.length = 0

    // added again on another device
    holds([two, one])
    await checkSources()
    expect(log).toEqual([['install', one, { noConfirm: true }]])
    expect(pluginStatuses().find(plugin => plugin.uri === one)).not.toHaveProperty('temporary')

    log.length = 0
    holds([two])
    await checkSources()
    expect(log).toEqual([['uninstall', one]])
    expect(enabledPluginUris()).toEqual([two])
  } finally {
    undo()
    account.browser.account.signOut()
    await checkSources()
  }
})

test('where FKN can, a sign out holds for this tab alone what a link added and what was made temporary, and uninstalls the rest', async () => {
  const linked = 'npm:@banou/linked'
  const other = 'npm:@banou/other'
  const made = 'npm:@banou/made'
  stored.clear()
  account.world.storageOf('alice').set(SOURCES_PATH, { text: JSON.stringify([linked, other, made]), updatedAt: new Date(0).toISOString() })
  const { log, undo } = answering()
  try {
    account.browser.account.signIn('alice')
    await checkSources()
    addedByLink(linked)
    await makeTemporary(made)
    await checkSources()
    log.length = 0

    account.browser.account.signOut()
    await checkSources()
    await vi.waitFor(() => expect(log.filter(([verb]) => verb === 'install')).toHaveLength(2))
    expect(log.filter(([, uri]) => uri === linked)).toEqual([['uninstall', linked], ['install', linked, { temporary: true, noConfirm: true }]])
    // FKN ends at a sign out what it held for the tab signed in
    expect(log.filter(([, uri]) => uri === made)).toEqual([['uninstall', made], ['install', made, { temporary: true, noConfirm: true }]])
    expect(log.filter(([, uri]) => uri === other)).toEqual([['uninstall', other]])
    expect(pluginStatuses().map(({ uri, temporary }) => ({ uri, temporary }))).toEqual([{ uri: made, temporary: true }, { uri: linked, temporary: true }])
    expect(JSON.parse(stored.get(ENABLED_PLUGINS_KEY) ?? '[]'), 'nothing of them on this device').toEqual([])
    expect(stored.has(ACCOUNT_PLUGINS_KEY)).toBe(false)

    account.browser.account.signIn('bob')
    await checkSources()
    expect(listOf('bob'), 'the next account to sign in gets nothing of them').toBeUndefined()
  } finally {
    void disablePlugin(linked)
    void disablePlugin(made)
    undo()
    account.browser.account.signOut()
    await checkSources()
  }
})

// a frame's close may reach this page after FKN installed the package again and it connected
test('the close of a connection the source has left tears down nothing of the one it is on', async () => {
  const worker = await import('../../src/worker')
  const [one] = URIS as [string]
  stored.set(ENABLED_PLUGINS_KEY, JSON.stringify([one]))
  const closes: (() => void)[] = []
  fkn.connect.mockImplementation(async () => ({ port: {}, closed: new Promise<void>(resolve => { closes.push(resolve) }) }))
  vi.mocked(worker.registerRemoteSource).mockResolvedValue({ ok: { sources: [], rejected: [], settings: [] } })
  const { undo } = answering()
  try {
    await installPlugin(one)
    await vi.waitFor(() => expect(pluginStatuses()[0]?.state).toBe('connected'))
    await makeTemporary(one)
    await vi.waitFor(() => expect(closes).toHaveLength(2))
    await vi.waitFor(() => expect(pluginStatuses()[0]).toMatchObject({ state: 'connected', temporary: true }))
    vi.mocked(worker.unregisterRemoteSource).mockClear()
    fkn.connect.mockClear()

    closes[0]!()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(worker.unregisterRemoteSource).not.toHaveBeenCalled()
    expect(pluginStatuses()[0]).toMatchObject({ state: 'connected', temporary: true })
    await new Promise(resolve => setTimeout(resolve, 3_100))
    expect(fkn.connect, 'and no second connection').not.toHaveBeenCalled()
  } finally {
    void disablePlugin(one)
    undo()
    fkn.connect.mockImplementation(() => new Promise(() => {}))
    vi.mocked(worker.registerRemoteSource).mockReset()
  }
})
