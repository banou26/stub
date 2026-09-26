// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

// The episode title, from the embed's props to the words @banou/media-player draws over the picture.
// The skin and the player are the real ones, over a fake signed-in frame: the player draws nothing
// of its own until a media attaches.

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

// the skip events, tracks and thumbnails are separate concerns, and stay unanswered here
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', () => ({
  discoverCrunchyrollTracks: () => new Promise(() => {}),
  selectCrunchyrollTrack: () => new Promise(() => {}),
}))
vi.mock('../../../../src/sources/crunchyroll/seek-thumbnails', () => ({
  loadCrunchyrollThumbnails: () => new Promise(() => {}),
}))

// the player's two CommonJS dependencies cannot reach the react alias under node (see
// vitest.config.ts), and neither draws anything this test reads
vi.mock('react-feather', () => Object.fromEntries(
  ['AlertTriangle', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GAAAAAAAA/one'

// the handle's listener methods are own closures, as on the real one (see timeline-seek.test.ts)
const makeVideo = () => {
  const target = new EventTarget()
  Object.defineProperties(target, {
    addEventListener: { configurable: true, value: target.addEventListener.bind(target) },
    removeEventListener: { configurable: true, value: target.removeEventListener.bind(target) },
    dispatchEvent: { configurable: true, value: target.dispatchEvent.bind(target) },
  })
  return Object.assign(target, {
    currentTime: 0, duration: 1_770, paused: true, volume: 1, readyState: 4, seeking: false,
    play: async () => {}, pause: () => {},
  })
}

const signedIn = {
  goto: async () => {},
  addStyleTag: async () => {},
  locator: (selector: string) => ({
    exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
    videoElement: async () => makeVideo(),
  }),
}

const element = (title?: string) =>
  <CrunchyrollPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" title={title} />

const drawnTitle = (host: HTMLElement) => host.querySelector('.title')?.textContent

const hosts: HTMLElement[] = []

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  lib.attachFrame.mockReset().mockResolvedValue(signedIn)
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

describe('the episode title', () => {
  test('is drawn over the picture, and follows a title the watch page sends later', async () => {
    const host = mount(element())
    hosts.push(host)
    // the player's own chrome is up once the video attaches, with no title to draw yet
    await vi.waitFor(() => expect(host.querySelector('.time')?.textContent).toContain('29:30'), { timeout: 5_000 })
    expect(drawnTitle(host)).toBeUndefined()

    act(() => { render(element('E5 - The Rain Stops'), host) })
    await vi.waitFor(() => expect(drawnTitle(host)).toBe('E5 - The Rain Stops'))

    act(() => { render(element('E5 - When the Rain Stops'), host) })
    await vi.waitFor(() => expect(drawnTitle(host)).toBe('E5 - When the Rain Stops'))
  })

  // the usual order: the watch page answers the embed's ask seconds before Crunchyroll attaches
  test('is drawn when it arrived before the video attached', async () => {
    const host = mount(element('E5 - The Rain Stops'))
    hosts.push(host)
    await vi.waitFor(() => expect(host.querySelector('.time')?.textContent).toContain('29:30'), { timeout: 5_000 })
    await vi.waitFor(() => expect(drawnTitle(host)).toBe('E5 - The Rain Stops'))
  })
})
