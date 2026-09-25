import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { seekCrunchyrollTimeline } from './cr-native-controls'

// a bare `video.currentTime` setter only lands inside Bitmovin's already-buffered range, so writes are replayed onto `.timeline-slider`, a native `<input type="range">` whose `max` is the duration in seconds
const seekViaTimeline = (frame: Frame, value: number) => {
  seekCrunchyrollTimeline(frame, value)
    .catch(err => console.warn('[cr] timeline seek failed:', err))
}

/**
 * The video handle, with every `currentTime` write mirrored onto Crunchyroll's own scrubber.
 *
 * Lives in a module of its own, with no React in it, because it is the one genuinely new mechanism in
 * the player and the only part of it a unit test can reach. Anything importing the player components
 * pulls a CommonJS `require('react')` that `resolve.alias` cannot intercept (see `vitest.config.ts`),
 * so a test that reached this through the component tree could not run at all.
 *
 * @fkn/lib's RemoteVideoElement already satisfies video.js v10's structural media contract, so the
 * proxy adds a side effect and changes nothing about the shape.
 */
export const withTimelineSeek = (remote: RemoteVideoElement, frame: Frame) =>
  new Proxy(remote, {
    set(target, prop, value, receiver) {
      if (prop === 'currentTime' && typeof value === 'number' && Number.isFinite(value)) {
        seekViaTimeline(frame, value)
      }
      return Reflect.set(target, prop, value, receiver)
    },
  })
