import { settings } from '../settings-store'

export type WatchSourceView = 'cards' | 'list'

/** The setting holding the `/watch` sources display mode: `list`, or nothing for `cards`. */
export const WATCH_SOURCE_VIEW_KEY = 'stub.watch.source-view'

/** Cards unless the viewer picked unified List view, and cards when storage cannot be read. */
export const readWatchSourceView = (): WatchSourceView => settings.getItem(WATCH_SOURCE_VIEW_KEY) === 'list' ? 'list' : 'cards'

/** Keeps the `/watch` sources display mode and tells every watcher. */
export const setWatchSourceView = (view: WatchSourceView) => {
  try {
    if (view === 'list') settings.setItem(WATCH_SOURCE_VIEW_KEY, 'list')
    else settings.removeItem(WATCH_SOURCE_VIEW_KEY)
  } catch {}
}

/** Calls `listener` whenever the `/watch` sources display mode changes, in this tab, in another one, or on the account. */
export const watchWatchSourceView = (listener: () => void): () => void => settings.watch(WATCH_SOURCE_VIEW_KEY, listener)
