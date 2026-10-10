// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount } from './dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { FunctionComponent } from 'preact'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { PLAYER_VOLUME_KEY, readPlayerVolume, rememberPlayerVolume } from '../../../src/utils/player-volume'

// Both of stub's episode players, mounted for real over a fake remote video: stub's own videojs skin
// (Netflix) and @banou/media-player (Crunchyroll). Each must start an episode at the volume and mute
// the viewer last left a player at, and play exactly as before when storage is blocked or holds junk.

// @banou/media-player's two CommonJS dependencies cannot reach the react alias under node (see
// vitest.config.ts), and neither draws anything this test reads
vi.mock('react-feather', () => Object.fromEntries(
  ['AlertTriangle', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

const { default: Player } = await import('../../../src/components/player')
const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')

type FakeVideo = RemoteVideoElement & { volumeChanges: number }

type Listener = (event: { type: string }) => void

// a video element's volume and mute as @fkn/lib's handle on one has them: own accessors, and a
// `volumechange` queued as a later task on every write, the way a real element fires it. Its own
// listener list, since ./dom swaps the global Event for linkedom's, which node's EventTarget refuses,
// and linkedom's target ignores the `signal` a player store detaches with.
const makeRemote = (): FakeVideo => {
  const listeners = new Map<string, Set<Listener>>()
  const off = (type: string, listener: Listener) => { listeners.get(type)?.delete(listener) }
  const on = (type: string, listener: Listener, options?: { signal?: AbortSignal }) => {
    if (!listeners.has(type)) listeners.set(type, new Set())
    listeners.get(type)!.add(listener)
    options?.signal?.addEventListener('abort', () => off(type, listener))
  }
  let volume = 1
  let muted = false
  const changed = () => setTimeout(() => {
    fake.volumeChanges++
    for (const listener of listeners.get('volumechange') ?? []) listener({ type: 'volumechange' })
  }, 0)
  const fake = Object.defineProperties({
    volumeChanges: 0,
    currentTime: 0, duration: 1_440, paused: true, readyState: 4, seeking: false, playbackRate: 1,
    play: async () => {}, pause: () => {},
    addEventListener: on, removeEventListener: off, dispatchEvent: () => true,
  }, {
    volume: { configurable: true, enumerable: true, get: () => volume, set: (value: number) => { volume = value; changed() } },
    muted: { configurable: true, enumerable: true, get: () => muted, set: (value: boolean) => { muted = value; changed() } },
  }) as unknown as FakeVideo
  return fake
}

const frame = { locator: () => ({ fill: async () => {} }) } as unknown as Frame

type PlayerUnderTest = {
  name: string
  Component: FunctionComponent<{ remote: RemoteVideoElement | null, frame: Frame | null }>
  /** Whether the player's own mute control reads as muted, which is the store having read the media. */
  showsMuted: (host: HTMLElement) => boolean
}

const PLAYERS: PlayerUnderTest[] = [
  {
    name: "stub's own videojs player (Netflix)",
    Component: Player,
    showsMuted: host => host.querySelector('.media-button--mute')?.getAttribute('aria-label') === 'Unmute',
  },
  {
    name: '@banou/media-player (Crunchyroll)',
    Component: CrunchyrollVideoJSPlayer,
    showsMuted: host => host.querySelector('button.sound')?.getAttribute('aria-pressed') === 'true',
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
// every queued `volumechange` has been delivered
const settle = () => new Promise(resolve => setTimeout(resolve, 10))

let storage: ReturnType<typeof memoryStorage>
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
})
afterEach(() => {
  close()
  vi.unstubAllGlobals()
})

for (const { name, Component, showsMuted } of PLAYERS) {
  describe(name, () => {
    test('starts the next episode at the volume and mute the last one was left at', async () => {
      const first = makeRemote()
      play(Component, first)
      await settle()
      first.volume = 0.3
      first.muted = true
      await settle()
      close()

      const next = makeRemote()
      const host = play(Component, next)
      expect(next.volume).toBe(0.3)
      expect(next.muted).toBe(true)
      expect(JSON.parse(storage.values.get(PLAYER_VOLUME_KEY)!)).toEqual({ volume: 0.3, muted: true })
      await vi.waitFor(() => expect(showsMuted(host), 'the mute control shows it').toBe(true))
    })

    test('stops keeping changes once the episode is closed', async () => {
      const first = makeRemote()
      play(Component, first)
      await settle()
      first.volume = 0.6
      await settle()
      close()
      first.volume = 0.1
      await settle()
      expect(readPlayerVolume()).toEqual({ volume: 0.6, muted: false })
    })

    test('plays at its defaults, and keeps nothing, when the browser blocks site data', async () => {
      // reading `localStorage` itself throws there, rather than answering null
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
      const remote = makeRemote()
      const host = play(Component, remote)
      await settle()
      expect(remote.volume).toBe(1)
      expect(remote.muted).toBe(false)
      remote.volume = 0.3
      await settle()
      expect(remote.volumeChanges).toBeGreaterThan(0)
      expect(host.childElementCount).toBeGreaterThan(0)
    })

    test('ignores a kept value that is not a volume, and starts at its defaults', async () => {
      storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 4, muted: true }))
      const remote = makeRemote()
      const host = play(Component, remote)
      expect(remote.volume).toBe(1)
      expect(remote.muted).toBe(false)
      await settle()
      expect(showsMuted(host)).toBe(false)
    })
  })
}

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
    const media = makeRemote()
    rememberPlayerVolume(media)()
    expect(media.volume).toBe(1)
    expect(media.muted).toBe(false)
  })

  test('at either end of the range is used', () => {
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0, muted: false }))
    expect(readPlayerVolume()).toEqual({ volume: 0, muted: false })
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
    expect(readPlayerVolume()).toEqual({ volume: 1, muted: true })
  })
})
