// The settings that follow the viewer's FKN account (src/settings-sync.ts), as one Storage-shaped store
// over this browser's localStorage, and the resume points as another. Import free, so every setting's
// module, src/worker.ts and the privacy page can import it.

/** The localStorage key holding the FKN account's settings as last read, while this browser uses them. */
export const ACCOUNT_SETTINGS_KEY = 'stub.settings.account'

/** Settings by their localStorage key, null for one set back to its default. */
export type SettingValues = Record<string, string | null>

type Raw = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Settings as kept in JSON, their string and null values only. Throws on text that is not JSON. */
export const parseValues = (text: string): SettingValues => {
  const parsed: unknown = JSON.parse(text)
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed).filter(([, value]) => value === null || typeof value === 'string'))
    : {}
}

/**
 * A Storage for the settings that follow the account.
 *
 * While the account's settings are in use here, a key reads the account's value when it has one, else
 * this browser's own, and a write changes the account's copy. Otherwise both go to this browser's own
 * key. Every write is kept as an edit of this page until src/settings-sync.ts has written it to the
 * account or heard of an account change, and its watchers hear it even when this browser's storage
 * refuses it, which then throws as Storage does. A read never throws. `watch` hears a change made in this
 * tab, in another tab, or by a sync step. `flush` asks a sync that paces its writes to write this page's
 * edits now.
 *
 * With `merge`, for a value made of entries, a write is merged into the value shown and into this page's
 * edit rather than put over them: an edit then holds only what this page wrote, never an entry of the
 * account's copy, which may be another account's when a switch went unheard. A sync step merges the same
 * way, and keeps the edit until it reads the account's file holding it.
 */
export const createSettings = (storage: () => Raw = () => globalThis.localStorage, { accountKey = ACCOUNT_SETTINGS_KEY, merge }: {
  /** The localStorage key holding the account's copy. */
  accountKey?: string
  merge?: (theirs: string | null, mine: string | null) => string
} = {}) => {
  const listeners = new Map<string, Set<() => void>>()
  const edits = new Map<string, string | null>()
  let edited: (flush?: boolean) => void = () => {}

  const raw = (key: string) => { try { return storage().getItem(key) } catch { return null } }
  const write = (key: string, value: string | null) => {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  }
  const copy = (): SettingValues | undefined => {
    const text = raw(accountKey)
    if (text === null) return undefined
    try { return parseValues(text) } catch { return {} }
  }
  const getItem = (key: string): string | null => {
    const theirs = copy()?.[key]
    return theirs === undefined ? raw(key) : theirs
  }
  const tell = (key: string) => { for (const listener of listeners.get(key) ?? []) listener() }
  const put = (key: string, written: string | null) => {
    const value = merge ? merge(getItem(key), written) : written
    edits.set(key, merge ? merge(edits.get(key) ?? null, written) : written)
    try {
      const theirs = copy()
      if (theirs) write(accountKey, JSON.stringify({ ...theirs, [key]: value }))
      else write(key, value)
    } finally {
      tell(key)
      edited()
    }
  }

  return {
    getItem,
    setItem: (key: string, value: string) => put(key, value),
    removeItem: (key: string) => put(key, null),
    watch: (key: string, listener: () => void): () => void => {
      let watching = listeners.get(key)
      if (!watching) listeners.set(key, watching = new Set())
      watching.add(listener)
      const fromOtherTab = (event: StorageEvent) => {
        if (event.key === key || event.key === accountKey || event.key === null) listener()
      }
      globalThis.addEventListener?.('storage', fromOtherTab)
      return () => {
        watching.delete(listener)
        globalThis.removeEventListener?.('storage', fromOtherTab)
      }
    },
    flush: () => edited(true),
    /** For src/settings-sync.ts alone. */
    internal: { raw, write, edits, tell, accountKey, merge, onEdit: (run: (flush?: boolean) => void) => { edited = run } },
  }
}

export type Settings = ReturnType<typeof createSettings>

/** This browser's settings, one store for every reader on the page. */
export const settings = createSettings()
