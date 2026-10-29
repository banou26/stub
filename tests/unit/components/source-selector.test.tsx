// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

vi.mock('../../../src/worker', () => ({}))

const { default: SourceSelector } = await import('../../../src/components/source-selector')
const { HIDDEN_ICONS_KEY, setIconShown } = await import('../../../src/sources/hidden-icons')
const { startLanguage } = await import('../../../src/i18n')

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

const release = (uri: string) => ({ uri, label: uri, href: `/watch/m/e/${uri}`, external: false, active: false })
const sources = [
  { id: 'nf', name: 'Netflix', href: '/watch/m/e/nf:81', external: false, active: false },
  { id: 'hulu', name: 'Hulu', href: 'https://www.hulu.com/watch/1', external: true, active: false },
  { id: 'nyaa', name: 'Nyaa', href: '/watch/m/e/nyaa:a', external: false, active: false, releases: [release('nyaa:a'), release('nyaa:b')] },
]

const selector = (props: Partial<Parameters<typeof SourceSelector>[0]> = {}) => {
  const location = memoryLocation({ path: '/watch/m/e/cr:1', record: true })
  const host = mount(withIntl(<Router hook={location.hook}><SourceSelector sources={sources} {...props}/></Router>))
  hosts.push(host)
  const click = (selector: string) => {
    const event = Object.assign(new Event('click', { bubbles: true, cancelable: true }), { button: 0 })
    act(() => { host.querySelector(selector)!.dispatchEvent(event) })
    return event.defaultPrevented
  }
  return { host, location, click }
}

// a full load restarts the worker, and with it the Netflix match the click came from (Frieren, 2026-10-12)
test('picking a source in stub is a client side navigation', () => {
  const { host, location, click } = selector()
  expect(click('a[title="Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
  expect(host.querySelector('a[title="Hulu"]')?.getAttribute('target')).toBe('_blank')
})

test('picking one of a source\'s releases is a client side navigation', () => {
  const { location, click } = selector()
  click('button[title="2 releases on Nyaa"]')
  expect(click('a[title="nyaa:b"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nyaa:b')
})

test('picking a compact source icon is a client side navigation', () => {
  const { location, click } = selector({ compact: true })
  expect(click('a[title="Watch on Netflix"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
})

const names = (host: HTMLElement) => [...host.querySelectorAll('.list > .source')].map(source => source.querySelector('.name')?.textContent)

test('a film\'s buttons are the watch page\'s, with no label', () => {
  const watch = selector().host
  const film = selector({ film: true }).host
  expect([...film.firstElementChild!.classList].filter(name => name !== 'film'), 'the same styles').toEqual([...watch.firstElementChild!.classList])
  for (const name of ['Netflix', 'Hulu']) expect(film.querySelector(`a[title="${name}"]`)?.outerHTML).toBe(watch.querySelector(`a[title="${name}"]`)?.outerHTML)
  expect(film.querySelector('a[title="Netflix"] .play')?.textContent, 'the control: plays in stub').toBe('▶')
  expect(film.querySelector('a[title="Hulu"] .ext')?.textContent, 'the control: links out').toBe('↗')
  expect(watch.querySelector('.label')?.textContent, 'the control: the watch page names them').toBe('Watch on')
  expect(film.querySelector('.label')).toBeNull()
})

test('a film\'s buttons name every source, where the compact row stops at five', () => {
  const six = ['Netflix', 'Hulu', 'Tubi', 'Plex', 'Hoopla', 'HIDIVE'].map((name, index) =>
    ({ id: name.toLowerCase(), name, href: `https://${name.toLowerCase()}.example/${index}`, external: true, active: false }))
  expect(selector({ sources: six, compact: true }).host.querySelectorAll('a.src'), 'the control: compact draws five').toHaveLength(5)
  expect(names(selector({ sources: six, film: true }).host)).toEqual(six.map(source => source.name))
})

test('a film\'s source with several releases shows how many and opens the watch page, where the watch page offers the pick', () => {
  const { host, location, click } = selector({ film: true })
  const nyaa = host.querySelector('a.source[href="/watch/m/e/nyaa:a"]')
  expect(nyaa?.querySelector('.count')?.textContent).toBe('2')
  expect(nyaa?.getAttribute('target')).toBeNull()
  expect(host.querySelector('button'), 'no pick here').toBeNull()
  expect(selector().host.querySelector('button[title="2 releases on Nyaa"] .count')?.textContent, 'the control: the watch page\'s pick').toBe('2')
  expect(click('a.source[href="/watch/m/e/nyaa:a"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nyaa:a')
})

test('a film\'s button for a source in stub is a client side navigation, and one for a site opens it in a new tab', () => {
  const { host, location, click } = selector({ film: true })
  expect(click('a.source[href="/watch/m/e/nf:81"]')).toBe(true)
  expect(location.history.at(-1)).toBe('/watch/m/e/nf:81')
  expect(host.querySelector('a.source[href="https://www.hulu.com/watch/1"]')?.getAttribute('target')).toBe('_blank')
})

test('a film\'s buttons hold one placeholder while sources may still land, and draw nothing once none came', () => {
  const held = selector({ sources: [], film: true, pending: true }).host
  expect(held.querySelectorAll('.list > .pending')).toHaveLength(1)
  expect(selector({ sources: [], film: true }).host.innerHTML).toBe('')
  expect(selector({ film: true, pending: true }).host.querySelector('.pending'), 'sources replace it').toBeNull()
})

// HOR-1011: the watch page's card shows the source's picture and what its stream offers
const detailedNetflix = {
  ...sources[0]!,
  thumbnails: [{ url: 'https://img.example/nf.jpg' }, { url: 'https://img.example/episode.jpg' }],
  videoQualities: ['4K', 'Dolby Vision'],
  audioQualities: ['5.1'],
  audioLanguages: ['ja-JP', 'en-US', 'es-419', 'es-ES', 'pt-BR'],
  subtitleLanguages: ['en'],
}
const card = (host: HTMLElement, name: string) => host.querySelector(`[title="${name}"]`)!
const lines = (element: Element) => [...element.querySelectorAll('.languages')].map(line => [line.textContent, line.getAttribute('title')])

test('a source\'s card on the watch page shows its picture, its quality and its languages by name', () => {
  const { host } = selector({ sources: [detailedNetflix, sources[1]!] })
  const netflix = card(host, 'Netflix')
  expect(netflix.classList.contains('detailed')).toBe(true)
  expect(netflix.querySelector('img.thumbnail')?.getAttribute('src')).toBe('https://img.example/nf.jpg')
  expect([...netflix.querySelectorAll('.qualities > *')].map(chip => chip.textContent)).toEqual(['4K', 'Dolby Vision', '5.1'])
  expect(lines(netflix), 'every name, then how many past three; the region is not a language of its own').toEqual([
    ['AudioJapanese, English, Spanish, Portuguese+1', 'Audio: Japanese, English, Spanish, Portuguese'],
    ['SubtitlesEnglish', 'Subtitles: English'],
  ])
  expect(netflix.querySelector('.languages .rest')?.textContent, 'past three apart, for a card that shows three').toBe(', Portuguese')
  const more = netflix.querySelector('.languages .more')
  expect(more?.textContent, 'the count apart from the names a narrow card cuts').toBe('+1')
  expect(more?.getAttribute('aria-hidden'), 'and not read out over the names it stands for').toBe('true')
  expect(netflix.querySelectorAll('.rest, .more'), 'none for a line of three or fewer').toHaveLength(2)
  expect(netflix.querySelector('.head .name')?.textContent, 'its usual row, under the picture').toBe('Netflix')

  const hulu = card(host, 'Hulu')
  expect(hulu.classList.contains('detailed'), 'the control: a source that says nothing keeps its row alone').toBe(false)
  expect(hulu.querySelector('img, .qualities, .languages')).toBeNull()
})

test('a card names each language in English by its language subtag, a code Intl cannot read as the source wrote it, and how many past three', () => {
  const tags = ['ja-JP', 'en-US', 'fr-FR', 'de', 'it', 'ru-RU', 'ko', 'zh-Hans', 'zh-TW', 'pt-BR', 'es-419', 'tr', 'pl', 'ar', 'he', 'iw', 'xx', 'x!-1', 'JA']
  const names = ['Japanese', 'English', 'French', 'German', 'Italian', 'Russian', 'Korean', 'Chinese', 'Portuguese', 'Spanish', 'Turkish', 'Polish', 'Arabic', 'Hebrew', 'xx', 'x!-1']
  const { host } = selector({ sources: [{ ...sources[0]!, audioLanguages: tags, subtitleLanguages: ['ja', 'en', 'fr'] }] })
  const [audio, subtitles] = card(host, 'Netflix').querySelectorAll('.languages')
  expect(audio?.getAttribute('title')).toBe(`Audio: ${names.join(', ')}`)
  expect(audio?.querySelector('.names')?.textContent).toBe(`Japanese, English, French, ${names.slice(3).join(', ')}`)
  expect(audio?.querySelector('.rest')?.textContent).toBe(`, ${names.slice(3).join(', ')}`)
  expect(audio?.querySelector('.more')?.textContent).toBe('+13')
  expect([subtitles?.textContent, subtitles?.getAttribute('title')]).toEqual(['SubtitlesJapanese, English, French', 'Subtitles: Japanese, English, French'])
})

// a Nyaa release saying Multi-Subs or MULTi carries `mul`, which Chrome 156 names 'mul' where Node names it
test('a card names several unlisted languages in the viewer\'s language where the browser has no name for them', async () => {
  const of: (this: Intl.DisplayNames, code: string) => string | undefined = Reflect.get(Intl.DisplayNames.prototype, 'of')
  const chrome = vi.spyOn(Intl.DisplayNames.prototype, 'of').mockImplementation(function (this: Intl.DisplayNames, code: string) {
    return code === 'mul' ? code : of.call(this, code)
  })
  const titles = () => [...card(selector({ sources: [{ ...sources[0]!, audioLanguages: ['ja', 'en'], subtitleLanguages: ['mul'] }] }).host, 'Netflix')
    .querySelectorAll('.languages')].map(line => line.getAttribute('title'))
  try {
    expect(titles()).toEqual(['Audio: Japanese, English', 'Subtitles: Multiple languages'])
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    expect(titles()).toEqual(['Audio: Japanisch und Englisch', 'Untertitel: Mehrere Sprachen'])
  } finally {
    chrome.mockRestore()
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

test('in German, a card names its languages in German, joined as German joins them, its rest after the third, and its releases', async () => {
  try {
    await startLanguage({ language: 'de', languages: ['de-DE'] })
    const { host } = selector({ sources: [{ ...sources[0]!, audioLanguages: ['ja', 'en', 'fr', 'de', 'it'], subtitleLanguages: ['ja', 'en'] }, sources[2]!] })
    const [audio, subtitles] = card(host, 'Netflix').querySelectorAll('.languages')
    expect(audio?.getAttribute('title')).toBe('Audio: Japanisch, Englisch, Französisch, Deutsch und Italienisch')
    expect([audio?.querySelector('.names')?.textContent, audio?.querySelector('.rest')?.textContent, audio?.querySelector('.more')?.textContent])
      .toEqual(['Japanisch, Englisch, Französisch, Deutsch und Italienisch', ', Deutsch und Italienisch', '+2'])
    expect([subtitles?.textContent, subtitles?.querySelector('.rest')]).toEqual(['UntertitelJapanisch und Englisch', null])
    expect(host.querySelector('.label')?.textContent).toBe('Ansehen auf')
    expect(host.querySelector('button.source')?.getAttribute('title')).toBe('2 Releases auf Nyaa')
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

test('a card draws nothing for a fact its source did not give', () => {
  const { host } = selector({ sources: [{ ...sources[0]!, thumbnails: [{ url: 'https://img.example/episode.jpg' }] }] })
  const netflix = card(host, 'Netflix')
  expect(netflix.querySelector('img.thumbnail'), 'the control: a card').not.toBeNull()
  expect(netflix.querySelector('.qualities, .languages')).toBeNull()
  expect(netflix.textContent).toBe('NNetflix▶')
})

test('a card\'s picture that fails to load gives way to the next, and to none once every one has', () => {
  const { host } = selector({ sources: [detailedNetflix] })
  const picture = () => card(host, 'Netflix').querySelector('img.thumbnail')
  act(() => { picture()!.dispatchEvent(new Event('error')) })
  expect(picture()?.getAttribute('src')).toBe('https://img.example/episode.jpg')
  act(() => { picture()!.dispatchEvent(new Event('error')) })
  expect(picture()).toBeNull()
  expect(card(host, 'Netflix').querySelector('.qualities'), 'what it says stays').not.toBeNull()
})

test('a source with several releases shows the facts it was given beside its count', () => {
  const nyaa = { ...sources[2]!, videoQualities: ['1080p', 'HEVC'], thumbnails: [{ url: 'https://img.example/episode.jpg' }] }
  const button = card(selector({ sources: [nyaa] }).host, '2 releases on Nyaa')
  expect(button.classList.contains('detailed')).toBe(true)
  expect([...button.querySelectorAll('.head .count, .qualities > *')].map(chip => chip.textContent)).toEqual(['2', '1080p', 'HEVC'])
})

test('a film\'s buttons and the compact icons leave a source\'s details out', () => {
  const detailedSources = [detailedNetflix, sources[1]!]
  const film = selector({ sources: detailedSources, film: true }).host
  expect(film.querySelector('.detailed, img, .qualities, .languages')).toBeNull()
  expect(card(film, 'Netflix').outerHTML, 'as a source that says nothing').toBe(card(selector({ sources, film: true }).host, 'Netflix').outerHTML)
  const compact = selector({ sources: detailedSources, compact: true }).host
  expect(compact.innerHTML).toBe(selector({ sources: [sources[0]!, sources[1]!], compact: true }).host.innerHTML)
})

describe('a hidden source icon', () => {
  const stored = new Map<string, string>()
  beforeEach(() => {
    stored.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    })
    // another tab's change arrives as a storage event on this page's window, and node's globalThis has no listeners
    vi.stubGlobal('addEventListener', window.addEventListener.bind(window))
    vi.stubGlobal('removeEventListener', window.removeEventListener.bind(window))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('leaves the compact row on screen, from this tab or another, and stays in the full list', () => {
    const compact = selector({ compact: true }).host
    const full = selector().host
    const netflix = () => compact.querySelector('a[title="Watch on Netflix"]')
    expect(netflix(), 'the control: shown before it is hidden').not.toBeNull()
    act(() => setIconShown('nf', false))
    expect(netflix()).toBeNull()
    expect(compact.querySelector('a[title="Watch on Hulu"]')).not.toBeNull()
    expect(full.querySelector('a[title="Netflix"]'), 'still offered where a source is picked').not.toBeNull()
    stored.delete(HIDDEN_ICONS_KEY)
    act(() => { window.dispatchEvent(Object.assign(new Event('storage'), { key: HIDDEN_ICONS_KEY })) })
    expect(netflix(), 'shown again by another tab').not.toBeNull()
  })

  test('draws no button for a film', () => {
    const { host } = selector({ film: true })
    expect(names(host), 'the control: drawn while shown').toEqual(['Netflix', 'Hulu', 'Nyaa'])
    act(() => setIconShown('nf', false))
    expect(names(host)).toEqual(['Hulu', 'Nyaa'])
  })
})
