import { expose } from 'osra'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import type { Catalogue } from '../../../src/i18n'
import type { Tracker } from '../../../src/generated/schema/types.generated'

import { startLanguage, wordsOf } from '../../../src/i18n'
import { forPage, saidError, saidOf } from '../../../src/i18n/said'
import { failedReadAnswer } from '../../../src/tracking/collect'

// HOR-1026 (stub in the viewer's language): what the worker writes travels as a message and its values, and the page
// writes it in the language it shows

const start = (language: string, catalogue: Catalogue, languages = [language]) =>
  startLanguage({ language, languages, catalogues: { [`../locales/${language}.json`]: async () => catalogue } })

afterEach(() => startLanguage({ language: 'en', languages: ['en-US'] }))

const ANILIST: Tracker = { id: 'anilist', name: 'AniList', signedIn: true, canWrite: true, scoreScale: 'POINT_10' }
// plain descriptors, which the linter does not read
const said = (english: string, values?: Parameters<typeof forPage.formatMessage>[1]) => {
  const descriptor = { id: english, defaultMessage: english }
  return forPage.formatMessage(descriptor, values)
}

describe('in English', () => {
  test('a message is its id and its values, written in where it is shown', () => {
    const unreachable = failedReadAnswer('ag:(anilist:1)', ANILIST, new TypeError('Failed to fetch')).error
    expect(unreachable).toEqual({ message: 'Could not reach {name}, retrying', values: { name: 'AniList' } })
    expect(wordsOf(unreachable)).toBe('Could not reach AniList, retrying')
  })

  test('a site\'s own words show as they came, alone or in a message, braces and quotes included', () => {
    expect(wordsOf('Too Many Requests. {retry}')).toBe('Too Many Requests. {retry}')
    expect(wordsOf(said('MyAnimeList answered {status}: {said}', { status: 400, said: "can't {parse} this" }))).toBe("MyAnimeList answered 400: can't {parse} this")
  })

  test('a count shows as given, a message in a value is written first, and a list is joined', () => {
    const shown = said('MyAnimeList shows {shown}', { shown: { list: [said('{count} episodes', { count: 1100 }), said('no score')], join: 'names' } })
    expect(wordsOf(shown)).toBe('MyAnimeList shows 1100 episodes, no score')
    expect(wordsOf(said('Names {candidates}, cannot tell which', { candidates: { list: ['mal:1', 'mal:2'], join: 'and' } }))).toBe('Names mal:1 and mal:2, cannot tell which')
  })

  test('a moment shows as a time of day, as the browser\'s English writes one', async () => {
    const until = new Date(2026, 9, 30, 15, 5).getTime()
    const waiting = said('AniList asked stub to wait until {time}', { time: { time: until } })
    expect(wordsOf(waiting)).toBe('AniList asked stub to wait until 03:05 PM')
    await startLanguage({ language: 'en', languages: ['en-GB'] })
    expect(wordsOf(waiting)).toBe('AniList asked stub to wait until 15:05')
  })
})

describe('in another language', () => {
  test('the page writes the worker\'s message in it, its values in place, and a site\'s words as they came', async () => {
    await start('de', {
      'Could not reach {name}, retrying': '{name} nicht erreichbar, neuer Versuch',
      'MyAnimeList answered {status}: {said}': 'MyAnimeList antwortete {status}: {said}',
    })
    expect(wordsOf(failedReadAnswer('ag:(anilist:1)', ANILIST, new TypeError('Failed to fetch')).error)).toBe('AniList nicht erreichbar, neuer Versuch')
    expect(wordsOf(said('MyAnimeList answered {status}: {said}', { status: 400, said: 'invalid request' }))).toBe('MyAnimeList antwortete 400: invalid request')
    expect(wordsOf('invalid request')).toBe('invalid request')
  })

  test('a time of day and a list are written its way', async () => {
    await start('de', { 'Names {candidates}, cannot tell which': 'Nennt {candidates}, nicht eindeutig' }, ['de-DE'])
    expect(wordsOf(said('Names {candidates}, cannot tell which', { candidates: { list: ['a', 'b', 'c'], join: 'and' } }))).toBe('Nennt a, b und c, nicht eindeutig')
    expect(wordsOf(said('{time}', { time: { time: new Date(2026, 9, 30, 15, 5).getTime() } }))).toBe('15:05')
  })

  test('a message its catalogue lacks is written in English', async () => {
    await start('de', {})
    expect(wordsOf(said('MyAnimeList still lists it'))).toBe('MyAnimeList still lists it')
  })
})

describe('an error', () => {
  const NO_LIST = said('Crunchyroll answered with no list')

  // a site's page script throws it, and the worker shows it, a port between them
  test('carries its words across a port, which keeps an error\'s cause and drops any other field of it', async () => {
    const { port1, port2 } = new MessageChannel()
    try {
      void expose({ read: async () => { throw saidError(NO_LIST) } }, { transport: port1 })
      const remote = await expose<{ read: () => Promise<never> }>({}, { transport: port2 })
      const thrown = await remote.read().catch((error: unknown) => error)
      expect(thrown).toMatchObject({ message: 'Crunchyroll answered with no list' })
      expect(saidOf(thrown)).toEqual(NO_LIST)
    } finally {
      port1.close()
      port2.close()
    }
  })

  test('without words of its own says its message as it came, a cause of its own aside', () => {
    const answered = said('Crunchyroll answered {status}', { status: 403 })
    expect(saidError(answered, 'Crunchyroll answered 403')).toMatchObject({ message: 'Crunchyroll answered 403', cause: answered })
    expect(saidOf(new Error('Load failed'))).toBe('Load failed')
    expect(saidOf(new Error('Load failed', { cause: new TypeError('offline') }))).toBe('Load failed')
    expect(saidOf('offline')).toBe('offline')
  })

  test('the failed read shows them in the page\'s language', async () => {
    await start('de', { 'Crunchyroll answered with no list': 'Crunchyroll hat ohne Liste geantwortet' })
    expect(wordsOf(failedReadAnswer('cr:1', ANILIST, saidError(NO_LIST)).error)).toBe('Crunchyroll hat ohne Liste geantwortet')
    expect(wordsOf(failedReadAnswer('cr:1', ANILIST, new Error('Load failed')).error)).toBe('Load failed')
  })
})
