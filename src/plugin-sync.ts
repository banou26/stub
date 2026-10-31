// The viewer's added sources on their FKN account, and what they entered for each, so every stub site and
// device they sign in on shows the same list and hands each source the same values. Import free, with
// FKN's storage, the account notification, the lock and this browser's storage injected, so every rule can
// be pinned under vitest.

import type { PluginValues } from './plugin-api'
import type { Call, TrackerCloud } from './tracking/account-link'

import { accountGeneration } from './tracking/account-link'
import {
  listedValues,
  loadAccount,
  loadAccountValues,
  loadDevice,
  loadEnabled,
  loadOwnValues,
  loadPluginValues,
  mergeSaved,
  ownAsSaved,
  parseList,
  parseSaved,
  saveAccount,
  saveAccountValues,
  saveDevice,
  savePluginValues,
  unheld,
  type ListStorage,
  type SavedField,
  type SavedValues,
} from './plugin-list'

/** The account's list: one file, a JSON array of package ids as FKN installed them. */
export const SOURCES_PATH = 'sources/v1/list.json'

/**
 * The account's values: one file beside the list, a JSON object of `SavedValues`. A client older than the
 * values rewrites the list as an array of strings, so nothing else it does not know survives in that file.
 */
export const VALUES_PATH = 'sources/v1/values.json'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const without = (uri: string, values: SavedValues) => Object.fromEntries(Object.entries(values).filter(([kept]) => kept !== uri))

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
 *
 * The values follow in the same step, so they are here before `onList` connects a source. What this
 * device entered outside the account joins where the account has no value and leaves here, as an addition
 * does. A save made here while the account's list is in use marks only the fields it changed, and stays
 * until a read shows the file holding them, so one another site's write put over is written again. No lock
 * spans two sites: the later save of a field wins, and fields saved on one site only are all kept. The file
 * only ever holds the sources on the list just read, so a removal anywhere, by a client older than the
 * values too, removes them for every site. At sign out they leave this browser with the list.
 */
export const sourceListSync = ({ cloud, onAccountChange, lock, storage, onList, onValues }: {
  cloud: Pick<TrackerCloud, 'availability' | 'unlocked' | 'read' | 'write'>
  /** `account.onChange` of the @fkn/lib realm that `cloud` calls. */
  onAccountChange: (listener: (change?: { switched: boolean }) => void) => unknown
  /** One step at a time, across every tab of the origin. */
  lock: <T>(work: () => Promise<T>) => Promise<T>
  storage?: ListStorage
  onList: (before: string[], after: string[]) => void
  /** Told after each step that kept what it found, which may have changed the values shown here. */
  onValues: () => void
}) => {
  const account = accountGeneration()
  // every tab of a site shares its storage, so the storage already holds a change another tab applied
  let applied = loadEnabled(storage)
  const drops = new Set<string>()
  // in memory, as a removal is, so a save never outlives the page into another account's file
  let saves: SavedValues = {}

  const exchangeValues = async (call: Call, list: string[]) => {
    const read = await call(() => cloud.read(VALUES_PATH))
    if (!('ok' in read) && !('missing' in read)) return undefined
    const theirs = 'ok' in read ? parseSaved(read.ok) : {}
    const own = loadOwnValues(storage)
    const next = listedValues(mergeSaved(mergeSaved(theirs, ownAsSaved(own)), saves), list)
    if (!same(next, theirs) && !('ok' in await call(() => cloud.write(VALUES_PATH, JSON.stringify(next))))) return undefined
    return { theirs, own, next }
  }

  const step = async () => {
    const { call, current } = account.begin()
    const before = loadEnabled(storage)
    const availability = await cloud.availability()
    if (availability === 'unknown') return
    let list: string[] | undefined
    let values: Awaited<ReturnType<typeof exchangeValues>>
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
      values = await exchangeValues(call, next)
    }
    if (!same(loadEnabled(storage), before)) return
    // before the account check: the read or write was pinned to the account the step began with, so a
    // switch heard since must not merge these additions into the next account too
    if (list) saveDevice(loadDevice(storage).filter(uri => !list.includes(uri)), storage)
    for (const [uri, taken] of Object.entries(values?.own ?? {})) {
      if (same(loadOwnValues(storage)[uri], taken)) savePluginValues(uri, {}, storage)
    }
    if (!current()) return
    saveAccount(list, storage)
    if (!list) saves = {}
    else if (values) saves = listedValues(unheld(values.theirs, saves), list)
    if (values || !list) saveAccountValues(values && mergeSaved(values.next, saves), storage)
    const after = loadEnabled(storage)
    if (!same(after, applied)) {
      const was = applied
      applied = after
      onList(was, after)
    }
    onValues()
  }

  const start = (work: () => Promise<void>) =>
    lock(work).catch(error => console.warn('sources: account list', error))

  void onAccountChange(change => {
    account.moved()
    // false: the same account, its connection renewed, so a save made here is still its own
    if (change?.switched !== false) saves = {}
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
        saveAccountValues(without(uri, loadAccountValues(storage) ?? {}), storage)
        saves = without(uri, saves)
        drops.add(uri)
      }
      applied = applied.filter(enabled => enabled !== uri)
      return start(step)
    },
    /** Keeps what the viewer entered for `uri`: the account's once one is in use here, else this device's own. */
    save: (uri: string, values: PluginValues) => {
      if (!loadAccount(storage)) {
        savePluginValues(uri, values, storage)
        return start(step)
      }
      const copy = loadAccountValues(storage) ?? {}
      const shown = loadPluginValues(uri, storage)
      // later than what it replaces whatever this device's clock says, or a slow clock's save would lose to it
      const savedAt = Math.max(Date.now(), ...Object.values(copy[uri] ?? {}).map(([, at]) => at + 1))
      const changed = [...new Set([...Object.keys(shown), ...Object.keys(values)])]
        .filter(field => shown[field] !== values[field])
        .map((field): [string, SavedField] => [field, [values[field] ?? null, savedAt]])
      saves = { ...saves, [uri]: { ...saves[uri], ...Object.fromEntries(changed) } }
      saveAccountValues({ ...copy, [uri]: { ...copy[uri], ...Object.fromEntries(changed) } }, storage)
      return start(step)
    },
    /** Drops `uri` from this device's own list only. One the account's list holds stays: that list is the account's. */
    forget: (uri: string) => start(async () => {
      if (loadAccount(storage)?.includes(uri)) return
      saveDevice(loadDevice(storage).filter(enabled => enabled !== uri), storage)
      applied = applied.filter(enabled => enabled !== uri)
    }),
  }
}
