// Which plugin packages the viewer added, as kept in this browser. Import free, so the settings page's
// list of what stub keeps can name the key without loading the plugin runtime.

/** The localStorage key holding the added packages, a JSON array of package ids as FKN installed them. */
export const ENABLED_PLUGINS_KEY = 'stub-enabled-plugins'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | undefined => {
  try { return globalThis.localStorage } catch { return undefined }
}

export const loadEnabled = (storage = defaultStorage()): string[] => {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(ENABLED_PLUGINS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((uri): uri is string => typeof uri === 'string') : []
  } catch {
    return []
  }
}

export const saveEnabled = (uris: string[], storage = defaultStorage()) => {
  try {
    storage?.setItem(ENABLED_PLUGINS_KEY, JSON.stringify(uris))
  } catch {}
}
