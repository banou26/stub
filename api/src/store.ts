import type { Site } from '../../src/site'
import type { UriValues } from '../../src/utils/uri'

/** What stub draws of a show: its first title, its longest description, its first cover and banner. */
export type Entry = { uri: string, title: string, description?: string, cover?: string, banner?: string, color?: string }

/** The part of a KV namespace binding the store reads through. */
export type Store = { get: (keys: string[], options: { type: 'json', cacheTtl: number }) => Promise<Map<string, unknown>> }

// KV "Limits": a bulk read takes at most 100 keys, and a key is at most 512 bytes
const MAX_KEYS = 100
const MAX_KEY_BYTES = 512
const CACHE_TTL_S = 3_600

const keysOf = (site: Site, ids: UriValues[]) =>
  ids.map(({ origin, id }) => `${site}/${origin}:${id}`).filter(key => new TextEncoder().encode(key).length <= MAX_KEY_BYTES).slice(0, MAX_KEYS)

/**
 * The store's answer for any of `ids` on `site`, in their order, through one bulk read. An answer is kept under
 * `<site>/<origin>:<id>` for each id of the address it settled on, so a later address naming any one of them finds it.
 */
export const readStore = async (store: Store, site: Site, ids: UriValues[]): Promise<Entry | undefined> => {
  const keys = keysOf(site, ids)
  if (!keys.length) return undefined
  const found = await store.get(keys, { type: 'json', cacheTtl: CACHE_TTL_S })
  for (const key of keys) {
    const value = found.get(key) as Partial<Entry> | null | undefined
    if (typeof value?.uri !== 'string' || typeof value.title !== 'string') continue
    const { uri, title, description, cover, banner, color } = value
    return { uri, title, description, cover, banner, color }
  }
  return undefined
}
