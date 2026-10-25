// Stands in for src/worker/browser-fetch.ts in the browser rig: a host the app asks from the browser
// (src/worker/direct-fetch.ts) is answered from the fixtures in ./fake-fetch.ts as a relayed one is, and one they hold
// nothing for is asked from the browser, where a spec's route answers or refuses it.
import type { FetchInit } from '../src/worker/backoff'

import { answer } from './fake-fetch'

export const browserFetch = async (input: RequestInfo | URL, init?: FetchInit) => await answer(input, init) ?? globalThis.fetch(input, init)
