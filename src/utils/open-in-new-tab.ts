import { settings } from '../settings-store'

/** The setting holding whether clicking an episode row opens it in a new tab: `on`, or nothing for off. */
export const OPEN_IN_NEW_TAB_KEY = 'stub.episodes.open-in-new-tab'

/** Off unless the viewer turned it on, and off when storage cannot be read. */
export const readOpenInNewTab = (): boolean => settings.getItem(OPEN_IN_NEW_TAB_KEY) === 'on'

/** Keeps whether clicking an episode row opens in a new tab, and tells every watcher. */
export const setOpenInNewTab = (on: boolean) => {
  try {
    if (on) settings.setItem(OPEN_IN_NEW_TAB_KEY, 'on')
    else settings.removeItem(OPEN_IN_NEW_TAB_KEY)
  } catch {}
}

/** Calls `listener` whenever open episodes in a new tab changes, in this tab, in another one, or on the account. */
export const watchOpenInNewTab = (listener: () => void): () => void => settings.watch(OPEN_IN_NEW_TAB_KEY, listener)
