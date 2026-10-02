import type { YogaInitialContext } from 'graphql-yoga'
import type { Resolvers as MainThreadResolvers } from '../worker'

import { useDeferStream } from '@graphql-yoga/plugin-defer-stream'
import { createSchema, createYoga, useErrorHandler, useExecutionCancellation } from 'graphql-yoga'
import { expose } from 'osra'

import { typeDefs } from '../generated/schema/typeDefs.generated'
import { resolvers } from './resolvers'
import { extractors, setUserKeys, registerRemoteExtractor, unregisterRemoteExtractor, remotePicker, remotePlayer, selectRemoteRelease } from './extractor'
import { exportStore } from './store/export'
import { enableGraph, exportAnswers, exportAsks, graphCounts, setReadStore, traceAnswer, traceGraph } from './graph'
import { stubTrackerLink } from '../sources/stub/tracker'

export type ServerContext = YogaInitialContext & {

}

export type UserContext = {

}

export const schema = createSchema<Omit<ServerContext, keyof YogaInitialContext>>({
  typeDefs,
  resolvers
})

export const yoga = createYoga<Omit<ServerContext, keyof YogaInitialContext>, UserContext>({
  schema,
  maskedErrors: false,
  plugins: [
    useErrorHandler(({ errors, context }) => {
      for (const error of errors) {
        console.error(new Error(`GQLError occurred on request: ${context.operationName}`, { cause: error }))
      }
    }),
    useDeferStream(),
    useExecutionCancellation()
  ]
})

export const osraResolvers = {
  handleRequest: (input: RequestInfo | URL, init?: RequestInit) =>
    yoga.handleRequest(new Request(input, init), {}),
  setUserKeys: (keys: Record<string, string>) => setUserKeys(keys),
  // The page owns the `?graph` flag and hands it over once, right after spawning the worker.
  // THE ONE PLACE THE LIVE PASS IS WIRED: `scheduler` is off by default so a caller driving
  // `runPlugins` itself can never race a pass woken by the bus (`./graph/index.ts`).
  setGraphEnabled: (enabled: boolean) => enableGraph(enabled, { scheduler: true }),
  // `?store=graph` IMPLIES `?graph`, and this is the one place that implication lives: a read path
  // over an engine nobody booted answers an empty page forever, and the failure looks like an empty
  // store rather than like a missing flag. The engine is awaited before the switch moves, so the
  // first read of the session cannot land between the two.
  setReadStore: async (store: 'graph' | 'legacy') => {
    if (store === 'graph') await enableGraph(true, { scheduler: true })
    setReadStore(store)
  },
  registerRemoteSource: async (port: MessagePort, pluginUri: string): Promise<{ ok: { sources: { origin: string, name: string }[], rejected: { origin: string, reason: string }[] } } | { error: string }> => {
    try {
      return { ok: await registerRemoteExtractor(port, pluginUri) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  },
  unregisterRemoteSource: (pluginUri: string) => unregisterRemoteExtractor(pluginUri),
  // the plugin origins are derived HERE rather than taken from the caller, so a caller cannot decline
  // to exclude them: a plugin's rows are that user's, never the product's.
  exportStore: (options?: { excludeOrigins?: string[], passThroughOrigins?: string[], uris?: string[] }) =>
    exportStore({
      ...options,
      passThroughOrigins: options?.passThroughOrigins ?? [],
      excludeOrigins: [
        ...(options?.excludeOrigins ?? []),
        ...extractors.filter(entry => entry.pluginUri).map(entry => entry.extractor.origin),
      ],
    }),
  // The answer log has no options: it is the whole log, ordered by seq, and a caller that wants a
  // subset filters it. Unlike `exportStore` there is nothing to exclude, because a plugin source's
  // answers are rows about that user's own plugin and the export is the user's own.
  exportAnswers: () => exportAnswers(),
  // The questions the app's own consumer asked through `similarMedia`, ordered by seq. Beside the
  // answer log because they answer opposite halves of one question: the answers say what a source
  // returned, the asks say what was asked and refused, which is the only record of a source that
  // returned nothing (7.3).
  exportAsks: () => exportAsks(),
  // The row count of every table, which is what the ingest of 4.2 produced from that log. Beside the
  // log rather than derived from it by a caller: the two are read in one round trip from the same
  // flush, so a page cannot see answers the ingest has not written yet.
  graphCounts: () => graphCounts(),
  // Section 7.5's panel, in ONE call per cluster. It answers a `reason` rather than throwing when the
  // flag is down or the graph is empty, unlike the three exports above: those are a walk's only way
  // to tell "off" from "empty", while the trace has a field for it and a panel that threw could not
  // draw the sentence saying which of the four it is.
  traceGraph: (uri: string) => traceGraph(uri),
  // and the one row the bundle deliberately leaves out, on demand: an `Answer`'s raw bytes.
  traceAnswer: (seq: number) => traceAnswer(seq),
  remotePicker: (origin: string) => remotePicker(origin),
  remotePlayer: (origin: string) => remotePlayer(origin),
  selectRemoteRelease: (origin: string, uris: string[]) => selectRemoteRelease(origin, uris),
  // What only the page sees, for the stub tracker's list: the page starting, coming back online or
  // unlocking the list checks which FKN account is signed in, and the page coming back into view reads
  // the other devices' files (tracking/account-link.ts). An account change the worker hears itself.
  trackerCheck: () => stubTrackerLink().then(link => link.check()),
  trackerFocused: () => stubTrackerLink().then(link => link.focused())
}

export type Resolvers = typeof osraResolvers

expose<MainThreadResolvers>(
  osraResolvers,
  {
    transport: globalThis,
    key: 'yoga'
  }
)
