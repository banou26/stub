// The failure these exist for cannot be seen from Tokyo, which is where they were written.
//
// A source that names a DAY with no time gives `2024-01-07`, and `new Date('2024-01-07')` is midnight
// UTC. Formatted in the viewer's own zone that is January 6 anywhere west of Greenwich and January 7
// everywhere east of it, so on this machine (UTC+9) the wrong version and the right one are
// indistinguishable, in every episode of every run. These tests pin the zone rather than trusting the
// one they happen to run in.
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { RELATIVE_WITHIN_DAYS, parseReleaseDate, releaseDateAttribute, releaseDateDisplay, releaseDateLabel, releaseDay } from '../../../src/utils/release-date'

const TZ = process.env.TZ

/** Node re-reads `process.env.TZ` per Date operation, so a zone can be pinned for one assertion. */
const inZone = <T>(zone: string, read: () => T): T => {
  process.env.TZ = zone
  try { return read() } finally { process.env.TZ = TZ }
}

afterEach(() => { if (TZ === undefined) delete process.env.TZ; else process.env.TZ = TZ })

describe('releaseDateLabel', () => {
  test('a day named without a time is that day everywhere, not the one before it', () => {
    // west of Greenwich is where the naive version fails, and it fails silently
    for (const zone of ['America/Los_Angeles', 'America/New_York', 'Pacific/Honolulu', 'UTC', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      expect(inZone(zone, () => releaseDateLabel('2024-01-07', { locale: 'en-US' })), zone).toBe('Jan 7, 2024')
    }
  })

  test('and the naive reading really would differ, so the test above is not vacuous', () => {
    // the control: the same instant formatted the way the bug formats it
    const naive = inZone('America/Los_Angeles', () =>
      new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date('2024-01-07')))
    expect(naive).toBe('Jan 6, 2024')
  })

  test('a value carrying a time is a real instant, so it reads where the viewer is', () => {
    // 2024-01-07T14:30Z is still the 7th in Los Angeles, and already the 8th in Tokyo
    const value = '2024-01-07T14:30:00.000Z'
    expect(inZone('America/Los_Angeles', () => releaseDateLabel(value, { locale: 'en-US' }))).toBe('Jan 7, 2024')
    expect(inZone('Asia/Tokyo', () => releaseDateLabel(value, { locale: 'en-US' }))).toBe('Jan 7, 2024')
    const late = '2024-01-07T20:00:00.000Z'
    expect(inZone('Asia/Tokyo', () => releaseDateLabel(late, { locale: 'en-US' }))).toBe('Jan 8, 2024')
  })

  test('a year or a month alone shows only what it names, in every zone', () => {
    for (const zone of ['America/Los_Angeles', 'Asia/Tokyo']) {
      expect(inZone(zone, () => releaseDateLabel('2027', { locale: 'en-US' })), zone).toBe('2027')
      expect(inZone(zone, () => releaseDateLabel('2027-03', { locale: 'en-US' })), zone).toBe('Mar 2027')
    }
  })

  test('there is nothing to show for a date nobody supplied', () => {
    for (const value of [undefined, null, '']) {
      expect(releaseDateLabel(value)).toBeUndefined()
    }
  })

  test('nor for one written in a shape nothing can read', () => {
    for (const value of ['tomorrow', 'TBA', '????-??-??', 'NaN', '2024-13-45']) {
      expect(releaseDateLabel(value), value).toBeUndefined()
    }
  })

  test('nor for a year no episode aired in, which is a parse succeeding on nonsense', () => {
    expect(releaseDateLabel('0000-01-01T00:00:00.000Z')).toBeUndefined()
    expect(releaseDateLabel('0001-01-01')).toBeUndefined()
  })

  test('but a genuinely old episode is not thrown away with them', () => {
    expect(releaseDateLabel('1963-11-23', { locale: 'en-US' })).toBe('Nov 23, 1963')
  })

  test('an episode that has not aired yet still has a date worth showing', () => {
    expect(releaseDateLabel('2099-06-01', { locale: 'en-US' })).toBe('Jun 1, 2099')
  })

  test('an unusable locale renders nothing rather than taking the row down', () => {
    expect(releaseDateLabel('2024-01-07', { locale: 'not a locale' })).toBeUndefined()
  })
})

describe('parseReleaseDate', () => {
  test('reads the instant a value names', () => {
    expect(parseReleaseDate('2024-01-07')?.toISOString()).toBe('2024-01-07T00:00:00.000Z')
    expect(parseReleaseDate('2024-01-07T14:30:00.000Z')?.toISOString()).toBe('2024-01-07T14:30:00.000Z')
  })

  test('and nothing for a value that names none', () => {
    expect(parseReleaseDate(undefined)).toBeUndefined()
    expect(parseReleaseDate('nope')).toBeUndefined()
  })
})

describe('releaseDay', () => {
  test('a media\'s date is the day it names, read in UTC', () => {
    expect(inZone('America/Los_Angeles', () => releaseDay('Fri, 24 Dec 2021 00:00:00 GMT'))).toBe('2021-12-24')
    expect(releaseDay('2017-09-26T00:00:00Z')).toBe('2017-09-26')
  })

  test('and a year or a month alone stays as precise as its source', () => {
    expect(releaseDay('2027')).toBe('2027')
    expect(releaseDay('2027-03')).toBe('2027-03')
    expect(releaseDay('0001')).toBeUndefined()
  })
})

describe('releaseDateAttribute', () => {
  test('a named day stays that day, so the attribute cannot disagree with the text', () => {
    expect(releaseDateAttribute('2024-01-07')).toBe('2024-01-07')
  })

  test('an instant is normalised, whatever shape it arrived in', () => {
    expect(releaseDateAttribute('2024-01-07T14:30:00Z')).toBe('2024-01-07T14:30:00.000Z')
    expect(releaseDateAttribute('2024-01-07T14:30:00+00:00')).toBe('2024-01-07T14:30:00.000Z')
  })

  test('and there is no attribute where there is no label', () => {
    expect(releaseDateAttribute(undefined)).toBeUndefined()
    expect(releaseDateAttribute('TBA')).toBeUndefined()
  })
})

describe('releaseDateDisplay', () => {
  const show = (value: string, now: string, zone = 'Asia/Tokyo') =>
    inZone(zone, () => releaseDateDisplay(value, { locale: 'en-US', now: new Date(now) }))

  test('an episode from today says so', () => {
    // both stamps land on 2026-09-08 in Tokyo: 18:00 and 22:00 JST. A `now` of 23:00Z would already
    // be the 9th there, which is the kind of fixture that reads as a bug in the code under test.
    expect(show('2026-09-08T09:00:00.000Z', '2026-09-08T13:00:00.000Z')).toBe('today')
  })

  test('and one from last night is yesterday, not today', () => {
    // The case elapsed-hours arithmetic gets wrong: 23:00 JST yesterday against 11:00 JST today is
    // twelve hours, which divided by a day is zero. Every reader calls it yesterday.
    expect(show('2026-09-07T14:00:00.000Z', '2026-09-08T02:00:00.000Z')).toBe('yesterday')
  })

  test('and a run of days is counted in days', () => {
    expect(show('2026-09-06T09:00:00.000Z', '2026-09-08T09:00:00.000Z')).toBe('2 days ago')
    expect(show('2026-08-25T09:00:00.000Z', '2026-09-08T09:00:00.000Z')).toBe('14 days ago')
  })

  test('until a month has passed, and then it is the date instead', () => {
    const now = '2026-09-08T09:00:00.000Z'
    expect(show('2026-08-11T09:00:00.000Z', now)).toBe('28 days ago')
    expect(show('2026-08-10T09:00:00.000Z', now)).toBe('29 days ago')
    expect(show('2026-08-09T09:00:00.000Z', now)).toBe('Aug 9, 2026')
    expect(show('2026-08-08T09:00:00.000Z', now)).toBe('Aug 8, 2026')
  })

  test('the boundary is the constant, so moving it moves the behaviour', () => {
    expect(RELATIVE_WITHIN_DAYS).toBe(30)
  })

  test('an episode that has not aired yet shows its date rather than counting backwards', () => {
    expect(show('2026-09-20T09:00:00.000Z', '2026-09-08T09:00:00.000Z')).toBe('Sep 20, 2026')
    expect(show('2026-09-09T09:00:00.000Z', '2026-09-08T09:00:00.000Z')).toBe('Sep 9, 2026')
  })

  test('a named day is counted from the day it names, in every zone', () => {
    // 2026-09-07 against a viewer whose today is 2026-09-08: yesterday, east or west
    for (const zone of ['Asia/Tokyo', 'America/Los_Angeles', 'UTC']) {
      const now = inZone(zone, () => new Date(zone === 'Asia/Tokyo' ? '2026-09-08T03:00:00.000Z' : '2026-09-08T20:00:00.000Z'))
      expect(inZone(zone, () => releaseDateDisplay('2026-09-07', { locale: 'en-US', now })), zone).toBe('yesterday')
    }
  })

  test('and an old named day falls back to the day it named, not the day before it', () => {
    expect(inZone('America/Los_Angeles', () =>
      releaseDateDisplay('2026-01-07', { locale: 'en-US', now: new Date('2026-09-08T20:00:00.000Z') }))).toBe('Jan 7, 2026')
  })

  test('there is nothing to show where there is no date', () => {
    expect(releaseDateDisplay(undefined)).toBeUndefined()
    expect(releaseDateDisplay('TBA')).toBeUndefined()
  })
})
