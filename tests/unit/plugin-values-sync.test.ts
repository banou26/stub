// What the viewer entered for a source following their FKN account, in a file beside the source list. FKN
// is faked at @fkn/lib's surface (./tracking/fkn-fake.ts) and reached through the tracker's real adapter.
import { inspect } from 'node:util'
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { FknStorage } from '../../src/tracking/fkn-cloud'

import { ACCOUNT_PLUGINS_KEY, ACCOUNT_VALUES_KEY, loadPluginValues, parseSaved, PLUGIN_VALUES_KEY, type ListStorage } from '../../src/plugin-list'
import { SOURCES_PATH, sourceListSync, VALUES_PATH } from '../../src/plugin-sync'
import { fknTrackerCloud } from '../../src/tracking/fkn-cloud'
import { fknWorld, mutex } from './tracking/fkn-fake'

const S = 'npm:@banou/asking'
const T = 'npm:@banou/other'
const ADDRESS = 'https://server.spec.test'
const KEY = 'a-value-only-the-viewer-reads'

type World = ReturnType<typeof fknWorld>
type Browser = ReturnType<World['browser']>

/** One of stub's sites open in `browser`, with its own storage and lock, and what its page heard. */
const site = (browser: Browser, wrap = (lib: FknStorage) => lib, unlock: () => Promise<unknown> = browser.account.unlock) => {
  const items = new Map<string, string>()
  const storage: ListStorage = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value) },
    removeItem: key => { items.delete(key) },
  }
  const realm = browser.realm()
  const connecting: Record<string, object>[] = []
  const shown = (uri: string) => loadPluginValues(uri, storage)
  const sync = sourceListSync({
    cloud: fknTrackerCloud(wrap(realm.lib), { timeoutMs: 20 }),
    onAccountChange: realm.onChange,
    lock: mutex(),
    storage,
    onList: (before, after) => { for (const uri of after) if (!before.includes(uri)) connecting.push({ [uri]: shown(uri) }) },
    onValues: () => {},
    unlock,
  })
  return { items, sync, connecting, shown }
}

const filed = (world: World, account: string) => {
  const file = world.storageOf(account).get(VALUES_PATH)
  return file && parseSaved(file.text)
}

/** What the account's file holds for `uri`, field by field, a cleared field as null. */
const fieldsOf = (world: World, account: string, uri: string) =>
  Object.fromEntries(Object.entries(filed(world, account)?.[uri] ?? {}).map(([field, [value]]) => [field, value]))

const holds = (world: World, account: string, list: string[]) =>
  world.storageOf(account).set(SOURCES_PATH, { text: JSON.stringify(list), updatedAt: new Date(0).toISOString() })

/** A client that knows only the list, as every client before the values: it reads the array and writes one back. */
const olderClient = (browser: Browser) => {
  const { lib } = browser.realm()
  const rewrite = async (change: (list: string[]) => string[]) => {
    const list = JSON.parse(await lib.readFile(SOURCES_PATH) as string) as unknown[]
    await lib.writeFile(SOURCES_PATH, JSON.stringify(change(list.filter((uri): uri is string => typeof uri === 'string'))))
  }
  return { rewrite }
}

afterEach(() => { vi.restoreAllMocks() })

describe('what the viewer entered on the FKN account', () => {
  test('a value saved on one site is there when another site connects the source', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { address: ADDRESS, apiKey: KEY })

    const movies = site(browser)
    await movies.sync.check()
    expect(movies.connecting).toEqual([{ [S]: { address: ADDRESS, apiKey: KEY } }])
    expect(movies.items.get(ACCOUNT_VALUES_KEY), 'kept as the account\'s, for the next load').toBeDefined()
  })

  test('a client that knows no values keeps them when it writes the list, and the list stays what it reads', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })

    await olderClient(browser).rewrite(list => [...list, T])
    expect(JSON.parse(world.storageOf('alice').get(SOURCES_PATH)!.text)).toEqual([S, T])

    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
  })

  test('a removal on one site removes the values for every other site', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S, T])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.check()
    await movies.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.save(T, { apiKey: 'its-own' })
    await movies.sync.check()
    expect(movies.shown(S)).toEqual({ apiKey: KEY })

    await movies.sync.remove(S)
    expect(Object.keys(filed(world, 'alice')!)).toEqual([T])
    expect(movies.shown(S), 'gone at once on the site it was removed on').toEqual({})

    await anime.sync.check()
    expect(anime.shown(S)).toEqual({})
    expect(anime.items.get(ACCOUNT_VALUES_KEY)).not.toContain(KEY)
    expect(anime.shown(T), 'and no other source\'s').toEqual({ apiKey: 'its-own' })
  })

  test('a removal by a client that knows no values removes them too, at the next site that reads the list', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S, T])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })

    await olderClient(browser).rewrite(list => list.filter(uri => uri !== S))
    await anime.sync.check()
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)
    expect(anime.items.get(ACCOUNT_VALUES_KEY)).not.toContain(KEY)
  })

  test('a removal hides the values at once, while FKN does not answer', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S, T])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.save(T, { apiKey: 'its-own' })

    browser.state.reachable = false
    void anime.sync.remove(S)
    expect(anime.shown(S)).toEqual({})
    expect(anime.items.get(ACCOUNT_VALUES_KEY)).not.toContain(KEY)
    expect(anime.shown(T)).toEqual({ apiKey: 'its-own' })
  })

  test('a source added back after a removal starts with nothing', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.remove(S)
    await anime.sync.add(S)
    await anime.sync.check()
    expect(anime.shown(S)).toEqual({})
    expect(fieldsOf(world, 'alice', S)).toEqual({})
  })

  test('a source added back while the file could not be read starts with nothing too', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.check()

    refuse = true
    await anime.sync.remove(S)
    expect(world.storageOf('alice').get(VALUES_PATH)!.text, 'still there for the next read to take').toContain(KEY)
    refuse = false
    await anime.sync.add(S)
    expect(anime.shown(S)).toEqual({})
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)

    await anime.sync.save(S, { apiKey: 'typed-after' })
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'typed-after' })
  })

  test('removing it a second time before that read keeps the first clearing', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.check()

    refuse = true
    await anime.sync.remove(S)
    await anime.sync.add(S)
    await anime.sync.remove(S)
    refuse = false
    await anime.sync.add(S)
    expect(anime.shown(S)).toEqual({})
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)
  })

  test('a waiting save for a source another site removed does not come back', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S, T])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const movies = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.writeFile(path, text)
      },
    }))
    const anime = site(browser)
    await anime.sync.check()
    await movies.sync.check()
    refuse = true
    await movies.sync.save(S, { apiKey: KEY })
    refuse = false
    await anime.sync.remove(S)
    await movies.sync.check()
    expect(movies.shown(S)).toEqual({})
    expect(movies.items.get(ACCOUNT_VALUES_KEY)).not.toContain(KEY)
  })

  test('signed out, what the viewer entered makes no call to FKN at all, and it joins the account only at a sign in', async () => {
    const world = fknWorld()
    const calls: string[] = []
    const browser = world.browser()
    const anime = site(browser, lib => ({
      ...lib,
      readFile: path => { calls.push(`read ${path}`); return lib.readFile(path) },
      writeFile: (path, text) => { calls.push(`write ${path} ${text}`); return lib.writeFile(path, text) },
    }))
    await anime.sync.add(S)
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.check()
    expect(calls).toEqual([])
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
    expect(JSON.parse(anime.items.get(PLUGIN_VALUES_KEY)!), 'as the device has always kept them').toEqual({ [S]: { apiKey: KEY } })

    browser.account.signIn('alice')
    await anime.sync.check()
    expect(calls.some(call => call.startsWith(`write ${VALUES_PATH}`)), 'the check above can see an upload').toBe(true)
  })

  test('with no key on this device nothing is uploaded, no card is raised, and the value stays here', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice', unlocked: false })
    const anime = site(browser)
    await anime.sync.add(S)
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.check()
    expect(browser.state.writes).toEqual([])
    expect(browser.state.cards, 'no connect card without a click').toBe(0)
    expect(anime.shown(S)).toEqual({ apiKey: KEY })

    await browser.account.unlock()
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
  })

  test('with the account\'s list in use and no key here, a save, being a click, asks FKN for the key and then reaches the account', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { address: ADDRESS })
    expect(browser.state.cards, 'none with the key held').toBe(0)

    browser.state.unlocked = false
    await anime.sync.check()
    expect(browser.state.cards, 'no card from a check').toBe(0)
    await anime.sync.save(S, { apiKey: KEY })
    expect(browser.state.cards).toBe(1)
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS, apiKey: KEY })
  })

  test('a key refused leaves the save waiting in this page, and the key reaching it later writes it', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser, lib => lib, async () => false)
    await anime.sync.check()

    browser.state.unlocked = false
    await anime.sync.save(S, { apiKey: KEY })
    expect(browser.state.writes).toEqual([])
    expect(anime.shown(S)).toEqual({ apiKey: KEY })

    await browser.account.unlock()
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
  })

  test('values go to FKN only as the contents of its sealed write, at a path that names nothing of them', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const fetching = vi.fn(async () => new Response())
    vi.stubGlobal('fetch', fetching)
    const lines = vi.fn()
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation(lines)
    try {
      const anime = site(browser)
      await anime.sync.check()
      await anime.sync.save(S, { apiKey: KEY })
      await anime.sync.check()
      // FKN's frame seals what `writeFile` carries before it leaves this browser, and its api refuses anything
      // unsealed: stub's half is that a value travels nowhere else, and never in the path the api can read
      expect(browser.state.writes.map(({ path }) => path)).toEqual([VALUES_PATH])
      expect(browser.state.writes.at(-1)!.text).toContain(KEY)
      expect(world.storageOf('alice').get(SOURCES_PATH)!.text).not.toContain(KEY)
      expect(anime.items.get(ACCOUNT_PLUGINS_KEY)).not.toContain(KEY)
      expect(JSON.stringify(fetching.mock.calls)).not.toContain(KEY)
      expect(inspect(lines.mock.calls, { depth: 8 })).not.toContain(KEY)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('values entered on the device join the account where it has none, and leave the device', async () => {
    const world = fknWorld()
    holds(world, 'alice', [T])
    const browser = world.browser()
    const anime = site(browser)
    const now = vi.spyOn(Date, 'now')
    await anime.sync.add(S)
    await anime.sync.add(T)
    await anime.sync.save(S, { apiKey: KEY })
    await anime.sync.save(T, { address: 'from-the-device', category: 'from-the-device' })

    now.mockReturnValue(1_000)
    const movies = site(world.browser({ account: 'alice' }))
    await movies.sync.check()
    await movies.sync.save(T, { address: ADDRESS })

    now.mockReturnValue(9_000)
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
    expect(fieldsOf(world, 'alice', T), 'the account\'s value stays where it has one').toEqual({ address: ADDRESS, category: 'from-the-device' })
    expect(anime.items.has(PLUGIN_VALUES_KEY), 'merged, so no longer this device\'s own').toBe(false)
    expect(anime.shown(T)).toEqual({ address: ADDRESS, category: 'from-the-device' })
  })

  // two sites have no lock in common, so both read the file before either wrote, and the last write has one field
  test('two sites hearing one sign in both keep what they entered, whichever write lands last', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser()
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.add(S)
    await movies.sync.add(S)
    await anime.sync.save(S, { address: ADDRESS })
    await movies.sync.save(S, { apiKey: KEY })

    browser.account.signIn('alice')
    await anime.sync.check()
    await movies.sync.check()
    await anime.sync.check()
    await movies.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS, apiKey: KEY })
    expect(anime.shown(S)).toEqual({ address: ADDRESS, apiKey: KEY })
    expect(movies.shown(S)).toEqual({ address: ADDRESS, apiKey: KEY })
    expect(anime.items.has(PLUGIN_VALUES_KEY), 'gone from the device all the same').toBe(false)
    expect(movies.items.has(PLUGIN_VALUES_KEY)).toBe(false)

    const writes = browser.state.writes.length
    await anime.sync.check()
    await movies.sync.check()
    expect(browser.state.writes.length, 'settled').toBe(writes)
  })

  test('a value typed on the device while a step takes the others stays, and joins at the next one', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser()
    let typing = true
    const anime: ReturnType<typeof site> = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (path === VALUES_PATH && typing) {
          typing = false
          void anime.sync.save(S, { address: 'typed-during' })
        }
      },
    }))
    await anime.sync.add(S)
    await anime.sync.save(S, { apiKey: 'first' })
    browser.account.signIn('alice')
    await anime.sync.check()
    await anime.sync.check()
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'first', address: 'typed-during' })
  })

  test('values joined just as the account switches do not reach the next account too', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    holds(world, 'bob', [S])
    const browser = world.browser()
    const anime: ReturnType<typeof site> = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (path === VALUES_PATH && browser.state.account === 'alice') browser.account.signIn('bob')
      },
    }))
    await anime.sync.add(S)
    await anime.sync.save(S, { apiKey: KEY })
    browser.account.signIn('alice')
    await anime.sync.check()
    await anime.sync.check()
    await vi.waitFor(() => expect(anime.items.has(ACCOUNT_VALUES_KEY)).toBe(true))
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
    expect(fieldsOf(world, 'bob', S)).toEqual({})
    expect(anime.shown(S)).toEqual({})
  })

  test('a save made after a sign out this page never heard of reaches no account', async () => {
    const world = fknWorld()
    holds(world, 'bob', [S])
    const browser = world.browser()
    const unlock = vi.fn(async () => true)
    const anime = site(browser, lib => lib, unlock)
    anime.items.set(ACCOUNT_PLUGINS_KEY, JSON.stringify([S]))
    await anime.sync.save(S, { apiKey: KEY })
    expect(unlock, 'nobody to raise FKN\'s card for').not.toHaveBeenCalled()
    browser.state.account = 'bob'
    await anime.sync.check()
    expect(world.storageOf('bob').get(VALUES_PATH)?.text ?? '').not.toContain(KEY)
  })

  test('a switch takes the last account\'s values at once, even if the next account\'s cannot be read', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    holds(world, 'bob', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })

    refuse = true
    browser.account.signIn('bob')
    await anime.sync.check()
    expect(anime.items.get(ACCOUNT_PLUGINS_KEY), 'the list followed').toBe(JSON.stringify([S]))
    expect(anime.shown(S)).toEqual({})
    expect(JSON.stringify([...anime.items])).not.toContain(KEY)
  })

  test('a renewal of the same account\'s connection leaves the values shown', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })

    browser.state.reachable = false
    browser.account.renew()
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
    browser.state.reachable = true
  })

  test('a site closed at the sign out takes its copy away when it next opens', async () => {
    const world = fknWorld()
    const anime = site(world.browser())
    anime.items.set(ACCOUNT_PLUGINS_KEY, JSON.stringify([S]))
    anime.items.set(ACCOUNT_VALUES_KEY, JSON.stringify({ [S]: { apiKey: [KEY, 1_000] } }))
    await anime.sync.check()
    expect(anime.items.has(ACCOUNT_VALUES_KEY)).toBe(false)
    expect(anime.shown(S)).toEqual({})
  })

  test('a sign out takes them from this browser with the list, leaves them on the account, and hands them to nobody else', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })

    browser.account.signOut()
    await anime.sync.check()
    expect(anime.items.has(ACCOUNT_VALUES_KEY)).toBe(false)
    expect(anime.shown(S)).toEqual({})
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })

    browser.account.signIn('bob')
    await anime.sync.check()
    expect(filed(world, 'bob'), 'nothing reaches the next account').toBeUndefined()
  })

  test('a save waiting when the account switches never reaches the next account', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    holds(world, 'bob', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    void anime.sync.save(S, { apiKey: KEY })
    browser.account.signIn('bob')
    browser.state.reachable = true
    await anime.sync.check()
    await vi.waitFor(() => expect(anime.items.get(ACCOUNT_VALUES_KEY)).toBe('{}'))
    expect(world.storageOf('bob').get(VALUES_PATH)).toBeUndefined()
    expect(anime.shown(S)).toEqual({})
  })

  test('a save survives a renewal of the same account\'s connection', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    void anime.sync.save(S, { apiKey: KEY })
    browser.account.renew()
    browser.state.reachable = true
    await anime.sync.check()
    await vi.waitFor(() => expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY }))
  })

  // two sites have no lock in common: anime's write is held back until movies wrote over the file it read
  test('two sites saving at once keep both their fields, whichever write lands last', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const gate = { release: () => {}, reached: () => {}, open: Promise.resolve() }
    const anime = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        gate.reached()
        await gate.open
        return lib.writeFile(path, text)
      },
    }))
    const movies = site(browser)
    await anime.sync.check()
    await movies.sync.check()
    await anime.sync.save(S, { address: 'first', apiKey: 'first' })
    await movies.sync.check()

    gate.open = new Promise(resolve => { gate.release = resolve })
    const reached = new Promise<void>(resolve => { gate.reached = resolve })
    const saving = anime.sync.save(S, { address: ADDRESS })
    await reached
    await movies.sync.save(S, { apiKey: KEY })
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: 'first', apiKey: KEY })
    gate.release()
    await saving
    expect(fieldsOf(world, 'alice', S), 'anime wrote what it read, without movies\' field').toEqual({ address: ADDRESS, apiKey: 'first' })

    await movies.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS, apiKey: KEY })

    const writes = browser.state.writes.length
    await anime.sync.check()
    await movies.sync.check()
    expect(browser.state.writes.length, 'settled').toBe(writes)
    expect(anime.shown(S)).toEqual({ address: ADDRESS, apiKey: KEY })
    expect(movies.shown(S)).toEqual({ address: ADDRESS, apiKey: KEY })
  })

  test('saving the same field on two sites, the later save wins, whichever write lands last', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.check()
    await movies.sync.check()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2_000)
    browser.state.reachable = false
    void anime.sync.save(S, { apiKey: 'earlier' })
    browser.state.reachable = true
    now.mockReturnValue(3_000)
    await movies.sync.save(S, { apiKey: 'later' })
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'later' })

    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'later' })
    expect(anime.shown(S)).toEqual({ apiKey: 'later' })
  })

  test('a save touches only the fields it is given, whatever a form behind this browser\'s copy held', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: 'newer' })
    await movies.sync.check()
    const stamp = filed(world, 'alice')![S]!.apiKey![1]

    await movies.sync.save(S, { category: '5000' })
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'newer', category: '5000' })
    expect(filed(world, 'alice')![S]!.apiKey![1], 'no newer than it was').toBe(stamp)
  })

  test('a removal is stamped later than the value it clears, on a clock that runs behind too', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    await anime.sync.save(S, { apiKey: KEY })

    now.mockReturnValue(4_000)
    refuse = true
    await anime.sync.remove(S)
    refuse = false
    await anime.sync.add(S)
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)
  })

  test('a save after a removal is stamped later than the clearing it follows, on a clock that runs behind too', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    await anime.sync.save(S, { apiKey: KEY })

    now.mockReturnValue(4_000)
    browser.state.reachable = false
    void anime.sync.remove(S)
    void anime.sync.add(S)
    void anime.sync.save(S, { apiKey: 'typed-after' })
    browser.state.reachable = true
    await anime.sync.check()
    await vi.waitFor(() => expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'typed-after' }))
    expect(anime.shown(S)).toEqual({ apiKey: 'typed-after' })
  })

  test('a device whose clock runs behind still replaces the value it was shown', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.check()
    await movies.sync.check()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(10_000)
    await anime.sync.save(S, { apiKey: 'first' })
    await movies.sync.check()
    now.mockReturnValue(4_000)
    await movies.sync.save(S, { apiKey: 'second' })
    await movies.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: 'second' })
  })

  test('a field cleared on one site is cleared on every other, and an older save does not bring it back', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    const movies = site(browser)
    await anime.sync.check()
    await movies.sync.check()

    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2_000)
    await anime.sync.save(S, { address: ADDRESS, apiKey: KEY })
    await movies.sync.check()

    now.mockReturnValue(3_000)
    browser.state.reachable = false
    void movies.sync.save(S, { apiKey: 'typed-while-away' })
    browser.state.reachable = true
    now.mockReturnValue(4_000)
    await anime.sync.save(S, { apiKey: null })
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS, apiKey: null })

    await movies.sync.check()
    expect(movies.shown(S)).toEqual({ address: ADDRESS })
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS, apiKey: null })
  })

  test('a field cleared while signed out never reaches an account', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const alice = site(world.browser({ account: 'alice' }))
    await alice.sync.check()
    await alice.sync.save(S, { apiKey: KEY })

    const browser = world.browser()
    const anime = site(browser)
    await anime.sync.add(S)
    await anime.sync.save(S, { apiKey: 'on-this-device' })
    await anime.sync.save(S, { apiKey: null })
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
  })

  test('a save FKN does not answer or refuses is shown at once, and written once it can be', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        if (refuse) throw new Error('storage: the request failed')
        return lib.writeFile(path, text)
      },
    }))
    await anime.sync.check()

    refuse = true
    await anime.sync.save(S, { apiKey: KEY })
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
    expect(world.storageOf('alice').get(VALUES_PATH)).toBeUndefined()

    refuse = false
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
  })

  test('a save made while a step writes the file is neither hidden nor lost', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let saveOnWrite = false
    const anime: ReturnType<typeof site> = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (saveOnWrite) {
          saveOnWrite = false
          void anime.sync.save(S, { apiKey: KEY })
        }
      },
    }))
    await anime.sync.check()
    await anime.sync.save(S, { address: ADDRESS })

    saveOnWrite = true
    await anime.sync.save(S, { address: 'https://next.spec.test' })
    expect(anime.shown(S)).toEqual({ address: 'https://next.spec.test', apiKey: KEY })
    await anime.sync.check()
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: 'https://next.spec.test', apiKey: KEY })
  })

  test('a save waiting when the source is removed goes with it, even if the source comes back', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    void anime.sync.save(S, { apiKey: KEY })
    void anime.sync.remove(S)
    void anime.sync.add(S)
    browser.state.reachable = true
    await anime.sync.check()
    await vi.waitFor(() => expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: null }))
    expect(JSON.parse(world.storageOf('alice').get(SOURCES_PATH)!.text)).toEqual([S])
    expect(world.storageOf('alice').get(VALUES_PATH)!.text).not.toContain(KEY)
    expect(anime.shown(S)).toEqual({})
  })

  test('a removal leaves the save waiting for another source', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S, T])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    void anime.sync.save(T, { apiKey: 'its-own' })
    void anime.sync.remove(S)
    browser.state.reachable = true
    await anime.sync.check()
    await vi.waitFor(() => expect(fieldsOf(world, 'alice', T)).toEqual({ apiKey: 'its-own' }))
  })

  test('a values file FKN will not serve leaves the list working and the values shown', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse && path === VALUES_PATH) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()
    await anime.sync.save(S, { apiKey: KEY })
    expect(fieldsOf(world, 'alice', S)).toEqual({ apiKey: KEY })

    refuse = true
    holds(world, 'alice', [S, T])
    await anime.sync.check()
    expect(anime.items.get(ACCOUNT_PLUGINS_KEY)).toBe(JSON.stringify([S, T]))
    expect(anime.shown(S)).toEqual({ apiKey: KEY })
  })

  test('a file that cannot be read counts as none, stops nothing, logs nothing, and the next save replaces it', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    world.storageOf('alice').set(VALUES_PATH, { text: `${KEY} is not json`, updatedAt: new Date(0).toISOString() })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    expect(anime.shown(S)).toEqual({})
    expect(anime.items.get(ACCOUNT_PLUGINS_KEY), 'the list still followed').toBe(JSON.stringify([S]))
    expect(warn, 'a parse error quotes the text it read').not.toHaveBeenCalled()

    await anime.sync.save(S, { address: ADDRESS })
    expect(fieldsOf(world, 'alice', S)).toEqual({ address: ADDRESS })
  })

  test('a malformed field in the file never reaches a source', async () => {
    const world = fknWorld()
    holds(world, 'alice', [S])
    world.storageOf('alice').set(VALUES_PATH, { text: JSON.stringify({ [S]: { apiKey: 'bare', other: 7, ok: ['kept', 1] } }), updatedAt: new Date(0).toISOString() })
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    expect(anime.shown(S)).toEqual({ ok: 'kept' })
  })

  test('while both hold a field the account\'s wins over the device\'s own, and one it cleared is gone from both', () => {
    const anime = site(fknWorld().browser())
    anime.items.set(PLUGIN_VALUES_KEY, JSON.stringify({ [S]: { apiKey: 'own', address: 'own', category: 'own' } }))
    anime.items.set(ACCOUNT_VALUES_KEY, JSON.stringify({ [S]: { apiKey: ['account', 5], address: [null, 5] } }))
    expect(anime.shown(S)).toEqual({ apiKey: 'account', category: 'own' })
  })
})
