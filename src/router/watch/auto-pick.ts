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
  /** The viewer turned the origin off, so none of its handles is picked, even one it gave before. */
  off: (origin: string) => boolean
  /** The viewer's play order, best first. An origin it does not name comes after every one it names. */
  order: readonly string[]
  /** The origin could still bring a handle: it is on, and its player or package is here. */
  possible: (origin: string) => boolean
  /** Every answer the origin will give for this media is in, so a handle it has not given it has none. */
  settled: (origin: string) => boolean
}

const playable = (handle: Handle, ways: Ways): boolean => !ways.off(handle.origin) && (
  Boolean(handle.url && ways.builtIn(handle.origin, handle.url))
  || Boolean(ways.selfPlaying && (handle.embedUrl || ways.selfPlaying(handle.origin))))

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

/** What the watch page knows of the viewer's access to each handle. */
export type Access = {
  /** Plays for the viewer here without a sign in, though it may still need the extension. */
  plays: (handle: Handle) => boolean
  /** Plays here with nothing to fix, as far as stub knows: needs no extension, and no account or one stub found the viewer signed in to. */
  free: (handle: Handle) => boolean
  /** Of a site stub has not found the viewer signed in to on this browser since their last sign out in stub, whose one fix here is that sign in. For an added source, `PluginAccounts.neverSignedIn`. */
  neverSignedIn: (handle: Handle) => boolean
}

/**
 * `bestSource` for a viewer who may have to sign in first. A favourite they never signed in to gives way
 * to the best ranked `free` handle, and while there is none and an added source could still bring one
 * (`pending`), Play opens nothing. Otherwise Play opens nothing while none of `plays` plays, unless it is
 * `moving` on from its own pick that cannot play, and once the page has asked the viewer to sign in or add
 * a source (`asked`), it opens only one of those. `stuck` while none plays and either every source has
 * answered (`answered`) or the page has asked.
 */
export const playPick = (
  handles: readonly Handle[],
  ways: Ways,
  { plays, free, neverSignedIn }: Access,
  { answered, asked, moving, pending }: { answered: boolean, asked: boolean, moving: boolean, pending: boolean },
) => {
  const playing = bestSource(handles.filter(plays), ways)
  const favourite = bestSource(handles, ways)
  const top = handles.find(handle => handle.uri === favourite?.uri)
  const yields = Boolean(top && neverSignedIn(top))
  const instead = yields ? bestSource(handles.filter(free), ways) : undefined
  const pick = instead ?? (yields && pending ? undefined : asked ? playing : playing || moving ? favourite : undefined)
  return { pick, stuck: !playing && (answered || asked) }
}

/**
 * Writes `best` into the address with a replace, so Back skips it, once it is `now`. Never while the
 * address names a source, unless it is this hook's own pick, not left for another source since, and
 * `cannotPlay` says it cannot play the episode here: `best` must then leave that source out. Never for a
 * party guest, who follows the host's address. The address keeps its query string `search`, such as the
 * second a scene search starts the player at.
 */
export const useAutoPick = (
  best: { uri: string, now: boolean } | undefined,
  { mediaUri, episodeUri, sourceUri, guest, cannotPlay, search }: { mediaUri: string, episodeUri: string, sourceUri?: string, guest: boolean, cannotPlay?: boolean, search?: string },
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
    const path = getRoutePath(Route.WATCH, { mediaUri, episodeUri, sourceUri: armed })
    navigate(search ? `${path}?${search}` : path, { replace: true })
  }, [armed, mediaUri, episodeUri])
}
