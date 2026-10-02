// The stub tracker's list on the viewer's FKN account: devices that converge through per-device files,
// a tombstone that crosses devices, and the account and lock safety around them. FKN is faked at
// @fkn/lib's surface (./fkn-fake.ts) and reached through the real adapter, so what is pinned here is
// what the tracker does with the calls @fkn/lib offers.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'vitest'

import { accountLink, cloudPath, deviceFile, HELD_FILE, joinedPath, journalStoreOver, REFRESH_MS } from '../../../src/tracking/account-link'
import { fknTrackerCloud, PIN_UNSUPPORTED_TEXT, type FknStorage } from '../../../src/tracking/fkn-cloud'
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
 * (a new worker, so a new @fkn/lib realm, journal and link, over the same disk and the same lock).
 * `wrap` changes the @fkn/lib calls the tabs make.
 */
const device = async (world: World, options: Parameters<World['browser']>[0] = {}, wrap = (lib: FknStorage) => lib) => {
  const browser = world.browser(options)
  const disk = memoryDisk(uuid)
  const lock = mutex()
  const tab = async () => {
    const realm = browser.realm()
    const journal = await openJournal(journalStoreOver(disk), { now, uuid })
    // an upload waits for `idle()`, so a test decides what runs before it
    const link = accountLink({ disk, journal, cloud: fknTrackerCloud(wrap(realm.lib), { timeoutMs: 20 }), onAccountChange: realm.onChange, lock, now, uuid, uploadDelayMs: 60_000 })
    return { journal, link }
  }
  const first = await tab()
  return { browser, disk, lock, tab, ...first }
}

const valuesOf = (found: ReturnType<Awaited<ReturnType<typeof device>>['journal']['find']>) =>
  found.state === 'LISTED' ? found.values : found.state

describe('two devices on one account', () => {
  test('converge: each reads what the other wrote, and per field the later write wins', async () => {
    const world = fknWorld()
    const phone = await device(world, { account: 'alice' })
    const laptop = await device(world, { account: 'alice' })
    await phone.link.check()
    await laptop.link.check()

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
    await phone.link.check()
    await laptop.link.check()

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
    await laptop.link.check()
    await laptop.journal.save(FRIEREN, { progress: 1 })
    await laptop.link.idle()

    await phone.link.check()
    expect(phone.browser.state.reads, 'the first read of a new device list is at once').toEqual([cloudPath(laptop.journal.device)])
    expect(valuesOf(phone.journal.find(FRIEREN))).toEqual({ progress: 1 })

    await laptop.journal.save(FRIEREN, { progress: 2 })
    await laptop.link.idle()
    clock += REFRESH_MS - 1
    await phone.link.focused()
    await phone.link.check()
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
    for (const each of [phone, laptop, tablet]) await each.link.check()
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
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()
    // a second change, still waiting to go up when the account changes
    await shared.journal.save(DUNGEON, { progress: 8 })

    shared.browser.account.signIn('bob')
    await shared.link.check()
    await shared.link.idle()

    expect(world.entriesIn('bob'), 'bob\'s account holds nothing of alice\'s list').toEqual([])
    expect(shared.browser.state.writes.filter(write => write.account === 'bob').every(write => !JSON.parse(write.text).entries?.length)).toBe(true)
    expect(shared.journal.find(FRIEREN).state, 'nor does the device show it').toBe('NOT_LISTED')
    expect(shared.journal.find(DUNGEON).state).toBe('NOT_LISTED')
    expect([...shared.disk.files.values()].join(), 'and nothing of it is left on the device').not.toContain('"value":3')

    // the control: alice's list was hers all along, and is there when she comes back
    shared.browser.account.signIn('alice')
    await shared.link.check()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 3 })
  })

  test('a switch made while the page was closed is caught when it opens, before anything goes up', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    // the page closes with that change waiting, and bob signs in on FKN meanwhile
    shared.browser.state.account = 'bob'

    const reopened = await shared.tab()
    await reopened.link.check()
    await reopened.link.idle()

    expect(world.entriesIn('bob')).toEqual([])
    expect(reopened.journal.find(DUNGEON).state).toBe('NOT_LISTED')
  })

  // A switch FKN has not told this page about yet, at the key check right after the listing or as the
  // upload goes out, the latest moment there is. The upload carries the pin of the account the check
  // listed, so FKN refuses it before it asks for any key, and the notification that follows checks again.
  test.each([
    { moment: 'at the key check after the listing', call: 'encryption', locked: [] },
    { moment: 'as the upload goes out', call: 'writeFile', locked: [] },
    { moment: 'as the upload goes out, to an account whose key this device lacks', call: 'writeFile', locked: ['bob'] },
  ] as const)('one made $moment lands nothing in the other account', async ({ call, locked }) => {
    const world = fknWorld()
    let armed = false
    const switching = <A extends unknown[], R>(work: (...args: A) => Promise<R>) => (...args: A) => {
      if (armed) {
        armed = false
        shared.browser.state.account = 'bob'
      }
      return work(...args)
    }
    const shared = await device(world, { account: 'alice', locked: [...locked] }, lib => call === 'encryption'
      ? { ...lib, encryption: switching(lib.encryption) }
      : { ...lib, writeFile: switching(lib.writeFile) })
    await shared.link.check()
    const alicesDevice = shared.journal.device
    await shared.journal.save(FRIEREN, { status: 'WATCHING', progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    const alices = JSON.stringify([...world.storageOf('alice')])
    armed = true
    await shared.link.idle()
    expect(world.entriesIn('bob'), 'FKN refused the upload, as the account the check listed').toEqual([])
    expect(shared.browser.state.refused).toBe(1)
    expect(shared.link.status().error, 'which is no problem to show').toBeNull()

    shared.browser.account.notify()
    await shared.link.idle()
    expect(world.entriesIn('bob')).toEqual([])
    expect(shared.browser.state.cards, 'no card asked for a key').toBe(0)
    expect(JSON.stringify([...world.storageOf('alice')]), 'alice\'s account is as the switch found it').toBe(alices)
    expect(shared.journal.device, 'and the device leaves alice\'s list').not.toBe(alicesDevice)
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')

    // the control: alice's list is still hers, up to what reached her account before the switch
    shared.browser.account.signIn('alice')
    await shared.link.idle()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ status: 'WATCHING', progress: 3 })
    expect(shared.journal.find(DUNGEON).state).toBe('NOT_LISTED')
  })

  // FKN keeps a call in the account the page was on when it was made, and the page moves before its
  // listeners hear of the switch: a call this check made after hearing of it would land in bob's.
  test('one the page hears of mid-check ends that check, and the next one runs for the new account', async () => {
    const world = fknWorld()
    const bobsLaptop = await device(world, { account: 'bob' })
    await bobsLaptop.link.check()
    await bobsLaptop.journal.save(FRIEREN, { progress: 9 })
    await bobsLaptop.link.idle()

    let armed = false
    const shared = await device(world, { account: 'alice' }, lib => ({
      ...lib,
      // the key check, between the listing and the upload
      encryption: () => {
        if (armed) {
          armed = false
          shared.browser.account.signIn('bob')
        }
        return lib.encryption()
      },
    }))
    await shared.link.check()
    await shared.journal.save(FRIEREN, { status: 'WATCHING', progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    const alices = JSON.stringify([...world.storageOf('alice')])
    armed = true
    await shared.link.idle()

    expect(shared.browser.state.writes.filter(write => write.account === 'bob').every(write => !JSON.parse(write.text).entries?.length), 'nothing of alice\'s list went to bob').toBe(true)
    expect(shared.browser.state.refused, 'no call was even made for FKN to refuse').toBe(0)
    expect(JSON.stringify([...world.storageOf('alice')])).toBe(alices)
    expect(valuesOf(shared.journal.find(FRIEREN)), 'the next check opened bob\'s list').toEqual({ progress: 9 })
    expect(shared.link.status()).toMatchObject({ where: 'account', signedIn: true, error: null })
  })

  test('one heard between the listing and the join writes no marker into the other account', async () => {
    const world = fknWorld()
    let armed = false
    let bobsAfterThatCheck: string[] | undefined
    const shared = await device(world, { account: 'alice' }, lib => ({
      ...lib,
      // the key check a join asks first
      encryption: () => {
        if (armed) {
          armed = false
          // next in line after the check running now, and before the one the switch queues
          void shared.lock(async () => { bobsAfterThatCheck = [...world.storageOf('bob').keys()] })
          shared.browser.account.signIn('bob')
        }
        return lib.encryption()
      },
    }))
    await shared.link.check()
    // the viewer took this device off alice's account elsewhere, so the next check joins again
    world.storageOf('alice').delete(joinedPath(shared.journal.device))
    armed = true
    await shared.link.check()
    await shared.link.idle()

    expect(bobsAfterThatCheck, 'the check that listed alice\'s account wrote nothing into bob\'s').toEqual([])
    expect([...world.storageOf('bob').keys()], 'the next one joined bob as a device of his').toEqual([joinedPath(shared.journal.device)])
    expect(shared.browser.state.refused).toBe(0)
  })

  test('a renewal of the same account\'s token, heard as the upload goes out, leaves that upload alone', async () => {
    const world = fknWorld()
    let armed = false
    const shared = await device(world, { account: 'alice' }, lib => ({
      ...lib,
      writeFile: (path, text) => {
        const writing = lib.writeFile(path, text)
        if (armed) {
          armed = false
          shared.browser.account.renew()
        }
        return writing
      },
    }))
    await shared.link.check()
    const alicesDevice = shared.journal.device
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()
    await shared.journal.save(DUNGEON, { progress: 8 })
    armed = true
    await shared.link.idle()

    const uploads = shared.browser.state.writes.filter(write => write.path === cloudPath(alicesDevice))
    expect(uploads.map(write => write.account), 'each change went up once, to alice').toEqual(['alice', 'alice'])
    expect(world.entriesIn('alice')).toHaveLength(2)
    expect(shared.browser.state.refused).toBe(0)
    expect(shared.journal.device, 'and the device is still hers').toBe(alicesDevice)
    expect(shared.link.status()).toMatchObject({ where: 'account', waiting: false, error: null })
  })

  test('is heard by the worker itself, with nothing from the page', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.account.signIn('bob')
    await shared.link.idle()

    expect(world.entriesIn('alice')).toHaveLength(1)
    expect(world.entriesIn('bob')).toEqual([])
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')
  })
})

describe('a broker older than the account pin', () => {
  test('gets nothing uploaded, and the viewer is told FKN has to update', async () => {
    const world = fknWorld()
    const fresh = await device(world, { account: 'alice', pins: false })
    await fresh.link.check()
    expect(fresh.link.status()).toMatchObject({ where: 'device', signedIn: true, error: PIN_UNSUPPORTED_TEXT })
    await fresh.journal.save(FRIEREN, { progress: 3 })
    await fresh.link.idle()
    await fresh.link.focused()
    expect(fresh.browser.state.writes, 'not even a join').toEqual([])
    expect(fresh.link.status().error).toBe(PIN_UNSUPPORTED_TEXT)
    expect(valuesOf(fresh.journal.find(FRIEREN)), 'the list keeps working on this device').toEqual({ progress: 3 })

    // a device that joined while the broker could pin, and then meets an older one
    const joined = await device(world, { account: 'alice' })
    await joined.link.check()
    await joined.journal.save(DUNGEON, { progress: 1 })
    await joined.link.idle()
    const alices = JSON.stringify([...world.storageOf('alice')])
    joined.browser.state.pins = false
    await joined.journal.save(DUNGEON, { progress: 2 })
    await joined.link.idle()
    expect(JSON.stringify([...world.storageOf('alice')])).toBe(alices)
    expect(joined.link.status()).toMatchObject({ where: 'account', waiting: true, error: PIN_UNSUPPORTED_TEXT })
  })
})

describe('signing out', () => {
  test('takes the account\'s list off the device, and nothing written after it goes up', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.check()
    const accountDevice = shared.journal.device
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.account.signOut()
    await shared.link.check()

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
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 3 })
    await shared.link.idle()

    shared.browser.state.reachable = false
    await shared.link.check()
    expect(shared.link.status()).toMatchObject({ where: 'account', signedIn: null })
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 3 })

    // the control: an answered sign out does clear it
    shared.browser.state.reachable = true
    shared.browser.account.signOut()
    await shared.link.check()
    expect(shared.journal.find(FRIEREN).state).toBe('NOT_LISTED')
  })
})

describe('a list kept while signed out', () => {
  test('is never uploaded, and reaches an account only when the viewer adds it', async () => {
    const world = fknWorld()
    const shared = await device(world)
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 2 })
    await shared.link.idle()
    await shared.link.focused()
    expect(shared.browser.state.writes, 'signed out, nothing goes anywhere').toEqual([])
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 2 })

    shared.browser.account.signIn('alice')
    await shared.link.check()
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
    await shared.link.check()
    await shared.journal.save(FRIEREN, { progress: 2 })

    shared.browser.account.signIn('alice')
    await shared.link.check()
    expect(shared.disk.files.has(HELD_FILE)).toBe(true)

    shared.browser.account.signOut()
    await shared.link.check()
    expect(valuesOf(shared.journal.find(FRIEREN))).toEqual({ progress: 2 })
    expect(shared.link.status()).toMatchObject({ where: 'device', held: 0 })
    expect(await shared.link.addHeld(), 'signed out there is no account to add it to').toContain('Sign in')
  })
})

describe('a locked account', () => {
  test('opens no card: nothing is read or written until the viewer unlocks it', async () => {
    const world = fknWorld()
    const other = await device(world, { account: 'alice' })
    await other.link.check()
    await other.journal.save(FRIEREN, { progress: 5 })
    await other.link.idle()

    const locked = await device(world, { account: 'alice', unlocked: false })
    await locked.link.check()
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
    await locked.link.check()
    expect(locked.browser.state.cards).toBe(1)
    expect(valuesOf(locked.journal.find(FRIEREN))).toEqual({ progress: 5 })
    expect(locked.link.status()).toMatchObject({ where: 'account', locked: false, held: 1 })
  })

  test('a key lost after the list was opened keeps changes waiting, and asks for nothing', async () => {
    const world = fknWorld()
    const shared = await device(world, { account: 'alice' })
    await shared.link.check()
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
