import { describe, expect, test } from 'vite-plus/test'

import { slowConnection, theaterCandidates } from '../../../src/utils/theater'

const media = (
  { title = true, description = true, trailer = false, score }:
  { title?: boolean, description?: boolean, trailer?: boolean, score?: number } = {}
) => ({
  score,
  titles: title ? [{ title: 'a title' }] : [],
  shortDescriptions: description ? [{ shortDescription: 'a description' }] : [],
  trailers: trailer ? [{ url: 'https://youtube.com/watch?v=x' }] : [],
})

describe('theaterCandidates', () => {
  // The 2026-08-16 regression, reproduced. Kitsu scores 0.3, the old gate needed >= 0.8, and every
  // record on the page was Kitsu's, so the hero rendered an empty shell over a full season row.
  test('a low-scoring source can still fill the hero', () => {
    const nodes = [media({ score: 0.3 }), media({ score: 0.3 })]
    expect(theaterCandidates(nodes)).toHaveLength(2)
    expect(nodes.some(node => (node.score ?? 0) >= 0.8)).toBe(false)
  })

  test('a media with no title or no description cannot fill the hero', () => {
    expect(theaterCandidates([media({ title: false })])).toHaveLength(0)
    expect(theaterCandidates([media({ description: false })])).toHaveLength(0)
    expect(theaterCandidates([])).toHaveLength(0)
  })

  // The hero autoplays a trailer, so one that has it is a better pick.
  test('media with a trailer are preferred when any exist', () => {
    const withTrailer = media({ trailer: true })
    const candidates = theaterCandidates([media(), withTrailer, media()])
    expect(candidates).toEqual([withTrailer])
  })

  // Preferred, not required: Kitsu carries a trailer on about half its season, and a hero with a
  // title and a description still beats no hero.
  test('falls back to media without a trailer rather than showing nothing', () => {
    expect(theaterCandidates([media(), media()])).toHaveLength(2)
  })
})

describe('slowConnection', () => {
  test('a connection read as 2G or slower is slow, and 3G is not', () => {
    expect(slowConnection({ effectiveType: 'slow-2g' })).toBe(true)
    expect(slowConnection({ effectiveType: '2g' })).toBe(true)
    expect(slowConnection({ effectiveType: '3g' })).toBe(false)
    expect(slowConnection({ effectiveType: '4g' })).toBe(false)
  })

  test('data saving is slow on any connection', () => {
    expect(slowConnection({ effectiveType: '4g', saveData: true })).toBe(true)
    expect(slowConnection({ saveData: true })).toBe(true)
  })

  test('with no connection to read, it is not slow', () => {
    expect(slowConnection(undefined)).toBe(false)
    expect(slowConnection({})).toBe(false)
  })
})
