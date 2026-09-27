// What a tracker in the worker reaches a site's session through: the main thread's session frame
// (./session-frames.ts), over the `sessions` osra channel. Types only, so both threads share them
// without either bundling the other.

import type { SessionRequest, SessionResponse } from '../sources/anilist/session-page'

/**
 * One call's result. `not-connected`: the viewer has not signed in to the site through stub on this
 * device, so no frame was attached and nothing was sent.
 */
export type SiteSessionResult =
  | { kind: 'response', response: SessionResponse }
  | { kind: 'not-connected' }

/** A site's session as a tracker sees it. */
export type SiteSession = {
  graphql: (request: SessionRequest) => Promise<SiteSessionResult>
  /** Called when the session changed under stub (a sign in), so every answer read before it is stale. */
  onChange: (listener: () => void) => () => void
}

/** The main thread's half, exposed to the worker on the `sessions` osra key. */
export type SiteSessionResolvers = {
  graphql: (site: string, request: SessionRequest) => Promise<SiteSessionResult>
  watch: (site: string, listener: () => void) => void
}
