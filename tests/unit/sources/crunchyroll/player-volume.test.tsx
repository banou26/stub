// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { PLAYER_VOLUME_KEY } from '../../../../src/utils/player-volume'
import { makeRemoteVideo, settle } from '../../components/remote-video'

// The kept volume on a Crunchyroll episode, through the whole embed: the real player and skin over a
// fake signed-in cloud frame, whose video Crunchyroll's own player writes to after stub restored it.

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
vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'CaptionsOff', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'TriangleAlert', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GG5H5XQX4/the-journeys-end'

const values = new Map<string, string>()
const kept = () => JSON.parse(values.get(PLAYER_VOLUME_KEY) ?? 'null')
const muteControl = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.sound')

let episode: ReturnType<typeof makeRemoteVideo>
const hosts: HTMLElement[] = []

const watch = async () => {
  const host = mount(<CrunchyrollPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" />)
  hosts.push(host)
  await vi.waitFor(() => expect(muteControl(host)).toBeTruthy(), { timeout: 5_000 })
  return host
}

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  })
  episode = makeRemoteVideo()
  lib.attachFrame.mockReset().mockResolvedValue({
    goto: async () => {},
    addStyleTag: async () => {},
    locator: (selector: string) => ({
      exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
      videoElement: async () => episode.remote,
    }),
  })
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('a muted viewer opening a Crunchyroll episode', () => {
  test('hears nothing when Crunchyroll\'s own player unmutes the video after the restore, and stays muted', async () => {
    values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
    const host = await watch()
    await vi.waitFor(() => expect(episode.video.muted, 'the kept mute reached the video').toBe(true))

    episode.setByPage('muted', false)
    await settle()

    expect(episode.video.muted, 'the video plays muted').toBe(true)
    expect(kept(), 'the kept mute is not replaced by the page\'s').toEqual({ volume: 1, muted: true })
    await vi.waitFor(() => expect(muteControl(host)?.getAttribute('aria-pressed')).toBe('true'))
  })

  test('unmutes with the player\'s own control, and that is what is kept', async () => {
    values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0.4, muted: true }))
    const host = await watch()
    await vi.waitFor(() => expect(muteControl(host)?.getAttribute('aria-pressed')).toBe('true'))

    muteControl(host)!.click()
    await settle()

    expect(episode.video.muted).toBe(false)
    expect(kept()).toEqual({ volume: 0.4, muted: false })
    episode.setByPage('volume', 1)
    await settle()
    expect(episode.video.volume, 'the page\'s own volume is put back').toBe(0.4)
    expect(kept()).toEqual({ volume: 0.4, muted: false })
  })
})
