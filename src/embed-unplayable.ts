/**
 * The embed telling the watch page that its source cannot play the episode here, for a reason neither the
 * viewer nor stub can fix, so the page can open the next source Play ranks when Play picked this one.
 * Only this app's origin is heard or sent to, as in ./embed-title.ts.
 */
import { postMessage } from '@banou/ponyfill/web-messaging'

const UNPLAYABLE = 'stub:embed-unplayable'

/** On the watch page: calls `listener` when the embed in `iframe` says it cannot play. Returns the stop. */
export const hearUnplayable = (iframe: HTMLIFrameElement, listener: () => void, host: Window = window) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    if ((event.data as { type?: unknown } | null)?.type === UNPLAYABLE) listener()
  }
  host.addEventListener('message', receive)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: tells the page that frames it that this source cannot play the episode here. */
export const tellUnplayable = (host: Window = window) => {
  if (host.parent !== host) postMessage(host.parent, { type: UNPLAYABLE }, host.location.origin)
}
