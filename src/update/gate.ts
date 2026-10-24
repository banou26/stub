import type { PartyState } from '../party/store'

import { layer } from '../layers'

/** This tab's automatic reloads, as timestamps, for the loop guard. */
export const UPDATE_RELOADS_KEY = 'stub-update-reloads'
const RELOAD_LIMIT = 2
const RELOAD_WINDOW_MS = 5 * 60_000
const RECHECK_MS = 1_000

/** Where a keystroke lands, so a reload would lose what is being typed. */
const TYPING = 'textarea:not([readonly]), input:not([type=checkbox]):not([type=radio]):not([readonly]), [contenteditable]:not([contenteditable=false])'

/** Records an automatic reload and answers true, or answers false while the guard refuses one. */
const mayReload = (): boolean => {
  try {
    const now = Date.now()
    const recent = (JSON.parse(sessionStorage.getItem(UPDATE_RELOADS_KEY) ?? '[]') as number[])
      .filter(at => now - at < RELOAD_WINDOW_MS)
    if (recent.length >= RELOAD_LIMIT) return false
    sessionStorage.setItem(UPDATE_RELOADS_KEY, JSON.stringify([...recent, now]))
    return true
  } catch {
    // no record means no guard, and an unguarded reload can loop
    return false
  }
}

const safe = (party: { getState: () => PartyState }) => {
  const { status } = party.getState()
  return navigator.onLine
    && !location.pathname.startsWith('/watch/')
    && status !== 'joining' && status !== 'active'
    && !document.activeElement?.matches(TYPING)
    && ![...document.querySelectorAll('video')].some(video => !video.paused && !video.ended)
}

const showUpdating = () => {
  const page = document.createElement('div')
  page.textContent = 'Updating Stub'
  page.style.cssText = `position: fixed; inset: 0; z-index: ${layer.updating}; display: flex; align-items: center; justify-content: center; background: #0f0f0f; color: #fff; font-size: 2rem`
  document.body.append(page)
}

export type UpdateGate = {
  /** A newer build of stub, or of the FKN shell, is in place: reload onto it at the first safe moment. */
  due: () => void
}

/**
 * Stub's update gate: a due update reloads the page behind "Updating Stub" at the first safe moment,
 * and looks for that moment again every second until then. A hidden tab goes as soon as it is safe.
 *
 * SAFE when online (a reload offline is the browser's error page), off `/watch` (stub cannot read the
 * playback of the cross-origin players it frames), with no party joining or active, no text field
 * focused and no video of this page playing.
 *
 * GUARDED per tab (sessionStorage): at most two automatic reloads in five minutes. A refused reload
 * shows nothing and goes once the window has room.
 */
export const createUpdateGate = ({ party }: { party: { getState: () => PartyState } }): UpdateGate => {
  let recheck: ReturnType<typeof setInterval> | undefined
  let going = false
  const check = () => {
    if (going || !safe(party) || !mayReload()) return
    going = true
    showUpdating()
    location.reload()
  }
  return {
    due: () => {
      recheck ??= setInterval(check, RECHECK_MS)
      check()
    },
  }
}
