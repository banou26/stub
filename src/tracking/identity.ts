// What stub's own tracker knows a media by. Import free apart from the pure uri and catalogue readers,
// so the rules can be pinned under vitest.

import type { CatalogRow, IndexedOrigin } from '../sources/offline/index-lookup'

import { catalogRefs, INDEXED_ORIGINS } from '../sources/offline/index-lookup'
import { origin as offlineOrigin } from '../sources/offline/normalize'
import { fromAggregatedUri, fromUri, isAggregatedUri, isUri, type UriValues } from '../utils/uri'

/** The part of the offline catalogue the identity reads: one row per run, one id per catalogue. */
export type CatalogLookup = { lookup: (origin: IndexedOrigin, id: number) => CatalogRow | undefined }

/**
 * How a media is addressed in the stub tracker.
 *
 * - `catalogue`: the media names at least one catalogue id (anilist, mal, kitsu, anidb). Every
 *   catalogue keeps one entry per RUN, so these are the ids an entry is matched on. `ids` is widened
 *   through the offline catalogue, so a media known by its MyAnimeList id finds the entry saved under
 *   its AniList one. `keys` is only there to find an entry saved before the media had any.
 * - `keys`: no catalogue id. `keys` holds the most specific id of each origin, and an entry is matched
 *   when its key EQUALS one of them. Never by overlap: a season shares its show-level id with every
 *   other season of the show.
 * - `ambiguous`: the media names two things and there is no telling which entry is meant, so the
 *   tracker refuses writes and lists them. Either two ids of one origin where neither extends the
 *   other, or catalogue ids the offline catalogue places in two different runs: a cluster that welded
 *   season 1's AniList id to season 2's MyAnimeList id.
 * - `none`: nothing to key on.
 */
export type MediaIdentity =
  | { kind: 'catalogue', ids: string[], keys: string[] }
  | { kind: 'keys', keys: string[] }
  | { kind: 'ambiguous', candidates: string[] }
  | { kind: 'none' }

const handlesOf = (uri: string): UriValues[] =>
  isAggregatedUri(uri) ? fromAggregatedUri(uri)?.handleUrisValues ?? []
  : isUri(uri) ? [fromUri(uri)]
  : []

const extends_ = (longer: string, shorter: string) => longer === shorter || longer.startsWith(`${shorter}-`)

/**
 * The one id of an origin a media is about, or every id when they disagree.
 *
 * Specificity is prefix extension, the same rule `extractAggregatedUriOrigin` uses: `cr:X-GS1` is a
 * part of `cr:X`, so a season beside its show is the season. Two ids where neither extends the other
 * are two different things, and picking one would be a guess.
 */
const mostSpecific = (ids: string[]): { id: string } | { ambiguous: string[] } => {
  const sorted = [...new Set(ids)].sort((a, b) => a.length - b.length || a.localeCompare(b))
  for (let index = 1; index < sorted.length; index++) {
    if (!extends_(sorted[index]!, sorted[index - 1]!)) return { ambiguous: sorted }
  }
  return { id: sorted.at(-1)! }
}

const CATALOGUE = new Set<string>(INDEXED_ORIGINS)

export const identify = (uri: string, catalog?: CatalogLookup): MediaIdentity => {
  const handles = handlesOf(uri)

  // the catalogue ids the media names itself, including the offline source's borrowed `offline:mal-1`
  const refs = catalogRefs(handles, offlineOrigin)
  const own = new Map<IndexedOrigin, Set<number>>()
  for (const ref of refs) own.set(ref.origin, (own.get(ref.origin) ?? new Set()).add(ref.id))
  for (const [origin, ids] of own) {
    if (ids.size > 1) return { kind: 'ambiguous', candidates: [...ids].sort((a, b) => a - b).map(id => `${origin}:${id}`) }
  }

  const keys: string[] = []
  const ambiguousKeys: string[][] = []
  const byOrigin = new Map<string, string[]>()
  for (const handle of handles) {
    if (CATALOGUE.has(handle.origin) || handle.origin === offlineOrigin) continue
    byOrigin.set(handle.origin, [...byOrigin.get(handle.origin) ?? [], handle.id])
  }
  for (const [origin, ids] of [...byOrigin].sort(([a], [b]) => a.localeCompare(b))) {
    const picked = mostSpecific(ids)
    if ('id' in picked) keys.push(`${origin}:${picked.id}`)
    else ambiguousKeys.push(picked.ambiguous.map(id => `${origin}:${id}`))
  }

  if (own.size) {
    const named = [...own].map(([origin, set]) => ({ origin, id: [...set][0]! }))
    const rows = refs.flatMap(ref => catalog?.lookup(ref.origin, ref.id) ?? [])
    const row = rows[0]
    // The catalogue holds every id in one row only (24,077 rows, no id in two, measured 2026-09-27), so
    // two rows, or a row naming another id for a catalogue the media names, are two runs in one
    // cluster. Keeping both would link them in the entry for good, and every later save widens it.
    const welded = rows.some(other => INDEXED_ORIGINS.some(origin => other[origin] !== row![origin]))
      || Boolean(row && named.some(({ origin, id }) => row[origin] && row[origin] !== id))
    if (welded) return { kind: 'ambiguous', candidates: named.map(({ origin, id }) => `${origin}:${id}`).sort() }
    // WIDENED, and only where the media is silent: the row fills in the catalogues it does not name
    const ids = [
      ...named.map(({ origin, id }) => `${origin}:${id}`),
      ...row ? INDEXED_ORIGINS.filter(origin => row[origin] && !own.has(origin)).map(origin => `${origin}:${row[origin]}`) : [],
    ].sort()
    return { kind: 'catalogue', ids, keys }
  }

  if (ambiguousKeys.length) return { kind: 'ambiguous', candidates: ambiguousKeys.flat() }
  if (keys.length) return { kind: 'keys', keys }
  return { kind: 'none' }
}

/** What an entry stores about the media it tracks. */
export type EntryIdentity = { ids: string[], key?: string }

/**
 * Whether an entry is the one this media is tracked under.
 *
 * An entry that carries catalogue ids is matched on those alone. An entry saved while its media had
 * none carries only its key, and is matched by that key's equality with the media's most specific id
 * of the same origin, whatever the media has gained since.
 */
export const entryMatches = (entry: EntryIdentity, identity: MediaIdentity): boolean => {
  if (identity.kind === 'catalogue') {
    return entry.ids.length
      ? entry.ids.some(id => identity.ids.includes(id))
      : Boolean(entry.key && identity.keys.includes(entry.key))
  }
  if (identity.kind === 'keys') return Boolean(entry.key && identity.keys.includes(entry.key))
  return false
}

/** What a new entry for this media stores. Only for an identity that can hold one. */
export const newEntryIdentity = (identity: Extract<MediaIdentity, { kind: 'catalogue' | 'keys' }>): EntryIdentity =>
  identity.kind === 'catalogue'
    ? { ids: identity.ids }
    : { ids: [], key: identity.keys[0] }

const SHOWN_FIRST = ['anilist', 'mal', 'kitsu', 'anidb']

/** The id an entry is shown as keyed on, for `ListEntry.mediaUri`. */
export const entryMediaUri = (entry: EntryIdentity): string | null => {
  for (const origin of SHOWN_FIRST) {
    const id = entry.ids.find(candidate => candidate.startsWith(`${origin}:`))
    if (id) return id
  }
  return entry.key ?? null
}
