import type { PageApi, SiteSession, SiteSessionResolvers } from '../tracking/site-session'

import { expose } from 'osra'

const main = expose<SiteSessionResolvers>(
  {},
  {
    transport: globalThis,
    key: 'sessions'
  }
)

const listeners = new Map<string, Set<() => void>>()

/**
 * A site's session for the trackers, held by the main thread's hidden frame on that site, typed by the
 * api its page script serves. One watch per site is registered with the main thread, on the first
 * listener, and fanned out here.
 */
export const siteSession = <Api extends PageApi>(site: string): SiteSession<Api> => ({
  call: async (method, arg, options) =>
    await (await main).call(site, method, arg, options) as Awaited<ReturnType<SiteSession<Api>['call']>>,
  onChange: listener => {
    let own = listeners.get(site)
    if (!own) {
      const created = new Set<() => void>()
      listeners.set(site, created)
      void main.then(({ watch }) => watch(site, () => { for (const each of created) each() }))
      own = created
    }
    own.add(listener)
    return () => { own.delete(listener) }
  },
})
