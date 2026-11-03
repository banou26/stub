// The viewer's settings on their FKN account, so every stub site and device they sign in on has the same
// ones: one file mapping each setting's localStorage key to the value that key holds, so each setting's
// module keeps its own key and encoding. The resume points take the same path in a file of their own.
// Import free but for the settings' keys, with FKN's storage, the account notification and the lock
// injected, so every rule can be pinned under vitest.

import type { TrackerCloud } from './tracking/account-link'

import { LANGUAGE_KEY } from './i18n/languages'
import { accountGeneration } from './tracking/account-link'
import { parseList } from './plugin-list'
import { parseValues, type Settings, type SettingValues } from './settings-store'
import { COUNTRY_KEY } from './sources/country'
import { DISABLED_SOURCES_KEY } from './sources/disabled-sources'
import { HIDDEN_ICONS_KEY } from './sources/hidden-icons'
import { MERGE_ORDER_KEY } from './sources/merge-order'
import { PLAY_ORDER_KEY } from './sources/play-order'
import { COMPACT_PREFS_KEY } from './tracking/compact-prefs'
import { AUTOPLAY_KEY } from './utils/autoplay'
import { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY } from './utils/track-languages'
import { WATCH_POSITIONS_KEY } from './utils/watch-positions'
import { DISPLAY_MODE_KEY } from './router/search/display'

/** The account's settings: one file, a JSON object of each setting's key to its value, null for its default. */
export const SETTINGS_PATH = 'settings/v1/settings.json'

/** The account's resume points: one file, as the settings' with WATCH_POSITIONS_KEY alone. */
export const POSITIONS_PATH = 'positions/v1/positions.json'

/** While a player plays, the least time between two writes of its points to the account. */
export const POSITIONS_PACE_MS = 30_000

// JSON arrays of origins, which a fold combines: a source or icon turned off on any site stays off
const LISTS = [DISABLED_SOURCES_KEY, HIDDEN_ICONS_KEY]

/** Every setting that follows the account. The volume, the tracking sites' sessions and the party stay on the device. */
export const SETTINGS_KEYS: readonly string[] = [...LISTS, COUNTRY_KEY, LANGUAGE_KEY, AUTOPLAY_KEY, DISPLAY_MODE_KEY, COMPACT_PREFS_KEY, PLAY_ORDER_KEY, MERGE_ORDER_KEY, AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY]

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
 *
 * A store built with a `merge` (src/settings-store.ts) has its values merged with the account's instead,
 * this browser's own and its edits alike, and an edit stays until a read shows the file holds it, so an
 * edit another device's write put over is written again. With `paceMs`, edits start a step at most once per
 * `paceMs`, the last one included, and `settings.flush()` starts one at once.
 */
export const settingsSync = ({ settings, cloud, onAccountChange, lock, path = SETTINGS_PATH, keys = SETTINGS_KEYS, paceMs }: {
  settings: Settings
  cloud: Pick<TrackerCloud, 'availability' | 'unlocked' | 'read' | 'write'>
  /** `account.onChange` of the @fkn/lib realm that `cloud` calls. */
  onAccountChange: (listener: (change?: { switched: boolean }) => void) => unknown
  /** One step at a time, across every tab of the origin. */
  lock: <T>(work: () => Promise<T>) => Promise<T>
  /** The account's file and the keys it holds, the settings' unless given. */
  path?: string
  keys?: readonly string[]
  paceMs?: number
}) => {
  const { raw, write, edits, tell, onEdit, accountKey, merge } = settings.internal
  const account = accountGeneration()
  const joined = (values: SettingValues, made: Iterable<[string, string | null]>) => {
    const next = { ...values }
    for (const [key, value] of made) next[key] = merge ? merge(next[key] ?? null, value) : value
    return next
  }

  const step = async () => {
    const { call, current } = account.begin()
    const before = new Map(keys.map(key => [key, settings.getItem(key)]))
    const copyBefore = raw(accountKey)
    const availability = await cloud.availability()
    if (availability === 'unknown') return
    let next: SettingValues | undefined
    if (availability === 'connected') {
      // a sealed read with no key held raises FKN's connect card, which only a click may do
      if (!await cloud.unlocked()) return
      const read = await call(() => cloud.read(path))
      if (!('ok' in read) && !('missing' in read)) return
      const theirs = 'ok' in read ? parseValues(read.ok) : {}
      if (merge) for (const [key, value] of edits) if (merge(theirs[key] ?? null, value) === theirs[key]) edits.delete(key)
      const own = new Map(keys.map(key => [key, raw(key)]))
      const made = new Map(edits)
      next = { ...theirs }
      for (const [key, value] of own) {
        if (value !== null) next[key] = merge ? merge(theirs[key] ?? null, value) : LISTS.includes(key) ? union(theirs[key], value) : key in theirs ? theirs[key] ?? null : value
      }
      next = joined(next, [...made].filter(([key]) => keys.includes(key)))
      if (!same(next, theirs) && !('ok' in await call(() => cloud.write(path, JSON.stringify(next))))) return
      if (!merge) for (const [key, value] of made) if (edits.get(key) === value) edits.delete(key)
      // before the account check, as src/plugin-sync.ts clears its additions: the account holds them now,
      // folded or overruled, and one another tab wrote since stays for that tab's next step
      try { for (const [key, value] of own) if (raw(key) === value) write(key, null) } catch {}
    } else {
      // signed out, an edit is this browser's own value, which folds as one: never over the account's
      edits.clear()
    }
    if (!current() || raw(accountKey) !== copyBefore) return
    try { write(accountKey, next ? JSON.stringify(joined(next, edits)) : null) } catch {}
    for (const key of keys) if (settings.getItem(key) !== before.get(key)) tell(key)
  }

  // edits made on this page, and how many of them a finished step had taken, for `unsaved`
  let edited = 0
  let taken = 0
  let queued = false
  let waiting = Promise.resolve()
  const start = () => {
    if (queued) return waiting
    queued = true
    return waiting = lock(() => {
      queued = false
      const upTo = edited
      return step().finally(() => { taken = Math.max(taken, upTo) })
    }).catch(error => console.warn('settings: account file', error))
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  let paced = -Infinity
  const now = () => {
    clearTimeout(timer)
    timer = undefined
    paced = Date.now()
    return start()
  }
  onEdit(flush => {
    if (!flush) edited += 1
    if (flush) { if (edits.size) void now() }
    else if (paceMs === undefined) void start()
    else timer ??= setTimeout(now, Math.max(0, paced + paceMs - Date.now()))
  })
  void onAccountChange(change => {
    account.moved()
    // false: the same account, its connection renewed, so an edit made here is still its own
    if (change?.switched !== false) edits.clear()
    void start()
  })

  return {
    /** Reads the account's settings and brings this browser in line with them. */
    check: start,
    /**
     * Whether an edit made on this page waits for a step, or is in the running one: a reload now would
     * lose it, and the account's older copy would win on the next load. A step that ends without
     * writing, FKN not answering or no key held, lets it go.
     */
    unsaved: () => taken < edited,
  }
}

/** `settingsSync` for the resume points of `positions` (src/utils/watch-positions.ts), at their pace. */
export const positionsSync = (sync: Omit<Parameters<typeof settingsSync>[0], 'path' | 'keys' | 'paceMs'>) =>
  settingsSync({ ...sync, path: POSITIONS_PATH, keys: [WATCH_POSITIONS_KEY], paceMs: POSITIONS_PACE_MS })
