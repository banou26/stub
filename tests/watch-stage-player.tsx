import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { render } from 'preact'

import CrunchyrollVideoJSPlayer from '../src/sources/crunchyroll/cr-videojs-player'

// The embed tests/watch-stage.spec.ts frames in place of Crunchyroll's: stub's own Crunchyroll player over a video
// that plays for a moment and ends, as a Crunchyroll page's would. `keys` lists the keys this document heard.

const keys: string[] = []
addEventListener('keydown', event => { keys.push(event.key) })
Object.assign(window, { keys })

const target = new EventTarget()
const fire = (...types: string[]) => { for (const type of types) target.dispatchEvent(new Event(type)) }
// the listener methods are own closures, as on @fkn/lib's handle, so the player's proxies can call them
const video = Object.assign(target, {
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
  currentTime: 0, duration: 2, paused: true, ended: false, readyState: 4, seeking: false, playbackRate: 1, volume: 1, muted: false,
  play: async () => {
    Object.assign(video, { paused: false, ended: false, currentTime: 0 })
    fire('play', 'playing')
    setTimeout(() => {
      Object.assign(video, { paused: true, ended: true, currentTime: video.duration })
      fire('timeupdate', 'pause', 'ended')
    }, 300)
  },
  pause: () => {
    video.paused = true
    fire('pause')
  },
})

render(
  <CrunchyrollVideoJSPlayer remote={video as unknown as RemoteVideoElement} frame={{} as Frame} title="Spec Stage"/>,
  document.getElementById('app')!,
)
