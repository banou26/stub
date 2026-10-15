// FIRST: ../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../components/dom'

import type { DetailsEpisode } from '../../../src/router/home/media-details'
import type { WatchSource } from '../../../src/components/source-selector'
import type { FknBackend } from '../../../src/utils/fkn-backend'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

import { viewerIn } from '../sources/justwatch/viewer'

const fkn = vi.hoisted(() => ({ backend: 'cloud' as FknBackend }))
vi.mock('urql', () => ({
  useSubscription: () => [{ data: { originPage: { nodes: ['nyaa', 'amazon'].map(id => ({ id, name: id, icon: null, color: null })) } } }],
}))
vi.mock('../../../src/worker', () => ({}))
vi.mock('../../../src/utils/fkn-backend', () => ({ detectBackend: async () => fkn.backend }))
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

test('a Prime Video episode outside Japan links to the watch page with the extension, and out to Prime Video on the cloud', async () => {
  viewerIn('America/Toronto')
  const url = 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.1'
  const prime = {
    uri: 'ag:(anilist:1-1,amazon:amzn1.dv.gti.1)',
    handles: [{ relation: 'SAME_AS', node: { uri: 'amazon:amzn1.dv.gti.1', origin: 'amazon', url } }],
  } as unknown as DetailsEpisode
  const hrefOn = async (backend: FknBackend) => {
    fkn.backend = backend
    let sources: WatchSource[] = []
    const Probe = () => {
      sources = useWatchSources(prime, 'ag:(anilist:1)')
      return null
    }
    hosts.push(mount(<Probe/>))
    await act(async () => {})
    return sources.map(({ id, href, external }) => ({ id, href, external }))
  }
  expect(await hrefOn('extension')).toEqual([{ id: 'amazon', href: `/watch/ag:(anilist:1)/${prime.uri}/amazon:amzn1.dv.gti.1`, external: false }])
  expect(await hrefOn('cloud')).toEqual([{ id: 'amazon', href: url, external: true }])
})
