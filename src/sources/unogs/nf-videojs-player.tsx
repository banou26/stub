import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { Media } from '@videojs/media/dom'
import type { ComponentChildren, FunctionComponent } from 'preact'

import type { PlayerCapabilities } from '../../components/player'

import Player from '../../components/player'

// Cadmium OWNS the <video> timeline: a raw `video.currentTime` write desyncs its scheduler and trips the M7375 error screen, so we must NOT let the write reach the element at all
const NF_TIMELINE_SELECTOR = '[data-uia="timeline"]'
const NF_CANVAS_SELECTOR = '[data-uia="video-canvas"]'
const NF_PLAYER_SELECTOR = '[data-uia="player"]'
const SEEK_REASON = 'Seeks the video to the point you pick on the timeline.'
const REVEAL_REASON = 'Reveals the player controls so the timeline can be used.'
const SEEK_DEBOUNCE_MS = 140
const LAND_TOLERANCE_S = 2
const OPTIMISTIC_TIMEOUT_MS = 12_000
const REVEAL_ATTEMPTS = 26
const REVEAL_POLL_MS = 110
const NF_INTERSTITIALS: Record<string, string> = {
  'still-watching': '[data-uia="interrupt-autoplay-continue"], [data-uia="interrupter-title"]',
  'next-episode': '[data-uia="next-episode-seamless-button"], [data-uia="next-episode-seamless-button-draining"]',
  error: '[data-uia="error-container"], [data-uia="nfp-error"]',
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n)

// Netflix only re-reveals its controls on a pointermove whose coords DIFFER from the last it saw (its akira UI de-dupes by pageX/pageY), so each reveal hover must land somewhere fresh
let revealTick = 0
const nextRevealPosition = () => {
  const angle = revealTick * 1.1
  revealTick++
  return { x: 0.5 + Math.cos(angle) * 0.05, y: 0.5 + Math.sin(angle) * 0.05 }
}

const createNetflixSeekMedia = (remote: RemoteVideoElement, frame: Frame) => {
  let optimistic: number | null = null
  let debounce: ReturnType<typeof setTimeout> | undefined
  let expire: ReturnType<typeof setTimeout> | undefined

  // firing all three gates together merges them into a single consent sheet, and the real ops below then find the grants and don't re-prompt
  let permissionsPrimed = false
  const primePermissions = async () => {
    if (permissionsPrimed) return
    permissionsPrimed = true
    try {
      await Promise.all([
        frame.locator(NF_CANVAS_SELECTOR).ensure('hover', { reason: REVEAL_REASON }),
        frame.locator(NF_PLAYER_SELECTOR).ensure('hover', { reason: REVEAL_REASON }),
        frame.locator(NF_TIMELINE_SELECTOR).ensure('click', { reason: SEEK_REASON }),
      ])
    } catch (err) {
      permissionsPrimed = false
      console.warn('[nf] permission request failed:', err)
    }
  }

  const onTimeUpdate = () => {
    if (optimistic == null) return
    const real = remote.currentTime
    if (Number.isFinite(real) && Math.abs(real - optimistic) < LAND_TOLERANCE_S) {
      optimistic = null
      if (expire) clearTimeout(expire)
    }
  }
  remote.addEventListener('timeupdate', onTimeUpdate)

  const commitSeek = async (targetSeconds: number) => {
    const duration = remote.duration
    if (!Number.isFinite(duration) || duration <= 0) { console.warn('[nf] seek: duration unknown', duration); return }
    // Netflix's scrubber is a custom div, not an <input>, so CR's value-`fill` seek cannot be reused; @fkn/lib's click takes relativePosition as a 0..1 fraction of the element box, hence targetSeconds/duration with no pixel measuring
    const fraction = clamp01(targetSeconds / duration)
    // fire-and-forget on purpose: the hover/click ops below self-gate and latch onto the same consent sheet (same key+scope dedupes), so awaiting it would stall the seek for one prompt it already gets
    void primePermissions()
    const timeline = frame.locator(NF_TIMELINE_SELECTOR)
    // Netflix only mounts its controls while PLAYING and shortly after mouse activity, and the bar idle-hides ~3s after one mousemove, so re-hover
    const wasPaused = remote.paused === true
    if (wasPaused) { try { await remote.play() } catch { /* ignore */ } }
    let mounted = false
    for (let attempt = 0; attempt < REVEAL_ATTEMPTS; attempt++) {
      if (attempt % 2 === 0) {
        await frame.locator(NF_CANVAS_SELECTOR).hover({ relativePosition: nextRevealPosition(), reason: REVEAL_REASON }).catch(() => {})
        await frame.locator(NF_PLAYER_SELECTOR).hover({ relativePosition: nextRevealPosition(), reason: REVEAL_REASON }).catch(() => {})
      }
      if (await timeline.exists().catch(() => false)) { mounted = true; break }
      await sleep(REVEAL_POLL_MS)
    }
    if (!mounted) {
      const blocked = await Promise.all(
        Object.entries(NF_INTERSTITIALS).map(async ([name, sel]) =>
          (await frame.locator(sel).exists().catch(() => false)) ? name : ''),
      ).then(names => names.filter(Boolean).join(', ')).catch(() => '')
      console.warn(`[nf] seek aborted: controls never revealed${blocked ? ` (blocked by ${blocked})` : ''}`)
      if (wasPaused) { try { await remote.pause() } catch { /* ignore */ } }
      return
    }
    await timeline.click({ relativePosition: { x: fraction, y: 0.5 }, reason: SEEK_REASON })
      .catch(err => console.warn('[nf] timeline click failed:', err?.message ?? err))
    if (wasPaused) { try { await remote.pause() } catch { /* ignore */ } }
  }

  const media = new Proxy(remote, {
    get(target, prop, receiver) {
      if (prop === 'currentTime' && optimistic != null) return optimistic
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      if (prop === 'currentTime' && typeof value === 'number' && Number.isFinite(value)) {
        optimistic = value
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => { commitSeek(value).catch(err => console.warn('[nf] timeline seek failed:', err)) }, SEEK_DEBOUNCE_MS)
        if (expire) clearTimeout(expire)
        expire = setTimeout(() => { optimistic = null }, OPTIMISTIC_TIMEOUT_MS)
        return true
      }
      return Reflect.set(target, prop, value, receiver)
    },
  }) as unknown as Media

  const dispose = () => {
    remote.removeEventListener('timeupdate', onTimeUpdate)
    if (debounce) clearTimeout(debounce)
    if (expire) clearTimeout(expire)
  }

  return { media, dispose }
}

type Props = {
  remote: RemoteVideoElement | null
  frame: Frame | null
  capabilities?: PlayerCapabilities
  children?: ComponentChildren
}

const NetflixVideoJSPlayer = ({ remote, frame, capabilities, children }: Props) => (
  <Player remote={remote} frame={frame} adapter={createNetflixSeekMedia} capabilities={capabilities}>
    {children}
  </Player>
)

export default NetflixVideoJSPlayer as FunctionComponent<Props>
