import type { PlaybackLink } from '../../party/bridge'

import { useEffect, useRef } from 'preact/hooks'

import { newestPosition, RESUME_FROM, savePosition } from '../../utils/watch-positions'

/**
 * Keeps where the player of `sourceUri` stopped on each of its reports (utils/watch-positions.ts), and
 * once per player, at its first report with a length, seeks it to the newest point kept for any of
 * `uris`, the episode's sources. Not when it is already RESUME_FROM seconds in, which is a site that
 * resumed by itself, nor for a party `guest`, who follows the host.
 *
 * The link reports no `loadedmetadata`, so that first report can be the first heartbeat, a few seconds in.
 */
export const useResume = (link: PlaybackLink | undefined, sourceUri: string | undefined, uris: readonly string[], guest: boolean) => {
  const latest = useRef({ uris, guest })
  latest.current = { uris, guest }

  useEffect(() => {
    if (!link || !sourceUri) return
    let asked = false
    return link.onReport(state => {
      const duration = link.duration?.()
      if (!asked && duration !== 0) {
        asked = true
        const [, time] = newestPosition(latest.current.uris) ?? []
        if (time !== undefined && !latest.current.guest && state.time < RESUME_FROM && (!duration || time < duration)) {
          link.apply({ ...state, time, at: Date.now() })
        }
      }
      savePosition(sourceUri, { time: state.time, duration, ended: link.ended?.() })
    })
  }, [link, sourceUri])
}
