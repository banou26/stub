/**
 * The episode title the watch page hands to stub's own embed, for the player to draw over the picture.
 *
 * A message rather than a parameter of the embed url: an episode's titles keep arriving after its
 * handles do, and a new `src` would reload the player mid episode. Either side can be first, so the
 * page sends whenever its title changes and also answers the embed's ask when the embed starts.
 *
 * The embed is served from this app's own origin and nothing else is sent a title: a source's own
 * `embedUrl` sits on another origin, where the browser drops the message instead of delivering it.
 */
import { postMessage } from '@banou/ponyfill/web-messaging'

const TITLE = 'stub:embed-title'
const ASK = 'stub:embed-title?'

type Message = { type?: unknown, title?: unknown }

/** On the watch page: keeps the embed in `iframe` told `title`. Returns the stop. */
export const serveEmbedTitle = (iframe: HTMLIFrameElement, title: string, host: Window = window) => {
  const send = () => {
    if (iframe.contentWindow) postMessage(iframe.contentWindow, { type: TITLE, title }, host.location.origin)
  }
  const answer = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    if ((event.data as Message | null)?.type === ASK) send()
  }
  host.addEventListener('message', answer)
  send()
  return () => host.removeEventListener('message', answer)
}

/** In the embed: every title the page that frames it sends. Returns the unsubscribe. */
export const receiveEmbedTitle = (listener: (title: string) => void, host: Window = window) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const { type, title } = (event.data ?? {}) as Message
    if (type === TITLE && typeof title === 'string') listener(title)
  }
  host.addEventListener('message', receive)
  if (host.parent !== host) postMessage(host.parent, { type: ASK }, host.location.origin)
  return () => host.removeEventListener('message', receive)
}
