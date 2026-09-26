// FIRST: ../../components/dom installs the document @emotion/react reads at module scope
import { mount, unmount } from '../../components/dom'

import type { ExternalThumbnails } from '@banou/media-player'
import type { ComponentChildren } from 'preact'

import { render } from 'preact'
import { act } from 'preact/test-utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { readCrunchyrollBif } from '../../../../src/sources/crunchyroll/read-bif'
import { buildBif } from './bif-fixture'

// The seek thumbnails' wiring in the Crunchyroll player, against a fake signed-in frame whose
// evaluate stands in for the page. The skin is replaced by a stub that records what it was handed.

const lib = vi.hoisted(() => ({ attachFrame: vi.fn() }))
vi.mock('@fkn/lib', async importOriginal => ({
  ...await importOriginal<typeof import('@fkn/lib')>(),
  attachFrame: lib.attachFrame,
  isExtensionExposed: () => false,
}))

// the track menus are a separate concern, answered at once so their retries stay out of the way
vi.mock('../../../../src/sources/crunchyroll/cr-native-controls', () => ({
  discoverCrunchyrollTracks: async () => ({
    audio: { options: [], selectedId: null },
    subtitles: { options: [], selectedId: null },
  }),
  selectCrunchyrollTrack: async () => ({}),
}))

// the skip events are a separate concern, and stay unanswered here
vi.mock('../../../../src/utils/fetch', () => ({ fetch: () => new Promise(() => {}) }))

// picture in picture evaluates in the page too, and is a separate concern that would add to the count
vi.mock('../../../../src/sources/crunchyroll/picture-in-picture', () => ({ useCrunchyrollPictureInPicture: () => undefined }))

const skin = vi.hoisted(() => ({ thumbnails: undefined as ExternalThumbnails | undefined }))
vi.mock('../../../../src/sources/crunchyroll/cr-videojs-player', () => ({
  default: ({ thumbnails, children }: { thumbnails?: ExternalThumbnails, children?: ComponentChildren }) => {
    skin.thumbnails = thumbnails
    return <div className="skin">{children}</div>
  },
}))

const { default: CrunchyrollPlayer } = await import('../../../../src/sources/crunchyroll/player')

const EPISODE = 'https://www.crunchyroll.com/watch/GAAAAAAAA/one'
const NEXT_EPISODE = 'https://www.crunchyroll.com/watch/GBBBBBBBB/two'

// signed in, and every load mounts a fresh video, as each goto does on the real page. The handle is
// an event target, as the real one is
const makeFrame = (evaluate: (...args: unknown[]) => Promise<unknown>) => ({
  goto: vi.fn(async () => {}),
  addStyleTag: vi.fn(async () => {}),
  locator: (selector: string) => ({
    exists: async () => selector === '#user-menu-authenticated' || selector === 'video',
    videoElement: async () => Object.assign(new EventTarget(), { loaded: selector }),
  }),
  evaluate: vi.fn(evaluate),
})

const element = (url: string) => <CrunchyrollPlayer url={url} mediaUri="" episodeUri="" sourceUri="" />

const THREE_FRAMES = { bytes: buildBif({ timestamps: [10_000, 20_000, 30_000] }), via: 'named' }

const hosts: HTMLElement[] = []
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' })
  skin.thumbnails = undefined
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  while (hosts.length) unmount(hosts.pop()!)
  vi.restoreAllMocks()
})

describe('seek thumbnails', () => {
  test('are read once per loaded episode, and each episode\'s image urls are revoked when it goes', async () => {
    const frame = makeFrame(async () => THREE_FRAMES)
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const host = mount(element(EPISODE))
    hosts.push(host)

    await vi.waitFor(() => expect(skin.thumbnails).toBeDefined(), { timeout: 5_000 })
    expect(frame.evaluate).toHaveBeenCalledTimes(1)
    expect(frame.evaluate.mock.calls[0]![0]).toBe(readCrunchyrollBif)
    const first = skin.thumbnails!.at(25)!
    expect(first).toMatchObject({ startTime: 20, endTime: 30 })
    // re-renders (the track menus landing among them) do not read it again
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(frame.evaluate).toHaveBeenCalledTimes(1)

    act(() => { render(element(NEXT_EPISODE), host) })
    await vi.waitFor(() => expect(frame.evaluate).toHaveBeenCalledTimes(2), { timeout: 5_000 })
    expect(revoke).toHaveBeenCalledWith(first.url)
    await vi.waitFor(() => expect(skin.thumbnails?.at(25)).toBeDefined())
    const second = skin.thumbnails!.at(25)!
    expect(second.url).not.toBe(first.url)

    unmount(hosts.pop()!)
    expect(revoke).toHaveBeenCalledWith(second.url)
  })

  // an extension older than ABI 3 refuses evaluate by name, as does a frame without the grant
  test('a refused evaluate leaves the preview with the time only: no error, one warning', async () => {
    const refusal = Object.assign(new Error('evaluate is not supported by this extension'), { name: 'ExtensionOperationUnsupportedError' })
    const frame = makeFrame(async () => { throw refusal })
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    const host = mount(element(EPISODE))
    hosts.push(host)

    await vi.waitFor(() => expect(frame.evaluate).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(skin.thumbnails).toBeUndefined()
    expect(host.querySelector('.overlay')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]).toContain(refusal)
  })

  test('a page with no BIF is the same', async () => {
    const frame = makeFrame(async () => ({ none: 'no-bif' }))
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    const host = mount(element(EPISODE))
    hosts.push(host)

    await vi.waitFor(() => expect(frame.evaluate).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(skin.thumbnails).toBeUndefined()
    expect(host.querySelector('.overlay')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![1])).toContain('no-bif')
  })

  // one read can take about 25 s on the real page (10 s for the player, 15 s for the fetch), so a
  // quick episode switch lands while it is still out. Episode 1's read is held until episode 2 shows
  const switchPastHeldRead = async () => {
    const held = Promise.withResolvers<unknown>()
    let calls = 0
    const frame = makeFrame(async () => ++calls === 1 ? held.promise : THREE_FRAMES)
    lib.attachFrame.mockReset().mockResolvedValue(frame)
    const host = mount(element(EPISODE))
    hosts.push(host)
    await vi.waitFor(() => expect(frame.evaluate).toHaveBeenCalledTimes(1), { timeout: 5_000 })
    act(() => { render(element(NEXT_EPISODE), host) })
    await vi.waitFor(() => expect(skin.thumbnails).toBeDefined(), { timeout: 5_000 })
    expect(frame.evaluate).toHaveBeenCalledTimes(2)
    return held
  }

  test('a read that settles after its episode has gone is not shown on the next one', async () => {
    const held = await switchPastHeldRead()
    held.resolve({ bytes: buildBif({ timestamps: [1_000, 2_000] }), via: 'named' })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(skin.thumbnails!.at(25)).toMatchObject({ startTime: 20, endTime: 30 })
  })

  test('and its failure does not warn about the episode that replaced it', async () => {
    const held = await switchPastHeldRead()
    held.reject(new Error('evaluate timed out'))
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(warn).not.toHaveBeenCalled()
  })
})
