// The stub tracker's list following the viewer across devices on their FKN account. Import free, with
// the disk, the cloud, the journal, the lock and the clock injected, so every rule can be pinned
// under vitest.
//
// Why not @fkn/lib/fs, the hybrid file system: its upload queue and OPFS belong to the origin, not to
// the account, and it drains that queue into whichever account is signed in when it next runs. A
// device used by two accounts would upload one account's list into the other (tracking critique,
// finding 17). So this device's file lives on @fkn/lib/opfs, and the only thing that ever uploads it
// is this module, which first checks that the account signed in now is the one the file belongs to.

import type { JournalFile, JournalStore } from './journal'

import { emptyFile, listedCount, mergeFiles, parseJournal, type Journal } from './journal'

export type SessionScope = 'device' | 'account'

/**
 * Which list this device writes, kept on the device beside the files.
 *
 * - `device`: a list kept on this device only. Written while signed out, or while signed in before the
 *   account's list could be opened here. Never uploaded unless the viewer chooses to add it.
 * - `account`: the list of the FKN account that was signed in when this device id was started. The
 *   device's file was uploaded to that account in the same step, and its presence in the account's
 *   listing is how every later check tells that the account signed in now is still that one: the app
 *   is never told an account id.
 *
 * `uploaded` is the journal clock of the last copy the account received.
 */
export type Session = { id: string, scope: SessionScope, uploaded: number }

/** A session read back. A file written before the account link names no scope and is this device's. */
export const parseSession = (text: string | undefined): Session | undefined => {
  if (!text) return undefined
  const parsed = JSON.parse(text) as Partial<Session> | null
  if (typeof parsed?.id !== 'string' || !parsed.id) return undefined
  return { id: parsed.id, scope: parsed.scope === 'account' ? 'account' : 'device', uploaded: Number(parsed.uploaded) || 0 }
}

/** The stub tracker's files on this device, named relative to its root. */
export type TrackerDisk = {
  /** The session as the disk holds it NOW, minted as a `device` session when there is none. */
  session: () => Promise<Session>
  setSession: (session: Session) => Promise<void>
  read: (name: string) => Promise<string | undefined>
  write: (name: string, text: string) => Promise<void>
  remove: (name: string) => Promise<void>
  /** The journal's lock: a session only ever moves while holding it. */
  exclusive: <T>(work: () => Promise<T>) => Promise<T>
}

export const deviceFile = (id: string) => `devices/${id}.json`
/**
 * A `device` list set aside while an account's list is in use, until the viewer adds it or signs out.
 * Emptied rather than deleted: another worker's @fkn/lib/opfs mirror keeps a file that was deleted
 * under it (a remount only adds what the disk lists), so a deleted list would still be offered, and
 * restored at sign out, by every other open tab.
 */
export const HELD_FILE = 'on-this-device.json'

/** The account keeps each device's file under the same names, below this root. */
export const CLOUD_ROOT = 'tracking/v1/'
export const cloudPath = (id: string) => `${CLOUD_ROOT}${deviceFile(id)}`
const DEVICES = `${CLOUD_ROOT}devices/`

/** The journal's store: whichever device the session names, read afresh each time. */
export const journalStoreOver = (disk: TrackerDisk): JournalStore => ({
  device: async () => (await disk.session()).id,
  read: async () => disk.read(deviceFile((await disk.session()).id)),
  write: async (text) => disk.write(deviceFile((await disk.session()).id), text),
  exclusive: disk.exclusive,
})

export type CloudAvailability = 'connected' | 'disconnected' | 'unknown'
export type CloudEntry = { path: string, updatedAt: string }
export type CloudResult<T> = { ok: T } | { locked: true } | { missing: true } | { error: string }

/**
 * FKN storage as the tracker reaches it. Every answer is a value rather than a throw, so it crosses the
 * worker boundary whole.
 *
 * Nothing here may raise a card. A sealed read or write with no key held raises the connect card,
 * which needs a click, so `read` and `write` are only called once `unlocked` answered true.
 */
export type TrackerCloud = {
  /** `disconnected` is an answered sign out. `unknown` is anything less certain, and moves nothing. */
  availability: () => Promise<CloudAvailability>
  /** Whether this device holds the key the account's files are sealed with. A status that raises nothing. */
  unlocked: () => Promise<boolean>
  /** The account's tracker files, or undefined when the listing could not be had. Needs no key. */
  list: () => Promise<CloudEntry[] | undefined>
  read: (path: string) => Promise<CloudResult<string>>
  write: (path: string, text: string) => Promise<CloudResult<true>>
}

/** Where the stub tracker's list stands on this device, for the page to show. */
export type LinkStatus = {
  /** Whose list the tracker shows and writes: this device's own, or the FKN account's. */
  where: SessionScope
  /** Whether an FKN account is signed in, or null while that could not be told. */
  signedIn: boolean | null
  /** Signed in, and this device does not hold the key the account's list is sealed with. */
  locked: boolean
  /** Changes on this device that the account has not received yet. */
  waiting: boolean
  /** Entries of this device's own list, set aside while the account's list is in use. */
  held: number
  error: string | null
}

// @fkn/lib's prefix for a file that is there and will never open: a retired key's generation, an
// integrity failure, a retired envelope (`fkn:e2e-stale-epoch`, `-integrity`, `-retired-format`)
const SEALED_FOR_GOOD = 'fkn:e2e-'

/** How often the other devices' files may be read, at most. */
export const REFRESH_MS = 3 * 60_000
const UPLOAD_DELAY_MS = 1_500

type Refusal = Exclude<CloudResult<unknown>, { ok: unknown }>
const refusalText = (refusal: Refusal) =>
  'locked' in refusal ? 'The FKN account\'s storage is locked on this device'
  : 'missing' in refusal ? 'The file was not in the FKN account'
  : refusal.error

export type AccountLink = ReturnType<typeof accountLink>

/**
 * The link between this device's list and the viewer's FKN account.
 *
 * On a sign out the account's list leaves the device: its file is deleted and a new device list
 * starts, so nothing of it can be uploaded anywhere later. When the account signed in is not the one
 * this device's file was uploaded to, the same happens before anything is uploaded. A list kept while
 * signed out is set aside at sign in and only reaches the account through `addHeld`, the viewer's own
 * choice. The other devices' files are read only while the key is held, and at most once every
 * `refreshMs` per session.
 */
export const accountLink = ({
  disk,
  journal,
  cloud,
  lock,
  now,
  uuid,
  refreshMs = REFRESH_MS,
  uploadDelayMs = UPLOAD_DELAY_MS,
}: {
  disk: TrackerDisk
  journal: Journal
  cloud: TrackerCloud
  /** One link step at a time, across every tab of the origin. */
  lock: <T>(work: () => Promise<T>) => Promise<T>
  now: () => number
  uuid: () => string
  refreshMs?: number
  uploadDelayMs?: number
}) => {
  let status: LinkStatus = { where: 'device', signedIn: null, locked: false, waiting: false, held: 0, error: null }
  const listeners = new Set<() => void>()
  // the other devices' files as last read, for one session only
  let readFor: string | undefined
  let lastRead: number | undefined
  const others = new Map<string, { updatedAt: string, file: JournalFile }>()
  let uploadTimer: ReturnType<typeof setTimeout> | undefined
  let scheduled: Promise<unknown> = Promise.resolve()

  const readHeld = async () => parseJournal(await disk.read(HELD_FILE), 'held')
  const clearHeld = () => disk.write(HELD_FILE, JSON.stringify(emptyFile('held')))

  const report = async (session: Session, patch: Partial<LinkStatus>) => {
    const held = await readHeld()
    const own = parseJournal(await disk.read(deviceFile(session.id)), session.id)
    const next: LinkStatus = {
      ...status,
      error: null,
      ...patch,
      where: session.scope,
      held: listedCount(held),
      waiting: session.scope === 'account' && own.clock > session.uploaded,
    }
    if (JSON.stringify(next) === JSON.stringify(status)) return
    status = next
    for (const listener of listeners) listener()
  }

  /** Under the journal's lock, and only if no other tab moved the session first. */
  const moveFrom = (from: Session, move: () => Promise<void>) =>
    disk.exclusive(async () => {
      if ((await disk.session()).id === from.id) await move()
    })

  // A sign out: the account's list leaves this device, and the list this device kept before signing
  // in, if the viewer never added it, is this device's list again.
  const leaveAccount = async (from: Session) => {
    await moveFrom(from, async () => {
      const id = uuid()
      // deleted first: a crash after this still finds an account session with no file, and the next
      // check finishes the job, where the other order could leave the account's list on the device
      await disk.remove(deviceFile(from.id))
      const held = await readHeld()
      if (held.entries.length) await disk.write(deviceFile(id), JSON.stringify({ ...held, device: id }))
      await disk.setSession({ id, scope: 'device', uploaded: 0 })
      if (held.entries.length) await clearHeld()
    })
    await journal.reload()
  }

  // The account signed in is not the one this device's file belongs to (or the viewer deleted the file
  // from the account). Nothing of the old list may be uploaded, so it is deleted before any upload can
  // run, and the device starts over.
  const forgetAccount = async (from: Session) => {
    await moveFrom(from, async () => {
      await disk.remove(deviceFile(from.id))
      await disk.setSession({ id: uuid(), scope: 'device', uploaded: 0 })
    })
    await journal.reload()
  }

  // Signed in, key held: a new device id whose (empty) file is uploaded FIRST, since that file in the
  // account's listing is the proof every later upload checks. The list this device kept is set aside,
  // never uploaded.
  const joinAccount = async (from: Session): Promise<Refusal | undefined> => {
    const id = uuid()
    const wrote = await cloud.write(cloudPath(id), JSON.stringify(emptyFile(id)))
    if (!('ok' in wrote)) return wrote
    await moveFrom(from, async () => {
      const own = parseJournal(await disk.read(deviceFile(from.id)), from.id)
      if (own.entries.length) await disk.write(HELD_FILE, JSON.stringify(mergeFiles(await readHeld(), own)))
      await disk.setSession({ id, scope: 'account', uploaded: 0 })
      await disk.remove(deviceFile(from.id))
    })
    await journal.reload()
  }

  const isOwn = (session: Session, listing: CloudEntry[]) => listing.some(entry => entry.path === cloudPath(session.id))

  /** This device's file to its account, when the account lacks some of it. The caller checked the proof. */
  const upload = async (session: Session): Promise<Refusal | undefined> => {
    const text = await disk.exclusive(async () =>
      (await disk.session()).id === session.id ? await disk.read(deviceFile(session.id)) : undefined)
    if (text === undefined) return
    const { clock } = parseJournal(text, session.id)
    if (clock <= session.uploaded) return
    const wrote = await cloud.write(cloudPath(session.id), text)
    if (!('ok' in wrote)) return wrote
    await disk.exclusive(async () => {
      const current = await disk.session()
      if (current.id === session.id && current.uploaded < clock) await disk.setSession({ ...current, uploaded: clock })
    })
  }

  /** The other devices' files, the changed ones only, and no sooner than `refreshMs` after the last read. */
  const readOthers = async (session: Session, listing: CloudEntry[]): Promise<Refusal | undefined> => {
    if (readFor !== session.id) {
      readFor = session.id
      lastRead = undefined
      others.clear()
    }
    if (lastRead !== undefined && now() - lastRead < refreshMs) return
    lastRead = now()
    const theirs = listing.filter(entry =>
      entry.path.startsWith(DEVICES) && entry.path.endsWith('.json') && entry.path !== cloudPath(session.id))
    for (const path of [...others.keys()]) if (!theirs.some(entry => entry.path === path)) others.delete(path)
    let refusal: Refusal | undefined
    for (const entry of theirs) {
      if (others.get(entry.path)?.updatedAt === entry.updatedAt) continue
      const got = await cloud.read(entry.path)
      if ('ok' in got) {
        try {
          others.set(entry.path, { updatedAt: entry.updatedAt, file: parseJournal(got.ok, entry.path) })
        } catch (error) {
          // a device on a newer version of stub: its entries wait for this one to update
          console.warn(`tracking: skipped ${entry.path}`, error)
          others.set(entry.path, { updatedAt: entry.updatedAt, file: emptyFile(entry.path) })
        }
        continue
      }
      if ('missing' in got) { others.delete(entry.path); continue }
      if ('error' in got && got.error.startsWith(SEALED_FOR_GOOD)) {
        // sealed under a key the account has since reset, or corrupt: no retry opens it, so it is
        // skipped until it changes rather than shown as a problem on every refresh
        console.warn(`tracking: skipped ${entry.path}`, got.error)
        others.set(entry.path, { updatedAt: entry.updatedAt, file: emptyFile(entry.path) })
        continue
      }
      refusal = got
      if ('locked' in got) {
        // every other read would ask for the same key, and the next check may read again at once
        lastRead = undefined
        break
      }
    }
    journal.absorb(session.id, [...others.values()].map(({ file }) => file))
    return refusal
  }

  const check = async (): Promise<void> => {
    let session = await disk.session()
    // another tab may have moved the session: nothing this worker holds of the old one may stay on screen
    if (journal.device !== session.id) await journal.reload()
    const availability = await cloud.availability()
    if (availability === 'unknown') return report(session, { signedIn: null })
    if (availability === 'disconnected') {
      if (session.scope === 'account') {
        await leaveAccount(session)
        session = await disk.session()
      }
      return report(session, { signedIn: false, locked: false })
    }

    if (session.scope === 'account') {
      const listing = await cloud.list()
      if (!listing) return report(session, { signedIn: true })
      if (isOwn(session, listing)) {
        if (!await cloud.unlocked()) return report(session, { signedIn: true, locked: true })
        const refusal = await upload(session) ?? await readOthers(session, listing)
        return report(await disk.session(), { signedIn: true, locked: refusal !== undefined && 'locked' in refusal, error: refusal && !('locked' in refusal) ? refusalText(refusal) : null })
      }
      await forgetAccount(session)
      session = await disk.session()
    }

    if (!await cloud.unlocked()) return report(session, { signedIn: true, locked: true })
    const refused = await joinAccount(session)
    session = await disk.session()
    if (refused) return report(session, { signedIn: true, locked: 'locked' in refused, error: 'locked' in refused ? null : refusalText(refused) })
    const listing = await cloud.list()
    const refusal = listing ? await readOthers(session, listing) : undefined
    return report(session, { signedIn: true, locked: refusal !== undefined && 'locked' in refusal, error: null })
  }

  const flushUpload = async (): Promise<void> => {
    const session = await disk.session()
    if (session.scope !== 'account') return report(session, {})
    const own = parseJournal(await disk.read(deviceFile(session.id)), session.id)
    if (own.clock <= session.uploaded) return report(session, {})
    // the whole check, not only an upload: the account may have changed since the last one
    return check()
  }

  journal.onChange(() => {
    clearTimeout(uploadTimer)
    uploadTimer = setTimeout(() => {
      uploadTimer = undefined
      scheduled = lock(flushUpload).catch(error => console.warn('tracking: upload', error))
    }, uploadDelayMs)
  })

  return {
    status: () => status,
    onStatus: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    /** Signed in, out, or as someone else, or opened: check which account this device's list is. */
    accountChanged: () => lock(check),
    /**
     * The page came back into view: this device's file is read again for what other tabs wrote, and
     * the account is checked and read once the other devices' files are due again.
     */
    focused: () => lock(async () => {
      await journal.reload()
      const session = await disk.session()
      if (readFor === session.id && lastRead !== undefined && now() - lastRead < refreshMs) return report(session, {})
      return check()
    }),
    /**
     * The viewer chose to add the list this device kept before signing in to the account signed in
     * now. The only way that list ever reaches an account.
     */
    addHeld: () => lock(async (): Promise<string | undefined> => {
      const session = await disk.session()
      if (session.scope !== 'account') return 'Sign in to an FKN account, and open its list here, to add this list to it'
      const held = await readHeld()
      if (held.entries.length) {
        await journal.mergeIn(held)
        await clearHeld()
      }
      await report(session, {})
    }),
    /** Settles once every step already asked for has run, for a caller that needs the result. */
    idle: async () => {
      if (uploadTimer !== undefined) {
        clearTimeout(uploadTimer)
        uploadTimer = undefined
        scheduled = lock(flushUpload)
      }
      await scheduled
    },
  }
}
