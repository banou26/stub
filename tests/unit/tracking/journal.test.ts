// The stub tracker's journal: per field stamps from a hybrid logical clock, tombstones that clear what
// they follow, and a read, merge and write that never loses what another tab wrote.
import { describe, expect, test } from 'vitest'

import {
  combine,
  mergeEntries,
  mergeFiles,
  openJournal,
  patchFrom,
  tick,
  type JournalEntry,
  type JournalFile,
} from '../../../src/tracking/journal'
import { identify, type MediaIdentity } from '../../../src/tracking/identity'
import { memoryStore } from './memory-store'

const clock = (...times: number[]) => {
  let index = 0
  return () => times[Math.min(index++, times.length - 1)]!
}

let minted = 0
const uuid = () => `entry-${++minted}`

const writable = (uri: string) => identify(uri) as Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>
const MEDIA = writable('ag:(anilist:1)')

describe('the hybrid logical clock', () => {
  test('never goes back, and never repeats a stamp it has seen', () => {
    expect(tick(1_000, 2_000)).toBe(2_000)
    expect(tick(1_000, 500), 'a clock running behind still moves forward').toBe(1_001)
    expect(tick(1_000, 1_000)).toBe(1_001)
  })

  test('a tab whose clock runs behind still writes AFTER what it read, so its write survives the next merge', async () => {
    const store = memoryStore()
    const ahead = await openJournal(store, { now: clock(10_000), uuid })
    const behind = await openJournal(store, { now: clock(5_000), uuid })

    await ahead.save(MEDIA, { progress: 3 })
    // `behind` opened before that write, so it learns of it only by merging the file on its own write
    await behind.save(MEDIA, { progress: 5 })
    // and `ahead`, which still remembers progress 3 at 10 000, merges `behind`'s file on its next write
    await ahead.save(MEDIA, { score: 80 })

    const found = ahead.find(MEDIA)
    expect(found.state).toBe('LISTED')
    expect(found.state === 'LISTED' && found.values.progress, 'the later write, whatever the wall clock said').toBe(5)
  })
})

describe('tombstones', () => {
  test('clear every field stamped before them, and a later write brings back only what it sets', async () => {
    const journal = await openJournal(memoryStore(), { now: clock(1_000, 2_000, 3_000), uuid })
    await journal.save(MEDIA, { status: 'WATCHING', progress: 3, score: 80, title: 'Frieren' })
    await journal.remove(MEDIA)

    expect(journal.find(MEDIA).state).toBe('NOT_LISTED')

    await journal.save(MEDIA, { progress: 1 })
    const found = journal.find(MEDIA)
    expect(found.state).toBe('LISTED')
    expect(found.state === 'LISTED' && found.values).toEqual({ progress: 1 })
  })

  test('a tombstone from another copy clears the older fields of this one, and a newer field survives it', () => {
    const base: JournalEntry = { id: 'e', ids: ['anilist:1'], fields: {} }
    const here: JournalEntry = { ...base, fields: { progress: { value: 4, stamp: { at: 100, by: 'a' } }, score: { value: 90, stamp: { at: 300, by: 'a' } } } }
    const there: JournalEntry = { ...base, fields: {}, deleted: { at: 200, by: 'b' } }

    const merged = mergeEntries(here, there)
    expect(combine([merged]).values).toEqual({ score: 90 })
    expect(mergeEntries(there, here), 'the merge is the same whichever copy it starts from').toEqual(merged)
  })
})

describe('merging copies', () => {
  test('per field the newer write, ties broken by device, and every id either copy knows', () => {
    const a: JournalEntry = { id: 'e', ids: ['anilist:1'], fields: { progress: { value: 2, stamp: { at: 100, by: 'a' } }, status: { value: 'WATCHING', stamp: { at: 50, by: 'a' } } } }
    const b: JournalEntry = { id: 'e', ids: ['mal:10'], fields: { progress: { value: 7, stamp: { at: 100, by: 'b' } }, status: { value: 'PAUSED', stamp: { at: 20, by: 'b' } } } }
    const file = (device: string, entries: JournalEntry[]): JournalFile => ({ version: 1, device, clock: 0, entries })

    const merged = mergeFiles(file('a', [a]), file('b', [b]))
    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.ids).toEqual(['anilist:1', 'mal:10'])
    expect(combine(merged.entries).values).toEqual({ progress: 7, status: 'WATCHING' })
    expect(merged.clock, 'the clock learns the highest stamp either copy holds').toBe(100)
  })

  test('two entries for one media, made on two devices, read as one', () => {
    const one: JournalEntry = { id: 'one', ids: ['anilist:1'], fields: { progress: { value: 2, stamp: { at: 100, by: 'a' } } } }
    const two: JournalEntry = { id: 'two', ids: ['anilist:1', 'mal:10'], fields: { score: { value: 70, stamp: { at: 150, by: 'b' } } } }

    expect(combine([one, two]).values).toEqual({ progress: 2, score: 70 })
  })

  test('a write another tab made since this one opened is merged, not overwritten', async () => {
    const store = memoryStore()
    const first = await openJournal(store, { now: clock(1_000, 3_000), uuid })
    const second = await openJournal(store, { now: clock(2_000), uuid })
    await first.save(MEDIA, { progress: 4 })
    await second.save(writable('ag:(anilist:2)'), { progress: 9 })
    await first.save(MEDIA, { score: 60 })

    const reopened = await openJournal(store, { now: clock(4_000), uuid })
    expect(reopened.find(writable('ag:(anilist:2)')).state, 'the other tab\'s entry is still on disk').toBe('LISTED')
    const found = reopened.find(MEDIA)
    expect(found.state === 'LISTED' && found.values).toEqual({ progress: 4, score: 60 })
  })
})

describe('reading a file back', () => {
  test('an unreadable file refuses to open rather than being overwritten', async () => {
    const store = memoryStore()
    await store.write('{"version":9}')

    await expect(openJournal(store, { now: clock(1), uuid })).rejects.toThrow('cannot read')
    expect(store.text(), 'the file is left as it was').toBe('{"version":9}')
  })
})

describe('patchFrom', () => {
  test('an absent field is left alone and an explicit null clears it', () => {
    expect(patchFrom({ progress: 3 })).toEqual({ patch: { progress: 3 } })
    expect(patchFrom({ score: null })).toEqual({ patch: { score: null } })
    expect(patchFrom({ progress: 3 }, { title: 'Frieren', episodeCount: 28 })).toEqual({ patch: { progress: 3, title: 'Frieren', episodeCount: 28 } })
  })

  test('refuses what no tracker could hold', () => {
    expect(patchFrom({ progress: -1 })).toHaveProperty('error')
    expect(patchFrom({ progress: 1.5 })).toHaveProperty('error')
    expect(patchFrom({ score: 101 })).toHaveProperty('error')
  })
})
