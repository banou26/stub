import { expose } from 'osra'

import { PLAYER_ORIGIN } from './watch-stage-media'

// The source package tests/watch-stage.spec.ts mounts for its torrents, two frames down as stub-plugin plays one: it
// frames a player at another origin (./watch-stage-ripple.ts) as the plugin frames ripple, and answers stub's calls
// as stub-plugin's src/ui/playback.ts does, its `focus` included. Each episode runs 40 s, its ending from 20 to 38 s,
// and plays from 18.5 s.

const DURATION = 40
const CHAPTERS = [{ start: 0, end: 20, title: 'Part A' }, { start: 20, end: 38, title: 'ED' }]

let frame: HTMLIFrameElement | undefined
let loaded = false
let ear: ((state: object) => void) | undefined
let fullscreenEar: (() => void) | undefined
let fullscreen = false
let state = { paused: true, time: 0, ended: false }

// block bodies throughout: a listener's tail call to postMessage loses its source in WebKit (HOR-1043)
const report = () => { ear?.({ ...state, rate: 1, at: Date.now(), duration: DURATION, chapters: CHAPTERS }) }
const tell = () => { frame?.contentWindow?.postMessage({ fullscreen }, PLAYER_ORIGIN) }

addEventListener('message', event => {
  if (event.data === 'stage-plugin' && event.ports[0]) {
    expose(api, { transport: event.ports[0] })
    return
  }
  if (event.source !== frame?.contentWindow || event.origin !== PLAYER_ORIGIN) return
  const { type } = event.data as { type?: string }
  if (type === 'ready') tell()
  else if (type === 'fullscreen') fullscreenEar?.()
  else if (type === 'play') {
    state = { paused: false, time: 18.5, ended: false }
    report()
  } else if (type === 'end') {
    state = { paused: true, time: DURATION, ended: true }
    report()
  }
})

const api = {
  play: async () => {
    frame = document.createElement('iframe')
    loaded = false
    frame.addEventListener('load', () => { loaded = true }, { once: true })
    frame.src = `${PLAYER_ORIGIN}/player.html`
    frame.allow = 'autoplay; fullscreen'
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: 'none' })
    document.body.replaceChildren(frame)
    return true
  },
  onPlayback: async (listener: (state: object) => void) => {
    ear = listener
    report()
  },
  applyPlayback: async () => {},
  onFullscreenRequest: async (listener: () => void) => { fullscreenEar = listener },
  applyFullscreen: async (active: boolean) => {
    fullscreen = active
    tell()
  },
  focus: async () => {
    const current = frame
    if (loaded) current?.focus()
    else current?.addEventListener('load', () => { if (current === frame && document.hasFocus()) current.focus() }, { once: true })
  },
}
