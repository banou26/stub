// The stub tracker's OPFS store over a fake @fkn/lib/opfs, one fresh module instance per worker. Two
// tabs a session restore opens together used to mint two device ids, and the tab whose device.json
// lost saved to a file nothing read again.
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'

import { identify } from '../../../../src/tracking/identity'
import { openJournal } from '../../../../src/tracking/journal'

const DEVICE = 'tracking/v1/device.json'

/** The origin's OPFS, which every worker of the origin shares. */
const disk = { files: new Map<string, string>(), unreadable: new Set<string>() }

/**
 * @fkn/lib/opfs as it behaves in one worker: a mirror of the disk of its own, loaded on first use and
 * again on `remount`, whose writes reach the disk only on `flush`.
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
  const { opfsJournalStore } = await import('../../../../src/sources/stub/opfs-store')
  return { store: opfsJournalStore(), opfs }
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
  expect(JSON.parse(disk.files.get(DEVICE)!)).toEqual({ id })
  expect(await (await worker()).store.device(), 'a reload').toBe(id)
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
  expect(JSON.parse(disk.files.get(DEVICE)!), 'the id on disk is kept').toEqual({ id })

  disk.unreadable.clear()
  expect(await store.device(), 'and the next open tries again').toBe(id)
})

// last, because when it fails the lock it waited on stays held and every later test would wait too
test('a first read under the journal\'s lock mints the device id instead of waiting on that lock', async () => {
  const { store } = await worker()
  const stuck = new Promise(resolve => setTimeout(() => resolve('still waiting'), 1_000))

  expect(await Promise.race([store.exclusive(() => store.read()), stuck])).toBeUndefined()
})
