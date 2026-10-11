/**
 * The subtitle and audio tracks of the player in stub's own embed, told to the watch page, and the
 * page's picks sent back. The same shape as ./embed-title.ts the other way round: the embed sends on
 * every change and also answers the page's ask, so either side can be first.
 *
 * Only this app's origin is heard or sent to: a source's own `embedUrl` sits on another origin, where
 * the browser drops the message instead of delivering it.
 */
const TRACKS = 'stub:embed-tracks'
const ASK = 'stub:embed-tracks?'
const PICK = 'stub:embed-track-pick'

export const TRACK_KINDS = ['subtitles', 'audio'] as const
export type TrackKind = typeof TRACK_KINDS[number]

/** A player's tracks of one kind: ids as the player names them, `selected` null for subtitles off. */
export type TrackList = { ids: string[], selected: string | null }

/** What the embed serves. A kind is absent when the player has no choice of it; `busy` while any switch runs. */
export type EmbedTracks = { subtitles?: TrackList, audio?: TrackList, busy: boolean }

type Message = { type?: unknown, tracks: EmbedTracks, kind: TrackKind, id: string | null }

/** In the embed: tells the page that frames it `tracks`, and hands its picks to `select`. Returns the stop. */
export const serveEmbedTracks = (
  tracks: EmbedTracks,
  select: (kind: TrackKind, id: string | null) => void,
  host: Window = window,
) => {
  const send = () => host.parent.postMessage({ type: TRACKS, tracks }, host.location.origin)
  const receive = (event: MessageEvent) => {
    if (event.source !== host.parent || event.origin !== host.location.origin) return
    const { type, kind, id } = (event.data ?? {}) as Message
    if (type === ASK) send()
    if (type === PICK) select(kind, id)
  }
  host.addEventListener('message', receive)
  if (host.parent !== host) send()
  return () => host.removeEventListener('message', receive)
}

/** The page's end of the channel to one embed. */
export type TracksLink = {
  /** every list the embed serves, the last one at once to a new ear; returns the unsubscribe */
  onTracks: (listener: (tracks: EmbedTracks) => void) => () => void
  select: (kind: TrackKind, id: string | null) => void
  dispose: () => void
}

/** On the watch page: the tracks of the embed in `iframe`. */
export const embedTracks = (iframe: HTMLIFrameElement, host: Window = window): TracksLink => {
  const listeners = new Set<(tracks: EmbedTracks) => void>()
  let heard: EmbedTracks | undefined
  const receive = (event: MessageEvent) => {
    if (event.source !== iframe.contentWindow || event.origin !== host.location.origin) return
    const { type, tracks } = (event.data ?? {}) as Message
    if (type !== TRACKS) return
    heard = tracks
    for (const listener of listeners) listener(tracks)
  }
  // asked on load, not now: until a new `src` commits, the iframe's window is still the old document, which would answer
  const ask = () => iframe.contentWindow?.postMessage({ type: ASK }, host.location.origin)
  host.addEventListener('message', receive)
  iframe.addEventListener('load', ask)
  return {
    onTracks: listener => {
      listeners.add(listener)
      if (heard) listener(heard)
      return () => { listeners.delete(listener) }
    },
    select: (kind, id) => iframe.contentWindow?.postMessage({ type: PICK, kind, id }, host.location.origin),
    dispose: () => {
      host.removeEventListener('message', receive)
      iframe.removeEventListener('load', ask)
    },
  }
}
