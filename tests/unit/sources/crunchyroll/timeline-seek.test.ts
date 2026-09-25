import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { describe, expect, test, vi } from 'vite-plus/test'

import { seekTimeline } from '../../../../src/sources/crunchyroll/cr-page'
import { withTimelineSeek } from '../../../../src/sources/crunchyroll/timeline-seek'
import { pageRealm } from './page-realm'

/**
 * The one genuinely new mechanism in the Crunchyroll player, and the only part of it a unit test can
 * reach: everything else needs a logged-in session and a real Bitmovin player.
 *
 * A bare `video.currentTime = t` only lands inside the range Bitmovin has already buffered, so a seek
 * past it silently hangs. Every write is mirrored onto Crunchyroll's own `.timeline-slider` instead,
 * and the mirror has to survive whatever wraps the media on the way through the player's store.
 *
 * The mirror is page code run with `frame.evaluate`, the one grant the player asks for. The frame here
 * runs it against a page holding the scrubber, and has no locator at all: a `fill` would need
 * Interaction, which the player no longer asks for.
 */
const makeFrame = () => {
  const realm = pageRealm('<!doctype html><html><body><input class="timeline-slider" type="range" min="0" max="1200" value="0"></body></html>')
  const slider = realm.document.querySelector<HTMLInputElement>('.timeline-slider')!
  const evaluate = vi.fn(realm.evaluate)
  return { frame: { evaluate } as unknown as Frame, evaluate, slider }
}

/**
 * Shaped like the real handle in the one way that matters here: `addEventListener` and friends are
 * OWN closures rather than the inherited EventTarget methods (see fkn/web-extension's
 * src/lib/revivables/video.ts). A native method reached through the Proxy would be invoked with the
 * proxy as `this`, fail its internal-slot check and throw "Illegal invocation", which would leave
 * the whole chrome deaf to the media's events.
 */
const makeRemote = () => {
  const target = new EventTarget()
  Object.defineProperties(target, {
    addEventListener: { configurable: true, value: target.addEventListener.bind(target) },
    removeEventListener: { configurable: true, value: target.removeEventListener.bind(target) },
    dispatchEvent: { configurable: true, value: target.dispatchEvent.bind(target) },
  })
  return Object.assign(target, {
    currentTime: 0,
    duration: 1200,
    paused: true,
    volume: 1,
  }) as unknown as RemoteVideoElement
}

describe('withTimelineSeek', () => {
  test('mirrors a currentTime write onto Crunchyroll\'s own scrubber, as page code', async () => {
    const { frame, evaluate, slider } = makeFrame()
    const media = withTimelineSeek(makeRemote(), frame)

    media.currentTime = 900

    // the slider's max is the duration in seconds, so the value goes across as plain seconds
    await vi.waitFor(() => expect(slider.value).toBe('900'))
    expect(evaluate).toHaveBeenCalledWith(seekTimeline, expect.objectContaining({ timeline: '.timeline-slider', time: 900 }))
  })

  test('still performs the underlying write, rather than replacing it', () => {
    const { frame } = makeFrame()
    const remote = makeRemote()
    const media = withTimelineSeek(remote, frame)

    media.currentTime = 42

    // Bitmovin does honour a write inside the buffered range, and it is what the chrome reads back
    // to render the playhead, so intercepting must not mean swallowing.
    expect(remote.currentTime).toBe(42)
    expect(media.currentTime).toBe(42)
  })

  test('leaves every other property write alone', () => {
    const { frame, evaluate } = makeFrame()
    const remote = makeRemote()
    const media = withTimelineSeek(remote, frame)

    media.volume = 0.5

    expect(evaluate).not.toHaveBeenCalled()
    expect(remote.volume).toBe(0.5)
  })

  test('ignores a currentTime that is not a finite number', () => {
    const { frame, evaluate } = makeFrame()
    const media = withTimelineSeek(makeRemote(), frame)

    // the seek would stringify these into a value the slider cannot parse, and land somewhere
    // arbitrary rather than failing
    media.currentTime = NaN
    media.currentTime = Infinity

    expect(evaluate).not.toHaveBeenCalled()
  })

  test('does not break the media\'s own event plumbing', () => {
    const { frame } = makeFrame()
    const remote = makeRemote()
    const media = withTimelineSeek(remote, frame)

    const seen: string[] = []
    // through the proxy, which is how the player's store subscribes
    expect(() => media.addEventListener('timeupdate', () => seen.push('timeupdate'))).not.toThrow()
    remote.dispatchEvent(new Event('timeupdate'))

    expect(seen).toEqual(['timeupdate'])
  })

  test('a rejected seek does not escape as an unhandled rejection', async () => {
    const frame = { evaluate: () => Promise.reject(new Error('the frame is gone')) } as unknown as Frame
    const media = withTimelineSeek(makeRemote(), frame)

    // the write is synchronous and the mirror is not, so a failure has nowhere to be awaited
    expect(() => { media.currentTime = 900 }).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})
