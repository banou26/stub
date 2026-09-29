// What every page script shares: serving its api over the port the app sends, and a nonce. Bundled
// into each page script (scripts/page-script.ts), so it imports nothing but osra and the port protocol
// of ./session-frames.ts, which imports nothing at runtime.

import { expose } from 'osra'

import { SESSION_INSTALL, SESSION_PORT_MESSAGE, type ServeArg } from './session-frames'

type Installed = { appOrigin: string, key: string, api: object }

const STATE = Symbol.for(SESSION_INSTALL)

/**
 * Listens on `target` for the app's port and serves `api` over each one that arrives with this
 * install's key, from the app's origin. The install is kept at `SESSION_INSTALL`, where the session
 * frame reads which key the document serves.
 *
 * Installing again in the same document (the frame reports a document twice when the page returns
 * from the back/forward cache) swaps the key and adds no second listener, so a port sent for an
 * earlier install is never served.
 */
export const installSessionServer = (
  { appOrigin, key }: Pick<ServeArg, 'appOrigin' | 'key'>,
  target: EventTarget & Record<symbol, unknown>,
  api: object,
): 'installed' | 'reinstalled' => {
  const installed = target[STATE] as Installed | undefined
  if (installed) {
    Object.assign(installed, { appOrigin, key })
    return 'reinstalled'
  }
  const state: Installed = { appOrigin, key, api }
  target[STATE] = state
  target.addEventListener('message', event => {
    const { data, origin, ports } = event as MessageEvent
    if (origin !== state.appOrigin || data?.type !== SESSION_PORT_MESSAGE || data.key !== state.key || !ports?.[0]) return
    void expose(state.api as never, { transport: ports[0] })
  })
  return 'installed'
}

/** A value no earlier request carried, so no cache keyed on the request answers it with an older one. */
export const randomNonce = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
