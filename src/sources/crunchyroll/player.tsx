import type { DelegatedTracks } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'

import type { PlayerProps } from '../players'
import type { CrunchyrollTrackKind, CrunchyrollTracks } from './cr-native-controls'

import { css } from '@emotion/react'
import { attachFrame, isExtensionExposed } from '@fkn/lib'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { signInThroughWindow } from '../login-window'
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

// state '/': returning the sign-in popup or window to the episode would start a second player there
const CRUNCHYROLL_SSO_CLIENT_ID = 'noaihdevm_6iyg0a8l0q'
const LOGIN_URL = `https://sso.crunchyroll.com/authorize?${new URLSearchParams({
  client_id: CRUNCHYROLL_SSO_CLIENT_ID,
  redirect_uri: `${BASE_URL}/callback`,
  response_type: 'cookie',
  state: '/',
})}`

const LOGIN_TIMEOUT = 30_000

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

  .login-note {
    max-width: 36rem;
    font-size: 1.2rem;
    text-align: center;
    color: rgba(255, 255, 255, 0.6);
  }
`

const CrunchyrollPlayer = ({ url }: PlayerProps) => {
  const [mode, setMode] = useState<Backend>('detecting')
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggedOut, setLoggedOut] = useState(false)
  const [error, setError] = useState<string>()
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoElement | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [attachKey, setAttachKey] = useState(0)
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupBlocked, setPopupBlocked] = useState(false)
  const popupInterval = useRef<ReturnType<typeof setInterval> | null>(null)
  const popupRef = useRef<Window | null>(null)
  const [windowOpen, setWindowOpen] = useState(false)
  const windowPending = useRef(false)
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
    setRemoteVideo(null)
    invalidateTracks()
    ;(async () => {
      if (mode === 'cloud') {
        // 'load', not 'documentstart': the render proxy applies locator calls to the committed document
        await frame.goto(url, { waitUntil: 'load' })
        if (cancelled) return
        // auth before styling: the chrome CSS hides a page with no player, so a wall must surface the login prompt, not go black
        const { isLoggedIn } = await checkIsLoggedIn(frame, isCancelled)
        if (cancelled) return
        if (!isLoggedIn) {
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
    const popup = globalThis.open(LOGIN_URL, '_blank', 'width=500,height=700')
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
  }, [])

  // the cloud frame reads this app's cloud cookie jar, which a plain popup never writes: an FKN window
  // signs in on that jar, and the reload's frame.goto pulls what the window committed
  const openLoginWindow = useCallback(() => {
    if (windowPending.current) return
    windowPending.current = true
    const signingIn = signInThroughWindow({
      url: LOGIN_URL,
      domains: CRUNCHYROLL_DOMAINS,
      isSignedIn: login => login.locator('#user-menu-authenticated').exists(),
    })
    setPopupBlocked(false)
    setWindowOpen(true)
    signingIn
      .then(outcome => {
        if (!mounted.current) return
        if (outcome === 'blocked') {
          setPopupBlocked(true)
          return
        }
        // Retry re-attaches, which moves the player to the extension if that is what refused
        if (outcome === 'unsupported') {
          setError('The Crunchyroll sign-in window could not be opened here.')
          return
        }
        // 'closed' reloads too: a read can still be pending when the viewer closes a window that already signed in
        setLoggedOut(false)
        setLoading(true)
        setReloadKey(k => k + 1)
      }, err => {
        if (!mounted.current) return
        console.error('Crunchyroll sign-in window failed', err)
        setError(err?.message || 'The sign-in window failed')
      })
      .finally(() => {
        windowPending.current = false
        if (mounted.current) setWindowOpen(false)
      })
  }, [])

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

  const overlay = (loading || error || popupBlocked || loggedOut) && (
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
            : (
              <>
                <button className="login-button" onClick={openLoginWindow} disabled={windowOpen}>
                  {windowOpen ? 'Finish signing in the window...' : 'Sign in to Crunchyroll'}
                </button>
                <span className="login-note">
                  Sign-in happens in a window served through FKN, so your browser will not autofill saved passwords or offer passkeys there.
                </span>
              </>
            )
          }
        </>
      )}
      {popupBlocked && !error && (
        <>
          The login popup was blocked. Allow popups for this page and try again.
          <button className="login-button" onClick={mode === 'extension' ? openLogin : openLoginWindow}>Open Crunchyroll Login Page</button>
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
        >
          <iframe
            key={`${mode}-${attachKey}`}
            ref={setIframe}
            className="cr-frame"
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
