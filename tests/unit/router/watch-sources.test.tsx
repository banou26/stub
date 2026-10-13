// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsEpisode } from '../../../src/router/home/media-details'
import type { WatchSource } from '../../../src/components/source-selector'

import { afterEach, expect, test, vi } from 'vite-plus/test'

vi.mock('urql', () => ({
  useSubscription: () => [{ data: { originPage: { nodes: [{ id: 'nyaa', name: 'Nyaa', icon: null, color: null }] } } }],
}))
vi.mock('../../../src/worker', () => ({}))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))

const { useWatchSources } = await import('../../../src/router/home/media-details')

const release = (id: string) => ({ relation: 'SAME_AS', node: { uri: `nyaa:${id}`, origin: 'nyaa', url: `magnet:?xt=urn:btih:${id}` } })
const episode = { uri: 'ag:(anilist:1-1,nyaa:b,nyaa:a)', handles: [release('b'), release('a')] } as unknown as DetailsEpisode

const hosts: HTMLElement[] = []
afterEach(() => { while (hosts.length) unmount(hosts.pop()!) })

test('an origin with several releases links to its first release', () => {
  let sources: WatchSource[] = []
  const Probe = () => {
    sources = useWatchSources(episode, 'ag:(anilist:1)')
    return null
  }
  hosts.push(mount(<Probe/>))
  expect(sources.map(({ id, href }) => ({ id, href }))).toEqual([{ id: 'nyaa', href: '/watch/ag:(anilist:1)/ag:(anilist:1-1,nyaa:b,nyaa:a)/nyaa:b' }])
})
