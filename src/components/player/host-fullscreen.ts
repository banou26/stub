import type { MediaFullscreenState } from '@videojs/media'

import { definePlayerFeature, fullscreenFeature, videoFeatures } from '@videojs/core/dom'

import { watchHostFullscreen } from '../../embed-fullscreen'

type State = MediaFullscreenState & { hostRequest?: () => void }

/**
 * video.js's fullscreen, handed to the page that frames the embed once that page says it keeps it (../../embed-fullscreen.ts):
 * the button, `f` and a double tap then each ask the page once, within the press, and show the page's state. The
 * player's own fullscreen until then.
 */
const hostFullscreenFeature = definePlayerFeature<State>({
  name: 'fullscreen',
  state: context => {
    const own = fullscreenFeature.state(context)
    const handed = (action: () => Promise<void>) => () => {
      const { hostRequest } = context.get() as Partial<State>
      if (!hostRequest) return action()
      hostRequest()
      return Promise.resolve()
    }
    return {
      ...own,
      hostRequest: undefined,
      requestFullscreen: handed(() => own.requestFullscreen()),
      exitFullscreen: handed(() => own.exitFullscreen()),
      toggleFullscreen: handed(() => own.toggleFullscreen()),
    }
  },
  attach: context => {
    fullscreenFeature.attach?.(context)
    const stop = watchHostFullscreen(({ active, request }) => context.set({ fullscreen: active, fullscreenAvailability: 'available', hostRequest: request }))
    context.signal.addEventListener('abort', stop)
  },
})

/** video.js's video features with the fullscreen above in place of its own. */
export const hostFullscreenFeatures = videoFeatures.map(feature => feature === fullscreenFeature ? hostFullscreenFeature : feature) as unknown as typeof videoFeatures
