// Stub's own tracker as data: a journal of entries whose every field carries the stamp of the write
// that set it. Import free, with the store, the clock and the id minting injected, so the merge rules
// can be pinned under vitest.

import type { FuzzyDate, ListEntryInput, ListStatus } from '../generated/schema/types.generated'

import { entryMatches, newEntryIdentity, type EntryIdentity, type MediaIdentity } from './identity'

/**
 * When a field was written, and by which device. Ordered by `at`, then by `by`, so two devices that
 * wrote in the same millisecond still agree on which write won.
 */
export type Stamp = { at: number, by: string }

export const compareStamps = (a: Stamp | undefined, b: Stamp | undefined): number => {
  if (!a || !b) return a ? 1 : b ? -1 : 0
  return a.at - b.at || (a.by < b.by ? -1 : a.by > b.by ? 1 : 0)
}

const newest = (a: Stamp | undefined, b: Stamp | undefined) => compareStamps(a, b) >= 0 ? a : b

/**
 * A hybrid logical clock: the wall clock, but never at or behind a stamp already seen. A device whose
 * clock runs behind still writes after what it has read, instead of losing every field to it.
 */
export const tick = (clock: number, now: number): number => Math.max(now, clock + 1)

export type EntryValues = {
  status: ListStatus | null
  progress: number | null
  score: number | null
  startedAt: FuzzyDate | null
  completedAt: FuzzyDate | null
  rewatchCount: number | null
  // what the page showed, kept so a list can draw the entry without the page
  title: string | null
  cover: string | null
  episodeCount: number | null
}

/** The fields that make an entry listed. The rest describe the media and list nothing on their own. */
export const LIST_FIELDS = ['status', 'progress', 'score', 'startedAt', 'completedAt', 'rewatchCount'] as const
const FIELDS = [...LIST_FIELDS, 'title', 'cover', 'episodeCount'] as const

type Field = keyof EntryValues
export type Stamped<T> = { value: T, stamp: Stamp }

export type JournalEntry = EntryIdentity & {
  /** minted once, and how devices merge their copies of one entry */
  id: string
  fields: { [K in Field]?: Stamped<EntryValues[K]> }
  /** a tombstone: every field stamped before it is cleared */
  deleted?: Stamp
}

export type JournalFile = {
  version: 1
  device: string
  /** the highest stamp this file has seen, which is what the next write ticks from */
  clock: number
  entries: JournalEntry[]
}

/** The fields of an entry its tombstone has not cleared, and when the newest of them was written. */
export const liveValues = (entry: JournalEntry): { values: Partial<EntryValues>, updatedAt?: number } => {
  const values: Partial<Record<Field, unknown>> = {}
  let updatedAt: number | undefined
  for (const field of FIELDS) {
    const stamped = entry.fields[field]
    if (!stamped || compareStamps(stamped.stamp, entry.deleted) <= 0) continue
    values[field] = stamped.value
    updatedAt = Math.max(updatedAt ?? 0, stamped.stamp.at)
  }
  return { values: values as Partial<EntryValues>, updatedAt }
}

export const isListed = (values: Partial<EntryValues>) => LIST_FIELDS.some(field => values[field] != null)

/** Two copies of ONE entry: per field the newer write, the later tombstone, and every id either knows. */
export const mergeEntries = (a: JournalEntry, b: JournalEntry): JournalEntry => {
  const fields: JournalEntry['fields'] = {}
  for (const field of FIELDS) {
    const left = a.fields[field]
    const right = b.fields[field]
    const kept = !left ? right : !right ? left : compareStamps(left.stamp, right.stamp) >= 0 ? left : right
    if (kept) (fields as Record<Field, unknown>)[field] = kept
  }
  const deleted = newest(a.deleted, b.deleted)
  return {
    id: a.id,
    ids: [...new Set([...a.ids, ...b.ids])].sort(),
    ...(a.key ?? b.key ? { key: a.key ?? b.key } : {}),
    fields,
    ...(deleted ? { deleted } : {}),
  }
}

const highestStamp = (entries: JournalEntry[]) => {
  let highest = 0
  for (const entry of entries) {
    highest = Math.max(highest, entry.deleted?.at ?? 0)
    for (const stamped of Object.values(entry.fields)) highest = Math.max(highest, stamped?.stamp.at ?? 0)
  }
  return highest
}

/** Two copies of a journal, merged entry by entry. Commutative in everything but whose `device` it is. */
export const mergeFiles = (own: JournalFile, other: JournalFile): JournalFile => {
  const byId = new Map(own.entries.map(entry => [entry.id, entry]))
  for (const entry of other.entries) {
    const mine = byId.get(entry.id)
    byId.set(entry.id, mine ? mergeEntries(mine, entry) : entry)
  }
  const entries = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
  return { version: 1, device: own.device, clock: Math.max(own.clock, other.clock, highestStamp(entries)), entries }
}

/**
 * The newest live value of every field across several entries, which is how two entries for one media
 * read as one: two devices can each create one before either sees the other's.
 */
export const combine = (entries: JournalEntry[]) => {
  const values: Partial<Record<Field, unknown>> = {}
  const stamps: Partial<Record<Field, Stamp>> = {}
  let updatedAt: number | undefined
  for (const entry of entries) {
    for (const field of FIELDS) {
      const stamped = entry.fields[field]
      if (!stamped || compareStamps(stamped.stamp, entry.deleted) <= 0) continue
      if (compareStamps(stamped.stamp, stamps[field]) <= 0) continue
      stamps[field] = stamped.stamp
      values[field] = stamped.value
      updatedAt = Math.max(updatedAt ?? 0, stamped.stamp.at)
    }
  }
  return { values: values as Partial<EntryValues>, updatedAt }
}

/** A write's fields: `undefined` leaves a field alone, `null` clears it. */
export type Patch = Partial<EntryValues>

const isCount = (value: unknown) => value == null || (Number.isInteger(value) && (value as number) >= 0)

/**
 * The patch a `ListEntryInput` asks for, or why it cannot be written. Only keys the input carries are
 * in the patch, so an absent field is never cleared.
 */
export const patchFrom = (
  input: ListEntryInput,
  snapshot: { title?: string | null, cover?: string | null, episodeCount?: number | null } = {}
): { patch: Patch } | { error: string } => {
  if (!isCount(input.progress)) return { error: 'Progress has to be a whole number of episodes' }
  if (!isCount(input.rewatchCount)) return { error: 'The rewatch count has to be a whole number' }
  if (input.score != null && !(Number.isInteger(input.score) && input.score >= 0 && input.score <= 100)) {
    return { error: 'A score is a whole number from 0 to 100' }
  }
  const patch: Patch = {}
  for (const field of LIST_FIELDS) {
    if (field in input && input[field] !== undefined) (patch as Record<string, unknown>)[field] = input[field] ?? null
  }
  for (const field of ['title', 'cover', 'episodeCount'] as const) {
    if (snapshot[field] != null) (patch as Record<string, unknown>)[field] = snapshot[field]
  }
  return { patch }
}

/**
 * Where the journal lives. The S1 store is this device's OPFS; the signed-in store replicates the same
 * file, which is why the journal carries a device id at all.
 */
export type JournalStore = {
  /** This device's id, minted once and kept. */
  device: () => Promise<string>
  /** The file as it is on disk NOW, so a write merges what another tab wrote since. */
  read: () => Promise<string | undefined>
  write: (text: string) => Promise<void>
  /** Runs `work` holding the file, so two tabs never interleave a read, merge and write. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>
}

export const emptyFile = (device: string): JournalFile => ({ version: 1, device, clock: 0, entries: [] })

/** A journal file read back, refusing anything it cannot read rather than overwriting it. */
export const parseJournal = (text: string | undefined, device: string): JournalFile => {
  if (!text) return emptyFile(device)
  const parsed = JSON.parse(text) as Partial<JournalFile>
  if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('The tracking file on this device is in a format this version cannot read')
  const entries = parsed.entries.filter((entry): entry is JournalEntry =>
    typeof entry?.id === 'string' && Array.isArray(entry.ids) && typeof entry.fields === 'object' && entry.fields !== null)
  return { version: 1, device, clock: Number(parsed.clock) || 0, entries }
}

export type Found =
  | { state: 'NO_ID' }
  | { state: 'AMBIGUOUS', candidates: string[] }
  | { state: 'NOT_LISTED' | 'LISTED', entries: JournalEntry[], values: Partial<EntryValues>, updatedAt?: number }

export type Journal = ReturnType<typeof journalOver>

/**
 * The journal over its store. Reads answer from memory; every write reads the file back, merges,
 * stamps and writes, holding the store's lock, so nothing another tab wrote is lost.
 */
export const journalOver = (
  store: JournalStore,
  device: string,
  initial: JournalFile,
  { now, uuid }: { now: () => number, uuid: () => string }
) => {
  let file = initial
  const listeners = new Set<() => void>()
  // one write at a time inside this worker too, whatever the store's lock does
  let queue: Promise<unknown> = Promise.resolve()

  const commit = <T>(change: (file: JournalFile, stamp: Stamp) => { file: JournalFile, result: T }): Promise<T> => {
    const run = () => store.exclusive(async () => {
      const onDisk = parseJournal(await store.read(), device)
      const merged = mergeFiles(file, onDisk)
      const at = tick(merged.clock, now())
      const { file: next, result } = change({ ...merged, clock: at }, { at, by: device })
      await store.write(JSON.stringify(next))
      file = next
      for (const listener of listeners) listener()
      return result
    })
    const done = queue.then(run, run)
    queue = done.catch(() => {})
    return done
  }

  const find = (identity: MediaIdentity): Found => {
    if (identity.kind === 'none') return { state: 'NO_ID' }
    if (identity.kind === 'ambiguous') return { state: 'AMBIGUOUS', candidates: identity.candidates }
    const entries = file.entries.filter(entry => entryMatches(entry, identity))
    const { values, updatedAt } = combine(entries)
    return { state: isListed(values) ? 'LISTED' : 'NOT_LISTED', entries, values, updatedAt }
  }

  return {
    device,
    entries: () => file.entries,
    find,
    /** Write `patch` to the entry this media is tracked under, creating it when there is none. */
    save: (identity: Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>, patch: Patch) =>
      commit((current, stamp) => {
        const matched = current.entries.filter(entry => entryMatches(entry, identity))
        // the entry written most recently takes the write; the others still read through `combine`,
        // and every field this write sets is newer than anything they hold
        const target = matched.sort((a, b) => (liveValues(b).updatedAt ?? 0) - (liveValues(a).updatedAt ?? 0))[0]
          ?? { id: uuid(), ...newEntryIdentity(identity), fields: {} }
        const fields = { ...target.fields }
        for (const [field, value] of Object.entries(patch)) {
          if (value !== undefined) (fields as Record<string, Stamped<unknown>>)[field] = { value, stamp }
        }
        // an entry saved before its media named a catalogue id learns them here, and is matched on
        // them from then on
        const ids = identity.kind === 'catalogue' ? [...new Set([...target.ids, ...identity.ids])].sort() : target.ids
        const written: JournalEntry = { ...target, ids, fields }
        const entries = [...current.entries.filter(entry => entry.id !== written.id), written]
        return { file: { ...current, entries }, result: written }
      }),
    /** Tombstone every entry this media is tracked under. */
    remove: (identity: Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>) =>
      commit((current, stamp) => {
        const entries = current.entries.map(entry => entryMatches(entry, identity) ? { ...entry, deleted: stamp } : entry)
        return { file: { ...current, entries }, result: undefined }
      }),
    onChange: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/** Open the journal: this device's id, and its file read back from the store. */
export const openJournal = async (store: JournalStore, deps: { now: () => number, uuid: () => string }): Promise<Journal> => {
  const device = await store.device()
  return journalOver(store, device, parseJournal(await store.read(), device), deps)
}
