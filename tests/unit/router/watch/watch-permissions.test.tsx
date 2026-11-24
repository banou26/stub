// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from '../../components/dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { print } from 'graphql'
import { memoryLocation } from 'wouter/memory-location'

const cloudPermissions = vi.hoisted(() => vi.fn())
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  cloud: { permissions: { request: cloudPermissions } },
}))

const navigate = vi.fn()
const stored = new Map<string, string>()
let params: { mediaUri: string, episodeUri: string, sourceUri?: string } = {
  mediaUri: 'ag:(anilist:182255)',
  episodeUri: 'ag:(anizip:18886-10,amazon:amzn1.dv.gti.98c,nyaa:2090638)',
}
let media: object | undefined
let backend: 'cloud' | 'extension' = 'cloud'
let detectGate: Promise<unknown> = Promise.resolve()

vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: ({ query, variables, pause }: { query: Parameters<typeof print>[0], variables?: { input: { uri?: string, ids?: string[] } }, pause?: boolean }) => {
      const last = useRef<object>({})
      const printed = print(query)
      if (printed.includes('subscription MediaTracking')) return [{}]
      if (printed.includes('subscription StubTrackerStorage')) return [{}]
      const { uri, ids } = variables!.input
      if (uri === undefined) return [{ data: { originPage: { nodes: (ids ?? []).map(id => ({ id, name: id })) } } }]
      if (media !== undefined && !pause) last.current = { data: { media }, operation: { variables } }
      return [last.current]
    },
    useMutation: () => [{}, async () => ({})],
  }
})
vi.mock('wouter', async importOriginal => ({
  ...await importOriginal(),
  useParams: () => params,
  useLocation: () => ['', navigate],
  useSearch: () => '',
}))
vi.mock('../../../../src/worker', () => ({
  remotePicker: async () => null,
  remotePlayer: async (id: string) => id === 'nyaa' ? { pluginUri: 'https:stub.plugins.banou.dev' } : null,
  remoteAccount: async () => undefined,
  remoteCheck: async () => undefined,
  searchAgain: async () => {},
}))
vi.mock('../../../../src/plugins', () => ({
  addPlugins: async () => {},
  pluginStatuses: () => [{ uri: 'https:stub.plugins.banou.dev', state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }] }],
  onPluginsChange: () => () => {},
}))
vi.mock('../../../../src/party/use-party', () => ({ useParty: () => ({ status: 'idle' }), usePartyMessages: () => {} }))
vi.mock('../../../../src/utils/fkn-backend', () => ({
  detectBackend: async () => { await detectGate; return backend },
  addExtension: async () => true,
  canAddExtension: () => true,
}))
vi.mock('../../../../src/tracking/site-status', () => ({
  siteStatuses: { read: () => ({ state: 'signed-in' }), watch: () => () => {}, record: () => {}, recordSignOut: () => {} },
  recordTrackerAnswers: () => {},
}))
vi.mock('../../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
vi.mock('../../../../src/router/settings/wiring', () => ({
  crunchyroll: { signIn: async () => 'closed', signOut: async () => {} },
  prime: { signIn: async () => 'closed', signOut: async () => {} },
  sites: { isConnected: () => false, watch: () => () => {}, signIn: async () => 'closed', signOut: async () => {} },
  status: { read: () => ({ state: 'signed-in' }), watch: () => () => {}, refresh: () => {} },
}))
vi.mock('../../../../src/tracking/fkn-cloud-live', () => ({ unlockTracker: async () => false }))
vi.mock('../../../../src/party/bridge', () => ({
  attachPlaybackBridge: () => ({ apply: () => {}, dispose: () => {}, onReport: () => () => {} }),
}))
vi.mock('../../../../src/components/plugin-player', () => ({
  default: ({ release }: { release: { uri: string } }) => <div className="plugin-player" data-uri={release.uri}/>,
}))
vi.mock('../../../../src/components/party-playback', () => ({ default: () => null }))
vi.mock('../../../../src/components/media-tracking', () => ({ default: () => null }))
vi.mock('../../../../src/router/watch/up-next', () => ({ default: () => null }))
vi.mock('../../../../src/sources/crunchyroll/skip-events', () => ({
  crunchyrollEpisodeId: () => undefined,
  skipEventsToChapters: () => [],
  useSkipEvents: () => undefined,
}))
vi.mock('../../../../src/sources/aniskip', () => ({ aniskipUrl: () => undefined }))
vi.mock('../../../../src/embed-tracks', () => ({ embedTracks: () => ({ dispose: () => {} }) }))
vi.mock('../../../../src/embed-relays', () => ({ triedRelaysParams: () => ({}), hearTriedRelays: () => () => {} }))
vi.mock('../../../../src/embed-languages', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/embed-languages')>(),
  hearTrackLanguages: () => () => {},
}))
vi.mock('../../../../src/embed-unplayable', () => ({ hearUnplayable: () => () => {} }))
vi.mock('../../../../src/embed-fullscreen', () => ({ serveEmbedFullscreen: () => () => {} }))
vi.mock('../../../../src/embed-episode', () => ({ serveEmbedEpisodeNavigation: () => () => {} }))
vi.mock('../../../../src/embed-subtitles', () => ({ serveEmbedExternalSubtitles: () => () => {} }))
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronLeft', 'ChevronRight', 'ChevronsLeft', 'ChevronsRight', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Share2', 'Smile', 'Star'].map(name => [name, () => null]),
))

vi.stubGlobal('__STUB_EMBED_PAGE__', '/embed.html')
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

const { default: Watch } = await import('../../../../src/router/watch/index')
const { CRUNCHYROLL_DOMAINS } = await import('../../../../src/sources/crunchyroll/session')
const { primeDomainsFor } = await import('../../../../src/sources/amazon/session')
const { evaluationPermissionBatch } = await import('../../../../src/tracking/permission-batch')
const { CONNECTED_KEY } = await import('../../../../src/tracking/connections')
const { Router } = await import('wouter')

let locationHook = memoryLocation().hook
const watchTree = () => withIntl(<Router hook={locationHook}><Watch/></Router>)
const mountWatch = () => mount(watchTree())
const rerenderWatch = (host: HTMLElement) => render(watchTree(), host)
const primeUrl = 'https://www.amazon.co.jp/gp/video/detail/amzn1.dv.gti.98c'
const primeMedia = {
  uri: 'ag:(anilist:182255)',
  handles: [],
  settled: true,
  episodes: [{
    uri: 'ag:(anizip:18886-10,amazon:amzn1.dv.gti.98c,nyaa:2090638)',
    episodeNumber: 1,
    handles: [
      { relation: 'SAME_AS', node: { uri: 'amazon:amzn1.dv.gti.98c', origin: 'amazon', url: primeUrl } },
      { relation: 'SAME_AS', node: { uri: 'nyaa:2090638', origin: 'nyaa', url: 'magnet:?xt=urn:btih:abc' } },
    ],
  }],
}

const hosts: HTMLElement[] = []

beforeEach(() => {
  vi.stubEnv('TZ', 'Asia/Tokyo')
  locationHook = memoryLocation().hook
  params = {
    mediaUri: 'ag:(anilist:182255)',
    episodeUri: 'ag:(anizip:18886-10,amazon:amzn1.dv.gti.98c,nyaa:2090638)',
  }
  media = undefined
  backend = 'cloud'
  detectGate = Promise.resolve()
  stored.clear()
  cloudPermissions.mockReset()
  navigate.mockClear()
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('watch permission batching', () => {
  test('holds while picking Prime player, batches with concurrent trackers, and mounts embed iframe once allowed', async () => {
    stored.set(CONNECTED_KEY, JSON.stringify(['mal', 'cr']))
    let resolveBackend!: () => void
    detectGate = new Promise<void>(resolve => { resolveBackend = resolve })
    let resolveConsent!: (answers: { allow: boolean }[]) => void
    cloudPermissions.mockImplementationOnce(() => new Promise(resolve => { resolveConsent = resolve }))

    const host = mountWatch()
    hosts.push(host)
    await act(async () => {})
    expect(evaluationPermissionBatch.isHeld()).toBe(true)

    const pMal = evaluationPermissionBatch.ask({ hosts: ['myanimelist.net'], reason: 'Read MAL', backend: 'cloud' })
    const pCr = evaluationPermissionBatch.ask({ hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR', backend: 'cloud' })
    await act(async () => {})
    expect(cloudPermissions).not.toHaveBeenCalled()

    media = primeMedia
    params = { ...params, sourceUri: 'amazon:amzn1.dv.gti.98c' }
    await act(async () => { rerenderWatch(host) })
    expect(host.querySelector('iframe[src*="/embed.html"]')).toBeNull()
    expect(evaluationPermissionBatch.isHeld()).toBe(true)
    expect(cloudPermissions).not.toHaveBeenCalled()

    resolveBackend()
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(evaluationPermissionBatch.isHeld()).toBe(false)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 120)) })

    expect(host.querySelector('iframe[src*="/embed.html"]')).toBeNull()
    expect(cloudPermissions).toHaveBeenCalledTimes(1)
    expect(cloudPermissions).toHaveBeenCalledWith([
      { category: 'evaluation', hosts: ['myanimelist.net'], reason: 'Read MAL' },
      { category: 'evaluation', hosts: CRUNCHYROLL_DOMAINS, reason: 'Read CR' },
      {
        category: 'evaluation',
        hosts: primeDomainsFor(primeUrl).slice(0, 16),
        reason: 'Press Play on the episode, see whether you are signed in, switch the quality and step frames',
      },
    ])

    resolveConsent([{ allow: true }, { allow: true }, { allow: true }])
    await act(async () => { await Promise.all([pMal, pCr]) })
    expect(host.querySelector('iframe[src*="/embed.html"]')).not.toBeNull()
  })

  test('does not hold or ask for player permissions when playing through a plugin player', async () => {
    stored.set(CONNECTED_KEY, JSON.stringify(['mal', 'cr']))
    const askSpy = vi.spyOn(evaluationPermissionBatch, 'ask')
    media = primeMedia
    params = { ...params, sourceUri: 'nyaa:2090638' }

    const host = mountWatch()
    hosts.push(host)
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

    expect(evaluationPermissionBatch.isHeld()).toBe(false)
    expect(askSpy).not.toHaveBeenCalled()
    expect(host.querySelector('.plugin-player')).not.toBeNull()
  })

  test('mounts built-in embed iframe immediately without batching when no tracker sites are connected', async () => {
    const askSpy = vi.spyOn(evaluationPermissionBatch, 'ask')
    media = primeMedia
    params = { ...params, sourceUri: 'amazon:amzn1.dv.gti.98c' }

    const host = mountWatch()
    hosts.push(host)
    await act(async () => {})

    expect(evaluationPermissionBatch.isHeld()).toBe(false)
    expect(askSpy).not.toHaveBeenCalled()
    expect(host.querySelector('iframe[src*="/embed.html"]')).not.toBeNull()
  })
})
