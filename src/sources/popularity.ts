// No imports, so ../../scripts/season-popularity.mjs can load it at build time with the types stripped.

/**
 * A work's `popularity`: its follower count over `most`, the largest count the same source gives a work
 * of the same season, so 1 is that source's most followed work of the season. Undefined without both.
 *
 * Over the largest rather than a rank or a percentile because the sources agree on a season's order
 * and differ by a near constant factor: Summer 2026's MyAnimeList members were 1.8 times AniList's
 * and about 90 times Kitsu's for the same show (Spearman 0.96 to 0.99, measured 2026-10-15). Dividing
 * by each source's own top removes that factor and keeps the gaps; a percentile flattens them (the
 * 75th of 150 reads 0.5 at 1% of the top's count) and depends on how long each source's list is, and
 * ranked that way the season's top ten took in shows from the middle of the table.
 */
export const shareOf = (followers: number | null | undefined, most: number | null | undefined): number | undefined =>
  followers && most ? Math.min(1, followers / most) : undefined

/**
 * One source's rows of a season with `popularity` set on each row it counts, over `most`, the season's
 * top count on that source. Left out, `most` is the largest among `rows`, so only an answer holding the
 * season's every work, or at least its most followed, may leave it out: a narrower one (a genre, a
 * format) would measure against a smaller top and overstate every row.
 */
export const withSeasonPopularity = <T extends { followers?: number | null, popularity?: number | null }>(
  rows: T[],
  most = Math.max(0, ...rows.map(row => row.followers ?? 0))
): T[] =>
  rows.map(row => {
    const popularity = shareOf(row.followers, most)
    return popularity === undefined ? row : { ...row, popularity }
  })
