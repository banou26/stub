import type { HostFullscreen } from '@banou/media-player'

import { postMessage } from '@banou/ponyfill/web-messaging'
import { useEffect, useState } from 'preact/hooks'

/**
 * The fullscreen of stub's own embed, kept by the watch page: the page fullscreens its stage, the box around the
 * player, so the fullscreen outlasts the embed when the next episode's takes its place. The embed's fullscreen
 * controls ask the page instead of fullscreening themselves, and show the state the page tells them.
 *
 * The page speaks only where it can fullscreen the stage, and an embed it never tells keeps its own fullscreen.
 * Only this app's origin is heard or sent to, as in ./embed-title.ts.
 */
const STATE = 'stub:embed-fullscreen'
const ASK = 'stub:embed-fullscreen?'
const REQUEST = 'stub:embed-fullscreen-request'

/**
 * On the watch page: keeps the fullscreen of the embed in `iframe` on `stage`. A request from the embed leaves
 * fullscreen when the page is in it and fullscreens `stage` otherwise, and the embed is told every change. Nothing
 * where the page cannot fullscreen. Returns the stop.
 */
export const serveEmbedFullscreen = (iframe: HTMLIFrameElement, stage: HTMLElement, host: Window = window) => {
  const { document } = host
  if (!document.fullscreenEnabled) return () => {}
  const send = () => {
    if (iframe.contentWindow) postMessage(iframe.contentWindow, { type: STATE, active: Boolean(document.fullscreenElement) }, host.location.origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const type = (event.data as { type?: unknown } | null)?.type
    if (type === ASK) send()
    // within the press's activation, which a click or a key in the embed gives this page too
    else if (type === REQUEST) (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen()).catch(() => {})
  }
  host.addEventListener('message', receive)
  document.addEventListener('fullscreenchange', send)
  send()
  return () => {
    host.removeEventListener('message', receive)
    document.removeEventListener('fullscreenchange', send)
  }
}

/** In the embed: each state the page that frames it keeps its fullscreen in, with the request that asks it to change. Returns the unsubscribe. */
export const watchHostFullscreen = (listener: (fullscreen: HostFullscreen) => void, host: Window = window) => {
  const request = () => postMessage(host.parent, { type: REQUEST }, host.location.origin)
  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const { type, active } = (event.data ?? {}) as { type?: unknown, active?: unknown }
    if (type === STATE && typeof active === 'boolean') listener({ active, request })
  }
  host.addEventListener('message', receive)
  if (host.parent !== host) postMessage(host.parent, { type: ASK }, host.location.origin)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: the fullscreen the page keeps, for `@banou/media-player`'s `fullscreen`; undefined until the page says it keeps it. */
export const useHostFullscreen = () => {
  const [fullscreen, setFullscreen] = useState<HostFullscreen>()
  useEffect(() => watchHostFullscreen(setFullscreen), [])
  return fullscreen
}
