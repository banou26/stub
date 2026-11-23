/**
 * External subtitle tracks and lazy subtitle loading between the watch page and stub's own embed:
 * the watch page resolves OpenSubtitles and Xunlei tracks once per episode and hands metadata into
 * the embed iframe, which requests subtitle text on demand over the same origin.
 */
import type { ExternalSubtitleTrack, RemoteExternalSubtitleTrack } from '@banou/media-player'
import type { ExternalSubtitleBundle } from './subtitles'

import { postMessage } from '@banou/ponyfill/web-messaging'
import { useEffect, useState } from 'preact/hooks'

const STATE = 'stub:embed-subtitles'
const ASK = 'stub:embed-subtitles?'
const LOAD = 'stub:embed-subtitles-load'
const LOADED = 'stub:embed-subtitles-loaded'

/**
 * On the watch page: tells the embed in `iframe` which external subtitle tracks exist and serves
 * lazy `load(id)` requests from `bundle`. Returns the teardown function.
 */
export const serveEmbedExternalSubtitles = (
  iframe: HTMLIFrameElement,
  bundle: ExternalSubtitleBundle | undefined,
  host: Window = window,
): () => void => {
  let disposed = false
  const tracks = bundle?.tracks ?? []
  const send = () => {
    if (iframe.contentWindow) {
      postMessage(iframe.contentWindow, { type: STATE, tracks }, host.location.origin)
    }
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, requestId, id } = (event.data ?? {}) as { type?: unknown, requestId?: unknown, id?: unknown }
    if (type === ASK) {
      send()
      return
    }
    if (type !== LOAD || typeof requestId !== 'string' || typeof id !== 'string') return
    if (!bundle) {
      if (iframe.contentWindow) {
        postMessage(iframe.contentWindow, { type: LOADED, requestId, error: 'External subtitles unavailable' }, host.location.origin)
      }
      return
    }
    bundle.load(id).then(
      text => {
        if (!disposed && iframe.contentWindow) {
          postMessage(iframe.contentWindow, { type: LOADED, requestId, text }, host.location.origin)
        }
      },
      err => {
        if (!disposed && iframe.contentWindow) {
          const error = err instanceof Error ? err.message : String(err)
          postMessage(iframe.contentWindow, { type: LOADED, requestId, error }, host.location.origin)
        }
      },
    )
  }
  host.addEventListener('message', receive)
  send()
  return () => {
    disposed = true
    host.removeEventListener('message', receive)
  }
}

const isTrack = (value: unknown): value is RemoteExternalSubtitleTrack =>
  Boolean(
    value
    && typeof value === 'object'
    && typeof (value as RemoteExternalSubtitleTrack).id === 'string'
    && typeof (value as RemoteExternalSubtitleTrack).language === 'string'
    && typeof (value as RemoteExternalSubtitleTrack).label === 'string'
    && typeof (value as RemoteExternalSubtitleTrack).format === 'string',
  )

/**
 * In the embed: subscribes to external subtitle track offers from the framing watch page and binds
 * lazy `load()` calls back through the same MessagePort-free origin check. Returns the unsubscribe.
 */
export const watchHostExternalSubtitles = (
  listener: (tracks: ExternalSubtitleTrack[] | undefined) => void,
  host: Window = window,
): () => void => {
  let seq = 0
  const pending = new Map<string, { trackId: string, resolve: (text: string) => void, reject: (error: Error) => void }>()

  const requestLoad = (trackId: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const requestId = `sub-${++seq}`
      pending.set(requestId, { trackId, resolve, reject })
      postMessage(host.parent, { type: LOAD, requestId, id: trackId }, host.location.origin)
    })

  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const payload = (event.data ?? {}) as { type?: unknown, tracks?: unknown, requestId?: unknown, text?: unknown, error?: unknown }
    if (payload.type === STATE && Array.isArray(payload.tracks)) {
      const tracks = payload.tracks.filter(isTrack)
      const ids = new Set(tracks.map(track => track.id))
      for (const [requestId, entry] of [...pending.entries()]) {
        if (!ids.has(entry.trackId)) {
          pending.delete(requestId)
          entry.reject(new Error('External subtitle track was removed'))
        }
      }
      listener(
        tracks.length
          ? tracks.map(track => ({ ...track, load: () => requestLoad(track.id) }))
          : undefined,
      )
      return
    }
    if (payload.type === LOADED && typeof payload.requestId === 'string') {
      const entry = pending.get(payload.requestId)
      if (!entry) return
      pending.delete(payload.requestId)
      if (typeof payload.text === 'string') entry.resolve(payload.text)
      else entry.reject(new Error(typeof payload.error === 'string' ? payload.error : 'External subtitle load failed'))
    }
  }

  host.addEventListener('message', receive)
  if (host.parent !== host) postMessage(host.parent, { type: ASK }, host.location.origin)
  return () => {
    host.removeEventListener('message', receive)
    for (const entry of pending.values()) entry.reject(new Error('External subtitle host disconnected'))
    pending.clear()
  }
}

/** In the embed: reactive external subtitle tracks offered by the framing watch page, undefined standalone. */
export const useHostExternalSubtitles = (host: Window = window): ExternalSubtitleTrack[] | undefined => {
  const [tracks, setTracks] = useState<ExternalSubtitleTrack[] | undefined>(undefined)
  useEffect(() => watchHostExternalSubtitles(setTracks, host), [host])
  return tracks
}
