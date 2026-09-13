import type { Resolvers as WorkerResolvers } from './worker/yoga'
import type { FetchInit } from './worker/backoff'

import { expose }  from 'osra'

// @ts-expect-error
import Worker from './worker/index?worker'
import { fetch } from './utils/fetch'
import { readsLegacyStore, refusesSeedAsset } from './utils/export-flag'

const worker = new Worker()

const resolvers = {
  // 404, never 503: `fetchWithBackoff` retries a 503 three times, and this refusal is the same shape
  // as the asset simply not being published yet, which the loader already answers undefined to.
  fetch: (input: RequestInfo | URL, init?: FetchInit) =>
    refusesSeedAsset(location.href, input)
      ? new Response(null, { status: 404, statusText: 'the season seed is switched off for this page' })
      : fetch(input, init)
}

export type Resolvers = typeof resolvers

expose<typeof resolvers>(
  resolvers,
  {
    transport: worker,
    key: 'fetch'
  }
)

const { handleRequest, setUserKeys, registerRemoteSource, unregisterRemoteSource, remotePicker, remotePlayer, selectRemoteRelease, exportStore, exportAnswers, exportAsks, graphCounts, traceGraph, traceAnswer, setGraphEnabled, setReadStore } = await expose<WorkerResolvers>(
  {},
  {
    transport: worker,
    key: 'yoga'
  }
)

// THE GRAPH IS THE DEFAULT STORE since 2026-09-13, and `?store=legacy` is the way back to the old
// one. It was the other way round for the whole migration, so anything written before that date
// describing `?store=graph` as the switch is describing the old default, not a second flag.
//
// The worker has no view of the page's query string, so the flags are read here and handed over as
// soon as the osra channel is up.
//
// TWO FLAGS STILL, and they are not the same question. `?graph` warms the engine, runs the ingest
// tee and the pass; the store flag decides what the app READS. They only come apart on the way back:
// `?store=legacy` alone reads the old store with no engine at all, and `?store=legacy&graph=1` reads
// the old store with the engine warm beside it, which is the shadow arrangement every measurement in
// this project used as its control. Reading the graph still implies the engine, and the worker side
// enforces that, so a page cannot ask for the reads without the engine under them.
//
// The read flag is AWAITED, and that is load bearing. `setReadStore` does not return until the engine
// has opened and the boot pass has run, measured at 1,031 ms (527 ms engine, 497 ms pass, 2026-09-12).
// Left as a bare `void`, every subscription opened inside that window resolves its store ONCE at
// subscribe time and keeps the legacy one for its whole life, and the home row's `mediaPage` and the
// theater's `media` both subscribe on first render and never tear down. The flag then appears to
// half-work, which is worse than not working. The engine flag keeps its `void`: nothing reads it at
// subscribe time.
const flags = new URLSearchParams(location.search)
const readsGraph = !readsLegacyStore(location.href)
if (readsGraph) await setReadStore('graph')
else void setGraphEnabled(flags.has('graph'))

export {
  handleRequest,
  setUserKeys,
  registerRemoteSource,
  unregisterRemoteSource,
  remotePicker,
  remotePlayer,
  selectRemoteRelease,
  exportStore,
  exportAnswers,
  exportAsks,
  graphCounts,
  // Section 7.5, for the `/debug/trace` page (`?trace=1` on a media view puts the link to it on
  // screen). It is NOT wired to a flag here: `traceGraph` answers `reason: 'not-enabled'` when the
  // engine is off, which is the sentence the page prints beside a reload link carrying `?graph=1`,
  // where implying the engine flag from `?trace` would warm one mid-session and show a graph built
  // from whatever arrived after the switch rather than from the page under investigation.
  traceGraph,
  traceAnswer
}
