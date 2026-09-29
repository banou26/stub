// What a tracker in the worker reaches a site's session through: the main thread's session frame
// (./session-frames.ts), over the `sessions` osra channel. Types only, so both threads share them
// without either bundling the other, and no site's own types.

/**
 * What a site's page script serves over its port: named methods, each taking ONE argument (an object
 * when it needs several values) and answering with something structured clone carries.
 */
export type PageApi = { [method: string]: (arg: never) => Promise<unknown> }

/** How a call may be run. */
export type CallOptions = {
  /**
   * Never run the call a second time. Without it, a call the page's next document cut short runs
   * again on the page installed there, which is right for a read and wrong for a write: a write cut
   * short may already have reached the site, so `once` rejects with the session frame's
   * `CallInterrupted` instead, and the caller finds out by reading what the site now holds.
   */
  once?: boolean
}

/**
 * One call's result. `not-connected`: the viewer has not signed in to the site through stub on this
 * device, so no frame was attached and nothing was sent.
 */
export type SiteSessionResult<T> =
  | { kind: 'response', response: T }
  | { kind: 'not-connected' }

/** A site's session as a tracker sees it, typed by the page script's api. */
export type SiteSession<Api extends PageApi> = {
  call: <M extends keyof Api & string>(
    method: M,
    arg: Parameters<Api[M]>[0],
    options?: CallOptions,
  ) => Promise<SiteSessionResult<Awaited<ReturnType<Api[M]>>>>
  /** Called when the session changed under stub (a sign in), so every answer read before it is stale. */
  onChange: (listener: () => void) => () => void
}

/** The main thread's half, exposed to the worker on the `sessions` osra key. */
export type SiteSessionResolvers = {
  call: (site: string, method: string, arg: unknown, options?: CallOptions) => Promise<SiteSessionResult<unknown>>
  watch: (site: string, listener: () => void) => void
}
