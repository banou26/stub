// Which sites the viewer connected on this device, and the worker's way into their session frames.
// Import free apart from types, so a test drives it over fake frames, storage and channel;
// ./site-sessions.ts wires it to the real ones.

import type { WindowSignIn } from '../sources/login-window'
import type { SessionFrames } from './session-frames'
import type { PageApi, SiteSessionResolvers } from './site-session'

/** The localStorage key holding the connected sites, a JSON array of site ids. */
export const CONNECTED_KEY = 'stub.sessions'

/**
 * The BroadcastChannel a sign in to a site already connected names that site on, to every other document
 * of this browser: its write would change nothing, and a browser raises no storage event for that. A
 * change to the list goes by the storage event alone, since a channel's message can reach another
 * document before its storage has the change (measured in Chrome 155, 2026-10-19).
 */
export const CONNECTED_CHANNEL = 'stub.sessions'

export type Connections = {
  isConnected: (site: string) => boolean
  connect: (site: string) => void
  disconnect: (site: string) => void
}

/** The sites a `CONNECTED_KEY` value names. */
export const connectedSites = (raw: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(raw ?? '[]')
    return Array.isArray(value) ? value.filter((site): site is string => typeof site === 'string') : []
  } catch {
    return []
  }
}

/**
 * A site is CONNECTED on this device once the viewer signed in to it through stub. Until then no frame
 * is attached and nothing is sent, so a viewer who never uses the site gets no consent card for it and
 * spends none of the budget the site meters per address. Through FKN's render proxy that address is
 * FKN's, so the budget is shared by every viewer rather than their own.
 *
 * Kept in `storage` when it can be, and for this page at least when it cannot. A connect of a site
 * `storage` already holds is posted on `channel` instead.
 */
export const createConnections = (
  storage: () => Pick<Storage, 'getItem' | 'setItem'>,
  channel: Pick<BroadcastChannel, 'postMessage'>,
): Connections => {
  const here = new Set<string>()
  // disconnected on this page while the storage refused to forget them
  const dropped = new Set<string>()
  const stored = (): string[] => {
    try {
      return connectedSites(storage().getItem(CONNECTED_KEY))
    } catch {
      return []
    }
  }
  return {
    isConnected: site => here.has(site) || (!dropped.has(site) && stored().includes(site)),
    connect: site => {
      dropped.delete(site)
      try {
        const sites = stored()
        if (sites.includes(site)) channel.postMessage(site)
        else storage().setItem(CONNECTED_KEY, JSON.stringify([...sites, site]))
      } catch {
        // kept for this page only, never when the storage took it: it would outlive a disconnect in another tab
        here.add(site)
      }
    },
    disconnect: site => {
      here.delete(site)
      try {
        storage().setItem(CONNECTED_KEY, JSON.stringify(stored().filter(other => other !== site)))
      } catch {
        dropped.add(site)
      }
    },
  }
}

/**
 * The main thread's half of the worker's `sessions` channel: a call runs the named method of the page
 * script on the named site's page, and on no other site's.
 */
export const siteSessionResolvers = (frames: SessionFrames<PageApi>, connections: Connections): SiteSessionResolvers => ({
  call: async (site, method, arg, options) =>
    connections.isConnected(site)
      ? {
        kind: 'response',
        response: await frames.use(site, api => {
          const run = api[method]
          if (typeof run !== 'function') throw new Error(`The ${site} page serves no ${method}`)
          return run(arg as never)
        }, options),
      }
      : { kind: 'not-connected' },
  watch: (site, listener) => { frames.watch(site, () => { listener() }) },
})

/**
 * A sign in through a window, and what follows it.
 *
 * Whatever the viewer did in the window, short of the browser refusing to open it, the site is
 * connected here and its session page loaded afresh, so every answer is read again: signed in when
 * they were, signed out when they closed the window first. `unsupported` connects too: the extension
 * opens no such window, and its frames run on the browser's own session for the site.
 */
export const signInAndConnect = (
  site: string,
  signIn: () => Promise<WindowSignIn>,
  { frames, connections }: { frames: Pick<SessionFrames<unknown>, 'reload'>, connections: Connections },
): Promise<WindowSignIn> =>
  signIn().then(outcome => {
    if (outcome !== 'blocked') {
      connections.connect(site)
      frames.reload(site)
    }
    return outcome
  })

/**
 * The way back from `signInAndConnect`: the site is no longer connected here and its frame is dropped,
 * so the next call answers not-connected and the trackers that watch it read it again. The site's own
 * session is left as it is.
 */
export const disconnectAndReload = (
  site: string,
  { frames, connections }: { frames: Pick<SessionFrames<unknown>, 'reload'>, connections: Connections },
): void => {
  connections.disconnect(site)
  frames.reload(site)
}
