// The viewer's added sources on their FKN account, so every stub site and device they sign in on shows
// the same list. Import free, with FKN's storage, the account notification, the lock and this browser's
// storage injected, so every rule can be pinned under vitest.

import type { TrackerCloud } from './tracking/account-link'

import { accountGeneration } from './tracking/account-link'
import { loadAccount, loadDevice, loadEnabled, parseList, saveAccount, saveDevice, type ListStorage } from './plugin-list'

/** The account's list: one file, a JSON array of package ids as FKN installed them. */
export const SOURCES_PATH = 'sources/v1/list.json'

const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The added sources, following the viewer's FKN account.
 *
 * While no account's list can be read here (signed out, no key on this device, FKN not answering) the
 * list is this device's own, as before. Once one can, what this device added outside it is merged into
 * it and cleared here, and the account's list is the one shown, kept in this browser so the next load
 * shows it at once. At sign out it leaves the browser. A step writes the account's file back only with
 * this device's own additions and the removals made here, never this browser's copy. A removal from
 * the account's list is kept out of every write until one lands.
 *
 * Every storage call of a step acts for the account the step began with. A step that heard of an
 * account change, or that saw the list shown here change under it, keeps nothing but the clearing of
 * additions already in an account: the step queued by that change starts over. `onList` hears each
 * change to the list shown since this page last heard of it, including one another tab applied.
 */
export const sourceListSync = ({ cloud, onAccountChange, lock, storage, onList }: {
  cloud: Pick<TrackerCloud, 'availability' | 'unlocked' | 'read' | 'write'>
  /** `account.onChange` of the @fkn/lib realm that `cloud` calls. */
  onAccountChange: (listener: () => void) => unknown
  /** One step at a time, across every tab of the origin. */
  lock: <T>(work: () => Promise<T>) => Promise<T>
  storage?: ListStorage
  onList: (before: string[], after: string[]) => void
}) => {
  const account = accountGeneration()
  // every tab of a site shares its storage, so the storage already holds a change another tab applied
  let applied = loadEnabled(storage)
  const drops = new Set<string>()

  const step = async () => {
    const { call, current } = account.begin()
    const before = loadEnabled(storage)
    const availability = await cloud.availability()
    if (availability === 'unknown') return
    let list: string[] | undefined
    if (availability === 'connected') {
      // a sealed read with no key held raises FKN's connect card, which only a click may do
      if (!await cloud.unlocked()) return
      const read = await call(() => cloud.read(SOURCES_PATH))
      if (!('ok' in read) && !('missing' in read)) return
      const theirs = 'ok' in read ? parseList(read.ok) : []
      const dropping = [...drops]
      const next = [...new Set([...theirs, ...loadDevice(storage)])].filter(uri => !dropping.includes(uri))
      if (!same(next, theirs) && !('ok' in await call(() => cloud.write(SOURCES_PATH, JSON.stringify(next))))) return
      for (const uri of dropping) drops.delete(uri)
      list = next
    }
    if (!same(loadEnabled(storage), before)) return
    // before the account check: the read or write was pinned to the account the step began with, so a
    // switch heard since must not merge these additions into the next account too
    if (list) saveDevice(loadDevice(storage).filter(uri => !list.includes(uri)), storage)
    if (!current()) return
    saveAccount(list, storage)
    const after = loadEnabled(storage)
    if (same(after, applied)) return
    const was = applied
    applied = after
    onList(was, after)
  }

  const start = (work: () => Promise<void>) =>
    lock(work).catch(error => console.warn('sources: account list', error))

  void onAccountChange(() => {
    account.moved()
    void start(step)
  })

  return {
    /** Reads the account's list and brings this browser in line with it. */
    check: () => start(step),
    /** Shows `uri` at once, and adds it to the account's list once one can be written. */
    add: (uri: string) => {
      drops.delete(uri)
      saveDevice([...new Set([...loadDevice(storage), uri])], storage)
      applied = [...new Set([...applied, uri])]
      return start(step)
    },
    /** Hides `uri` at once, and removes it from the account's list once one can be written. */
    remove: (uri: string) => {
      saveDevice(loadDevice(storage).filter(enabled => enabled !== uri), storage)
      const theirs = loadAccount(storage)
      if (theirs) {
        saveAccount(theirs.filter(enabled => enabled !== uri), storage)
        drops.add(uri)
      }
      applied = applied.filter(enabled => enabled !== uri)
      return start(step)
    },
  }
}
