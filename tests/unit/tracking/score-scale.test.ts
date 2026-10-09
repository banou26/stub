// Scores between scales. The table is AniList's own conversion, read off graphql.anilist.co on
// 2026-09-27 (see src/tracking/score-scale.ts), written here by hand and never by running the code.
import { describe, expect, test } from 'vite-plus/test'

import { isScored, nativeScore, onScale } from '../../../src/tracking/score-scale'

const SCALES = ['POINT_100', 'POINT_10_DECIMAL', 'POINT_10', 'POINT_5', 'POINT_3'] as const

// [0 to 100, POINT_10_DECIMAL, POINT_10, POINT_5, POINT_3], as AniList answered
const MEASURED: [number, number, number, number, number][] = [
  [10, 1, 1, 1, 1],
  [20, 2, 2, 1, 1],
  [30, 3, 3, 2, 1],
  [40, 4, 4, 2, 2],
  [47, 4.7, 4, 2, 2],
  [50, 5, 5, 3, 2],
  [59, 5.9, 5, 3, 2],
  [60, 6, 6, 3, 2],
  [62, 6.2, 6, 3, 3],
  [69, 6.9, 6, 3, 3],
  [70, 7, 7, 4, 3],
  [89, 8.9, 8, 4, 3],
  [90, 9, 9, 5, 3],
  [100, 10, 10, 5, 3],
]

describe('a score as a scale keeps it', () => {
  test.each(MEASURED)('%s reads as AniList reads it on every format', (score, decimal, ten, five, three) => {
    expect([
      nativeScore(score, 'POINT_100'),
      nativeScore(score, 'POINT_10_DECIMAL'),
      nativeScore(score, 'POINT_10'),
      nativeScore(score, 'POINT_5'),
      nativeScore(score, 'POINT_3'),
    ]).toEqual([score, decimal, ten, five, three])
  })

  test('a score above 0 never becomes no score, where AniList would floor 5 to a ten point 0', () => {
    expect(nativeScore(5, 'POINT_10')).toBe(1)
    expect(nativeScore(5, 'POINT_5')).toBe(1)
    expect(nativeScore(5, 'POINT_3')).toBe(1)
  })

  test('0 and null are no score', () => {
    expect(isScored(0)).toBe(false)
    expect(isScored(null)).toBe(false)
    expect(isScored(1)).toBe(true)
  })
})

describe('a score moved onto a scale', () => {
  test('lands on a value measured reading as the face it was moved to', () => {
    expect([20, 45, 70].map(score => onScale(score, 'POINT_3')), 'measured: 30 is :(, 50 is :|, 85 is :)').toEqual([30, 50, 85])
    expect([14, 85, 95].map(score => onScale(score, 'POINT_5'))).toEqual([20, 80, 100])
    expect([14, 85, 95].map(score => onScale(score, 'POINT_10'))).toEqual([10, 80, 90])
    expect([14, 85, 95].map(score => onScale(score, 'POINT_10_DECIMAL'))).toEqual([14, 85, 95])
    expect([14, 85, 95].map(score => onScale(score, 'POINT_100'))).toEqual([14, 85, 95])
  })

  test.each(SCALES)('reads back as the same score on %s, for every score there is', scale => {
    for (let score = 1; score <= 100; score++) {
      const moved = onScale(score, scale)
      expect(nativeScore(moved, scale), `${score} on ${scale}`).toBe(nativeScore(score, scale))
      expect(onScale(moved, scale), `${score} on ${scale} a second time`).toBe(moved)
    }
  })

  test('a scale this file does not know keeps 0 to 100', () => {
    expect(onScale(87, 'SOMETHING_ELSE')).toBe(87)
  })
})
