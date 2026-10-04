import type { Frame, RemoteVideoElement } from '@fkn/lib'

import type { PlayerProps } from '../players'

import { css } from '@emotion/react'
import { attachFrame, isExtensionExposed } from '@fkn/lib'
import { useCallback, useEffect, useState } from 'preact/hooks'

import NetflixVideoJSPlayer from './nf-videojs-player'

const NETFLIX_DOMAINS = [
  'netflix.com',
  'www.netflix.com',
  'nflxvideo.net',
  'nflxso.net',
  'nflxext.com',
  'nflximg.net',
  'assets.nflxext.com'
]

const NETFLIX_LOGIN_URL = 'https://www.netflix.com/login'

// selectors are best-effort: Netflix ships obfuscated, frequently-renamed classes
const NETFLIX_OUTER_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  /* Truly-unwanted chrome - collapse it entirely. */
  .watch-video--evidence-overlay-container,
  .watch-video--skip-content,
  .watch-video--nextEpisode-seamless-button,
  .watch-video--back-container,
  [data-uia="player-back-to-browse"],
  [data-uia="control-nav-back"],
  [data-uia="control-flag"] {
    display: none !important;
    pointer-events: none !important;
  }
  /* Keep the controls bar in LAYOUT (so the seek adapter can locate + click the
     [data-uia="timeline"] scrubber) but invisible and inert to real taps. NEVER
     display:none here, or the scrubber loses its box and the seek no-ops - mirrors
     Crunchyroll's opacity:0 timeline trick. The skin draws the visible controls. */
  [data-uia="controls-standard"],
  .watch-video--bottom-controls-container,
  .PlayerControlsNeo__layout,
  .PlayerControlsNeo__core-controls,
  .PlayerControlsNeo__button-control-row {
    opacity: 0 !important;
    pointer-events: none !important;
  }
  [data-uia="timeline"],
  [data-uia="timeline"] * {
    pointer-events: auto !important;
  }
  .watch-video,
  [data-uia="video-canvas"] {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 9999999 !important;
  }
  .watch-video video,
  [data-uia="video-canvas"] video {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
  }
`

const waitForContentScript = async <T,>(fn: () => Promise<T>, retries = 10, delay = 500): Promise<T> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === retries - 1 || !(err instanceof Error) || !err.message.includes('not registered')) throw err
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

const checkIsLoggedIn = async (frame: Frame) => {
  for (let i = 0; i < 50; i++) {
    const hasLoginForm = await frame.locator('[data-uia="header"] a[href*="/login"]').exists()
    if (hasLoginForm) return false
    const hasPlayer = await frame.locator('.watch-video, [data-uia="video-canvas"]').exists()
    if (hasPlayer) return true
    await new Promise(r => setTimeout(r, 200))
  }
  return false
}

const waitForVideoElement = async (frame: Frame, isCancelled: () => boolean) => {
  while (!isCancelled()) {
    try {
      if (await frame.locator('video').exists()) return await frame.locator('video').videoElement()
    } catch (err) {
      // terminal: the cloud path rejects videoElement, so surface it instead of polling forever
      if ((err as Error | null)?.name === 'LocatorUnsupportedError') throw err
    }
    await new Promise(r => setTimeout(r, 200))
  }
  return null
}

const styles = css`
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  user-select: none;
  -webkit-user-select: none;

  .nf-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
    /* Netflix's own chrome is hidden, so the iframe must not swallow taps -
       they belong to the skin's gesture layer stacked above it. */
    pointer-events: none;
  }

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.6rem;
    background: #000;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.8);
    z-index: 30;
  }

  .login-button {
    padding: 0.8rem 2rem;
    background: #e50914;
    color: #fff;
    border: none;
    border-radius: 0.4rem;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      background: #c11119;
    }
  }
`

const NetflixPlayer = ({ url }: PlayerProps) => {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggedOut, setLoggedOut] = useState(false)
  const [error, setError] = useState<string>()
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoElement | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!iframe) return
    let cancelled = false
    ;(async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          // the browser's own cookies, which only the extension serves: the cloud render proxy cannot hand back a RemoteVideoElement
          const f = await attachFrame({ iframe, domains: NETFLIX_DOMAINS, cookies: 'native' })
          if (cancelled) return
          setFrame(f)
          return
        } catch (err) {
          if (cancelled) return
          // with no extension the lib already showed its install prompt, so no retry shows it again
          if (!isExtensionExposed()) {
            setError('Netflix playback currently needs the FKN browser extension.')
            setLoading(false)
            return
          }
          if (attempt >= 4) {
            console.error('Failed to attach Netflix frame', err)
            setError(err instanceof Error ? err.message : 'Failed to load player')
            setLoading(false)
            return
          }
          await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
        }
      }
    })()
    return () => { cancelled = true }
  }, [iframe])

  useEffect(() => {
    if (!frame) return
    let cancelled = false
    const isCancelled = () => cancelled
    setLoading(true)
    setError(undefined)
    setLoggedOut(false)
    setRemoteVideo(null)
    ;(async () => {
      await frame.goto(url, { waitUntil: 'load' })
      await waitForContentScript(() => frame.addStyleTag({ content: NETFLIX_OUTER_CSS }))
      if (cancelled) return
      setLoading(false)
      const isLoggedIn = await checkIsLoggedIn(frame)
      if (cancelled) return
      if (!isLoggedIn) {
        setLoggedOut(true)
        return
      }
      const video = await waitForVideoElement(frame, isCancelled)
      if (cancelled || !video) return
      setRemoteVideo(video)
    })().catch(err => {
      if (cancelled) return
      console.error('Failed to load Netflix player', err)
      setError(err?.message ?? 'Failed to load player')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [frame, url, reloadKey])

  const openLogin = useCallback(() => {
    const popup = globalThis.open(NETFLIX_LOGIN_URL, '_blank', 'width=500,height=700')
    if (!popup) return
    const interval = setInterval(() => {
      if (!popup.closed) return
      clearInterval(interval)
      setReloadKey(k => k + 1)
    }, 500)
  }, [])

  const overlay = (loggedOut || error || loading) && (
    <div className="overlay">
      {loggedOut && (
        <>
          You need to be logged in to Netflix to watch this content.
          <button className="login-button" onClick={openLogin}>
            Open Netflix Login Page
          </button>
        </>
      )}
      {error && !loggedOut && error}
      {loading && !error && !loggedOut && 'Loading Netflix player...'}
    </div>
  )

  // the iframe is always mounted inside the skin's Container so attachFrame has it from the start
  return (
    <div css={styles}>
      <NetflixVideoJSPlayer remote={remoteVideo} frame={frame}>
        <iframe
          ref={setIframe}
          className="nf-frame"
          referrerPolicy="no-referrer"
          allow="encrypted-media; autoplay; fullscreen;"
        />
      </NetflixVideoJSPlayer>
      {overlay}
    </div>
  )
}

export default NetflixPlayer
export { NETFLIX_DOMAINS, NETFLIX_OUTER_CSS }
