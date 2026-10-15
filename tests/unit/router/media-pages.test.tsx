// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
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
  titles: [{ title, language: 'en', score: 1 }],
  descriptions: [{ language: 'en', description: `${title}, described.` }],
  covers: [],
  banners: [],
  trailers: [],
  categories: ['ANIME'],
  type: 'TV',
  genres: [],
  tags: [],
  relations: [],
  episodeCount: 2,
  settled: true,
  episodes: [],
})

beforeEach(() => { vi.stubGlobal('Image', class { onload?: () => void; set src (_: string) { setTimeout(() => this.onload?.()) } }) })
const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  answers.byUri = {}
  vi.unstubAllGlobals()
})

const open = (path: string, route: string, page: () => preact.JSX.Element) => {
  const { hook, searchHook, navigate } = memoryLocation({ path })
  const host = mount(<Router hook={hook} searchHook={searchHook}><Route path={route} component={page}/></Router>)
  hosts.push(host)
  return { host, navigate: (to: string) => act(() => { navigate(to) }) }
}

describe('after a navigation, before the next work has answered', () => {
  const empty = work(1, 'Inferno Cop 2')
  const next = work(2, 'Frieren')

  test('the preview never says the work just left has no episodes', () => {
    answers.byUri[empty.uri] = empty
    const { navigate } = open(`/media/${empty.uri}`, '/media/:uri', () => <MediaModal mediaNodes={[]}/>)
    // the modal draws in a portal on the page's body
    const modal = () => document.body.querySelector('.modal')!
    expect(modal().textContent, 'the control: said for the work it answered').toContain('No episodes found')

    navigate(`/media/${next.uri}`)
    expect(modal().textContent).not.toContain('No episodes found')
  })

  test('nor does the title page', () => {
    answers.byUri[empty.uri] = empty
    const { host, navigate } = open(`/title/${empty.uri}`, '/title/:uri', TitlePage)
    expect(host.textContent, 'the control: said for the work it answered').toContain('No episodes found')

    navigate(`/title/${next.uri}`)
    expect(host.textContent).not.toContain('No episodes found')
  })
})
