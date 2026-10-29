import { expose } from 'osra'

import { CHAPTERLESS_TORRENT, PLAYER_ORIGIN } from './watch-stage-media'

// The source package tests/watch-stage.spec.ts mounts for its torrents, two frames down as stub-plugin plays one: it
// frames a player at another origin (./watch-stage-ripple.ts) as the plugin frames ripple, and answers stub's calls
// as stub-plugin's src/ui/playback.ts does, its `focus` included, and reports first once the player is up, as
// @banou/media-player's mirror does at `ready`. Each episode runs 40 s, its ending from 2 to 20 s with a scene after
// it, and plays from 18.5 s; the second's file marks no ending.

const DURATION = 40
const CHAPTERS = [{ start: 0, end: 2, title: 'Part A' }, { start: 2, end: 20, title: 'ED' }, { start: 20, end: 40, title: 'Part B' }]
const CHAPTERLESS = [{ start: 0, end: 20, title: 'Part A' }, { start: 20, end: 40, title: 'Part B' }]

let frame: HTMLIFrameElement | undefined
let loaded = false
let ready = false
let ear: ((state: object) => void) | undefined
let fullscreenEar: (() => void) | undefined
let fullscreen = false
let state = { paused: true, time: 0, ended: false }
let chapters = CHAPTERS

// block bodies throughout: a listener's tail call to postMessage loses its source in WebKit (HOR-1043)
const report = () => { ear?.({ ...state, rate: 1, at: Date.now(), duration: DURATION, chapters }) }
const tell = () => { frame?.contentWindow?.postMessage({ fullscreen }, PLAYER_ORIGIN) }

addEventListener('message', event => {
  if (event.data === 'stage-plugin' && event.ports[0]) {
    expose(api, { transport: event.ports[0] })
    return
  }
  if (event.source !== frame?.contentWindow || event.origin !== PLAYER_ORIGIN) return
  const { type } = event.data as { type?: string }
  if (type === 'ready') {
    ready = true
    tell()
    report()
  } else if (type === 'fullscreen') fullscreenEar?.()
  else if (type === 'play') {
    state = { paused: false, time: 18.5, ended: false }
    report()
  } else if (type === 'end') {
    state = { paused: true, time: DURATION, ended: true }
    report()
  }
})

const api = {
  play: async ({ url }: { url?: string }) => {
    chapters = url === `magnet:?xt=urn:btih:stage${CHAPTERLESS_TORRENT}` ? CHAPTERLESS : CHAPTERS
    frame = document.createElement('iframe')
    loaded = false
    ready = false
    state = { paused: true, time: 0, ended: false }
    frame.addEventListener('load', () => { loaded = true }, { once: true })
    frame.src = `${PLAYER_ORIGIN}/player.html`
    frame.allow = 'autoplay; fullscreen'
    Object.assign(frame.style, { display: 'block', width: '100%', height: '100%', border: 'none' })
    document.body.replaceChildren(frame)
    return true
  },
  onPlayback: async (listener: (state: object) => void) => {
    ear = listener
    if (ready) report()
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
