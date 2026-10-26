import { afterAll, describe, expect, test } from 'vite-plus/test'

import { startLanguage } from '../../../src/i18n'
import { formatCountdown } from '../../../src/utils/countdown'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('formatCountdown', () => {
  test('the two largest units it uses', () => {
    expect(formatCountdown(HOUR + 42 * MINUTE)).toBe('1 hour, 42 mins')
    expect(formatCountdown(4 * DAY + HOUR)).toBe('4 days, 1 hour')
    expect(formatCountdown(2 * DAY + 23 * HOUR)).toBe('2 days, 23 hours')
  })

  // An empty unit is skipped rather than padded. Six days and forty-two minutes out reads
  // "6 days, 42 mins", which is what the schedule actually says, not "6 days, 0 hours".
  test('an empty unit is skipped, not printed as zero', () => {
    expect(formatCountdown(6 * DAY + 42 * MINUTE)).toBe('6 days, 42 mins')
  })

  test('one unit is a coarser countdown, for the column that has room for one', () => {
    expect(formatCountdown(HOUR + 42 * MINUTE, 1)).toBe('1 hour')
    expect(formatCountdown(5 * DAY + 23 * HOUR, 1)).toBe('5 days')
  })

  test('singular and plural', () => {
    expect(formatCountdown(DAY + HOUR + MINUTE, 3)).toBe('1 day, 1 hour, 1 min')
    expect(formatCountdown(2 * DAY + 2 * HOUR, 2)).toBe('2 days, 2 hours')
  })

  test('under a minute still counts down', () => {
    expect(formatCountdown(30_000)).toBe('30 secs')
    expect(formatCountdown(MINUTE + 1_000)).toBe('1 min, 1 sec')
  })

  test('days past a month are still days', () => {
    expect(formatCountdown(45 * DAY + 3 * HOUR)).toBe('45 days, 3 hours')
  })

  // A stored schedule outlives the airing it describes, so the caller needs a way to render nothing
  // rather than "0 mins" or a negative count.
  test('a time that has passed answers nothing', () => {
    expect(formatCountdown(0)).toBeUndefined()
    expect(formatCountdown(-HOUR)).toBeUndefined()
    expect(formatCountdown(Number.NaN)).toBeUndefined()
  })
})

// stub's English has always read mins and secs, whichever English the browser writes dates in
describe('in every English', () => {
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))

  test.each(['en-US', 'en-GB', 'en-IN'])('%s reads as stub always wrote it', async locale => {
    await startLanguage({ language: 'en', languages: [locale] })
    expect([formatCountdown(HOUR + 42 * MINUTE), formatCountdown(30_000), formatCountdown(DAY + HOUR + MINUTE, 3), formatCountdown(2 * DAY + 2 * HOUR, 1)])
      .toEqual(['1 hour, 42 mins', '30 secs', '1 day, 1 hour, 1 min', '2 days'])
  })
})
