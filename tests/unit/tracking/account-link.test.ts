// The stub tracker's list on the viewer's FKN account: devices that converge through per-device files,
// a tombstone that crosses devices, and the account and lock safety around them. FKN is faked at
// @fkn/lib's surface (./fkn-fake.ts) and reached through the real adapter, so what is pinned here is
// what the tracker does with the calls @fkn/lib offers.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { accountLink, cloudPath, deviceFile, HELD_FILE, journalStoreOver, REFRESH_MS } from '../../../src/tracking/account-link'
import { watchTrackerAccount } from '../../../src/tracking/account-watch'
import { fknTrackerCloud, type FknStorage } from '../../../src/tracking/fkn-cloud'
import { identify, type MediaIdentity } from '../../../src/tracking/identity'
import { openJournal } from '../../../src/tracking/journal'
import { fknWorld, memoryDisk, mutex } from './fkn-fake'

const writable = (uri: string) => identify(uri) as Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>
const FRIEREN = writable('ag:(anilist:1)')
const DUNGEON = writable('ag:(anilist:2)')

let clock = 1_700_000_000_000
const now = () => clock
let minted = 0
const uuid = () => `id-${++minted}`

type World = ReturnType<typeof fknWorld>

/**
 * A device: one browser, its own disk, and a tab on it. `tab()` opens another tab of the same device
 * (a new worker, so a new journal and link, over the same disk and the same lock). `wrap` changes the
 * @fkn/lib calls the tabs make.
 */
const device = async (world: World, options: Parameters<World['browser']>[0] = {}, wrap = (lib: FknStorage) => lib) => {
  const browser = world.browser(options)
  const disk = memoryDisk(uuid)
  const lock = mutex()
  const tab = async () => {
    const journal = await openJournal(journalStoreOver(disk), { now, uuid })
    // an upload waits for `idle()`, so a test decides what runs before it
    const link = accountLink({ disk, journal, cloud: fknTrackerCloud(wrap(browser.lib), { timeoutMs: 20 }), lock, now, uuid, uploadDelayMs: 60_000 })
    return { journal, link }
  }
  const first = await tab()
  return { browser, disk, tab, ...first }
}

const valuesOf = (found: ReturnType<Awaited<ReturnType<typeof device>>['journal']['find']>) =>
  found.state === 'LISTED' ? found.values : found.state

describe('two devices on one account', () => {
  test('converge: each reads what the other wrote, and per field the later write wins', async () => {
    const world = fknWorld()
    const phone = await device(world, { account: 'alice' })
    const laptop = await device(world, { account: 'alice' })
    await phone.link.accountChanged()
    await laptop.link.accountChanged()

    await phone.journal.save(FRIEREN, { status: 'WATCHING', progress: 3 })
    await phone.link.idle()
    clock += 1_000
    await laptop.journal.save(DUNGEON, { progress: 1 })
    // the laptop has not read the phone's file yet, so this is an entry of its own for the same run
    await laptop.journal.save(FRIEREN, { score: 80 })
    await laptop.link.idle()

    clock += REFRESH_MS
    await phone.link.focused()
    await laptop.link.focused()
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ status: 'WATCHING', progress: 3, score: 80 })
    expect(valuesOf(laptop.journal.find(FRIEREN))).toEqual({ status: 'WATCHING', progress: 3, score: 80 })
    expect(valuesOf(phone.journal.find(DUNGEON))).toEqual({ progress: 1 })

    clock += 1_000
    await phone.journal.save(FRIEREN, { progress: 5 })
    await phone.link.idle()
    clock += 1_000
    await laptop.journal.save(FRIEREN, { progress: 7 })
    await laptop.link.idle()
    clock += REFRESH_MS
    await phone.link.focused()
    await laptop.link.focused()
    expect(valuesOf(phone.journal.find(FRIEREN))).toMatchObject({ progress: 7 })
    expect(valuesOf(laptop.journal.find(FRIEREN))).toMatchObject({ progress: 7 })
    expect([...world.storageOf('alice').keys()].filter(path => path.includes('/devices/')), 'one file per device, and each device writes only its own').toHaveLength(2)
  })

  test('a delete on one device takes the entry off the other, and a later write brings back only what it sets', async () => {
    const world = fknWorld()
    const phone = await device(world, { account: 'alice' })
    const laptop = await device(world, { account: 'alice' })
    await phone.link.accountChanged()
    await laptop.link.accountChanged()

    await phone.journal.save(FRIEREN, { status: 'WATCHING', progress: 3, score: 80 })
    await phone.link.idle()
    clock += REFRESH_MS
    await laptop.link.focused()
    expect(valuesOf(laptop.journal.find(FRIEREN))).toEqual({ status: 'WATCHING', progress: 3, score: 80 })

    clock += 1_000
    await laptop.journal.remove(FRIEREN)
    await laptop.link.idle()
    expect(laptop.journal.find(FRIEREN).state).toBe('NOT_LISTED')
    const laptopFile = JSON.parse(world.storageOf('alice').get(cloudPath(laptop.journal.device))!.text)
    expect(laptopFile.entries, 'the phone\'s entry, tombstoned in the laptop\'s own file').toMatchObject([{ deleted: { by: laptop.journal.device } }])

    clock += REFRESH_MS
    await phone.link.focused()
    expect(phone.journal.find(FRIEREN).state).toBe('NOT_LISTED')

    clock += 1_000
    await phone.journal.save(FRIEREN, { progress: 1 })
    await phone.link.idle()
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ progress: 1 })
    clock += REFRESH_MS
    await laptop.link.focused()
    expect(valuesOf(laptop.journal.find(FRIEREN))).toEqual({ progress: 1 })
  })
})

describe('reads of the other devices\' files', () => {
  test('are rate limited: at most once per refresh window, and only a file that changed', async () => {
    const world = fknWorld()
    const phone = await device(world, { account: 'alice' })
    const laptop = await device(world, { account: 'alice' })
    await laptop.link.accountChanged()
    await laptop.journal.save(FRIEREN, { progress: 1 })
    await laptop.link.idle()

    await phone.link.accountChanged()
    expect(phone.browser.state.reads, 'the first read of a new device list is at once').toEqual([cloudPath(laptop.journal.device)])
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ progress: 1 })

    await laptop.journal.save(FRIEREN, { progress: 2 })
    await laptop.link.idle()
    clock += REFRESH_MS - 1
    await phone.link.focused()
    await phone.link.accountChanged()
    expect(phone.browser.state.reads, 'inside the window: nothing read, whatever asked').toHaveLength(1)
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ progress: 1 })

    clock += 1
    await phone.link.focused()
    expect(phone.browser.state.reads, 'the window is over, and the file changed').toHaveLength(2)
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ progress: 2 })

    clock += REFRESH_MS
    await phone.link.focused()
    expect(phone.browser.state.reads, 'a file that did not change is not read again').toHaveLength(2)
  })
})

describe('a file no key opens any more', () => {
  test('is skipped until it changes, and the other devices\' files are still read', async () => {
    const world = fknWorld()
    const phone = await device(world, { account: 'alice' })
    const laptop = await device(world, { account: 'alice' })
    const tablet = await device(world, { account: 'alice' })
    for (const each of [phone, laptop, tablet]) await each.link.accountChanged()
    await laptop.journal.save(FRIEREN, { progress: 4 })
    await laptop.link.idle()
    await tablet.journal.save(DUNGEON, { progress: 9 })
    await tablet.link.idle()
    // the account's key was reset after the laptop's file was sealed
    world.retired.add(cloudPath(laptop.journal.device))

    clock += REFRESH_MS
    await phone.link.focused()
    expect(valuesOf(phone.journal.find(DUNGEON))).toEqual({ progress: 9 })
    expect(phone.link.status().error, 'nothing the viewer could act on').toBeNull()

    const reads = phone.browser.state.reads.length
    clock += REFRESH_MS
    await phone.link.focused()
    expect(phone.browser.state.reads, 'not read again while it has not changed').toHaveLength(reads)
  })
})

describe('an account switch', () => {
  test('never uploads the previous account\'s list, whether the account had it or it was still waiting', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.accountChanged()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()
    // a second change, still waiting to go up when the account changes
    await shared.journal.save(DUNGEON, { progress: 8 })

    shared.browser.account.signIn('bob')
    await shared.link.accountChanged()
    await shared.link.idle()

    expect(world.entriesIn('bob'), 'bob\'s account holds nothing of alice\'s list').toEqual([])
    expect(shared.browser.state.writes.filter(write => write.account === 'bob').every(write => !JSON.parse(write.text).entries?.length)).toBe(true)
    expect(shared.journal.find(FRIEREN).state, 'nor does the device show it').toBe('NOT_LISTED')
    expect(shared.journal.find(DUNGEON).state).toBe('NOT_LISTED')
    expect([...shared.disk.files.values()].join(), 'and nothing of it is left on the device').not.toContain('"value":3')

    // the control: alice's list was hers all along, and is there when she comes back
    shared.browser.account.signIn('alice')
    await shared.link.accountChanged()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 3 })
  })

  test('a switch made while the page was closed is caught when it opens, before anything goes up', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.accountChanged()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    // the page closes with that change waiting, and bob signs in on FKN meanwhile
    shared.browser.state.account = 'bob'

    const reopened = await shared.tab()
    await reopened.link.accountChanged()
    await reopened.link.idle()

    expect(world.entriesIn('bob')).toEqual([])
    expect(reopened.journal.find(DUNGEON).state).toBe('NOT_LISTED')
  })

  // Two moments for the switch: the key check right after the listing, and the write itself, the latest
  // there is, where no check stub makes can see it. The write lands in bob's account either way, since
  // only FKN could refuse it: what is pinned is that no device reads it and the device does not take
  // bob's account for alice's.
  test.each([
    { moment: 'at the key check after the listing', call: 'encryption' },
    { moment: 'as the upload goes out', call: 'writeFile' },
  ] as const)('one made $moment misfiles one file, which no device reads, and the device leaves that account', async ({ call }) => {
    const world = fknWorld()
    let armed = false
    const switching = <A extends unknown[], R>(work: (...args: A) => Promise<R>) => async (...args: A) => {
      if (armed) {
        armed = false
        shared.browser.state.account = 'bob'
      }
      return work(...args)
    }
    const shared = await device(world, { account: 'alice' }, lib => call === 'encryption'
      ? { ...lib, encryption: switching(lib.encryption) }
      : { ...lib, writeFile: switching(lib.writeFile) })
    await shared.link.accountChanged()
    const alicesDevice = shared.journal.device
    await shared.journal.save(FRIEREN, { status: 'WATCHING', progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    armed = true
    await shared.link.idle()
    expect(world.entriesIn('bob'), 'the switch did land the upload in bob\'s account').toHaveLength(2)

    const bobsLaptop = await device(world, { account: 'bob' })
    await bobsLaptop.link.accountChanged()
    expect(bobsLaptop.journal.find(FRIEREN).state, 'bob\'s other devices never read it').toBe('NOT_LISTED')
    expect(bobsLaptop.journal.find(DUNGEON).state).toBe('NOT_LISTED')

    clock += REFRESH_MS
    await shared.link.accountChanged()
    expect(shared.journal.device, 'the next check forgets bob\'s account as alice\'s').not.toBe(alicesDevice)
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')
    await shared.journal.save(FRIEREN, { progress: 4 })
    await shared.link.idle()
    expect(shared.browser.state.writes.filter(write => write.account === 'bob' && write.path === cloudPath(alicesDevice)), 'and uploads nothing more as alice\'s device').toHaveLength(1)

    clock += REFRESH_MS
    await bobsLaptop.link.focused()
    expect(valuesOf(bobsLaptop.journal.find(FRIEREN)), 'bob\'s list holds only what was written as bob\'s').toEqual({ progress: 4 })
    expect(bobsLaptop.journal.find(DUNGEON).state).toBe('NOT_LISTED')

    // the control: alice's list is still hers, up to what reached her account before the switch
    shared.browser.account.signIn('alice')
    await shared.link.accountChanged()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ status: 'WATCHING', progress: 3 })
    expect(shared.journal.find(DUNGEON).state).toBe('NOT_LISTED')
  })

  test('is delivered by account.onChange to every open page', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    let running: Promise<unknown> = Promise.resolve()
    const page = { addEventListener: () => {} }
    const stop = watchTrackerAccount({
      onChange: shared.browser.account.onChange,
      accountChanged: () => (running = shared.link.accountChanged()),
      focused: () => (running = shared.link.focused()),
      page,
      document: { addEventListener: () => {}, visibilityState: 'visible' },
      intervalMs: 1e9,
    })
    await running
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.account.signIn('bob')
    await running
    await shared.link.idle()
    stop()

    expect(world.entriesIn('alice')).toHaveLength(1)
    expect(world.entriesIn('bob')).toEqual([])
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')
  })
})

describe('signing out', () => {
  test('takes the account\'s list off the device, and nothing written after it goes up', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.accountChanged()
    const accountDevice = shared.journal.device
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.account.signOut()
    await shared.link.accountChanged()

    expect(shared.link.status()).toMatchObject({ where: 'device', signedIn: false })
    expect(shared.disk.files.has(deviceFile(accountDevice))).toBe(false)
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')

    const before = shared.browser.state.writes.length
    await shared.journal.save(DUNGEON, { progress: 1 })
    await shared.link.idle()
    await shared.link.focused()
    expect(shared.browser.state.writes).toHaveLength(before)
    expect(valuesOf(shared.journal.find(DUNGEON)), 'the tracker keeps working on this device').toEqual({ progress: 1 })
  })

  test('an answer that could not be had is not a sign out: nothing is cleared', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.accountChanged()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.state.reachable = false
    await shared.link.accountChanged()
    expect(shared.link.status()).toMatchObject({ where: 'account', signedIn: null })
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 3 })

    // the control: an answered sign out does clear it
    shared.browser.state.reachable = true
    shared.browser.account.signOut()
    await shared.link.accountChanged()
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')
  })
})

describe('a list kept while signed out', () => {
  test('is never uploaded, and reaches an account only when the viewer adds it', async () => {
    const world = fknWorld()
    const shared = await device(world)
    await shared.link.accountChanged()
    await shared.journal.save(FRIEREN, { progress: 2 })
    await shared.link.idle()
    await shared.link.focused()
    expect(shared.browser.state.writes, 'signed out, nothing goes anywhere').toEqual([])
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 2 })

    shared.browser.account.signIn('alice')
    await shared.link.accountChanged()
    await shared.link.idle()
    expect(world.entriesIn('alice'), 'signing in uploads none of it').toEqual([])
    expect(shared.link.status()).toMatchObject({ where: 'account', held: 1 })
    expect(shared.journal.find(FRIEREN).state, 'the account\'s list is the one shown').toBe('NOT_LISTED')

    expect(await shared.link.addHeld()).toBeUndefined()
    await shared.link.idle()
    expect(world.entriesIn('alice')).toHaveLength(1)
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 2 })
    expect(shared.link.status().held).toBe(0)
  })

  test('comes back as the device\'s list at sign out when the viewer never added it', async () => {
    const world = fknWorld()
    const shared = await device(world)
    await shared.link.accountChanged()
    await shared.journal.save(FRIEREN, { progress: 2 })

    shared.browser.account.signIn('alice')
    await shared.link.accountChanged()
    expect(shared.disk.files.has(HELD_FILE)).toBe(true)

    shared.browser.account.signOut()
    await shared.link.accountChanged()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 2 })
    expect(shared.link.status()).toMatchObject({ where: 'device', held: 0 })
    expect(await shared.link.addHeld(), 'signed out there is no account to add it to').toContain('Sign in')
  })
})

describe('a locked account', () => {
  test('opens no card: nothing is read or written until the viewer unlocks it', async () => {
    const world = fknWorld()
    const other = await device(world, { account: 'alice' })
    await other.link.accountChanged()
    await other.journal.save(FRIEREN, { progress: 5 })
    await other.link.idle()

    const locked = await device(world, { account: 'alice', unlocked: false })
    await locked.link.accountChanged()
    await locked.journal.save(DUNGEON, { progress: 1 })
    await locked.link.idle()
    clock += REFRESH_MS
    await locked.link.focused()

    expect(locked.browser.state.cards, 'no card without a click').toBe(0)
    expect(locked.browser.state.reads).toEqual([])
    expect(locked.browser.state.writes).toEqual([])
    expect(locked.link.status()).toMatchObject({ where: 'device', signedIn: true, locked: true })
    expect(valuesOf(locked.journal.find(DUNGEON)), 'it keeps working on this device meanwhile').toEqual({ progress: 1 })

    // the viewer's click: the one card, and then the account's list
    await locked.browser.account.unlock()
    await locked.link.accountChanged()
    expect(locked.browser.state.cards).toBe(1)
    expect(valuesOf(locked.journal.find(FRIEREN))).toEqual({ progress: 5 })
    expect(locked.link.status()).toMatchObject({ where: 'account', locked: false, held: 1 })
  })

  test('a key lost after the list was opened keeps changes waiting, and asks for nothing', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.accountChanged()
    shared.browser.state.unlocked = false

    await shared.journal.save(FRIEREN, { progress: 4 })
    await shared.link.idle()
    clock += REFRESH_MS
    await shared.link.focused()

    expect(shared.browser.state.cards).toBe(0)
    expect(shared.link.status()).toMatchObject({ where: 'account', locked: true, waiting: true })
    expect(world.entriesIn('alice')).toEqual([])
  })
})

describe('the tracker\'s storage', () => {
  // The hybrid fs queues uploads in localStorage for whichever account is signed in when it drains,
  // and offers local files for adoption in words that name no list: either path would move one
  // account's list into another without this module's check.
  test('never goes through the hybrid @fkn/lib/fs', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? (name === 'generated' ? [] : walk(path)) : [path]
    })
    const importsHybrid = /(?:from\s+|import\s*\(?\s*)['"]@fkn\/lib\/fs(?:\/promises)?['"]/
    const offenders = walk(join(import.meta.dirname, '../../../src'))
      .filter(path => /\.tsx?$/.test(path) && importsHybrid.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
    expect(importsHybrid.test('import fs from \'@fkn/lib/fs\''), 'the control: the pattern sees an import').toBe(true)
    expect(importsHybrid.test('import \'@fkn/lib/fs/promises\'')).toBe(true)
    expect(importsHybrid.test('await import(\'@fkn/lib/fs\')')).toBe(true)
    expect(importsHybrid.test('import { promises } from \'@fkn/lib/cloud/fs\'')).toBe(false)
  })
})
