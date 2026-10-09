import type { Path } from 'wouter'
import type { HTMLAttributes } from 'react'

import { css } from '@emotion/react'
import { Link } from 'wouter'
import { useState, useCallback, useEffect, useRef } from 'preact/compat'

import { youtubeVideoId } from './youtube-url'

// A YouTube trailer WITHOUT YouTube's script.
//
// This used to be `react-player`, which loads `https://www.youtube.com/iframe_api`. That file is a
// 400 byte loader: it injects `https://www.youtube.com/s/player/<rotating hash>/www-widgetapi.vflset/
// www-widgetapi.js`, and all that second file does is create the same iframe this file creates and
// talk to it over postMessage. So the API buys a wrapper around a protocol the embed already speaks.
//
// It is worth removing for one specific reason. A package on the FKN platform runs on a sandbox
// origin whose content security policy is `script-src 'self'`, which means only the package's own
// bytes may execute. A third-party script injected into that origin is exactly what the policy
// refuses, and it would have the app's OPFS, IndexedDB and Cache Storage if it ran. Vendoring
// YouTube's file instead would pin a build behind a hash they rotate, and it would break silently.
//
// The protocol, which is public and is what the widget API uses under the hood: post
// `{event: 'listening'}` to the embed until it answers, then send `{event: 'command', func, args}`
// for playback and read `{event: 'onReady' | 'onStateChange' | 'onError'}` back. Both directions are
// JSON STRINGS, not objects, and both are checked against YouTube's origin.

const YOUTUBE_ORIGIN = 'https://www.youtube.com'
/** ENDED, from the player state enum, the only state this component acts on. */
const STATE_ENDED = 0
/** The handshake is not answered until the embed's own script is running, so it is repeated. */
const LISTEN_INTERVAL_MS = 250
const LISTEN_ATTEMPTS = 40

// A size container takes no height from its content, so the box it fills (by default its nearest
// positioned ancestor) has to have one.
const minimalPlayerStyle = css`
position: absolute;
top: 0;
left: 0;
width: 100%;
height: 100%;
overflow: hidden;
container-type: size;

/* the frame takes no pointer events, so a redirectTo link has to fill the box itself to be clicked */
& > a {
  position: absolute;
  inset: 0;
}
`

// The video covers the box at 16:9 on any box shape, and the frame is 80px taller than the video at
// each end: YouTube letterboxes the video in the middle of its frame and draws the title bar and the
// logo row within about 70px of the frame's top and bottom edges at every player size (measured
// 2026-10-10), so they land in bands the wrapper crops off.
const youtubeStyle = css`
position: absolute;
top: 50%;
left: 50%;
translate: -50% -50%;
width: max(100cqw, 100cqh * 16 / 9);
height: calc(max(100cqh, 100cqw * 9 / 16) + 160px);
pointer-events: none;
border: 0;
`

/** The player state out of an `infoDelivery` payload, or null when it carries none. */
const playerStateOf = (info: unknown): number | null =>
  typeof info === 'object' && info !== null && typeof (info as { playerState?: unknown }).playerState === 'number'
    ? (info as { playerState: number }).playerState
    : null

/** `loop` on a single video does nothing unless `playlist` repeats its id, which is YouTube's own
 *  documented workaround rather than a trick. Muted at load because an unmuted autoplay is refused
 *  by every engine; the real volume is applied over the port once the player answers. */
const embedSrc = (id: string): string => {
  const params = new URLSearchParams({
    enablejsapi: '1',
    controls: '0',
    disablekb: '1',
    modestbranding: '1',
    rel: '0',
    playsinline: '1',
    iv_load_policy: '3',
    autoplay: '1',
    mute: '1',
    loop: '1',
    playlist: id,
    origin: location.origin,
  })
  return `${YOUTUBE_ORIGIN}/embed/${encodeURIComponent(id)}?${params.toString()}`
}

export const YoutubeMinimalPlayer = (
  { url, redirectTo, volume = 1, paused = false, onError, ...rest }:
  HTMLAttributes<HTMLDivElement> & {
    url: string
    redirectTo?: Path
    volume?: number
    paused?: boolean
    /** Called on an embed error, on a url that names no video, and on an embed that has not answered
     *  `LISTEN_ATTEMPTS` handshakes after its frame loaded. The latest onError passed is the one
     *  called, so a parent may pass a new function on every render. Every call site takes no
     *  argument, so it takes none: an error event object here would be invented rather than real. */
    onError?: () => void
  }
) => {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const loadedFrameRef = useRef<HTMLIFrameElement | null>(null)
  const [isReady, setIsReady] = useState(false)
  const videoId = youtubeVideoId(url)
  // READ THROUGH A REF, never a dependency: every parent keys its callback on live data the store
  // keeps re-emitting, so a new one arrives long after the embed is ready. Re-running the handshake
  // for it would hide a playing trailer for good, because the embed answers only the first
  // `listening` with `onReady` and every later one with `alreadyInitialized` (measured 2026-10-09).
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  const command = useCallback((func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      YOUTUBE_ORIGIN,
    )
  }, [])

  // a url no shape matched is a miss the caller has to hear about, the same as a player error: the
  // theater drops the title and picks another rather than showing a dead frame. Keyed on the url, so
  // a second unaddressable url after a drop is reported too.
  useEffect(() => {
    if (!videoId) onErrorRef.current?.()
  }, [url, videoId])

  useEffect(() => {
    setIsReady(false)
    const frame = frameRef.current
    if (!videoId || !frame) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_ORIGIN) return
      if (event.source !== frame.contentWindow) return
      let payload: { event?: string, info?: unknown }
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch { return }
      // left running, the silence budget below would report a PLAYING trailer as an error about
      // 10 s after its frame's `load`
      if (payload?.event === 'onReady') { clearInterval(handshake); setIsReady(true); return }
      // an unavailable video sends this right after its `onReady` (error 150, measured 2026-10-09),
      // as a separate message, so a commit showing the frame can land between the two
      if (payload?.event === 'onError') { setIsReady(false); onErrorRef.current?.(); return }
      // BOTH SHAPES. Measured against a live embed on 2026-09-14: the current player reports state
      // through `infoDelivery` carrying `{ playerState }` and never sends `onStateChange` at all, so
      // reading only the documented event left this branch dead. Older embeds do send it.
      const state = payload?.event === 'onStateChange' && typeof payload.info === 'number'
        ? payload.info
        : playerStateOf(payload?.info)
      // `loop` already restarts it; this is the belt for a player that reports ENDED anyway
      if (state === STATE_ENDED) command('playVideo')
    }
    addEventListener('message', onMessage)

    // Repeated because the embed cannot answer until its own script is running, and no event says
    // when that is. Measured 2026-10-09: a working embed answers before the frame's `load` or within
    // about 50 ms of it (throttled, the answer came at 12 s and `load` at 22 s), while a nonexistent
    // id sometimes stays silent after `load` for good (8 loads in 30). So the budget counts from
    // `load`, and running out of it is an error the parent has to hear, or it shows a dead frame.
    let attempts = 0
    const handshake = setInterval(() => {
      if (loadedFrameRef.current === frame && ++attempts > LISTEN_ATTEMPTS) {
        clearInterval(handshake)
        onErrorRef.current?.()
        return
      }
      frame.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        YOUTUBE_ORIGIN,
      )
    }, LISTEN_INTERVAL_MS)

    return () => {
      removeEventListener('message', onMessage)
      clearInterval(handshake)
    }
  }, [videoId, command])

  useEffect(() => {
    if (!isReady) return
    if (volume === 0) command('mute')
    else {
      command('unMute')
      // the embed takes 0 to 100 where this component's prop is 0 to 1, as react-player's was
      command('setVolume', [Math.round(Math.min(Math.max(volume, 0), 1) * 100)])
    }
  }, [isReady, volume, command])

  useEffect(() => {
    if (!isReady) return
    command(paused ? 'pauseVideo' : 'playVideo')
  }, [isReady, paused, command])

  if (!videoId) return null

  const player = (
    <iframe
      // a new element per video: changing `src` on a loaded frame pushes a session history entry,
      // so Back would step the trailer instead of the app (history.length 2 to 3, measured 2026-10-09)
      key={videoId}
      ref={frameRef}
      // recorded here rather than by a listener the effect adds: effects run after paint, which a busy
      // main thread or a hidden tab delays past a fast `load`, and a missed one never starts the budget
      onLoad={event => { loadedFrameRef.current = event.currentTarget }}
      css={youtubeStyle}
      src={embedSrc(videoId)}
      title="Trailer"
      // autoplay has to be granted explicitly to a cross-origin frame, and a nested frame can never
      // re-grant what an ancestor withheld: inside an FKN tenant this depends on the tenant frame
      // carrying `autoplay` too
      allow="autoplay; encrypted-media; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
      loading="eager"
      style={{ display: isReady ? '' : 'none' }}
    />
  )

  return (
    <div css={minimalPlayerStyle} {...rest}>
      {
        redirectTo
          ? <Link to={redirectTo}>{player}</Link>
          : player
      }
    </div>
  )
}

export default YoutubeMinimalPlayer
