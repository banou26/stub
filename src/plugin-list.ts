// Which plugin packages the viewer added, as kept in this browser. Import free, so the settings page's
// list of what stub keeps can name the keys without loading the plugin runtime.

/**
 * The localStorage key holding the packages this device added outside an FKN account's list, a JSON
 * array of package ids as FKN installed them.
 */
export const ENABLED_PLUGINS_KEY = 'stub-enabled-plugins'
/** The localStorage key holding the FKN account's list as last read, while this browser uses it. */
export const ACCOUNT_PLUGINS_KEY = 'stub-account-plugins'

export type ListStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

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
