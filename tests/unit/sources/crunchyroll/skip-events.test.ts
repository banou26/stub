import { describe, expect, test, vi } from 'vite-plus/test'

import {
  crunchyrollEpisodeId,
  fetchSkipEvents,
  skipEventsToChapters,
  skipEventsUrl,
} from '../../../../src/sources/crunchyroll/skip-events'
import { CREDITS_KEY_ONLY, CREDITS_ONLY, EVERY_EVENT, NO_EVENTS, OPENING_ONLY } from './skip-events-fixture'

// the relay is a separate concern: every fetch here is handed in
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))

describe('skip events as chapters', () => {
  test('every event, in time order, with the time between them as Episode', () => {
    expect(skipEventsToChapters(EVERY_EVENT, 1440)).toEqual([
      { start: 0, end: 45, title: 'Recap' },
      { start: 45, end: 60, title: 'Episode' },
      { start: 60, end: 150, title: 'Opening' },
      { start: 150, end: 1320, title: 'Episode' },
      { start: 1320, end: 1410, title: 'Ending' },
      { start: 1410, end: 1440, title: 'Preview' },
    ])
  })

  test('credits alone, whether the other keys are empty or missing', () => {
    expect(skipEventsToChapters(CREDITS_ONLY, 1770)).toEqual([
      { start: 0, end: 1680, title: 'Episode' },
      { start: 1680, end: 1767, title: 'Ending' },
      { start: 1767, end: 1770, title: 'Episode' },
    ])
    expect(skipEventsToChapters(CREDITS_KEY_ONLY, 1440)).toEqual([
      { start: 0, end: 1325, title: 'Episode' },
      { start: 1325, end: 1415, title: 'Ending' },
      { start: 1415, end: 1440, title: 'Episode' },
    ])
  })

  test('the tail waits for a duration, and an unusable one is none', () => {
    const head = [
      { start: 0, end: 60, title: 'Episode' },
      { start: 60, end: 150, title: 'Opening' },
    ]
    expect(skipEventsToChapters(OPENING_ONLY)).toEqual(head)
    for (const duration of [Number.NaN, Infinity, 0, -1]) {
      expect(skipEventsToChapters(OPENING_ONLY, duration)).toEqual(head)
    }
    expect(skipEventsToChapters(OPENING_ONLY, 1440)).toEqual([...head, { start: 150, end: 1440, title: 'Episode' }])
  })

  test('no events is no chapters, not one Episode across the whole runtime', () => {
    expect(skipEventsToChapters(NO_EVENTS, 1440)).toEqual([])
    expect(skipEventsToChapters({}, 1440)).toEqual([])
  })

  test('a malformed file or entry is left out', () => {
    for (const file of [null, undefined, 'intro', 42, [], [CREDITS_ONLY.credits]]) {
      expect(skipEventsToChapters(file, 1440)).toEqual([])
    }
    expect(skipEventsToChapters({
      intro: null,
      recap: [0, 45],
      credits: { start: '1320', end: '1410' },
      preview: { start: 1410 },
    }, 1440)).toEqual([])
    expect(skipEventsToChapters({ intro: { start: Number.NaN, end: 150 }, credits: { start: 1320, end: Infinity } }, 1440)).toEqual([])
  })

  test('times outside the episode are clamped to it, and a span with nothing left is dropped', () => {
    expect(skipEventsToChapters({
      intro: { start: -5, end: 85 },
      recap: { start: 300, end: 300 },
      credits: { start: 1380, end: 1500 },
      preview: { start: 1500, end: 1530 },
    }, 1440)).toEqual([
      { start: 0, end: 85, title: 'Opening' },
      { start: 85, end: 1380, title: 'Episode' },
      { start: 1380, end: 1440, title: 'Ending' },
    ])
    expect(skipEventsToChapters({ credits: { start: 1410, end: 1320 } }, 1440)).toEqual([])
  })

  test('an event overlapping the one before starts where it ends, and one inside it is dropped', () => {
    expect(skipEventsToChapters({
      recap: { start: 0, end: 70 },
      intro: { start: 60, end: 150 },
      credits: { start: 1300, end: 1400 },
      preview: { start: 1350, end: 1380 },
    }, 1400)).toEqual([
      { start: 0, end: 70, title: 'Recap' },
      { start: 70, end: 150, title: 'Opening' },
      { start: 150, end: 1300, title: 'Episode' },
      { start: 1300, end: 1400, title: 'Ending' },
    ])
  })
})

describe('the episode id', () => {
  test('is read off a watch url, with or without a slug or a locale', () => {
    expect(crunchyrollEpisodeId('https://www.crunchyroll.com/watch/G8WUND5JX')).toBe('G8WUND5JX')
    expect(crunchyrollEpisodeId('https://www.crunchyroll.com/watch/G8WUND5JX/the-episode')).toBe('G8WUND5JX')
    expect(crunchyrollEpisodeId('https://www.crunchyroll.com/fr/watch/GQJUMNE75/?t=10')).toBe('GQJUMNE75')
  })

  test('is nothing anywhere else, so no request goes out for it', () => {
    for (const url of [
      'https://www.crunchyroll.com/series/GRGGPG93R/a-show',
      'https://www.crunchyroll.com/watch/',
      'https://www.crunchyroll.com/watch/G8WUND5JX..%2F',
      'not a url',
    ]) {
      expect(crunchyrollEpisodeId(url)).toBeUndefined()
    }
  })
})

describe('the fetch', () => {
  test('asks the episode\'s public file and answers its JSON', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(CREDITS_ONLY)))
    expect(await fetchSkipEvents('G8WUND5JX', fetch)).toEqual(CREDITS_ONLY)
    expect(fetch).toHaveBeenCalledWith('https://static.crunchyroll.com/skip-events/production/G8WUND5JX.json')
    expect(skipEventsUrl('G8WUND5JX')).toBe(fetch.mock.calls[0]![0])
  })

  const tracked = (status: number) => {
    const body = { cancelled: false }
    const stream = new ReadableStream({ cancel: () => { body.cancelled = true } })
    return { body, fetch: async () => new Response(stream, { status }) }
  }

  test.each([403, 404])('an episode with no file (%i) has no events, and the body is released', async status => {
    const { body, fetch } = tracked(status)
    expect(await fetchSkipEvents('G8WUND5JX', fetch)).toEqual({})
    expect(body.cancelled).toBe(true)
  })

  test('any other error status rejects rather than reading its body as events, and releases it', async () => {
    const { body, fetch } = tracked(500)
    await expect(fetchSkipEvents('G8WUND5JX', fetch)).rejects.toThrow('answered 500')
    expect(body.cancelled).toBe(true)
  })
})
