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
 * Where the journal lives: this device's own file. On an FKN account the other devices' files are
 * read beside it (tracking/account-link.ts), and only this one is ever written.
 */
export type JournalStore = {
  /**
   * The device this journal writes as, read from the disk NOW. Another tab can move it (a sign out or
   * an account switch starts a new device), and a journal that finds it moved drops what it held.
   */
  device: () => Promise<string>
  /** That device's file as it is on disk NOW, so a write merges what another tab wrote since. */
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

/** How many entries of a file are on the list, which is what a viewer is told a file holds. */
export const listedCount = (file: JournalFile) =>
  file.entries.filter(entry => isListed(liveValues(entry).values)).length

export type Found =
  | { state: 'NO_ID' }
  | { state: 'AMBIGUOUS', candidates: string[] }
  | { state: 'NOT_LISTED' | 'LISTED', entries: JournalEntry[], values: Partial<EntryValues>, updatedAt?: number }

export type Journal = ReturnType<typeof journalOver>

const newestFirst = (entries: JournalEntry[]) =>
  [...entries].sort((a, b) => (liveValues(b).updatedAt ?? 0) - (liveValues(a).updatedAt ?? 0))

/** This device's copy of an entry the list holds, or a fresh one that names the same entry. */
const ownCopy = (own: JournalFile, entry: JournalEntry): JournalEntry =>
  own.entries.find(mine => mine.id === entry.id)
    ?? { id: entry.id, ids: entry.ids, ...(entry.key ? { key: entry.key } : {}), fields: {} }

/**
 * The journal over its store. Reads answer from memory: this device's file merged with the other
 * devices' files it was handed. Every write reads this device's file back, merges, stamps and writes
 * it, holding the store's lock, so nothing another tab wrote is lost, and nothing is ever written to
 * another device's file.
 */
export const journalOver = (
  store: JournalStore,
  initialDevice: string,
  initial: JournalFile,
  { now, uuid }: { now: () => number, uuid: () => string }
) => {
  let device = initialDevice
  let file = initial
  // the other devices' files, as last read; the list is this file merged with them
  let others: JournalFile[] = []
  let view: JournalFile | undefined
  const listeners = new Set<() => void>()
  // one write at a time inside this worker too, whatever the store's lock does
  let queue: Promise<unknown> = Promise.resolve()

  const viewOf = () => (view ??= others.reduce(mergeFiles, file))
  const notify = () => { for (const listener of listeners) listener() }

  // A device that moved is a session that ended: its file and every other device's file belonged to it
  // (to an account, possibly one that is no longer signed in), so none of it may reach the next write.
  const follow = (current: string) => {
    if (current === device) return false
    device = current
    file = emptyFile(current)
    others = []
    view = undefined
    return true
  }

  const commit = <T>(change: (own: JournalFile, stamp: Stamp, list: JournalFile) => { file: JournalFile, result: T }): Promise<T> => {
    const run = () => store.exclusive(async () => {
      follow(await store.device())
      const merged = mergeFiles(file, parseJournal(await store.read(), device))
      const list = others.reduce(mergeFiles, merged)
      // ticked from every stamp the list holds, so a write lands after what another device wrote
      const at = tick(list.clock, now())
      const { file: next, result } = change({ ...merged, clock: at }, { at, by: device }, list)
      await store.write(JSON.stringify(next))
      file = next
      view = undefined
      notify()
      return result
    })
    const done = queue.then(run, run)
    queue = done.catch(() => {})
    return done
  }

  const find = (identity: MediaIdentity): Found => {
    if (identity.kind === 'none') return { state: 'NO_ID' }
    if (identity.kind === 'ambiguous') return { state: 'AMBIGUOUS', candidates: identity.candidates }
    const entries = viewOf().entries.filter(entry => entryMatches(entry, identity))
    const { values, updatedAt } = combine(entries)
    return { state: isListed(values) ? 'LISTED' : 'NOT_LISTED', entries, values, updatedAt }
  }

  return {
    get device() { return device },
    /** This device's own entries, as its file holds them. */
    entries: () => file.entries,
    find,
    /** Write `patch` to the entry this media is tracked under, creating it when there is none. */
    save: (identity: Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>, patch: Patch) =>
      commit((own, stamp, list) => {
        // the entry written most recently takes the write, whichever device made it; the others still
        // read through `combine`, and every field this write sets is newer than anything they hold
        const target = newestFirst(list.entries.filter(entry => entryMatches(entry, identity)))[0]
        const base = target ? ownCopy(own, target) : { id: uuid(), ...newEntryIdentity(identity), fields: {} }
        const fields = { ...base.fields }
        for (const [field, value] of Object.entries(patch)) {
          if (value !== undefined) (fields as Record<string, Stamped<unknown>>)[field] = { value, stamp }
        }
        // an entry saved before its media named a catalogue id learns them here, and is matched on
        // them from then on
        const known = [...base.ids, ...target?.ids ?? []]
        const ids = [...new Set(identity.kind === 'catalogue' ? [...known, ...identity.ids] : known)].sort()
        const written: JournalEntry = { ...base, ids, fields }
        const entries = [...own.entries.filter(entry => entry.id !== written.id), written]
        return { file: { ...own, entries }, result: written }
      }),
    /** Tombstone every entry this media is tracked under, on whichever device it was made. */
    remove: (identity: Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>) =>
      commit((own, stamp, list) => {
        const byId = new Map(own.entries.map(entry => [entry.id, entry]))
        for (const entry of list.entries.filter(entry => entryMatches(entry, identity))) {
          byId.set(entry.id, { ...ownCopy(own, entry), deleted: stamp })
        }
        return { file: { ...own, entries: [...byId.values()] }, result: undefined }
      }),
    /**
     * Merge another file's entries into this device's own, keeping every stamp they carry: a list
     * the viewer chose to add. The merge never overrides a newer write, since each field keeps
     * whichever stamp is later.
     */
    mergeIn: (extra: JournalFile) =>
      commit(own => ({ file: mergeFiles(own, extra), result: undefined })),
    /**
     * The other devices' files, read for `forDevice`. Refused when this journal no longer writes as
     * that device: files read for a session that has since ended belong to it, not to this one.
     */
    absorb: (forDevice: string, files: JournalFile[]) => {
      if (forDevice !== device) return false
      others = files
      view = undefined
      notify()
      return true
    },
    /**
     * Read this device's file again: another tab may have written it, or started a new device. Tells
     * the listeners only when something did change, since a page asks for this every time it is seen.
     */
    reload: () => store.exclusive(async () => {
      const before = JSON.stringify(file)
      const moved = follow(await store.device())
      const onDisk = parseJournal(await store.read(), device)
      file = moved ? onDisk : mergeFiles(file, onDisk)
      if (!moved && JSON.stringify(file) === before) return
      view = undefined
      notify()
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
