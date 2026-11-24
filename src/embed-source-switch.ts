/**
 * Quick source switch control between the watch page and stub's own embed: the watch page tells the
 * embed whether the button is shown and its optional label, and clicks ask the page to open its
 * quick switcher. Only this app's origin is heard or sent to, as in ./embed-fullscreen.ts.
 */
import type { SourceSwitch } from '@banou/media-player'

import { postMessage } from '@banou/ponyfill/web-messaging'
import { useEffect, useState } from 'preact/hooks'

const STATE = 'stub:embed-source-switch'
const ASK = 'stub:embed-source-switch?'
const REQUEST = 'stub:embed-source-switch-request'

/** On the watch page: tells the embed in `iframe` whether source switching is open, and forwards clicks to `onRequest`. Returns the stop. */
export const serveEmbedSourceSwitch = (
  iframe: HTMLIFrameElement,
  value: string | boolean,
  onRequest: () => void,
  host: Window = window,
) => {
  const enabled = value || false
  const send = () => {
    if (iframe.contentWindow) postMessage(iframe.contentWindow, { type: STATE, value: enabled }, host.location.origin)
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const type = (event.data as { type?: unknown } | null)?.type
    if (type === ASK) send()
    else if (type === REQUEST && enabled) onRequest()
  }
  host.addEventListener('message', receive)
  send()
  return () => host.removeEventListener('message', receive)
}

const isValue = (value: unknown): value is string | boolean =>
  typeof value === 'string' || typeof value === 'boolean'

/** In the embed: the source switch action the framing page offers, or undefined when closed or standalone. Returns the unsubscribe. */
export const watchHostSourceSwitch = (
  listener: (sourceSwitch: SourceSwitch | undefined) => void,
  host: Window = window,
) => {
  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const { type, value } = (event.data ?? {}) as { type?: unknown, value?: unknown }
    if (type !== STATE || !isValue(value)) return
    listener(
      value
        ? {
          ...typeof value === 'string' && value ? { title: value } : {},
          request: () => postMessage(host.parent, { type: REQUEST }, host.location.origin),
        }
        : undefined,
    )
  }
  host.addEventListener('message', receive)
  if (host.parent !== host) postMessage(host.parent, { type: ASK }, host.location.origin)
  return () => host.removeEventListener('message', receive)
}

/** In the embed: the quick source switch action the framing watch page offers, undefined standalone. */
export const useHostSourceSwitch = (host: Window = window): SourceSwitch | undefined => {
  const [sourceSwitch, setSourceSwitch] = useState<SourceSwitch | undefined>(undefined)
  useEffect(() => watchHostSourceSwitch(setSourceSwitch, host), [host])
  return sourceSwitch
}
