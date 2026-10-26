// FIRST: ../components/dom installs the document the element cases render into.
import { mount, unmount } from '../components/dom'

import { parseHTML } from 'linkedom'
import { afterEach, describe, expect, test } from 'vite-plus/test'

import { msg, startLanguage, t, translator, type Catalogue } from '../../../src/i18n'

const EPISODES = '{count, plural, one {# episode} other {# episodes}}'

const english = translator({ language: 'en', locale: 'en-US', catalogue: {} })
const french = (catalogue: Catalogue) => translator({ language: 'fr', locale: 'fr', catalogue })

afterEach(() => startLanguage({ language: 'en', languages: ['en-US'] }))

test('before a language starts, t() shows English', () => {
  expect(t(EPISODES, { count: 1180 })).toBe('1,180 episodes')
})

describe('English, the code\'s own text', () => {
  test('a plain value shows as given, never grouped', () => {
    expect(english('Ep {episode} airing in {countdown}', { episode: 1180, countdown: '2 days' })).toBe('Ep 1180 airing in 2 days')
    expect(english('Aired in {year}', { year: 2024 })).toBe('Aired in 2024')
  })

  test('# and a number are written in the language', () => {
    expect(english(EPISODES, { count: 1180 })).toBe('1,180 episodes')
    expect(english(EPISODES, { count: 1 })).toBe('1 episode')
    expect(english('{size, number} files', { size: 12345 })).toBe('12,345 files')
  })

  test('a select picks its branch, else other', () => {
    const kind = '{kind, select, audio {Party audio} subtitles {Party subtitles} other {Party track}}'
    expect(english(kind, { kind: 'audio' })).toBe('Party audio')
    expect(english(kind, { kind: 'subtitles' })).toBe('Party subtitles')
    expect(english(kind, { kind: 'chapters' })).toBe('Party track')
  })

  test('t() writes numbers as the browser\'s own English does', async () => {
    await startLanguage({ language: 'en', languages: ['de-DE', 'en-IN'] })
    expect(t(EPISODES, { count: 123456 })).toBe('1,23,456 episodes')
  })
})

describe('plurals in each language\'s own forms', () => {
  test('French: one for 0 and 1, the group a narrow space', () => {
    const fr = french({ [EPISODES]: '{count, plural, one {# épisode} other {# épisodes}}' })
    expect([0, 1, 2, 1180].map(count => fr(EPISODES, { count }))).toEqual(['0 épisode', '1 épisode', '2 épisodes', '1\u202f180 épisodes'])
  })

  test('Arabic: all six forms', () => {
    const ar = translator({ language: 'ar', locale: 'ar', catalogue: { [EPISODES]: '{count, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}' } })
    expect([0, 1, 2, 3, 11, 100].map(count => ar(EPISODES, { count }))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other'])
  })

  test('Russian: one, few, many, and other for a fraction', () => {
    const ru = translator({ language: 'ru', locale: 'ru', catalogue: { [EPISODES]: '{count, plural, one {# серия} few {# серии} many {# серий} other {# серии}}' } })
    expect([1, 3, 5, 21, 1.5].map(count => ru(EPISODES, { count }))).toEqual(['1 серия', '3 серии', '5 серий', '21 серия', '1,5 серии'])
  })
})

describe('elements', () => {
  const hosts: HTMLElement[] = []
  afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

  test('a value may be an element, and the text comes back as children a tree renders', () => {
    const credit = english('Scenes found by {site}', { site: <a href="https://trace.moe">trace.moe</a> })
    expect(Array.isArray(credit)).toBe(true)
    const host = mount(<p>{credit}</p>)
    hosts.push(host)
    expect(host.innerHTML).toBe('<p>Scenes found by <a href="https://trace.moe">trace.moe</a></p>')
  })

  test('a tag takes a handler, which wraps its translated text', () => {
    const fr = french({ 'Read the <link>privacy page</link>.': 'Lisez la <link>page de confidentialité</link>.' })
    const host = mount(<p>{fr('Read the <link>privacy page</link>.', { link: chunks => <a href="/privacy">{chunks}</a> })}</p>)
    hosts.push(host)
    expect(host.innerHTML).toBe('<p>Lisez la <a href="/privacy">page de confidentialité</a>.</p>')
  })
})

describe('right to left', () => {
  const SIGNED_IN = 'Signed in to {site} as {name}, {count} lists'
  const ar = translator({ language: 'ar', locale: 'ar', catalogue: { [SIGNED_IN]: 'تم تسجيل الدخول إلى {site} باسم {name}، {count} قوائم' } })

  test('each string value is isolated, a number is not', () => {
    expect(ar(SIGNED_IN, { site: 'AniList', name: 'Banou', count: 3 })).toBe('تم تسجيل الدخول إلى \u2068AniList\u2069 باسم \u2068Banou\u2069، 3 قوائم')
  })

  test('left to right values are left as given', () => {
    expect(english(SIGNED_IN, { site: 'AniList', name: 'Banou', count: 3 })).toBe('Signed in to AniList as Banou, 3 lists')
  })
})

describe('a context tells apart two messages spelled alike', () => {
  const fr = french({ Play: 'Lecture', 'verb\u0004Play': 'Lire' })

  test('t() with a context, and a msg() carrying one, read the context\'s text', () => {
    expect(fr('Play')).toBe('Lecture')
    expect(fr('Play', {}, 'verb')).toBe('Lire')
    expect(fr(msg('Play', 'verb'))).toBe('Lire')
  })

  test('English shows the text without its context', () => {
    expect(english('Play', {}, 'verb')).toBe('Play')
    expect(english(msg('Play', 'verb'))).toBe('Play')
  })
})

describe('fallbacks', () => {
  test('a key the catalogue lacks renders the English, with English plurals and numbers', () => {
    const fr = french({})
    expect(fr(EPISODES, { count: 0 })).toBe('0 episodes')
    expect(fr(EPISODES, { count: 1180 })).toBe('1,180 episodes')
  })

  test('a translation that does not parse renders the English', () => {
    expect(french({ [EPISODES]: '{count, plural, one {# épisode}' })(EPISODES, { count: 2 })).toBe('2 episodes')
  })

  test('a value missing renders the message\'s own text rather than throwing', () => {
    const fr = french({ 'Signed in to {site}.': 'Connecté à {site}.' })
    expect(fr('Signed in to {site}.')).toBe('Signed in to {site}.')
  })

  test('a catalogue that fails to load leaves English, and English marks', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    await startLanguage({ language: 'fr', languages: ['fr-FR'], html: document.documentElement, catalogues: { '../locales/fr.json': () => Promise.reject(new Error('offline')) } })
    expect(t(EPISODES, { count: 1180 })).toBe('1,180 episodes')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  test('a language with no catalogue at all leaves English', async () => {
    await startLanguage({ language: 'fr', languages: ['fr-FR'], catalogues: {} })
    expect(t('Play')).toBe('Play')
  })
})

describe('starting a language', () => {
  const catalogues = {
    '../locales/fr.json': async () => ({ [EPISODES]: '{count, plural, one {# épisode} other {# épisodes}}' }),
    '../locales/ar.json': async () => ({ Play: 'تشغيل' }),
  }

  test('t() reads the catalogue loaded, numbers in the browser\'s own tag for it (fr-CA groups with U+00A0, fr with U+202F)', async () => {
    await startLanguage({ language: 'fr', languages: ['fr-CA', 'en'], catalogues })
    expect(t(EPISODES, { count: 1180 })).toBe('1\u00a0180 épisodes')
  })

  test('<html> takes the language and, right to left, its direction', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    const html = document.documentElement
    await startLanguage({ language: 'ar', languages: ['ar-EG'], html, catalogues })
    expect([html.getAttribute('lang'), html.getAttribute('dir')]).toEqual(['ar', 'rtl'])
    expect(t('Play')).toBe('تشغيل')
    await startLanguage({ language: 'fr', languages: ['fr-FR'], html, catalogues })
    expect([html.getAttribute('lang'), html.getAttribute('dir')]).toEqual(['fr', null])
  })

  test('English leaves <html> exactly as index.html writes it', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    const before = document.documentElement.outerHTML
    await startLanguage({ language: 'en', languages: ['en-US'], html: document.documentElement })
    expect(document.documentElement.outerHTML).toBe(before)
  })
})

test('the types refuse text built at runtime', () => {
  const built = String(Math.random())
  // @ts-expect-error a plain string is refused: only a literal or a msg() value
  expect(english(built)).toBe(built)
  // @ts-expect-error msg() marks literals only
  expect(msg(built)).toBe(built)
  expect(english(msg('Sources'))).toBe('Sources')
})
