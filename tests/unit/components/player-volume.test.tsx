// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { FunctionComponent } from 'preact'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { PLAYER_VOLUME_KEY, readPlayerVolume, rememberPlayerVolume } from '../../../src/utils/player-volume'
import { makeRemoteVideo, settle } from './remote-video'

// Both of stub's episode players, mounted for real over a fake remote video: stub's own videojs skin
// (Netflix, bare and with its seek adapter) and @banou/media-player (Crunchyroll). Each must start an
// episode at the volume and mute the viewer last left a player at, hold it against the page behind
// the video, keep only what the viewer changes, and play exactly as before when storage is blocked or
// holds junk.

// @banou/media-player's two CommonJS dependencies cannot reach the react alias under node (see
// vitest.config.ts), and neither draws anything this test reads
vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'CaptionsOff', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'TriangleAlert', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: Player } = await import('../../../src/components/player')
const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')
const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame

type PlayerUnderTest = {
  name: string
  Component: FunctionComponent<{ remote: RemoteVideoElement | null, frame: Frame | null }>
  /** The player's own mute control. */
  muteControl: (host: HTMLElement) => HTMLButtonElement | null
  /** Whether that control reads as muted, which is the store having read the media. */
  showsMuted: (host: HTMLElement) => boolean
}

const videojsMute = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.media-button--mute')
const mediaPlayerMute = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.sound')

const PLAYERS: PlayerUnderTest[] = [
  {
    name: "stub's own videojs player",
    Component: Player,
    muteControl: videojsMute,
    showsMuted: host => videojsMute(host)?.getAttribute('aria-label') === 'Unmute',
  },
  {
    name: "stub's own videojs player with Netflix's seek adapter",
    Component: NetflixVideoJSPlayer,
    muteControl: videojsMute,
    showsMuted: host => videojsMute(host)?.getAttribute('aria-label') === 'Unmute',
  },
  {
    name: '@banou/media-player (Crunchyroll)',
    Component: CrunchyrollVideoJSPlayer,
    muteControl: mediaPlayerMute,
    showsMuted: host => mediaPlayerMute(host)?.getAttribute('aria-pressed') === 'true',
  },
]

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const hosts: HTMLElement[] = []
const play = (Component: FunctionComponent<{ remote: RemoteVideoElement | null, frame: Frame | null }>, remote: RemoteVideoElement) => {
  const host = mount(<Component remote={remote} frame={frame}/>)
  hosts.push(host)
  return host
}
const close = () => { while (hosts.length) unmount(hosts.pop()!) }

let storage: ReturnType<typeof memoryStorage>
const kept = () => JSON.parse(storage.values.get(PLAYER_VOLUME_KEY) ?? 'null')
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  close()
  vi.unstubAllGlobals()
})

for (const { name, Component, muteControl, showsMuted } of PLAYERS) {
  describe(name, () => {
    test('starts an episode at the kept volume and mute', async () => {
      storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0.3, muted: true }))
      const { remote, video } = makeRemoteVideo()
      const host = play(Component, remote)
      await settle()
      expect(video).toEqual({ volume: 0.3, muted: true })
      await vi.waitFor(() => expect(showsMuted(host), 'the mute control shows it').toBe(true))
    })

    test('keeps the kept mute when the page behind the video unmutes it after the restore', async () => {
      storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
      const { remote, video, setByPage } = makeRemoteVideo()
      const host = play(Component, remote)
      await vi.waitFor(() => expect(video.muted, 'the kept mute reached the video').toBe(true))

      setByPage('muted', false)
      await settle()

      expect(video.muted, 'the video is muted again').toBe(true)
      expect(kept(), 'the page\'s unmute is not kept').toEqual({ volume: 1, muted: true })
      await vi.waitFor(() => expect(showsMuted(host)).toBe(true))
    })

    test('keeps a mute made with its own control, and the next episode starts muted', async () => {
      const first = makeRemoteVideo()
      const host = play(Component, first.remote)
      await vi.waitFor(() => expect(muteControl(host)).toBeTruthy())
      muteControl(host)!.click()
      await settle()
      expect(first.video.muted).toBe(true)
      expect(kept()).toEqual({ volume: 1, muted: true })
      close()

      const next = makeRemoteVideo()
      const nextHost = play(Component, next.remote)
      await settle()
      expect(next.video.muted).toBe(true)
      await vi.waitFor(() => expect(showsMuted(nextHost)).toBe(true))
    })

    test('stops holding and keeping once the episode is closed', async () => {
      const { remote, video, setByPage } = makeRemoteVideo()
      const host = play(Component, remote)
      await vi.waitFor(() => expect(muteControl(host)).toBeTruthy())
      muteControl(host)!.click()
      await settle()
      close()
      setByPage('muted', false)
      await settle()
      expect(video.muted).toBe(false)
      expect(readPlayerVolume()).toEqual({ volume: 1, muted: true })
    })

    test('plays at its defaults, and keeps nothing, when the browser blocks site data', async () => {
      // reading `localStorage` itself throws there, rather than answering null
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
      const { remote, video } = makeRemoteVideo()
      const host = play(Component, remote)
      await settle()
      expect(video).toEqual({ volume: 1, muted: false })
      await vi.waitFor(() => expect(muteControl(host)).toBeTruthy())
      muteControl(host)!.click()
      await settle()
      expect(video.muted).toBe(true)
    })

    test('ignores a kept value that is not a volume, and starts at its defaults', async () => {
      storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 4, muted: true }))
      const { remote, video } = makeRemoteVideo()
      const host = play(Component, remote)
      await settle()
      expect(video).toEqual({ volume: 1, muted: false })
      expect(showsMuted(host)).toBe(false)
    })
  })
}

describe('rememberPlayerVolume', () => {
  test('keeps a volume written through its media, and puts it back over the page\'s', async () => {
    const { remote, video, setByPage } = makeRemoteVideo()
    const remembered = rememberPlayerVolume(remote)
    remembered.hold()
    remembered.media.volume = 0.4
    await settle()
    expect(kept()).toEqual({ volume: 0.4, muted: false })

    setByPage('volume', 1)
    await settle()
    expect(video.volume).toBe(0.4)
    expect(kept()).toEqual({ volume: 0.4, muted: false })
  })

  test('leaves the page\'s own changes alone, and keeps none of them, while the viewer has picked nothing', async () => {
    const { remote, video, setByPage } = makeRemoteVideo()
    rememberPlayerVolume(remote).hold()
    setByPage('volume', 0.2)
    setByPage('muted', true)
    await settle()
    expect(video).toEqual({ volume: 0.2, muted: true })
    expect(storage.values.has(PLAYER_VOLUME_KEY)).toBe(false)
  })

  test('holds what the viewer picked even when it cannot be kept', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
    const { remote, video, setByPage } = makeRemoteVideo()
    const remembered = rememberPlayerVolume(remote)
    remembered.hold()
    remembered.media.muted = true
    await settle()
    setByPage('muted', false)
    await settle()
    expect(video.muted).toBe(true)
  })
})

describe('a kept volume', () => {
  test.each([
    ['above 1', JSON.stringify({ volume: 1.5, muted: false })],
    ['below 0', JSON.stringify({ volume: -0.2, muted: false })],
    ['a string', JSON.stringify({ volume: '0.3', muted: false })],
    ['with no mute', JSON.stringify({ volume: 0.3 })],
    ['with a mute that is not a boolean', JSON.stringify({ volume: 0.3, muted: 'yes' })],
    ['a bare number', '0.3'],
    ['null', 'null'],
    ['not JSON', '{volume'],
  ])('%s is ignored', (_, raw) => {
    storage.values.set(PLAYER_VOLUME_KEY, raw)
    expect(readPlayerVolume()).toBeUndefined()
    const { remote } = makeRemoteVideo()
    rememberPlayerVolume(remote).hold()()
    expect(remote.volume).toBe(1)
    expect(remote.muted).toBe(false)
  })

  test('at either end of the range is used', () => {
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0, muted: false }))
    expect(readPlayerVolume()).toEqual({ volume: 0, muted: false })
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
    expect(readPlayerVolume()).toEqual({ volume: 1, muted: true })
  })
})
