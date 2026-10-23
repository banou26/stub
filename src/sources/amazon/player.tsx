import type { DelegatedTracks } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'

import type { PlayerProps } from '../players'
import type { PrimePageSelectors, PrimeQualityRow, PrimeQualitySelectors } from './prime-page'

import { css, keyframes } from '@emotion/react'
import { attachFrame } from '@fkn/lib'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { tellUnplayable } from '../../embed-unplayable'
import { siteStatuses } from '../../tracking/site-status'
import { attachCookies, detectBackend, type FknBackend } from '../../utils/fkn-backend'
import { signInThroughWindow } from '../login-window'
import PrimeMediaPlayer from './prime-media-player'
import { findPrimeVideo, pressPrimePlay, primeQuality, readPrimePage } from './prime-page'
import { PRIME_DOMAINS, PRIME_SIGN_IN_LINK, primeSignedIn, primeSignInUrl, primeSiteOf } from './session'

const PAGE: PrimePageSelectors = {
  play: '[data-testid="dp-atf-play-button"]',
  signIn: PRIME_SIGN_IN_LINK,
  // the action box's TVOD forms, `ab-episode-tvod_rental` for an episode to rent, the same in English and
  // Japanese; the episode list's own carry `el-` and are other episodes' (measured 2026-10-13)
  rent: '[data-automation-id^="ab-"][data-automation-id*="tvod"]',
}

// the player's video only: the detail page's muted hero video plays outside it, in `.draper-player-container`
const VIDEOS = '#dv-web-player video'

// Amazon's player SDK's settings menu (ATVWebPlayerSDK-1.0, read 2026-10-26), whose Video Quality offers
// good, better and best. Driven on a trailer signed out the same day, under PRIME_OUTER_CSS: the controls
// came up on a mousemove that moved, and a pick played on without a reload.
const QUALITY: PrimeQualitySelectors = {
  reveal: '.atvwebplayersdk-loading-overlay',
  settings: '#atvwebplayersdk-settings-button',
  item: '#atvwebplayersdk-video-quality-button',
  menu: '#atvwebplayersdk-video-quality-menu',
  option: 'input[type="radio"]',
  menus: '#atvwebplayersdk-settings-menu, #atvwebplayersdk-video-quality-menu',
  timeout: 10_000,
}

// Amazon's page hidden down to the player. `#dv-web-player` and the video stay in layout, and the
// player's own controls inside it stay there too, at opacity 0.
const PRIME_OUTER_CSS = `
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  *:not(:has(#dv-web-player)):not(#dv-web-player):not(#dv-web-player *) {
    display: none !important;
  }
  #dv-web-player {
    position: fixed !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    z-index: 9999999 !important;
  }
  #dv-web-player :has(video),
  #dv-web-player video {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    height: 100% !important;
    transform: none !important;
  }
  #dv-web-player video {
    object-fit: contain !important;
  }
  #dv-web-player *:not(:has(video)):not(video) {
    opacity: 0 !important;
    pointer-events: none !important;
  }
`

const PAGE_TIMEOUT = 30_000
const VIDEO_TIMEOUT = 30_000

// JustWatch's deep link is watch?gti=; its detail?gti= twin opens the episode's page with that episode
// selected, whose Play control plays it (measured 2026-10-12)
const detailUrl = (url: string) => {
  const target = new URL(url)
  if (target.pathname === '/watch') target.pathname = '/detail'
  return target.href
}

// asks `read` until it answers, the time runs out or the load is cancelled; a read refused while the
// page moves asks again, and the wait ends on the player's own line
const poll = async <T,>(read: () => Promise<T | undefined>, isCancelled: () => boolean, timeout: number) => {
  const deadline = Date.now() + timeout
  while (!isCancelled() && Date.now() < deadline) {
    try {
      const answer = await read()
      if (answer !== undefined) return answer
    } catch (err) {
      if ((err as Error | null)?.name === 'LocatorUnsupportedError') throw err
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return undefined
}

const spin = keyframes`
  to { transform: rotate(360deg); }
`

const styles = css`
  position: relative;
  width: 100%;
  height: 100%;
  background: #000;
  user-select: none;
  -webkit-user-select: none;

  .pv-frame {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: none;
    background: #000;
    /* taps belong to the player's controls stacked above it */
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
    background: #00a8e1;
    color: #fff;
    border: none;
    border-radius: 0.4rem;
    font-size: 1.4rem;
    font-weight: 600;
    text-decoration: none;
    cursor: pointer;

    &:hover {
      background: #0090c2;
    }

    &:disabled {
      opacity: 0.6;
      cursor: default;
    }
  }

  .loading-spinner {
    box-sizing: border-box;
    width: calc(4 * var(--mp-unit, 10px));
    height: calc(4 * var(--mp-unit, 10px));
    border-radius: 50%;
    border: 3px solid rgba(255, 255, 255, 0.25);
    border-top-color: #fff;
    animation: ${spin} 0.8s linear infinite;
  }
`

const PrimeVideoPlayer = ({ url, title }: PlayerProps) => {
  const intl = useIntl()
  const site = primeSiteOf(url)!
  const [mode, setMode] = useState<'detecting' | FknBackend>('detecting')
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null)
  const [frame, setFrame] = useState<Frame | null>(null)
  const [loading, setLoading] = useState(true)
  const [loggedOut, setLoggedOut] = useState(false)
  const [rentOnly, setRentOnly] = useState(false)
  const [error, setError] = useState<string>()
  const [remoteVideo, setRemoteVideo] = useState<RemoteVideoElement | null>(null)
  const [quality, setQuality] = useState<PrimeQualityRow[]>()
  const [videoIndex, setVideoIndex] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [attachKey, setAttachKey] = useState(0)
  const [signingIn, setSigningIn] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const popupWatch = useRef<ReturnType<typeof setInterval> | undefined>(undefined)
  const mounted = useRef(true)

  useEffect(() => () => {
    mounted.current = false
    clearInterval(popupWatch.current)
  }, [])

  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setMode(detected) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!iframe || mode === 'detecting') return
    let cancelled = false
    attachFrame({
      iframe,
      // FKN's card names the first domain as the site it asks for, so the link's own leads
      domains: [...PRIME_DOMAINS].sort((a, b) => Number(b === site) - Number(a === site)),
      cookies: attachCookies(mode),
      permissions: [{ category: 'evaluation', reason: 'Press Play on the episode, see whether you are signed in, switch the quality and step frames' }],
    })
      .then(attached => { if (!cancelled) setFrame(attached) })
      .catch(err => {
        if (cancelled) return
        console.error('Failed to attach Prime Video frame', err)
        setError(err?.message || intl.formatMessage({ id: 'Failed to load player', defaultMessage: 'Failed to load player' }))
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [iframe, mode, site])

  useEffect(() => {
    if (!frame) return
    let cancelled = false
    const isCancelled = () => cancelled
    setLoading(true)
    setError(undefined)
    setLoggedOut(false)
    setRentOnly(false)
    setRemoteVideo(null)
    setQuality(undefined)
    ;(async () => {
      await frame.goto(detailUrl(url), { waitUntil: 'commit' })
      const page = await poll(async () => {
        const state = await frame.evaluate(readPrimePage, PAGE)
        return state === 'pending' ? undefined : state
      }, isCancelled, PAGE_TIMEOUT)
      if (cancelled) return
      if (page) siteStatuses.record('prime', page === 'signed-out' ? 'signed-out' : 'signed-in')
      if (page === 'signed-out') {
        setLoading(false)
        setLoggedOut(true)
        return
      }
      if (page === 'rent') {
        setLoading(false)
        setRentOnly(true)
        tellUnplayable()
        return
      }
      if (!page) throw new Error(intl.formatMessage({ id: 'Prime Video shows no Play button for this episode.', defaultMessage: 'Prime Video shows no Play button for this episode.' }))
      await frame.evaluate(pressPrimePlay, PAGE)
      const found = await poll(async () => {
        const index = await frame.evaluate(findPrimeVideo, { videos: VIDEOS })
        return index < 0 ? undefined : { index, video: await frame.locator(VIDEOS).nth(index).videoElement() }
      }, isCancelled, VIDEO_TIMEOUT)
      if (cancelled) return
      if (!found) throw new Error(intl.formatMessage({ id: 'The episode did not load a player.', defaultMessage: 'The episode did not load a player.' }))
      // only now: a Play that loads a new document would drop a style added before it
      await frame.addStyleTag({ content: PRIME_OUTER_CSS })
      if (cancelled) return
      setLoading(false)
      setVideoIndex(found.index)
      setRemoteVideo(found.video)
      // a quality menu that does not open costs the quality row and nothing else
      const rows = await frame.evaluate(primeQuality, QUALITY).catch(() => undefined)
      if (!cancelled) setQuality(rows)
    })().catch(err => {
      if (cancelled) return
      console.error('Failed to load Prime Video player', err)
      setError(err?.message || intl.formatMessage({ id: 'Failed to load player', defaultMessage: 'Failed to load player' }))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [frame, url, reloadKey])

  const qualityTracks = useMemo<DelegatedTracks | undefined>(() => frame && quality ? {
    selection: {
      options: quality.map(({ id, label }) => ({ id, label })),
      selectedId: quality.find(row => row.selected)?.id ?? null,
      select: async (id: string | null) => {
        if (id === null) return
        const rows = await frame.evaluate(primeQuality, { ...QUALITY, pick: id })
        if (mounted.current) setQuality(rows)
      },
    },
  } : undefined, [frame, quality])

  // a fresh iframe, since the cloud refuses to attach one it already attached
  const remount = useCallback(() => {
    setFrame(null)
    setError(undefined)
    setRemoteVideo(null)
    setLoggedOut(false)
    setRentOnly(false)
    setBlocked(false)
    setLoading(true)
    setAttachKey(key => key + 1)
  }, [])

  // through the Sign in of the site the link is on. On the extension the frame runs on the browser's own
  // session, which a popup signs in; on the cloud only an FKN window writes the jar the frame reads.
  const signIn = useCallback(() => {
    setBlocked(false)
    const signInUrl = primeSignInUrl(site)
    if (mode === 'extension') {
      const popup = globalThis.open(signInUrl, '_blank', 'width=500,height=700')
      if (!popup) return setBlocked(true)
      setSigningIn(true)
      clearInterval(popupWatch.current)
      popupWatch.current = setInterval(() => {
        if (!popup.closed) return
        clearInterval(popupWatch.current)
        setSigningIn(false)
        setReloadKey(key => key + 1)
      }, 500)
      return
    }
    // before any await: the window opens with this click's activation
    const windowSignIn = signInThroughWindow({ url: signInUrl, domains: PRIME_DOMAINS, isSignedIn: primeSignedIn })
    setSigningIn(true)
    windowSignIn
      .then(outcome => {
        if (!mounted.current) return
        if (outcome === 'blocked') return setBlocked(true)
        if (outcome === 'unsupported') return setError(intl.formatMessage({ id: 'The Prime Video sign-in window could not open here.', defaultMessage: 'The Prime Video sign-in window could not open here.' }))
        if (outcome === 'authed') return remount()
        setReloadKey(key => key + 1)
      }, err => {
        if (!mounted.current) return
        console.error('Prime Video sign-in window failed', err)
        setError(err?.message || intl.formatMessage({ id: 'The sign-in window failed', defaultMessage: 'The sign-in window failed' }))
      })
      .finally(() => { if (mounted.current) setSigningIn(false) })
  }, [mode, remount, site])

  const openOnPrime = <a className="login-button" href={detailUrl(url)} target="_blank" rel="noreferrer">{intl.formatMessage({ id: 'Open on Prime Video', defaultMessage: 'Open on Prime Video' })}</a>

  const overlay = (loading || error || loggedOut || rentOnly) && (
    <div className="overlay">
      {error
        ? (
          <>
            {error}
            <button className="login-button" onClick={remount}>{intl.formatMessage({ id: 'Retry', defaultMessage: 'Retry' })}</button>
            {openOnPrime}
          </>
        )
        : loggedOut
        ? (
          <>
            {blocked ? intl.formatMessage({ id: 'Allow popups for this page to sign in.', defaultMessage: 'Allow popups for this page to sign in.' }) : intl.formatMessage({ id: 'Sign in to {name} to watch.', defaultMessage: 'Sign in to {name} to watch.' }, { name: 'Prime Video' })}
            <button className="login-button" onClick={signIn} disabled={signingIn}>
              {signingIn ? intl.formatMessage({ id: 'Finish signing in the window...', defaultMessage: 'Finish signing in the window...' }) : intl.formatMessage({ id: 'Sign in to {name}', defaultMessage: 'Sign in to {name}' }, { name: 'Prime Video' })}
            </button>
          </>
        )
        : rentOnly
        ? (
          <>
            {intl.formatMessage({ id: 'Prime Video offers this episode only to rent or buy here.', defaultMessage: 'Prime Video offers this episode only to rent or buy here.' })}
            {openOnPrime}
          </>
        )
        : <div className="loading-spinner" role="status" aria-label={intl.formatMessage({ id: 'Loading', defaultMessage: 'Loading' })} />}
    </div>
  )

  return (
    <div css={styles}>
      {mode !== 'detecting' && (
        <PrimeMediaPlayer title={title} remote={remoteVideo} quality={qualityTracks} frame={frame} video={{ video: VIDEOS, index: videoIndex }}>
          <iframe
            key={`${mode}-${attachKey}`}
            ref={setIframe}
            className="pv-frame"
            referrerPolicy="no-referrer"
            allow="encrypted-media; autoplay; fullscreen;"
          />
        </PrimeMediaPlayer>
      )}
      {overlay}
    </div>
  )
}

export default PrimeVideoPlayer
