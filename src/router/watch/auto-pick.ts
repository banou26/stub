// Which source a Play opens when the address names none. Imports only preact and the route paths, so
// it is tested without the watch page, which reaches the worker.

import { useEffect } from 'preact/hooks'

import { getRoutePath, Route } from '../path'

type Handle = { uri: string, origin: string, url?: string | null, embedUrl?: string | null }

/** What the watch page knows about how each origin plays. */
export type Ways = {
  /** stub has its own player for the origin and the viewer has not turned it off (`canPlay`). */
  builtIn: (origin: string) => boolean
  /** The viewer was last seen signed out of the origin's site. */
  signedOut: (origin: string) => boolean
  /** The origin's plugin plays its releases. Undefined until the worker has answered. */
  selfPlaying: ((origin: string) => boolean) | undefined
}

const rankOf = (handle: Handle, ways: Ways): number | undefined =>
  ways.builtIn(handle.origin) && handle.url ? (ways.signedOut(handle.origin) ? 2 : 0)
  : handle.embedUrl || ways.selfPlaying?.(handle.origin) ? 1
  : undefined

/**
 * What Play opens when the address names no source: a stream stub plays itself, then a release a
 * source plays itself, then a stream the viewer is signed out of, each first in the handles' order.
 * `now` when nothing can outrank it. Only the first rank before the plugin lookup has answered.
 */
export const bestSource = (handles: readonly Handle[], ways: Ways): { uri: string, now: boolean } | undefined => {
  for (const rank of [0, 1, 2]) {
    if (rank > 0 && !ways.selfPlaying) return undefined
    const handle = handles.find(candidate => rankOf(candidate, ways) === rank)
    if (handle) return { uri: handle.uri, now: rank === 0 }
  }
}

/** How long a pick that is not `now` must stay the best before it opens, so a better source answering later still wins. */
export const QUIET_MS = 2_000

/**
 * Writes `best` into the address with a replace, so Back skips it. Never while the address names a
 * source, and never for a party guest, who follows the host's address.
 */
export const useAutoPick = (
  best: { uri: string, now: boolean } | undefined,
  { mediaUri, episodeUri, sourceUri, guest }: { mediaUri: string, episodeUri: string, sourceUri?: string, guest: boolean },
  navigate: (to: string, options: { replace: boolean }) => void,
) => {
  const armed = !sourceUri && !guest ? best : undefined
  useEffect(() => {
    if (!armed) return
    const go = () => navigate(getRoutePath(Route.WATCH, { mediaUri, episodeUri, sourceUri: armed.uri }), { replace: true })
    if (armed.now) return go()
    const timer = setTimeout(go, QUIET_MS)
    return () => clearTimeout(timer)
  }, [armed?.uri, armed?.now, mediaUri, episodeUri])
}
