import { expect, test } from 'vite-plus/test'

import { airedDate } from '../../../src/sources/aired-date'

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000)
const schedule = (nodes: { airingAt: number, episode?: number }[]) => ({ edges: nodes.map(node => ({ node })) })

// A complete FuzzyDate is AniList's own answer and beats everything else.
test('a complete fuzzy date wins outright', () => {
  const date = airedDate({ year: 2016, month: 4, day: 7 }, undefined, 'first')
  expect(new Date(date!).toISOString()).toBe('2016-04-07T00:00:00.000Z')
})

// THE BUG THIS EXISTS FOR. airingSchedule lists what is still SCHEDULED, so for a show four episodes
// into its run edges[0] is episode 5, and reading it by position dated the media in the future.
test('the schedule is read by episode number, never by position', () => {
  const date = airedDate(
    { year: 2016, month: null, day: null },
    schedule([
      { airingAt: at('2016-05-05T00:00:00Z'), episode: 5 },
      { airingAt: at('2016-05-12T00:00:00Z'), episode: 6 },
      { airingAt: at('2016-04-07T00:00:00Z'), episode: 1 },
    ]),
    'first'
  )
  expect(new Date(date!).toISOString()).toBe('2016-04-07T00:00:00.000Z')
})

// and when no node says it is episode 1, the earliest time is still better than the first slot
test('with no episode 1 in the schedule the earliest airing wins', () => {
  const date = airedDate(
    { year: 2016, month: null, day: null },
    schedule([
      { airingAt: at('2016-05-05T00:00:00Z'), episode: 5 },
      { airingAt: at('2016-04-21T00:00:00Z'), episode: 3 },
    ]),
    'first'
  )
  expect(new Date(date!).toISOString()).toBe('2016-04-21T00:00:00.000Z')
})

test('the last end reads the latest airing, not the last slot', () => {
  const date = airedDate(
    undefined,
    schedule([
      { airingAt: at('2016-06-30T00:00:00Z'), episode: 12 },
      { airingAt: at('2016-05-05T00:00:00Z'), episode: 5 },
    ]),
    'last'
  )
  expect(new Date(date!).toISOString()).toBe('2016-06-30T00:00:00.000Z')
})

// THE OTHER HALF OF THE BUG. A finished show has no schedule left, and the old code emitted nothing at
// all for 42% of entries. A cluster with no date carries no year, and fuzzyMergeMediaClusters only
// compares clusters sharing a year, so it was never compared with anything and silently never merged.
test('a finished show with no schedule still gets its date from the fuzzy date', () => {
  const date = airedDate({ year: 1998, month: 4, day: 3 }, { edges: [] }, 'first')
  expect(new Date(date!).toISOString()).toBe('1998-04-03T00:00:00.000Z')
})

// A year alone still buckets correctly, and January 1 is the shape every other source in this codebase
// uses for a year it cannot refine, which is what the precision guards elsewhere look for.
test('a year-only fuzzy date is coerced rather than dropped', () => {
  const date = airedDate({ year: 1998, month: null, day: null }, undefined, 'first')
  expect(new Date(date!).toISOString()).toBe('1998-01-01T00:00:00.000Z')
})

// The property anilist/extractor.ts `fetchMedia` depends on, and the one its hand-rolled date got
// wrong until 2026-08-31: a PARTIAL fuzzy date must not be completed with an invented day while a
// real airing time is sitting in the same payload. AniList knows the day for 27367 of 29722 entries
// and says null for the other 2355; `day ?? 1` turned every one of those into the 1st, which is the
// shape the first-of-month guards downstream discard. Reaching the schedule keeps a real date.
test('a month without a day takes the schedule, never the 1st of that month', () => {
  const date = airedDate(
    { year: 2016, month: 4, day: null },
    schedule([{ airingAt: at('2016-04-07T00:00:00Z'), episode: 1 }]),
    'first'
  )
  expect(new Date(date!).toISOString()).toBe('2016-04-07T00:00:00.000Z')
  expect(new Date(date!).toISOString()).not.toBe('2016-04-01T00:00:00.000Z')
})

// and with no schedule to reach for there is nothing better than the coercion, which is the sentinel
// rather than a claim about the day
test('a month without a day and no schedule falls back to the 1st, as the sentinel', () => {
  const date = airedDate({ year: 2016, month: 4, day: null }, { edges: [] }, 'first')
  expect(new Date(date!).toISOString()).toBe('2016-04-01T00:00:00.000Z')
})

// AniList knows only the year of 28 films not out yet (2026-10-16): the page shows "2027", not a January 1
// nobody named, while every reader that parses it still gets the first of that year or month
test('a year or a month alone keeps its precision, and still parses to the first of it', () => {
  expect(airedDate({ year: 2027, month: null, day: null }, undefined, 'first')).toBe('2027')
  expect(airedDate({ year: 2016, month: 4, day: null }, { edges: [] }, 'first')).toBe('2016-04')
  expect(new Date(airedDate({ year: 2027 }, undefined, 'last')!).toISOString()).toBe('2027-01-01T00:00:00.000Z')
})

test('nothing at all is undefined, never a guess', () => {
  expect(airedDate(undefined, undefined, 'first')).toBeUndefined()
  expect(airedDate({ year: null, month: null, day: null }, { edges: [] }, 'first')).toBeUndefined()
})

// an edge carrying no airingAt is not a date, and must not be counted as one
test('schedule entries with no time are skipped', () => {
  const date = airedDate(
    { year: 2016, month: null, day: null },
    { edges: [{ node: { airingAt: null, episode: 1 } }, { node: { airingAt: at('2016-04-07T00:00:00Z'), episode: 2 } }] },
    'first'
  )
  expect(new Date(date!).toISOString()).toBe('2016-04-07T00:00:00.000Z')
})
