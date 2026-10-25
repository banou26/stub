import type { Resolvers } from '../worker'

import { expose } from 'osra'

import { withBackoff, type FetchInit } from './backoff'
import { browserFetch } from './browser-fetch'
import { withDirectFetch } from './direct-fetch'

const exposePromise = expose<Resolvers>(
  {},
  {
    transport: globalThis,
    key: 'fetch'
  }
)

/** Through the FKN relay, which asks the upstream server-side from an FKN node. The default. */
const relayFetch = (input: RequestInfo | URL, init?: FetchInit) =>
  exposePromise.then(({ fetch }) => fetch(input, init))

/**
 * Every upstream request an extractor makes, over whichever of the two paths the host takes: from the browser for the
 * hosts whose CORS lets it (`./direct-fetch` names them), through the relay for the rest.
 */
export const fetch = withDirectFetch(relayFetch, browserFetch)

export const fetchWithBackoff = withBackoff(fetch)
