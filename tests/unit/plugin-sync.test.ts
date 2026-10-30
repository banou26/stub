// The added sources following the viewer's FKN account across stub's sites and devices. FKN is faked at
// @fkn/lib's surface (./tracking/fkn-fake.ts) and reached through the tracker's real adapter.
import { describe, expect, test } from 'vite-plus/test'

import type { FknStorage } from '../../src/tracking/fkn-cloud'

import { ACCOUNT_PLUGINS_KEY, ENABLED_PLUGINS_KEY, loadEnabled, type ListStorage } from '../../src/plugin-list'
import { SOURCES_PATH, sourceListSync } from '../../src/plugin-sync'
import { fknTrackerCloud } from '../../src/tracking/fkn-cloud'
import { fknWorld, mutex } from './tracking/fkn-fake'

const A = 'npm:@banou/a'
const B = 'npm:@banou/b'
const C = 'npm:@banou/c'

type World = ReturnType<typeof fknWorld>
type Browser = ReturnType<World['browser']>

const memoryStorage = () => {
  const items = new Map<string, string>()
  const storage: ListStorage = {
    getItem: key => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value) },
    removeItem: key => { items.delete(key) },
  }
  return { items, storage }
}

/** A tab of one of stub's sites in `browser`: the site's storage and lock, which its tabs share, and the tab's own @fkn/lib realm. */
const tab = (browser: Browser, shared = { ...memoryStorage(), lock: mutex() }, wrap = (lib: FknStorage) => lib) => {
  const realm = browser.realm()
  const changes: { before: string[], after: string[] }[] = []
  const sync = sourceListSync({
    cloud: fknTrackerCloud(wrap(realm.lib), { timeoutMs: 20 }),
    onAccountChange: realm.onChange,
    lock: shared.lock,
    storage: shared.storage,
    onList: (before, after) => { changes.push({ before, after }) },
  })
  return { items: shared.items, sync, changes, shown: () => loadEnabled(shared.storage) }
}

/** One of stub's sites open in `browser`, in one tab. */
const site = (browser: Browser, wrap?: (lib: FknStorage) => FknStorage) => tab(browser, undefined, wrap)

const listOf = (world: World, account: string): unknown => {
  const file = world.storageOf(account).get(SOURCES_PATH)
  return file && JSON.parse(file.text)
}

const holds = (world: World, account: string, list: string[]) =>
  world.storageOf(account).set(SOURCES_PATH, { text: JSON.stringify(list), updatedAt: new Date(0).toISOString() })

describe('the added sources on the FKN account', () => {
  test('a source added on one site is the list of every other site signed in to the account', async () => {
    const world = fknWorld()
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    await anime.sync.add(A)
    expect(listOf(world, 'alice')).toEqual([A])

    const series = site(browser)
    await series.sync.check()
    expect(series.shown()).toEqual([A])
    expect(series.changes).toEqual([{ before: [], after: [A] }])
    expect(series.items.get(ACCOUNT_PLUGINS_KEY), 'kept as the account\'s, for the next load').toBe(JSON.stringify([A]))
  })

  test('sources added while signed out go into the next account to sign in, once, and leave with it', async () => {
    const world = fknWorld()
    holds(world, 'alice', [B])
    const browser = world.browser()
    const anime = site(browser)
    await anime.sync.add(A)

    browser.account.signIn('alice')
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([B, A])
    expect(anime.shown()).toEqual([B, A])
    expect(JSON.parse(anime.items.get(ENABLED_PLUGINS_KEY)!), 'merged, so no longer this device\'s own').toEqual([])

    browser.account.signOut()
    await anime.sync.check()
    expect(anime.shown(), 'the account\'s list leaves at sign out').toEqual([])
    expect(anime.items.has(ACCOUNT_PLUGINS_KEY)).toBe(false)
    expect(anime.changes.at(-1)).toEqual({ before: [B, A], after: [] })

    browser.account.signIn('bob')
    await anime.sync.check()
    expect(listOf(world, 'bob'), 'merged once: nothing reaches the next account').toBeUndefined()
  })

  test('an account switch never writes the list shown for the old account into the new one', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A, B])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    expect(anime.shown()).toEqual([A, B])

    browser.account.signIn('bob')
    await anime.sync.check()
    expect(listOf(world, 'bob')).toBeUndefined()
    expect(anime.shown()).toEqual([])

    await anime.sync.add(C)
    expect(listOf(world, 'bob')).toEqual([C])
    expect(listOf(world, 'alice')).toEqual([A, B])
  })

  test('a switch between reading one account\'s list and writing it writes nothing of it anywhere', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser()
    let switchOnRead = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        const text = await lib.readFile(path)
        if (switchOnRead) {
          switchOnRead = false
          browser.account.signIn('bob')
        }
        return text
      },
    }))
    await anime.sync.add(C)

    switchOnRead = true
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A])
    expect(listOf(world, 'bob'), 'the device\'s own source, and nothing of alice\'s').toEqual([C])
    expect(anime.shown()).toEqual([C])
  })

  test('adding and removing writes that one change over what the account holds now, never this browser\'s copy', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    // another device adds B after this site last read the list
    holds(world, 'alice', [A, B])

    const adding = anime.sync.add(C)
    expect(anime.shown(), 'shown at once').toEqual([A, C])
    await adding
    expect(listOf(world, 'alice')).toEqual([A, B, C])

    const removing = anime.sync.remove(A)
    expect(anime.shown(), 'hidden at once').toEqual([B, C])
    await removing
    expect(listOf(world, 'alice')).toEqual([B, C])
    expect(browser.state.writes.map(write => JSON.parse(write.text))).toEqual([[A, B, C], [B, C]])

    // added back on another device once the removal was written
    holds(world, 'alice', [B, C, A])
    await anime.sync.check()
    expect(anime.shown()).toEqual([B, C, A])
    expect(listOf(world, 'alice')).toEqual([B, C, A])
  })

  test('signed out, or with no key on this device, the list is this device\'s own as before', async () => {
    const world = fknWorld()
    const signedOut = world.browser()
    const anime = site(signedOut)
    await anime.sync.add(A)
    await anime.sync.add(B)
    await anime.sync.remove(A)
    expect(anime.items.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([B]))
    expect(anime.items.has(ACCOUNT_PLUGINS_KEY)).toBe(false)
    expect(signedOut.state.writes).toEqual([])

    holds(world, 'alice', [C])
    const locked = world.browser({ account: 'alice', unlocked: false })
    const series = site(locked)
    await series.sync.add(A)
    expect(series.shown()).toEqual([A])
    expect(locked.state.cards, 'no connect card without a click').toBe(0)
    expect(locked.state.writes).toEqual([])
    expect(listOf(world, 'alice')).toEqual([C])
  })

  test('FKN not answering, or refusing the read, moves nothing: the account\'s list stays shown', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        if (refuse) throw new Error('storage: the request failed')
        return lib.readFile(path)
      },
    }))
    await anime.sync.check()

    browser.state.reachable = false
    await anime.sync.check()
    expect(anime.shown()).toEqual([A])
    expect(anime.items.get(ACCOUNT_PLUGINS_KEY)).toBe(JSON.stringify([A]))

    browser.state.reachable = true
    refuse = true
    await anime.sync.check()
    expect(anime.shown(), 'a refused read is never an empty list').toEqual([A])
    expect(anime.changes).toEqual([{ before: [], after: [A] }])
  })

  test('a write FKN refuses keeps the addition on this device, and the next check writes it', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
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
    await anime.sync.add(B)
    expect(listOf(world, 'alice')).toEqual([A])
    expect(anime.items.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([B]))
    expect(anime.shown()).toEqual([A, B])

    refuse = false
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A, B])
    expect(anime.items.get(ENABLED_PLUGINS_KEY)).toBe(JSON.stringify([]))
  })

  test('a removal made while FKN does not answer stays removed, and is written once it answers', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A, B])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    await anime.sync.remove(A)
    expect(anime.shown()).toEqual([B])

    browser.state.reachable = true
    await anime.sync.check()
    expect(anime.shown()).toEqual([B])
    expect(listOf(world, 'alice')).toEqual([B])
    expect(anime.changes, 'never handed back to be installed again').toEqual([{ before: [], after: [A, B] }])
  })

  test('a source removed and added back before FKN answers stays on the account', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A, B])
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()

    browser.state.reachable = false
    await anime.sync.remove(A)
    await anime.sync.add(A)
    browser.state.reachable = true
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A, B])
    expect(anime.shown()).toEqual([A, B])
  })

  test('a removal made while signed out never reaches an account\'s list', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser()
    const anime = site(browser)
    await anime.sync.add(A)
    await anime.sync.remove(A)

    browser.account.signIn('alice')
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A])
    expect(anime.shown()).toEqual([A])
  })

  test('a switch heard after the merge was written leaves this device\'s additions in that account only', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser()
    let switchOnWrite = false
    const anime = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (switchOnWrite) {
          switchOnWrite = false
          browser.account.signIn('bob')
        }
      },
    }))
    await anime.sync.add(C)

    switchOnWrite = true
    browser.account.signIn('alice')
    await anime.sync.check()
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A, C])
    expect(listOf(world, 'bob'), 'merged once').toBeUndefined()
    expect(anime.shown()).toEqual([])
  })

  test('a switch heard while one account\'s list is read never shows that list for the next account', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    // the next account's key is not on this device, so its own list cannot replace the one read
    const browser = world.browser({ account: 'alice', locked: ['bob'] })
    let switchOnRead = false
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        const text = await lib.readFile(path)
        if (switchOnRead) {
          switchOnRead = false
          browser.account.signIn('bob')
        }
        return text
      },
    }))
    switchOnRead = true
    await anime.sync.check()
    await anime.sync.check()
    expect(anime.shown()).toEqual([])
    expect(anime.changes).toEqual([])
  })

  test('every tab of a site follows a change another tab applied, the sign out included', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser({ account: 'alice' })
    const shared = { ...memoryStorage(), lock: mutex() }
    const one = tab(browser, shared)
    const two = tab(browser, shared)
    await one.sync.check()
    await two.sync.check()
    expect(one.changes).toEqual([{ before: [], after: [A] }])
    expect(two.changes).toEqual([{ before: [], after: [A] }])

    browser.account.signOut()
    await one.sync.check()
    await two.sync.check()
    expect(one.changes.at(-1)).toEqual({ before: [A], after: [] })
    expect(two.changes.at(-1)).toEqual({ before: [A], after: [] })
  })

  test('a step that saw the list change under it keeps nothing, and the change\'s own step does the work', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A])
    const browser = world.browser({ account: 'alice' })
    let addOnRead = false
    const anime: ReturnType<typeof site> = site(browser, lib => ({
      ...lib,
      readFile: async (path) => {
        const text = await lib.readFile(path)
        if (addOnRead) {
          addOnRead = false
          void anime.sync.add(B)
        }
        return text
      },
    }))
    await anime.sync.check()
    anime.changes.length = 0

    addOnRead = true
    await anime.sync.check()
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([A, B])
    expect(anime.shown()).toEqual([A, B])
    expect(anime.changes, 'the source the viewer just added is never handed back as new').toEqual([])
  })

  test('a source removed while a step writes the list is never handed back', async () => {
    const world = fknWorld()
    holds(world, 'alice', [A, B])
    const browser = world.browser({ account: 'alice' })
    let removeOnWrite = false
    const anime: ReturnType<typeof site> = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (removeOnWrite) {
          removeOnWrite = false
          void anime.sync.remove(A)
        }
      },
    }))
    await anime.sync.check()
    anime.changes.length = 0

    removeOnWrite = true
    await anime.sync.add(C)
    await anime.sync.check()
    expect(listOf(world, 'alice')).toEqual([B, C])
    expect(anime.shown()).toEqual([B, C])
    expect(anime.changes).toEqual([])
  })

  // a source another site of the app removed from FKN: following that change again would ask FKN to
  // uninstall it, for every site, even after the viewer added it back on one of them
  test('a source forgotten leaves this device\'s own list only, and is never heard as a change', async () => {
    const world = fknWorld()
    const signedOut = world.browser()
    const anime = site(signedOut)
    await anime.sync.add(A)
    await anime.sync.add(B)
    await anime.sync.forget(A)
    await anime.sync.check()
    expect(anime.shown()).toEqual([B])
    expect(anime.changes).toEqual([])

    holds(world, 'alice', [C])
    const signedIn = world.browser({ account: 'alice' })
    const series = site(signedIn)
    await series.sync.check()
    series.changes.length = 0
    await series.sync.forget(C)
    await series.sync.check()
    expect(series.shown()).toEqual([C])
    expect(listOf(world, 'alice')).toEqual([C])
    expect(series.changes).toEqual([])
  })
})
