// A score as each tracker keeps it. On the wire every score is 0 to 100 (`ListEntry.score`); a tracker
// keeps it in a scale of its own, and the viewer reads it there. Import free, so the conversions are
// pinned under vitest.
//
// The scales are AniList's five formats, and a score moves between them the way AniList's own server
// moves it. MEASURED on graphql.anilist.co, 2026-09-27, by reading public list entries with
// `score(format:)` in all five formats side by side:
//
//   0 to 100          5    10   20   30   40   47   50   59   60   62   69   70   89   90   100
//   POINT_10_DECIMAL  0.5  1    2    3    4    4.7  5    5.9  6    6.2  6.9  7    8.9  9    10
//   POINT_10          0    1    2    3    4    4    5    5    6    6    6    7    8    9    10
//   POINT_5           1    1    1    2    2    2    3    3    3    3    3    4    4    5    5
//   POINT_3           1    1    1    1    2    2    2    2    2    3    3    3    3    3    3
//
// and a POINT_3 user's :) read back as 85. What was NOT measured: where POINT_3 turns from 1 to 2
// between 31 and 39, and which side of the line 61 falls. `raw` below only ever writes values that
// were measured landing on their face, so a sync never depends on either.

type Scale = {
  /** How far apart two neighbouring scores of the scale sit on 0 to 100. The coarser scale has the larger. */
  step: number
  /** A score above 0 as the scale keeps it. Never 0, which every scale reads as no score. */
  native: (score: number) => number
  /** A score the scale keeps, back on 0 to 100, at a value that reads as that score again. */
  raw: (native: number) => number
}

const atLeastOne = (value: number) => Math.max(1, value)

const SCALES: Record<string, Scale> = {
  POINT_100: { step: 1, native: score => Math.round(score), raw: native => native },
  POINT_10_DECIMAL: { step: 1, native: score => Math.round(score) / 10, raw: native => Math.round(native * 10) },
  // AniList floors here, so 1 to 9 would read as no score: a score is never turned into none
  POINT_10: { step: 10, native: score => atLeastOne(Math.floor(score / 10)), raw: native => native * 10 },
  POINT_5: { step: 20, native: score => atLeastOne(Math.round(score / 20)), raw: native => native * 20 },
  POINT_3: { step: 33, native: score => score < 36 ? 1 : score < 61 ? 2 : 3, raw: native => [30, 50, 85][native - 1] ?? 85 },
}

/** The scale a tracker names, or 0 to 100 for one this file does not know. */
const scaleOf = (scale: string | null | undefined) => SCALES[scale ?? ''] ?? SCALES.POINT_100!

/** Whether a 0 to 100 score is a score at all. 0 is AniList's "no score", and every scale reads it so. */
export const isScored = (score: number | null | undefined): score is number => score != null && score > 0

/** A 0 to 100 score as `scale` keeps it: 85 is 8.5 on POINT_10_DECIMAL, 8 on POINT_10, 4 on POINT_5. */
export const nativeScore = (score: number, scale: string | null | undefined) => scaleOf(scale).native(score)

/**
 * A 0 to 100 score moved onto `scale`: the 0 to 100 value the scale holds once it keeps the score,
 * which is what a write to a tracker on that scale sends, so the tracker keeps exactly what was shown.
 */
export const onScale = (score: number, scale: string | null | undefined) => {
  const { native, raw } = scaleOf(scale)
  return raw(native(score))
}

/** The coarser of two scales, which is where two scores kept on them are compared. */
export const coarser = (a: string | null | undefined, b: string | null | undefined) =>
  scaleOf(b).step > scaleOf(a).step ? b : a

/**
 * Whether two 0 to 100 scores say the same thing, compared at the coarsest of the scales they were
 * kept on: AniList's 85 and a ten point 8 are one score, since 85 is 8 on that scale.
 */
export const sameScore = (a: number, b: number, scales: readonly (string | null | undefined)[]) => {
  const scale = scales.reduce<string | null | undefined>(coarser, 'POINT_100')
  return nativeScore(a, scale) === nativeScore(b, scale)
}

/** A score in a scale's own terms, as AniList shows it to the viewer. Null for no score. */
export const scoreLabel = (score: number | null | undefined, format: string): string | null => {
  if (!score) return null
  switch (format) {
    case 'POINT_10_DECIMAL': return `${score.toFixed(1)} / 10`
    case 'POINT_10': return `${Math.round(score)} / 10`
    case 'POINT_5': return `${Math.round(score)} / 5`
    case 'POINT_3': return [':(', ':|', ':)'][Math.round(score) - 1] ?? `${score} / 3`
    default: return `${Math.round(score)} / 100`
  }
}
