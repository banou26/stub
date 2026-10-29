// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../components/dom'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

import { releaseDateLabel } from '../../../src/utils/release-date'

// The preview and the title page against the details the worker has answered for each uri, the origins `origins`
// answers for each list of ids (undefined while that answer is out), and nothing for every other subscription. As urql
// 4.2.2's `computeNextState` does, a subscription keeps its last answer, and the operation it answered, while a new one
// starts.
const answers = vi.hoisted(() => ({ byUri: {} as Record<string, unknown>, origins: (_: string[]): unknown[] | undefined => undefined }))
vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: ({ query, variables, pause }: { query: { definitions: { name?: { value: string } }[] }, variables: { input?: { uri?: string, ids?: string[] } }, pause?: boolean }) => {
      const last = useRef<{ data?: unknown, operation?: unknown }>({})
      const nodes = !pause && query.definitions[0]?.name?.value === 'GetMediaOrigins' ? answers.origins(variables.input?.ids ?? []) : undefined
      if (nodes) last.current = { data: { originPage: { nodes } }, operation: { variables } }
      const media = !pause && query.definitions[0]?.name?.value === 'GetMediaDetails' ? answers.byUri[variables.input?.uri ?? ''] : undefined
      if (media) last.current = { data: { media }, operation: { variables } }
      return [last.current]
    },
    useMutation: () => [{}, async () => ({})],
  }
})
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronLeft', 'ChevronRight', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Clapperboard', 'Frown', 'LoaderCircle', 'LucidePause', 'LucidePlay', 'Meh', 'Minus', 'Network', 'Plus', 'Share2', 'Smile', 'Square', 'Star', 'Volume', 'Volume1', 'Volume2', 'VolumeX', 'X']
    .map(name => [name, () => null])))
vi.mock('../../../src/worker', () => ({ trackerCheck: async () => {} }))
vi.mock('../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
vi.mock('../../../src/tracking/site-status', () => ({ recordTrackerAnswers: () => {}, siteStatuses: { record: () => {} } }))
vi.mock('../../../src/components/yt-minimal-player', () => ({ default: () => null }))
vi.mock('../../../src/components/media-franchise', () => ({ default: () => null }))

const { default: MediaModal } = await import('../../../src/router/home/media-modal')
const { default: TitlePage } = await import('../../../src/router/title/index')
const { startLanguage } = await import('../../../src/i18n')

const work = (id: number, title: string) => ({
  _id: `cl:${id}`,
  uri: `ag:(anilist:${id})`,
  origin: 'ag',
  id: String(id),
  handles: [],
  titles: [{ title, language: 'en', score: 1 }, { title: `${title} (second)`, language: 'ja', score: 1 }, { title: `${title} (third)`, language: 'en', score: 1 }],
  descriptions: [{ language: 'en', description: `${title}, described.` }],
  covers: [],
  banners: [],
  trailers: [],
  categories: ['ANIME'],
  type: 'TV',
  status: 'FINISHED',
  season: 'FALL',
  seasonYear: 2023,
  startDate: '2023-09-29',
  duration: 24,
  studios: ['Madhouse'],
  sourceMaterial: 'MANGA',
  genres: ['Fantasy'],
  tags: ['Travel'],
  relations: [],
  episodeCount: 2,
  settled: false,
  episodes: [1, 2].map(number => ({ _id: `ep:${id}-${number}`, uri: `ag:(anilist:${id}-${number})`, origin: 'ag', id: `${id}-${number}`, episodeNumber: number, titles: [{ title: `Episode ${number}` }], handles: [] })),
})
// the first source's answer: a title and a count, and nothing yet of the rest
const partial = (id: number) => ({
  ...work(id, ''), titles: [], descriptions: [], type: null, status: null, season: null, seasonYear: null, startDate: null, duration: null,
  studios: [], sourceMaterial: null, genres: [], tags: [], episodeCount: null, episodes: [],
})
const film = (id: number) => ({ ...work(id, 'Spirited Away'), type: 'MOVIE', categories: ['ANIME', 'MOVIE'], episodes: [] })
// Penguin Highway's modal, 2026-10-19: the answer naming the film's sources and the one saying every source has
// answered can land 17 ms apart, and the origins of those sources answer 34 ms after the answer naming them
const streamed = (settled: boolean) => ({
  ...film(3),
  settled,
  episodes: [{
    _id: 'ep:3-1', uri: 'ag:(anilist:3-1)', origin: 'ag', id: '3-1', episodeNumber: 1, titles: [],
    handles: settled ? [{ relation: 'SAME_AS', node: { uri: 'cr:GX1', origin: 'cr', url: 'https://www.crunchyroll.com/watch/GX1' } }] : [],
  }],
})
// Crunchyroll's origin, once `ready`
const crunchyroll = (ready: () => boolean) => (ids: string[]) =>
  !ids.includes('cr') ? [] : ready() ? [{ id: 'cr', name: 'Crunchyroll', icon: null, color: null }] : undefined
const sequel = { relation: 'SEQUEL', format: 'TV', node: { _id: 'anilist:9', uri: 'anilist:9', titles: [{ title: 'Frieren 2' }], covers: [] } }

beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  answers.byUri = {}
  answers.origins = () => undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const open = (path: string, page: () => preact.JSX.Element) => {
  const { hook, searchHook, navigate, history } = memoryLocation({ path, record: true })
  const tree = () => <Router hook={hook} searchHook={searchHook}><Route path={path.replace(/ag:\(.*\)$/, ':uri')} component={page}/></Router>
  const host = mount(withIntl(tree()))
  hosts.push(host)
  return {
    host,
    history: history!,
    answer: (media: { uri: string, settled?: boolean }, asked = media.uri) => act(() => { answers.byUri[asked] = media; render(withIntl(tree()), host) }),
    navigate: (to: string) => act(() => { navigate(to) }),
  }
}
const preview = (uri: string) => open(`/media/${uri}`, () => <MediaModal mediaNodes={[]}/>)
const titlePage = (uri: string) => open(`/title/${uri}`, TitlePage)
// the modal draws in a portal on the page's body
const modal = () => document.body.querySelector('.modal')!

// each element's own classes, without emotion's
const classes = (elements: Iterable<Element>) => [...elements]
  .map(element => element.className.split(' ').filter(name => name && !name.startsWith('css-')).join('.'))
// every placeholder drawn, by its own classes: the outermost element a reader is told to skip
const pending = (root: Element) => classes([...root.querySelectorAll('[aria-hidden="true"]')]
  .filter(element => !element.parentElement!.closest('[aria-hidden="true"]')))
// the lines of facts every anime has, each held until it arrives
const HELD_FACTS = Array<string>(11).fill('fact.placeholder')
// each fact's label, and its value or that it is held
const facts = (root: Element) => [...root.querySelectorAll('.facts > div')]
  .map(line => `${line.querySelector('dt')!.textContent}: ${line.classList.contains('placeholder') ? 'held' : line.querySelector('dd')!.textContent}`)

describe('the preview', () => {
  test('holds its title and description until the worker answers, then draws them', () => {
    const { answer } = preview(work(1, 'Frieren').uri)
    expect(pending(modal())).toEqual(['title-pending', 'released.pending', 'description.pending'])

    answer(work(1, 'Frieren'))
    expect(pending(modal())).toEqual([])
    expect(modal().querySelector('.header > .title')!.textContent).toBe('Frieren')
    expect(modal().querySelectorAll('.episode')).toHaveLength(2)
  })

  test('holds each until its own field arrives, or every source has answered without it', () => {
    const { answer } = preview(work(1, 'Frieren').uri)
    answer(partial(1))
    expect(pending(modal())).toEqual(['title-pending', 'released.pending', 'description.pending', 'episode.placeholder', 'episode.placeholder', 'episode.placeholder'])

    answer({ ...partial(1), settled: true })
    expect(pending(modal())).toEqual([])
  })

  // HOR-1017: the owner, "Probably put the release date somewhere like, under the titles"
  test('draws the release date under the title, its season without a day, and nothing without either', () => {
    const frieren = work(1, 'Frieren')
    const { answer } = preview(frieren.uri)
    answer(frieren)
    expect(modal().querySelector('.header + .released-row > .released')?.textContent).toBe(releaseDateLabel('2023-09-29'))
    const seasonOnly = { ...frieren, startDate: null, settled: true }
    answer(seasonOnly)
    expect(modal().querySelector('.header + .released-row > .released')?.textContent).toBe('Fall 2023')
    const undated = { ...seasonOnly, season: null, seasonYear: null }
    answer(undated)
    expect(modal().querySelector('.released')).toBeNull()
  })

  // HOR-1059: the owner, "there's spacing between "More details" and the tracking elements. I don't want that."
  test('draws the tracking on the release date\'s row', () => {
    const { answer } = preview(work(1, 'Frieren').uri)
    answer(work(1, 'Frieren'))
    expect(classes(modal().querySelector('.header + .released-row')!.children)).toEqual(['released', 'tracking-compact'])
  })

  test('draws a film\'s tracking alone on its row, under Play', () => {
    const { answer } = preview(film(3).uri)
    answer(film(3))
    expect(classes(modal().querySelector('.header + .movie + .released-row')!.children)).toEqual(['tracking-compact'])
  })

  test('draws a film\'s release date in its line of facts under the title', () => {
    const { answer } = preview(film(3).uri)
    answer(film(3))
    expect(modal().querySelector('.released')).toBeNull()
    expect(modal().querySelector('.header + .movie > .facts')?.textContent).toBe(`Movie · ${releaseDateLabel('2023-09-29')} · Fantasy`)
  })

  // a source joining later turns the media unsettled again, as JustWatch answering after the rest have does
  test('holds nothing a second time once every source has answered, though a source joins later', () => {
    const late = { ...partial(3), type: 'MOVIE' }
    const { answer } = preview(late.uri)
    answer(late)
    expect(pending(modal()), 'the control: held while a source is out').toEqual(['title-pending', 'description.pending', 'pending'])
    expect(modal().querySelector('.play-bar.held'), 'and Play\'s place').not.toBeNull()

    answer({ ...late, settled: true })
    expect(pending(modal())).toEqual([])
    answer({ ...late, settled: false })
    expect(pending(modal())).toEqual([])
    expect(modal().querySelector('.play-bar')!.textContent).toBe('No sources yet')
  })

  test('a film settled before its sources\' origins answer holds Play\'s place, and never reads No sources yet', () => {
    let ready = false
    answers.origins = crunchyroll(() => ready)
    const { answer } = preview(film(3).uri)
    answer(streamed(false))
    expect(modal().querySelector('.play-bar.held'), 'the control: held while a source is out').not.toBeNull()

    answer(streamed(true))
    expect(modal().querySelector('.play-bar .when')).toBeNull()
    expect(modal().querySelector('.play-bar.held')).not.toBeNull()

    ready = true
    answer(streamed(true))
    expect(modal().querySelector('.play-bar > a.play'), 'the control: Play, once its origin answers').not.toBeNull()
    expect(modal().querySelector('.play-bar .when')).toBeNull()
  })

  test('a film whose answered source gives none holds Play\'s place while a source named later is out', () => {
    let ready = false
    answers.origins = ids => ids.includes('cr') ? crunchyroll(() => ready)(ids) : ids.length ? [] : undefined
    const anilist = { relation: 'SAME_AS', node: { uri: 'anilist:3-1', origin: 'anilist', url: 'https://anilist.co/anime/3' } }
    const naming = (settled: boolean, ...handles: unknown[]) => ({ ...film(3), settled, episodes: [{ ...streamed(true).episodes[0]!, handles }] })
    const { answer } = preview(film(3).uri)
    answer(naming(false, anilist))
    answer(naming(true, anilist, ...streamed(true).episodes[0]!.handles))
    expect(modal().querySelector('.play-bar .when')).toBeNull()
    expect(modal().querySelector('.play-bar.held')).not.toBeNull()

    ready = true
    answer(naming(true, anilist, ...streamed(true).episodes[0]!.handles))
    expect(modal().querySelector('.play-bar > a.play'), 'the control: Play, once its origin answers').not.toBeNull()
  })

  // the worker answers no origins for an empty list of ids
  test('a film whose episode names no source reads No sources yet once settled', () => {
    answers.origins = ids => ids.length ? [] : undefined
    const { answer } = preview(film(3).uri)
    answer({ ...streamed(false), settled: true })
    expect(modal().querySelector('.play-bar')!.textContent).toBe('No sources yet')
  })

  test('draws no episode rows for a film, nor their placeholders before the worker says it is one', () => {
    const { answer } = preview(film(3).uri)
    expect(modal().querySelectorAll('.episode, .episodes')).toHaveLength(0)

    answer(film(3))
    expect(modal().querySelectorAll('.episode, .episodes')).toHaveLength(0)
    expect(modal().querySelector('.movie'), 'the control: drawn as a film').not.toBeNull()
  })

  const header = () => modal().querySelector('.trailer')!.getAttribute('style') ?? ''
  const posterOnly = { ...work(1, 'Frieren'), covers: [{ language: 'en', url: 'https://img.test/frieren-cover.jpg' }] }
  const trailer = { uri: 'yt:a', origin: 'yt', id: 'a', url: 'https://www.youtube.com/watch?v=a' }
  const withBanner = (url: string, trailers: typeof trailer[] = []) => ({ ...posterOnly, banners: [{ language: 'en', url }], trailers })
  const loads = () => act(() => new Promise(resolve => setTimeout(resolve, 10)))
  // the probe caches each url for the whole file, so every test names banners of its own
  const images = (fails = (_: string) => false) => {
    const requested: string[] = []
    vi.stubGlobal('Image', class {
      onload?: () => void
      onerror?: () => void
      set src (url: string) {
        requested.push(url)
        setTimeout(() => fails(url) ? this.onerror?.() : this.onload?.())
      }
    })
    return requested
  }

  test('heads with the banner when the work has one', async () => {
    const { answer } = preview(posterOnly.uri)
    answer(withBanner('https://img.test/frieren-banner.jpg'))
    await loads()
    expect(header()).toContain('https://img.test/frieren-banner.jpg')
  })

  test('heads with the poster when it has none', async () => {
    const { answer } = preview(posterOnly.uri)
    answer(posterOnly)
    await loads()
    expect(header()).toContain('https://img.test/frieren-cover.jpg')
  })

  test('heads with the poster when no banner loads', async () => {
    images(url => url.includes('broken'))
    const { answer } = preview(posterOnly.uri)
    answer(withBanner('https://img.test/frieren-broken-banner.jpg'))
    await loads()
    expect(header()).toContain('https://img.test/frieren-cover.jpg')
  })

  test('loads no banner while a trailer plays', async () => {
    const requested = images()
    const { answer } = preview(posterOnly.uri)
    answer(withBanner('https://img.test/frieren-trailer-banner.jpg', [trailer]))
    await loads()
    expect(header()).not.toContain('url(')
    expect(requested).not.toContain('https://img.test/frieren-trailer-banner.jpg')

    answer(withBanner('https://img.test/frieren-trailer-banner.jpg'))
    await loads()
    expect(requested, 'the control: loaded once no trailer plays').toContain('https://img.test/frieren-trailer-banner.jpg')
    expect(header()).toContain('https://img.test/frieren-trailer-banner.jpg')
  })
})

describe('the title page', () => {
  test('holds its season, title, second title, chips, description, play button and relations until the worker answers, then draws them', () => {
    const frieren = { ...work(1, 'Frieren'), relations: [sequel] }
    const { host, answer } = titlePage(frieren.uri)
    expect(pending(host)).toEqual(['pending', 'pending', 'pending', 'pending', 'description', 'play-pending', ...HELD_FACTS, 'relations.placeholder'])
    expect(host.querySelector('[data-episodes]'), 'no Episodes heading before the work is known not to be a film').toBeNull()

    answer(frieren)
    expect(pending(host)).toEqual([])
    expect(host.querySelector('h1')!.textContent).toBe('Frieren')
    expect(host.querySelectorAll('[data-episodes] .episode')).toHaveLength(2)
    expect(host.querySelector('[data-relations] .relation-card')!.textContent).toContain('Frieren 2')
  })

  test('holds each until its own field arrives, or every source has answered without it', () => {
    const { host, answer } = titlePage(work(1, 'Frieren').uri)
    answer(partial(1))
    expect(pending(host)).toEqual(['pending', 'pending', 'pending', 'pending', 'description', ...HELD_FACTS, 'relations.placeholder', 'episode.placeholder', 'episode.placeholder', 'episode.placeholder'])

    answer({ ...partial(1), settled: true })
    expect(pending(host)).toEqual([])
  })

  test('holds nothing a second time once every source has answered, though a source joins later', () => {
    const late = { ...partial(3), type: 'MOVIE' }
    const { host, answer } = titlePage(late.uri)
    answer(late)
    expect(pending(host), 'the control: held while a source is out').toEqual(['pending', 'pending', 'pending', 'description', 'pending', ...HELD_FACTS.slice(1), 'relations.placeholder'])

    answer({ ...late, settled: true })
    expect(pending(host)).toEqual([])
    answer({ ...late, settled: false })
    expect(pending(host)).toEqual([])
  })

  test('a film settled before its sources\' origins answer holds its buttons\' place until they do', () => {
    let ready = false
    answers.origins = crunchyroll(() => ready)
    const { host, answer } = titlePage(film(3).uri)
    answer(streamed(false))
    expect(host.querySelector('.watch.film .pending'), 'the control: held while a source is out').not.toBeNull()

    answer(streamed(true))
    expect(host.querySelector('.watch.film .pending')).not.toBeNull()

    ready = true
    answer(streamed(true))
    expect([...host.querySelectorAll('.watch.film a .name')].map(name => name.textContent)).toEqual(['Crunchyroll'])
  })

  test('holds a line for each fact every anime has in its place, until it arrives or every source has answered without it', () => {
    const { host, answer } = titlePage(work(1, 'Frieren').uri)
    const first = { ...partial(1), type: 'TV', genres: ['Fantasy'] }
    answer(first)
    expect(facts(host)).toEqual([
      'Format: TV Show', 'Episodes: held', 'Episode length: held', 'Status: held', 'Aired: held', 'Season: held', 'Studios: held',
      'Source: held', 'Genres: Fantasy', 'Tags: held', 'Also known as: held',
    ])

    answer({ ...first, settled: true })
    expect(facts(host)).toEqual(['Format: TV Show', 'Genres: Fantasy'])
  })

  test('names its sections, its controls and its credits in English', () => {
    const voice = (name: string, language: string) => ({ name, language, image: null, url: null })
    const credited = {
      ...work(1, 'Frieren'),
      relations: [sequel],
      trailers: [{ uri: 'yt:a', origin: 'yt', id: 'a', url: 'https://www.youtube.com/watch?v=a' }],
      characters: [
        { name: 'Frieren', role: 'MAIN', image: null, url: null, voiceActors: [voice('Atsumi Tanezaki', 'ja'), voice('Mallorie Rodak', 'en')] },
        { name: 'Himmel', role: 'SUPPORTING', image: null, url: null, voiceActors: [voice('Nobuhiko Okamoto', 'ja')] },
        { name: 'Flamme', role: 'BACKGROUND', image: null, url: null, voiceActors: [] },
      ],
      staff: [{ name: 'Keiichirou Saitou', roles: ['Director', 'Storyboard'], image: null, url: null }],
      themes: [{ kind: 'OP', sequence: 1, title: 'Yuusha', artists: ['YOASOBI', 'Ayase'], video: 'https://v.animethemes.moe/a.webm' }],
    }
    const { host, answer } = titlePage(credited.uri)
    answer(credited)
    const texts = (selector: string) => [...host.querySelectorAll(selector)].map(element => element.textContent)
    const attributes = (selector: string, name: string) => [...host.querySelectorAll(selector)].map(element => element.getAttribute(name))
    expect(texts('.chips > .chip')).toEqual(['2 Episodes', 'TV Show', 'Finished'])
    expect(texts('[data-relations] h2 > span, [data-episodes] > h2, [data-characters] h2 > span, [data-staff] > h2, [data-themes] > h2'))
      .toEqual(['Relations', 'Episodes', 'Characters', 'Staff', 'Themes'])
    expect(texts('.relation-card .relation')).toEqual(['Sequel'])
    expect(attributes('[data-characters] select', 'aria-label')).toEqual(['Language'])
    expect(texts('[data-characters] option')).toEqual(['Japanese', 'English'])
    expect(texts('.person:not(.actor) .detail')).toEqual(['Main', 'Supporting', 'Background', 'Director, Storyboard'])
    expect(texts('[data-themes] .theme > span:not(.toggle)')).toEqual(['OP1', 'Yuusha', 'YOASOBI, Ayase'])
    expect(attributes('[data-themes] button.toggle', 'aria-label')).toEqual(['Play'])
    expect(['aria-label', 'title'].flatMap(name => attributes('.actions .icon', name))).toEqual(['Share', 'Trailer', 'Share', 'Trailer'])
  })

  test('holds a full page of relations: three cards and the page buttons under them', () => {
    const { host } = titlePage(work(1, 'Frieren').uri)
    expect(host.querySelectorAll('.relations.placeholder > .grid > *')).toHaveLength(3)
    expect(host.querySelector('.relations.placeholder > .grid + .pages')).not.toBeNull()
  })

  test('holds a place for relations on an address naming any anime catalogue, as AniList joins one later', () => {
    const { host } = titlePage('ag:(mal:21)')
    expect(pending(host)).toContain('relations.placeholder')
  })

  test('holds no place for relations on an address naming no anime catalogue, as AniList, the one source naming them, describes none', () => {
    const show = { ...work(4, 'The Boys'), uri: 'ag:(jw:ts78125)' }
    const { host, answer } = titlePage(show.uri)
    expect(pending(host), 'the control: the rest held').toEqual(['pending', 'pending', 'pending', 'description', 'play-pending'])

    answer(show)
    expect(host.querySelector('h1')!.textContent, 'the control: answered, with sources still out').toBe('The Boys')
    expect(pending(host)).toEqual([])
  })

  // only the clock is faked, so nothing but its tick draws the page again
  test('draws Play on the clock\'s next tick once the first episode has aired', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-16T13:59:50Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const airing = { ...work(1, 'Frieren'), status: 'RELEASING', nextAiringEpisode: { episodeNumber: 1, airingAt: '2026-10-16T14:00:00Z' } }
    const { host, answer } = titlePage(airing.uri)
    answer(airing)
    expect(host.querySelector('.episode.unreleased .number')?.textContent, 'the control: the first is not out yet').toBe('1')
    expect(host.querySelector('.play')).toBeNull()

    act(() => { vi.advanceTimersByTime(30_000) })
    expect(host.querySelector('.episode.unreleased .number')?.textContent, 'the control: its row lit up').toBe('2')
    expect(host.querySelector('.play')?.getAttribute('href')).toBe(`/watch/${airing.uri}/ag:(anilist:1-1)`)
  })

  // a film with its one episode, dated as given
  const dated = (startDate: string, releaseDate?: string) => ({
    ...film(3),
    startDate,
    episodes: [{ _id: 'ep:3-1', uri: 'ag:(anilist:3-1)', origin: 'ag', id: '3-1', episodeNumber: 1, titles: [], handles: [], releaseDate }],
  })

  test('a film not out yet reads Releases and draws no Play, as the modal does', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-17T03:00:00Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const out = titlePage(dated('2001-07-20').uri)
    out.answer(dated('2001-07-20'))
    expect(facts(out.host), 'the control: a film out reads Aired').toContain('Aired: Jul 20, 2001')
    expect(out.host.querySelector('.play'), 'the control: and draws Play').not.toBeNull()
    unmount(hosts.pop()!)

    const { host, answer } = titlePage(dated('2027-03-05').uri)
    answer(dated('2027-03-05'))
    expect(facts(host)).toContain('Releases: Mar 5, 2027')
    expect(facts(host).some(fact => fact.startsWith('Aired'))).toBe(false)
    expect(host.querySelector('.play')).toBeNull()
  })

  test('a film whose episode is dated days from its own day is out by its own day', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-17T03:00:00Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
    // its own day ahead, its episode's time weeks behind it (a screening)
    const { host, answer } = titlePage(dated('2026-12-24', '2026-10-01T12:00:00Z').uri)
    answer(dated('2026-12-24', '2026-10-01T12:00:00Z'))
    expect(host.querySelector('h1')!.textContent, 'the control: answered').toBe('Spirited Away')
    expect(host.querySelector('.play')).toBeNull()
  })

  test('draws no Episodes section for a film, before or after the worker answers', () => {
    const { host, answer } = titlePage(film(3).uri)
    expect(host.querySelector('[data-episodes]')).toBeNull()

    answer(film(3))
    expect(host.querySelector('h1')!.textContent, 'the control: answered').toBe('Spirited Away')
    expect(host.querySelector('[data-episodes]')).toBeNull()
  })

  // the sites beside Play and the film's buttons each ask for their origins, and the sites' answer can land first
  test('draws none of a film\'s services beside Play, though the sites there have their origins before its buttons do', () => {
    const sites = { anilist: 'AniList', hoopla: 'Hoopla', tubi: 'Tubi' }
    const offered = { ...dated('2001-07-20'), handles: Object.keys(sites).map(origin => ({ relation: 'SAME_AS', node: { uri: `${origin}:3`, origin, url: `https://${origin}.test/3` } })) }
    const nodes = (ids: string[]) => Object.entries(sites).filter(([id]) => ids.includes(id)).map(([id, name]) => ({ id, name, icon: `https://${id}.test/icon.png`, color: null }))
    answers.origins = ids => ids.includes('anilist') ? nodes(ids) : undefined
    const { host, answer } = titlePage(offered.uri)
    answer(offered)
    const row = () => [...host.querySelectorAll('.actions .origins > .origin')].map(site => site.getAttribute('title'))
    expect(host.querySelectorAll('.heading > .watch a'), 'the control: the buttons have no origins yet').toHaveLength(0)
    expect(row()).toEqual(['AniList'])

    answers.origins = nodes
    answer(offered)
    expect([...host.querySelectorAll('.heading > .watch a .name')].map(name => name.textContent), 'the control: the buttons name them').toEqual(['Hoopla', 'Tubi'])
    expect(row()).toEqual(['AniList'])
  })
})

describe('after a navigation, before the next work has answered', () => {
  const empty = { ...work(1, 'Inferno Cop 2'), episodes: [], settled: true }
  const next = work(2, 'Frieren')

  test('the preview never says the work just left has no episodes', () => {
    const { answer, navigate } = preview(empty.uri)
    answer(empty)
    expect(modal().textContent, 'the control: said for the work it answered').toContain('No episodes found')

    navigate(`/media/${next.uri}`)
    expect(modal().textContent).not.toContain('No episodes found')
    expect(pending(modal()), 'its rows held').toContain('episode.placeholder')
  })

  test('nor does the title page', () => {
    const { host, answer, navigate } = titlePage(empty.uri)
    answer(empty)
    expect(host.textContent, 'the control: said for the work it answered').toContain('No episodes found')

    navigate(`/title/${next.uri}`)
    expect(host.textContent).not.toContain('No episodes found')
    expect(pending(host), 'its rows held').toContain('episode.placeholder')
  })
})

// Steel Ball Run's second stage, welded to the first stage's rows for a pass and split apart by the next
describe('the url after a split', () => {
  const opened = 'ag:(anilist:210482)'
  const welded = 'ag:(anilist:210482,mal:61469,offline:mal-61469)'
  const split = 'ag:(anilist:210482,offline:mal-63825)'
  const stage = (uri: string) => ({ ...work(210482, 'Steel Ball Run'), uri })
  // the pages carry the query string across a rewrite, read off the window
  beforeEach(() => { vi.stubGlobal('location', { search: '' }) })

  for (const [page, route] of [[preview, 'media'], [titlePage, 'title']] as const) {
    test(`/${route}: an address the page grew follows its card back down, so a reload opens that card`, () => {
      const { answer, history } = page(opened)
      answer(stage(welded), opened)
      expect(history, 'the control: grown to the welded card').toEqual([`/${route}/${welded}`])

      answer(stage(split), opened)
      expect(history).toEqual([`/${route}/${split}`])
    })

    test(`/${route}: a link the reader opened is left as it is`, () => {
      const { answer, history } = page(welded)
      answer(stage(split), welded)
      expect(history).toEqual([`/${route}/${welded}`])
    })
  }
})

// HOR-1003 (a series opened by a bare TVmaze id drew nothing). The show's answer carries its IMDb id, so its address grew in
// the very commit MediaSeasons sends a show to its first season, and the page and the modal both replaced that redirect
// with the show's grown address
describe('a show\'s own address', () => {
  const show = (id: number, seasons?: number[]) => ({
    ...work(id, 'Spec Maze'),
    uri: `ag:(imdb:tt${id},tvmaze:${id})`,
    handles: [`tvmaze:${id}`, `imdb:tt${id}`].map(uri => ({ relation: 'SAME_AS', node: { uri, origin: uri.split(':')[0] } })),
    seasons: seasons?.map(number => ({ number, uri: `tvmaze:${id}-s${number}` })),
  })
  beforeEach(() => { vi.stubGlobal('location', { search: '' }) })

  for (const [page, route] of [[preview, 'media'], [titlePage, 'title']] as const) {
    test(`/${route}: goes to its first season though its address grows as it answers`, () => {
      const opened = page('ag:(tvmaze:900200)')
      opened.answer(show(900200, [1, 2]), 'ag:(tvmaze:900200)')
      expect(opened.history).toEqual([`/${route}/ag:(tvmaze:900200-s1)`])

      const control = page('ag:(tvmaze:900201)')
      control.answer(show(900201), 'ag:(tvmaze:900201)')
      expect(control.history, 'the control: with no seasons the address grows').toEqual([`/${route}/ag:(imdb:tt900201,tvmaze:900201)`])
    })
  }
})

describe('Relations', () => {
  const related = (relation: string, format: string, id: number, title: string) =>
    ({ relation, format, node: { _id: `anilist:${id}`, uri: `anilist:${id}`, titles: [{ title }], covers: [] } })
  // The Apothecary Diaries season 3's relations as AniList names them, 2026-10-17: a prequel, a sequel and three more
  // that play, and the novel and manga it adapts, which do not
  const apothecary = [
    related('ADAPTATION', 'NOVEL', 99026, 'The Apothecary Diaries'),
    related('PREQUEL', 'TV', 176301, 'The Apothecary Diaries Season 2'),
    related('SEQUEL', 'TV', 200927, 'Kusuriya no Hitorigoto 3rd Season Part 2'),
    related('SIDE_STORY', 'MOVIE', 200929, 'The Apothecary Diaries: The Late Lady’s Treasure'),
    related('ALTERNATIVE', 'MANGA', 99022, 'The Apothecary Diaries'),
    related('OTHER', 'MUSIC', 218387, 'AIYOU'),
    related('OTHER', 'MUSIC', 218390, 'Beyond the Clouds, Only Me Downwind'),
  ]
  // One Piece's 61 related works that play
  const onePiece = Array.from({ length: 61 }, (_, index) =>
    related(index % 4 ? 'SIDE_STORY' : 'SUMMARY', 'SPECIAL', 1_000 + index, `One Piece Special ${index + 1}`))

  const titles = (root: Element) => [...root.querySelectorAll('[data-relations] .relation-card .title')].map(title => title.textContent)
  const pageButtons = (root: Element) =>
    [...root.querySelectorAll('[data-relations] nav[aria-label="Relations pages"] button[aria-label^="Page "]')].map(button => button.textContent)
  const current = (root: Element) => root.querySelector('[data-relations] nav button[aria-current="page"]')?.textContent

  for (const [name, relations, pages] of [['The Apothecary Diaries season 3', apothecary, ['1', '2']], ['One Piece', onePiece, ['1', '2', '3', '4', '5', '…', '21']]] as const) {
    test(`the preview draws ${name}'s as the title page does: a page of three in its order, and page buttons`, () => {
      const media = { ...work(1, name), relations }
      const { host, answer } = titlePage(media.uri)
      answer(media)
      expect(titles(host), 'the control: the title page draws a page of three').toHaveLength(3)
      expect(pageButtons(host)).toEqual(pages)

      preview(media.uri).answer(media)
      expect(titles(modal())).toEqual(titles(host))
      expect(pageButtons(modal())).toEqual(pages)
    })
  }

  test('ranked by what the relation is, a sequel beside the prequel, and only works that play', () => {
    // out of rank order, under the novel linked as the source, which ranks first and does not play
    const relations = [...apothecary.slice(1), related('SOURCE', 'NOVEL', 99026, 'The Apothecary Diaries')].reverse()
    const media = { ...work(1, 'The Apothecary Diaries Season 3'), relations }
    preview(media.uri).answer(media)
    expect(titles(modal())).toEqual(['The Apothecary Diaries Season 2', 'Kusuriya no Hitorigoto 3rd Season Part 2', 'The Apothecary Diaries: The Late Lady’s Treasure'])
  })

  test('another work opened in the preview starts its relations on their first page', () => {
    const first = { ...work(1, 'One Piece'), relations: onePiece }
    const next = { ...work(2, 'One Piece Film'), relations: onePiece }
    const { answer, navigate } = preview(first.uri)
    answer(first)
    act(() => { modal().querySelector<HTMLButtonElement>('[data-relations] button[aria-label="Next page"]')!.click() })
    expect(current(modal()), 'the control: paged').toBe('2')

    navigate(`/media/${next.uri}`)
    answer(next)
    expect(current(modal())).toBe('1')
  })
})

// the title page's facts once wrote the shown language's dates while its episodes kept the browser's
describe('every date, in the shown language as the browser writes it: British English here', () => {
  beforeAll(() => startLanguage({ language: 'en', languages: ['en-GB'] }))
  afterAll(() => startLanguage({ language: 'en', languages: ['en-US'] }))
  const dated = () => {
    const frieren = work(1, 'Frieren')
    return { ...frieren, settled: true, episodes: frieren.episodes.map(episode => ({ ...episode, releaseDate: '2023-10-06' })) }
  }
  const british = (day: string) => releaseDateLabel(day, { locale: 'en-GB' })
  const episodeDays = (root: Element) => [...root.querySelectorAll('.episode time')].map(time => time.textContent)

  test('the control: British English writes a day otherwise than the runner\'s US English', () => {
    expect(british('2023-10-06')).not.toBe(releaseDateLabel('2023-10-06'))
  })

  test('on the title page, its facts and its episodes', () => {
    const { host, answer } = titlePage(dated().uri)
    answer(dated())
    expect(facts(host)).toContain(`Aired: ${british('2023-09-29')}`)
    expect(episodeDays(host)).toEqual([british('2023-10-06'), british('2023-10-06')])
  })

  test('on the preview, its release date and its episodes', () => {
    const { answer } = preview(dated().uri)
    answer(dated())
    expect(modal().querySelector('.header + .released-row > .released')?.textContent).toBe(british('2023-09-29'))
    expect(episodeDays(modal())).toEqual([british('2023-10-06'), british('2023-10-06')])
  })
})
