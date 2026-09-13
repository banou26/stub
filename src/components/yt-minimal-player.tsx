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
// origin whose content security policy is `script-src 'self'`, which means only bytes the publisher
// signed may execute. A third-party script injected into that origin is exactly what the policy
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

const minimalPlayerStyle = css`
position: absolute;
top: 0;
left: 0;
width: 100%;
height: 100%;
overflow: hidden;
`

const youtubeStyle = css`
grid-area: container;
height: 140vh !important;
width: 100% !important;
margin-top: -20vh;
pointer-events: none;
border: 0;
display: block;
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
    /** Called on a player error and on a url this component cannot address. Every call site takes no
     *  argument, so it takes none: an error event object here would be invented rather than real. */
    onError?: () => void
  }
) => {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [isReady, setIsReady] = useState(false)
  const videoId = youtubeVideoId(url)

  const command = useCallback((func: string, args: unknown[] = []) => {
    frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      YOUTUBE_ORIGIN,
    )
  }, [])

  // a url no shape matched is a miss the caller has to hear about, the same as a player error: the
  // theater bans the title and picks another rather than showing a dead frame
  useEffect(() => {
    if (!videoId) onError?.()
  }, [videoId, onError])

  useEffect(() => {
    setIsReady(false)
    if (!videoId) return

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_ORIGIN) return
      if (event.source !== frameRef.current?.contentWindow) return
      let payload: { event?: string, info?: unknown }
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
      } catch { return }
      if (payload?.event === 'onReady') { setIsReady(true); return }
      if (payload?.event === 'onError') { onError?.(); return }
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

    // repeated because the embed cannot answer until its own script is running, and there is no
    // event for that: `load` on the iframe fires before the player inside it exists
    let attempts = 0
    const handshake = setInterval(() => {
      attempts += 1
      if (attempts > LISTEN_ATTEMPTS) { clearInterval(handshake); return }
      frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
        YOUTUBE_ORIGIN,
      )
    }, LISTEN_INTERVAL_MS)

    return () => {
      removeEventListener('message', onMessage)
      clearInterval(handshake)
    }
  }, [videoId, onError, command])

  // the handshake keeps running until ready, so stopping it is the job of the ready state
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
      ref={frameRef}
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
