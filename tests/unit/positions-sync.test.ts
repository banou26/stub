// Where the viewer stopped in each episode, following their FKN account across stub's sites and devices:
// a file of its own, merged per source by the newest write. FKN is faked at @fkn/lib's surface
// (./tracking/fkn-fake.ts) and reached through the tracker's real adapter, as ./settings-sync.test.ts does.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import type { FknStorage } from '../../src/tracking/fkn-cloud'
import type { KeptPosition } from '../../src/utils/watch-positions'

import { POSITIONS_PACE_MS, POSITIONS_PATH, positionsSync } from '../../src/settings-sync'
import { ACCOUNT_POSITIONS_KEY, KEPT_POSITIONS, newestPosition, positionsStore, WATCH_POSITIONS_KEY as KEY } from '../../src/utils/watch-positions'
import { fknTrackerCloud } from '../../src/tracking/fkn-cloud'
import { fknWorld, mutex } from './tracking/fkn-fake'

type World = ReturnType<typeof fknWorld>
type Browser = ReturnType<World['browser']>

/** A tab of one of stub's sites in `browser`: the site's storage, which its tabs share, and the tab's own @fkn/lib realm. */
const site = (browser: Browser, { items = new Map<string, string>(), lock = mutex(), wrap = (lib: FknStorage) => lib } = {}) => {
  const realm = browser.realm()
  const store = positionsStore(() => ({
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }))
  const sync = positionsSync({ settings: store, cloud: fknTrackerCloud(wrap(realm.lib), { timeoutMs: 20 }), onAccountChange: realm.onChange, lock })
  // the player's save, sent at once as a pause sends it: the pace has a test of its own
  const save = async (...kept: KeptPosition[]) => {
    store.setItem(KEY, JSON.stringify(kept))
    store.flush()
    await sync.check()
  }
  const shown = (): KeptPosition[] => JSON.parse(store.getItem(KEY) ?? '[]')
  return { items, store, sync, save, shown }
}

const fileOf = (world: World, account: string): KeptPosition[] | undefined => {
  const file = world.storageOf(account).get(POSITIONS_PATH)
  return file && JSON.parse(JSON.parse(file.text)[KEY])
}
const holds = (world: World, account: string, kept: KeptPosition[]) =>
  world.storageOf(account).set(POSITIONS_PATH, { text: JSON.stringify({ [KEY]: JSON.stringify(kept) }), updatedAt: new Date(0).toISOString() })
// a step nothing awaits: one an account change queued, or one FKN not answering ends
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

afterEach(() => { vi.useRealTimers() })

describe('where you stopped, on the FKN account', () => {
  test('a point saved on one site resumes on another site and device signed in to the account', async () => {
    const world = fknWorld()
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    await anime.save(['nf:1', 600, 1400, 1_000])
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 600, 1400, 1_000]])

    const series = site(world.browser({ account: 'alice' }))
    expect(newestPosition(['cr:1', 'nf:1'], series.shown()), 'the control: nothing before its check').toBeUndefined()
    await series.sync.check()
    expect(newestPosition(['cr:1', 'nf:1'], series.shown())).toEqual(['nf:1', 600, 1400, 1_000])
  })

  test('the newer write of a source wins, whether it is this device\'s or the account\'s', async () => {
    const world = fknWorld()
    holds(world, 'alice', [['nf:1', 600, 1400, 2_000], ['cr:2', 300, 1200, 2_000]])
    const anime = site(world.browser({ account: 'alice' }))
    await anime.sync.check()
    await anime.save(['nf:1', 900, 1400, 3_000])
    expect(fileOf(world, 'alice'), 'this device\'s newer point').toEqual([['cr:2', 300, 1200, 2_000], ['nf:1', 900, 1400, 3_000]])

    // a phone saves cr:2 while FKN does not answer it, and the laptop saves it later
    const phone = world.browser({ account: 'alice' })
    const series = site(phone)
    await series.sync.check()
    phone.state.reachable = false
    series.store.setItem(KEY, JSON.stringify([['cr:2', 100, 1200, 2_500]]))
    await settle()
    expect(newestPosition(['cr:2'], series.shown()), 'shown at once').toEqual(['cr:2', 100, 1200, 2_500])
    await anime.save(['cr:2', 500, 1200, 4_000])
    phone.state.reachable = true
    await series.sync.check()
    expect(newestPosition(['cr:2'], series.shown()), 'the account\'s newer point').toEqual(['cr:2', 500, 1200, 4_000])
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 900, 1400, 3_000], ['cr:2', 500, 1200, 4_000]])
  })

  test('a source finished on one device leaves every other, and no merge brings its point back', async () => {
    const world = fknWorld()
    const anime = site(world.browser({ account: 'alice' }))
    await anime.save(['nf:1', 600, 1400, 1_000])
    const phone = world.browser({ account: 'alice' })
    const series = site(phone)
    await series.sync.check()
    expect(newestPosition(['nf:1'], series.shown()), 'the control: the point reached the phone').toEqual(['nf:1', 600, 1400, 1_000])

    // the phone, not answered, saves an older point while the laptop finishes the episode
    phone.state.reachable = false
    series.store.setItem(KEY, JSON.stringify([['nf:1', 700, 1400, 1_500]]))
    await settle()
    await anime.save(['nf:1', 2_000])
    phone.state.reachable = true
    await series.sync.check()
    expect(newestPosition(['nf:1'], series.shown())).toBeUndefined()

    // a browser signed out since before, holding its own older point, signs in
    const old = world.browser()
    const stale = site(old)
    await stale.save(['nf:1', 800, 1400, 1_800])
    old.account.signIn('alice')
    await stale.sync.check()
    expect(newestPosition(['nf:1'], stale.shown())).toBeUndefined()
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 2_000]])
  })

  test('two devices writing at once both keep their point: the one written over sends it again at its next check', async () => {
    const world = fknWorld()
    const laptopBrowser = world.browser({ account: 'alice' })
    const laptop = site(laptopBrowser)
    await laptop.sync.check()
    let laptopFirst = true
    const phone = site(world.browser({ account: 'alice' }), {
      wrap: lib => ({
        ...lib,
        writeFile: async (path, text) => {
          if (laptopFirst) { laptopFirst = false; await laptop.save(['nf:1', 600, 1400, 1_000]) }
          await lib.writeFile(path, text)
        },
      }),
    })
    await phone.save(['cr:2', 300, 1200, 2_000])
    expect(fileOf(world, 'alice'), 'the control: the phone wrote over the laptop').toEqual([['cr:2', 300, 1200, 2_000]])

    const both: KeptPosition[] = [['nf:1', 600, 1400, 1_000], ['cr:2', 300, 1200, 2_000]]
    await laptop.sync.check()
    expect(fileOf(world, 'alice')).toEqual(both)
    expect(laptop.shown()).toEqual(both)
    await phone.sync.check()
    expect(phone.shown()).toEqual(both)

    const reads = laptopBrowser.state.reads.length
    laptop.store.flush()
    await settle()
    expect(laptopBrowser.state.reads.length, 'the control: a flush reads the file').toBe(reads + 1)
    laptop.store.flush()
    await settle()
    expect(laptopBrowser.state.reads.length, 'once the file holds it, a flush has nothing to send').toBe(reads + 1)
  })

  test('the 200 newest points are kept after a merge, and as many finished sources beside them', async () => {
    const world = fknWorld()
    const points = (first: number) => Array.from({ length: KEPT_POSITIONS }, (_, index): KeptPosition => [`nf:${first + 2 * index}`, 100, 1400, first + 2 * index])
    const anime = site(world.browser({ account: 'alice' }))
    await anime.save(...points(0))
    const series = site(world.browser({ account: 'alice' }))
    await series.save(...points(1))
    const newest = Array.from({ length: KEPT_POSITIONS }, (_, index) => `nf:${KEPT_POSITIONS + index}`)
    expect(fileOf(world, 'alice')!.map(([uri]) => uri)).toEqual(newest)
    expect(series.shown().map(([uri]) => uri)).toEqual(newest)

    await anime.save(...Array.from({ length: KEPT_POSITIONS + 1 }, (_, index): KeptPosition => [`cr:${index}`, 1_000 + index]))
    const kept = fileOf(world, 'alice')!
    expect(kept.filter(entry => entry.length === 4).map(([uri]) => uri), 'the points stay').toEqual(newest)
    expect(kept.filter(entry => entry.length === 2).map(([uri]) => uri)).toEqual(Array.from({ length: KEPT_POSITIONS }, (_, index) => `cr:${index + 1}`))
  })

  test('signed out, the points stay in this browser and nothing reaches FKN; the first sign in merges them in, and a sign out takes the account\'s away', async () => {
    const world = fknWorld()
    holds(world, 'alice', [['cr:2', 300, 1200, 2_000]])
    const browser = world.browser()
    const anime = site(browser)
    await anime.save(['nf:1', 600, 1400, 1_000])
    expect(anime.items.get(KEY)).toBe(JSON.stringify([['nf:1', 600, 1400, 1_000]]))
    expect(browser.state.writes).toEqual([])

    browser.account.signIn('alice')
    await anime.sync.check()
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 600, 1400, 1_000], ['cr:2', 300, 1200, 2_000]])
    expect(anime.items.has(KEY), 'this browser\'s own leave').toBe(false)
    expect(anime.shown()).toEqual(fileOf(world, 'alice'))

    browser.account.signOut()
    await anime.sync.check()
    expect(anime.items.has(ACCOUNT_POSITIONS_KEY)).toBe(false)
    expect(anime.shown()).toEqual([])
  })

  test('a point saved while the first sign in\'s write is in flight is shown beside the account\'s, and written next', async () => {
    const world = fknWorld()
    holds(world, 'alice', [['cr:2', 300, 1200, 2_000]])
    const browser = world.browser()
    let saveOnWrite = false
    const anime = site(browser, {
      wrap: lib => ({
        ...lib,
        writeFile: async (path, text) => {
          await lib.writeFile(path, text)
          if (saveOnWrite) { saveOnWrite = false; anime.store.setItem(KEY, JSON.stringify([['nf:3', 400, 1400, 3_000]])) }
        },
      }),
    })
    await anime.save(['nf:1', 600, 1400, 1_000])
    saveOnWrite = true
    browser.account.signIn('alice')
    await anime.sync.check()
    const all: KeptPosition[] = [['nf:1', 600, 1400, 1_000], ['cr:2', 300, 1200, 2_000], ['nf:3', 400, 1400, 3_000]]
    expect(anime.shown()).toEqual(all)
    anime.store.flush()
    await anime.sync.check()
    expect(fileOf(world, 'alice')).toEqual(all)
  })

  test('another account never gets the first one\'s points, even after a switch no page of the site heard', async () => {
    const world = fknWorld()
    holds(world, 'alice', [['nf:1', 600, 1400, 1_000]])
    const browser = world.browser({ account: 'alice' })
    const shared = { items: new Map<string, string>(), lock: mutex() }
    const { items } = shared
    await site(browser, shared).sync.check()
    expect(items.has(ACCOUNT_POSITIONS_KEY), 'the control: alice\'s points are kept here').toBe(true)

    // switched on fkn.app with no tab of the site open; the next one plays before its first check
    browser.state.account = 'bob'
    const next = site(browser, shared)
    await next.save(['cr:2', 300, 1200, 2_000])
    expect(fileOf(world, 'bob')).toEqual([['cr:2', 300, 1200, 2_000]])
    expect(newestPosition(['nf:1'], next.shown())).toBeUndefined()

    browser.account.signIn('carol')
    await next.save(['cr:3', 300, 1200, 3_000])
    expect(fileOf(world, 'carol')).toEqual([['cr:3', 300, 1200, 3_000]])
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 600, 1400, 1_000]])
  })

  test('while playing, the account gets the points at most every 30 s, the last one included, and a flush sends them at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    const world = fknWorld()
    const browser = world.browser({ account: 'alice' })
    const anime = site(browser)
    await anime.sync.check()
    const writes = () => browser.state.writes.filter(write => write.path === POSITIONS_PATH).length
    const playedMs = 300_000
    for (let ms = 0; ms <= playedMs; ms += 5_000) {
      anime.store.setItem(KEY, JSON.stringify([['nf:1', 30 + ms / 1_000, 1400, Date.now()]]))
      await vi.advanceTimersByTimeAsync(5_000)
    }
    expect(writes()).toBeLessThanOrEqual(playedMs / POSITIONS_PACE_MS + 1)
    expect(writes(), 'the control: written while playing').toBeGreaterThanOrEqual(playedMs / POSITIONS_PACE_MS)
    await vi.advanceTimersByTimeAsync(POSITIONS_PACE_MS)
    expect(fileOf(world, 'alice')).toEqual([['nf:1', 330, 1400, expect.any(Number)]])

    anime.store.setItem(KEY, JSON.stringify([['nf:1', 335, 1400, Date.now()]]))
    await vi.advanceTimersByTimeAsync(1)
    expect(fileOf(world, 'alice')![0]![1], 'the control: paced').toBe(330)
    anime.store.flush()
    await vi.advanceTimersByTimeAsync(1)
    expect(fileOf(world, 'alice')![0]![1]).toBe(335)
  })
})
