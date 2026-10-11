// Reading the generated cross-catalog id index. Pure, and kept out of the extractor so it can be
// tested without the generated module, which only exists after `npm run data:build`.

/** The generated bundle: parallel columns, with `mal` delta-coded against the previous row. */
export type IndexBundle = {
  mal: number[]
  anilist: number[]
  kitsu: number[]
  anidb: number[]
  /** Anime News Network, carried for its handle and never looked up by, so tracking ids are unchanged. */
  ann?: number[]
}

export type CatalogRow = {
  mal: number
  anilist: number
  kitsu: number
  anidb: number
  ann?: number
}

/** The origins this index can answer about, which are exactly the columns the build emits. */
export const INDEXED_ORIGINS = ['mal', 'anilist', 'kitsu', 'anidb'] as const
export type IndexedOrigin = (typeof INDEXED_ORIGINS)[number]

export type CatalogIndex = {
  size: number
  lookup: (origin: IndexedOrigin, id: number) => CatalogRow | undefined
}

/**
 * Undo the delta coding and build one map per catalog.
 *
 * The `mal` column is stored as the difference from the previous row, which is what makes the
 * shipped artifact 40% smaller than an array of rows after brotli. A zero means the row carries no
 * MyAnimeList id at all, and must NOT advance the running total: treating it as a delta of zero
 * would be indistinguishable from a repeat, but treating it as a value would corrupt every id after
 * it. Absence and zero-delta are the same byte here only because a real id is never zero.
 *
 * Built once and reused, because a lookup happens per media resolution and rebuilding the maps each
 * time would be the expensive part rather than the reading.
 */
export const readIndex = (bundle: IndexBundle): CatalogIndex => {
  const maps: Record<IndexedOrigin, Map<number, number>> = {
    mal: new Map(),
    anilist: new Map(),
    kitsu: new Map(),
    anidb: new Map(),
  }

  const mal: number[] = []
  let running = 0
  for (let row = 0; row < bundle.mal.length; row++) {
    const delta = bundle.mal[row]!
    const id = delta ? (running += delta) : 0
    mal.push(id)
    if (id) maps.mal.set(id, row)
    for (const origin of ['anilist', 'kitsu', 'anidb'] as const) {
      const value = bundle[origin][row]
      if (value) maps[origin].set(value, row)
    }
  }

  const rowAt = (row: number): CatalogRow => ({
    mal: mal[row] ?? 0,
    anilist: bundle.anilist[row] ?? 0,
    kitsu: bundle.kitsu[row] ?? 0,
    anidb: bundle.anidb[row] ?? 0,
    ann: bundle.ann?.[row] ?? 0,
  })

  return {
    size: mal.length,
    lookup: (origin, id) => {
      const row = maps[origin]?.get(id)
      return row === undefined ? undefined : rowAt(row)
    },
  }
}

/**
 * A stable id for a row, matching the scheme the seasonal records use.
 *
 * This is what makes the two halves of this source ONE node rather than two. A show in the current
 * season is described by a seasonal record carrying a title and a cover, and by an index row
 * carrying nothing but ids. Both resolve to `offline:mal-<id>`, so the graph sees one media that
 * happens to have been supplied twice, instead of two that have to be merged.
 */
export const rowId = (row: CatalogRow): string | undefined =>
  row.mal ? `mal-${row.mal}`
  : row.anilist ? `anilist-${row.anilist}`
  : row.kitsu ? `kitsu-${row.kitsu}`
  : row.anidb ? `anidb-${row.anidb}`
  : undefined

const BORROWED_ID = /^([a-z]+)-(\d+)$/

/**
 * Every catalogue row a uri points at, including through this source's own borrowed id.
 *
 * The second half is what makes the index reachable at all, and it is not obvious. This source's id
 * is borrowed from a catalogue (`mal-59193`), and as soon as it contributes once, `offline:mal-59193`
 * is part of the cluster's aggregated uri forever. A resolver that saw its own origin and stopped
 * there would answer from the seasonal bundle or not at all, so a show outside the season window
 * would resolve to nothing even though the index holds its row, and the index would never load.
 * Measured against the deployed build: the first season card resolves to
 * `ag:(anilist:178789,kitsu:49002,mal:59193,offline:mal-59193)`, so the own-origin branch is the
 * common case rather than an edge one.
 *
 * `ownOrigin` is passed rather than imported to keep this module free of the extractor.
 */
export const catalogRefs = (
  uris: readonly { origin: string, id: string }[],
  ownOrigin: string,
): { origin: IndexedOrigin, id: number }[] => {
  const refs: { origin: IndexedOrigin, id: number }[] = []
  const seen = new Set<string>()
  for (const uri of uris) {
    const [rawOrigin, rawId] =
      uri.origin === ownOrigin
        ? (BORROWED_ID.exec(uri.id)?.slice(1, 3) ?? [])
        : [uri.origin, uri.id]
    if (!rawOrigin || !rawId) continue
    if (!INDEXED_ORIGINS.includes(rawOrigin as IndexedOrigin)) continue
    const id = Number(rawId)
    if (!Number.isInteger(id) || id <= 0) continue
    const key = `${rawOrigin}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    refs.push({ origin: rawOrigin as IndexedOrigin, id })
  }
  return refs
}
