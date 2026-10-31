// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { button, mount, unmount, withIntl } from '../../components/dom'

import type { Mock } from 'vite-plus/test'
import type { SiteStatus, StatusSite } from '../../../../src/tracking/site-status'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { useEffect } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { print } from 'graphql'
import { memoryLocation } from 'wouter/memory-location'

import { share } from '../../components/share'

const navigate = vi.fn()
// the episode, and what an address names of it, which leaves the added source's release out
const allUri = 'ag:(anilist:1-1,cr:GX1,nf:81,nyaa:a)'
const addressUri = 'ag:(anilist:1-1,cr:GX1,nf:81)'
let params: { mediaUri: string, episodeUri: string, sourceUri?: string } = { mediaUri: 'ag:(anilist:1)', episodeUri: addressUri }
// the address's query string, without its `?`
let search = ''
const handle = (uri: string, origin: string, url: string) => ({ relation: 'SAME_AS', node: { uri, origin, url } })
const allHandles = [
  handle('cr:GX1', 'cr', 'https://www.crunchyroll.com/watch/GX1'),
  handle('nf:81', 'nf', 'https://www.netflix.com/watch/81'),
  handle('nyaa:a', 'nyaa', 'magnet:?xt=urn:btih:a'),
]
const episode = { uri: allUri, handles: allHandles }
const single = { uri: params.mediaUri, handles: [], episodes: [episode], settled: true }
let media: object = single
// the other runs the page may ask for, by the uri it asks with, and every uri it asked for besides its own
let runs: Record<string, object> = {}
let asked: string[] = []
let watchQuery = ''
let origins: string[] | undefined
let party = { status: 'idle' }
let backend = 'cloud'
// what stub remembers of the viewer's sign-in to each site, and when it learned it: long ago unless `learned` says;
// a site signed out of in `before` was found signed in to here before
const SIGNED_IN = { crunchyroll: 'signed-in', prime: 'signed-in' }
let statuses: Record<string, string> = { ...SIGNED_IN }
let learned: Record<string, number> = {}
const before = new Set<string>()
let tracking: object | undefined
let storage: object | undefined
const saved: object[] = []
// a save answers once this settles, so a test can keep one in flight
let held: Promise<unknown> = Promise.resolve()
const stored = new Map<string, string>()

vi.mock('urql', async () => {
  const { useRef } = await import('preact/hooks')
  return {
    useSubscription: ({ query, variables, pause }: { query: Parameters<typeof print>[0], variables?: { input: { uri?: string, ids?: string[] } }, pause?: boolean }) => {
      // as urql does, the last answer stays while paused, or while a new uri has none yet
      const last = useRef<object>({})
      const printed = print(query)
      // named as the worker names it, `tracking:<uri>`
      if (printed.includes('subscription MediaTracking')) return [{ data: tracking && { tracking: { _id: `tracking:${variables!.input.uri}`, ...tracking } } }]
      if (printed.includes('subscription StubTrackerStorage')) return [{ data: !pause && storage ? { stubTrackerStorage: storage } : undefined }]
      const { uri, ids } = variables!.input
      if (uri === undefined) return [{ data: origins && { originPage: { nodes: origins.filter(id => ids?.includes(id)).map(id => ({ id, name: id })) } } }]
      if (uri === params.mediaUri) watchQuery = printed
      else if (!pause && !asked.includes(uri)) asked.push(uri)
      const answer = uri === params.mediaUri ? media : runs[uri]
      if (answer && !pause) last.current = { data: { media: answer }, operation: { variables } }
      return [last.current]
    },
    useMutation: () => [{}, async ({ input }: { input: { trackers: string[] } }) => {
      saved.push(input)
      await held
      return { data: { saveListEntry: input.trackers.map(tracker => ({ tracker, outcome: 'SAVED' })) } }
    }],
  }
})
vi.mock('wouter', async importOriginal => ({ ...await importOriginal(), useParams: () => params, useLocation: () => ['', navigate], useSearch: () => search }))
// the worker's answer to which origins play their own releases, held until `held` settles; and each added source's
// `account`, by origin, asked as the worker asks it, with every origin the page asked about, or with the worker
// unreachable while `down`
const lookups = vi.hoisted(() => ({ held: Promise.resolve() as Promise<unknown>, account: {} as Record<string, () => Promise<unknown>>, asked: [] as string[], down: false }))
vi.mock('../../../../src/worker', async () => {
  const { askAccount } = await import('../../../../src/worker/plugin-sources')
  return {
    remotePicker: async () => null,
    remotePlayer: async (id: string) => {
      await lookups.held
      return id === 'nyaa' || id === 'paid' ? { pluginUri: `plugin:${id}` } : null
    },
    remoteAccount: async (id: string) => {
      lookups.asked.push(id)
      if (lookups.down) throw new Error('the worker is unreachable')
      const account = lookups.account[id]
      return account ? askAccount(account) : undefined
    },
  }
})
// what the added sources said, in the page's memory, fresh for each test
const said = vi.hoisted(() => ({ reset: () => {} }))
vi.mock('../../../../src/plugin-accounts', async importOriginal => {
  const { createPluginAccounts } = await importOriginal<typeof import('../../../../src/plugin-accounts')>()
  let accounts = createPluginAccounts()
  said.reset = () => { accounts = createPluginAccounts() }
  return {
    createPluginAccounts,
    pluginAccounts: {
      record: (...args) => accounts.record(...args),
      free: (...args) => accounts.free(...args),
      neverSignedIn: (...args) => accounts.neverSignedIn(...args),
    } satisfies ReturnType<typeof createPluginAccounts>,
  }
})
// the added sources as src/plugins.ts reports them: Nyaa's package connected unless a test says otherwise;
// `browse` is FKN's package browser
const plugins = vi.hoisted(() => ({ statuses: [] as object[], listeners: new Set<() => void>(), browse: vi.fn(async () => {}) }))
vi.mock('../../../../src/plugins', () => ({
  addPlugins: plugins.browse,
  pluginStatuses: () => plugins.statuses,
  onPluginsChange: (listener: () => void) => {
    plugins.listeners.add(listener)
    return () => { plugins.listeners.delete(listener) }
  },
}))
vi.mock('../../../../src/party/use-party', () => ({ useParty: () => party, usePartyMessages: () => {} }))
// the backend is known once `held` settles; FKN's install card answers `installs`
// and `addable` says whether this browser can add the extension at all
const detecting = vi.hoisted(() => ({ held: Promise.resolve() as Promise<unknown>, installs: vi.fn(async () => true), addable: true }))
vi.mock('../../../../src/utils/fkn-backend', () => ({
  detectBackend: async () => { await detecting.held; return backend },
  addExtension: detecting.installs,
  canAddExtension: () => detecting.addable,
}))
vi.mock('../../../../src/tracking/site-status', () => ({
  siteStatuses: { read: (site: string) => statuses[site] && { state: statuses[site] } },
  recordTrackerAnswers: () => {},
}))
vi.mock('../../../../src/tracking/site-sessions', () => ({ trackerSignIns: {}, isSiteConnected: () => false }))
// what the sources' cards in Settings reach, over `statuses`, `learned` and `before` with stub's own rule for them:
// a streaming site's sign in answers `accounts.outcome` and, authed, remembers the site as signed in, and its sign
// out is the viewer's own; `record` is a state stub finds, as a player does
const accounts = vi.hoisted(() => ({ outcome: 'authed' }))
vi.mock('../../../../src/router/settings/wiring', async () => {
  const { createSiteStatuses } = await vi.importActual<typeof import('../../../../src/tracking/site-status')>('../../../../src/tracking/site-status')
  const remembered = createSiteStatuses(() => ({
    getItem: () => JSON.stringify(Object.fromEntries(Object.entries(statuses).map(([site, state]) =>
      [site, { state, checkedAt: learned[site] ?? 0, ...state === 'signed-out' && before.has(site) ? { signedInBefore: true } : {} }]))),
    setItem: (_key: string, value: string) => {
      for (const [site, { state, checkedAt, signedInBefore }] of Object.entries(JSON.parse(value) as Record<string, SiteStatus>)) {
        statuses[site] = state
        learned[site] = checkedAt
        if (signedInBefore) before.add(site)
        else if (state === 'signed-out') before.delete(site)
      }
    },
  }))
  const streaming = (site: StatusSite) => ({
    signIn: vi.fn(async () => {
      if (accounts.outcome === 'authed') remembered.record(site, 'signed-in')
      return accounts.outcome
    }),
    signOut: async () => remembered.recordSignOut(site),
  })
  return {
    crunchyroll: streaming('crunchyroll'),
    prime: streaming('prime'),
    sites: { isConnected: () => false, watch: () => () => {}, signIn: async () => 'closed', signOut: async () => {} },
    status: { read: remembered.read, watch: remembered.watch, refresh: () => {} },
    record: remembered.record,
  }
})
vi.mock('../../../../src/tracking/fkn-cloud-live', () => ({ unlockTracker: async () => false }))
type Report = { paused: boolean, ended?: boolean, time?: number, rate?: number }
// each player the page attaches, which a test makes report as a person or the browser would; with
// `greets`, a new listener hears the last report at once, after dispose too, as the real link does
const bridge = vi.hoisted(() => ({ links: [] as { report: (state: Report) => void, apply: Mock<(state: { time: number }) => void> }[], greets: false, duration: 1000 }))
vi.mock('../../../../src/party/bridge', () => ({
  attachPlaybackBridge: () => {
    const listeners = new Set<(state: object) => void>()
    let last = { paused: true, time: 0, rate: 1 }
    let ended = false
    const link = {
      apply: vi.fn<(state: { time: number }) => void>(),
      onReport: (listener: (state: object) => void) => {
        listeners.add(listener)
        if (bridge.greets) queueMicrotask(() => listener({ ...last, at: Date.now() }))
        return () => { listeners.delete(listener) }
      },
      ended: () => ended,
      duration: () => bridge.duration,
      dispose: () => listeners.clear(),
      report: ({ paused, ended: atEnd = false, time = 0, rate = 1 }: Report) => {
        ended = atEnd
        last = { paused, time, rate }
        for (const listener of listeners) listener({ paused, time, rate, at: Date.now() })
      },
    }
    bridge.links.push(link)
    return link
  },
}))
// the nyaa plugin's play(): it declines a release with no magnet, and hands over its player otherwise, whose link
// says the file's `chapters` and hands the keys on through the plugin (each player's `focus`); `stages` are where
// each was put. With `ending`, the plugin relays the player's skip offer: `asked` is what stub said, and `offered`
// the player's own word, which a test changes when the player would have
const pluginPlayers = vi.hoisted(() => ({ chapters: undefined as object[] | undefined, focus: [] as Mock[], stages: [] as unknown[], prepared: [] as object[], ending: undefined as { asked: boolean[], offered: boolean } | undefined }))
vi.mock('../../../../src/components/plugin-player', async () => {
  const { attachPlaybackBridge } = await import('../../../../src/party/bridge')
  return {
    default: ({ release, onUnplayable, onPlayback, stage }: { release: { url?: string }, onUnplayable: () => void, onPlayback: (link?: object) => void, stage?: { current: unknown } }) => {
      useEffect(() => {
        if (!release.url?.startsWith('magnet:')) return onUnplayable()
        pluginPlayers.stages.push(stage?.current)
        const focus = vi.fn()
        pluginPlayers.focus.push(focus)
        const { ending } = pluginPlayers
        const link = Object.assign(attachPlaybackBridge(document.createElement('iframe')), {
          chapters: () => pluginPlayers.chapters,
          focus,
          prepare: (next: object) => { pluginPlayers.prepared.push(next) },
          ...ending ? { offerEnding: (offered: boolean) => { ending.asked.push(offered) }, endingOffered: () => ending.offered } : {},
        })
        // after the effects of the render that put it up, as the real one hands it over once the plugin has played
        let gone = false
        queueMicrotask(() => { if (!gone) onPlayback(link) })
        return () => { gone = true; link.dispose(); onPlayback(undefined) }
      }, [release.url])
      return <div className="plugin-player" data-url={release.url}/>
    },
  }
})
vi.mock('../../../../src/components/party-playback', () => ({ default: () => null }))
// the relay: Crunchyroll's skip events by url, and the bucket's 403 for an episode with no file
const relay = vi.hoisted(() => ({ files: {} as Record<string, unknown>, asked: [] as string[] }))
vi.mock('../../../../src/utils/fetch', () => ({
  fetch: async (input: string) => {
    relay.asked.push(input)
    return input in relay.files ? Response.json(relay.files[input]) : new Response('', { status: 403 })
  },
}))
// Crunchyroll's length of each episode, read when a torrent plays, and the viewer's own browser, which answers aniskip
const lengths = vi.hoisted(() => ({ byUrl: {} as Record<string, number>, asked: [] as string[] }))
vi.mock('../../../../src/sources/crunchyroll/relay-check', () => ({
  unlistedRelays: async () => [],
  crunchyrollLength: async (url: string) => {
    lengths.asked.push(url)
    return lengths.byUrl[url]
  },
}))
const direct = vi.hoisted(() => ({ answers: {} as Record<string, unknown>, asked: [] as string[] }))
vi.mock('../../../../src/worker/browser-fetch', () => ({
  browserFetch: async (input: string) => {
    direct.asked.push(String(input))
    return String(input) in direct.answers ? Response.json(direct.answers[String(input)]) : new Response('', { status: 404 })
  },
}))
vi.mock('../../../../src/embed-tracks', () => ({ embedTracks: () => ({ dispose: () => {} }) }))
const relays = vi.hoisted(() => ({ remembered: {} as Record<string, string>, heard: [] as [HTMLIFrameElement, string][] }))
vi.mock('../../../../src/embed-relays', () => ({
  triedRelaysParams: () => relays.remembered,
  hearTriedRelays: (iframe: HTMLIFrameElement, sourceUri: string) => {
    relays.heard.push([iframe, sourceUri])
    return () => {}
  },
}))
const languages = vi.hoisted(() => ({ heard: [] as HTMLIFrameElement[] }))
vi.mock('../../../../src/embed-languages', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/embed-languages')>(),
  hearTrackLanguages: (iframe: HTMLIFrameElement) => {
    languages.heard.push(iframe)
    return () => {}
  },
}))
// the embed saying its source cannot play the episode here, heard by the frame it was said in
const unplayables = vi.hoisted(() => ({ listeners: new Map<HTMLIFrameElement, () => void>() }))
vi.mock('../../../../src/embed-unplayable', () => ({
  hearUnplayable: (iframe: HTMLIFrameElement, listener: () => void) => {
    unplayables.listeners.set(iframe, listener)
    return () => { unplayables.listeners.delete(iframe) }
  },
}))
// the embed's fullscreen, kept on the stage each frame is served on
const fullscreens = vi.hoisted(() => ({ served: [] as [HTMLIFrameElement, HTMLElement][], stopped: 0 }))
vi.mock('../../../../src/embed-fullscreen', () => ({
  serveEmbedFullscreen: (iframe: HTMLIFrameElement, stage: HTMLElement) => {
    fullscreens.served.push([iframe, stage])
    return () => { fullscreens.stopped++ }
  },
}))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => Object.fromEntries(
  ['Check', 'ChevronLeft', 'ChevronRight', 'ChevronsLeftRight', 'ChevronsRightLeft', 'Frown', 'LoaderCircle', 'Meh', 'Minus', 'Plus', 'Share2', 'Smile', 'Star'].map(name => [name, () => null])))
vi.stubGlobal('__STUB_EMBED_PAGE__', '/embed.html')
vi.stubGlobal('localStorage', {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value) },
  removeItem: (key: string) => { stored.delete(key) },
})

const { default: Watch } = await import('../../../../src/router/watch/index')
const wiring = await import('../../../../src/router/settings/wiring') as unknown as typeof import('../../../../src/router/settings/wiring') & { record: (site: string, state: string) => void }
const { default: MediaTracking } = await import('../../../../src/components/media-tracking')
const { PREPARE_AT, UP_NEXT_MS } = await import('../../../../src/router/watch/up-next')
const { skipEventsUrl } = await import('../../../../src/sources/crunchyroll/skip-events')
const { aniskipUrl } = await import('../../../../src/sources/aniskip')
const { AUTOPLAY_KEY } = await import('../../../../src/utils/autoplay')
const { ACCOUNT_WAIT_MS } = await import('../../../../src/worker/plugin-sources')
const { WATCH_POSITIONS_KEY } = await import('../../../../src/utils/watch-positions')
const { AUDIO_LANGUAGE_KEY, SUBTITLE_LANGUAGE_KEY, keepSubtitleLanguage } = await import('../../../../src/utils/track-languages')
const { ACCOUNT_SETTINGS_KEY } = await import('../../../../src/settings-store')
const { Router } = await import('wouter')
const page = () => mount(withIntl(<Router hook={memoryLocation().hook}><Watch/></Router>))

const NYAA_PACKAGE = 'https:stub.plugins.banou.dev'
const connectedNyaa = { uri: NYAA_PACKAGE, state: 'connected', sources: [{ origin: 'nyaa', name: 'Nyaa' }] }
beforeEach(() => { plugins.statuses = [connectedNyaa] })

// the Prime Video links below are Japan's, which play in stub for a viewer in Japan alone
beforeEach(() => { vi.stubEnv('TZ', 'Asia/Tokyo') })

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.unstubAllEnvs()
  vi.useRealTimers()
  navigate.mockClear()
  party = { status: 'idle' }
  backend = 'cloud'
  statuses = { ...SIGNED_IN }
  learned = {}
  before.clear()
  params = { mediaUri: 'ag:(anilist:1)', episodeUri: addressUri }
  search = ''
  Object.assign(episode, { uri: allUri, handles: allHandles })
  media = single
  runs = {}
  asked = []
  stored.clear()
  relays.remembered = {}
  relays.heard = []
  languages.heard = []
  bridge.links = []
  bridge.greets = false
  bridge.duration = 1000
  relay.files = {}
  relay.asked = []
  lengths.byUrl = {}
  lengths.asked = []
  direct.answers = {}
  direct.asked = []
  tracking = undefined
  storage = undefined
  saved.length = 0
  held = Promise.resolve()
  lookups.held = Promise.resolve()
  lookups.account = {}
  lookups.asked = []
  lookups.down = false
  said.reset()
  detecting.held = Promise.resolve()
  detecting.installs.mockClear()
  detecting.addable = true
  unplayables.listeners.clear()
  accounts.outcome = 'authed'
  plugins.browse.mockClear()
  vi.mocked(wiring.crunchyroll.signIn).mockClear()
  vi.mocked(wiring.prime.signIn).mockClear()
  fullscreens.served = []
  fullscreens.stopped = 0
  pluginPlayers.chapters = undefined
  pluginPlayers.focus = []
  pluginPlayers.stages = []
  pluginPlayers.prepared = []
  pluginPlayers.ending = undefined
})

const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
}

// signed out of the site now, as stub found the viewer signed in to it here before
const signedOutAgain = (site: string) => {
  statuses[site] = 'signed-out'
  before.add(site)
}

// the owner, 2026-10-26: "if we know that the user has previously logged into CR, then we should ask him to re-log
// into his account"
test('a Crunchyroll ranked first that the viewer signed in to here before opens at once, for its player to ask them to sign in again', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  lookups.held = new Promise(() => {})
  statuses = {}
  signedOutAgain('crunchyroll')
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

test('a member still joining a party does not pick, since it follows the host', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  party = { status: 'joining' }
  hosts.push(page())
  await settle()
  expect(navigate).not.toHaveBeenCalled()
})

// the page asks for the extension where Netflix needs it, so the backend does not decide the pick
test('Netflix ranked first opens at once, before the backend is known', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  detecting.held = new Promise(() => {})
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nf:81`, { replace: true })
})

// Frieren, 2026-10-12: the episode's Netflix match was this session's, so a reload into the address lost it
test('a linked Netflix source the episode has not matched is listed, active and played', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf']
  backend = 'extension'
  Object.assign(episode, { uri: 'ag:(anilist:1-1,cr:GX1)', handles: allHandles.filter(({ node }) => node.origin === 'cr') })
  params = { ...params, episodeUri: episode.uri, sourceUri: 'nf:81726716' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('a.source.active')?.getAttribute('title')).toBe('nf')
  expect(host.querySelector('iframe')?.getAttribute('src')).toContain(`url=${encodeURIComponent('https://www.netflix.com/watch/81726716')}`)
  expect(navigate).not.toHaveBeenCalled()
})

test('on the cloud, a Netflix episode named offers the extension and frames its player once it is added', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf']
  params = { ...params, sourceUri: 'nf:81' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('iframe')).toBeNull()
  detecting.installs.mockResolvedValueOnce(false)
  await act(async () => { button(host, 'Install the FKN extension to play Netflix')!.click() })
  await settle()
  expect(host.querySelector('iframe'), 'the card dismissed').toBeNull()
  await act(async () => { button(host, 'Install the FKN extension to play Netflix')!.click() })
  await settle()
  expect(detecting.installs).toHaveBeenCalledTimes(2)
  expect(new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('url')).toBe('https://www.netflix.com/watch/81')
  expect(button(host, 'Install the FKN extension to play Netflix')).toBeUndefined()
})

test('a linked source with no watch url of its own adds no row beside the episode\'s', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:WRONG' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('.source-group')).toBeNull()
  expect(host.querySelector('a.source')?.getAttribute('title')).toBe('cr')
})

test('a linked source the episode holds only as PART_OF is not played', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf']
  Object.assign(episode, { handles: [allHandles[0], { relation: 'PART_OF', node: { uri: 'nf:7', origin: 'nf', url: 'https://www.netflix.com/watch/7' } }] })
  params = { ...params, sourceUri: 'nf:7' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('.active')).toBeNull()
  expect(host.querySelector('iframe')).toBeNull()
})

test('a release the address names before the episode holds it plays once its handle arrives', async () => {
  vi.useFakeTimers()
  origins = ['nyaa']
  Object.assign(episode, { handles: [] })
  params = { ...params, sourceUri: 'nyaa:a' }
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()

  Object.assign(episode, { handles: [allHandles[2]] })
  act(() => { render(tree(), host) })
  await settle()
  expect(host.querySelector('.plugin-player')?.getAttribute('data-url')).toBe('magnet:?xt=urn:btih:a')
})

// an episode's own Prime Video handle, as JustWatch's episode offer mints it, with the deep link as its url
const PRIME = 'amazon:amzn1.dv.gti.fe903f64'
const PRIME_LINK = 'https://watch.amazon.co.jp/watch?gti=amzn1.dv.gti.fe903f64'
const primeEpisode = (...others: ReturnType<typeof handle>[]) =>
  Object.assign(episode, { uri: `ag:(anilist:1-1,${PRIME})`, handles: [handle(PRIME, 'amazon', PRIME_LINK), ...others] })

test('a Prime Video episode plays in stub\'s own player, framed with its deep link', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  primeEpisode()
  params = { ...params, episodeUri: episode.uri, sourceUri: PRIME }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('a.source.active')?.getAttribute('title')).toBe('amazon')
  const framed = new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test')
  expect(framed.pathname).toBe('/embed.html')
  expect(framed.searchParams.get('sourceUri')).toBe(PRIME)
  expect(framed.searchParams.get('url')).toBe(PRIME_LINK)
})

test('with no source named, a Prime Video episode is picked at once, on the cloud too', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  primeEpisode()
  params = { ...params, episodeUri: episode.uri }
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${PRIME}`, { replace: true })
})

test('a Prime Video ranked first gives way to the release for a viewer never signed in to it here, and opens for one signed in to it before', async () => {
  for (const [viewer, to] of [['nothing known', 'nyaa:a'], ['signed out', 'nyaa:a'], ['signed out since a sign in', PRIME]] as const) {
    vi.useFakeTimers()
    origins = ['amazon', 'nyaa']
    statuses = {}
    if (viewer === 'signed out') statuses.prime = 'signed-out'
    if (viewer === 'signed out since a sign in') signedOutAgain('prime')
    primeEpisode(allHandles[2]!)
    params = { ...params, episodeUri: episode.uri }
    hosts.push(page())
    await settle()
    expect(navigate, viewer).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${to}`, { replace: true })
    navigate.mockClear()
    while (hosts.length) unmount(hosts.pop()!)
  }
})

// HOR-1014, the owner, 2026-10-26: "if the user has zero playable sources because they're all premium, we should
// ask them to either log into one, or recommend installing stub plugins, and offer the browse packages button"
const noSource = (host: HTMLElement) => host.querySelector<HTMLElement>('.no-source')
const signInRows = (host: HTMLElement) => [...host.querySelectorAll('.no-source li')]
  .map(row => [row.getAttribute('data-source'), row.querySelector('.name')?.textContent, row.querySelector('button')?.textContent])
const toWatch = (sourceUri: string) => `/watch/${params.mediaUri}/${params.episodeUri}/${sourceUri}`
// Crunchyroll and Prime Video in Japan, the viewer signed in to neither as far as stub knows, and no source added:
// this harness answers on the first render, so a package connected at load reads as connected after that answer
const premiumEpisode = () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  statuses = {}
  plugins.statuses = []
  primeEpisode(allHandles[0]!)
  params = { ...params, episodeUri: episode.uri }
}

test('with every source on the episode still to sign in to, the player\'s place offers each one\'s sign in and Browse sources, and Play opens nothing', async () => {
  premiumEpisode()
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).not.toHaveBeenCalled()
  expect(noSource(host)?.querySelector('h2')?.textContent).toBe('No source you can play here yet')
  expect(signInRows(host), 'in the play order').toEqual([['cr', 'Crunchyroll', 'Sign in'], ['amazon', 'Prime Video', 'Sign in']])
  expect(button(noSource(host)!, 'Browse sources')).toBeTruthy()
  expect(host.querySelector('a.source'), 'the sources stay listed below').not.toBeNull()

  statuses = { crunchyroll: 'signed-in' }
  const signedIn = page()
  hosts.push(signedIn)
  await settle()
  expect(noSource(signedIn), 'the control: signed in to one').toBeNull()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
})

test('signing in there opens that source in place, though one still to sign in to ranks above it', async () => {
  premiumEpisode()
  const host = page()
  hosts.push(host)
  await settle()
  await act(async () => { button(host.querySelector('.no-source [data-source="amazon"]')!, 'Sign in')!.click() })
  await settle()
  expect(wiring.prime.signIn).toHaveBeenCalledOnce()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch(PRIME), { replace: true })
  expect(noSource(host)).toBeNull()
})

test('a sign in that did not happen keeps the page asking', async () => {
  premiumEpisode()
  accounts.outcome = 'closed'
  const host = page()
  hosts.push(host)
  await settle()
  await act(async () => { button(host.querySelector('.no-source [data-source="cr"]')!, 'Sign in')!.click() })
  await settle()
  expect(wiring.crunchyroll.signIn).toHaveBeenCalledOnce()
  expect(navigate).not.toHaveBeenCalled()
  expect(signInRows(host).map(([origin]) => origin)).toEqual(['cr', 'amazon'])
})

test('a sign in heard from a player or another tab opens the source', async () => {
  premiumEpisode()
  const host = page()
  hosts.push(host)
  await settle()
  expect(noSource(host)).not.toBeNull()
  await act(async () => { wiring.record('crunchyroll', 'signed-in') })
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
})

test('Browse sources opens FKN\'s package browser, the page keeps asking while the source connects, and opens the release it brings', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  statuses = {}
  plugins.statuses = []
  Object.assign(episode, { handles: [allHandles[0]] })
  const { host, rerender } = live()
  await settle()
  expect(signInRows(host).map(([origin]) => origin)).toEqual(['cr'])
  await act(async () => { button(host, 'Browse sources')!.click() })
  expect(plugins.browse).toHaveBeenCalledOnce()

  await pluginsChange({ uri: NYAA_PACKAGE, state: 'connecting' })
  expect(noSource(host), 'connecting').not.toBeNull()
  await pluginsChange(connectedNyaa)
  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
  media = { ...single }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('nyaa:a'), { replace: true })
})

test('with only sources turned off or opening elsewhere, the page offers Browse sources alone', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  statuses = {}
  plugins.statuses = []
  stored.set('stub.sources.disabled', JSON.stringify(['cr']))
  Object.assign(episode, { handles: [allHandles[0], handle('amazon:us', 'amazon', 'https://watch.amazon.com/watch?gti=us')] })
  const host = page()
  hosts.push(host)
  await settle()
  expect(noSource(host)).not.toBeNull()
  expect(signInRows(host)).toEqual([])
  expect(button(noSource(host)!, 'Browse sources')).toBeTruthy()
})

test('a source the play order names whose package is gone does not hold the page', async () => {
  premiumEpisode()
  stored.set('stub.sources.play-order', JSON.stringify(['nyaa', 'cr', 'amazon', 'nf']))
  const host = page()
  hosts.push(host)
  await settle()
  expect(signInRows(host).map(([origin]) => origin)).toEqual(['cr', 'amazon'])
})

test('an episode that lists no source is not asked about', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  Object.assign(episode, { handles: [] })
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('a.source')).toBeNull()
  expect(noSource(host)).toBeNull()
})

test('nothing is asked before every source has answered, and Play waits on a favourite still to sign in to until another plays', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  statuses = {}
  signedOutAgain('crunchyroll')
  Object.assign(episode, { handles: [allHandles[0]] })
  media = { ...single, settled: false }
  const { host, rerender } = live()
  await settle()
  expect(noSource(host)).toBeNull()
  expect(navigate).not.toHaveBeenCalled()

  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
  await rerender()
  expect(navigate, 'the favourite, for its player to ask').toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
})

// the answer on screen when a package connects was reached before the worker asked its source
test('an added source that connects after the answer on screen holds the page until the worker answers again', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  statuses = {}
  plugins.statuses = [{ uri: NYAA_PACKAGE, state: 'connecting' }]
  Object.assign(episode, { handles: [allHandles[0]] })
  const { host, rerender } = live()
  await settle()
  expect(noSource(host), 'connecting').toBeNull()
  await pluginsChange(connectedNyaa)
  expect(noSource(host), 'connected, the answer on screen from before').toBeNull()

  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
  media = { ...single }
  await rerender()
  expect(navigate, 'the release, as the viewer never signed in to Crunchyroll here').toHaveBeenCalledExactlyOnceWith(toWatch('nyaa:a'), { replace: true })
  expect(noSource(host)).toBeNull()
})

test('an added source that answers with nothing for the episode leaves the page asking', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  statuses = {}
  plugins.statuses = []
  Object.assign(episode, { handles: [allHandles[0]] })
  const { host, rerender } = live()
  await settle()
  await pluginsChange(connectedNyaa)
  media = { ...single }
  await rerender()
  expect(signInRows(host).map(([origin]) => origin)).toEqual(['cr'])
  expect(navigate).not.toHaveBeenCalled()
})

test('a source the address names keeps its own player, one still to sign in to too', async () => {
  premiumEpisode()
  params = { ...params, sourceUri: 'cr:GX1' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(noSource(host)).toBeNull()
  expect(new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('sourceUri')).toBe('cr:GX1')
})

// with the extension the session is the browser's own, which stub learns of only from the player
test('with the extension, a site stub knows nothing of is opened at once, for its player to ask', async () => {
  premiumEpisode()
  backend = 'extension'
  const host = page()
  hosts.push(host)
  await settle()
  expect(noSource(host)).toBeNull()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
})

test('before the backend is known, a site still to sign in to is neither opened nor asked for', async () => {
  premiumEpisode()
  let known = () => {}
  detecting.held = new Promise<void>(resolve => { known = resolve })
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).not.toHaveBeenCalled()
  expect(noSource(host)).toBeNull()

  known()
  await settle()
  expect(signInRows(host).map(([origin]) => origin)).toEqual(['cr', 'amazon'])
})

// Netflix needs the extension on the cloud, which iOS Safari or Chrome on Android cannot add
test('where the browser cannot add the extension, Netflix plays nothing, so the page asks for the sign in still to do', async () => {
  for (const order of [['cr', 'amazon', 'nf'], ['nf', 'cr', 'amazon']]) {
    vi.useFakeTimers()
    origins = ['cr', 'nf']
    statuses = {}
    plugins.statuses = []
    stored.set('stub.sources.play-order', JSON.stringify(order))
    Object.assign(episode, { handles: [allHandles[0], allHandles[1]] })
    detecting.addable = false
    const host = page()
    hosts.push(host)
    await settle()
    expect(navigate, order.join()).not.toHaveBeenCalled()
    expect(signInRows(host).map(([origin]) => origin), order.join()).toEqual(['cr'])

    detecting.addable = true
    const addable = page()
    hosts.push(addable)
    await settle()
    expect(noSource(addable), `the control: a browser that can add it, ${order.join()}`).toBeNull()
    expect(navigate, order.join()).toHaveBeenCalledOnce()
    navigate.mockClear()
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('a party guest, who follows the host, is never asked', async () => {
  premiumEpisode()
  party = { status: 'active', role: 'guest' } as typeof party
  const host = page()
  hosts.push(host)
  await settle()
  expect(noSource(host)).toBeNull()
})

// another country's Prime Video, which a Japanese account does not play
test('a watch.amazon.com link stays a link out to Amazon, and is never picked', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  const us = 'https://watch.amazon.com/watch?gti=amzn1.dv.gti.us000001'
  Object.assign(episode, { uri: 'ag:(anilist:1-1,amazon:amzn1.dv.gti.us000001)', handles: [handle('amazon:amzn1.dv.gti.us000001', 'amazon', us)] })
  params = { ...params, episodeUri: episode.uri }
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).not.toHaveBeenCalled()
  const link = host.querySelector('a.source')!
  expect(link.getAttribute('href')).toBe(us)
  expect(link.getAttribute('target')).toBe('_blank')
})

// a Prime Video site picks its region from the connection, which on the cloud is a relay in Prague or Hong Kong
const CANADA = 'amazon:amzn1.dv.gti.ca000001'
const CANADA_LINK = 'https://app.primevideo.com/watch?gti=amzn1.dv.gti.ca000001'
const canadianEpisode = () => {
  vi.stubEnv('TZ', 'America/Toronto')
  Object.assign(episode, { uri: `ag:(anilist:1-1,${CANADA})`, handles: [handle(CANADA, 'amazon', CANADA_LINK)] })
  params = { ...params, episodeUri: episode.uri }
}

test('outside Japan on the cloud, Play opens Prime Video, which offers the extension and frames its player once it is added', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  canadianEpisode()
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${CANADA}`, { replace: true })
  expect(host.querySelector('a.source')!.getAttribute('href'), 'its link still goes out to Prime Video').toBe(CANADA_LINK)
  expect(host.querySelector('a.source')!.getAttribute('target')).toBe('_blank')
  expect(button(host, 'Install the FKN extension to play Prime Video'), 'nothing named yet').toBeUndefined()

  params = { ...params, sourceUri: CANADA }
  const named = page()
  hosts.push(named)
  await settle()
  expect(named.querySelector('iframe')).toBeNull()
  detecting.installs.mockResolvedValueOnce(false)
  await act(async () => { button(named, 'Install the FKN extension to play Prime Video')!.click() })
  await settle()
  expect(named.querySelector('iframe'), 'the card dismissed').toBeNull()
  await act(async () => { button(named, 'Install the FKN extension to play Prime Video')!.click() })
  await settle()
  expect(detecting.installs).toHaveBeenCalledTimes(2)
  expect(new URL(named.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('url')).toBe(CANADA_LINK)
  expect(button(named, 'Install the FKN extension to play Prime Video')).toBeUndefined()
})

test('outside Japan, Prime Video with the extension is picked at once and framed', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  backend = 'extension'
  canadianEpisode()
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${CANADA}`, { replace: true })
  expect(host.querySelector('a.source')!.getAttribute('target')).toBeNull()

  params = { ...params, sourceUri: CANADA }
  const named = page()
  hosts.push(named)
  await settle()
  expect(new URL(named.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('url')).toBe(CANADA_LINK)
})

test('the relays a show was unavailable through reach its next episode\'s player, and never reload the one playing', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  const src = () => host.querySelector('iframe')?.getAttribute('src')
  expect(src()).not.toContain('triedRelays')
  expect(relays.heard.at(-1)).toEqual([host.querySelector('iframe'), 'cr:GX1'])

  // the embed moved away from a relay, then the episode's handles update while it plays
  relays.remembered = { triedRelays: 'r1' }
  Object.assign(episode, { handles: [...allHandles] })
  act(() => { render(tree(), host) })
  await settle()
  expect(src()).not.toContain('triedRelays')

  const next = handle('cr:GX2', 'cr', 'https://www.crunchyroll.com/watch/GX2')
  Object.assign(episode, { handles: [next, ...allHandles] })
  params = { ...params, sourceUri: 'cr:GX2' }
  act(() => { render(tree(), host) })
  await settle()
  expect(src()).toContain('triedRelays=r1')
  expect(relays.heard.at(-1)).toEqual([host.querySelector('iframe'), 'cr:GX2'])
})

test('the languages last picked, the account\'s when signed in, reach the next episode\'s player, and never reload the one playing', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  stored.set(ACCOUNT_SETTINGS_KEY, JSON.stringify({ [AUDIO_LANGUAGE_KEY]: 'Japanese' }))
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  const framed = () => new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams
  expect(framed().get(AUDIO_LANGUAGE_KEY)).toBe('Japanese')
  expect(framed().has(SUBTITLE_LANGUAGE_KEY)).toBe(false)
  expect(languages.heard.at(-1)).toBe(host.querySelector('iframe'))

  // the viewer turns the subtitles off in the player, then the episode's handles update while it plays
  keepSubtitleLanguage(null)
  Object.assign(episode, { handles: [...allHandles] })
  act(() => { render(tree(), host) })
  await settle()
  expect(framed().has(SUBTITLE_LANGUAGE_KEY)).toBe(false)

  const next = handle('cr:GX2', 'cr', 'https://www.crunchyroll.com/watch/GX2')
  Object.assign(episode, { handles: [next, ...allHandles] })
  params = { ...params, sourceUri: 'cr:GX2' }
  act(() => { render(tree(), host) })
  await settle()
  expect(framed().get(SUBTITLE_LANGUAGE_KEY)).toBe('off')
  expect(framed().get(AUDIO_LANGUAGE_KEY)).toBe('Japanese')
  expect(languages.heard.at(-1)).toBe(host.querySelector('iframe'))
})

const row = (n: number, ...handles: ReturnType<typeof handle>[]) =>
  ({ uri: `ag:(anilist:1-${n})`, episodeNumber: n, titles: [{ title: `Title ${n}` }], handles })
const crunchyroll = (n: number) => handle(`cr:GX${n}`, 'cr', `https://www.crunchyroll.com/watch/GX${n}`)
const release = (id: string) => handle(`nyaa:${id}`, 'nyaa', `magnet:?xt=urn:btih:${id}`)
// three episodes, the address on the second; the third as given. The answer names the media by more
// sources than the address does, as it does once sources join.
const SERIES = 'ag:(anilist:1,tvdb:1)'
const series = (third: object = {}, sourceUri = 'nyaa:a') => {
  media = {
    uri: SERIES,
    handles: [],
    episodes: [row(1, crunchyroll(1)), row(2, crunchyroll(2), release('a')), { ...row(3, crunchyroll(3), release('b')), ...third }],
  }
  params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri }
}
const watchPath = (n: number, sourceUri?: string) => `/watch/${params.mediaUri}/ag:(anilist:1-${n})${sourceUri ? `/${sourceUri}` : ''}`
const episodeLinks = (host: HTMLElement) =>
  [...host.querySelectorAll('.episode-row a.episode-step')].map(link => [link.querySelector('.step-label')?.textContent, link.getAttribute('href'), link.getAttribute('title')])

test('the episodes either side are linked, the next on the release playing now, the previous where the Play pick decides', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series()
  const host = page()
  hosts.push(host)
  await settle()
  expect(episodeLinks(host)).toEqual([
    ['Previous episode', watchPath(1), 'E1 - Title 1'],
    ['Next episode', watchPath(3, 'nyaa:b'), 'E3 - Title 3'],
  ])
})

// HOR-1011: big buttons at the row's two ends, each saying which episode it opens
test('each episode button names the episode it opens under its label, and sits at its own end of the row', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series()
  const host = page()
  hosts.push(host)
  await settle()
  const steps = [...host.querySelectorAll('.episode-row > a')]
  expect(steps.map(step => [step.className, step.querySelector('.step-label')?.textContent, step.querySelector('.step-target')?.textContent])).toEqual([
    ['episode-step previous', 'Previous episode', 'E1 - Title 1'],
    ['episode-step next', 'Next episode', 'E3 - Title 3'],
  ])

  // the first episode has nothing before it, so Next stands alone at its end
  params = { ...params, episodeUri: 'ag:(anilist:1-1)', sourceUri: 'cr:GX1' }
  const first = page()
  hosts.push(first)
  await settle()
  expect([...first.querySelectorAll('.episode-row > a')].map(step => step.className)).toEqual(['episode-step next'])
})

// HOR-1022: a way back to the show other than the browser's Back
test('the show\'s name under the episode\'s title opens the show\'s page', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series()
  media = { ...media, titles: [{ title: 'Frieren' }] }
  const host = page()
  hosts.push(host)
  await settle()
  const show = host.querySelector('.episode-info > a.media-title')
  expect([show?.textContent, show?.getAttribute('href')]).toEqual(['Frieren', `/title/${params.mediaUri}`])
})

test('Share, beside the episode\'s title, copies a short link to this episode on the release playing, with the sources the address names', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  params = { ...params, sourceUri: 'nyaa:a' }
  const host = page()
  hosts.push(host)
  await settle()
  const { link, opens } = await share(host.querySelector('.episode-info > button.share'), 'https://anime.fkn.app/watch/ag:(anilist:1)/x/y?plugins=https:stub.plugins.banou.dev&t=12')
  expect(link).toMatch(/^https:\/\/anime\.fkn\.app\/s\//)
  expect(opens).toBe(`https://anime.fkn.app/watch/ag:(anilist:1)/${addressUri}/nyaa:a?plugins=https:stub.plugins.banou.dev`)
})

test('an episode not out yet is not linked as the next one', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series({ releaseDate: '2099-01-01' })
  const host = page()
  hosts.push(host)
  await settle()
  expect(episodeLinks(host).map(([label]) => label)).toEqual(['Previous episode'])
})

// only the clock is faked, so nothing but its tick draws the page again
test('the next episode is linked on the clock\'s next tick once it has aired', async () => {
  vi.useFakeTimers({ now: Date.parse('2026-10-16T13:59:50Z'), toFake: ['Date', 'setInterval', 'clearInterval'] })
  origins = ['cr', 'nyaa']
  series()
  media = { ...media, nextAiringEpisode: { episodeNumber: 3, airingAt: '2026-10-16T14:00:00Z' } }
  const host = page()
  hosts.push(host)
  await settle()
  expect(episodeLinks(host).map(([label]) => label), 'the control: the third is not out yet').toEqual(['Previous episode'])

  act(() => { vi.advanceTimersByTime(30_000) })
  const drawnNow = page()
  hosts.push(drawnNow)
  expect(episodeLinks(drawnNow).map(([label]) => label), 'the control: a page drawn now links it').toEqual(['Previous episode', 'Next episode'])
  expect(episodeLinks(host).at(-1)).toEqual(['Next episode', watchPath(3, 'nyaa:b'), 'E3 - Title 3'])
})

test('a film\'s one episode links nothing', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('.episode-step')).toBeNull()
})

// HOR-1011: each source's card shows its own picture, else the episode's, and what its own row says of
// its stream; the release playing speaks for a source with several
test('a source\'s card shows its own row\'s picture and stream, the episode\'s picture without one, and the playing release\'s', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  const crunchyroll = handle('cr:GX1', 'cr', 'https://www.crunchyroll.com/watch/GX1')
  Object.assign(crunchyroll.node, {
    thumbnails: [{ url: 'https://img.example/cr.jpg' }],
    audioLanguages: ['ja-JP', 'en-US'],
    subtitleLanguages: ['en-US', 'es-419'],
  })
  const releases = ['a', 'b'].map(id => handle(`nyaa:${id}`, 'nyaa', `magnet:?xt=urn:btih:${id}`))
  Object.assign(releases[1]!.node, { videoQualities: ['1080p', 'HEVC'] })
  media = { ...single, episodes: [{ ...episode, thumbnails: [{ url: 'https://img.example/episode.jpg' }], handles: [crunchyroll, allHandles[1]!, ...releases] }] }
  params = { ...params, sourceUri: 'nyaa:b' }
  const host = page()
  hosts.push(host)
  await settle()

  const card = (title: string) => host.querySelector(`.watch-info [title="${title}"]`)!
  const picture = (title: string) => card(title).querySelector('img.thumbnail')?.getAttribute('src')
  expect(picture('cr')).toBe('https://img.example/cr.jpg')
  expect(card('cr').querySelector('.languages')?.textContent).toBe('AudioJapanese, English')
  expect(picture('nf'), 'Netflix has none of its own').toBe('https://img.example/episode.jpg')
  expect(card('nf').querySelector('.qualities, .languages')).toBeNull()
  expect([...card('2 releases on nyaa').querySelectorAll('.qualities > *')].map(chip => chip.textContent)).toEqual(['1080p', 'HEVC'])
  expect(watchQuery, 'what each card reads off its own row').toMatch(/shortDescription\s*\}\s*thumbnails \{\s*url\s*\}\s*videoQualities\s*audioQualities\s*audioLanguages\s*subtitleLanguages/)
})

test('the watch query asks what decides whether an episode is out', async () => {
  vi.useFakeTimers()
  hosts.push(page())
  await settle()
  expect(watchQuery).toMatch(/episodes \{[^}]*releaseDate/)
  expect(watchQuery).toMatch(/handles \{\s*relation\s*node \{[^}]*releaseDate/)
  expect(watchQuery).toMatch(/\bstatus\b/)
  expect(watchQuery).toMatch(/nextAiringEpisode \{\s*episodeNumber\s*airingAt\s*\}/)
})

// HOR-1058: any episode of the run, from the watch page
const listRows = (host: HTMLElement) => [...host.querySelectorAll('[data-episodes] .episode')].map(episode => {
  const link = episode.querySelector('a.episode-link')
  return [Number(episode.querySelector('.number')!.textContent), link?.getAttribute('href'), link?.getAttribute('aria-current') ?? undefined]
})

test('the run\'s episodes are listed under the sources, the one playing marked, each on the site playing and the address\'s media', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series()
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('[data-episodes] h2')?.textContent).toBe('Episodes')
  expect(listRows(host)).toEqual([
    [1, watchPath(1), undefined],
    [2, watchPath(2, 'nyaa:a'), 'page'],
    [3, watchPath(3, 'nyaa:b'), undefined],
  ])
  expect(host.querySelector('.watch-info.sources + .watch-info [data-episodes]'), 'right after the sources').not.toBeNull()
})

test('a film lists no episodes', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  const control = page()
  hosts.push(control)
  await settle()
  expect(control.querySelector('[data-episodes]'), 'the control: a series of one').not.toBeNull()
  media = { ...single, type: 'MOVIE' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('[data-episodes]')).toBeNull()
})

test('the watch query asks what the episode list reads', async () => {
  vi.useFakeTimers()
  hosts.push(page())
  await settle()
  expect(watchQuery).toMatch(/airingSchedule \{\s*episodeNumber\s*airingAt\s*\}/)
  expect(watchQuery, 'the episode\'s own, not its releases\'').toMatch(/shortDescriptions \{\s*language\s*shortDescription\s*\}\s*thumbnails \{\s*url\s*\}\s*handles/)
})

describe('a show\'s other seasons', () => {
  const SEASON_2 = 'ag:(tmdb:9-s2)'
  const seasonRow = (n: number) => ({ uri: `ag:(tmdb:9-s2e${n})`, episodeNumber: n, titles: [{ title: `Second ${n}` }], handles: [release(`s2e${n}`)] })
  const seasons = [{ number: 1, uri: 'tmdb:9-s1' }, { number: 2, uri: 'tmdb:9-s2' }]
  beforeEach(() => {
    series()
    media = { ...media, seasons, handles: [{ relation: 'SAME_AS', node: { uri: 'tmdb:9-s1' } }] }
    runs[SEASON_2] = { uri: 'ag:(tmdb:9-s2,tvmaze:1-s2)', seasons, handles: [{ relation: 'SAME_AS', node: { uri: 'tmdb:9-s2' } }], episodes: [seasonRow(1), seasonRow(2)] }
  })
  const seasonButtons = (host: HTMLElement) => [...host.querySelectorAll('[data-seasons] button')].map(season => [season.textContent, season.getAttribute('aria-pressed')])

  test('are each a button that lists its season in place, on the site playing, while the episode plays on', async () => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    const host = page()
    hosts.push(host)
    await settle()
    expect(seasonButtons(host)).toEqual([['Season 1', 'true'], ['Season 2', 'false']])
    expect(asked, 'the control: the second season is not asked for yet').toEqual([])

    act(() => { button(host, 'Season 2')!.click() })
    await settle()
    expect(seasonButtons(host)).toEqual([['Season 1', 'false'], ['Season 2', 'true']])
    expect(listRows(host)).toEqual([
      [1, `/watch/${SEASON_2}/ag:(tmdb:9-s2e1)/nyaa:s2e1`, undefined],
      [2, `/watch/${SEASON_2}/ag:(tmdb:9-s2e2)/nyaa:s2e2`, undefined],
    ])
    expect(navigate).not.toHaveBeenCalled()
    expect(host.querySelector('.plugin-player')?.getAttribute('data-url'), 'still playing').toBe('magnet:?xt=urn:btih:a')

    act(() => { button(host, 'Season 1')!.click() })
    await settle()
    expect(listRows(host).map(([number, , current]) => [number, current])).toEqual([[1, undefined], [2, 'page'], [3, undefined]])
  })

  test('the season picked, once one of its episodes plays, lists it marked', async () => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    const location = memoryLocation()
    const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
    const host = mount(tree())
    hosts.push(host)
    await settle()
    act(() => { button(host, 'Season 2')!.click() })
    await settle()

    media = runs[SEASON_2]!
    params = { mediaUri: SEASON_2, episodeUri: 'ag:(tmdb:9-s2e2)', sourceUri: 'nyaa:s2e2' }
    act(() => { render(tree(), host) })
    await settle()
    expect(seasonButtons(host)).toEqual([['Season 1', 'false'], ['Season 2', 'true']])
    expect(listRows(host).map(([number, , current]) => [number, current])).toEqual([[1, undefined], [2, 'page']])
  })

  test('the season picked gives way to the playing one once another episode plays', async () => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    const first = { media, params }
    const location = memoryLocation()
    const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
    const host = mount(tree())
    hosts.push(host)
    await settle()
    const marked = () => listRows(host).map(([number, , current]) => [number, current])
    const play = async (next: { media: object, params: typeof params }) => {
      media = next.media
      params = next.params
      act(() => { render(tree(), host) })
      await settle()
    }

    act(() => { button(host, 'Season 2')!.click() })
    await settle()
    await play({ media: first.media, params: { ...first.params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:b' } })
    expect(seasonButtons(host), 'Next in the same run').toEqual([['Season 1', 'true'], ['Season 2', 'false']])
    expect(marked()).toEqual([[1, undefined], [2, undefined], [3, 'page']])

    act(() => { button(host, 'Season 2')!.click() })
    await settle()
    expect(seasonButtons(host), 'the control: picked again').toEqual([['Season 1', 'false'], ['Season 2', 'true']])
    await play({ media: runs[SEASON_2]!, params: { mediaUri: SEASON_2, episodeUri: 'ag:(tmdb:9-s2e1)', sourceUri: 'nyaa:s2e1' } })
    await play(first)
    expect(seasonButtons(host), 'back into the first season').toEqual([['Season 1', 'true'], ['Season 2', 'false']])
    expect(marked()).toEqual([[1, undefined], [2, 'page'], [3, undefined]])
  })

  test('another season picked opens on its first page', async () => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    const three = [...seasons, { number: 3, uri: 'tmdb:9-s3' }]
    const run = (season: number) => ({
      uri: `ag:(tmdb:9-s${season})`,
      seasons: three,
      handles: [{ relation: 'SAME_AS', node: { uri: `tmdb:9-s${season}` } }],
      episodes: Array.from({ length: 14 }, (_, at) => ({ uri: `ag:(tmdb:9-s${season}e${at + 1})`, episodeNumber: at + 1, handles: [release(`s${season}e${at + 1}`)] })),
    })
    media = { ...media, seasons: three }
    runs = { [SEASON_2]: run(2), 'ag:(tmdb:9-s3)': run(3) }
    const host = page()
    hosts.push(host)
    await settle()
    const numbers = () => listRows(host).map(([number]) => number)

    act(() => { button(host, 'Season 2')!.click() })
    await settle()
    act(() => { host.querySelector<HTMLElement>('[data-episodes] button[aria-label="Page 2"]')!.click() })
    await settle()
    expect(numbers(), 'the control: the second page').toEqual([13, 14])
    act(() => { button(host, 'Season 3')!.click() })
    await settle()
    expect(listRows(host)[0]?.[1]).toBe('/watch/ag:(tmdb:9-s3)/ag:(tmdb:9-s3e1)/nyaa:s3e1')
    expect(numbers()).toEqual(Array.from({ length: 12 }, (_, at) => at + 1))
  })
})

test('the row playing links the release playing, not the site\'s first', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series({}, 'nyaa:z')
  ;(media as { episodes: ReturnType<typeof row>[] }).episodes[1]!.handles.push(release('z'))
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('.plugin-player')?.getAttribute('data-url'), 'the control: the second release plays').toBe('magnet:?xt=urn:btih:z')
  expect(listRows(host)).toEqual([
    [1, watchPath(1), undefined],
    [2, watchPath(2, 'nyaa:z'), 'page'],
    [3, watchPath(3, 'nyaa:b'), undefined],
  ])
})

describe('an address names an episode with few of its rows', () => {
  const twoReleases = () => {
    series()
    ;(media as { episodes: ReturnType<typeof row>[] }).episodes.forEach((each, at) => { each.uri = `ag:(anilist:1-${at + 1},nyaa:e${at},nyaa:f${at})` })
    ;(media as { episodes: ReturnType<typeof row>[] }).episodes[1]!.handles.push(release('e1'), release('f1'))
    params = { ...params, sourceUri: 'nyaa:f1' }
  }
  const open = async (episodeUri: string) => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    params = { ...params, episodeUri }
    const host = page()
    hosts.push(host)
    await settle()
    return host
  }
  const opened = (host: HTMLElement) => [host.querySelector('.episode-title')?.textContent, host.querySelector('.plugin-player')?.getAttribute('data-url')]
  const SECOND = ['E2 - Title 2', 'magnet:?xt=urn:btih:f1']

  test('a link with every id, as already shared, opens its episode and release, and Share hands out the short one', async () => {
    twoReleases()
    const host = await open('ag:(anilist:1-2,nyaa:e1,nyaa:f1)')
    expect(opened(host)).toEqual(SECOND)
    const { opens } = await share(host.querySelector('.episode-info > button.share'), 'https://anime.fkn.app/watch/x/y/z')
    expect(opens).toBe(`https://anime.fkn.app/watch/${params.mediaUri}/ag:(anilist:1-2)/nyaa:f1`)
  })

  test('the short one finds an episode holding more ids, on a reload or a Back alike', async () => {
    twoReleases()
    expect(opened(await open('ag:(anilist:1-2)'))).toEqual(SECOND)
  })

  test('one naming none of the rows listed now finds the episode of the release it plays', async () => {
    twoReleases()
    expect(opened(await open('ag:(nyaa:gone)'))).toEqual(SECOND)
  })

  test('the ids it names go before the release it plays, which another episode\'s address may name', async () => {
    twoReleases()
    const host = await open('ag:(anilist:1-3)')
    expect(host.querySelector('.episode-title')?.textContent).toBe('E3 - Title 3')
  })

  test('the releases listed keep the episode part, and the one picked plays', async () => {
    twoReleases()
    const host = await open('ag:(anilist:1-2,nyaa:e1,nyaa:f1)')
    const group = host.querySelector<HTMLElement>('button.source[title="3 releases on nyaa"]')!
    expect(group.getAttribute('aria-expanded'), 'open on the release playing').toBe('true')
    const links = [...host.querySelectorAll('a.release')].map(link => link.getAttribute('href'))
    expect(links).toEqual(['a', 'e1', 'f1'].map(id => watchPath(2, `nyaa:${id}`)))
    params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri: 'nyaa:e1' }
    unmount(hosts.pop()!)
    hosts.push(page())
    await settle()
    expect(hosts.at(-1)!.querySelector('.plugin-player')?.getAttribute('data-url')).toBe('magnet:?xt=urn:btih:e1')
  })

  test('where the viewer stopped is kept by release, so the short address resumes a point saved on the long one', async () => {
    twoReleases()
    stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nyaa:f1', 600, 1000]]))
    await open('ag:(anilist:1-2)')
    await report({ paused: false, time: 2 })
    expect(bridge.links.at(-1)!.apply.mock.calls.map(([state]) => state.time)).toEqual([600])
  })
})

// Chromium 1228, 2026-10-15: a frame that loads another address in place adds a step to the tab's
// history, so after Next one Back moved only the player back, and the page still named the next episode
// A source package keeps its frame for its next releases instead, putting each in a frame of its own: WebKit lets its
// document hand the keys on only once the viewer has clicked in it (WebKit 26.4 and 27.2, 2026-10-26)
test('another episode gets a fresh player, so Back leaves the page rather than the frame, and a torrent the same package', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  for (const [origin, player] of [['cr', 'iframe'], ['nyaa', '.plugin-player']] as const) {
    series({}, origin === 'cr' ? 'cr:GX2' : 'nyaa:a')
    const location = memoryLocation()
    const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
    const host = mount(tree())
    hosts.push(host)
    await settle()
    const before = host.querySelector(player)
    expect(before, origin).not.toBeNull()
    params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: origin === 'cr' ? 'cr:GX3' : 'nyaa:b' }
    act(() => { render(tree(), host) })
    await settle()
    expect(host.querySelector(player), origin).not.toBeNull()
    if (origin === 'cr') expect(host.querySelector(player), origin).not.toBe(before)
    else {
      expect(host.querySelector(player), origin).toBe(before)
      expect(before?.getAttribute('data-url'), 'playing the next release').toBe('magnet:?xt=urn:btih:b')
    }
  }
})

// the episode playing on Crunchyroll, whose next one Crunchyroll has too, or on the source named
const atTheEnd = async (third: object = {}, sourceUri = 'cr:GX2') => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series(third, sourceUri)
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  return {
    host,
    rerender: () => act(() => { render(tree(), host) }),
    // outside act, effects run when a browser would run them, not before render() returns
    rerenderLive: async () => {
      render(tree(), host)
      await vi.advanceTimersByTimeAsync(500)
      await settle()
    },
  }
}
const report = async (...states: Report[]) => {
  await act(async () => { for (const state of states) bridge.links.at(-1)!.report(state) })
}
const played = { paused: false }
const ended = { paused: true, ended: true }
const wait = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

test('at the end, the next episode opens on the same site once the countdown is out, and only once', async () => {
  const { host } = await atTheEnd()
  await report(played, ended)
  expect(host.querySelector('.up-next.counting')?.getAttribute('title')).toBe('E3 - Title 3')
  await wait(UP_NEXT_MS - 1)
  expect(navigate).not.toHaveBeenCalled()
  await wait(1)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
  await report(ended)
  await wait(UP_NEXT_MS * 2)
  expect(navigate).toHaveBeenCalledTimes(1)
})

test('a scrub to the end while paused, once the episode played, counts down too', async () => {
  const { host } = await atTheEnd()
  await report(played, { paused: true }, ended)
  expect(host.querySelector('.up-next')).not.toBeNull()
})

test('a source joining the next episode during the countdown keeps it, and it opens the new address', async () => {
  const { rerender } = await atTheEnd()
  await report(played, ended)
  const grown = 'ag:(anilist:1-3,nf:83)'
  Object.assign((media as { episodes: object[] }).episodes[2]!, { uri: grown })
  rerender()
  await wait(UP_NEXT_MS)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${grown}/cr:GX3`)
})

test('another source picked during the countdown withdraws it', async () => {
  const { host, rerender } = await atTheEnd()
  await report(played, ended)
  params = { ...params, sourceUri: 'nyaa:a' }
  rerender()
  await wait(UP_NEXT_MS * 2)
  expect(host.querySelector('.up-next')).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})

test('Next episode opens it at once', async () => {
  const { host } = await atTheEnd()
  await report(played, ended)
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
})

test('Cancel, a seek back or leaving the page keeps the viewer where they are', async () => {
  const { host: cancelled } = await atTheEnd()
  await report(played, ended)
  await act(() => { cancelled.querySelector<HTMLButtonElement>('.up-next-cancel')!.click() })
  expect(cancelled.querySelector('.up-next')).toBeNull()
  // the player telling its end again is not a new end
  await report(ended)
  await wait(UP_NEXT_MS)
  expect(navigate, 'Cancel').not.toHaveBeenCalled()

  await report(played, ended, { paused: true })
  await wait(UP_NEXT_MS)
  expect(navigate, 'a seek back').not.toHaveBeenCalled()

  await report(played, ended)
  act(() => { unmount(hosts.pop()!) })
  await wait(UP_NEXT_MS)
  expect(navigate, 'leaving').not.toHaveBeenCalled()
})

test('an end heard with no play before it, as a new ear is told, moves nothing', async () => {
  await atTheEnd()
  await report(ended)
  await wait(UP_NEXT_MS)
  expect(navigate).not.toHaveBeenCalled()
})

test('a viewer last seen signed out who plays Crunchyroll anyway is still counted down to its next episode', async () => {
  const { host } = await atTheEnd({ handles: [crunchyroll(3)] })
  await report(played, ended)
  expect(host.querySelector('.up-next')).not.toBeNull()
  await wait(UP_NEXT_MS)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
})

test('nothing starts when the next episode is not out', async () => {
  await atTheEnd({ releaseDate: '2099-01-01' })
  await report(played, ended)
  await wait(UP_NEXT_MS)
  expect(navigate).not.toHaveBeenCalled()
})

// HOR-1014: autoplay must not stall silently, so the next episode's page asks for a sign in or a source
test('a next episode with nothing that plays is counted down to all the same, with no source named', async () => {
  const { host } = await atTheEnd({ handles: [handle('amazon:us', 'amazon', 'https://watch.amazon.com/watch?gti=us')] })
  await report(played, ended)
  expect(host.querySelector('.up-next.counting')).not.toBeNull()
  await wait(UP_NEXT_MS)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3))
})

test('a next episode out that lists no source is not counted down to', async () => {
  const { host } = await atTheEnd({ handles: [] })
  await report(played, ended)
  expect(host.querySelector('.up-next.counting')).toBeNull()
  await wait(UP_NEXT_MS)
  expect(navigate).not.toHaveBeenCalled()
})

test('with autoplay turned off, the end offers Next episode and never counts down', async () => {
  stored.set(AUTOPLAY_KEY, 'off')
  const { host } = await atTheEnd()
  await report(played, ended)
  expect(host.querySelector('.up-next')?.getAttribute('title')).toBe('E3 - Title 3')
  expect(host.querySelector('.up-next-cancel'), 'nothing to cancel').toBeNull()
  expect(host.querySelector('.up-next.counting'), 'and no countdown fill').toBeNull()
  await wait(UP_NEXT_MS * 2)
  expect(navigate).not.toHaveBeenCalled()
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
})

test('a party guest\'s player does not move on, the host takes the party along', async () => {
  party = { status: 'active', role: 'guest' } as typeof party
  const { host } = await atTheEnd()
  await report(played, ended)
  await wait(UP_NEXT_MS)
  expect(host.querySelector('.up-next')).toBeNull()
  expect(navigate).not.toHaveBeenCalled()
})

test('a player fullscreened in its frame is let out of fullscreen, so the countdown shows', async () => {
  const { host } = await atTheEnd()
  const exitFullscreen = vi.fn(async () => {})
  Object.assign(document, { fullscreenElement: host.querySelector('iframe'), exitFullscreen })
  try {
    await report(played)
    expect(exitFullscreen).not.toHaveBeenCalled()
    await report(ended)
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  } finally {
    Object.assign(document, { fullscreenElement: null, exitFullscreen: undefined })
  }
})

// HOR-1014: Next episode when the ending appears. The second episode on Crunchyroll, 1420 s long with
// its credits marked from 1325 to 1415 s (Solo Leveling e3's shape), reported playing at 1300 s.
const atTheCredits = async () => {
  relay.files[skipEventsUrl('GX2')] = { credits: { start: 1325, end: 1415 } }
  bridge.duration = 1420
  const page = await atTheEnd()
  await report({ paused: false, time: 1300 })
  return page
}
const nextShown = (host: HTMLElement) => host.querySelector('.up-next')?.getAttribute('title')

test('Next episode shows a second before the credits and counts down only at the end', async () => {
  const { host } = await atTheCredits()
  expect(relay.asked).toEqual([skipEventsUrl('GX2')])
  await wait(23_900)
  expect(nextShown(host), 'at 1323.9 s').toBeUndefined()
  await wait(100)
  expect(nextShown(host), 'at 1324 s').toBe('E3 - Title 3')
  expect(host.querySelector('.up-next.counting, .up-next-cancel'), 'no countdown').toBeNull()
  // the next heartbeat, past the moment
  await report({ paused: false, time: 1325 })
  expect(nextShown(host)).toBe('E3 - Title 3')
  expect(host.querySelector('.up-next.counting, .up-next-cancel'), 'still none').toBeNull()
  await wait(UP_NEXT_MS * 4)
  expect(navigate).not.toHaveBeenCalled()

  await report({ ...ended, time: 1420 })
  expect(host.querySelector('.up-next.counting')).not.toBeNull()
  await wait(UP_NEXT_MS)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
})

// a Netflix address has the same /watch/<id> shape as Crunchyroll's
test('only a Crunchyroll episode asks for skip events', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf']
  backend = 'extension'
  for (const [sourceUri, asked] of [['nf:81', []], ['cr:GX1', [skipEventsUrl('GX1')]]] as const) {
    params = { ...params, sourceUri }
    relay.asked = []
    const host = page()
    hosts.push(host)
    await settle()
    expect(host.querySelector('iframe')?.getAttribute('src'), 'it plays').toContain(`sourceUri=${encodeURIComponent(sourceUri)}`)
    expect(relay.asked, sourceUri).toEqual(asked)
    unmount(hosts.pop()!)
  }
})

test('the early Next episode opens it at once', async () => {
  const { host } = await atTheCredits()
  await wait(30_000)
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
})

test('the moment is timed from each report, at its rate', async () => {
  const { host } = await atTheCredits()
  await report({ paused: false, time: 1310, rate: 2 })
  await wait(6_900)
  expect(nextShown(host)).toBeUndefined()
  await wait(100)
  expect(nextShown(host)).toBe('E3 - Title 3')
})

test('a seek back or a pause before the moment holds Next episode back', async () => {
  const { host } = await atTheCredits()
  await wait(10_000)
  await report({ paused: false, time: 1000 })
  await wait(20_000)
  expect(nextShown(host), 'a seek back').toBeUndefined()
  await report({ paused: false, time: 1320 })
  await wait(1_000)
  await report({ paused: true, time: 1321 })
  await wait(10_000)
  expect(nextShown(host), 'a pause').toBeUndefined()
  await report({ paused: false, time: 1321 })
  await wait(3_000)
  expect(nextShown(host), 'played on to it').toBe('E3 - Title 3')
})

test('a seek back before the moment withdraws Next episode, until playback reaches it again', async () => {
  const { host } = await atTheCredits()
  await wait(30_000)
  expect(nextShown(host)).toBe('E3 - Title 3')
  await report({ paused: false, time: 1200 })
  expect(nextShown(host)).toBeUndefined()
  await wait(123_900)
  expect(nextShown(host)).toBeUndefined()
  await wait(100)
  expect(nextShown(host)).toBe('E3 - Title 3')
})

test('another source picked before the moment brings no Next episode at the old one\'s moment', async () => {
  const { host, rerender } = await atTheCredits()
  params = { ...params, sourceUri: 'nyaa:a' }
  rerender()
  await settle()
  expect(host.querySelector('.plugin-player'), 'the other source plays').not.toBeNull()
  await wait(30_000)
  expect(nextShown(host)).toBeUndefined()
})

// no report comes on `waiting`, so a stall shows only as a heartbeat behind where the timer had the player
test('a heartbeat reporting a stall short of the moment keeps Next episode', async () => {
  const { host } = await atTheCredits()
  await report({ paused: false, time: 1320 })
  await wait(4_000)
  expect(nextShown(host)).toBe('E3 - Title 3')
  await report({ paused: false, time: 1320 })
  expect(nextShown(host), 'held where it was').toBe('E3 - Title 3')
  await report({ paused: false, time: 1322 })
  expect(nextShown(host)).toBe('E3 - Title 3')
})

// a seek back shorter than the time since the last heartbeat lands after that heartbeat, as a stall does
test('a short seek back then a pause before the moment withdraws Next episode', async () => {
  const { host } = await atTheCredits()
  await report({ paused: false, time: 1320 })
  await wait(4_500)
  expect(nextShown(host)).toBe('E3 - Title 3')
  await report({ paused: false, time: 1321 })
  expect(nextShown(host), 'the seek alone').toBe('E3 - Title 3')
  await report({ paused: true, time: 1321 })
  await wait(60_000)
  expect(nextShown(host), 'paused').toBeUndefined()
  await report({ paused: false, time: 1321 })
  await wait(3_000)
  expect(nextShown(host), 'played on to it').toBe('E3 - Title 3')
  await report({ paused: true, time: 1325 })
  expect(nextShown(host), 'a pause past it').toBe('E3 - Title 3')
})

test('a party guest is never offered Next episode early, the host takes the party along', async () => {
  for (const member of [{ status: 'idle' }, { status: 'active', role: 'guest' }]) {
    party = member as typeof party
    const { host } = await atTheCredits()
    await wait(30_000)
    expect(Boolean(host.querySelector('.up-next')), member.status).toBe(member.status === 'idle')
    unmount(hosts.pop()!)
  }
})

test('in fullscreen the early Next episode leaves the player fullscreen, and the end lets it out as before', async () => {
  const { host } = await atTheCredits()
  const exitFullscreen = vi.fn(async () => {})
  Object.assign(document, { fullscreenElement: host.querySelector('iframe'), exitFullscreen })
  try {
    await wait(30_000)
    expect(nextShown(host)).toBe('E3 - Title 3')
    await report({ paused: false, time: 1330 })
    expect(exitFullscreen).not.toHaveBeenCalled()
    await report({ ...ended, time: 1420 })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
  } finally {
    Object.assign(document, { fullscreenElement: null, exitFullscreen: undefined })
  }
})

// HOR-1014: the stage, the box the player sits in, is what goes fullscreen, so the fullscreen outlasts each player in it
const toTheNext = async (rerender: () => void) => {
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
  rerender()
  await settle()
}
const inFullscreen = async (element: Element | null, run: (exitFullscreen: Mock<() => Promise<void>>) => Promise<void>, exit = async () => {}) => {
  const exitFullscreen = vi.fn(exit)
  Object.assign(document, { fullscreenElement: element, exitFullscreen })
  try {
    await run(exitFullscreen)
  } finally {
    Object.assign(document, { fullscreenElement: null, exitFullscreen: undefined })
  }
}

test('the stage is the same element across a next-episode navigation, through a render with no player in it', async () => {
  const { host, rerender } = await atTheEnd({ handles: [] })
  const stage = host.querySelector('.stage')
  expect(stage?.querySelector('iframe'), 'the player is on the stage').not.toBeNull()
  await toTheNext(rerender)
  expect(host.querySelector('iframe'), 'the next episode holds no source yet').toBeNull()
  expect(host.querySelector('.stage')).toBe(stage)
  Object.assign((media as { episodes: object[] }).episodes[2]!, { handles: [crunchyroll(3)] })
  rerender()
  await settle()
  expect(stage?.querySelector('iframe')?.getAttribute('src')).toContain('GX3')
  expect(host.querySelector('.stage')).toBe(stage)
})

test('each episode\'s frame has its fullscreen kept on the one stage', async () => {
  const { host, rerender } = await atTheEnd()
  const stage = host.querySelector('.stage')!
  const first = host.querySelector('iframe')!
  expect(fullscreens.served).toEqual([[first, stage]])
  await toTheNext(rerender)
  const next = host.querySelector('iframe')!
  expect(next).not.toBe(first)
  expect(fullscreens.served).toEqual([[first, stage], [next, stage]])
  expect(fullscreens.stopped, 'the first frame\'s, as it went').toBe(1)
})

test('in the stage\'s fullscreen the end counts down there, and Next opens the next episode without leaving it', async () => {
  const { host } = await atTheEnd()
  await inFullscreen(host.querySelector('.stage'), async exitFullscreen => {
    await report(played, ended)
    expect(host.querySelector('.stage .up-next.counting')).not.toBeNull()
    await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
    expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
})

// Chromium 156, Firefox 157, WebKit 27.2, 2026-10-26: a frame fullscreened above the stage takes the stage out of
// fullscreen when it is removed, and leaves it fullscreen once it has left first (Chromium and WebKit)
test('Next lets a player fullscreened above the stage out before its frame goes', async () => {
  const { host } = await atTheCredits()
  let leave = () => {}
  await inFullscreen(host.querySelector('iframe'), async exitFullscreen => {
    await wait(30_000)
    await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
    expect(exitFullscreen).toHaveBeenCalledTimes(1)
    expect(navigate, 'not while it is still out').not.toHaveBeenCalled()
    await act(async () => { leave() })
    expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'cr:GX3'))
  }, () => new Promise<void>(resolve => { leave = resolve }))
})

test('a party guest\'s stage stays fullscreen as its page follows the host to the next episode', async () => {
  party = { status: 'active', role: 'guest' } as typeof party
  const { host, rerender } = await atTheEnd()
  const stage = host.querySelector('.stage')
  expect(stage).not.toBeNull()
  await inFullscreen(stage, async exitFullscreen => {
    await report(played, ended)
    await toTheNext(rerender)
    expect(stage?.querySelector('iframe')?.getAttribute('src')).toContain('GX3')
    expect(host.querySelector('.stage')).toBe(stage)
    expect(exitFullscreen).not.toHaveBeenCalled()
  })
})

test('the next episode\'s frame takes the keys once it loads; the page\'s first frame, and keys left on a control of the page, stay where they are', async () => {
  const { host, rerender } = await atTheEnd()
  const first = host.querySelector('iframe')!
  const firstFocus = vi.spyOn(first, 'focus')
  first.dispatchEvent(new Event('load'))
  expect(firstFocus, 'the page\'s first frame').not.toHaveBeenCalled()

  await toTheNext(rerender)
  const next = host.querySelector('iframe')!
  const nextFocus = vi.spyOn(next, 'focus')
  next.dispatchEvent(new Event('load'))
  expect(nextFocus).toHaveBeenCalledTimes(1)

  const control = host.querySelector('.episode-step')!
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => control })
  try {
    params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri: 'cr:GX2' }
    rerender()
    await settle()
    const back = host.querySelector('iframe')!
    const backFocus = vi.spyOn(back, 'focus')
    back.dispatchEvent(new Event('load'))
    expect(backFocus, 'keys on the page\'s own link').not.toHaveBeenCalled()
  } finally {
    Reflect.deleteProperty(document, 'activeElement')
  }
})

test('Cancel gives the keys back to the player', async () => {
  const { host } = await atTheEnd()
  await report(played, ended)
  const focus = vi.spyOn(host.querySelector('iframe')!, 'focus')
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next-cancel')!.click() })
  expect(focus).toHaveBeenCalledTimes(1)
})

// HOR-1014: a torrent plays two frames down, ripple's player inside the plugin's frame
test('a torrent\'s own ending brings Next episode a second before what follows it', async () => {
  pluginPlayers.chapters = [{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1370, title: 'ED' }, { start: 1370, end: 1395, title: 'Part B' }]
  bridge.duration = 1395
  const { host } = await atTheEnd({}, 'nyaa:a')
  expect(host.querySelector('.plugin-player'), 'the plugin plays it').not.toBeNull()
  await report({ paused: false, time: 1360 })
  await wait(8_900)
  expect(nextShown(host), 'at 1368.9 s').toBeUndefined()
  await wait(100)
  expect(nextShown(host), 'at 1369 s').toBe('E3 - Title 3')
  expect(host.querySelector('.up-next.counting, .up-next-cancel'), 'no countdown').toBeNull()
})

// ripple's player offers Skip Ending from a second before it, in Next's corner, 10 px away, so Next takes it only once
// the player has said Skip Ending is gone
const ENDS_THE_FILE = [{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1390, title: 'ED' }]
const relayedEnding = async (chapters = ENDS_THE_FILE) => {
  pluginPlayers.chapters = chapters
  pluginPlayers.ending = { asked: [], offered: true }
  bridge.duration = 1395
  return { ...await atTheEnd({}, 'nyaa:a'), ending: pluginPlayers.ending }
}

test('a torrent\'s own ending with nothing after it has Next episode take Skip Ending\'s corner a second before it', async () => {
  const { host, ending } = await relayedEnding()
  await report({ paused: false, time: 1200 })
  expect(ending.asked, 'as soon as it knows').toEqual([false])
  ending.offered = false
  await report({ paused: false, time: 1290 })
  await wait(8_900)
  expect(nextShown(host), 'at 1298.9 s').toBeUndefined()
  await wait(100)
  expect(nextShown(host), 'at 1299 s').toBe('E3 - Title 3')
  expect(host.querySelector('.up-next.counting, .up-next-cancel'), 'no countdown').toBeNull()
})

test('Next episode waits for the player to say Skip Ending is gone, however late that comes', async () => {
  const { host, ending } = await relayedEnding()
  await report({ paused: false, time: 1290 })
  await wait(9_000)
  expect(nextShown(host), 'at 1299 s, with the player\'s word still on its way').toBeUndefined()
  await report({ paused: false, time: 1305 })
  expect(nextShown(host), 'at 1305 s').toBeUndefined()
  ending.offered = false
  await report({ paused: false, time: 1306 })
  expect(nextShown(host), 'on its word').toBe('E3 - Title 3')
})

test('a player that never says, too old for the plugin\'s call, keeps its Skip Ending and Next episode comes at the end', async () => {
  const { host } = await relayedEnding()
  await report({ paused: false, time: 1290 })
  await wait(104_000)
  expect(nextShown(host), 'at 1394 s').toBeUndefined()
  await report({ ...ended, time: 1395 })
  expect(nextShown(host), 'at the end').toBe('E3 - Title 3')
})

test('a plugin with no such call leaves the player its Skip Ending, and Next episode comes at the end', async () => {
  pluginPlayers.chapters = ENDS_THE_FILE
  bridge.duration = 1395
  const { host } = await atTheEnd({}, 'nyaa:a')
  await report({ paused: false, time: 1290 })
  await wait(9_000)
  expect(nextShown(host), 'at 1299 s').toBeUndefined()
  await wait(95_000)
  expect(nextShown(host), 'at 1394 s').toBeUndefined()
  await report({ ...ended, time: 1395 })
  expect(nextShown(host), 'at the end').toBe('E3 - Title 3')
})

test('an ending with something after it stays the player\'s to offer', async () => {
  pluginPlayers.chapters = [{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1370, title: 'ED' }, { start: 1370, end: 1395, title: 'Part B' }]
  pluginPlayers.ending = { asked: [], offered: true }
  bridge.duration = 1395
  await atTheEnd({}, 'nyaa:a')
  await report({ paused: false, time: 1290 })
  expect(pluginPlayers.ending.asked).not.toContain(false)
})

test('an ending that turns out to have something after it goes back to the player', async () => {
  const { ending } = await relayedEnding()
  await report({ paused: false, time: 1200 })
  ending.offered = false
  ending.asked.length = 0
  pluginPlayers.chapters = [{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1370, title: 'ED' }, { start: 1370, end: 1395, title: 'Part B' }]
  await report({ paused: false, time: 1210 })
  expect(ending.asked).toEqual([true])
})

// the ending left beside the closing one ends 115 s before the end, which alone would read as what closes the episode
const TWO_ENDINGS = [{ start: 0, end: 1200, title: 'Part A' }, { start: 1200, end: 1280, title: 'ED' }, { start: 1280, end: 1300, title: 'Part B' }, { start: 1300, end: 1390, title: 'ED' }]

test('opened past an ending with the closing one still to come, Next episode waits for that one', async () => {
  const { host, ending } = await relayedEnding(TWO_ENDINGS)
  await report({ paused: false, time: 1285 })
  expect(nextShown(host), 'before the player has said').toBeUndefined()
  ending.offered = false
  await report({ paused: false, time: 1286 })
  expect(nextShown(host), 'once it has').toBeUndefined()
  await wait(12_900)
  expect(nextShown(host), 'at 1298.9 s').toBeUndefined()
  await wait(100)
  expect(nextShown(host), 'at 1299 s').toBe('E3 - Title 3')
})

test('a plugin with no such call brings no Next episode at an ending the closing one comes after', async () => {
  pluginPlayers.chapters = TWO_ENDINGS
  bridge.duration = 1395
  const { host } = await atTheEnd({}, 'nyaa:a')
  await report({ paused: false, time: 1285 })
  expect(nextShown(host), 'at 1285 s').toBeUndefined()
  await report({ ...ended, time: 1395 })
  expect(nextShown(host), 'at the end').toBe('E3 - Title 3')
})

test('with no next episode the player keeps its Skip Ending, and one left out for a Next that goes comes back', async () => {
  party = { status: 'active', role: 'guest' } as typeof party
  const guest = await relayedEnding()
  await report({ paused: false, time: 1290 })
  expect(guest.ending.asked, 'a guest follows the host, and offers no Next').not.toContain(false)
  unmount(guest.host)

  party = { status: 'idle' }
  const { rerender, ending } = await relayedEnding()
  await report({ paused: false, time: 1290 })
  expect(ending.asked).toEqual([false])
  ending.offered = false
  party = { status: 'active', role: 'guest' } as typeof party
  await rerender()
  expect(ending.asked).toEqual([false, true])
})

test('the next file in the same player is asked again', async () => {
  const { rerender, ending } = await relayedEnding()
  await report({ paused: false, time: 1290 })
  ending.offered = false
  // the third in the same release as the second, and a fourth for it to have a Next
  const { episodes } = media as { episodes: object[] }
  Object.assign(episodes[2]!, { handles: [release('a')] })
  episodes.push(row(4, crunchyroll(4), release('c')))
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:a' }
  await rerender()
  await settle()
  expect(bridge.links, 'the same player').toHaveLength(1)
  ending.asked.length = 0
  ending.offered = true
  await report({ paused: false, time: 0 })
  expect(ending.asked).toEqual([false])
})

// HOR-1014 step 5: a torrent whose file marks no ending takes Crunchyroll's credits when its length is Crunchyroll's,
// else aniskip's ending. The second episode as a torrent of 1395 s whose file's chapters are `chapters`, on a show
// MyAnimeList knows as 5, its third episode as given.
const torrentOf = async (chapters: object[] | undefined, third: object = {}) => {
  pluginPlayers.chapters = chapters
  bridge.duration = 1395
  const page = await atTheEnd(third, 'nyaa:a')
  Object.assign(media, { uri: 'ag:(anilist:1,mal:5,tvdb:1)' })
  await page.rerender()
  return page
}
const PARTS = [{ start: 0, end: 700, title: 'Part A' }, { start: 700, end: 1395, title: 'Part B' }]
const CREDITS = { credits: { start: 1300, end: 1390 } }
const crunchyrollUrl = (n: number) => `https://www.crunchyroll.com/watch/GX${n}`

test('a torrent whose chapters mark no ending takes Crunchyroll\'s credits when its length is Crunchyroll\'s', async () => {
  lengths.byUrl[crunchyrollUrl(2)] = 1394.95
  relay.files[skipEventsUrl('GX2')] = CREDITS
  const { host } = await torrentOf(PARTS)
  await report({ paused: false, time: 1290 })
  await settle()
  expect(lengths.asked).toEqual([crunchyrollUrl(2)])
  expect(relay.asked).toEqual([skipEventsUrl('GX2')])
  expect(direct.asked, 'aniskip is not asked once Crunchyroll has the credits').toEqual([])
  // the next report, a heartbeat
  await report({ paused: false, time: 1291 })
  await wait(7_900)
  expect(nextShown(host), 'at 1298.9 s').toBeUndefined()
  await wait(100)
  expect(nextShown(host), 'at 1299 s').toBe('E3 - Title 3')
})

test('a torrent whose own chapters mark its ending asks neither Crunchyroll nor aniskip', async () => {
  lengths.byUrl[crunchyrollUrl(2)] = 1394.95
  relay.files[skipEventsUrl('GX2')] = { credits: { start: 1320, end: 1390 } }
  const { host } = await torrentOf([{ start: 0, end: 1300, title: 'Part A' }, { start: 1300, end: 1390, title: 'ED' }])
  await report({ paused: false, time: 1290 })
  await settle()
  await report({ paused: false, time: 1291 })
  await wait(30_000)
  expect(nextShown(host), 'nor from Crunchyroll\'s credits').toBeUndefined()
  expect([lengths.asked, relay.asked, direct.asked]).toEqual([[], [], []])
})

test('with no Crunchyroll handle, Crunchyroll is asked nothing and aniskip\'s ending, asked from the browser, brings Next episode', async () => {
  direct.answers[aniskipUrl('5', 2, 1395)] = { found: true, results: [{ interval: { startTime: 1300, endTime: 1390 }, skipType: 'ed', episodeLength: 1395.02 }] }
  const { host, rerender } = await torrentOf(undefined)
  Object.assign((media as { episodes: object[] }).episodes[1]!, { handles: [release('a')] })
  await rerender()
  await report({ paused: false, time: 1290 })
  await settle()
  expect(direct.asked).toEqual([aniskipUrl('5', 2, 1395)])
  expect([lengths.asked, relay.asked]).toEqual([[], []])
  await report({ paused: false, time: 1291 })
  await wait(8_000)
  expect(nextShown(host)).toBe('E3 - Title 3')
})

test('a torrent asks for an ending only once it plays, and once', async () => {
  lengths.byUrl[crunchyrollUrl(2)] = 1394.95
  await torrentOf(PARTS)
  await report({ paused: true, time: 0 })
  await settle()
  expect([lengths.asked, direct.asked], 'paused').toEqual([[], []])
  await report({ paused: false, time: 0 })
  await settle()
  await report({ paused: false, time: 5 }, { paused: true, time: 6 }, { paused: false, time: 6 })
  await settle()
  expect(lengths.asked).toEqual([crunchyrollUrl(2)])
  expect(direct.asked, 'aniskip, as Crunchyroll\'s events have no ending').toEqual([aniskipUrl('5', 2, 1395)])
})

test('a torrent with no next episode to offer asks for no ending', async () => {
  lengths.byUrl[crunchyrollUrl(2)] = 1394.95
  await torrentOf(PARTS, { releaseDate: '2099-01-01' })
  await report({ paused: false, time: 1290 })
  await settle()
  expect([lengths.asked, relay.asked, direct.asked]).toEqual([[], [], []])
})

test('a Crunchyroll embed asks neither Crunchyroll\'s length nor aniskip', async () => {
  lengths.byUrl[crunchyrollUrl(2)] = 1394.95
  bridge.duration = 1395
  const { host, rerender } = await atTheEnd()
  Object.assign(media, { uri: 'ag:(anilist:1,mal:5,tvdb:1)' })
  await rerender()
  await report({ paused: false, time: 1290 })
  await settle()
  expect(host.querySelector('iframe')?.getAttribute('src'), 'it plays').toContain(`sourceUri=${encodeURIComponent('cr:GX2')}`)
  expect([lengths.asked, direct.asked]).toEqual([[], []])
})

test('a torrent\'s player is asked once, at PREPARE_AT of the episode, to prepare the release Next opens', async () => {
  bridge.duration = 1000
  await atTheEnd({}, 'nyaa:a')
  await report({ paused: false, time: 1000 * PREPARE_AT - 1 })
  expect(pluginPlayers.prepared).toEqual([])
  await report({ paused: false, time: 1000 * PREPARE_AT })
  expect(pluginPlayers.prepared).toEqual([{ uri: 'nyaa:b', url: 'magnet:?xt=urn:btih:b' }])
  await report({ paused: false, time: 900 }, played, ended)
  expect(pluginPlayers.prepared).toHaveLength(1)
})

test('Next and the episode list open the next file of the torrent playing, which is what is prepared, over the episode\'s first release', async () => {
  bridge.duration = 1000
  const pack = handle('nyaa:a-3', 'nyaa', 'magnet:?xt=urn:btih:a')
  const { host } = await atTheEnd({ handles: [crunchyroll(3), release('b'), pack] }, 'nyaa:a')
  expect(episodeLinks(host).at(-1)?.[1]).toBe(watchPath(3, 'nyaa:a-3'))
  expect(listRows(host).at(-1)?.[1]).toBe(watchPath(3, 'nyaa:a-3'))
  await report({ paused: false, time: 900 })
  expect(pluginPlayers.prepared).toEqual([{ uri: 'nyaa:a-3', url: 'magnet:?xt=urn:btih:a' }])
})

test('a player that plays on into the next episode brings nothing of the last one\'s countdown with it', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  // one release holding episodes 2 and 3, so its player and link outlive the episode
  media = { uri: SERIES, handles: [], episodes: [row(1, crunchyroll(1)), row(2, release('a')), row(3, release('a')), row(4, release('c'))] }
  params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri: 'nyaa:a' }
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  await report(played, ended)
  expect(host.querySelector('.up-next.counting')?.getAttribute('title')).toBe('E3 - Title 3')
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next')!.click() })
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watchPath(3, 'nyaa:a'))
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:a' }
  act(() => { render(tree(), host) })
  await settle()
  expect(bridge.links, 'the same player').toHaveLength(1)
  expect(host.querySelector('.up-next')).toBeNull()
  await wait(UP_NEXT_MS * 2)
  expect(navigate).toHaveBeenCalledTimes(1)
})

test('a torrent\'s player is put on the stage, which keeps its fullscreen', async () => {
  const { host } = await atTheEnd({}, 'nyaa:a')
  expect(pluginPlayers.stages).toEqual([host.querySelector('.stage')])
})

// once it first reports, since Chrome 155 can take a focus given while its frame loads back out of the plugin's document
test('the next torrent\'s player takes the keys through the plugin once it reports; the page\'s first, and keys on a control of the page by then, stay where they are', async () => {
  const { host, rerender } = await atTheEnd({}, 'nyaa:a')
  await report(played)
  expect(pluginPlayers.focus[0], 'the page\'s first player').not.toHaveBeenCalled()
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:b' }
  rerender()
  await settle()
  expect(pluginPlayers.focus).toHaveLength(2)
  expect(pluginPlayers.focus[1], 'not before it reports').not.toHaveBeenCalled()
  await report(played)
  expect(pluginPlayers.focus[1]).toHaveBeenCalledTimes(1)
  await report(played)
  expect(pluginPlayers.focus[1], 'at its first report only').toHaveBeenCalledTimes(1)

  params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri: 'nyaa:a' }
  rerender()
  await settle()
  const control = host.querySelector('.episode-step')!
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => control })
  try {
    await report(played)
    expect(pluginPlayers.focus).toHaveLength(3)
    expect(pluginPlayers.focus[2], 'keys on the page\'s own link').not.toHaveBeenCalled()
  } finally {
    Reflect.deleteProperty(document, 'activeElement')
  }
})

// the package's frame stays for the next release, so keys left in it are still on the page's player
test('keys left on the torrent\'s player go on to the next one', async () => {
  const { host, rerender } = await atTheEnd({}, 'nyaa:a')
  const frame = host.querySelector('.stage .plugin-player')!
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => frame })
  try {
    params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:b' }
    rerender()
    await settle()
    await report(played)
    expect(pluginPlayers.focus).toHaveLength(2)
    expect(pluginPlayers.focus[1]).toHaveBeenCalledTimes(1)
  } finally {
    Reflect.deleteProperty(document, 'activeElement')
  }
})

test('a torrent after a Crunchyroll episode takes the keys as well', async () => {
  const { rerender } = await atTheEnd()
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'nyaa:b' }
  rerender()
  await settle()
  await report(played)
  expect(pluginPlayers.focus).toHaveLength(1)
  expect(pluginPlayers.focus[0]).toHaveBeenCalledTimes(1)
})

test('Cancel hands the keys back to a torrent\'s player through the plugin', async () => {
  const { host } = await atTheEnd({}, 'nyaa:a')
  await report(played, ended)
  await act(() => { host.querySelector<HTMLButtonElement>('.up-next-cancel')!.click() })
  expect(pluginPlayers.focus[0]).toHaveBeenCalledTimes(1)
})

test('with no player in it yet, the stage holds the episode\'s picture and title, and with one, the player', async () => {
  const { host, rerender } = await atTheEnd({ handles: [], thumbnails: [{ url: 'https://img.example/e3.jpg' }] })
  expect(host.querySelector('.stage')!.children.length, 'the player beside it').toBeGreaterThan(1)
  await toTheNext(rerender)
  const stage = host.querySelector('.stage')!
  expect([...stage.children].map(child => child.className)).toEqual(['episode-card'])
  expect(stage.querySelector('.episode-card img')?.getAttribute('src')).toBe('https://img.example/e3.jpg')
  expect(stage.querySelector('.episode-card')?.textContent).toBe('E3 - Title 3')
})

// each viewer's own player raises each viewer's own trackers, so a guest's page writes as the host's does
test('85% of the episode played on the page\'s player saves it to the media\'s trackers, a party guest\'s too', async () => {
  for (const member of [{ status: 'idle' }, { status: 'active', role: 'guest' }]) {
    party = member as typeof party
    tracking = { summary: null, disagreements: [], answers: [{ state: 'NOT_LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true } }] }
    await atTheEnd()
    await report({ paused: false, time: 840 })
    expect(saved, member.status).toEqual([])
    await report({ paused: false, time: 850 })
    expect(saved, member.status).toEqual([expect.objectContaining({ uri: SERIES, trackers: ['stub'], entry: { progress: 2, status: 'WATCHING' } })])
    unmount(hosts.pop()!)
    saved.length = 0
  }
})

const stubOnly = { summary: null, disagreements: [], answers: [{ state: 'NOT_LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true } }] }

test('the save carries the media as the page has it, and its count makes the episode the last one', async () => {
  tracking = stubOnly
  const { rerender } = await atTheEnd()
  Object.assign(media, { titles: [{ title: 'A show' }], covers: [{ url: 'https://img.test/a.jpg' }], episodeCount: 2 })
  rerender()
  await report({ paused: false, time: 900 })
  expect(saved).toEqual([expect.objectContaining({ entry: { progress: 2, status: 'COMPLETED' }, title: 'A show', cover: 'https://img.test/a.jpg', episodeCount: 2 })])
  expect(watchQuery).toMatch(/covers \{\s*url\s*\}/)
  expect(watchQuery).toMatch(/\bepisodeCount\b/)
})

test('Next episode while the last one plays past 85% counts the last one only', async () => {
  bridge.greets = true
  tracking = stubOnly
  const { rerenderLive } = await atTheEnd()
  await report({ paused: false, time: 900 })
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
  await rerenderLive()
  expect(bridge.links).toHaveLength(2)
  expect((saved as { entry: { progress: number } }[]).map(({ entry }) => entry.progress)).toEqual([2])
})

test('a torrent\'s player is heard as the page\'s own', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  tracking = stubOnly
  series({}, 'nyaa:a')
  hosts.push(page())
  await settle()
  expect(bridge.links, 'the control: the plugin handed its player over').toHaveLength(1)
  await report({ paused: false, time: 900 })
  expect(saved).toEqual([expect.objectContaining({ entry: { progress: 2, status: 'WATCHING' } })])
})

test('a film watched is Completed', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  tracking = stubOnly
  media = { ...single, type: 'MOVIE' }
  params = { ...params, sourceUri: 'cr:GX1' }
  hosts.push(page())
  await settle()
  await report({ paused: false, time: 900 })
  expect(saved).toEqual([expect.objectContaining({ entry: { status: 'COMPLETED', progress: 1 } })])
  expect(watchQuery).toMatch(/\btype\b/)
  expect(watchQuery).toMatch(/\bcategories\b/)
})

test('the page\'s player resumes where the viewer stopped on any source of the episode, a guest\'s never, and each keeps where it is', async () => {
  for (const [member, seeks] of [[{ status: 'idle' }, [600]], [{ status: 'active', role: 'guest' }, []]] as const) {
    vi.useFakeTimers()
    party = member as typeof party
    origins = ['cr', 'nf']
    params = { ...params, sourceUri: 'cr:GX1' }
    stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['nf:81', 600, 1000]]))
    hosts.push(page())
    await settle()
    await report({ paused: false, time: 2 })
    expect(bridge.links.at(-1)!.apply.mock.calls.map(([state]) => state.time), member.status).toEqual(seeks)
    await report({ paused: false, time: 700 })
    expect(JSON.parse(stored.get(WATCH_POSITIONS_KEY)!), member.status).toEqual([['nf:81', 600, 1000, 0], ['cr:GX1', 700, 1000, expect.any(Number)]])
    unmount(hosts.pop()!)
  }
})

test('Next episode keeps no point of the last one for the next one, and seeks nowhere', async () => {
  bridge.greets = true
  const { rerenderLive } = await atTheEnd()
  await report({ paused: false, time: 700 })
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
  await rerenderLive()
  expect(bridge.links).toHaveLength(2)
  expect(JSON.parse(stored.get(WATCH_POSITIONS_KEY)!)).toEqual([['cr:GX2', 700, 1000, expect.any(Number)]])
  expect(bridge.links.at(-1)!.apply).not.toHaveBeenCalled()
})

test('Next episode once the last one ended keeps the next one\'s own point, and resumes there', async () => {
  bridge.greets = true
  stored.set(WATCH_POSITIONS_KEY, JSON.stringify([['cr:GX3', 600, 1000]]))
  const { rerenderLive } = await atTheEnd()
  await report(played, { ...ended, time: 1000 })
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
  await rerenderLive()
  expect(bridge.links).toHaveLength(2)
  expect(JSON.parse(stored.get(WATCH_POSITIONS_KEY)!)).toEqual([['cr:GX3', 600, 1000, 0], ['cr:GX2', expect.any(Number)]])
  expect(bridge.links.at(-1)!.apply.mock.calls.map(([state]) => state.time)).toEqual([600])
})

test('another media gets its own tracking: what was played of the first is never written to the second', async () => {
  const first = params.mediaUri
  const other = 'ag:(anilist:9)'
  try {
    bridge.greets = true
    tracking = stubOnly
    const { rerender } = await atTheEnd()
    await report({ paused: false, time: 900 })
    expect(saved).toEqual([expect.objectContaining({ uri: SERIES, trackers: ['stub'] })])
    params = { ...params, mediaUri: other }
    media = { ...media, uri: other }
    tracking = { summary: null, disagreements: [], answers: [...stubOnly.answers, { state: 'NOT_LISTED', candidates: [], tracker: { id: 'anilist', name: 'AniList', canWrite: true } }] }
    rerender()
    await settle()
    expect(saved, 'before its player says anything').toHaveLength(1)
    await report({ paused: false, time: 900 })
    expect(saved.slice(1)).toEqual([
      expect.objectContaining({ uri: other, trackers: ['stub'], entry: { progress: 2, status: 'WATCHING' } }),
      expect.objectContaining({ uri: other, trackers: ['anilist'], entry: { progress: 2, status: 'WATCHING' } }),
    ])
  } finally {
    params = { ...params, mediaUri: first }
  }
})

test('a save waiting behind one in flight goes to the media it was due on, though another media opens first', async () => {
  const first = params.mediaUri
  const other = 'ag:(anilist:9)'
  try {
    tracking = stubOnly
    const { rerender } = await atTheEnd()
    let land = () => {}
    held = new Promise<void>(resolve => { land = resolve })
    await report({ paused: false, time: 900 })
    // the next episode of the same media played past the mark before the first save has answered
    params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
    rerender()
    await settle()
    await report({ paused: false, time: 900 })
    expect(saved, 'the second waits for the first').toHaveLength(1)
    params = { ...params, mediaUri: other }
    media = { ...media, uri: other }
    rerender()
    await settle()
    await act(async () => {
      land()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect((saved as { uri: string, entry: { progress: number } }[]).map(({ uri, entry }) => [uri, entry.progress])).toEqual([[SERIES, 2], [SERIES, 3]])
  } finally {
    params = { ...params, mediaUri: first }
  }
})

// the page's media moves to `next` on the same address while a save is in flight and another waits behind it
const moveWhileSaving = async (next: string) => {
  bridge.greets = true
  tracking = stubOnly
  const { rerender } = await atTheEnd()
  let land = () => {}
  held = new Promise<void>(resolve => { land = resolve })
  await report({ paused: false, time: 900 })
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
  rerender()
  await settle()
  await report({ paused: false, time: 900 })
  expect(saved, 'the second waits for the first').toHaveLength(1)
  media = { ...media, uri: next }
  rerender()
  await settle()
  await act(async () => {
    land()
    await vi.advanceTimersByTimeAsync(0)
  })
  return (saved as { uri: string, entry: { progress: number } }[]).map(({ uri, entry }) => [uri, entry.progress])
}

test('a save waiting behind one in flight goes to the media it was due on, though the media moves to its first season', async () => {
  const SEASON = 'ag:(tvdb:1-s1)'
  expect(await moveWhileSaving(SEASON)).toEqual([[SERIES, 2], [SERIES, 3]])
})

test('the control: one waiting while the media gains ids goes to the grown uri', async () => {
  const GROWN = 'ag:(anilist:1,mal:1,tvdb:1)'
  expect(await moveWhileSaving(GROWN)).toEqual([[SERIES, 2], [GROWN, 3]])
})

test('an episode playing as the media moves to its first season counts once, on the media it is on at 85%, on any release of it', async () => {
  const SEASON = 'ag:(tvdb:1-s1)'
  for (const [time, before] of [[900, [[SERIES, 2]]], [100, [[SEASON, 2]]]] as const) {
    bridge.links = []
    bridge.greets = true
    tracking = stubOnly
    const { rerender } = await atTheEnd()
    await report({ paused: false, time })
    media = { ...media, uri: SEASON }
    rerender()
    await settle()
    await report({ paused: false, time: 950 })
    const sent = () => (saved as { uri: string, entry: { progress: number } }[]).map(({ uri, entry }) => [uri, entry.progress])
    expect(sent(), `moved at ${time}`).toEqual(before)
    // another release of the same episode, picked after the move
    const { episodes } = media as { episodes: { handles: object[] }[] }
    episodes[1]!.handles.push(handle('cr:GX2b', 'cr', 'https://www.crunchyroll.com/watch/GX2b'))
    params = { ...params, sourceUri: 'cr:GX2b' }
    rerender()
    await settle()
    expect(bridge.links, 'the control: its own player').toHaveLength(2)
    await report({ paused: false, time: 960 })
    expect(sent(), `moved at ${time}, then another release`).toEqual(before)
    // the control: the season's own next episode counts for the season
    params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: 'cr:GX3' }
    rerender()
    await settle()
    await report({ paused: false, time: 900 })
    expect(sent(), `moved at ${time}`).toEqual([...before, [SEASON, 3]])
    unmount(hosts.pop()!)
    saved.length = 0
  }
})

test('an episode counted, then another release of it picked as the media moves to its first season, is not counted on the season too', async () => {
  bridge.greets = true
  tracking = stubOnly
  const { rerender } = await atTheEnd()
  await report({ paused: false, time: 900 })
  const sent = () => (saved as { uri: string, entry: { progress: number } }[]).map(({ uri, entry }) => [uri, entry.progress])
  expect(sent()).toEqual([[SERIES, 2]])
  const { episodes } = media as { episodes: { handles: object[] }[] }
  episodes[1]!.handles.push(handle('cr:GX2b', 'cr', 'https://www.crunchyroll.com/watch/GX2b'))
  params = { ...params, sourceUri: 'cr:GX2b' }
  media = { ...media, uri: 'ag:(tvdb:1-s1)' }
  rerender()
  await settle()
  expect(bridge.links, 'the control: its own player').toHaveLength(2)
  await report({ paused: false, time: 950 })
  expect(sent()).toEqual([[SERIES, 2]])
})

const sentSaves = () => (saved as { uri: string, entry: { progress: number } }[]).map(({ uri, entry }) => [uri, entry.progress])

// a guest's page takes the host's address, which can name the same media by more of its sources than its own did
test('a party guest\'s torrent episode counts once as the page follows the host\'s spelling of the media', async () => {
  for (const at of [100, 900]) {
    bridge.links = []
    bridge.greets = true
    party = { status: 'active', role: 'guest' } as typeof party
    tracking = stubOnly
    params = { mediaUri: 'ag:(anilist:1)', episodeUri: addressUri }
    const { rerender } = await atTheEnd({}, 'nyaa:a')
    await report({ paused: false, time: at })
    params = { ...params, mediaUri: SERIES }
    rerender()
    await settle()
    expect(bridge.links, 'the control: the same player plays on').toHaveLength(1)
    await report({ paused: false, time: 950 })
    expect(sentSaves(), `followed at ${at}`).toEqual([[SERIES, 2]])
    unmount(hosts.pop()!)
    saved.length = 0
  }
})

// the guest's address is the show's, whose details are its first season; the host's is the season's own
test('a party guest\'s torrent episode counts once as the page follows the host to the season its show\'s page was on', async () => {
  const SEASON = 'ag:(tvdb:1-s1)'
  for (const at of [100, 900]) {
    bridge.links = []
    bridge.greets = true
    party = { status: 'active', role: 'guest' } as typeof party
    tracking = stubOnly
    params = { mediaUri: 'ag:(tvdb:1)', episodeUri: addressUri }
    const { rerender } = await atTheEnd({}, 'nyaa:a')
    media = { ...media, uri: SEASON }
    rerender()
    await settle()
    await report({ paused: false, time: at })
    params = { ...params, mediaUri: SEASON }
    rerender()
    await settle()
    expect(bridge.links, 'the control: the same player plays on').toHaveLength(1)
    await report({ paused: false, time: 950 })
    expect(sentSaves(), `followed at ${at}`).toEqual([[SEASON, 2]])
    unmount(hosts.pop()!)
    saved.length = 0
  }
})

test('another release from the torrent\'s package within the episode counts the episode once', async () => {
  for (const at of [100, 900]) {
    bridge.links = []
    bridge.greets = true
    tracking = stubOnly
    const { host, rerender } = await atTheEnd({}, 'nyaa:a')
    const { episodes } = media as { episodes: { handles: object[] }[] }
    episodes[1]!.handles.push(release('a2'))
    await report({ paused: false, time: at })
    params = { ...params, sourceUri: 'nyaa:a2' }
    rerender()
    await settle()
    expect(bridge.links, 'the control: the release in a player of its own').toHaveLength(2)
    expect(host.querySelector('.plugin-player')?.getAttribute('data-url'), 'the control: in the same package').toBe('magnet:?xt=urn:btih:a2')
    await report({ paused: false, time: 950 })
    expect(sentSaves(), `moved at ${at}`).toEqual([[SERIES, 2]])
    unmount(hosts.pop()!)
    saved.length = 0
  }
})

const listedAt = (progress: number) => ({
  summary: { status: 'WATCHING', progress },
  disagreements: [],
  answers: [{ state: 'LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true }, entry: { status: 'WATCHING', progress } }],
})
const more = async (host: HTMLElement) => {
  await act(async () => { host.querySelector<HTMLButtonElement>('.watch-info button[aria-label="One episode more"]')!.click() })
}
const type = async (host: HTMLElement, value: string) => {
  const input = host.querySelector<HTMLInputElement>('.watch-info #compact-progress')!
  await act(async () => { Object.assign(input, { value }).dispatchEvent(new Event('input', { bubbles: true })) })
  await wait(1000)
}
const progresses = () => (saved as { entry: { progress: number } }[]).map(({ entry }) => entry.progress)

test('the tracking row sits with the episode\'s title, under the player, and saves to the media playing', async () => {
  tracking = listedAt(1)
  const { host } = await atTheEnd()
  const info = host.querySelector('.watch-info')!
  expect(info.querySelector('.episode-row .tracking-compact')).not.toBeNull()
  expect(host.querySelector('.player-container .tracking-compact')).toBeNull()
  await more(host)
  await wait(1000)
  expect(saved).toEqual([expect.objectContaining({ uri: SERIES, trackers: ['stub'], entry: { progress: 2 } })])
})

test('a + on the row and the automatic update at 85% on the same episode send one save, waiting or in flight', async () => {
  tracking = listedAt(1)
  const { host } = await atTheEnd()
  await more(host)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(saved, 'the + still waiting').toEqual([expect.objectContaining({ entry: { progress: 2 } })])

  unmount(hosts.pop()!)
  saved.length = 0
  bridge.links = []
  const second = await atTheEnd()
  let land = () => {}
  held = new Promise<void>(resolve => { land = resolve })
  await more(second.host)
  await wait(1000)
  await report({ paused: false, time: 900 })
  await act(async () => {
    land()
    await vi.advanceTimersByTimeAsync(1000)
  })
  expect(saved, 'the + in flight').toEqual([expect.objectContaining({ entry: { progress: 2 } })])
})

test('on a move to another media, the row waits for its details rather than offering the one before', async () => {
  const first = params.mediaUri
  try {
    tracking = listedAt(1)
    const { host, rerender } = await atTheEnd()
    const plus = () => host.querySelector<HTMLButtonElement>('.watch-info button[aria-label="One episode more"]')!
    expect(plus().disabled, 'the control').toBe(false)
    // the subscription still holds the media before, as urql keeps it until the new one answers
    params = { ...params, mediaUri: 'ag:(anilist:9)' }
    media = undefined as unknown as object
    rerender()
    await settle()
    expect(plus().disabled).toBe(true)
  } finally {
    params = { ...params, mediaUri: first }
  }
})

test('a number typed on the row while the automatic save is in flight goes once that one has landed', async () => {
  tracking = listedAt(1)
  const { host } = await atTheEnd()
  let land = () => {}
  held = new Promise<void>(resolve => { land = resolve })
  await report({ paused: false, time: 900 })
  const input = host.querySelector<HTMLInputElement>('.watch-info #compact-progress')!
  await act(async () => { Object.assign(input, { value: '5' }).dispatchEvent(new Event('input', { bubbles: true })) })
  await act(async () => { input.dispatchEvent(new Event('blur')) })
  await wait(1000)
  expect(progresses()).toEqual([2])
  await act(async () => {
    land()
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(progresses()).toEqual([2, 5])
})

test('a progress corrected down still lets the episode count at 85%, and one lowered after it counted stays lowered', async () => {
  tracking = listedAt(1)
  const { host, rerender } = await atTheEnd()
  const reread = async (progress: number) => {
    tracking = listedAt(progress)
    rerender()
    await settle()
  }
  await type(host, '3')
  await reread(3)
  await type(host, '1')
  await reread(1)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(progresses()).toEqual([3, 1, 2])
  await reread(2)
  await type(host, '1')
  await reread(1)
  await report({ paused: false, time: 950 })
  await wait(1000)
  expect(progresses()).toEqual([3, 1, 2, 1])
})

test('a film marked Watched and unmarked is still Completed once watched, and unmarked after that stays so', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  media = { ...single, type: 'MOVIE' }
  params = { ...params, sourceUri: 'cr:GX1' }
  const film = (status: string, progress: number) => ({
    summary: { status, progress },
    disagreements: [],
    answers: [{ state: 'LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true }, entry: { status, progress } }],
  })
  tracking = film('PLANNING', 0)
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  const toggle = async () => {
    await act(async () => { host.querySelector<HTMLButtonElement>('.watch-info button.watched')!.click() })
    await wait(0)
  }
  const reread = async (status: string, progress: number) => {
    tracking = film(status, progress)
    act(() => { render(tree(), host) })
    await settle()
  }
  await toggle()
  await reread('COMPLETED', 1)
  await toggle()
  await reread('PLANNING', 0)
  await report({ paused: false, time: 900 })
  await wait(1000)
  const entries = () => (saved as { entry: object }[]).map(({ entry }) => entry)
  expect(entries()).toEqual([{ progress: 1, status: 'COMPLETED' }, { progress: 0, status: 'PLANNING' }, { status: 'COMPLETED', progress: 1 }])
  await reread('COMPLETED', 1)
  await toggle()
  await reread('PLANNING', 0)
  await report({ paused: false, time: 950 })
  await wait(1000)
  expect(entries().slice(3)).toEqual([{ progress: 0, status: 'PLANNING' }])
})

test('a + early in the episode, the episode watched, then lowered, stays lowered', async () => {
  tracking = listedAt(1)
  const { host, rerender } = await atTheEnd()
  const reread = async (progress: number) => {
    tracking = listedAt(progress)
    rerender()
    await settle()
  }
  await more(host)
  await wait(1000)
  await reread(2)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(progresses(), 'the control: the + alone').toEqual([2])
  await type(host, '1')
  await reread(1)
  await wait(1000)
  expect(progresses()).toEqual([2, 1])
})

test('a film marked Watched at the start, watched, then unmarked, stays unmarked', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  media = { ...single, type: 'MOVIE' }
  params = { ...params, sourceUri: 'cr:GX1' }
  const film = (status: string, progress: number) => ({
    summary: { status, progress },
    disagreements: [],
    answers: [{ state: 'LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true }, entry: { status, progress } }],
  })
  tracking = film('PLANNING', 0)
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  const toggle = async () => {
    await act(async () => { host.querySelector<HTMLButtonElement>('.watch-info button.watched')!.click() })
    await wait(0)
  }
  const reread = async (status: string, progress: number) => {
    tracking = film(status, progress)
    act(() => { render(tree(), host) })
    await settle()
  }
  await toggle()
  await reread('COMPLETED', 1)
  await report({ paused: false, time: 900 })
  await wait(1000)
  await toggle()
  await reread('PLANNING', 0)
  await wait(1000)
  expect((saved as { entry: object }[]).map(({ entry }) => entry)).toEqual([{ progress: 1, status: 'COMPLETED' }, { progress: 0, status: 'PLANNING' }])
})

const goTo = async (rerender: () => void, n: number) => {
  params = { ...params, episodeUri: `ag:(anilist:1-${n})`, sourceUri: `cr:GX${n}` }
  rerender()
  await settle()
}

test('episodes counted, lowered, then watched again, count again', async () => {
  tracking = listedAt(1)
  const { host, rerender } = await atTheEnd()
  const reread = async (progress: number) => {
    tracking = listedAt(progress)
    rerender()
    await settle()
  }
  await report({ paused: false, time: 900 })
  await wait(1000)
  await reread(2)
  await goTo(rerender, 3)
  await report({ paused: false, time: 900 })
  await wait(1000)
  await reread(3)
  await type(host, '1')
  await reread(1)
  await goTo(rerender, 2)
  await report({ paused: false, time: 900 })
  await wait(1000)
  await reread(2)
  await goTo(rerender, 3)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(progresses()).toEqual([2, 3, 1, 2, 3])
})

test('a + taken off a tracker by unchecking it, then checked again, still gets the episode watched', async () => {
  tracking = {
    summary: { status: 'WATCHING', progress: 1 },
    disagreements: [],
    answers: [
      { state: 'LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true }, entry: { status: 'WATCHING', progress: 1 } },
      { state: 'LISTED', candidates: [], tracker: { id: 'anilist', name: 'AniList', canWrite: true }, entry: { status: 'WATCHING', progress: 1 } },
    ],
  }
  const { host } = await atTheEnd()
  await act(async () => { host.querySelector<HTMLButtonElement>('.watch-info button.expand')!.click() })
  const check = () => host.querySelector<HTMLInputElement>('.watch-info input[name="compact-target-anilist"]')!
  const flip = async (on: boolean) => {
    await act(async () => {
      check().checked = on
      check().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  await more(host)
  await flip(false)
  await wait(1000)
  const trackers = () => (saved as { trackers: string[] }[]).map(({ trackers }) => trackers)
  expect(trackers(), 'the control: the + went to Stub alone').toEqual([['stub']])
  await flip(true)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(trackers()).toEqual([['stub'], ['anilist']])
})

test('Completed picked on the row, then 85% before the trackers re-read, writes no progress after it', async () => {
  tracking = listedAt(1)
  const { host } = await atTheEnd()
  const select = host.querySelector<HTMLSelectElement>('.watch-info select[name="compact-status"]')!
  Object.defineProperty(select, 'value', { value: 'COMPLETED', configurable: true })
  await act(async () => { select.dispatchEvent(new Event('change', { bubbles: true })) })
  await wait(0)
  const entries = () => (saved as { entry: object }[]).map(({ entry }) => entry)
  expect(entries(), 'the control').toEqual([{ status: 'COMPLETED' }])
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(entries()).toEqual([{ status: 'COMPLETED' }])
})

const crunchyrollAt = (progress: number) => ({
  summary: { status: null, progress },
  disagreements: [],
  answers: [{ state: 'LISTED', candidates: [], tracker: { id: 'cr', name: 'Crunchyroll', canWrite: true, statuses: ['PLANNING'] }, entry: { status: null, progress } }],
})

test('on Crunchyroll, + + then 85% on the episode they reach is two saves in order, and + then 85% on a later one the + then the episode', async () => {
  tracking = crunchyrollAt(1)
  const { host, rerender } = await atTheEnd()
  await goTo(rerender, 3)
  await more(host)
  await more(host)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(progresses()).toEqual([2, 3])
  unmount(hosts.pop()!)
  saved.length = 0
  bridge.links = []
  tracking = crunchyrollAt(1)
  const second = await atTheEnd()
  await goTo(second.rerender, 3)
  await more(second.host)
  await report({ paused: false, time: 900 })
  await wait(1000)
  expect(progresses()).toEqual([2, 3])
})

test('on Crunchyroll, + + while the 85% update is in flight are each a save of their own after it, in order', async () => {
  tracking = crunchyrollAt(1)
  const { host, rerender } = await atTheEnd()
  await goTo(rerender, 3)
  let land = () => {}
  held = new Promise<void>(resolve => { land = resolve })
  await report({ paused: false, time: 900 })
  await more(host)
  await more(host)
  await wait(1000)
  expect(progresses(), 'the update in flight').toEqual([3])
  await act(async () => {
    land()
    await vi.advanceTimersByTimeAsync(0)
  })
  await wait(0)
  await wait(0)
  expect(progresses()).toEqual([3, 2, 3])
})

test('the watch page\'s row brings no line about stub\'s own list', async () => {
  storage = { location: 'ACCOUNT', signedIn: true, locked: false, waiting: true, held: 0 }
  tracking = listedAt(1)
  const { host } = await atTheEnd()
  expect(host.querySelector('.watch-info .tracking-compact'), 'the control: the row is drawn').not.toBeNull()
  expect(host.querySelector('.stub-list-notice')).toBeNull()
  const elsewhere = mount(withIntl(<MediaTracking work={SERIES} address={SERIES} uri={SERIES}/>))
  hosts.push(elsewhere)
  expect(elsewhere.querySelector('.stub-list-notice')?.textContent, 'the control: the same row elsewhere has it').toBe('Stub: some changes have not reached your FKN account yet.')
})

const SEQUEL = { relation: 'SEQUEL', format: 'TV', node: { _id: 'anilist:2', uri: 'anilist:2' } }
const PREQUEL = { relation: 'PREQUEL', format: 'TV', node: { _id: 'anilist:0', uri: 'anilist:0' } }
const NEXT_SEASON = '/watch/ag:(anilist:2)/ag:(anilist:2-1)'
// the run after the one playing, under the uri the page asks it by, its first episode as given
const nextRun = (uri: string, first: object = {}) => {
  runs[uri] = {
    uri: 'ag:(anilist:2)',
    handles: [],
    episodes: [{ uri: 'ag:(anilist:2-1)', episodeNumber: 1, titles: [{ title: 'Second season' }], handles: [handle('cr:GY1', 'cr', 'https://www.crunchyroll.com/watch/GY1'), release('d')], ...first }],
  }
}
// the address on the last of three episodes, of a media linked to others as given
const lastOf = (linked: object, sourceUri: string) => {
  series()
  media = { ...media, ...linked }
  params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri }
}
const open = async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  const host = page()
  hosts.push(host)
  await settle()
  return host
}

test('the last episode of an anime links the first of its sequel, on the release playing now', async () => {
  lastOf({ relations: [SEQUEL] }, 'nyaa:b')
  nextRun('ag:(anilist:2)')
  const host = await open()
  expect(episodeLinks(host)).toEqual([
    ['Previous episode', watchPath(2, 'nyaa:a'), 'E2 - Title 2'],
    ['Next episode', `${NEXT_SEASON}/nyaa:d`, 'E1 - Second season'],
  ])
  expect(asked).toEqual(['ag:(anilist:2)'])
})

test('the last episode of a show\'s season links the first of the next season', async () => {
  lastOf({
    handles: [{ relation: 'SAME_AS', node: { uri: 'tmdb:9-s1' } }],
    seasons: [{ number: 1, uri: 'tmdb:9-s1' }, { number: 2, uri: 'tmdb:9-s2' }],
  }, 'cr:GX3')
  nextRun('ag:(tmdb:9-s2)')
  const host = await open()
  expect(episodeLinks(host).at(-1)).toEqual(['Next episode', `${NEXT_SEASON}/cr:GY1`, 'E1 - Second season'])
  expect(asked).toEqual(['ag:(tmdb:9-s2)'])
})

test('with no next season, or one whose first episode is not out, there is no next episode', async () => {
  for (const [linked, first] of [[{}, {}], [{ relations: [SEQUEL] }, { releaseDate: '2099-01-01' }]] as const) {
    lastOf(linked, 'cr:GX3')
    nextRun('ag:(anilist:2)', first)
    const host = await open()
    expect(episodeLinks(host).map(([label]) => label), JSON.stringify(linked)).toEqual(['Previous episode'])
    unmount(hosts.pop()!)
  }
})

test('the first episode links the last of the season before', async () => {
  series()
  media = { ...media, relations: [PREQUEL] }
  params = { ...params, episodeUri: 'ag:(anilist:1-1)', sourceUri: 'cr:GX1' }
  runs['ag:(anilist:0)'] = { uri: 'ag:(anilist:0)', episodes: [{ uri: 'ag:(anilist:0-12)', episodeNumber: 12, titles: [{ title: 'Finale' }], handles: [handle('cr:GW12', 'cr', 'https://www.crunchyroll.com/watch/GW12')] }] }
  const host = await open()
  expect(episodeLinks(host)).toEqual([
    ['Previous episode', '/watch/ag:(anilist:0)/ag:(anilist:0-12)/cr:GW12', 'E12 - Finale'],
    ['Next episode', watchPath(2, 'cr:GX2'), 'E2 - Title 2'],
  ])
})

test('an episode inside its season asks for no other run', async () => {
  series({}, 'cr:GX2')
  media = { ...media, relations: [PREQUEL, SEQUEL] }
  nextRun('ag:(anilist:2)')
  await open()
  expect(asked).toEqual([])
})

test('a film links no episode of its sequel or prequel, and counts down to none', async () => {
  for (const type of ['MOVIE', 'TV']) {
    media = { ...single, type, relations: [PREQUEL, SEQUEL] }
    params = { ...params, sourceUri: 'cr:GX1' }
    nextRun('ag:(anilist:2)')
    asked = []
    const host = await open()
    await report(played, ended)
    const film = type === 'MOVIE'
    expect(episodeLinks(host).map(([label]) => label), type).toEqual(film ? [] : ['Next episode'])
    expect(asked, type).toEqual(film ? [] : ['ag:(anilist:0)', 'ag:(anilist:2)'])
    expect(Boolean(host.querySelector('.up-next')), type).toBe(!film)
    unmount(hosts.pop()!)
  }
})

test('at the end of a season, the countdown opens the next season\'s first episode', async () => {
  lastOf({ relations: [SEQUEL] }, 'cr:GX3')
  nextRun('ag:(anilist:2)')
  const host = await open()
  await report(played, ended)
  expect(host.querySelector('.up-next')?.getAttribute('title')).toBe('E1 - Second season')
  await wait(UP_NEXT_MS)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`${NEXT_SEASON}/cr:GY1`)
})

test('a run that has not answered yet is never read from the one asked before it', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  lastOf({ relations: [SEQUEL] }, 'cr:GX3')
  nextRun('ag:(anilist:2)')
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  await settle()
  expect(episodeLinks(host).at(-1)?.[1]).toBe(`${NEXT_SEASON}/cr:GY1`)

  // on to the sequel's last episode, whose own sequel has not answered
  media = { ...runs['ag:(anilist:2)'], relations: [{ ...SEQUEL, node: { _id: 'anilist:3', uri: 'anilist:3' } }] }
  params = { ...params, mediaUri: 'ag:(anilist:2)', episodeUri: 'ag:(anilist:2-1)', sourceUri: 'cr:GY1' }
  act(() => { render(tree(), host) })
  await settle()
  expect(asked).toEqual(['ag:(anilist:2)', 'ag:(anilist:3)'])
  expect(host.querySelector('.episode-step')).toBeNull()
})

test('the episode title holds its place until the episode is known, and reads its address once every source has answered without naming it', () => {
  origins = undefined
  const { hook } = memoryLocation()
  const tree = () => withIntl(<Router hook={hook}><Watch/></Router>)
  media = undefined as unknown as object
  const host = mount(tree())
  hosts.push(host)
  const title = () => host.querySelector('.episode-title')!
  expect(title().querySelector('[aria-hidden="true"]'), 'held').not.toBeNull()
  expect(title().textContent).toBe('')

  act(() => { media = { uri: params.mediaUri, handles: [], episodes: [], settled: false }; render(tree(), host) })
  expect(title().textContent, 'a source is still out').toBe('')

  act(() => { media = { uri: params.mediaUri, handles: [], episodes: [], settled: true }; render(tree(), host) })
  expect(title().textContent).toBe(addressUri)

  act(() => { media = { uri: params.mediaUri, handles: [], episodes: [{ ...episode, episodeNumber: 3, titles: [{ title: 'Plan' }] }], settled: false }; render(tree(), host) })
  expect(title().textContent).toMatch(/^E3 - Plan$/)
})

const nyaaFirst = () => stored.set('stub.sources.play-order', JSON.stringify(['nyaa', 'cr', 'amazon', 'nf']))
const pluginsChange = async (...statuses: object[]) => {
  plugins.statuses = statuses
  await act(async () => { for (const listener of plugins.listeners) listener() })
  await settle()
}
const live = () => {
  const location = memoryLocation()
  const tree = () => withIntl(<Router hook={location.hook}><Watch/></Router>)
  const host = mount(tree())
  hosts.push(host)
  return { host, rerender: async () => { act(() => { render(tree(), host) }); await settle() } }
}

// Frieren from Japan, 2026-10-18: Prime Video answered before Crunchyroll and was opened in 13 of 16 fresh runs
test('with Prime Video answering before Crunchyroll, Play still opens Crunchyroll, the first in the play order', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  media = { ...single, settled: false }
  primeEpisode()
  params = { ...params, episodeUri: episode.uri }
  const { rerender } = live()
  await settle()
  expect(navigate).not.toHaveBeenCalled()

  primeEpisode(allHandles[0]!)
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

// a scene search's link opens the episode at the scene's second
test('Play\'s pick keeps the second a scene search opened the episode at', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  primeEpisode(allHandles[0]!)
  params = { ...params, episodeUri: episode.uri }
  search = 't=272'
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1?t=272`, { replace: true })
})

// the order is a setting on the FKN account, kept in this browser's own key while signed out
for (const [where, keep] of [
  ['in this browser', nyaaFirst],
  ['on the FKN account', () => stored.set('stub.settings.account', JSON.stringify({ 'stub.sources.play-order': '["nyaa","cr","amazon","nf"]' }))],
] as const) {
  test(`an order kept ${where} with Nyaa first opens its release before Crunchyroll`, async () => {
    vi.useFakeTimers()
    origins = ['cr', 'nyaa']
    keep()
    hosts.push(page())
    await settle()
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
  })
}

// live on Frieren, Nyaa lists its releases at 3.9 to 5.6 s and Crunchyroll shows at about 2 s, and the last of them
// lands with `settled`; urql keeps the last origins answer until the one for the new origins comes
test('Nyaa ranked first and answering after Crunchyroll, with settled in the same answer, opens the release and never Crunchyroll', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  nyaaFirst()
  params = { ...params, episodeUri: 'ag:(anilist:1-1)' }
  Object.assign(episode, { uri: 'ag:(anilist:1-1,cr:GX1)', handles: [allHandles[0]] })
  media = { ...single, settled: false }
  const { rerender } = live()
  await settle()
  expect(navigate, 'Crunchyroll waits for Nyaa, ranked above it').not.toHaveBeenCalled()

  Object.assign(episode, { uri: 'ag:(anilist:1-1,cr:GX1,nyaa:a)', handles: [allHandles[0], allHandles[2]] })
  media = { ...single, settled: true }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

// a source that connects once the others have answered joins the worker's fan-out, but the worker answers again
// only once that source does
test('a ranked source connecting after a settled answer is waited for until an answer heard after it connected', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  plugins.statuses = [{ uri: NYAA_PACKAGE, state: 'connecting' }]
  nyaaFirst()
  Object.assign(episode, { handles: [allHandles[0]] })
  const { rerender } = live()
  await settle()
  expect(navigate, 'its package still connecting').not.toHaveBeenCalled()

  await pluginsChange(connectedNyaa)
  expect(navigate, 'the answer on screen was settled before it was asked').not.toHaveBeenCalled()

  media = { ...single }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

test('a ranked added source turned off does not hold Play, connecting or connected', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  plugins.statuses = [{ uri: NYAA_PACKAGE, state: 'connecting' }]
  nyaaFirst()
  stored.set('stub.sources.disabled', JSON.stringify(['nyaa']))
  Object.assign(episode, { handles: [allHandles[0]] })
  live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })

  navigate.mockClear()
  plugins.statuses = [connectedNyaa]
  media = { ...single, settled: false }
  live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

// a source turned off keeps the handles it gave until a reload
test('a release from an added source turned off is never opened, alone or ranked first', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  stored.set('stub.sources.disabled', JSON.stringify(['nyaa']))
  Object.assign(episode, { handles: [allHandles[2]] })
  live()
  await settle()
  expect(navigate, 'its release alone').not.toHaveBeenCalled()

  nyaaFirst()
  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
  live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

test('a ranked source whose package fails to connect does not hold Play', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  plugins.statuses = [{ uri: NYAA_PACKAGE, state: 'connecting' }]
  nyaaFirst()
  Object.assign(episode, { handles: [allHandles[0]] })
  live()
  await settle()
  expect(navigate).not.toHaveBeenCalled()

  await pluginsChange({ uri: NYAA_PACKAGE, state: 'error' })
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

// a Canadian's Prime Video plays with the extension, which the viewer can add, so it is theirs to wait for
test('outside Japan on the cloud, Prime Video ranked above a release holds it until every source answered', async () => {
  vi.useFakeTimers()
  vi.stubEnv('TZ', 'America/Toronto')
  origins = ['nyaa']
  stored.set('stub.sources.play-order', JSON.stringify(['amazon', 'nyaa']))
  Object.assign(episode, { handles: [allHandles[2]] })
  media = { ...single, settled: false }
  const { rerender } = live()
  await settle()
  expect(navigate).not.toHaveBeenCalled()

  media = { ...single }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

test('a settled answer heard while the lookup of the added sources is out does not open a source ranked below them', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  nyaaFirst()
  let answer = () => {}
  lookups.held = new Promise<void>(resolve => { answer = resolve })
  const { rerender } = live()
  await settle()
  media = { ...single }
  await rerender()
  expect(navigate, 'the lookup has not said Nyaa plays its releases').not.toHaveBeenCalled()

  answer()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

test('a plugin lookup that fails does not hold a pick ranked below a player that could still answer', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  primeEpisode()
  params = { ...params, episodeUri: episode.uri }
  const failed = Promise.reject(new Error('the worker did not answer'))
  failed.catch(() => {})
  lookups.held = failed
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${PRIME}`, { replace: true })
})

test('with no source added, a pick ranked below a player opens once settled, before the origins have answered', async () => {
  vi.useFakeTimers()
  origins = undefined
  plugins.statuses = []
  primeEpisode()
  params = { ...params, episodeUri: episode.uri }
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${PRIME}`, { replace: true })
})

test('a turned-off Crunchyroll ranked first does not hold a Prime Video pick', async () => {
  vi.useFakeTimers()
  origins = ['amazon']
  stored.set('stub.sources.disabled', JSON.stringify(['cr']))
  primeEpisode()
  params = { ...params, episodeUri: episode.uri }
  media = { ...single, settled: false }
  live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${PRIME}`, { replace: true })
})

// with Crunchyroll off, Kitsu and Watchmode still name its episodes
test('a turned-off Crunchyroll ranked first that has the episode is skipped for Prime Video', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  stored.set('stub.sources.disabled', JSON.stringify(['cr']))
  primeEpisode(allHandles[0]!)
  params = { ...params, episodeUri: episode.uri }
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/${PRIME}`, { replace: true })
})

test('a ranked package that drops and reconnects is waited for until an answer heard after it reconnected', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  nyaaFirst()
  Object.assign(episode, { handles: [allHandles[0]] })
  media = { ...single, settled: false }
  const { rerender } = live()
  await settle()
  expect(navigate, 'Nyaa has not answered').not.toHaveBeenCalled()

  await pluginsChange({ uri: NYAA_PACKAGE, state: 'connecting' })
  media = { ...single }
  await rerender()
  expect(navigate, 'its package is connecting again').not.toHaveBeenCalled()

  await pluginsChange(connectedNyaa)
  expect(navigate, 'the answer on screen is from before it reconnected').not.toHaveBeenCalled()

  media = { ...single }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/cr:GX1`, { replace: true })
})

const cannotPlay = async (host: HTMLElement) => {
  await act(async () => { unplayables.listeners.get(host.querySelector('iframe')!)!() })
  await settle()
}
const watching = (sourceUri: string) => `/watch/${params.mediaUri}/${params.episodeUri}/${sourceUri}`

// the owner, 2026-10-19: "Only if their sources aren't available should it go to the next best ranked source available."
test('Play\'s pick that cannot play the episode here moves to the next ranked source that has it, replacing the address', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  const { host, rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })

  params = { ...params, sourceUri: 'cr:GX1' }
  await rerender()
  expect(navigate, 'the control: Play\'s pick stays while it plays').toHaveBeenCalledOnce()
  await cannotPlay(host)
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(navigate).toHaveBeenLastCalledWith(watching('nf:81'), { replace: true })
})

test('a source picked by hand that cannot play the episode keeps its message', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  params = { ...params, sourceUri: 'cr:GX1' }
  const { host } = live()
  await settle()
  await cannotPlay(host)
  expect(navigate).not.toHaveBeenCalled()
  expect(new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('sourceUri')).toBe('cr:GX1')
})

test('when every source Play could open cannot play the episode, the last one keeps its message, and nothing loops', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  primeEpisode(allHandles[0]!)
  params = { ...params, episodeUri: episode.uri }
  const { host, rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })

  params = { ...params, sourceUri: 'cr:GX1' }
  await rerender()
  await cannotPlay(host)
  expect(navigate).toHaveBeenLastCalledWith(watching(PRIME), { replace: true })

  params = { ...params, sourceUri: PRIME }
  await rerender()
  await cannotPlay(host)
  await rerender()
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('sourceUri')).toBe(PRIME)
})

// a reason the viewer can fix keeps their favourite: here the extension, which this browser can add
test('Play\'s pick that needs the extension this browser can add shows the install button, and Play stays on it', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  const { host, rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('nf:81'), { replace: true })

  params = { ...params, sourceUri: 'nf:81' }
  await rerender()
  expect(button(host, 'Install the FKN extension to play Netflix')).toBeTruthy()
  expect(navigate).toHaveBeenCalledOnce()
})

// iOS Safari or Chrome on Android, where neither store offers the extension
test('where the browser cannot add the extension, Play\'s Netflix pick moves to the next source, and a hand pick still offers it', async () => {
  vi.useFakeTimers()
  detecting.addable = false
  origins = ['cr', 'nf', 'nyaa']
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  const { rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('nf:81'), { replace: true })

  params = { ...params, sourceUri: 'nf:81' }
  await rerender()
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(navigate).toHaveBeenLastCalledWith(watching('cr:GX1'), { replace: true })

  navigate.mockClear()
  const named = page()
  hosts.push(named)
  await settle()
  expect(button(named, 'Install the FKN extension to play Netflix')).toBeTruthy()
  expect(navigate).not.toHaveBeenCalled()
})

test('outside Japan where the browser cannot add the extension, Play\'s Prime Video pick moves to the release', async () => {
  vi.useFakeTimers()
  detecting.addable = false
  origins = ['amazon', 'nyaa']
  stored.set('stub.sources.play-order', JSON.stringify(['amazon', 'nyaa']))
  canadianEpisode()
  Object.assign(episode, { handles: [...episode.handles, allHandles[2]] })
  const { rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching(CANADA), { replace: true })

  params = { ...params, sourceUri: CANADA }
  await rerender()
  expect(navigate).toHaveBeenLastCalledWith(watching('nyaa:a'), { replace: true })
})

test('where the browser cannot add the extension and nothing else plays the episode, the page offers Browse sources rather than Netflix', async () => {
  vi.useFakeTimers()
  detecting.addable = false
  origins = ['nf']
  plugins.statuses = []
  Object.assign(episode, { uri: 'ag:(anilist:1-1,nf:81)', handles: [allHandles[1]] })
  params = { ...params, episodeUri: episode.uri }
  const host = page()
  hosts.push(host)
  await settle()
  expect(navigate).not.toHaveBeenCalled()
  expect(signInRows(host)).toEqual([])
  expect(button(noSource(host)!, 'Browse sources')).toBeTruthy()
})

// the owner, 2026-10-19: Play's pick that cannot play moves to the next ranked source, which HOR-1014 keeps
test('Play\'s pick that cannot play, with every other source still to sign in to, moves to the next ranked one for its player to ask', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'cr']
  statuses = { crunchyroll: 'signed-in' }
  plugins.statuses = []
  primeEpisode(allHandles[0]!)
  params = { ...params, episodeUri: episode.uri }
  const { host, rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })

  params = { ...params, sourceUri: 'cr:GX1' }
  await rerender()
  await cannotPlay(host)
  expect(navigate).toHaveBeenCalledTimes(2)
  expect(navigate).toHaveBeenLastCalledWith(watching(PRIME), { replace: true })
})

test('where the browser cannot add the extension, Netflix ranked first does not hold Play until every source answered', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  Object.assign(episode, { handles: [allHandles[0]] })
  media = { ...single, settled: false }
  hosts.push(page())
  await settle()
  expect(navigate, 'the control: a browser that can add it waits for Netflix').not.toHaveBeenCalled()

  detecting.addable = false
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })
})

// as on a browser that cannot add the extension, where Netflix holds nothing and a handle of it can still come
test('Play\'s pick that plays is not moved when a better-ranked source answers after it opened', async () => {
  vi.useFakeTimers()
  detecting.addable = false
  origins = ['amazon', 'cr', 'nf']
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  primeEpisode(allHandles[0]!)
  media = { ...single, settled: false }
  params = { ...params, episodeUri: episode.uri, sourceUri: PRIME }
  const { host, rerender } = live()
  await settle()
  await cannotPlay(host)
  expect(navigate, 'a source picked by hand stays').not.toHaveBeenCalled()

  // as on the next episode, when the address names no source
  params = { ...params, sourceUri: undefined }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })
  params = { ...params, sourceUri: 'cr:GX1' }
  await rerender()

  Object.assign(episode, { handles: [...episode.handles, allHandles[1]] })
  await rerender()
  expect(navigate).toHaveBeenCalledOnce()
})

test('where the browser cannot add the extension but has it, Netflix ranked first holds Play until it has answered', async () => {
  vi.useFakeTimers()
  detecting.addable = false
  backend = 'extension'
  origins = ['cr', 'nf']
  stored.set('stub.sources.play-order', JSON.stringify(['nf', 'cr', 'amazon']))
  Object.assign(episode, { handles: [] })
  media = { ...single, settled: false }
  const { rerender } = live()
  await settle()

  Object.assign(episode, { handles: [allHandles[0]] })
  await rerender()
  expect(navigate).not.toHaveBeenCalled()

  media = { ...single, settled: true }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(watching('cr:GX1'), { replace: true })
})

// HOR-1033, the owner, 2026-10-25: "route automatically the user to free watching alternatives available if there are
// any instead of defaulting to premium sources when the user is not logged in", and 2026-10-26: "if we know that the
// user has previously logged into CR, then we should ask him to re-log into his account, otherwise we wait for the
// free source"
// this harness answers on the first render, so an added source connected at load has answered only once `media` is new
const crAndRelease = () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  statuses = {}
  before.clear()
  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
}

test('a Crunchyroll ranked first that the viewer never signed in to here gives way to the release, on the cloud and with the extension, and one they did opens', async () => {
  for (const each of ['cloud', 'extension']) {
    for (const [viewer, to] of [
      ['nothing known', 'nyaa:a'],
      ['signed out', 'nyaa:a'],
      ['signed out since a sign in', 'cr:GX1'],
      ['signed in', 'cr:GX1'],
    ] as const) {
      crAndRelease()
      backend = each
      if (viewer === 'signed out') statuses.crunchyroll = 'signed-out'
      if (viewer === 'signed out since a sign in') signedOutAgain('crunchyroll')
      if (viewer === 'signed in') statuses.crunchyroll = 'signed-in'
      hosts.push(page())
      await settle()
      expect(navigate, `${each}, ${viewer}`).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
      navigate.mockClear()
      while (hosts.length) unmount(hosts.pop()!)
    }
  }
})

// the owner, 2026-10-26, on whether a sign out made in stub's Settings forgets that the viewer signed in before: "I guess so."
test('after a sign out in Settings, Play gives way to the release as for a viewer never signed in, and after a session that expired it opens Crunchyroll to sign in again', async () => {
  for (const [signedOut, to] of [
    ['in Settings', 'nyaa:a'],
    ['as the session expired', 'cr:GX1'],
  ] as const) {
    crAndRelease()
    await wiring.crunchyroll.signIn()
    if (signedOut === 'in Settings') await wiring.crunchyroll.signOut()
    else wiring.record('crunchyroll', 'signed-out')
    hosts.push(page())
    await settle()
    expect(navigate, signedOut).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
    navigate.mockClear()
    while (hosts.length) unmount(hosts.pop()!)
  }
})

// the address follows each pick, as the router does; returns every source Play named
const followPicks = async (rerender: () => Promise<void>) => {
  for (let at = 0; at < navigate.mock.calls.length; at++) {
    params = { ...params, sourceUri: navigate.mock.calls[at]![0].split('/').at(-1) }
    await rerender()
  }
  return navigate.mock.calls.map(([to]) => to.split('/').at(-1))
}

// the review of 2026-10-26: JustWatch lists Netflix beside Crunchyroll for 5 of 51 current and 20 of 50 older US shows
test('on the cloud, Netflix ranked between them, which needs the extension, never takes the release\'s place', async () => {
  crAndRelease()
  Object.assign(episode, { handles: allHandles })
  const { rerender } = live()
  await settle()
  expect(await followPicks(rerender)).toEqual(['nyaa:a'])
})

// the review of 2026-10-26: stub never learns whether the viewer is signed in to Netflix, nor to Prime Video before its player says
test('with the extension, a Netflix or Prime Video not known to be signed in never takes the place of a Crunchyroll never signed in to', async () => {
  const prime = handle(PRIME, 'amazon', PRIME_LINK)
  for (const [others, picks] of [
    [[allHandles[1]!], ['cr:GX1']],
    [[prime], ['cr:GX1']],
    [[allHandles[1]!, prime, allHandles[2]!], ['nyaa:a']],
  ] as const) {
    crAndRelease()
    backend = 'extension'
    origins = ['cr', 'nf', 'amazon', 'nyaa']
    Object.assign(episode, { handles: [allHandles[0], ...others] })
    const { rerender } = live()
    await settle()
    media = { ...single }
    await rerender()
    expect(await followPicks(rerender), others.map(each => each.node.origin).join(', ')).toEqual(picks)
    navigate.mockClear()
    params = { ...params, sourceUri: undefined }
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('a Crunchyroll never signed in to gives way to a Prime Video the viewer was found signed in to, on the cloud and with the extension', async () => {
  for (const each of ['cloud', 'extension']) {
    crAndRelease()
    backend = each
    origins = ['cr', 'amazon', 'nyaa']
    statuses.prime = 'signed-in'
    Object.assign(episode, { handles: [allHandles[0], handle(PRIME, 'amazon', PRIME_LINK), allHandles[2]] })
    hosts.push(page())
    await settle()
    expect(navigate, each).toHaveBeenCalledExactlyOnceWith(toWatch(PRIME), { replace: true })
    navigate.mockClear()
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('outside Japan on the cloud, a Prime Video the viewer was found signed in to needs the extension, so the release opens instead', async () => {
  crAndRelease()
  vi.stubEnv('TZ', 'America/Toronto')
  origins = ['cr', 'amazon', 'nyaa']
  statuses.prime = 'signed-in'
  Object.assign(episode, { handles: [allHandles[0], handle(CANADA, 'amazon', CANADA_LINK), allHandles[2]] })
  const { rerender } = live()
  await settle()
  expect(await followPicks(rerender)).toEqual(['nyaa:a'])
})

// HOR-758, the owner, 2026-10-19: the favourite is fixed, not skipped, where the fix is not a sign in
test('outside Japan on the cloud, a Prime Video ranked first that the viewer never signed in to still opens, for the page to ask for the extension', async () => {
  crAndRelease()
  vi.stubEnv('TZ', 'America/Toronto')
  origins = ['amazon', 'nyaa']
  stored.set('stub.sources.play-order', JSON.stringify(['amazon', 'cr', 'nf']))
  Object.assign(episode, { handles: [handle(CANADA, 'amazon', CANADA_LINK), allHandles[2]] })
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch(CANADA), { replace: true })
})

test('a Crunchyroll signed in to before stays Play\'s pick when its player finds the viewer signed out, for it to ask them to sign in again', async () => {
  for (const each of ['cloud', 'extension']) {
    crAndRelease()
    backend = each
    statuses.crunchyroll = 'signed-in'
    const { rerender } = live()
    await settle()
    expect(navigate, each).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })

    params = { ...params, sourceUri: 'cr:GX1' }
    await rerender()
    await act(async () => { wiring.record('crunchyroll', 'signed-out') })
    await settle()
    expect(navigate, each).toHaveBeenCalledOnce()
    navigate.mockClear()
    params = { ...params, sourceUri: undefined }
    while (hosts.length) unmount(hosts.pop()!)
  }
})

// the owner, 2026-10-26: "otherwise we wait for the free source"; on the cloud, the one backend with a sign out in
// Settings, made in another tab while this page plays
test('Play\'s own pick of a Crunchyroll signed in to before gives way to the release once the viewer signs out of it in Settings', async () => {
  crAndRelease()
  statuses.crunchyroll = 'signed-in'
  const { rerender } = live()
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })

  params = { ...params, sourceUri: 'cr:GX1' }
  await rerender()
  await act(async () => { await wiring.crunchyroll.signOut() })
  await settle()
  expect(navigate.mock.calls.map(([to]) => to)).toEqual([toWatch('cr:GX1'), toWatch('nyaa:a')])
})

// the step 1 report of 2026-10-26: Crunchyroll showed until the added source answered, then the release
test('for a viewer never signed in to Crunchyroll, Play opens nothing while the added source has not answered, and then the release', async () => {
  for (const [each, handles] of [['extension', [allHandles[0], allHandles[2]]], ['cloud', allHandles]] as const) {
    crAndRelease()
    backend = each
    Object.assign(episode, { handles })
    let answer = () => {}
    lookups.held = new Promise<void>(resolve => { answer = resolve })
    const { rerender } = live()
    await settle()
    expect(navigate, `${each}: the plugin has not said it plays the release`).not.toHaveBeenCalled()

    answer()
    await settle()
    expect(await followPicks(rerender), each).toEqual(['nyaa:a'])
    navigate.mockClear()
    params = { ...params, sourceUri: undefined }
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('with the extension, a Crunchyroll never signed in to opens once the added source answered nothing, and the page never asks', async () => {
  crAndRelease()
  backend = 'extension'
  plugins.statuses = [{ uri: NYAA_PACKAGE, state: 'connecting' }]
  Object.assign(episode, { handles: [allHandles[0]] })
  const { host, rerender } = live()
  await settle()
  expect(navigate, 'connecting').not.toHaveBeenCalled()

  await pluginsChange(connectedNyaa)
  media = { ...single }
  await rerender()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
  expect(noSource(host)).toBeNull()
})

// a source turned off is never asked, so its answer never comes
test('with the extension, a Crunchyroll never signed in to opens before the sources answer with no source added, one that failed to connect, or one turned off', async () => {
  for (const [added, off] of [[[], false], [[{ uri: NYAA_PACKAGE, state: 'error' }], false], [[connectedNyaa], true]] as const) {
    crAndRelease()
    backend = 'extension'
    plugins.statuses = [...added]
    if (off) stored.set('stub.sources.disabled', JSON.stringify(['nyaa']))
    media = { ...single, settled: false }
    Object.assign(episode, { handles: [allHandles[0]] })
    live()
    await settle()
    expect(navigate, off ? 'turned off' : added.length ? 'failed' : 'none added').toHaveBeenCalledExactlyOnceWith(toWatch('cr:GX1'), { replace: true })
    navigate.mockClear()
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('Play\'s Crunchyroll never signed in to gives way to a release heard after it opened, and one signed in to before stays', async () => {
  for (const [viewer, picks] of [['never signed in', ['cr:GX1', 'nyaa:a']], ['signed in before', ['cr:GX1']]] as const) {
    crAndRelease()
    backend = 'extension'
    if (viewer === 'signed in before') signedOutAgain('crunchyroll')
    Object.assign(episode, { handles: [allHandles[0]] })
    const { rerender } = live()
    await settle()
    media = { ...single }
    await rerender()
    await followPicks(rerender)

    Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
    media = { ...single }
    await rerender()
    expect(navigate.mock.calls.map(([to]) => to.split('/').at(-1)), viewer).toEqual(picks)
    navigate.mockClear()
    params = { ...params, sourceUri: undefined }
    while (hosts.length) unmount(hosts.pop()!)
  }
})

test('a Crunchyroll the viewer opened by hand stays when its player finds them signed out', async () => {
  crAndRelease()
  params = { ...params, sourceUri: 'cr:GX1' }
  const host = page()
  hosts.push(host)
  await settle()
  await act(async () => { wiring.record('crunchyroll', 'signed-out') })
  await settle()
  expect(navigate).not.toHaveBeenCalled()
  expect(new URL(host.querySelector('iframe')!.getAttribute('src')!, 'https://stub.test').searchParams.get('sourceUri')).toBe('cr:GX1')
})

// HOR-1033, the owner, 2026-10-26, on whether an added source can say its releases need an account: "Yes, it should be
// able to." The source here is ranked first, its release plays in its own player, and Nyaa's release needs nothing.
const PAID_PACKAGE = 'https:paid.spec.test'
const paidRelease = handle('paid:a', 'paid', 'magnet:?xt=urn:btih:p')
const connectedPaid = (access?: string) => ({ uri: PAID_PACKAGE, state: 'connected', sources: [{ origin: 'paid', name: 'paid', ...access ? { access } : {} }] })
const paidFirst = (access?: string, account?: () => Promise<unknown>) => {
  vi.useFakeTimers()
  origins = ['cr', 'paid', 'nyaa']
  plugins.statuses = [connectedPaid(access), connectedNyaa]
  if (account) lookups.account.paid = account
  stored.set('stub.sources.play-order', JSON.stringify(['paid', 'nyaa', 'cr', 'amazon', 'nf']))
  Object.assign(episode, { handles: [paidRelease, allHandles[2]] })
}
// the page once the worker has answered again since the added sources connected, as it does in the app
const answered = async () => {
  const view = live()
  await settle()
  media = { ...single }
  await view.rerender()
  return view
}
const again = () => {
  navigate.mockClear()
  params = { ...params, sourceUri: undefined }
  lookups.asked = []
  while (hosts.length) unmount(hosts.pop()!)
}

test('an added source that needs an account gives way to a release that needs none, unless it says the viewer is signed in', async () => {
  for (const [access, answer, to] of [
    ['account', 'signed-in', 'paid:a'],
    ['account', 'signed-out', 'nyaa:a'],
    ['paid', 'signed-in', 'paid:a'],
    ['paid', 'no-plan', 'nyaa:a'],
    ['paid', 'an answer of no known value', 'nyaa:a'],
    ['account', 'no account to ask', 'nyaa:a'],
  ] as const) {
    paidFirst(access, answer === 'no account to ask' ? undefined : async () => answer)
    await answered()
    expect(navigate, `${access}, ${answer}`).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
    expect(lookups.asked, `${access}, ${answer}`).toEqual(['paid'])
    again()
    said.reset()
  }
})

test('an added source that needs no account is never asked and opens first as before, one that names no access too', async () => {
  for (const access of ['none', undefined]) {
    paidFirst(access, async () => 'signed-out')
    await answered()
    expect(navigate, String(access)).toHaveBeenCalledExactlyOnceWith(toWatch('paid:a'), { replace: true })
    expect(lookups.asked, String(access)).toEqual([])
    again()
  }
})

test('a Crunchyroll never signed in to gives way to an added source that needs an account only while it says the viewer is signed in', async () => {
  for (const [access, answer, to] of [
    ['account', 'signed-out', 'nyaa:a'],
    ['account', 'signed-in', 'paid:a'],
    [undefined, 'signed-out', 'paid:a'],
  ] as const) {
    paidFirst(access, async () => answer)
    statuses = {}
    stored.set('stub.sources.play-order', JSON.stringify(['cr', 'paid', 'nyaa', 'amazon', 'nf']))
    Object.assign(episode, { handles: [allHandles[0], paidRelease, allHandles[2]] })
    await answered()
    expect(navigate, `${access}, ${answer}`).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
    again()
    said.reset()
  }
})

// the owner, 2026-10-26: "if we know that the user has previously logged into CR, then we should ask him to re-log into
// his account, otherwise we wait for the free source"
test('an added source that said in this page the viewer was signed in opens though they are signed out since, for its player to ask them to sign in again; with no plan since, it gives way', async () => {
  paidFirst('paid', async () => 'signed-in')
  for (const [answer, to] of [['signed-in', 'paid:a'], ['signed-out', 'paid:a'], ['no-plan', 'nyaa:a']] as const) {
    lookups.account.paid = async () => answer
    await answered()
    expect(navigate, answer).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
    again()
  }
})

test('the account is asked again on every episode', async () => {
  paidFirst('account', async () => 'signed-in')
  const { rerender } = live()
  await settle()
  expect(lookups.asked).toEqual(['paid'])
  await rerender()
  expect(lookups.asked, 'the same episode').toEqual(['paid'])
  params = { ...params, episodeUri: 'ag:(anilist:1-2)' }
  Object.assign(episode, { uri: params.episodeUri })
  await rerender()
  expect(lookups.asked, 'the next episode').toEqual(['paid', 'paid'])
})

// an ask that never settles counts as no answer once the worker's wait is out, and the source then counts as never signed in
test('an added source whose account never answers lists its release at once and holds Play for ACCOUNT_WAIT_MS at most, then gives way, and with nothing to give way to opens', async () => {
  for (const [added, to] of [[[connectedPaid('account'), connectedNyaa], 'nyaa:a'], [[connectedPaid('account')], 'paid:a']] as const) {
    paidFirst('account', () => new Promise(() => {}))
    plugins.statuses = [...added]
    const { host } = await answered()
    expect(host.querySelector('a.source[title="paid"]')?.getAttribute('href'), `${to}: listed, to play in stub`).toBe(toWatch('paid:a'))
    await act(async () => { await vi.advanceTimersByTimeAsync(ACCOUNT_WAIT_MS - 1) })
    expect(navigate, to).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    await settle()
    expect(navigate, to).toHaveBeenCalledExactlyOnceWith(toWatch(to), { replace: true })
    again()
  }
})

// the route keeps one Watch across episodes (src/router/index.tsx), so the last episode's answer is still on hand
const nextEpisode = () => {
  navigate.mockClear()
  params = { ...params, episodeUri: 'ag:(anilist:1-2)' }
  Object.assign(episode, { uri: params.episodeUri })
}

test('on the next episode, Play opens nothing ranked below the source until its new answer, and not on the last one', async () => {
  paidFirst('account', async () => 'signed-out')
  const { rerender } = await answered()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('nyaa:a'), { replace: true })
  let answer = (_: string) => {}
  lookups.account.paid = () => new Promise(resolve => { answer = resolve })
  nextEpisode()
  await rerender()
  expect(navigate, 'while it is asked').not.toHaveBeenCalled()
  await act(async () => { answer('signed-in') })
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(toWatch('paid:a'), { replace: true })
})

test('no answer on the next episode is not signed in, though the source said so on the last one', async () => {
  for (const [why, unanswered] of [
    ['it never answers', () => { lookups.account.paid = () => new Promise(() => {}) }],
    ['it rejects', () => { lookups.account.paid = async () => { throw new Error('no session') } }],
    ['it answers no known value', () => { lookups.account.paid = async () => 'SIGNED-IN' }],
    ['the worker is unreachable', () => { lookups.down = true }],
  ] as const) {
    paidFirst('account', async () => 'signed-in')
    statuses = {}
    stored.set('stub.sources.play-order', JSON.stringify(['cr', 'paid', 'nyaa', 'amazon', 'nf']))
    params = { ...params, episodeUri: addressUri }
    Object.assign(episode, { uri: allUri, handles: [allHandles[0], paidRelease, allHandles[2]] })
    const { rerender } = await answered()
    expect(navigate, `${why}: the last episode`).toHaveBeenCalledExactlyOnceWith(toWatch('paid:a'), { replace: true })
    unanswered()
    nextEpisode()
    await rerender()
    await act(async () => { await vi.advanceTimersByTimeAsync(ACCOUNT_WAIT_MS) })
    await settle()
    expect(navigate, why).toHaveBeenCalledExactlyOnceWith(toWatch('nyaa:a'), { replace: true })
    again()
    lookups.down = false
    said.reset()
  }
})
