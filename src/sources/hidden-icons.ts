// Which sources' icons the viewer hid in Settings, kept in this browser. A hidden icon's source is still
// asked and still plays: only its icon leaves the source links and the episode rows.

import { useEffect, useState } from 'preact/hooks'

/** The localStorage key holding the origins whose icon is hidden, a JSON array. */
export const HIDDEN_ICONS_KEY = 'stub.sources.hidden-icons'

const listeners = new Set<() => void>()

/** The origins whose icon is hidden, or none when nothing is kept or storage cannot be read. */
export const readHiddenIcons = (): string[] => {
  try {
    const kept: unknown = JSON.parse(globalThis.localStorage.getItem(HIDDEN_ICONS_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

/** Shows or hides one source's icon, and tells every watcher in this tab. */
export const setIconShown = (origin: string, shown: boolean) => {
  const hidden = new Set(readHiddenIcons())
  if (shown) hidden.delete(origin)
  else hidden.add(origin)
  try {
    if (hidden.size) globalThis.localStorage.setItem(HIDDEN_ICONS_KEY, JSON.stringify([...hidden]))
    else globalThis.localStorage.removeItem(HIDDEN_ICONS_KEY)
  } catch {}
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the hidden icons change, in this tab or in another one. */
export const watchHiddenIcons = (listener: () => void): () => void => {
  const fromOtherTab = (event: StorageEvent) => { if (event.key === HIDDEN_ICONS_KEY || event.key === null) listener() }
  listeners.add(listener)
  globalThis.addEventListener?.('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', fromOtherTab)
  }
}

/** The hidden icons' origins, kept current. */
export const useHiddenIcons = (): ReadonlySet<string> => {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(readHiddenIcons()))
  useEffect(() => watchHiddenIcons(() => setHidden(new Set(readHiddenIcons()))), [])
  return hidden
}
