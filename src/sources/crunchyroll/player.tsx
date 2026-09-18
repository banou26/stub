import type { DelegatedTracks } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'

import type { PlayerProps } from '../players'
import type { CrunchyrollTrackKind, CrunchyrollTracks } from './cr-native-controls'

import { css } from '@emotion/react'
import { attachFrame, isExtensionExposed } from '@fkn/lib'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import CrunchyrollVideoJSPlayer from './cr-videojs-player'
import { discoverCrunchyrollTracks, selectCrunchyrollTrack } from './cr-native-controls'

const CRUNCHYROLL_DOMAINS = [
  'www.crunchyroll.com',
  'crunchyroll.com',
  'sso.crunchyroll.com',
  'static.crunchyroll.com'
]

// leave the scrubber (`.timeline-slider`) layout-measurable so the Bitmovin-seek adapter can drive it
const CRUNCHYROLL_OUTER_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    background: #000 !important;
  }
  *:not(:has(.video-player-wrapper)):not(.video-player-wrapper):not(.video-player-wrapper *) {
    display: none !important;
  }
  div[data-testid="player-controls-root"] {
    display: none !important;
  }
  .video-player-wrapper,
  .video-player,
  .player-container,
  .video-player-wrapper > *,
  .video-player > *,
  .player-container > * {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 9999999;
  }
  .video-player-wrapper video,
  .video-player video,
  .player-container video {
    width: 100% !important;
    height: 100% !important;
    object-fit: contain !important;
  }
  .video-player-wrapper *:not(:has(video)):not(video):not(:has(.timeline-slider)):not(.timeline-slider) {
    display: none !important;
  }
  .timeline-container,
  .timeline-container *,
  .timeline-slider {
    opacity: 0 !important;
    pointer-events: none !important;
  }
`

const BASE_URL = 'https://www.crunchyroll.com'

// returnToEpisode: the login-return poll keys on the watch page's auth markers, while returning the popup to the episode would start a second player there
const CRUNCHYROLL_SSO_CLIENT_ID = 'noaihdevm_6iyg0a8l0q'
const buildLoginUrl = (watchUrl: string, returnToEpisode: boolean) => {
  const { pathname, search } = new URL(watchUrl)
  const authorizeParams = new URLSearchParams({
    client_id: CRUNCHYROLL_SSO_CLIENT_ID,
    redirect_uri: `${BASE_URL}/callback`,
    response_type: 'cookie',
    state: returnToEpisode ? `${pathname}${search}` : '/',
  })
  return `https://sso.crunchyroll.com/authorize?${authorizeParams}`
}

const LOGIN_TIMEOUT = 30_000
const LOGIN_RETURN_TIMEOUT = 600_000

type Backend = 'detecting' | 'extension' | 'cloud'

// the layout is picked BEFORE the iframe mounts: moving the iframe between parents would tear the attached frame down
const detectBackend = async (): Promise<Backend> => {
  if (isExtensionExposed()) return 'extension'
  if (document.readyState !== 'complete') {
    await new Promise<void>(resolve => {
      const onLoad = () => {
        clearTimeout(timer)
        resolve()
      }
      const timer = setTimeout(() => {
        window.removeEventListener('load', onLoad)
        resolve()
      }, 10_000)
      window.addEventListener('load', onLoad, { once: true })
    })
  }
  await new Promise(r => setTimeout(r, 300))
  return isExtensionExposed() ? 'extension' : 'cloud'
}

// while `.shell-header` is still mounting neither auth marker has settled, so keep waiting
const checkIsLoggedIn = async (frame: Frame, isCancelled: () => boolean) => {
  const deadline = Date.now() + LOGIN_TIMEOUT
  while (!isCancelled() && Date.now() < deadline) {
    if (await frame.locator('.shell-header').exists()) {
      await new Promise(r => setTimeout(r, 100))
      continue
    }
    if (isCancelled()) throw new Error('Login state check timed out')
    const [isLoggedOut, isLoggedIn] = await Promise.all([
      frame.locator('#user-menu-anonymous').exists(),
      frame.locator('#user-menu-authenticated').exists()
    ])
    if (isLoggedIn || isLoggedOut) return { isLoggedIn, isLoggedOut }
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('Login state check timed out')
}

// the frame's URL is not observable across the authorize redirect, so poll for the authenticated header the callback drops onto the returned watch page
const waitForLoginReturn = async (frame: Frame, isCancelled: () => boolean) => {
  const deadline = Date.now() + LOGIN_RETURN_TIMEOUT
  let failures = 0
  // the callback watch page transiently renders the anonymous marker while its header hydrates, so require it across consecutive ticks
  let anonymousStreak = 0
  while (!isCancelled() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 1000))
    if (isCancelled()) return 'cancelled'
    const [settling, authed, anonymous] = await Promise.all([
      frame.locator('.shell-header').exists().catch(() => null),
      frame.locator('#user-menu-authenticated').exists().catch(() => null),
      frame.locator('#user-menu-anonymous').exists().catch(() => null),
    ])
    if (settling === null && authed === null && anonymous === null) {
      // each rejected call already blocks on the library's own ~30s retry, so three consecutive ones mean the frame is gone rather than mid-redirect; reset the streak, samples across a document replacement are not one continuously-anonymous page
      failures += 1
      anonymousStreak = 0
      if (failures >= 3) return 'lost'
      continue
    }
    failures = 0
    if (settling) {
      anonymousStreak = 0
      continue
    }
    if (authed) return 'authed'
    // only count an anonymous sample when the auth read is a definitive false: authed === null means the page is mid-redirect, so the anonymous marker is not yet trustworthy
    anonymousStreak = anonymous && authed === false ? anonymousStreak + 1 : 0
    if (anonymousStreak >= 3) return 'backout'
  }
  return 'timeout'
}

const VIDEO_TIMEOUT = 30_000
const waitForVideoElement = async (frame: Frame, isCancelled: () => boolean) => {
  const deadline = Date.now() + VIDEO_TIMEOUT
  while (!isCancelled() && Date.now() < deadline) {
    try {
      if (await frame.locator('video').exists()) {
        if (isCancelled()) return null
        return await frame.locator('video').videoElement()
      }
    } catch (err) {
      if ((err as Error | null)?.name === 'LocatorUnsupportedError') throw err
    }
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

const styles = css`
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  /* The double-tap-to-fullscreen gesture otherwise word-selects the
     skin's labels/time readouts, flashing them blue. Player chrome isn't
     meant to be selected, so suppress it across the whole player. */
  user-select: none;
  -webkit-user-select: none;

  .cr-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
    /* CR's own chrome is hidden, so the iframe must not swallow clicks -
       taps belong to the videojs gesture layer stacked above it. */
    pointer-events: none;
  }

  /* The cloud in-frame sign-in renders CR's own login form inside the frame,
     so while that flow is active the frame must take the taps. Once the
     session lands and the skin's video takes over, the frame goes back to
     pointer-events: none. */
  .cr-frame.interactive {
    pointer-events: auto;
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
    /* Above the skin's own layers (its controls/error dialog top out at
       z-index 20) so the login/loading screen fully covers them. */
    z-index: 30;
  }

  .login-button {
    padding: 0.8rem 2rem;
    background: #f47521;
    color: #fff;
    border: none;
    border-radius: 0.4rem;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;

    &:hover {
      background: #e0651a;
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }
`

const CrunchyrollPlayer = ({ url }: PlayerProps) => {
  const [mode, setMode] = useState<Backend>('detecting')
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggedOut, setLoggedOut] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [error, setError] = useState<string>()
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoElement | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [attachKey, setAttachKey] = useState(0)
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const popupInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const popupRef = useRef<Window | null>(null)
  const [tracks, setTracks] = useState<CrunchyrollTracks>()
  const trackGeneration = useRef(0)
  const trackQueue = useRef({ generation: 0, tail: Promise.resolve() })
  const mounted = useRef(true)

  const invalidateTracks = useCallback(() => {
    const generation = trackGeneration.current + 1
    trackGeneration.current = generation
    trackQueue.current = { generation, tail: Promise.resolve() }
    setTracks(undefined)
    return generation
  }, [])

  const runTrackOperation = useCallback(<T,>(generation: number, operation: () => Promise<T>) => {
    if (trackQueue.current.generation !== generation) {
      return Promise.reject(new Error('Crunchyroll track operation cancelled'))
    }
    const queue = trackQueue.current
    const next = queue.tail.then(operation)
    queue.tail = next.then(() => {}, () => {})
    return next
  }, [])

  useEffect(() => () => {
    mounted.current = false
    trackGeneration.current += 1
  }, [])

  useEffect(() => {
    let cancelled = false
    detectBackend().then(detected => { if (!cancelled) setMode(detected) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!iframe || mode === 'detecting') return
    let cancelled = false
    attachFrame({
      iframe,
      domains: CRUNCHYROLL_DOMAINS,
      permissions: [
        { category: 'interaction', reason: 'Control the Crunchyroll player from this app' },
        { category: 'storage', reason: 'Read the audio and subtitle track names' }
      ]
    })
      .then(f => {
        if (cancelled) return
        const actual: Backend = isExtensionExposed() ? 'extension' : 'cloud'
        if (actual !== mode) {
          setMode(actual)
          return
        }
        setFrame(f)
      })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to attach Crunchyroll frame', err)
        setError(err?.message || 'Failed to load player')
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [iframe, mode])

  useEffect(() => {
    if (!frame) return
    let cancelled = false
    const isCancelled = () => cancelled
    setLoading(true)
    setError(undefined)
    setLoggedOut(false)
    setLoggingIn(false)
    setRemoteVideo(null)
    invalidateTracks()
    ;(async () => {
      if (mode === 'cloud') {
        // 'load', not 'documentstart': the render proxy applies locator calls to the committed document
        await frame.goto(url, { waitUntil: 'load' })
        if (cancelled) return
        const { isLoggedIn } = await checkIsLoggedIn(frame, isCancelled)
        if (cancelled) return
        if (isLoggedIn) {
          await frame.addStyleTag({ content: CRUNCHYROLL_OUTER_CSS })
          if (cancelled) return
          const video = await waitForVideoElement(frame, isCancelled)
          if (cancelled) return
          setLoading(false)
          if (!video) throw new Error('The episode did not load a player. It may be unavailable or require a different plan.')
          setRemoteVideo(video)
          return
        }
        // the proxied frame reads the render proxy's own cookie jar, which an out-of-frame popup never writes, so the sign-in must run inside the frame
        setLoading(false)
        setLoggedOut(true)
        setLoggingIn(true)
        await frame.goto(buildLoginUrl(url, true), { waitUntil: 'load' })
        const outcome = await waitForLoginReturn(frame, isCancelled)
        if (cancelled) return
        setLoggingIn(false)
        if (outcome === 'backout') {
          setLoggedOut(true)
          setLoading(false)
          return
        }
        if (outcome === 'lost') throw new Error('Lost the connection to the player frame')
        if (outcome !== 'authed') throw new Error('Sign-in was not completed in time')
        // re-check auth before styling: the chrome CSS hides a page with no player, so a wall must surface the login prompt, not go black
        setLoading(true)
        setLoggedOut(false)
        await frame.goto(url, { waitUntil: 'load' })
        if (cancelled) return
        const { isLoggedIn: stillAuthed } = await checkIsLoggedIn(frame, isCancelled)
        if (cancelled) return
        if (!stillAuthed) {
          setLoading(false)
          setLoggedOut(true)
          return
        }
        await frame.addStyleTag({ content: CRUNCHYROLL_OUTER_CSS })
        if (cancelled) return
        const video = await waitForVideoElement(frame, isCancelled)
        if (cancelled) return
        setLoading(false)
        if (!video) throw new Error('The episode did not load a player. It may be unavailable or require a different plan.')
        setRemoteVideo(video)
        return
      }
      await frame.goto(url, { waitUntil: 'documentstart' })
      if (cancelled) return
      await frame.addStyleTag({ content: CRUNCHYROLL_OUTER_CSS })
      if (cancelled) return
      const { isLoggedIn } = await checkIsLoggedIn(frame, isCancelled)
      if (cancelled) return
      if (!isLoggedIn) {
        setLoading(false)
        setLoggedOut(true)
        return
      }
      const video = await waitForVideoElement(frame, isCancelled)
      if (cancelled) return
      setLoading(false)
      if (!video) throw new Error('The episode did not load a player. It may be unavailable or require a different plan.')
      setRemoteVideo(video)
    })().catch(err => {
      if (cancelled) return
      console.error('Failed to load Crunchyroll player', err)
      setError(err?.message || 'Failed to load player')
      setLoading(false)
      setLoggingIn(false)
    })
    return () => { cancelled = true }
  }, [frame, url, reloadKey, mode, invalidateTracks])

  useEffect(() => {
    if (!frame || !remoteVideo) return
    const generation = invalidateTracks()
    let cancelled = false
    const isCancelled = () => cancelled || !mounted.current || generation !== trackGeneration.current

    void (async () => {
      let lastError: unknown
      let discovered: CrunchyrollTracks | undefined
      for (let attempt = 0; attempt < 5 && !isCancelled(); attempt += 1) {
        try {
          discovered = await runTrackOperation(
            generation,
            () => discoverCrunchyrollTracks(frame, isCancelled),
          )
          lastError = undefined
          if (isCancelled()) return
          setTracks(discovered)
          if (discovered.audio && discovered.subtitles) return
        } catch (err) {
          lastError = err
        }
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (!discovered && lastError) throw lastError
    })().then(
      () => {},
      err => { if (!isCancelled()) console.warn('[cr] track discovery failed:', err) },
    )

    return () => { cancelled = true }
  }, [frame, remoteVideo, invalidateTracks, runTrackOperation])

  const trackSession = trackGeneration.current
  const selectTrack = useCallback((kind: CrunchyrollTrackKind, id: string | null) => {
    if (!frame || !remoteVideo) return Promise.reject(new Error('Crunchyroll player is not ready'))
    const isCancelled = () => !mounted.current || trackSession !== trackGeneration.current

    return runTrackOperation(trackSession, async () => {
      try {
        const nextTracks = await selectCrunchyrollTrack(frame, remoteVideo, kind, id, isCancelled)
        if (isCancelled()) throw new Error('Crunchyroll track operation cancelled')
        setTracks(nextTracks)
      } catch (err) {
        if (!isCancelled()) {
          try {
            const currentTracks = await discoverCrunchyrollTracks(frame, isCancelled)
            if (!isCancelled()) setTracks(currentTracks)
          } catch {}
        }
        throw err
      }
    })
  }, [frame, remoteVideo, runTrackOperation, trackSession])

  // Crunchyroll's own track shape is already a DelegatedSelection but for the callback name, so this
  // is a rename rather than a translation. The `select` promise is handed over unresolved on purpose:
  // a switch here drives Crunchyroll's menu and takes seconds, and the player's menu is the only
  // thing that can hold itself open, withhold the tick, and report a failure.
  //
  // Memoized for the same reason the media is: a fresh object every render re-publishes the whole
  // track list to the store on every paint.
  const subtitles = useMemo<DelegatedTracks | undefined>(
    () => tracks?.subtitles && {
      selection: { ...tracks.subtitles, select: (id: string | null) => selectTrack('subtitles', id) },
    },
    [tracks?.subtitles, selectTrack],
  )
  const audioTracks = useMemo<DelegatedTracks | undefined>(
    () => tracks?.audio && {
      selection: { ...tracks.audio, select: (id: string | null) => selectTrack('audio', id) },
    },
    [tracks?.audio, selectTrack],
  )

  // the extension frame shares the user's real browser session, so a popup on the real site sets the cookie the frame uses
  const openLogin = useCallback(() => {
    if (popupInterval.current !== null) return
    const popup = globalThis.open(buildLoginUrl(url, false), '_blank', 'width=500,height=700')
    if (!popup) {
      setPopupBlocked(true)
      setLoading(false)
      return
    }
    setPopupBlocked(false)
    setPopupOpen(true)
    popupRef.current = popup
    const interval = setInterval(() => {
      if (!popup.closed) return
      clearInterval(interval)
      if (popupInterval.current === interval) popupInterval.current = null
      if (popupRef.current === popup) popupRef.current = null
      setPopupOpen(false)
      setReloadKey(k => k + 1)
    }, 500)
    popupInterval.current = interval
  }, [url])

  // leave the popup itself open: closing it mid sign-in would abort the SSO before the shared session cookie is set
  useEffect(() => () => {
    if (popupInterval.current !== null) {
      clearInterval(popupInterval.current)
      popupInterval.current = null
    }
  }, [])

  useEffect(() => {
    if (popupInterval.current !== null) {
      clearInterval(popupInterval.current)
      popupInterval.current = null
      setPopupOpen(false)
    }
    setPopupBlocked(false)
  }, [url])

  // bumping attachKey remounts the iframe so attachFrame runs against a fresh element: the cloud backend refuses to re-attach an iframe it already attached
  const retry = useCallback(() => {
    if (popupRef.current !== null) {
      popupRef.current.close()
      popupRef.current = null
    }
    if (popupInterval.current !== null) {
      clearInterval(popupInterval.current)
      popupInterval.current = null
    }
    setFrame(null)
    setError(undefined)
    setRemoteVideo(null)
    invalidateTracks()
    setLoggedOut(false)
    setPopupBlocked(false)
    setPopupOpen(false)
    setLoading(true)
    setAttachKey(k => k + 1)
  }, [invalidateTracks])

  const retryLogin = useCallback(() => {
    setLoggedOut(false)
    setLoading(true)
    setReloadKey(k => k + 1)
  }, [])
  const overlay = (loading || error || popupBlocked || (loggedOut && !loggingIn)) && (
    <div className="overlay">
      {loggedOut && !error && !popupBlocked && (
        <>
          You need to be logged in to Crunchyroll to watch this content.
          {mode === 'extension'
            ? (
              <button className="login-button" onClick={openLogin} disabled={popupOpen}>
                {popupOpen ? 'Finish signing in the popup...' : 'Open Crunchyroll Login Page'}
              </button>
            )
            : <button className="login-button" onClick={retryLogin}>Try signing in again</button>
          }
        </>
      )}
      {popupBlocked && !error && (
        <>
          The login popup was blocked. Allow popups for this page and try again.
          <button className="login-button" onClick={openLogin}>Open Crunchyroll Login Page</button>
        </>
      )}
      {error && (
        <>
          {error}
          <button className="login-button" onClick={retry}>Retry</button>
        </>
      )}
      {loading && !error && !loggedOut && 'Loading Crunchyroll player...'}
    </div>
  )

  return (
    <div css={styles}>
      {mode !== 'detecting' && (
        <CrunchyrollVideoJSPlayer
          remote={remoteVideo}
          frame={frame}
          subtitles={subtitles}
          audioTracks={audioTracks}
          // While the cloud sign-in runs, Crunchyroll's own form is what the viewer has to reach and
          // the frame is deliberately interactive. A control bar for a media that has not loaded yet
          // would sit over the bottom of that form and take the clicks.
          controls={!loggingIn}
        >
          <iframe
            key={`${mode}-${attachKey}`}
            ref={setIframe}
            className={`cr-frame${loggingIn ? ' interactive' : ''}`}
            referrerPolicy="no-referrer"
            allow="encrypted-media; autoplay; fullscreen;"
          />
        </CrunchyrollVideoJSPlayer>
      )}
      {overlay}
    </div>
  )
}

export default CrunchyrollPlayer
