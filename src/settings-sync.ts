// The viewer's settings on their FKN account, so every stub site and device they sign in on has the same
// ones: one file mapping each setting's localStorage key to the value that key holds, so each setting's
// module keeps its own key and encoding. Import free but for the settings' keys, with FKN's storage, the
// account notification and the lock injected, so every rule can be pinned under vitest.

import type { TrackerCloud } from './tracking/account-link'

import { accountGeneration } from './tracking/account-link'
import { parseList } from './plugin-list'
import { ACCOUNT_SETTINGS_KEY, parseValues, type Settings, type SettingValues } from './settings-store'
import { COUNTRY_KEY } from './sources/country'
import { DISABLED_SOURCES_KEY } from './sources/disabled-sources'
import { HIDDEN_ICONS_KEY } from './sources/hidden-icons'
import { PLAY_ORDER_KEY } from './sources/play-order'
import { COMPACT_PREFS_KEY } from './tracking/compact-prefs'
import { AUTOPLAY_KEY } from './utils/autoplay'
import { DISPLAY_MODE_KEY } from './router/search/display'

/** The account's settings: one file, a JSON object of each setting's key to its value, null for its default. */
export const SETTINGS_PATH = 'settings/v1/settings.json'

// JSON arrays of origins, which a fold combines: a source or icon turned off on any site stays off
const LISTS = [DISABLED_SOURCES_KEY, HIDDEN_ICONS_KEY]

/** Every setting that follows the account. The volume, the tracking sites' sessions and the party stay on the device. */
export const SETTINGS_KEYS: readonly string[] = [...LISTS, COUNTRY_KEY, AUTOPLAY_KEY, DISPLAY_MODE_KEY, COMPACT_PREFS_KEY, PLAY_ORDER_KEY]

const same = (a: SettingValues, b: SettingValues) => JSON.stringify(a) === JSON.stringify(b)

const origins = (text: string | null | undefined) => {
  try { return parseList(text ?? '[]') } catch { return [] }
}
const union = (a: string | null | undefined, b: string) => JSON.stringify([...new Set([...origins(a), ...origins(b)])])

/**
 * `settings` following the viewer's FKN account, as src/plugin-sync.ts keeps the added sources.
 *
 * Signed out, the settings are this browser's own. Once the account's file can be read, this browser's
 * own values are folded into it and leave this browser: the account's value wins where it has one, the
 * switch lists combine, and an edit made on this page while signed in, since the last account switch,
 * wins over both. The account's settings are then the ones shown, kept in this browser so the next load
 * shows them at once, and they stay shown while the file cannot be read (no key on this device, FKN not
 * answering). At sign out they leave the browser.
 *
 * Every storage call of a step acts for the account the step began with, and a step that heard of an
 * account change, or saw the account's copy change under it, saves nothing: the step queued by that
 * change follows. At most one step waits behind the running one.
 */
export const settingsSync = ({ settings, cloud, onAccountChange, lock }: {
  settings: Settings
  cloud: Pick<TrackerCloud, 'availability' | 'unlocked' | 'read' | 'write'>
  /** `account.onChange` of the @fkn/lib realm that `cloud` calls. */
  onAccountChange: (listener: (change?: { switched: boolean }) => void) => unknown
  /** One step at a time, across every tab of the origin. */
  lock: <T>(work: () => Promise<T>) => Promise<T>
}) => {
  const { raw, write, edits, tell, onEdit } = settings.internal
  const account = accountGeneration()

  const step = async () => {
    const { call, current } = account.begin()
    const before = new Map(SETTINGS_KEYS.map(key => [key, settings.getItem(key)]))
    const copyBefore = raw(ACCOUNT_SETTINGS_KEY)
    const availability = await cloud.availability()
    if (availability === 'unknown') return
    let next: SettingValues | undefined
    if (availability === 'connected') {
      // a sealed read with no key held raises FKN's connect card, which only a click may do
      if (!await cloud.unlocked()) return
      const read = await call(() => cloud.read(SETTINGS_PATH))
      if (!('ok' in read) && !('missing' in read)) return
      const theirs = 'ok' in read ? parseValues(read.ok) : {}
      const own = new Map(SETTINGS_KEYS.map(key => [key, raw(key)]))
      const made = new Map(edits)
      next = { ...theirs }
      for (const [key, value] of own) {
        if (value !== null) next[key] = LISTS.includes(key) ? union(theirs[key], value) : key in theirs ? theirs[key] ?? null : value
      }
      for (const [key, value] of made) if (SETTINGS_KEYS.includes(key)) next[key] = value
      if (!same(next, theirs) && !('ok' in await call(() => cloud.write(SETTINGS_PATH, JSON.stringify(next))))) return
      for (const [key, value] of made) if (edits.get(key) === value) edits.delete(key)
      // before the account check, as src/plugin-sync.ts clears its additions: the account holds them now,
      // folded or overruled, and one another tab wrote since stays for that tab's next step
      try { for (const [key, value] of own) if (raw(key) === value) write(key, null) } catch {}
    } else {
      // signed out, an edit is this browser's own value, which folds as one: never over the account's
      edits.clear()
    }
    if (!current() || raw(ACCOUNT_SETTINGS_KEY) !== copyBefore) return
    try { write(ACCOUNT_SETTINGS_KEY, next ? JSON.stringify({ ...next, ...Object.fromEntries(edits) }) : null) } catch {}
    for (const key of SETTINGS_KEYS) if (settings.getItem(key) !== before.get(key)) tell(key)
  }

  let queued = false
  let waiting = Promise.resolve()
  const start = () => {
    if (queued) return waiting
    queued = true
    return waiting = lock(() => {
      queued = false
      return step()
    }).catch(error => console.warn('settings: account file', error))
  }

  onEdit(() => { void start() })
  void onAccountChange(change => {
    account.moved()
    // false: the same account, its connection renewed, so an edit made here is still its own
    if (change?.switched !== false) edits.clear()
    void start()
  })

  return {
    /** Reads the account's settings and brings this browser in line with them. */
    check: start,
  }
}
