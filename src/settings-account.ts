// src/settings-sync.ts over the page's @fkn/lib realm, the one the added sources use.

import { settings } from './settings-store'
import { settingsSync } from './settings-sync'
import { REFRESH_MS } from './tracking/account-link'
import { watchTrackerAccount } from './tracking/account-watch'
import { onTrackerAccountChange, trackerCloud } from './tracking/fkn-cloud-live'

const lock = <T>(work: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('stub:settings', work)
    : work()

/** Brings this browser's settings in line with the FKN account's: at start, and whenever the page asks again. */
export const checkSettings = settingsSync({ settings, cloud: trackerCloud, onAccountChange: onTrackerAccountChange, lock }).check

type Page = Pick<Parameters<typeof watchTrackerAccount>[0], 'page' | 'document'>

/** Checks the account's added sources and settings at start, back online, back in view, and every REFRESH_MS in view. */
export const watchAccountFiles = (checkSources: () => Promise<unknown>, page: Page = {}) => {
  const check = () => Promise.all([checkSources(), checkSettings()])
  return watchTrackerAccount({ check, focused: check, intervalMs: REFRESH_MS, ...page })
}
