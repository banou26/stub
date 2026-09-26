// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { PassThroughPictureInPicture } from '@banou/media-player'
import type { ComponentChildren } from 'preact'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { enterPictureInPictureOnClick, pressTrackButton } from '../../../../src/sources/crunchyroll/cr-page'
import { pageRealm, recordEvents } from './page-realm'

// Picture in picture on the Crunchyroll player: the page code that enters it from inside Crunchyroll's
// document, and its wiring from the frame's evaluate to @banou/media-player's opt-in, over a fake
// signed-in frame. The player itself records what it was handed.

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

// tracks, thumbnails and skip events are separate concerns, and stay unanswered here
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', () => ({
  discoverCrunchyrollTracks: () => new Promise(() => {}),
  selectCrunchyrollTrack: () => new Promise(() => {}),
}))
vi.mock('../../../../src/sources/crunchyroll/seek-thumbnails', () => ({
  loadCrunchyrollThumbnails: () => new Promise(() => {}),
}))

const player = vi.hoisted(() => ({ pictureInPicture: undefined as PassThroughPictureInPicture | undefined, renders: 0 }))
vi.mock('@banou/media-player', () => ({
  MediaPlayer: ({ pictureInPicture, children }: { pictureInPicture?: PassThroughPictureInPicture, children?: ComponentChildren }) => {
    player.pictureInPicture = pictureInPicture
    player.renders += 1
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GAAAAAAAA/one'
const NEXT_EPISODE = 'https://www.crunchyroll.com/watch/GBBBBBBBB/two'

// every load mounts a fresh video, as each goto does on the real page
const makeFrame = (install: () => Promise<unknown>) => ({
  goto: vi.fn(async () => {}),
  addStyleTag: vi.fn(async () => {}),
  locator: (selector: string) => ({
    exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
    videoElement: async () => new EventTarget(),
  }),
  evaluate: vi.fn(async (pageFunction: unknown, _arg?: unknown) => pageFunction === enterPictureInPictureOnClick ? install() : new Promise(() => {})),
})

const installs = (frame: ReturnType<typeof makeFrame>) =>
  frame.evaluate.mock.calls.filter(([pageFunction]) => pageFunction === enterPictureInPictureOnClick)

const element = (url: string, title?: string) =>
  <CrunchyrollPlayer url={url} mediaUri="" episodeUri="" sourceUri="" title={title} />

const hosts: HTMLElement[] = []
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  player.pictureInPicture = undefined
  player.renders = 0
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

const load = async (install: () => Promise<unknown>) => {
  const frame = makeFrame(install)
  lib.attachFrame.mockReset().mockResolvedValue(frame)
  const host = mount(element(EPISODE))
  hosts.push(host)
  await vi.waitFor(() => expect(installs(frame)).toHaveLength(1), { timeout: 5_000 })
  return { frame, host }
}

describe('the Crunchyroll player', () => {
  test('opts in once the page code is installed, and the opt-in reaches the media player', async () => {
    const { frame } = await load(async () => true)
    await vi.waitFor(() => expect(player.pictureInPicture).toBeDefined())
    expect(installs(frame)[0]![1]).toEqual({ video: 'video' })
  })

  test('armed, the frame takes the click; disarmed, it gives it back', async () => {
    const { host } = await load(async () => true)
    await vi.waitFor(() => expect(player.pictureInPicture).toBeDefined())
    const iframe = host.querySelector<HTMLIFrameElement>('iframe.cr-frame')!

    player.pictureInPicture!.onArmedChange(true)
    expect(iframe.style.pointerEvents).toBe('auto')
    player.pictureInPicture!.onArmedChange(false)
    // back to the stylesheet's `pointer-events: none`
    expect(iframe.style.pointerEvents).toBe('')
  })

  test('installs the page code once per loaded document, not once per render', async () => {
    const { frame, host } = await load(async () => true)
    await vi.waitFor(() => expect(player.pictureInPicture).toBeDefined())

    const renders = player.renders
    act(() => { render(element(EPISODE, 'E1 - A New Title'), host) })
    await vi.waitFor(() => expect(player.renders).toBeGreaterThan(renders))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(installs(frame)).toHaveLength(1)

    // a new episode is a new document, which the listener did not survive
    act(() => { render(element(NEXT_EPISODE), host) })
    await vi.waitFor(() => expect(installs(frame)).toHaveLength(2), { timeout: 5_000 })
  })

  // an extension older than ABI 3 refuses evaluate by name, as does a frame without the grant
  test('offers no control where evaluate is refused', async () => {
    const refusal = Object.assign(new Error('evaluate is not supported by this extension'), { name: 'ExtensionOperationUnsupportedError' })
    await load(async () => { throw refusal })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(player.renders).toBeGreaterThan(0)
    expect(player.pictureInPicture).toBeUndefined()
    expect(warn.mock.calls.flat()).toContain(refusal)
  })

  test('offers no control where the page\'s video has no picture in picture', async () => {
    await load(async () => false)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(player.renders).toBeGreaterThan(0)
    expect(player.pictureInPicture).toBeUndefined()
  })
})

// Real clicks are `isTrusted`, which nothing a page dispatches can be, so a click from the pointer is
// built here and marked as one. linkedom runs no capture phase: that this listener runs before the
// page's own is shown in a real Chrome, where the parent's pointer does the clicking.
const page = () => {
  const realm = pageRealm('<!doctype html><html><body><div class="video-player-wrapper"><video></video><button data-testid="track-selection-button"></button></div></body></html>')
  const window = realm.document.defaultView!
  const element = realm.document.querySelector('video')!
  const pointerClick = () => {
    const click = new window.Event('click', { bubbles: true, cancelable: true })
    Object.defineProperty(click, 'isTrusted', { value: true })
    element.dispatchEvent(click)
    return click
  }
  return { ...realm, window, element, pointerClick }
}

const withPictureInPicture = () => {
  const realm = page()
  const requestPictureInPicture = vi.fn(async () => {})
  Object.assign(realm.element, { requestPictureInPicture })
  return { ...realm, requestPictureInPicture }
}

describe('enterPictureInPictureOnClick', () => {
  test('a real click enters picture in picture, and goes no further', async () => {
    const { evaluate, window, requestPictureInPicture, pointerClick } = withPictureInPicture()
    expect(await evaluate(enterPictureInPictureOnClick, { video: 'video' })).toBe(true)
    const later = vi.fn()
    window.addEventListener('click', later)

    const click = pointerClick()
    expect(requestPictureInPicture).toHaveBeenCalledTimes(1)
    expect(click.defaultPrevented).toBe(true)
    expect(later).not.toHaveBeenCalled()
  })

  // the track menu is driven by clicks this module dispatches in the page
  test('clicks the page dispatches itself pass untouched', async () => {
    const { document, evaluate, requestPictureInPicture } = withPictureInPicture()
    await evaluate(enterPictureInPictureOnClick, { video: 'video' })
    const seen = recordEvents(document.querySelector('[data-testid="track-selection-button"]')!)

    await evaluate(pressTrackButton, { button: '[data-testid="track-selection-button"]', timeout: 0 })
    expect(seen.map(({ event }) => event)).toContain('MouseEvent:click')
    expect(requestPictureInPicture).not.toHaveBeenCalled()
  })

  test('answers false, installing nothing, where the video has no picture in picture', async () => {
    const { evaluate, pointerClick } = page()
    expect(await evaluate(enterPictureInPictureOnClick, { video: 'video' })).toBe(false)
    expect(pointerClick().defaultPrevented).toBe(false)
  })
})
