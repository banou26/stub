/**
 * External subtitle tracks, lazy subtitle loading, browse action, and one-shot external selection
 * between the watch page and stub's own embed.
 */
import type { BrowseSubtitles, ExternalSubtitleTrack, RemoteExternalSubtitleTrack } from '@banou/media-player'
import type { ExternalSubtitleBundle } from './subtitles'

import { postMessage } from '@banou/ponyfill/web-messaging'
import { useEffect, useState } from 'preact/hooks'

const STATE = 'stub:embed-subtitles'
const ASK = 'stub:embed-subtitles?'
const LOAD = 'stub:embed-subtitles-load'
const LOADED = 'stub:embed-subtitles-loaded'
const BROWSE = 'stub:embed-subtitles-browse'

export type HostSubtitleSelection = {
  id: string
  seq: number
}

export type ServeEmbedSubtitleOptions = {
  browse?: string | boolean
  onBrowse?: () => void
  select?: HostSubtitleSelection
  host?: Window
}

export type HostSubtitleControls = {
  tracks: ExternalSubtitleTrack[] | undefined
  browseSubtitles: BrowseSubtitles | undefined
  selection: HostSubtitleSelection | undefined
}

const isWindowLike = (value: unknown): value is Window =>
  Boolean(value && typeof value === 'object' && 'location' in value && 'addEventListener' in value)

/**
 * On the watch page: tells the embed in `iframe` which external subtitle tracks exist, whether to show
 * the browse subtitles action, and any explicit track activation request, and serves lazy `load(id)`.
 * Returns the teardown function.
 */
export const serveEmbedExternalSubtitles = (
  iframe: HTMLIFrameElement,
  bundle: ExternalSubtitleBundle | undefined,
  hostOrOptions: Window | ServeEmbedSubtitleOptions = window,
): (() => void) => {
  const options = isWindowLike(hostOrOptions) ? { host: hostOrOptions } : hostOrOptions
  const host = options.host ?? window
  const browse = options.browse
  const onBrowse = options.onBrowse
  const select = options.select

  let disposed = false
  const tracks = bundle?.tracks ?? []
  const send = () => {
    if (iframe.contentWindow) {
      postMessage(
        iframe.contentWindow,
        {
          type: STATE,
          tracks,
          ...(browse !== undefined ? { browse } : {}),
          ...(select ? { select } : {}),
        },
        host.location.origin,
      )
    }
  }
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, requestId, id } = (event.data ?? {}) as { type?: unknown, requestId?: unknown, id?: unknown }
    if (type === ASK) {
      send()
      return
    }
    if (type === BROWSE) {
      if (browse) onBrowse?.()
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
    && (
      (value as RemoteExternalSubtitleTrack).format === 'srt'
      || (value as RemoteExternalSubtitleTrack).format === 'ass'
      || (value as RemoteExternalSubtitleTrack).format === 'vtt'
    ),
  )

const readSelection = (value: unknown): HostSubtitleSelection | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { id, seq } = value as { id?: unknown, seq?: unknown }
  return typeof id === 'string' && typeof seq === 'number' && Number.isFinite(seq) ? { id, seq } : undefined
}

const readBrowse = (value: unknown, host: Window): BrowseSubtitles | undefined => {
  if (typeof value !== 'boolean' && typeof value !== 'string') return undefined
  if (!value) return undefined
  return {
    ...(typeof value === 'string' && value ? { title: value } : {}),
    request: () => postMessage(host.parent, { type: BROWSE }, host.location.origin),
  }
}

/**
 * In the embed: subscribes to external subtitle track offers, browse action, and selection requests
 * from the framing watch page. Returns the unsubscribe.
 */
export const watchHostSubtitleControls = (
  listener: (controls: HostSubtitleControls) => void,
  host: Window = window,
): (() => void) => {
  let seq = 0
  let lastRawBrowse: unknown
  let lastBrowse: BrowseSubtitles | undefined
  const pending = new Map<string, { trackId: string, resolve: (text: string) => void, reject: (error: Error) => void }>()

  const getBrowse = (raw: unknown): BrowseSubtitles | undefined => {
    if (raw === lastRawBrowse) return lastBrowse
    lastRawBrowse = raw
    lastBrowse = readBrowse(raw, host)
    return lastBrowse
  }

  const requestLoad = (trackId: string): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      const requestId = `sub-${++seq}`
      pending.set(requestId, { trackId, resolve, reject })
      postMessage(host.parent, { type: LOAD, requestId, id: trackId }, host.location.origin)
    })

  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const payload = (event.data ?? {}) as {
      type?: unknown
      tracks?: unknown
      browse?: unknown
      select?: unknown
      requestId?: unknown
      text?: unknown
      error?: unknown
    }
    if (payload.type === STATE && Array.isArray(payload.tracks)) {
      const tracks = payload.tracks.filter(isTrack)
      const ids = new Set(tracks.map(track => track.id))
      for (const [requestId, entry] of [...pending.entries()]) {
        if (!ids.has(entry.trackId)) {
          pending.delete(requestId)
          entry.reject(new Error('External subtitle track was removed'))
        }
      }
      listener({
        tracks: tracks.length
          ? tracks.map(track => ({
            ...track,
            ...(track.content === undefined ? { load: () => requestLoad(track.id) } : {}),
          }))
          : undefined,
        browseSubtitles: getBrowse(payload.browse),
        selection: readSelection(payload.select),
      })
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

/**
 * In the embed: subscribes to external subtitle track offers from the framing watch page and binds
 * lazy `load()` calls back through the same origin check. Returns the unsubscribe.
 */
export const watchHostExternalSubtitles = (
  listener: (tracks: ExternalSubtitleTrack[] | undefined) => void,
  host: Window = window,
): (() => void) => watchHostSubtitleControls(controls => listener(controls.tracks), host)

const EMPTY_HOST_CONTROLS: HostSubtitleControls = {
  tracks: undefined,
  browseSubtitles: undefined,
  selection: undefined,
}

/** In the embed: reactive subtitle tracks, browse action, and selection from the framing watch page. */
export const useHostSubtitleControls = (host: Window = window): HostSubtitleControls => {
  const [controls, setControls] = useState<HostSubtitleControls>(EMPTY_HOST_CONTROLS)
  useEffect(() => watchHostSubtitleControls(setControls, host), [host])
  return controls
}

/** In the embed: reactive external subtitle tracks offered by the framing watch page, undefined standalone. */
export const useHostExternalSubtitles = (host: Window = window): ExternalSubtitleTrack[] | undefined =>
  useHostSubtitleControls(host).tracks
