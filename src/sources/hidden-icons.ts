// Which sources' icons the viewer hid in Settings, a setting that follows the FKN account
// (src/settings-store.ts). A hidden icon's source is still asked and still plays: only its icon leaves the
// source links and the episode rows.

import { useEffect, useState } from 'preact/hooks'

import { settings } from '../settings-store'

/** The setting holding the origins whose icon is hidden, a JSON array. */
export const HIDDEN_ICONS_KEY = 'stub.sources.hidden-icons'

/** The origins whose icon is hidden, or none when nothing is kept or storage cannot be read. */
export const readHiddenIcons = (): string[] => {
  try {
    const kept: unknown = JSON.parse(settings.getItem(HIDDEN_ICONS_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

/** Shows or hides one source's icon, and tells every watcher. */
export const setIconShown = (origin: string, shown: boolean) => {
  const hidden = new Set(readHiddenIcons())
  if (shown) hidden.delete(origin)
  else hidden.add(origin)
  try {
    if (hidden.size) settings.setItem(HIDDEN_ICONS_KEY, JSON.stringify([...hidden]))
    else settings.removeItem(HIDDEN_ICONS_KEY)
  } catch {}
}

/** Calls `listener` whenever the hidden icons change, in this tab, in another one, or on the account. */
export const watchHiddenIcons = (listener: () => void): () => void => settings.watch(HIDDEN_ICONS_KEY, listener)

/** The hidden icons' origins, kept current. */
export const useHiddenIcons = (): ReadonlySet<string> => {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(readHiddenIcons()))
  useEffect(() => watchHiddenIcons(() => setHidden(new Set(readHiddenIcons()))), [])
  return hidden
}
