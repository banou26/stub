import type { Frame, RemoteVideoElement } from '@fkn/lib'

import { render } from 'preact'
import { RawIntlProvider } from 'react-intl'

import { intl } from '../src/i18n'
import CrunchyrollVideoJSPlayer from '../src/sources/crunchyroll/cr-videojs-player'
import { useCrunchyrollChapters } from '../src/sources/crunchyroll/skip-events'

// The embed tests/watch-stage.spec.ts frames in place of Crunchyroll's: stub's own Crunchyroll player over a video
// that plays for a moment and ends, as a Crunchyroll page's would. `keys` lists the keys this document heard. With
// `stageSceneAfterEnding` on the window it runs 100 s, the chapters are the first episode's, and `seek` moves it.

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
  currentTime: 0, duration: 'stageSceneAfterEnding' in window ? 100 : 2, paused: true, ended: false, readyState: 4, seeking: false, playbackRate: 1, volume: 1, muted: false,
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

Object.assign(window, {
  seek: (time: number) => {
    video.currentTime = time
    fire('seeked', 'timeupdate')
  },
})

const remote = video as unknown as RemoteVideoElement
const Player = () => (
  <CrunchyrollVideoJSPlayer
    remote={remote}
    frame={{} as Frame}
    title="Spec Stage"
    chapters={useCrunchyrollChapters('https://www.crunchyroll.com/watch/GSTAGE1', remote)}
  />
)

render(
  <RawIntlProvider value={intl}>
    <Player/>
  </RawIntlProvider>,
  document.getElementById('app')!,
)
