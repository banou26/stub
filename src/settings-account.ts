// src/settings-sync.ts over the page's @fkn/lib realm, the one the added sources use.

import { resumeLanguagePick } from './i18n/languages'
import { settings } from './settings-store'
import { positionsSync, settingsSync } from './settings-sync'
import { REFRESH_MS } from './tracking/account-link'
import { watchTrackerAccount } from './tracking/account-watch'
import { onTrackerAccountChange, trackerCloud } from './tracking/fkn-cloud-live'
import { holdUpdatesWhile } from './update/gate'
import { positions } from './utils/watch-positions'

const lock = (name: string) => <T>(work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(name, work)
    : work()

const settingsAccount = settingsSync({ settings, cloud: trackerCloud, onAccountChange: onTrackerAccountChange, lock: lock('stub:settings') })
const positionsAccount = positionsSync({ settings: positions, cloud: trackerCloud, onAccountChange: onTrackerAccountChange, lock: lock('stub:positions') })
resumeLanguagePick()

holdUpdatesWhile(() => settingsAccount.unsaved() || positionsAccount.unsaved())

/** Brings this browser's settings in line with the FKN account's: at start, and whenever the page asks again. */
export const checkSettings = settingsAccount.check

/** Brings this browser's resume points in line with the FKN account's, as checkSettings does the settings. */
export const checkPositions = positionsAccount.check

type Page = Pick<Parameters<typeof watchTrackerAccount>[0], 'page' | 'document'>

/** Checks the account's added sources, settings and resume points at start, back online, back in view, and every REFRESH_MS in view. */
export const watchAccountFiles = (checkSources: () => Promise<unknown>, page: Page = {}) => {
  const check = () => Promise.all([checkSources(), checkSettings(), checkPositions()])
  return watchTrackerAccount({ check, focused: check, intervalMs: REFRESH_MS, ...page })
}
