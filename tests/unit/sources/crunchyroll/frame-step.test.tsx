// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount, withIntl } from '../../components/dom'

import type { RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren } from 'preact'

import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { seekTimeline } from '../../../../src/sources/crunchyroll/cr-page'
import { stepVideoFrame, watchVideoFrames } from '../../../../src/sources/frame-step-page'
import { makeRemoteVideo } from '../../components/remote-video'
import { pageVideo } from '../page-video'
import { pageRealm } from './page-realm'

// "<" and ">" on a Crunchyroll episode: the player hands @banou/media-player a `stepFrame` that steps
// Crunchyroll's video inside its own page, over a fake signed-in frame whose page code runs in a page
// realm holding the video and Crunchyroll's scrubber, a range input whose step is 0.25 s.

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

// tracks, thumbnails and skip events are separate concerns, and stay unanswered here
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', async importOriginal => ({
  ...await importOriginal<typeof import('../../../../src/sources/crunchyroll/cr-native-controls')>(),
  discoverCrunchyrollTracks: () => new Promise(() => {}),
  selectCrunchyrollTrack: () => new Promise(() => {}),
}))
vi.mock('../../../../src/sources/crunchyroll/seek-thumbnails', () => ({
  loadCrunchyrollThumbnails: () => new Promise(() => {}),
}))

const player = vi.hoisted(() => ({ stepFrame: undefined as ((direction: 1 | -1) => Promise<void>) | undefined, media: null as RemoteVideoElement | null }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({ stepFrame, media, children }: { stepFrame?: (direction: 1 | -1) => Promise<void>, media: RemoteVideoElement | null, children?: ComponentChildren }) => {
    player.stepFrame = stepFrame
    player.media = media
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GAAAAAAAA/one'
const FILM = 1001 / 24000

const hosts: HTMLElement[] = []

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  player.stepFrame = undefined
  player.media = null
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

const load = async () => {
  const realm = pageRealm('<!doctype html><html><body><video></video><input class="timeline-slider" type="range" min="0" max="1440" step="0.25" value="600"></body></html>')
  const video = pageVideo(realm.document.querySelector('video')!, { currentTime: 600 })
  const slider = realm.document.querySelector<HTMLInputElement>('.timeline-slider')!
  const ran = [watchVideoFrames, stepVideoFrame, seekTimeline] as unknown[]
  const frame = {
    goto: vi.fn(async () => {}),
    addStyleTag: vi.fn(async () => {}),
    locator: (selector: string) => ({
      exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
      videoElement: async () => makeRemoteVideo().remote,
    }),
    evaluate: vi.fn(async (pageFunction: unknown, arg?: unknown) =>
      ran.includes(pageFunction) ? realm.evaluate(pageFunction as (arg: unknown) => unknown, arg) : new Promise(() => {})),
  }
  lib.attachFrame.mockReset().mockResolvedValue(frame)
  hosts.push(mount(withIntl(<CrunchyrollPlayer url={EPISODE} mediaUri="" episodeUri="" sourceUri="" />)))
  await vi.waitFor(() => expect(player.stepFrame).toBeDefined(), { timeout: 5_000 })
  return { frame, video, slider }
}

const calls = (frame: Awaited<ReturnType<typeof load>>['frame'], pageFunction: unknown) =>
  frame.evaluate.mock.calls.filter(([called]) => called === pageFunction)

describe('frame steps on Crunchyroll', () => {
  test('follow the frames of the video the player was handed', async () => {
    const { frame } = await load()
    await vi.waitFor(() => expect(calls(frame, watchVideoFrames)).toHaveLength(1))
    expect(calls(frame, watchVideoFrames)[0]![1]).toEqual({ video: 'video' })
  })

  test('move Crunchyroll\'s video one frame each way and leave its scrubber alone', async () => {
    const { frame, video, slider } = await load()
    await vi.waitFor(() => expect(video.callbacks).toHaveLength(1))
    await player.stepFrame!(1)
    await player.stepFrame!(-1)
    expect(video.writes[0]).toBeCloseTo(600 + FILM, 9)
    expect(video.writes[1]).toBeCloseTo(600, 9)
    expect(calls(frame, seekTimeline), 'a step went through the scrubber').toEqual([])
    expect(slider.value).toBe('600')
  })
})
