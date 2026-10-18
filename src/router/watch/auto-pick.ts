// Which source a Play opens when the address names none. Imports only preact and the route paths, so
// it is tested without the watch page, which reaches the worker.

import { useEffect, useRef } from 'preact/hooks'

import { getRoutePath, Route } from '../path'

type Handle = { uri: string, origin: string, url?: string | null, embedUrl?: string | null }

/** What the watch page knows about how each origin plays. */
export type Ways = {
  /**
   * stub's own player for the origin has the url for this viewer and the viewer has not turned it off,
   * though it may still need them to sign in or to add the extension, which its player or the page then asks for.
   */
  builtIn: (origin: string, url: string) => boolean
  /** The origin's plugin plays its releases. Undefined until the worker has answered. */
  selfPlaying: ((origin: string) => boolean) | undefined
  /** The viewer's play order, best first. An origin it does not name comes after every one it names. */
  order: readonly string[]
  /** The origin could still bring a handle: it is on, and its player or package is here. */
  possible: (origin: string) => boolean
  /** Every answer the origin will give for this media is in, so a handle it has not given it has none. */
  settled: (origin: string) => boolean
}

const playable = (handle: Handle, ways: Ways): boolean =>
  Boolean(handle.url && ways.builtIn(handle.origin, handle.url))
  || Boolean(ways.selfPlaying && (handle.embedUrl || ways.selfPlaying(handle.origin)))

/**
 * What Play opens when the address names no source: the playable handle whose origin the play order
 * ranks highest, the first in the handles' order among its own. A stream the viewer must sign in to or
 * add the extension for is still theirs to open, and a release only once the plugin lookup has answered.
 * `now` once no origin ranked above it could still bring one: each has answered, or is off or not here.
 */
export const bestSource = (handles: readonly Handle[], ways: Ways): { uri: string, now: boolean } | undefined => {
  const rank = (origin: string) => {
    const at = ways.order.indexOf(origin)
    return at < 0 ? ways.order.length : at
  }
  let best: Handle | undefined
  for (const handle of handles) {
    if (playable(handle, ways) && (!best || rank(handle.origin) < rank(best.origin))) best = handle
  }
  if (!best) return undefined
  const now = ways.order.slice(0, rank(best.origin)).every(origin => !ways.possible(origin) || ways.settled(origin))
  return { uri: best.uri, now }
}

/**
 * Writes `best` into the address with a replace, so Back skips it, once it is `now`. Never while the
 * address names a source, unless it is this hook's own pick, not left for another source since, and
 * `cannotPlay` says it cannot play the episode here: `best` must then leave that source out. Never for a
 * party guest, who follows the host's address.
 */
export const useAutoPick = (
  best: { uri: string, now: boolean } | undefined,
  { mediaUri, episodeUri, sourceUri, guest, cannotPlay }: { mediaUri: string, episodeUri: string, sourceUri?: string, guest: boolean, cannotPlay?: boolean },
  navigate: (to: string, options: { replace: boolean }) => void,
) => {
  const picked = useRef<string | undefined>(undefined)
  // on the address's change alone, so it runs once this hook's own replace has landed
  useEffect(() => {
    if (sourceUri && sourceUri !== picked.current) picked.current = undefined
  }, [sourceUri])
  const open = !sourceUri || (cannotPlay && sourceUri === picked.current)
  const armed = open && !guest && best?.now ? best.uri : undefined
  useEffect(() => {
    if (!armed) return
    picked.current = armed
    navigate(getRoutePath(Route.WATCH, { mediaUri, episodeUri, sourceUri: armed }), { replace: true })
  }, [armed, mediaUri, episodeUri])
}
