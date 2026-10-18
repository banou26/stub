// The order Play tries sources in, as the viewer set it in Settings, a setting that follows the FKN account
// (src/settings-store.ts). Import free but for the settings store, so the privacy page and src/settings-sync.ts
// can name its key without bundling anything else.

import { settings } from '../settings-store'

/** The setting holding the viewer's play order, a JSON array of origins, best first. */
export const PLAY_ORDER_KEY = 'stub.sources.play-order'

/** stub's own players, in the order Play tries them until the viewer moves one. */
export const DEFAULT_PLAY_ORDER: readonly string[] = ['cr', 'amazon', 'nf']

/** The kept order, or none when nothing is kept or storage cannot be read. */
export const readPlayOrder = (): string[] => {
  try {
    const kept: unknown = JSON.parse(settings.getItem(PLAY_ORDER_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

/** Keeps `order`, and tells every watcher. */
export const writePlayOrder = (order: readonly string[]) => {
  try { settings.setItem(PLAY_ORDER_KEY, JSON.stringify(order)) } catch {}
}

/** Calls `listener` whenever the play order changes, in this tab, in another one, or on the account. */
export const watchPlayOrder = (listener: () => void): () => void => settings.watch(PLAY_ORDER_KEY, listener)

/** The order Play walks: the kept one, then stub's players never moved, then the added sources in the order added. */
export const playOrder = (kept: readonly string[], added: readonly string[]): string[] =>
  [...new Set([...kept, ...DEFAULT_PLAY_ORDER, ...added])]

/**
 * `order` with `origin` moved just past the nearest origin of `shown` above it (`-1`) or below it (`1`), so
 * every other pair keeps its order, an origin the list does not show included. Unchanged at either end.
 */
export const moved = (order: readonly string[], origin: string, step: -1 | 1, shown: readonly string[] = order): string[] => {
  const past = shown[shown.indexOf(origin) + step]
  if (!past || !shown.includes(origin)) return [...order]
  const next = order.filter(other => other !== origin)
  next.splice(next.indexOf(past) + (step > 0 ? 1 : 0), 0, origin)
  return next
}
