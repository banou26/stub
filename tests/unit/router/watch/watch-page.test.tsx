// FIRST: ../../components/dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from '../../components/dom'

import { afterEach, expect, test, vi } from 'vite-plus/test'
import { render } from 'preact'
import { useEffect } from 'preact/hooks'
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
let tracking: object | undefined
const saved: object[] = []

vi.mock('urql', () => ({
  useSubscription: ({ query, variables }: { query: Parameters<typeof print>[0], variables: { input: { uri?: string, ids?: string[] } } }) => {
    const printed = print(query)
    if (printed.includes('subscription MediaTracking')) return [{ data: tracking && { tracking } }]
    if (variables.input.uri) watchQuery = printed
    return [{ data: variables.input.uri ? { media } : origins && { originPage: { nodes: origins.filter(id => variables.input.ids?.includes(id)).map(id => ({ id, name: id })) } } }]
  },
  useMutation: () => [{}, async ({ input }: { input: { trackers: string[] } }) => {
    saved.push(input)
    return { data: { saveListEntry: input.trackers.map(tracker => ({ tracker, outcome: 'SAVED' })) } }
  }],
}))
vi.mock('wouter', async importOriginal => ({ ...await importOriginal(), useParams: () => params, useLocation: () => ['', navigate] }))
vi.mock('../../../../src/worker', () => ({ remotePicker: async () => null, remotePlayer: async (id: string) => id === 'nyaa' ? { pluginUri: 'plugin:nyaa' } : null }))
vi.mock('../../../../src/party/use-party', () => ({ useParty: () => party, usePartyMessages: () => {} }))
vi.mock('../../../../src/utils/fkn-backend', () => ({ detectBackend: async () => backend }))
vi.mock('../../../../src/tracking/site-status', () => ({ siteStatuses: { read: (site: string) => statuses[site] && { state: statuses[site] } } }))
type Report = { paused: boolean, ended?: boolean, time?: number }
// each player the page attaches, which a test makes report as a person or the browser would
const bridge = vi.hoisted(() => ({ links: [] as { report: (state: Report) => void }[] }))
vi.mock('../../../../src/party/bridge', () => ({
  attachPlaybackBridge: () => {
    const listeners = new Set<(state: object) => void>()
    let ended = false
    const link = {
      apply: () => {},
      onReport: (listener: (state: object) => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      ended: () => ended,
      duration: () => 1000,
      dispose: () => listeners.clear(),
      report: ({ paused, ended: atEnd = false, time = 0 }: Report) => {
        ended = atEnd
        for (const listener of listeners) listener({ paused, time, rate: 1, at: Date.now() })
      },
    }
    bridge.links.push(link)
    return link
  },
}))
// the nyaa plugin's play(): it declines a release with no magnet
vi.mock('../../../../src/components/plugin-player', () => ({
  default: ({ release, onUnplayable }: { release: { url?: string }, onUnplayable: () => void }) => {
    useEffect(() => { if (!release.url?.startsWith('magnet:')) onUnplayable() }, [release.url])
    return <div className="plugin-player" data-url={release.url}/>
  },
}))
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
const { UP_NEXT_MS } = await import('../../../../src/router/watch/up-next')
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
  bridge.links = []
  tracking = undefined
  saved.length = 0
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

test('signed out of Crunchyroll, Play waits for a release the episode does not hold yet', async () => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  Object.assign(episode, { handles: [allHandles[0]] })
  const location = memoryLocation()
  const tree = () => <Router hook={location.hook}><Watch/></Router>
  const host = mount(tree())
  hosts.push(host)
  await settle()
  expect(navigate).not.toHaveBeenCalled()

  Object.assign(episode, { handles: [allHandles[0], allHandles[2]] })
  act(() => { render(tree(), host) })
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

test('a release the address names before the episode holds it plays once its handle arrives', async () => {
  vi.useFakeTimers()
  origins = ['nyaa']
  Object.assign(episode, { handles: [] })
  params = { ...params, sourceUri: 'nyaa:a' }
  const location = memoryLocation()
  const tree = () => <Router hook={location.hook}><Watch/></Router>
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

// the episode playing on Crunchyroll, whose next one Crunchyroll has too
const atTheEnd = async (third: object = {}) => {
  vi.useFakeTimers()
  origins = ['cr', 'nyaa']
  series(third, 'cr:GX2')
  const location = memoryLocation()
  const tree = () => <Router hook={location.hook}><Watch/></Router>
  const host = mount(tree())
  hosts.push(host)
  await settle()
  return { host, rerender: () => act(() => { render(tree(), host) }) }
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
  expect(host.querySelector('.up-next')?.getAttribute('title')).toBe('E3 - Title 3')
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
  const grown = 'ag:(anilist:1-3,nyaa:b)'
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

test('nothing starts when the next episode is not out, or has nothing that plays', async () => {
  await atTheEnd({ releaseDate: '2099-01-01' })
  await report(played, ended)
  await wait(UP_NEXT_MS)
  expect(navigate, 'not out').not.toHaveBeenCalled()
  unmount(hosts.pop()!)

  await atTheEnd({ handles: [handle('amazon:us', 'amazon', 'https://watch.amazon.com/watch?gti=us')] })
  await report(played, ended)
  await wait(UP_NEXT_MS)
  expect(navigate, 'nothing plays').not.toHaveBeenCalled()
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

// each viewer's own player raises each viewer's own trackers, so a guest's page writes as the host's does
test('85% of the episode played on the page\'s player saves it to the media\'s trackers, a party guest\'s too', async () => {
  for (const member of [{ status: 'idle' }, { status: 'active', role: 'guest' }]) {
    party = member as typeof party
    tracking = { summary: null, disagreements: [], answers: [{ state: 'NOT_LISTED', candidates: [], tracker: { id: 'stub', name: 'Stub', canWrite: true } }] }
    await atTheEnd()
    await report({ paused: false, time: 840 })
    expect(saved, member.status).toEqual([])
    await report({ paused: false, time: 850 })
    expect(saved, member.status).toEqual([expect.objectContaining({ uri: params.mediaUri, trackers: ['stub'], entry: { progress: 2, status: 'WATCHING' } })])
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

test('another media gets its own tracking: what was played of the first is never written to the second', async () => {
  const first = params.mediaUri
  const other = 'ag:(anilist:9)'
  try {
    tracking = stubOnly
    const { rerender } = await atTheEnd()
    await report({ paused: false, time: 900 })
    expect(saved).toEqual([expect.objectContaining({ uri: first, trackers: ['stub'] })])
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
