// The stub tracker's OPFS store over a fake @fkn/lib/opfs, one fresh module instance per worker. Two
// tabs a session restore opens together used to mint two device ids, and the tab whose device.json
// lost saved to a file nothing read again.
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { accountLink, journalStoreOver } from '../../../../src/tracking/account-link'
import { fknTrackerCloud } from '../../../../src/tracking/fkn-cloud'
import { identify } from '../../../../src/tracking/identity'
import { openJournal } from '../../../../src/tracking/journal'
import { fknWorld, mutex } from '../../tracking/fkn-fake'

const DEVICE = 'tracking/v1/device.json'

/** The origin's OPFS, which every worker of the origin shares. */
const disk = { files: new Map<string, string>(), unreadable: new Set<string>() }

/**
 * @fkn/lib/opfs as it behaves in one worker: a mirror of the disk of its own, loaded on first use and
 * again on `remount`, whose writes reach the disk only on `flush`. A remount only adds and refreshes
 * what the disk lists, never drops what it no longer does (lib/src/node-fs/store.ts `hydrate`, 0.9.36),
 * so a file another worker deleted stays in this worker's mirror.
 */
const fakeOpfs = () => {
  let mirror: Map<string, string> | undefined
  const dirty = new Set<string>()
  const mounted = () => (mirror ??= new Map(disk.files))
  return {
    remount: async () => {
      const current = mounted()
      for (const [path, text] of disk.files) if (!dirty.has(path)) current.set(path, text)
    },
    flush: async () => {
      for (const path of dirty) disk.files.set(path, mounted().get(path)!)
      dirty.clear()
    },
    promises: {
      readFile: async (path: string) => {
        if (disk.unreadable.has(path)) throw Object.assign(new Error(`storage: ${path} exists but could not be read`), { code: 'FKN_E2E_LOCKED' })
        const text = mounted().get(path)
        if (text === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return text
      },
      writeFile: async (path: string, text: string) => { mounted().set(path, text); dirty.add(path) },
      unlink: async (path: string) => {
        if (!mounted().delete(path)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        dirty.delete(path)
        disk.files.delete(path)
      },
      mkdir: async () => {},
    },
  }
}

/**
 * A worker: its own instance of the store module over its own mirror. `vi.doMock` after a reset,
 * because a hoisted `vi.mock` factory runs once and every worker would share one mirror.
 */
const worker = async () => {
  vi.resetModules()
  vi.doMock('@fkn/lib/opfs', fakeOpfs)
  const opfs = await import('@fkn/lib/opfs') as unknown as ReturnType<typeof fakeOpfs>
  const { opfsTrackerDisk } = await import('../../../../src/sources/stub/opfs-store')
  const tracker = opfsTrackerDisk()
  return { store: journalStoreOver(tracker), disk: tracker, opfs }
}

let now = 1_700_000_000_000
const deps = { now: () => (now += 1_000), uuid: () => crypto.randomUUID() }
const media = identify('ag:(anilist:1)')
if (media.kind !== 'catalogue') throw new Error('expected a catalogue identity')

// without Web Locks the store runs unlocked, so a lost lock would read as a race rather than as the missing API
beforeAll(() => {
  expect(globalThis.navigator?.locks, 'navigator.locks is missing: run the tests on the Node in .node-version (24+)').toBeDefined()
})

beforeEach(() => {
  disk.files.clear()
  disk.unreadable.clear()
})

test('the device id is minted once, written down, and kept across a reload', async () => {
  const { store } = await worker()
  const id = await store.device()

  expect(await store.device()).toBe(id)
  expect(JSON.parse(disk.files.get(DEVICE)!)).toEqual({ id, scope: 'device', uploaded: 0 })
  expect(await (await worker()).store.device(), 'a reload').toBe(id)
})

test('a device file written before the account link is this device\'s list, never an account\'s', async () => {
  disk.files.set(DEVICE, JSON.stringify({ id: 'from-0.0.39' }))

  expect(await (await worker()).disk.session()).toEqual({ id: 'from-0.0.39', scope: 'device', uploaded: 0 })
})

test('a device another tab starts is the one the next read and write go to', async () => {
  const a = await worker()
  const b = await worker()
  const first = await a.store.device()
  await b.store.write('the first device\'s list')

  await a.disk.setSession({ id: 'next', scope: 'account', uploaded: 0 })

  expect(await b.store.device()).toBe('next')
  expect(await b.store.read(), 'the new device starts with nothing').toBeUndefined()
  await b.store.write('the next device\'s list')
  expect(disk.files.get(`tracking/v1/devices/${first}.json`)).toBe('the first device\'s list')
  expect(disk.files.get('tracking/v1/devices/next.json')).toBe('the next device\'s list')
})

test('a removed file is gone from the disk, and removing it again is not an error', async () => {
  const { disk: tracker } = await worker()
  await tracker.write('on-this-device.json', 'kept')
  await tracker.remove('on-this-device.json')

  expect(disk.files.has('tracking/v1/on-this-device.json')).toBe(false)
  await expect(tracker.remove('on-this-device.json')).resolves.toBeUndefined()
})

test('two tabs starting together agree on one device id, and a reload finds what both saved', async () => {
  const a = await worker()
  const b = await worker()
  // both mirrors loaded before either tab mints, as they are once each worker has touched OPFS
  await Promise.all([a.opfs.remount(), b.opfs.remount()])

  const [first, second] = await Promise.all([openJournal(a.store, deps), openJournal(b.store, deps)])
  expect(first.device).toBe(second.device)

  await first.save(media, { progress: 3 })
  await second.save(media, { score: 80 })

  const reloaded = await openJournal((await worker()).store, deps)
  expect(reloaded.find(media)).toMatchObject({ state: 'LISTED', values: { progress: 3, score: 80 } })
})

test('a read sees what another tab wrote after this one loaded', async () => {
  const a = await worker()
  const b = await worker()
  await a.store.device()
  expect(await b.store.read()).toBeUndefined()

  await a.store.write('written by a')

  expect(await b.store.read()).toBe('written by a')
})

test('a write is on disk by the time it resolves', async () => {
  const { store } = await worker()
  await store.write('saved')

  expect(disk.files.get(`tracking/v1/devices/${await store.device()}.json`)).toBe('saved')
})

test('two tabs never run their read, merge and write at the same time', async () => {
  const a = await worker()
  const b = await worker()
  const log: string[] = []
  const work = (name: string) => async () => {
    log.push(`${name} in`)
    await new Promise(resolve => setTimeout(resolve, 10))
    log.push(`${name} out`)
  }

  await Promise.all([a.store.exclusive(work('a')), b.store.exclusive(work('b'))])

  expect(log).toEqual(['a in', 'a out', 'b in', 'b out'])
})

test('a device file that cannot be read fails the open rather than being replaced by a new id', async () => {
  const id = await (await worker()).store.device()
  disk.unreadable.add(DEVICE)
  const { store } = await worker()

  await expect(store.device()).rejects.toThrow('could not be read')
  expect(JSON.parse(disk.files.get(DEVICE)!), 'the id on disk is kept').toMatchObject({ id })

  disk.unreadable.clear()
  expect(await store.device(), 'and the next open tries again').toBe(id)
})

test('a list one tab added to the account is neither offered again nor restored at sign out by another', async () => {
  const world = fknWorld()
  const browser = world.browser()
  const lock = mutex()
  const tab = async () => {
    const { disk: tracker } = await worker()
    const journal = await openJournal(journalStoreOver(tracker), deps)
    const link = accountLink({ disk: tracker, journal, cloud: fknTrackerCloud(browser.lib, { timeoutMs: 20 }), lock, ...deps, uploadDelayMs: 60_000 })
    return { journal, link }
  }
  const a = await tab()
  const b = await tab()
  await a.journal.save(media, { progress: 2 })

  browser.account.signIn('alice')
  await a.link.accountChanged()
  await b.link.accountChanged()
  expect(b.link.status().held, 'both tabs offer the list kept before signing in').toBe(1)

  await a.link.addHeld()
  await b.link.focused()
  expect(b.link.status().held, 'added in the other tab').toBe(0)

  browser.account.signOut()
  await b.link.accountChanged()
  expect(b.journal.find(media).state, 'the added list went to the account, and left with it').toBe('NOT_LISTED')
})

// last, because when it fails the lock it waited on stays held and every later test would wait too
test('a first read under the journal\'s lock mints the device id instead of waiting on that lock', async () => {
  const { store } = await worker()
  const stuck = new Promise(resolve => setTimeout(() => resolve('still waiting'), 1_000))

  expect(await Promise.race([store.exclusive(() => store.read()), stuck])).toBeUndefined()
})
