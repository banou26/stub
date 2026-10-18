// The settings following the viewer's FKN account across stub's sites and devices. FKN is faked at
// @fkn/lib's surface (./tracking/fkn-fake.ts) and reached through the tracker's real adapter, as
// ./plugin-sync.test.ts does.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { FknStorage } from '../../src/tracking/fkn-cloud'

import { SETTINGS_KEYS, SETTINGS_PATH, settingsSync } from '../../src/settings-sync'
import { ACCOUNT_SETTINGS_KEY, createSettings, settings as pageSettings } from '../../src/settings-store'
import { DISABLED_SOURCES_KEY as OFF, readDisabledSources, watchDisabledSources } from '../../src/sources/disabled-sources'
import { HIDDEN_ICONS_KEY as ICONS, readHiddenIcons } from '../../src/sources/hidden-icons'
import { PLAY_ORDER_KEY as PLAY, readPlayOrder } from '../../src/sources/play-order'
import { AUTOPLAY_KEY as AUTOPLAY, readAutoplay, watchAutoplay } from '../../src/utils/autoplay'
import { PLAYER_VOLUME_KEY as VOLUME } from '../../src/utils/player-volume'
import { COUNTRY_KEY as COUNTRY, readPickedCountry } from '../../src/sources/country'
import { DISPLAY_MODE_KEY, readDisplayMode } from '../../src/router/search/display'
import { COMPACT_PREFS_KEY, viewerPrefs } from '../../src/tracking/compact-prefs'
import { fknTrackerCloud } from '../../src/tracking/fkn-cloud'
import { fknWorld, mutex } from './tracking/fkn-fake'

type World = ReturnType<typeof fknWorld>
type Browser = ReturnType<World['browser']>

const memoryStorage = () => {
  const items = new Map<string, string>()
  return {
    items,
    storage: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
      removeItem: (key: string) => { items.delete(key) },
    },
  }
}

/** A tab of one of stub's sites in `browser`: the site's storage and lock, which its tabs share, and the tab's own @fkn/lib realm. */
const tab = (browser: Browser, shared = { ...memoryStorage(), lock: mutex() }, wrap = (lib: FknStorage) => lib) => {
  const realm = browser.realm()
  const settings = createSettings(() => shared.storage)
  const heard: string[] = []
  for (const key of SETTINGS_KEYS) settings.watch(key, () => heard.push(key))
  const sync = settingsSync({ settings, cloud: fknTrackerCloud(wrap(realm.lib), { timeoutMs: 20 }), onAccountChange: realm.onChange, lock: shared.lock })
  // a write queues a step; the test waits for it, which the page never has to
  const set = async (key: string, value: string | null) => {
    if (value === null) settings.removeItem(key)
    else settings.setItem(key, value)
    await sync.check()
  }
  return { items: shared.items, settings, sync, set, heard }
}

/** One of stub's sites open in `browser`, in one tab. */
const site = (browser: Browser, wrap?: (lib: FknStorage) => FknStorage) => tab(browser, undefined, wrap)

const fileOf = (world: World, account: string): unknown => {
  const file = world.storageOf(account).get(SETTINGS_PATH)
  return file && JSON.parse(file.text)
}
const holds = (world: World, account: string, values: Record<string, string | null>) =>
  world.storageOf(account).set(SETTINGS_PATH, { text: JSON.stringify(values), updatedAt: new Date(0).toISOString() })
// the step an account change queues, which nothing awaits
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

describe('settings on the FKN account', () => {
  test('a source turned off on one site is off on every other site and device signed in to the account', async () => {
    const world = fknWorld()
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    await anime.set(OFF, '["simkl"]')
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["simkl"]' })

    const series = site(world.browser({ account: 'alice' }))
    expect(series.settings.getItem(OFF)).toBe(null)
    await series.sync.check()
    expect(series.settings.getItem(OFF)).toBe('["simkl"]')
    expect(series.heard).toEqual([OFF])
  })

  test('first sign in: this browser fills what the account never set, the account wins the rest, and this browser\'s own leave', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [COUNTRY]: 'JP' })
    const browser = world.browser()
    const anime = site(browser)
    await anime.set(COUNTRY, 'GB')
    await anime.set(AUTOPLAY, 'off')
    expect(browser.state.writes).toEqual([])

    browser.account.signIn('alice')
    await anime.sync.check()
    expect(fileOf(world, 'alice')).toEqual({ [COUNTRY]: 'JP', [AUTOPLAY]: 'off' })
    expect(anime.settings.getItem(COUNTRY)).toBe('JP')
    expect(anime.items.has(COUNTRY)).toBe(false)
    expect(anime.items.has(AUTOPLAY)).toBe(false)

    browser.account.signOut()
    await anime.sync.check()
    expect(anime.items.has(ACCOUNT_SETTINGS_KEY), 'the account\'s copy leaves at sign out').toBe(false)
    expect(anime.settings.getItem(COUNTRY), 'back to the default').toBe(null)
    expect(anime.settings.getItem(AUTOPLAY)).toBe(null)
  })

  // the play order is one value too: two orders combined would rank sources neither device put there
  test('at the first sign in the switch lists combine, while a single value keeps the account\'s', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["trakt","simkl"]', [ICONS]: null, [AUTOPLAY]: null, [PLAY]: '["nf","cr"]' })
    const browser = world.browser()
    const anime = site(browser)
    await anime.set(OFF, '["simkl","anilist"]')
    await anime.set(ICONS, '["nf"]')
    await anime.set(AUTOPLAY, 'off')
    await anime.set(PLAY, '["nyaa"]')
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["trakt","simkl","anilist"]', [ICONS]: '["nf"]', [AUTOPLAY]: null, [PLAY]: '["nf","cr"]' })
    expect(anime.settings.getItem(OFF)).toBe('["trakt","simkl","anilist"]')
    expect(anime.items.has(PLAY), 'this browser\'s own order leaves').toBe(false)
  })

  test('a value set back to its default on one device overrules the other device\'s own value', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [AUTOPLAY]: null })
    const browser = world.browser()
    const anime = site(browser)
    await anime.set(AUTOPLAY, 'off')
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(anime.settings.getItem(AUTOPLAY)).toBe(null)
    expect(fileOf(world, 'alice')).toEqual({ [AUTOPLAY]: null })
  })

  test('another device\'s change reaches an open page at its next check, and tells its watchers', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [ICONS]: '["nf"]' })
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    expect(anime.heard).toEqual([ICONS])
    holds(world, 'alice', { [ICONS]: '[]' })
    await anime.sync.check()
    expect(anime.settings.getItem(ICONS)).toBe('[]')
    expect(anime.heard).toEqual([ICONS, ICONS])
  })

  test('FKN not answering, refusing the read, or no key here moves nothing and raises no card', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    let refuse = false
    const anime = site(browser, lib => ({ ...lib, readFile: async path => { if (refuse) throw new Error('storage: the request failed'); return lib.readFile(path) } }))
    await anime.sync.check()
    browser.state.reachable = false
    await anime.sync.check()
    expect(anime.settings.getItem(OFF)).toBe('["simkl"]')
    browser.state.reachable = true
    refuse = true
    await anime.sync.check()
    expect(anime.settings.getItem(OFF), 'a refused read is never the defaults').toBe('["simkl"]')

    const locked = world.browser({ account: 'alice', unlocked: false })
    const series = site(locked)
    await series.set(OFF, '["trakt"]')
    expect(locked.state.cards).toBe(0)
    expect(locked.state.writes).toEqual([])
    expect(series.settings.getItem(OFF), 'this browser\'s own while locked').toBe('["trakt"]')
  })

  test('a change made while FKN does not answer is written once it answers, not overwritten by the account\'s older value', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    browser.state.reachable = false
    await anime.set(OFF, '[]')
    expect(anime.settings.getItem(OFF), 'shown at once').toBe('[]')
    browser.state.reachable = true
    await anime.sync.check()
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '[]' })
    expect(anime.settings.getItem(OFF)).toBe('[]')
    holds(world, 'alice', { [OFF]: '["trakt"]' })
    await anime.sync.check()
    expect(anime.settings.getItem(OFF), 'once written, the edit gives way to the next device\'s').toBe('["trakt"]')
  })

  test('a renewal of the same account\'s connection keeps a change FKN has not taken yet', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    browser.state.reachable = false
    await anime.set(OFF, '[]')
    browser.state.reachable = true
    browser.account.renew()
    await settle()
    await anime.sync.check()
    expect(anime.settings.getItem(OFF)).toBe('[]')
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '[]' })
  })

  test('a sign in heard late never lets a value set while signed out overrule the account\'s', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [COUNTRY]: 'JP' })
    const browser = world.browser()
    const anime = site(browser)
    await anime.set(COUNTRY, 'GB')
    browser.state.account = 'alice'
    await anime.sync.check()
    browser.account.notify()
    await settle()
    await anime.sync.check()
    expect(anime.settings.getItem(COUNTRY)).toBe('JP')
    expect(fileOf(world, 'alice')).toEqual({ [COUNTRY]: 'JP' })
  })

  test('a sign out reaches an open page without a check, and the account\'s settings leave it', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    expect(anime.settings.getItem(OFF), 'the control: the account\'s while signed in').toBe('["simkl"]')
    browser.account.signOut()
    await settle()
    expect(anime.items.has(ACCOUNT_SETTINGS_KEY)).toBe(false)
    expect(anime.settings.getItem(OFF)).toBe(null)
  })

  test('a switch to another account never writes the first account\'s settings into it', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]', [ICONS]: '["nf"]' })
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    browser.account.signIn('bob')
    await anime.sync.check()
    expect(fileOf(world, 'bob')).toBeUndefined()
    expect(anime.settings.getItem(OFF), 'bob\'s settings, the defaults').toBe(null)
    expect(browser.state.writes.filter(write => write.account === 'bob')).toEqual([])
  })

  test('a setting that stays on the device is never in the file', async () => {
    const world = fknWorld()
    const anime = site(world.browser({ account: 'alice' }))
    anime.items.set(VOLUME, '{"volume":0.2,"muted":false}')
    await anime.set(OFF, '["simkl"]')
    expect(Object.keys(fileOf(world, 'alice') as object)).toEqual([OFF])
    expect(anime.items.get(VOLUME)).toBe('{"volume":0.2,"muted":false}')
    await anime.set(VOLUME, '{"volume":0.5,"muted":true}')
    await anime.set(AUTOPLAY, 'off')
    expect(Object.keys(fileOf(world, 'alice') as object), 'not even written through the settings').toEqual([OFF, AUTOPLAY])
    expect(SETTINGS_KEYS).not.toContain(VOLUME)
  })

  test('an edit FKN never took leaves at sign out and never reaches the next account', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    browser.state.reachable = false
    await anime.set(ICONS, '["nf"]')
    browser.state.reachable = true
    browser.account.signOut()
    await anime.sync.check()
    browser.account.signIn('bob')
    await anime.sync.check()
    expect(fileOf(world, 'bob')).toBeUndefined()
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["simkl"]' })
  })

  test('a switch heard while one account\'s file is read never shows its settings for the next account', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice', locked: ['bob'] })
    let switchOnRead = true
    const anime = site(browser, lib => ({
      ...lib,
      readFile: async path => {
        const text = await lib.readFile(path)
        if (switchOnRead) { switchOnRead = false; browser.account.signIn('bob') }
        return text
      },
    }))
    await anime.sync.check()
    await anime.sync.check()
    expect(anime.settings.getItem(OFF)).toBe(null)
    expect(anime.heard).toEqual([])
  })

  test('ten edits in a row leave at most one step waiting behind the running one', async () => {
    const world = fknWorld()
    holds(world, 'alice', {})
    const browser = world.browser({ account: 'alice' })
    let open = () => {}
    const gate = new Promise<void>(resolve => { open = resolve })
    const anime = site(browser, lib => ({ ...lib, readFile: async path => { await gate; return lib.readFile(path) } }))
    const first = anime.sync.check()
    await new Promise(resolve => setTimeout(resolve, 0))
    for (let index = 0; index < 10; index++) anime.settings.setItem(OFF, JSON.stringify([`s${index}`]))
    open()
    await first
    await anime.sync.check()
    expect(browser.state.reads.length).toBeLessThanOrEqual(3)
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["s9"]' })
  })

  test('an edit made while the first sign in\'s write is in flight is kept, even over a value the account set', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [AUTOPLAY]: null })
    const browser = world.browser()
    let editOnWrite = false
    const anime = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (editOnWrite) { editOnWrite = false; anime.settings.setItem(AUTOPLAY, 'off') }
      },
    }))
    await anime.set(OFF, '["simkl"]')
    editOnWrite = true
    browser.account.signIn('alice')
    await anime.sync.check()
    expect(anime.settings.getItem(AUTOPLAY), 'shown at once, before its own step').toBe('off')
    await anime.sync.check()
    expect(anime.settings.getItem(AUTOPLAY)).toBe('off')
    expect(fileOf(world, 'alice')).toEqual({ [AUTOPLAY]: 'off', [OFF]: '["simkl"]' })
    expect(anime.items.has(AUTOPLAY)).toBe(false)
  })

  test('the same setting changed again while its first write is in flight keeps the second value', async () => {
    const world = fknWorld()
    holds(world, 'alice', {})
    const browser = world.browser({ account: 'alice' })
    let editOnWrite = false
    const anime = site(browser, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (editOnWrite) { editOnWrite = false; anime.settings.setItem(COUNTRY, 'GB') }
      },
    }))
    await anime.sync.check()
    editOnWrite = true
    await anime.set(COUNTRY, 'JP')
    await anime.sync.check()
    expect(anime.settings.getItem(COUNTRY)).toBe('GB')
    expect(fileOf(world, 'alice')).toEqual({ [COUNTRY]: 'GB' })
  })

  test('another tab\'s edit made during a step is never shown reverted, and is written', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const shared = { ...memoryStorage(), lock: mutex() }
    let editOnRead = false
    const first = tab(browser, shared, lib => ({
      ...lib,
      readFile: async path => {
        const text = await lib.readFile(path)
        if (editOnRead) { editOnRead = false; other.settings.setItem(ICONS, '["nf"]') }
        return text
      },
    }))
    const other = tab(browser, shared)
    await first.sync.check()
    editOnRead = true
    await first.sync.check()
    expect(other.settings.getItem(ICONS), 'still shown after the step').toBe('["nf"]')
    await other.sync.check()
    expect(other.settings.getItem(ICONS)).toBe('["nf"]')
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["simkl"]', [ICONS]: '["nf"]' })
  })

  test('another tab\'s edit made during the first sign in\'s write is never shown reverted, and is written', async () => {
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]' })
    const browser = world.browser({ account: 'alice' })
    const shared = { ...memoryStorage(), lock: mutex() }
    shared.items.set(COUNTRY, 'GB')
    let editOnWrite = true
    const first = tab(browser, shared, lib => ({
      ...lib,
      writeFile: async (path, text) => {
        await lib.writeFile(path, text)
        if (editOnWrite) { editOnWrite = false; other.settings.setItem(AUTOPLAY, 'off') }
      },
    }))
    const other = tab(browser, shared)
    await first.sync.check()
    expect(other.settings.getItem(AUTOPLAY), 'still shown after the first step').toBe('off')
    await other.sync.check()
    expect(other.settings.getItem(AUTOPLAY)).toBe('off')
    expect(fileOf(world, 'alice')).toEqual({ [OFF]: '["simkl"]', [COUNTRY]: 'GB', [AUTOPLAY]: 'off' })
  })
})

describe('the page\'s settings', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  test('every setting\'s module reads the account\'s value once a sync step applied it', async () => {
    const { storage } = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const world = fknWorld()
    holds(world, 'alice', {
      [OFF]: '["simkl"]', [ICONS]: '["nf"]', [COUNTRY]: 'JP', [AUTOPLAY]: 'off',
      [DISPLAY_MODE_KEY]: 'list', [COMPACT_PREFS_KEY]: '{"targets":{"anilist":false}}', [PLAY]: '["nyaa","cr"]',
    })
    const realm = world.browser({ account: 'alice' }).realm()
    const sync = settingsSync({ settings: pageSettings, cloud: fknTrackerCloud(realm.lib, { timeoutMs: 20 }), onAccountChange: realm.onChange, lock: mutex() })
    await sync.check()
    expect(storage.getItem(OFF), 'the control: nothing of this browser\'s own').toBe(null)
    expect({
      sources: readDisabledSources(), icons: readHiddenIcons(), country: readPickedCountry(), autoplay: readAutoplay(),
      layout: readDisplayMode(), prefs: viewerPrefs.read(), order: readPlayOrder(),
    }).toEqual({ sources: ['simkl'], icons: ['nf'], country: 'JP', autoplay: false, layout: 'list', prefs: { targets: { anilist: false } }, order: ['nyaa', 'cr'] })
  })

  test('the worker\'s watcher and the Autoplay switch\'s hear a change a sync step applied', async () => {
    const { storage } = memoryStorage()
    vi.stubGlobal('localStorage', storage)
    const world = fknWorld()
    holds(world, 'alice', { [OFF]: '["simkl"]', [AUTOPLAY]: 'off' })
    const realm = world.browser({ account: 'alice' }).realm()
    const sync = settingsSync({ settings: pageSettings, cloud: fknTrackerCloud(realm.lib, { timeoutMs: 20 }), onAccountChange: realm.onChange, lock: mutex() })
    const sources = vi.fn()
    const autoplay = vi.fn()
    watchDisabledSources(sources)
    watchAutoplay(autoplay)
    await sync.check()
    expect(sources).toHaveBeenCalledTimes(1)
    expect(readDisabledSources()).toEqual(['simkl'])
    expect(autoplay).toHaveBeenCalledTimes(1)
    expect(readAutoplay()).toBe(false)
  })
})
