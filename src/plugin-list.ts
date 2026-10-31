// Which plugin packages the viewer added, and what they entered for each, as kept in this browser. Import
// free, so the settings page's list of what stub keeps can name the keys without loading the plugin runtime.

import type { PluginValues } from './plugin-api'

/**
 * The localStorage key holding the packages this device added outside an FKN account's list, a JSON
 * array of package ids as FKN installed them.
 */
export const ENABLED_PLUGINS_KEY = 'stub-enabled-plugins'
/** The localStorage key holding the FKN account's list as last read, while this browser uses it. */
export const ACCOUNT_PLUGINS_KEY = 'stub-account-plugins'
/** The localStorage key holding what the viewer entered for each source outside an account's values, by package id. */
export const PLUGIN_VALUES_KEY = 'stub-plugin-values'
/** The localStorage key holding the FKN account's values as last read, while this browser uses them. */
export const ACCOUNT_VALUES_KEY = 'stub-account-plugin-values'

export type ListStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** A field as the account keeps it: its value, null once cleared, and when it was saved in ms, 0 for one that joined from a device. */
export type SavedField = [value: string | null, savedAt: number]

/** The account's values, by package id and then by field. */
export type SavedValues = Record<string, Record<string, SavedField>>

/** What a save changes, by field: its new value, or null to clear it. */
export type PluginEdits = Record<string, string | null>

const defaultStorage = (): ListStorage | undefined => {
  try { return globalThis.localStorage } catch { return undefined }
}

/** A list as kept in JSON, its package ids only. Throws on text that is not JSON. */
export const parseList = (text: string): string[] => {
  const parsed: unknown = JSON.parse(text)
  return Array.isArray(parsed) ? parsed.filter((uri): uri is string => typeof uri === 'string') : []
}

const read = (key: string, storage: ListStorage | undefined): string[] | undefined => {
  try {
    const text = storage?.getItem(key)
    return text == null ? undefined : parseList(text)
  } catch {
    return []
  }
}

/** The sources this browser shows: the account's list while one is in use here, then this device's own. */
export const loadEnabled = (storage = defaultStorage()): string[] =>
  [...new Set([...loadAccount(storage) ?? [], ...loadDevice(storage)])]

export const loadDevice = (storage = defaultStorage()): string[] => read(ENABLED_PLUGINS_KEY, storage) ?? []

export const saveDevice = (uris: string[], storage = defaultStorage()) => {
  try {
    storage?.setItem(ENABLED_PLUGINS_KEY, JSON.stringify(uris))
  } catch {}
}

/** The FKN account's list as last read, or undefined while no account's list is in use here. */
export const loadAccount = (storage = defaultStorage()): string[] | undefined => read(ACCOUNT_PLUGINS_KEY, storage)

/** Keeps the account's list in this browser, or with undefined removes it. */
export const saveAccount = (uris: string[] | undefined, storage = defaultStorage()) => {
  try {
    if (uris) storage?.setItem(ACCOUNT_PLUGINS_KEY, JSON.stringify(uris))
    else storage?.removeItem(ACCOUNT_PLUGINS_KEY)
  } catch {}
}

/** This browser's own values, by package id. */
export const loadOwnValues = (storage = defaultStorage()): Record<string, PluginValues> => {
  try {
    return JSON.parse(storage?.getItem(PLUGIN_VALUES_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

const isField = (saved: unknown) =>
  Array.isArray(saved) && saved.length === 2 && (saved[0] === null || typeof saved[0] === 'string') && typeof saved[1] === 'number'

/** The account's values as kept in JSON, their well formed fields only, and none for text that is not JSON. */
export const parseSaved = (text: string): SavedValues => {
  try {
    const parsed = JSON.parse(text) as Record<string, object | null>
    return Object.fromEntries(Object.entries(parsed).map(([uri, fields]) =>
      [uri, Object.fromEntries(Object.entries(fields ?? {}).filter(([, saved]) => isField(saved)))]))
  } catch {
    return {}
  }
}

/** The fields of `mine` that `theirs` does not hold: those it lacks, or holds from an earlier save. */
export const unheld = (theirs: SavedValues, mine: SavedValues): SavedValues =>
  Object.fromEntries(Object.entries(mine).flatMap(([uri, fields]) => {
    const later = Object.entries(fields).filter(([field, [, savedAt]]) => (theirs[uri]?.[field]?.[1] ?? -1) < savedAt)
    return later.length ? [[uri, Object.fromEntries(later)]] : []
  }))

/** `theirs` with each field `mine` saved later: the later save of a field wins, and a field saved on one side only is kept. */
export const mergeSaved = (theirs: SavedValues, mine: SavedValues): SavedValues =>
  Object.entries(unheld(theirs, mine)).reduce((merged, [uri, fields]) => ({ ...merged, [uri]: { ...theirs[uri], ...fields } }), theirs)

/** `values` for the sources in `uris` alone. */
export const listedValues = (values: SavedValues, uris: string[]): SavedValues =>
  Object.fromEntries(Object.entries(values).filter(([uri]) => uris.includes(uri)))

/** This browser's own values as the account keeps them, older than any save, so a value the account has stays. */
export const ownAsSaved = (own: Record<string, PluginValues>): SavedValues =>
  Object.fromEntries(Object.entries(own).map(([uri, values]) =>
    [uri, Object.fromEntries(Object.entries(values ?? {}).map(([field, value]) => [field, [value, 0]]))]))

/** The FKN account's values as last read, none while none are in use here. */
export const loadAccountValues = (storage = defaultStorage()): SavedValues => {
  try {
    return parseSaved(storage?.getItem(ACCOUNT_VALUES_KEY) ?? '{}')
  } catch {
    return {}
  }
}

/** Keeps the account's values in this browser, or with undefined removes them. */
export const saveAccountValues = (values: SavedValues | undefined, storage = defaultStorage()) => {
  try {
    if (values) storage?.setItem(ACCOUNT_VALUES_KEY, JSON.stringify(values))
    else storage?.removeItem(ACCOUNT_VALUES_KEY)
  } catch {}
}

/** `values` with `edits` applied: a field edited to null leaves. */
export const editedValues = (values: PluginValues | undefined, edits: PluginEdits): PluginValues =>
  Object.fromEntries(Object.entries({ ...values, ...edits }).flatMap(([field, value]) => value === null ? [] : [[field, value]]))

/** What a source is handed: this browser's own values under the account's, a field the account cleared gone from both. */
export const loadPluginValues = (uri: string, storage = defaultStorage()): PluginValues =>
  editedValues(loadOwnValues(storage)[uri], Object.fromEntries(Object.entries(loadAccountValues(storage)[uri] ?? {}).map(([field, [value]]) => [field, value])))

/** Keeps what the viewer entered for a source as this browser's own, or with no values removes it. */
export const savePluginValues = (uri: string, values: PluginValues, storage = defaultStorage()) => {
  const { [uri]: _, ...others } = loadOwnValues(storage)
  const all = Object.keys(values).length ? { ...others, [uri]: values } : others
  try {
    if (Object.keys(all).length) storage?.setItem(PLUGIN_VALUES_KEY, JSON.stringify(all))
    else storage?.removeItem(PLUGIN_VALUES_KEY)
  } catch {}
}
