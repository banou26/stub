// Which sources, built in or added, the viewer turned off in Settings, a setting that follows the FKN account
// (src/settings-store.ts). Every source is on until turned off, so an empty or unreadable value means all
// of them. Import free but for the settings store, so the settings page, src/worker.ts and the tests
// share it without bundling anything else.

import { settings } from '../settings-store'

/** The setting holding the turned off sources' origins, a JSON array. */
export const DISABLED_SOURCES_KEY = 'stub.sources.disabled'

/** The origins turned off, or none when nothing is kept or storage cannot be read. */
export const readDisabledSources = (): string[] => {
  try {
    const kept: unknown = JSON.parse(settings.getItem(DISABLED_SOURCES_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

const keep = (disabled: Set<string>) => {
  try {
    if (disabled.size) settings.setItem(DISABLED_SOURCES_KEY, JSON.stringify([...disabled]))
    else settings.removeItem(DISABLED_SOURCES_KEY)
  } catch {}
}

/** Turns one source on or off, and tells every watcher. */
export const setSourceEnabled = (origin: string, enabled: boolean) => {
  const disabled = new Set(readDisabledSources())
  if (enabled) disabled.delete(origin)
  else disabled.add(origin)
  keep(disabled)
}

/** Turns these sources back on, leaving off any other: a site that does not list a source never turns it on. */
export const turnSourcesOn = (origins: readonly string[]) =>
  keep(new Set(readDisabledSources().filter(origin => !origins.includes(origin))))

/** Calls `listener` whenever the turned off sources change, in this tab, in another one, or on the account. */
export const watchDisabledSources = (listener: () => void): () => void => settings.watch(DISABLED_SOURCES_KEY, listener)
