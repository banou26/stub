// FIRST: ../components/dom installs the document the element cases render into.
import { mount, unmount } from '../components/dom'

import type { ComponentChild } from 'preact'

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parseHTML } from 'linkedom'
import { RawIntlProvider, useIntl } from 'react-intl'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { intl, startLanguage, type Catalogue } from '../../../src/i18n'
import { releaseDateLabel } from '../../../src/utils/release-date'

// plain descriptors, which the linter does not read: each message as stub writes it, its English its id
const message = (english: string, description?: string) =>
  ({ id: description ? `${english}#${description}` : english, defaultMessage: english, description })
const EPISODES = message('{count, plural, one {# episode} other {# episodes}}')

const start = (language: string, catalogue: Catalogue, languages = [language]) =>
  startLanguage({ language, languages, catalogues: { [`../locales/${language}.json`]: async () => catalogue } })

afterEach(() => startLanguage({ language: 'en', languages: ['en-US'] }))

test('before a language starts, the page writes English', () => {
  expect(intl.formatMessage(EPISODES, { count: 1180 })).toBe('1,180 episodes')
})

describe('English, the code\'s own text', () => {
  test('a plain value shows as given, never grouped', () => {
    expect(intl.formatMessage(message('Ep {episode} airing in {countdown}'), { episode: 1180, countdown: '2 days' })).toBe('Ep 1180 airing in 2 days')
    expect(intl.formatMessage(message('Aired in {year}'), { year: 2024 })).toBe('Aired in 2024')
  })

  test('# and a number are written in the language', () => {
    expect(intl.formatMessage(EPISODES, { count: 1180 })).toBe('1,180 episodes')
    expect(intl.formatMessage(EPISODES, { count: 1 })).toBe('1 episode')
    expect(intl.formatMessage(message('{size, number} files'), { size: 12345 })).toBe('12,345 files')
  })

  test('a select picks its branch, else other', () => {
    const kind = message('{kind, select, audio {Party audio} subtitles {Party subtitles} other {Party track}}')
    expect(['audio', 'subtitles', 'chapters'].map(each => intl.formatMessage(kind, { kind: each }))).toEqual(['Party audio', 'Party subtitles', 'Party track'])
  })

  test('the English is written as the browser\'s own English writes numbers, and reports no missing translation', async () => {
    const reported = vi.spyOn(console, 'error')
    const english = await startLanguage({ language: 'en', languages: ['de-DE', 'en-IN'] })
    expect(english.formatMessage(EPISODES, { count: 123456 })).toBe('1,23,456 episodes')
    expect(reported).not.toHaveBeenCalled()
    reported.mockRestore()
  })
})

describe('plurals in each language\'s own forms', () => {
  test('French: one for 0 and 1, the group a narrow space', async () => {
    const fr = await start('fr', { [EPISODES.id]: '{count, plural, one {# épisode} other {# épisodes}}' })
    expect([0, 1, 2, 1180].map(count => fr.formatMessage(EPISODES, { count }))).toEqual(['0 épisode', '1 épisode', '2 épisodes', '1\u202f180 épisodes'])
  })

  test('Arabic: all six forms', async () => {
    const ar = await start('ar', { [EPISODES.id]: '{count, plural, zero {zero} one {one} two {two} few {few} many {many} other {other}}' })
    expect([0, 1, 2, 3, 11, 100].map(count => ar.formatMessage(EPISODES, { count }))).toEqual(['zero', 'one', 'two', 'few', 'many', 'other'])
  })

  test('Russian: one, few, many, and other for a fraction', async () => {
    const ru = await start('ru', { [EPISODES.id]: '{count, plural, one {# серия} few {# серии} many {# серий} other {# серии}}' })
    expect([1, 3, 5, 21, 1.5].map(count => ru.formatMessage(EPISODES, { count }))).toEqual(['1 серия', '3 серии', '5 серий', '21 серия', '1,5 серии'])
  })
})

describe('a right to left language', () => {
  const SIGNED_IN = message('Signed in to {name}.')

  test('a value is isolated from the sentence around it, so a Latin name keeps the full stop outside', async () => {
    const he = await start('he', { [SIGNED_IN.id]: 'מחובר אל {name}.' })
    expect(he.formatMessage(SIGNED_IN, { name: 'AniList' })).toBe('מחובר אל \u2068AniList\u2069.')
  })

  test('also inside a branch and a tag, while the plural and the select still choose on the raw value', async () => {
    const ONE = message('{count, plural, one {{count} new} other {{count} new}}')
    const WHO = message('{who, select, self {you paused} other {{member} paused}}')
    const LINKED = message('Found by <link>{site}</link>')
    const ar = await start('ar', {
      [ONE.id]: '{count, plural, zero {none} one {{count} one} two {two} few {few} many {many} other {other}}',
      [WHO.id]: '{who, select, self {أنت} other {{member} متوقف}}',
      [LINKED.id]: 'عثر عليها <link>{site}</link>',
    })
    expect(ar.formatMessage(ONE, { count: 1 })).toBe('\u20681\u2069 one')
    expect(ar.formatMessage(WHO, { who: 'self', member: 'x' })).toBe('أنت')
    expect(ar.formatMessage(WHO, { who: 'other', member: 'Alex' })).toBe('\u2068Alex\u2069 متوقف')
    const linked = ar.formatMessage(LINKED, { site: 'trace.moe', link: (text: string[]) => `[${text.join('')}]` })
    expect([linked].flat().join('')).toBe('عثر عليها [\u2068trace.moe\u2069]')
  })

  test('a left to right language stays as written', async () => {
    const fr = await start('fr', { [SIGNED_IN.id]: 'Connecté à {name}.' })
    expect(fr.formatMessage(SIGNED_IN, { name: 'AniList' })).toBe('Connecté à AniList.')
  })

  test('a message that does not parse falls to its English, as in any language', async () => {
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ar = await start('ar', { [SIGNED_IN.id]: '{name' })
    expect(ar.formatMessage(SIGNED_IN, { name: 'AniList' })).toBe('Signed in to AniList.')
    onError.mockRestore()
  })

  const EPISODE_COUNT = message('{count, plural, one {{count} episode} other {{count} episodes}}')
  const SOURCE_COUNT = message('{count, plural, one {{count} source} other {{count} sources}}')
  const bare = (text: string) => text.replace(/[\u2068\u2069]/g, '')

  test('the catalogue writes Arabic\'s six forms and Hebrew\'s three', async () => {
    const ar = await startLanguage({ language: 'ar', languages: ['ar-MA'] })
    expect([0, 1, 2, 3, 11, 100].map(count => bare(ar.formatMessage(EPISODE_COUNT, { count }))))
      .toEqual(['0 حلقة', 'حلقة واحدة', 'حلقتان', '3 حلقات', '11 حلقة', '100 حلقة'])
    expect([1, 2, 5, 11].map(count => bare(ar.formatMessage(SOURCE_COUNT, { count })))).toEqual(['مصدر واحد', 'مصدران', '5 مصادر', '11 مصدرًا'])
    const he = await startLanguage({ language: 'he', languages: ['he-IL'] })
    expect([1, 2, 3, 20].map(count => bare(he.formatMessage(EPISODE_COUNT, { count })))).toEqual(['פרק אחד', 'שני פרקים', '3 פרקים', '20 פרקים'])
  })
})

describe('elements', () => {
  const hosts: HTMLElement[] = []
  afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })
  const shown = (node: ComponentChild) => {
    const host = mount(<RawIntlProvider value={intl}>{node}</RawIntlProvider>)
    hosts.push(host)
    return host.innerHTML
  }

  test('a value may be an element, and the text comes back as children a tree renders', () => {
    const credit = intl.formatMessage(message('Scenes found by {site}'), { site: <a href="https://trace.moe">trace.moe</a> })
    expect(shown(<p>{credit}</p>)).toBe('<p>Scenes found by <a href="https://trace.moe">trace.moe</a></p>')
  })

  test('a tag takes a handler, which wraps its translated text', async () => {
    const fr = await start('fr', { 'Read the <link>privacy page</link>.': 'Lisez la <link>page de confidentialité</link>.' })
    const read = fr.formatMessage(message('Read the <link>privacy page</link>.'), { link: chunks => <a href="/privacy">{chunks}</a> })
    expect(shown(<p>{read}</p>)).toBe('<p>Lisez la <a href="/privacy">page de confidentialité</a>.</p>')
  })

  test('a component reads the language started through useIntl()', async () => {
    await start('fr', { Country: 'Pays' })
    const Heading = () => <h3>{useIntl().formatMessage({ id: 'Country', defaultMessage: 'Country' })}</h3>
    expect(shown(<Heading/>)).toBe('<h3>Pays</h3>')
  })
})

describe('a description tells apart two messages spelled alike, and is part of the id', () => {
  const noun = message('Play')
  const verb = message('Play', 'verb')

  test('each reads its own text', async () => {
    const fr = await start('fr', { Play: 'Lecture', 'Play#verb': 'Lire' })
    expect([fr.formatMessage(noun), fr.formatMessage(verb)]).toEqual(['Lecture', 'Lire'])
  })

  test('English shows the text without its description', () => {
    expect([intl.formatMessage(noun), intl.formatMessage(verb)]).toEqual(['Play', 'Play'])
  })
})

describe('fallbacks', () => {
  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks() })

  test('a key the catalogue lacks renders the English, with English plurals and numbers', async () => {
    const fr = await start('fr', {}, ['fr-FR'])
    expect([0, 1180].map(count => fr.formatMessage(EPISODES, { count }))).toEqual(['0 episodes', '1,180 episodes'])
  })

  test('a translation that does not parse renders the English', async () => {
    const fr = await start('fr', { [EPISODES.id]: '{count, plural, one {# épisode}' })
    expect(fr.formatMessage(EPISODES, { count: 2 })).toBe('2 episodes')
  })

  test('a value missing renders the translation\'s own text rather than throwing', async () => {
    const fr = await start('fr', { 'Signed in to {site}.': 'Connecté à {site}.' })
    expect(fr.formatMessage(message('Signed in to {site}.'))).toBe('Connecté à {site}.')
  })

  test('a catalogue that fails to load leaves English, and English marks', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    const shown = await startLanguage({ language: 'fr', languages: ['fr-FR'], html: document.documentElement, catalogues: { '../locales/fr.json': () => Promise.reject(new Error('offline')) } })
    expect(shown.formatMessage(EPISODES, { count: 1180 })).toBe('1,180 episodes')
    expect(document.documentElement.getAttribute('lang')).toBe('en')
  })

  test('a language with no catalogue at all leaves English', async () => {
    const shown = await startLanguage({ language: 'fr', languages: ['fr-FR'], catalogues: {} })
    expect(shown.formatMessage(message('Play'))).toBe('Play')
  })
})

describe('starting a language', () => {
  test('the page\'s intl is the one started', async () => {
    const fr = await start('fr', { Play: 'Lecture' })
    expect(intl).toBe(fr)
    expect(intl.formatMessage(message('Play'))).toBe('Lecture')
  })

  test('dates and numbers follow the browser\'s own tag for the language shown', async () => {
    const date = new Date(2026, 9, 26)
    expect((await startLanguage({ language: 'en', languages: ['en-GB'] })).formatDate(date)).toBe('26/10/2026')
    expect((await startLanguage({ language: 'en', languages: [] })).formatDate(date)).toBe('10/26/2026')
    expect((await start('es-419', {}, ['es-MX'])).formatNumber(1234.5)).toBe('1,234.5')
    expect((await start('es-419', {}, ['es-AR'])).formatNumber(1234.5)).toBe('1.234,5')
    expect((await start('fr', { [EPISODES.id]: '{count, plural, one {# épisode} other {# épisodes}}' }, ['fr-CA', 'en'])).formatMessage(EPISODES, { count: 1180 })).toBe('1\u00a0180 épisodes')
  })

  test('a Thai page writes a date in the year its season labels write, Gregorian, not in Thailand\'s Buddhist calendar', async () => {
    expect(new Intl.DateTimeFormat('th-TH', { year: 'numeric' }).format(new Date(2026, 0, 7)), 'the control: Thai\'s own calendar').toBe('พ.ศ. 2569')
    for (const languages of [['th-TH'], []]) {
      const th = await startLanguage({ language: 'th', languages })
      expect(th.formatMessage(message('Winter {year}'), { year: 2026 })).toBe('ฤดูหนาว 2026')
      expect(releaseDateLabel('2026-01-07', { locale: th.locale })).toBe('7 ม.ค. 2026')
      expect(releaseDateLabel('2026', { locale: th.locale })).toBe('2026')
    }
  })

  test('<html> takes the language and, right to left, its direction', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    const html = document.documentElement
    await startLanguage({ language: 'ar', languages: ['ar-EG'], html, catalogues: { '../locales/ar.json': async () => ({ Play: 'تشغيل' }) } })
    expect([html.getAttribute('lang'), html.getAttribute('dir'), intl.formatMessage(message('Play'))]).toEqual(['ar', 'rtl', 'تشغيل'])
    await startLanguage({ language: 'fr', languages: ['fr-FR'], html, catalogues: { '../locales/fr.json': async () => ({}) } })
    expect([html.getAttribute('lang'), html.getAttribute('dir')]).toEqual(['fr', null])
  })

  test('a language\'s catalogue is its file in src/locales', async () => {
    const de = await startLanguage({ language: 'de', languages: ['de-DE'] })
    expect([de.locale, de.formatMessage(message('Staff'))]).toEqual(['de-DE', 'Stab'])
  })

  // Vitest 5's on-disk module cache keys a module by its own source, so it reuses a glob's matches from before a file was
  // added; it leaves out a module whose source reads `import.meta.glob(`, which a type argument there hides
  test('the catalogues are found by a glob Vitest never caches', () => {
    const core = readFileSync(fileURLToPath(new URL('../../../src/i18n/index.ts', import.meta.url)), 'utf8')
    expect(core).toContain("import.meta.glob('../locales/*.json'")
  })

  test('English leaves <html> exactly as index.html writes it', async () => {
    const { document } = parseHTML('<!doctype html><html lang="en"><body></body></html>')
    const before = document.documentElement.outerHTML
    await startLanguage({ language: 'en', languages: ['en-US'], html: document.documentElement })
    expect(document.documentElement.outerHTML).toBe(before)
  })
})
