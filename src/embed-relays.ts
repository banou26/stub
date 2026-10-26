/**
 * The relays a show was unavailable through, kept by the watch page in memory for the visit, so the
 * next episode's embed starts past them and the failed relay is paid once per show, not per episode.
 *
 * The page hands them to the embed in its url, and the embed tells the page each relay it moved away
 * from once another one plays the episode. Only this app's origin is heard or sent to, as in ./embed-title.ts.
 */
import { postMessage } from '@banou/ponyfill/web-messaging'

const TRIED = 'stub:embed-relay-tried'
const PARAM = 'triedRelays'

const tried = new Map<string, readonly string[]>()

// a show's episodes share its series id, the first part of `cr:<series>-<season>-<episode>`
const showOf = (sourceUri: string) => sourceUri.split('-')[0]!

/** On the watch page: the embed url parameters handing over the relays `sourceUri`'s show was unavailable through. */
export const triedRelaysParams = (sourceUri: string): Record<string, string> => {
  const relays = tried.get(showOf(sourceUri))
  return relays?.length ? { [PARAM]: relays.join(',') } : {}
}

/** In the embed: the relays its url hands over. */
export const triedRelaysOf = (params: URLSearchParams): string[] =>
  params.get(PARAM)?.split(',').filter(Boolean) ?? []

/** On the watch page: remembers each relay the embed in `iframe`, playing `sourceUri`, moves away from. Returns the stop. */
export const hearTriedRelays = (iframe: HTMLIFrameElement, sourceUri: string, host: Window = window) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, relay } = (event.data ?? {}) as { type?: unknown, relay?: unknown }
    if (type !== TRIED || typeof relay !== 'string') return
    const show = showOf(sourceUri)
    const relays = tried.get(show) ?? []
    if (!relays.includes(relay)) tried.set(show, [...relays, relay])
  }
  host.addEventListener('message', receive)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: tells the page that frames it that the show was unavailable through `relay`. */
export const tellTriedRelay = (relay: string, host: Window = window) => {
  if (host.parent !== host) postMessage(host.parent, { type: TRIED, relay }, host.location.origin)
}
