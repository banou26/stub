// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { MediaChapter } from '@banou/media-player'
import type { ComponentChildren } from 'preact'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { skipEventsToChapters, skipEventsUrl } from '../../../../src/sources/crunchyroll/skip-events'
import { CREDITS_ONLY, EVERY_EVENT } from './skip-events-fixture'

// The skip events' wiring in the Crunchyroll player, against a fake signed-in frame and a fake relay.
// The skin is replaced by a stub that records the chapters it was handed.

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

const relay = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../../../src/utils/fetch', () => ({ fetch: relay.fetch }))

// tracks and thumbnails are separate concerns: answered at once, and never
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', () => ({
  discoverCrunchyrollTracks: async () => ({
    audio: { options: [], selectedId: null },
    subtitles: { options: [], selectedId: null },
  }),
  selectCrunchyrollTrack: async () => ({}),
}))
vi.mock('../../../../src/sources/crunchyroll/seek-thumbnails', () => ({
  loadCrunchyrollThumbnails: () => new Promise(() => {}),
}))

const skin = vi.hoisted(() => ({ chapters: undefined as MediaChapter[] | undefined }))
vi.mock('../../../../src/sources/crunchyroll/cr-videojs-player', () => ({
  default: ({ chapters, children }: { chapters?: MediaChapter[], children?: ComponentChildren }) => {
    skin.chapters = chapters
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GAAAAAAAA/one'
const NEXT_EPISODE = 'https://www.crunchyroll.com/watch/GBBBBBBBB/two'
const DURATION = 1_770

// the handle's listener surface, with a way to fire its media events
const makeVideo = (duration: number) => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    duration,
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener))
    },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener) },
    fire: (type: string) => { for (const listener of listeners.get(type) ?? []) listener() },
  }
}

// signed in, and every load mounts a fresh video that knows its duration, as the real handle does
const makeFrame = (duration = DURATION) => {
  const videos: ReturnType<typeof makeVideo>[] = []
  return {
    videos,
    goto: vi.fn(async () => {}),
    addStyleTag: vi.fn(async () => {}),
    locator: (selector: string) => ({
      exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
      videoElement: async () => {
        const video = makeVideo(duration)
        videos.push(video)
        return video
      },
    }),
  }
}

const element = (url: string) => <CrunchyrollPlayer url={url} mediaUri="" episodeUri="" sourceUri="" />
const answer = (events: unknown) => new Response(JSON.stringify(events))

const hosts: HTMLElement[] = []
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  skin.chapters = undefined
  relay.fetch.mockReset()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

const show = (url: string) => {
  const host = mount(element(url))
  hosts.push(host)
  return host
}

describe('skip events', () => {
  test('are fetched once per episode, from its own file, and reach the player as chapters', async () => {
    const frame = makeFrame()
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    const next = Promise.withResolvers<Response>()
    relay.fetch
      .mockResolvedValueOnce(answer(CREDITS_ONLY))
      .mockReturnValueOnce(next.promise)
    const host = show(EPISODE)

    await vi.waitFor(() => expect(skin.chapters).toEqual(skipEventsToChapters(CREDITS_ONLY, DURATION)), { timeout: 5_000 })
    expect(relay.fetch).toHaveBeenCalledTimes(1)
    expect(relay.fetch.mock.calls[0]![0]).toBe(skipEventsUrl('GAAAAAAAA'))
    // a render of the same episode asks nothing more
    act(() => { render(element(EPISODE), host) })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(relay.fetch).toHaveBeenCalledTimes(1)

    // the next episode asks its own file, and shows none of the last one's while it does
    act(() => { render(element(NEXT_EPISODE), host) })
    expect(skin.chapters).toEqual([])
    await vi.waitFor(() => expect(relay.fetch).toHaveBeenCalledTimes(2))
    expect(relay.fetch.mock.calls[1]![0]).toBe(skipEventsUrl('GBBBBBBBB'))
    next.resolve(answer(EVERY_EVENT))
    await vi.waitFor(() => expect(skin.chapters).toEqual(skipEventsToChapters(EVERY_EVENT, DURATION)))
  })

  test('the tail is added once the video reports its duration', async () => {
    const frame = makeFrame(Number.NaN)
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    relay.fetch.mockResolvedValue(answer(CREDITS_ONLY))
    show(EPISODE)

    await vi.waitFor(() => expect(frame.videos).toHaveLength(1), { timeout: 5_000 })
    await vi.waitFor(() => expect(skin.chapters).toEqual(skipEventsToChapters(CREDITS_ONLY)))
    const [video] = frame.videos
    video!.duration = DURATION
    act(() => { video!.fire('durationchange') })
    await vi.waitFor(() => expect(skin.chapters).toEqual(skipEventsToChapters(CREDITS_ONLY, DURATION)))
    expect(skin.chapters!.at(-1)).toEqual({ start: 1767, end: DURATION, title: 'Episode' })
  })

  test('an answer that lands after its episode has gone is not shown on the next one', async () => {
    lib.attachFrame.mockReset().mockResolvedValue(makeFrame())
    const first = Promise.withResolvers<Response>()
    relay.fetch
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(answer(EVERY_EVENT))
    const host = show(EPISODE)
    await vi.waitFor(() => expect(relay.fetch).toHaveBeenCalledTimes(1), { timeout: 5_000 })

    act(() => { render(element(NEXT_EPISODE), host) })
    await vi.waitFor(() => expect(skin.chapters).toEqual(skipEventsToChapters(EVERY_EVENT, DURATION)), { timeout: 5_000 })
    first.resolve(answer(CREDITS_ONLY))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(skin.chapters).toEqual(skipEventsToChapters(EVERY_EVENT, DURATION))
  })

  test.each([
    ['a refused request', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an error status', async () => new Response('<h1>unavailable</h1>', { status: 500 })],
    ['a body that is not JSON', async () => new Response('<html>')],
  ])('%s leaves no chapters, one warning, and the episode playing', async (_, fails) => {
    lib.attachFrame.mockReset().mockResolvedValue(makeFrame())
    relay.fetch.mockImplementation(fails)
    const host = show(EPISODE)

    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe('[cr] skip events unavailable:')
    expect(skin.chapters).toEqual([])
    expect(host.querySelector('.overlay')).toBeNull()
  })

  test('an episode with no skip file (the bucket answers 403) has no chapters and no warning', async () => {
    lib.attachFrame.mockReset().mockResolvedValue(makeFrame())
    relay.fetch.mockImplementation(async () => new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }))
    show(EPISODE)

    await vi.waitFor(() => expect(relay.fetch).toHaveBeenCalled(), { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(warn).not.toHaveBeenCalled()
    expect(skin.chapters).toEqual([])
  })

  test('a url with no episode id asks for nothing', async () => {
    lib.attachFrame.mockReset().mockResolvedValue(makeFrame())
    show('https://www.crunchyroll.com/series/GRGGPG93R/a-show')
    await vi.waitFor(() => expect(lib.attachFrame).toHaveBeenCalled(), { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(relay.fetch).not.toHaveBeenCalled()
    expect(skin.chapters).toEqual([])
  })
})
