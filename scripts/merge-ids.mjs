// Plain JavaScript and import-free, for the reasons ./season-order.mjs gives: ./build-anime-data.mjs
// loads it before codegen, on a Node that may not strip types.

/** The id columns besides MyAnimeList's, which keys every row. A manami row is `[mal, ...COLUMNS]`. */
export const COLUMNS = ['anilist', 'kitsu', 'anidb', 'ann']

/**
 * One row per show, carrying every catalog id the two databases agree on.
 *
 * The passes are ordered so that a contradiction always removes a row rather than resolving it. An
 * id that two sources disagree about is exactly the id most likely to weld the wrong pair together,
 * so there is no tie to break: both readings go.
 */
export const mergeIds = (armEntries, manamiRows) => {
  const rows = new Map()
  const conflicts = new Set()

  const idsOf = values => Object.fromEntries(COLUMNS.map((key, index) => [key, values[index] ?? 0]))
  const put = (mal, ids) => {
    if (!mal) return
    const existing = rows.get(mal)
    if (!existing) { rows.set(mal, { mal, ...ids }); return }
    // A disagreement on a field either side actually knows is a contradiction, and the row dies.
    if (COLUMNS.some(key => ids[key] && existing[key] && ids[key] !== existing[key])) { conflicts.add(mal); return }
    for (const key of COLUMNS) existing[key] ||= ids[key]
  }

  for (const entry of armEntries) put(entry.mal_id, idsOf([entry.anilist_id]))
  for (const [mal, ...ids] of manamiRows) put(mal, idsOf(ids))

  for (const mal of conflicts) rows.delete(mal)

  // A second pass on the OTHER columns, because the map is keyed on the MyAnimeList id and so it
  // cannot see two different shows claiming one AniList id. Counting first and deleting second is
  // what removes both sides: dropping the second occurrence as it is met would keep the first,
  // which is exactly as likely to be the wrong one.
  const ambiguous = Object.fromEntries(COLUMNS.map(key => [key, new Map()]))
  for (const row of rows.values()) {
    for (const key of COLUMNS) {
      if (row[key]) ambiguous[key].set(row[key], (ambiguous[key].get(row[key]) ?? 0) + 1)
    }
  }
  let cleared = 0
  for (const row of rows.values()) {
    for (const key of COLUMNS) {
      if (row[key] && ambiguous[key].get(row[key]) > 1) { row[key] = 0; cleared++ }
    }
  }

  const kept = [...rows.values()]
    .filter(row => COLUMNS.some(key => row[key]))
    .sort((a, b) => a.mal - b.mal)

  return { kept, conflicts: conflicts.size, cleared }
}

/**
 * One column per catalog, sorted by MyAnimeList id, that column delta-coded.
 *
 * Measured against the alternatives on the real rows: the same size after brotli as a hand-rolled
 * text encoding and 40% smaller than an array of rows, while still decoding with one JSON.parse.
 * Zero means absent, which no catalog here ever issues as a real id.
 */
export const encodeIndex = rows => {
  let previous = 0
  return {
    mal: rows.map(row => { const delta = row.mal - previous; previous = row.mal; return delta }),
    ...Object.fromEntries(COLUMNS.map(key => [key, rows.map(row => row[key])])),
  }
}
