// The order the merge weighs the built-in sources in, as the viewer set it in Settings, a setting that follows the FKN
// account (src/settings-store.ts). Import free but for the settings store, so the settings page, src/worker.ts, the
// worker's merge and the privacy page share it.

import { settings } from '../settings-store'

/** The setting holding the viewer's merge order, a JSON array of origins, best first. */
export const MERGE_ORDER_KEY = 'stub.sources.merge-order'

/**
 * The built-in sources whose answers are merged, each with the score its answers carry, best first: the merge until
 * the viewer moves one. MyAnimeList ties AniZip and comes first, as AniZip's media row carries no score of its own and
 * the merge sorts an unscored row last. tests/unit/sources/merge-order.test.ts pins each score to its extractor's.
 */
export const DEFAULT_MERGE: readonly (readonly [origin: string, score: number])[] = [
  ['mal', 0.9], ['anizip', 0.9], ['anilist', 0.8], ['livechart', 0.6], ['cr', 0.5],
  ['kitsu', 0.3], ['omdb', 0.3], ['simkl', 0.3], ['tmdb', 0.3], ['trakt', 0.3], ['tvdb', 0.3], ['tvmaze', 0.3],
  ['watchmode', 0.25], ['ann', 0.2], ['appletv', 0.2], ['jw', 0.2], ['nf', 0.2], ['offline', 0.2], ['paramount', 0.2],
]

export const DEFAULT_MERGE_ORDER: readonly string[] = DEFAULT_MERGE.map(([origin]) => origin)

/** The kept order, or none when nothing is kept or storage cannot be read. */
export const readMergeOrder = (): string[] => {
  try {
    const kept: unknown = JSON.parse(settings.getItem(MERGE_ORDER_KEY) ?? '[]')
    return Array.isArray(kept) ? kept.filter((origin): origin is string => typeof origin === 'string') : []
  } catch {
    return []
  }
}

/** Keeps `order`, and tells every watcher. */
export const writeMergeOrder = (order: readonly string[]) => {
  try { settings.setItem(MERGE_ORDER_KEY, JSON.stringify(order)) } catch {}
}

/** Calls `listener` whenever the merge order changes, in this tab, in another one, or on the account. */
export const watchMergeOrder = (listener: () => void): () => void => settings.watch(MERGE_ORDER_KEY, listener)

/** The order the merge follows: the built-in sources the kept order names, then the others in the default order. */
export const mergeOrder = (kept: readonly string[]): string[] =>
  [...new Set([...kept.filter(origin => DEFAULT_MERGE_ORDER.includes(origin)), ...DEFAULT_MERGE_ORDER])]

let held: string[] = []

/** Holds the kept order in the worker, as src/worker.ts hands it over, and says whether the order followed changed. */
export const holdMergeOrder = (kept: readonly string[]): boolean => {
  const changed = mergeOrder(kept).join() !== mergeOrder(held).join()
  held = [...kept]
  return changed
}

/** The kept order the worker holds, none until src/worker.ts hands one over. */
export const heldMergeOrder = (): readonly string[] => held
