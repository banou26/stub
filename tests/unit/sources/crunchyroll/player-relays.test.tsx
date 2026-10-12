// FIRST, and it has to stay first: ../../components/dom installs the document that @emotion/react
// reads at module scope. See the file for what happens when it does not.
import { button, mount, unmount } from '../../components/dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren } from 'preact'

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { crunchyrollPage, frameOn } from './saved-page'

// Which relay the Crunchyroll player goes through: the viewer's default first, then the others while
// Crunchyroll answers with its region page, against Crunchyroll's real region page.

const lib = vi.hoisted(() => ({ extension: false, attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => lib.extension,
  relayOf: (frame: { relay?: string }) => frame.relay,
}))

const told = vi.hoisted(() => vi.fn())
vi.mock('../../../../src/embed-relays', () => ({ tellTriedRelay: told }))

vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))
vi.mock('../../../../src/embed-tracks', () => ({ serveEmbedTracks: () => () => {} }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/sources/crunchyroll/cr-native-controls')>(),
  discoverCrunchyrollTracks: () => new Promise(() => {}),
}))

const skin = vi.hoisted(() => ({ remote: null as RemoteVideoElement | null }))
vi.mock('../../../../src/sources/crunchyroll/cr-videojs-player', () => ({
  default: ({ children, remote }: { children?: ComponentChildren, remote: RemoteVideoElement | null }) => {
    skin.remote = remote
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GXXXXXXXX/an-episode'
const UNAVAILABLE_NOTE = 'This episode is not available on Crunchyroll in your region. Try another source.'

const frameWith = (relay: string | undefined, page: Frame) => ({
  relay,
  goto: vi.fn(async () => {}),
  addStyleTag: vi.fn(async () => {}),
  evaluate: () => new Promise(() => {}),
  locator: page.locator,
}) as unknown as Frame

// Crunchyroll's region page as it was saved from Japan
const regionPage = (relay?: string) => frameWith(relay, frameOn(crunchyrollPage('region-restricted.html')))

const video = Object.assign(new EventTarget(), { duration: 1440 }) as unknown as RemoteVideoElement
// a signed-in watch page whose video is up
const playing = (relay?: string) => frameWith(relay, {
  locator: (selector: string) => ({
    exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
    videoElement: async () => video,
  }),
} as unknown as Frame)

const relayChoices = () => lib.attachFrame.mock.calls.map(([options]) => (options as { relay?: unknown }).relay)

const hosts: HTMLElement[] = []
const render = (triedRelays?: string[], unlistedRelays?: Promise<readonly string[]>) => {
  const host = mount(<CrunchyrollPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" triedRelays={triedRelays} unlistedRelays={unlistedRelays} />)
  hosts.push(host)
  return host
}

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  lib.extension = false
  lib.attachFrame.mockReset()
  told.mockReset()
  skin.remote = null
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

test('an episode on the region page through the default relay plays through another one', async () => {
  lib.attachFrame.mockResolvedValueOnce(regionPage('r1')).mockResolvedValueOnce(playing('r2'))
  const host = render()

  await vi.waitFor(() => expect(skin.remote).toBe(video), { timeout: 5_000 })
  expect(relayChoices()).toEqual([undefined, { exclude: ['r1'] }])
  const [first, second] = lib.attachFrame.mock.calls.map(([options]) => (options as { iframe: HTMLIFrameElement }).iframe)
  expect(second).not.toBe(first)
  expect(told.mock.calls).toEqual([['r1']])
  expect(host.textContent).not.toContain(UNAVAILABLE_NOTE)
})

test('an episode on the region page through every relay says so in one line, with nothing to retry', async () => {
  lib.attachFrame
    .mockResolvedValueOnce(regionPage('r1'))
    .mockResolvedValueOnce(regionPage('r2'))
    .mockRejectedValueOnce(Object.assign(new Error('attachFrame: none-left'), { name: 'RelayUnavailableError' }))
  const host = render()

  await vi.waitFor(() => expect(host.textContent).toContain(UNAVAILABLE_NOTE), { timeout: 5_000 })
  expect(relayChoices()).toEqual([undefined, { exclude: ['r1'] }, { exclude: ['r1', 'r2'] }])
  expect(host.querySelector('.overlay')?.textContent).toBe(UNAVAILABLE_NOTE)
  expect(button(host, 'Retry')).toBeUndefined()
  expect(host.querySelector('.loading-spinner')).toBeNull()
})

test('an episode no relay plays leaves the show\'s next episode to start on the default relay', async () => {
  lib.attachFrame
    .mockResolvedValueOnce(regionPage('r1'))
    .mockResolvedValueOnce(regionPage('r2'))
    .mockRejectedValueOnce(Object.assign(new Error('attachFrame: none-left'), { name: 'RelayUnavailableError' }))
  const host = render()

  await vi.waitFor(() => expect(host.textContent).toContain(UNAVAILABLE_NOTE), { timeout: 5_000 })
  expect(told).not.toHaveBeenCalled()
})

test('on the extension, no relay served the page, so the region page ends at the first try', async () => {
  lib.extension = true
  lib.attachFrame.mockResolvedValue(regionPage(undefined))
  const host = render()

  await vi.waitFor(() => expect(host.textContent).toContain(UNAVAILABLE_NOTE), { timeout: 5_000 })
  expect(lib.attachFrame).toHaveBeenCalledTimes(1)
  expect(told).not.toHaveBeenCalled()
})

test('a relay answered again ends the tries instead of starting them over', async () => {
  lib.attachFrame.mockResolvedValue(regionPage('r1'))
  const host = render(['r1'])

  await vi.waitFor(() => expect(host.textContent).toContain(UNAVAILABLE_NOTE), { timeout: 5_000 })
  expect(lib.attachFrame).toHaveBeenCalledTimes(1)
})

test('the next episode of a show starts past the relays it was unavailable through', async () => {
  lib.attachFrame.mockResolvedValueOnce(regionPage('r2')).mockResolvedValueOnce(playing('r3'))
  render(['r1'])

  await vi.waitFor(() => expect(skin.remote).toBe(video), { timeout: 5_000 })
  expect(relayChoices()).toEqual([{ exclude: ['r1'] }, { exclude: ['r1', 'r2'] }])
  expect(told.mock.calls).toEqual([['r2']])
})

test('a cloud frame waits for the relays\' answers, then opens past the ones that do not list the episode', async () => {
  const answers = Promise.withResolvers<readonly string[]>()
  lib.attachFrame.mockResolvedValueOnce(playing('r2'))
  render(['r0'], answers.promise)

  // the backend is known 300 ms after load
  await new Promise(resolve => setTimeout(resolve, 600))
  expect(lib.attachFrame).not.toHaveBeenCalled()
  answers.resolve(['r1'])

  await vi.waitFor(() => expect(skin.remote).toBe(video), { timeout: 5_000 })
  expect(relayChoices()).toEqual([{ exclude: ['r0', 'r1'] }])
  expect(told.mock.calls).toEqual([['r1']])
})

test('a relay the check found listed that shows the region page still moves on to the next one', async () => {
  lib.attachFrame.mockResolvedValueOnce(regionPage('r2')).mockResolvedValueOnce(playing('r3'))
  render(undefined, Promise.resolve(['r1']))

  await vi.waitFor(() => expect(skin.remote).toBe(video), { timeout: 5_000 })
  expect(relayChoices()).toEqual([{ exclude: ['r1'] }, { exclude: ['r1', 'r2'] }])
  expect(told.mock.calls).toEqual([['r1'], ['r2']])
})

test('on the extension the relays\' answers change nothing, as no relay serves its frame', async () => {
  lib.extension = true
  lib.attachFrame.mockResolvedValueOnce(playing(undefined))
  render(undefined, Promise.resolve(['r1']))

  await vi.waitFor(() => expect(skin.remote).toBe(video), { timeout: 5_000 })
  expect(relayChoices()).toEqual([undefined])
  expect(told).not.toHaveBeenCalled()
})

test('a player closed before the relays answer opens no frame', async () => {
  const answers = Promise.withResolvers<readonly string[]>()
  const host = render(undefined, answers.promise)

  await new Promise(resolve => setTimeout(resolve, 600))
  unmount(host)
  answers.resolve(['r1'])
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(lib.attachFrame).not.toHaveBeenCalled()
})
