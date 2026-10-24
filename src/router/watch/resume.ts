import type { PlaybackLink } from '../../party/bridge'

import { useEffect, useRef } from 'preact/hooks'

import { newestPosition, positions, RESUME_FROM, savePosition } from '../../utils/watch-positions'

// the address key a scene search's link starts the player at, in whole seconds
const START_PARAM = 't'

/** A watch page's address that starts its player at `seconds`. */
export const watchFrom = (path: string, seconds: number) => `${path}?${START_PARAM}=${Math.max(0, Math.floor(seconds))}`

/** The second the address asks the player to start at, from a query string without its `?`. */
export const startOf = (search: string): number | undefined => {
  const raw = new URLSearchParams(search).get(START_PARAM)
  return raw && /^\d+$/.test(raw) ? Number(raw) : undefined
}

/**
 * Keeps where the player of `sourceUri` stopped on each of its reports (utils/watch-positions.ts), and
 * once per player, at its first report with a length, seeks it to `start` when the address names one
 * (`startOf`), or else to the newest point kept for any of `uris`, the episode's sources, but not when
 * it is already RESUME_FROM seconds in, which is a site that resumed by itself. Neither for a party
 * `guest`, who follows the host. A report where the player did not move keeps nothing. The points reach
 * the FKN account at their pace while playing, and at once at a pause, when the page is hidden and when
 * the player goes.
 *
 * The link reports no `loadedmetadata`, so that first report can be the first heartbeat, a few seconds in.
 */
export const useResume = (link: PlaybackLink | undefined, sourceUri: string | undefined, uris: readonly string[], guest: boolean, start?: number) => {
  const latest = useRef({ uris, guest, start })
  latest.current = { uris, guest, start }

  useEffect(() => {
    if (!link || !sourceUri) return
    let asked = false
    let last: number | undefined
    let paused = false
    const hidden = () => { if (document.visibilityState === 'hidden') positions.flush() }
    document.addEventListener('visibilitychange', hidden)
    const stop = link.onReport(state => {
      const duration = link.duration?.()
      if (!asked && duration !== 0) {
        asked = true
        const { uris, guest, start } = latest.current
        const time = start ?? newestPosition(uris)?.[1]
        if (time !== undefined && !guest && (start !== undefined || state.time < RESUME_FROM) && (!duration || time < duration)) {
          link.apply({ ...state, time, at: Date.now() })
        }
      }
      const ended = link.ended?.()
      // a player that did not move reports again on a party starting or ending and on a rate change,
      // and a new saved time there would put an older place over another device's newer one
      if (state.time !== last || ended) savePosition(sourceUri, { time: state.time, duration, ended })
      if (state.paused && !paused) positions.flush()
      last = state.time
      paused = state.paused
    })
    return () => {
      stop()
      document.removeEventListener('visibilitychange', hidden)
      positions.flush()
    }
  }, [link, sourceUri])
}
