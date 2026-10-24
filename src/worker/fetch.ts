import type { Resolvers } from '../worker'

import { expose } from 'osra'

import { withBackoff, type FetchInit } from './backoff'
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
 * Every upstream request an extractor makes, over whichever of the two paths the host takes.
 *
 * Nearly all of them go through the relay. The handful that do not are named, measured and costed in
 * `./direct-fetch`, for one of its two reasons: the answer is about the address that asked, or the
 * upstream's free allowance is counted per asking address, so a relay cannot supply either.
 */
export const fetch = withDirectFetch(
  relayFetch,
  (input: RequestInfo | URL, init?: FetchInit) => globalThis.fetch(input, init)
)

export const fetchWithBackoff = withBackoff(fetch)
