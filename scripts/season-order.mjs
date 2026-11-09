// Plain JavaScript and import-free ON PURPOSE, for two reasons that each broke a build.
//
// It cannot reach src/generated, because ./build-anime-data.mjs loads it and runs BEFORE codegen,
// which is what src/sources/offline/normalize.ts imports. And it cannot be TypeScript: a .mjs
// importing a .ts needs Node's type stripping, which arrived in 22.18, and the deploy runner's Node
// is older. The Cloudflare build failed on `ERR_UNKNOWN_FILE_EXTENSION ".ts"` for two commits before
// this file was JS (2026-09-05, 6bf3bb1 and 44ad1a9, reproduced locally with
// `node --no-experimental-strip-types`).

/**
 * A season's records in the order the home page should paint them.
 *
 * The listing sorts on `popularity` with a stable sort and every bundled row has none, so the order
 * the bundle ships in IS the order a cold page shows. manami's dump is alphabetical, so the first
 * paint was the alphabet: "Kimi o Aisuru Ki wa Nai", "Adventure Time: Side Quests", "Aware!
 * Meisaku-kun" (measured on the shipped bundle, SUMMER 2026, 2026-09-05).
 *
 * SHARE OF THE SEASON FIRST (`pp`), then the count (`pp` ties, and a bucket laid before the shares
 * are worked out), both read at build time off the season sources the live listing reads
 * (./season-popularity.mjs). That is the order the live listing settles into, since it sorts a season
 * on the same share.
 *
 * The 1 to 10 RATING (`sc`) only breaks ties among records the count does not cover, and is the whole
 * order when the fetch failed. It is a poor proxy on its own: 37 of 219 SUMMER 2026 records carry one
 * and its top is three shows tied at a perfect 10 from a handful of votes, which is what the home
 * page painted before the counts arrived. The tail with neither keeps its arrival order, so the
 * bundle stays byte-deterministic for a given dump.
 *
 * @template {{ sc?: number, pop?: number, pp?: number }} T
 * @param {readonly T[]} records
 * @returns {T[]}
 */
export const orderSeasonBucket = records =>
  [...records].sort((a, b) => (b.pp ?? -1) - (a.pp ?? -1) || (b.pop ?? -1) - (a.pop ?? -1) || (b.sc ?? -1) - (a.sc ?? -1))
