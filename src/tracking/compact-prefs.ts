// What the compact tracking row remembers: the trackers the viewer chose not to write to, and whether
// the trackers show in full, a setting that follows the FKN account (src/settings-store.ts). Not per
// media: it is how this viewer likes to write.

import { settings } from '../settings-store'

export type CompactPrefs = {
  /** Only the choices the viewer made. A tracker missing here is written to when it can be. */
  targets: Record<string, boolean>
  /** The trackers as full chips rather than a grid of small tiles. */
  expanded?: boolean
}

export const COMPACT_PREFS_KEY = 'stub.tracking.compact'

export const DEFAULT_COMPACT_PREFS: CompactPrefs = { targets: {} }

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** A stored or hand-edited value as prefs, falling back to the defaults field by field rather than throwing. */
export const parseCompactPrefs = (raw: string | null | undefined): CompactPrefs => {
  try {
    const value = JSON.parse(raw ?? 'null') as Partial<CompactPrefs> | null
    return {
      targets: Object.fromEntries(Object.entries(value?.targets ?? {}).filter(([, on]) => typeof on === 'boolean')),
      ...value?.expanded === true ? { expanded: true } : {},
    }
  } catch {
    return DEFAULT_COMPACT_PREFS
  }
}

/**
 * The prefs over one storage. A write that cannot be stored, where a browser blocks site data, is kept
 * for this page instead, as tracking/connections.ts does.
 */
export const createCompactPrefs = (storage: StorageLike | undefined = settings) => {
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

/** The viewer's prefs, one store for every reader on the page: where storage is blocked, a choice lives in it alone. */
export const viewerPrefs = createCompactPrefs()

/** Calls `listener` whenever the prefs change, in this tab, in another one, or on the account. */
export const watchCompactPrefs = (listener: () => void): () => void => settings.watch(COMPACT_PREFS_KEY, listener)
