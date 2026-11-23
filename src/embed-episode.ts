/**
 * Previous and next episode controls between the watch page and stub's own embed: the watch page tells
 * the embed which steps exist and their titles, and clicks on those player buttons ask the page to
 * open the neighbour episode. Only this app's origin is heard or sent to, as in ./embed-fullscreen.ts.
 */
import type { EpisodeNavigation } from '@banou/media-player'

import { postMessage } from '@banou/ponyfill/web-messaging'
import { useEffect, useState } from 'preact/hooks'

const STATE = 'stub:embed-episode'
const ASK = 'stub:embed-episode?'
const REQUEST = 'stub:embed-episode-request'

export type EpisodeNavValues = { previous?: string | boolean, next?: string | boolean }

/** On the watch page: tells the embed in `iframe` which episode steps exist, and forwards clicks to `onStep`. Returns the stop. */
export const serveEmbedEpisodeNavigation = (
  iframe: HTMLIFrameElement,
  navigation: EpisodeNavValues,
  onStep: (direction: 'previous' | 'next') => void,
  host: Window = window,
) => {
  const previous = navigation.previous || false
  const next = navigation.next || false
  const send = () => {
    if (iframe.contentWindow) postMessage(iframe.contentWindow, { type: STATE, previous, next }, host.location.origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, direction } = (event.data ?? {}) as { type?: unknown, direction?: unknown }
    if (type === ASK) send()
    else if (type === REQUEST && ((direction === 'previous' && previous) || (direction === 'next' && next))) onStep(direction)
  }
  host.addEventListener('message', receive)
  send()
  return () => host.removeEventListener('message', receive)
}

const isStepValue = (value: unknown): value is string | boolean =>
  typeof value === 'string' || typeof value === 'boolean'

const stepFor = (
  value: string | boolean,
  direction: 'previous' | 'next',
  host: Window,
) => value
  ? {
    ...typeof value === 'string' && value ? { title: value } : {},
    request: () => postMessage(host.parent, { type: REQUEST, direction }, host.location.origin),
  }
  : null

/** In the embed: each episode navigation state the framing page sends, or undefined when neither end is open. Returns the unsubscribe. */
export const watchHostEpisodeNavigation = (
  listener: (navigation: EpisodeNavigation | undefined) => void,
  host: Window = window,
) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const { type, previous, next } = (event.data ?? {}) as { type?: unknown, previous?: unknown, next?: unknown }
    if (type !== STATE || !isStepValue(previous) || !isStepValue(next)) return
    listener(
      previous || next
        ? { previous: stepFor(previous, 'previous', host), next: stepFor(next, 'next', host) }
        : undefined,
    )
  }
  host.addEventListener('message', receive)
  if (host.parent !== host) postMessage(host.parent, { type: ASK }, host.location.origin)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: the previous and next episode buttons the framing watch page offers, undefined standalone. */
export const useHostEpisodeNavigation = (host: Window = window): EpisodeNavigation | undefined => {
  const [navigation, setNavigation] = useState<EpisodeNavigation | undefined>(undefined)
  useEffect(() => watchHostEpisodeNavigation(setNavigation, host), [host])
  return navigation
}
