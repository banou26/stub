import { afterAll, describe, expect, test } from 'vite-plus/test'

import { airsIn, episodesLabel } from '../../../src/components/listed-media'
import { startLanguage } from '../../../src/i18n'

const NOW = Date.parse('2026-09-06T12:00:00Z')

describe('airsIn', () => {
  test('the milliseconds left until the scheduled episode', () => {
    const media = { nextAiringEpisode: { episodeNumber: 11, airingAt: 'Sun, 06 Sep 2026 15:30:00 GMT' } }
    expect(airsIn(media, NOW)).toBe(3.5 * 60 * 60 * 1000)
  })

  test('a schedule that has passed answers a negative, which the formatter refuses', () => {
    const media = { nextAiringEpisode: { episodeNumber: 11, airingAt: 'Sun, 06 Sep 2026 09:00:00 GMT' } }
    expect(airsIn(media, NOW)).toBeLessThan(0)
  })

  test('nothing scheduled, and an unparseable date, both answer nothing', () => {
    expect(airsIn({ nextAiringEpisode: null }, NOW)).toBeUndefined()
    expect(airsIn({ nextAiringEpisode: undefined }, NOW)).toBeUndefined()
    expect(airsIn({ nextAiringEpisode: { episodeNumber: 1, airingAt: 'soon' } }, NOW)).toBeUndefined()
  })
})

// A one-episode film read "1 episodes" on both new modes until this existed.
describe('episodesLabel', () => {
  test('singular and plural, and nothing for a count no source published', () => {
    expect(episodesLabel(1)).toBe('1 episode')
    expect(episodesLabel(12)).toBe('12 episodes')
    expect(episodesLabel(0)).toBe('0 episodes')
    expect(episodesLabel(null)).toBeUndefined()
    expect(episodesLabel(undefined)).toBeUndefined()
  })

  test('in Russian, each of its four forms', async () => {
    try {
      await startLanguage({ language: 'ru', languages: ['ru-RU'] })
      expect([1, 2, 5, 21, 1180].map(episodesLabel)).toEqual(['1 серия', '2 серии', '5 серий', '21 серия', '1180 серий'])
    } finally {
      await startLanguage({ language: 'en', languages: ['en-US'] })
    }
  })
})
