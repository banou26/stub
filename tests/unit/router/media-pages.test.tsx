// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { Route, Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'

// The preview and the title page against the details the worker has answered for each uri, and nothing
// for every other subscription. As urql 4.2.2's `computeNextState` does, a subscription keeps its last
// answer, and the operation it answered, while a new one starts.
const answers = vi.hoisted(() => ({ byUri: {} as Record<string, unknown> }))
vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: ({ query, variables, pause }: { query: { definitions: { name?: { value: string } }[] }, variables: { input?: { uri?: string } }, pause?: boolean }) => {
      const last = useRef<{ data?: unknown, operation?: unknown }>({})
      const media = !pause && query.definitions[0]?.name?.value === 'GetMediaDetails' ? answers.byUri[variables.input?.uri ?? ''] : undefined
      if (media) last.current = { data: { media }, operation: { variables } }
      return [last.current]
    },
    useMutation: () => [{}, async () => ({})],
  }
})
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronLeft', 'ChevronRight', 'Clapperboard', 'Frown', 'LoaderCircle', 'LucidePause', 'LucidePlay', 'Meh', 'Minus', 'Network', 'Plus', 'Share2', 'Smile', 'Square', 'Star', 'Volume', 'Volume1', 'Volume2', 'VolumeX', 'X']
    .map(name => [name, () => null])))
vi.mock('../../../src/worker', () => ({ trackerCheck: async () => {} }))
vi.mock('../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
vi.mock('../../../src/tracking/site-status', () => ({ recordTrackerAnswers: () => {}, siteStatuses: { record: () => {} } }))
vi.mock('../../../src/components/yt-minimal-player', () => ({ default: () => null }))
vi.mock('../../../src/components/media-franchise', () => ({ default: () => null }))

const { default: MediaModal } = await import('../../../src/router/home/media-modal')
const { default: TitlePage } = await import('../../../src/router/title/index')

const work = (id: number, title: string) => ({
  _id: `cl:${id}`,
  uri: `ag:(anilist:${id})`,
  origin: 'ag',
  id: String(id),
  handles: [],
  titles: [{ title, language: 'en', score: 1 }, { title: `${title} (second)`, language: 'ja', score: 1 }],
  descriptions: [{ language: 'en', description: `${title}, described.` }],
  covers: [],
  banners: [],
  trailers: [],
  categories: ['ANIME'],
  type: 'TV',
  status: 'FINISHED',
  season: 'FALL',
  seasonYear: 2023,
  genres: [],
  tags: [],
  relations: [],
  episodeCount: 2,
  settled: false,
  episodes: [1, 2].map(number => ({ _id: `ep:${id}-${number}`, uri: `ag:(anilist:${id}-${number})`, origin: 'ag', id: `${id}-${number}`, episodeNumber: number, titles: [{ title: `Episode ${number}` }], handles: [] })),
})
// the first source's answer: a title and a count, and nothing yet of the rest
const partial = (id: number) => ({ ...work(id, ''), titles: [], descriptions: [], type: null, status: null, season: null, seasonYear: null, episodeCount: null, episodes: [] })
const film = (id: number) => ({ ...work(id, 'Spirited Away'), type: 'MOVIE', categories: ['ANIME', 'MOVIE'], episodes: [] })

beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  answers.byUri = {}
  vi.unstubAllGlobals()
})

const open = (path: string, page: () => preact.JSX.Element) => {
  const { hook, searchHook, navigate } = memoryLocation({ path })
  const tree = () => <Router hook={hook} searchHook={searchHook}><Route path={path.replace(/ag:\(.*\)$/, ':uri')} component={page}/></Router>
  const host = mount(tree())
  hosts.push(host)
  return {
    host,
    answer: (media: { uri: string, settled?: boolean }) => act(() => { answers.byUri[media.uri] = media; render(tree(), host) }),
    navigate: (to: string) => act(() => { navigate(to) }),
  }
}
const preview = (uri: string) => open(`/media/${uri}`, () => <MediaModal mediaNodes={[]}/>)
const titlePage = (uri: string) => open(`/title/${uri}`, TitlePage)
// the modal draws in a portal on the page's body
const modal = () => document.body.querySelector('.modal')!

// every placeholder drawn, by its own classes: the outermost element a reader is told to skip
const pending = (root: Element) => [...root.querySelectorAll('[aria-hidden="true"]')]
  .filter(element => !element.parentElement!.closest('[aria-hidden="true"]'))
  .map(element => element.className.split(' ').filter(name => name && !name.startsWith('css-')).join('.'))

describe('the preview', () => {
  test('holds its title and description until the worker answers, then draws them', () => {
    const { answer } = preview(work(1, 'Frieren').uri)
    expect(pending(modal())).toEqual(['title-pending', 'description.pending'])

    answer(work(1, 'Frieren'))
    expect(pending(modal())).toEqual([])
    expect(modal().querySelector('.header > .title')!.textContent).toBe('Frieren')
    expect(modal().querySelectorAll('.episode')).toHaveLength(2)
  })

  test('holds each until its own field arrives, or every source has answered without it', () => {
    const { answer } = preview(work(1, 'Frieren').uri)
    answer(partial(1))
    expect(pending(modal())).toEqual(['title-pending', 'description.pending', 'episode.placeholder', 'episode.placeholder', 'episode.placeholder'])

    answer({ ...partial(1), settled: true })
    expect(pending(modal())).toEqual([])
  })

  test('draws no episode rows for a film, nor their placeholders before the worker says it is one', () => {
    const { answer } = preview(film(3).uri)
    expect(modal().querySelectorAll('.episode, .episodes')).toHaveLength(0)

    answer(film(3))
    expect(modal().querySelectorAll('.episode, .episodes')).toHaveLength(0)
    expect(modal().querySelector('.movie'), 'the control: drawn as a film').not.toBeNull()
  })
})

describe('the title page', () => {
  test('holds its season, title, chips, description and play button until the worker answers, then draws them', () => {
    const { host, answer } = titlePage(work(1, 'Frieren').uri)
    expect(pending(host)).toEqual(['pending', 'pending', 'pending', 'description', 'play-pending'])
    expect(host.querySelector('[data-episodes]'), 'no Episodes heading before the work is known not to be a film').toBeNull()

    answer(work(1, 'Frieren'))
    expect(pending(host)).toEqual([])
    expect(host.querySelector('h1')!.textContent).toBe('Frieren')
    expect(host.querySelectorAll('[data-episodes] .episode')).toHaveLength(2)
  })

  test('holds each until its own field arrives, or every source has answered without it', () => {
    const { host, answer } = titlePage(work(1, 'Frieren').uri)
    answer(partial(1))
    expect(pending(host)).toEqual(['pending', 'pending', 'pending', 'description', 'episode.placeholder', 'episode.placeholder', 'episode.placeholder'])

    answer({ ...partial(1), settled: true })
    expect(pending(host)).toEqual([])
  })

  test('draws no Episodes section for a film, before or after the worker answers', () => {
    const { host, answer } = titlePage(film(3).uri)
    expect(host.querySelector('[data-episodes]')).toBeNull()

    answer(film(3))
    expect(host.querySelector('h1')!.textContent, 'the control: answered').toBe('Spirited Away')
    expect(host.querySelector('[data-episodes]')).toBeNull()
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
