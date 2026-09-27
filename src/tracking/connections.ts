// Which sites the viewer connected on this device, and the worker's way into their session frames.
// Import free apart from types, so a test drives it over fake frames and storage; ./site-sessions.ts
// wires it to the real ones.

import type { SessionPageApi } from '../sources/anilist/session-page'
import type { WindowSignIn } from '../sources/login-window'
import type { SessionFrames } from './session-frames'
import type { SiteSessionResolvers } from './site-session'

/** The localStorage key holding the connected sites, a JSON array of site ids. */
export const CONNECTED_KEY = 'stub.sessions'

export type Connections = {
  isConnected: (site: string) => boolean
  connect: (site: string) => void
}

/**
 * A site is CONNECTED on this device once the viewer signed in to it through stub. Until then no frame
 * is attached and nothing is sent, so a viewer who never uses the site gets no consent card for it and
 * spends none of the budget the site meters per address.
 *
 * Kept in `storage` when it can be, and for this page at least when it cannot.
 */
export const createConnections = (storage: () => Pick<Storage, 'getItem' | 'setItem'>): Connections => {
  const here = new Set<string>()
  const stored = (): string[] => {
    try {
      const value: unknown = JSON.parse(storage().getItem(CONNECTED_KEY) ?? '[]')
      return Array.isArray(value) ? value.filter((site): site is string => typeof site === 'string') : []
    } catch {
      return []
    }
  }
  return {
    isConnected: site => here.has(site) || stored().includes(site),
    connect: site => {
      here.add(site)
      try {
        storage().setItem(CONNECTED_KEY, JSON.stringify([...new Set([...stored(), site])]))
      } catch {
        // kept for this page only
      }
    },
  }
}

/** The main thread's half of the worker's `sessions` channel. */
export const siteSessionResolvers = (frames: SessionFrames<SessionPageApi>, connections: Connections): SiteSessionResolvers => ({
  graphql: async (site, request) =>
    connections.isConnected(site)
      ? { kind: 'response', response: await frames.use(site, api => api.graphql(request)) }
      : { kind: 'not-connected' },
  watch: (site, listener) => { frames.watch(site, () => { void listener() }) },
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
