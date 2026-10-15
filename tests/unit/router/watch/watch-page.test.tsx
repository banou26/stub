// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { print } from 'graphql'
import { memoryLocation } from 'wouter/memory-location'

const navigate = vi.fn()
const allUri = 'ag:(anilist:1-1,cr:GX1,nf:81,nyaa:a)'
let params: { mediaUri: string, episodeUri: string, sourceUri?: string } = { mediaUri: 'ag:(anilist:1)', episodeUri: allUri }
const handle = (uri: string, origin: string, url: string) => ({ relation: 'SAME_AS', node: { uri, origin, url } })
const allHandles = [
  handle('cr:GX1', 'cr', 'https://www.crunchyroll.com/watch/GX1'),
  handle('nf:81', 'nf', 'https://www.netflix.com/watch/81'),
  handle('nyaa:a', 'nyaa', 'magnet:?xt=urn:btih:a'),
]
const episode = { uri: params.episodeUri, handles: allHandles }
const single = { uri: params.mediaUri, episodes: [episode] }
let media: object = single
let watchQuery = ''
let origins: string[] | undefined
let party = { status: 'idle' }
let backend = 'cloud'
let statuses: Record<string, string> = { crunchyroll: 'signed-out' }

vi.mock('urql', () => ({
  useSubscription: ({ query, variables }: { query: Parameters<typeof print>[0], variables: { input: { uri?: string, ids?: string[] } } }) => {
    if (variables.input.uri) watchQuery = print(query)
    return [{ data: variables.input.uri ? { media } : origins && { originPage: { nodes: origins.filter(id => variables.input.ids?.includes(id)).map(id => ({ id, name: id })) } } }]
  },
}))
vi.mock('wouter', async importOriginal => ({ ...await importOriginal(), useParams: () => params, useLocation: () => ['', navigate] }))
vi.mock('../../../../src/worker', () => ({ remotePicker: async () => null, remotePlayer: async (id: string) => id === 'nyaa' ? { pluginUri: 'plugin:nyaa' } : null }))
vi.mock('../../../../src/party/use-party', () => ({ useParty: () => party, usePartyMessages: () => {} }))
vi.mock('../../../../src/utils/fkn-backend', () => ({ detectBackend: async () => backend }))
vi.mock('../../../../src/tracking/site-status', () => ({ siteStatuses: { read: (site: string) => statuses[site] && { state: statuses[site] } } }))
vi.mock('../../../../src/party/bridge', () => ({ attachPlaybackBridge: () => ({ dispose: () => {} }) }))
vi.mock('../../../../src/components/plugin-player', () => ({ default: () => <div className="plugin-player"/> }))
vi.mock('../../../../src/components/party-playback', () => ({ default: () => null }))
vi.mock('../../../../src/embed-tracks', () => ({ embedTracks: () => ({ dispose: () => {} }) }))
const relays = vi.hoisted(() => ({ remembered: {} as Record<string, string>, heard: [] as [HTMLIFrameElement, string][] }))
vi.mock('../../../../src/embed-relays', () => ({
  triedRelaysParams: () => relays.remembered,
  hearTriedRelays: (iframe: HTMLIFrameElement, sourceUri: string) => {
    relays.heard.push([iframe, sourceUri])
    return () => {}
  },
}))
// lucide-react is CommonJS and requires react under node; no behaviour here
vi.mock('lucide-react', () => ({ ChevronLeft: () => null, ChevronRight: () => null }))
vi.stubGlobal('__STUB_EMBED_PAGE__', '/embed.html')

const { default: Watch } = await import('../../../../src/router/watch/index')
const { QUIET_MS } = await import('../../../../src/router/watch/auto-pick')
const { Router } = await import('wouter')
const page = () => mount(<Router hook={memoryLocation().hook}><Watch/></Router>)

const hosts: HTMLElement[] = []
afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.useRealTimers()
  navigate.mockClear()
  party = { status: 'idle' }
  backend = 'cloud'
  statuses = { crunchyroll: 'signed-out' }
  params = { mediaUri: params.mediaUri, episodeUri: allUri }
  Object.assign(episode, { uri: allUri, handles: allHandles })
  media = single
  relays.remembered = {}
  relays.heard = []
})

const settle = async () => {
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  await act(async () => { await vi.advanceTimersByTimeAsync(QUIET_MS) })
}

test('a signed-out Crunchyroll is not picked before the plugin lookup has asked about any origin', async () => {
  vi.useFakeTimers()
  origins = undefined
  hosts.push(page())
  await settle()
  expect(navigate).not.toHaveBeenCalled()
})

test('once the lookup answers, the release wins over the signed-out Crunchyroll, and over Netflix on the cloud', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

test('a member still joining a party does not pick, since it follows the host', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  party = { status: 'joining' }
  hosts.push(page())
  await settle()
  expect(navigate).not.toHaveBeenCalled()
})

test('with the extension, Netflix plays in stub and is picked at once', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf', 'nyaa']
  backend = 'extension'
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nf:81`, { replace: true })
})

// Frieren on the cloud, 2026-10-12: the episode's Netflix match was this session's, so a reload into the address lost it
test('a linked Netflix source the episode has not matched is listed, active and played', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nf']
  Object.assign(episode, { uri: 'ag:(anilist:1-1,cr:GX1)', handles: allHandles.filter(({ node }) => node.origin === 'cr') })
  params = { ...params, episodeUri: episode.uri, sourceUri: 'nf:81726716' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('a.source.active')?.getAttribute('title')).toBe('nf')
  expect(host.querySelector('iframe')?.getAttribute('src')).toContain(`url=${encodeURIComponent('https://www.netflix.com/watch/81726716')}`)
  expect(navigate).not.toHaveBeenCalled()
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

test('a viewer last seen signed out of Prime Video gets the release first, as for Crunchyroll', async () => {
  vi.useFakeTimers()
  origins = ['amazon', 'nyaa']
  statuses = { prime: 'signed-out' }
  primeEpisode(allHandles[2]!)
  params = { ...params, episodeUri: episode.uri }
  hosts.push(page())
  await settle()
  expect(navigate).toHaveBeenCalledExactlyOnceWith(`/watch/${params.mediaUri}/${params.episodeUri}/nyaa:a`, { replace: true })
})

// JustWatch hands every viewer outside Japan the US offer, whose gti plays on amazon.com alone
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

test('the relays a show was unavailable through reach its next episode\'s player, and never reload the one playing', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  const location = memoryLocation()
  const tree = () => <Router hook={location.hook}><Watch/></Router>
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

const row = (n: number, ...handles: ReturnType<typeof handle>[]) =>
  ({ uri: `ag:(anilist:1-${n})`, episodeNumber: n, titles: [{ title: `Title ${n}` }], handles })
const crunchyroll = (n: number) => handle(`cr:GX${n}`, 'cr', `https://www.crunchyroll.com/watch/GX${n}`)
const release = (id: string) => handle(`nyaa:${id}`, 'nyaa', `magnet:?xt=urn:btih:${id}`)
// three episodes, the address on the second; the third as given
const series = (third: object = {}, sourceUri = 'nyaa:a') => {
  media = {
    uri: params.mediaUri,
    episodes: [row(1, crunchyroll(1)), row(2, crunchyroll(2), release('a')), { ...row(3, crunchyroll(3), release('b')), ...third }],
  }
  params = { ...params, episodeUri: 'ag:(anilist:1-2)', sourceUri }
}
const watchPath = (n: number, sourceUri?: string) => `/watch/${params.mediaUri}/ag:(anilist:1-${n})${sourceUri ? `/${sourceUri}` : ''}`
const episodeLinks = (host: HTMLElement) =>
  [...host.querySelectorAll('.episode-nav a')].map(link => [link.textContent, link.getAttribute('href'), link.getAttribute('title')])

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

test('an episode not out yet is not linked as the next one', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series({ releaseDate: '2099-01-01' })
  const host = page()
  hosts.push(host)
  await settle()
  expect(episodeLinks(host).map(([label]) => label)).toEqual(['Previous episode'])
})

test('a film\'s one episode links nothing', async () => {
  vi.useFakeTimers()
  origins = ['cr']
  params = { ...params, sourceUri: 'cr:GX1' }
  const host = page()
  hosts.push(host)
  await settle()
  expect(host.querySelector('.episode-nav')).toBeNull()
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

// Chromium 1228, 2026-10-15: a frame that loads another address in place adds a step to the tab's
// history, so after Next one Back moved only the player back, and the page still named the next episode
test('another episode gets a fresh player, so Back leaves the page rather than the frame', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  for (const [origin, player] of [['cr', 'iframe'], ['nyaa', '.plugin-player']] as const) {
    series({}, origin === 'cr' ? 'cr:GX2' : 'nyaa:a')
    const location = memoryLocation()
    const tree = () => <Router hook={location.hook}><Watch/></Router>
    const host = mount(tree())
    hosts.push(host)
    await settle()
    const before = host.querySelector(player)
    expect(before, origin).not.toBeNull()
    params = { ...params, episodeUri: 'ag:(anilist:1-3)', sourceUri: origin === 'cr' ? 'cr:GX3' : 'nyaa:b' }
    act(() => { render(tree(), host) })
    await settle()
    expect(host.querySelector(player), origin).not.toBeNull()
    expect(host.querySelector(player), origin).not.toBe(before)
  }
})
