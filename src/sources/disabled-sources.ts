// Which built-in sources the viewer turned off in Settings, kept in this browser. Every source is on
// until turned off, so an empty or unreadable value means all of them. No imports, so the settings page,
// src/worker.ts and the tests share it without bundling anything else.

/** The localStorage key holding the turned off sources' origins, a JSON array. */
export const DISABLED_SOURCES_KEY = 'stub.sources.disabled'

const listeners = new Set<() => void>()

/** The origins turned off, or none when nothing is kept or storage cannot be read. */
export const readDisabledSources = (): string[] => {
  try {
    const kept: unknown = JSON.parse(globalThis.localStorage.getItem(DISABLED_SOURCES_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

/** Turns one source on or off, and tells every watcher in this tab. */
export const setSourceEnabled = (origin: string, enabled: boolean) => {
  const disabled = new Set(readDisabledSources())
  if (enabled) disabled.delete(origin)
  else disabled.add(origin)
  try {
    if (disabled.size) globalThis.localStorage.setItem(DISABLED_SOURCES_KEY, JSON.stringify([...disabled]))
    else globalThis.localStorage.removeItem(DISABLED_SOURCES_KEY)
  } catch {}
  for (const listener of listeners) listener()
}

/** Turns every source back on. */
export const turnAllSourcesOn = () => {
  try { globalThis.localStorage.removeItem(DISABLED_SOURCES_KEY) } catch {}
  for (const listener of listeners) listener()
}

/** Calls `listener` whenever the turned off sources change, in this tab or in another one. */
export const watchDisabledSources = (listener: () => void): () => void => {
  const fromOtherTab = (event: StorageEvent) => { if (event.key === DISABLED_SOURCES_KEY || event.key === null) listener() }
  listeners.add(listener)
  globalThis.addEventListener?.('storage', fromOtherTab)
  return () => {
    listeners.delete(listener)
    globalThis.removeEventListener?.('storage', fromOtherTab)
  }
}
