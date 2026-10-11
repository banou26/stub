// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { act } from 'preact/test-utils'

const navigate = vi.fn()
const params = { mediaUri: 'ag:(anilist:1)', episodeUri: 'ag:(anilist:1-1,cr:GX1,nf:81,nyaa:a)' }
const handle = (uri: string, origin: string, url: string) => ({ relation: 'SAME_AS', node: { uri, origin, url } })
const media = {
  uri: params.mediaUri,
  episodes: [{
    uri: params.episodeUri,
    handles: [
      handle('cr:GX1', 'cr', 'https://www.crunchyroll.com/watch/GX1'),
      handle('nf:81', 'nf', 'https://www.netflix.com/watch/81'),
      handle('nyaa:a', 'nyaa', 'magnet:?xt=urn:btih:a'),
    ],
  }],
}
let origins: string[] | undefined
let party = { status: 'idle' }
let backend = 'cloud'

vi.mock('urql', () => ({
  useSubscription: ({ variables }: { variables: { input: { uri?: string } } }) =>
    [{ data: variables.input.uri ? { media } : origins && { originPage: { nodes: origins.map(id => ({ id, name: id })) } } }],
}))
vi.mock('wouter', () => ({ useParams: () => params, useLocation: () => ['', navigate] }))
vi.mock('../../../../src/worker', () => ({ remotePicker: async () => null, remotePlayer: async (id: string) => id === 'nyaa' ? { pluginUri: 'plugin:nyaa' } : null }))
vi.mock('../../../../src/party/use-party', () => ({ useParty: () => party, usePartyMessages: () => {} }))
vi.mock('../../../../src/utils/fkn-backend', () => ({ detectBackend: async () => backend }))
vi.mock('../../../../src/tracking/site-status', () => ({ siteStatuses: { read: () => ({ state: 'signed-out' }) } }))

const { default: Watch } = await import('../../../../src/router/watch/index')
const { QUIET_MS } = await import('../../../../src/router/watch/auto-pick')

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  navigate.mockClear()
  party = { status: 'idle' }
  backend = 'cloud'
})

const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS) })
}

test('a signed-out Crunchyroll is not picked before the plugin lookup has asked about any origin', async () => {
  vi.useFakeTimers()
  origins = undefined
  hosts.push(mount(<Watch/>))
  await settle()
  expect(navigate).not.toHaveBeenCalled()
})

test('once the lookup answers, the release wins over the signed-out Crunchyroll, and over Netflix on the cloud', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  hosts.push(mount(<Watch/>))
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

test('a member still joining a party does not pick, since it follows the host', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  party = { status: 'joining' }
  hosts.push(mount(<Watch/>))
  await settle()
  expect(navigate).not.toHaveBeenCalled()
})

test('with the extension, Netflix plays in stub and is picked at once', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  backend = 'extension'
  hosts.push(mount(<Watch/>))
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nf:81`, { replace: true })
})
