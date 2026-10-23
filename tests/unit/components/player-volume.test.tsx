// FIRST: ./dom installs the document @emotion/react reads at module scope.
import { mount, unmount, withIntl } from './dom'

import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { FunctionComponent } from 'preact'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { PLAYER_VOLUME_KEY, keepVideoVolume, readPlayerVolume, rememberPlayerVolume } from '../../../src/utils/player-volume'
import { makeRemoteVideo, settle } from './remote-video'

// Both of stub's episode players, mounted for real over a fake remote video: stub's own videojs skin
// (Netflix, bare and with its seek adapter) and @banou/media-player (Crunchyroll, Prime Video). Each
// must start an episode at the volume and mute the viewer last left a player at, hold it against the
// page behind the video, keep only what the viewer changes (never what the watch party writes), and
// play exactly as before when storage is blocked or holds junk.

// @banou/media-player's two CommonJS dependencies cannot reach the react alias under node (see
// vitest.config.ts), and neither draws anything this test reads
vi.mock('lucide-react', () => Object.fromEntries(
  ['Captions', 'CaptionsOff', 'Check', 'ChevronLeft', 'ChevronRight', 'Copy', 'Maximize', 'Minimize', 'Pause', 'Play', 'RotateCcw', 'Settings', 'TriangleAlert', 'Volume1', 'Volume2', 'VolumeX']
    .map(name => [name, () => null]),
))
vi.mock('react-tooltip', () => ({ Tooltip: () => null }))

// What each player serves to the watch page that frames it, whose playback sync drives it through
// this channel. Also the module `<MediaPlayer expose>` loads, so it catches what that prop serves.
type Served = { volume: number, muted: boolean, currentTime: number }
const party = vi.hoisted(() => ({ served: null as Served | null }))
vi.mock('@banou/media-player/remote', () => ({
  exposePlayer: (media: Served) => {
    party.served = media
    return () => { if (party.served === media) party.served = null }
  },
}))

const { default: Player } = await import('../../../src/components/player')
const { default: NetflixVideoJSPlayer } = await import('../../../src/sources/unogs/nf-videojs-player')
const { default: CrunchyrollVideoJSPlayer } = await import('../../../src/sources/crunchyroll/cr-videojs-player')
const { default: PrimeMediaPlayer } = await import('../../../src/sources/amazon/prime-media-player')

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
  {
    name: '@banou/media-player (Prime Video)',
    Component: props => <PrimeMediaPlayer {...props} video={{ video: '#dv-web-player video', index: 0 }} />,
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
const play = (Component: FunctionComponent<{ remote: RemoteVideoElement | null, frame: Frame | null }>, remote: RemoteVideoElement, inFrame = frame) => {
  const host = mount(withIntl(<Component remote={remote} frame={inFrame}/>))
  hosts.push(host)
  return host
}
const close = () => { while (hosts.length) unmount(hosts.pop()!) }

let storage: ReturnType<typeof memoryStorage>
const kept = () => JSON.parse(storage.values.get(PLAYER_VOLUME_KEY) ?? 'null')
beforeEach(() => {
  storage = memoryStorage()
  vi.stubGlobal('localStorage', storage)
  party.served = null
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
      await vi.waitFor(() => expect(video.muted, 'the video is muted again').toBe(true))
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

    test('holds a volume and mute the watch party writes for the episode, and keeps none of it', async () => {
      storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0.5, muted: false }))
      const { remote, video } = makeRemoteVideo()
      const host = play(Component, remote)
      await vi.waitFor(() => expect(party.served, 'the player is served to the watch page').toBeTruthy())
      await vi.waitFor(() => expect(video.volume, 'the kept volume reached the video').toBe(0.5))

      party.served!.volume = 0.2
      // the party's autoplay, for a follower whose browser refuses to start the sound
      party.served!.muted = true
      await settle()

      expect(video, 'the follower plays as the party set it, and the kept volume does not undo it').toEqual({ volume: 0.2, muted: true })
      expect(kept(), 'the next episode starts as the viewer left it').toEqual({ volume: 0.5, muted: false })
      await vi.waitFor(() => expect(showsMuted(host)).toBe(true))
    })

    test('keeps the viewer\'s own mute made after the watch party wrote one', async () => {
      const { remote, video } = makeRemoteVideo()
      const host = play(Component, remote)
      await vi.waitFor(() => expect(party.served).toBeTruthy())
      party.served!.muted = true
      await settle()
      expect(kept()).toBeNull()
      await vi.waitFor(() => expect(showsMuted(host)).toBe(true))

      muteControl(host)!.click()
      await settle()
      expect(kept(), 'the viewer\'s unmute').toEqual({ volume: 1, muted: false })
      muteControl(host)!.click()
      await settle()

      expect(video.muted).toBe(true)
      expect(kept(), 'the viewer\'s mute').toEqual({ volume: 1, muted: true })
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

describe('a seek the watch party writes', () => {
  test('moves Crunchyroll\'s own scrubber, as its controls do', async () => {
    const { remote } = makeRemoteVideo()
    const evaluate = vi.fn(async () => {})
    play(CrunchyrollVideoJSPlayer, remote, { ...frame, evaluate } as unknown as Frame)
    await vi.waitFor(() => expect(party.served).toBeTruthy())

    party.served!.currentTime = 100

    expect(evaluate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ time: 100 }))
    expect(remote.currentTime).toBe(100)
  })

  test('goes through Netflix\'s timeline rather than a write on its video, as its controls do', async () => {
    const { remote } = makeRemoteVideo()
    play(NetflixVideoJSPlayer, remote)
    await vi.waitFor(() => expect(party.served).toBeTruthy())

    party.served!.currentTime = 100

    expect(party.served!.currentTime, 'the seek is taken').toBe(100)
    expect(remote.currentTime).toBe(0)
  })
})

describe('rememberPlayerVolume', () => {
  test('keeps a volume written through its media, and puts it back over the page\'s', async () => {
    const { remote, video, setByPage } = makeRemoteVideo()
    const remembered = rememberPlayerVolume(remote)
    remembered.hold()
    remembered.media.volume = 0.4
    await settle()
    expect(kept()).toEqual({ volume: 0.4, muted: false })

    setByPage('volume', 1)
    await vi.waitFor(() => expect(video.volume).toBe(0.4))
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
    await vi.waitFor(() => expect(video.muted).toBe(true))
  })
})

// a video stub owns behaves as the handle's does here: a write lands, and `volumechange` follows as a later task
const ownVideo = () => {
  const { remote, video } = makeRemoteVideo()
  return { element: remote as unknown as HTMLMediaElement, video }
}

describe('keepVideoVolume', () => {
  test('starts a video at the kept volume and mute, and keeps every change to it until stopped', async () => {
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0.3, muted: true }))
    const { element, video } = ownVideo()
    const stop = keepVideoVolume(element)
    await settle()
    expect(video).toEqual({ volume: 0.3, muted: true })

    element.muted = false
    await vi.waitFor(() => expect(kept()).toEqual({ volume: 0.3, muted: false }))

    stop()
    element.volume = 0.8
    await settle()
    expect(kept()).toEqual({ volume: 0.3, muted: false })
  })

  test('keeps nothing until the video changes, so a theme never stands for a pick on an episode', async () => {
    keepVideoVolume(ownVideo().element)
    await settle()
    expect(storage.values.has(PLAYER_VOLUME_KEY)).toBe(false)
  })

  test('plays at its defaults when the browser blocks site data', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new DOMException('blocked', 'SecurityError') } })
    const { element, video } = ownVideo()
    keepVideoVolume(element)
    element.muted = true
    await settle()
    expect(video).toEqual({ volume: 1, muted: true })
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
    const own = ownVideo()
    keepVideoVolume(own.element)()
    expect(own.element.volume).toBe(1)
    expect(own.element.muted).toBe(false)
  })

  test('at either end of the range is used', () => {
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 0, muted: false }))
    expect(readPlayerVolume()).toEqual({ volume: 0, muted: false })
    storage.values.set(PLAYER_VOLUME_KEY, JSON.stringify({ volume: 1, muted: true }))
    expect(readPlayerVolume()).toEqual({ volume: 1, muted: true })
  })
})
