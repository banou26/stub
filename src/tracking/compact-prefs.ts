// What the compact tracking row remembers, per device: the trackers the viewer chose not to write to. Not
// per media and not per account: it is how this viewer likes to write, on this device.

export type CompactPrefs = {
  /** Only the choices the viewer made. A tracker missing here is written to when it can be. */
  targets: Record<string, boolean>
}

export const COMPACT_PREFS_KEY = 'stub.tracking.compact'

export const DEFAULT_COMPACT_PREFS: CompactPrefs = { targets: {} }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

const defaultStorage = (): StorageLike | undefined => {
  try { return globalThis.localStorage } catch { return undefined }
}

/** A stored or hand-edited value as prefs, falling back to the defaults field by field rather than throwing. */
export const parseCompactPrefs = (raw: string | null | undefined): CompactPrefs => {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<CompactPrefs> | null
    return {
      targets: Object.fromEntries(Object.entries(value?.targets ?? {}).filter(([, on]) => typeof on === 'boolean')),
    }
  } catch {
    return DEFAULT_COMPACT_PREFS
  }
}

/**
 * The prefs over one storage. Reading `localStorage` THROWS when a browser blocks site data, so a
 * write that cannot be stored is kept for this page instead, as tracking/connections.ts does.
 */
export const createCompactPrefs = (storage = defaultStorage()) => {
  let kept: CompactPrefs | undefined
  return {
    read: (): CompactPrefs => {
      if (kept) return kept
      try { return parseCompactPrefs(storage?.getItem(COMPACT_PREFS_KEY)) } catch { return DEFAULT_COMPACT_PREFS }
    },
    write: (prefs: CompactPrefs): void => {
      try {
        if (!storage) throw new Error('No storage')
        storage.setItem(COMPACT_PREFS_KEY, JSON.stringify(prefs))
        kept = undefined
      } catch {
        kept = prefs
      }
    },
  }
}

export type CompactPrefsStore = ReturnType<typeof createCompactPrefs>
