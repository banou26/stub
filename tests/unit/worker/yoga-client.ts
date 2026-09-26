import type { YogaServerInstance } from 'graphql-yoga'

import { createSchema, createYoga } from 'graphql-yoga'

import { typeDefs } from '../../../src/generated/schema/typeDefs.generated'
import { defaultResolvers } from '../../../src/worker/extractor-defaults'
import { merge } from '../../../src/utils/merge'

/**
 * A provider server built the way `makeExtractor` builds one, minus what that module cannot load
 * under vitest: the same generated typeDefs, and the same defaults merged under the provider's own
 * resolvers. Neither the response cache nor the ingest hook is here, which is the tracker's shape.
 */
export const providerServer = (origin: string, resolvers: object, context: Record<string, unknown> = {}) => {
  const server = createYoga({
    schema: createSchema({
      typeDefs,
      resolvers: merge(
        defaultResolvers({ id: origin, url: null, name: origin, icon: null, color: null, isApiOnly: true }),
        resolvers as Record<string, unknown>,
      ) as never,
    }),
    maskedErrors: false,
    logging: false,
  })
  return { server, context }
}

const request = (query: string, variables: unknown, signal?: AbortSignal) =>
  new Request('http://d/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ query, variables }),
    signal,
  })

/**
 * The half of an urql client the fan-out and the app's mutations use, over a yoga server: each
 * subscription streams its payloads to the sink as they arrive, and unsubscribing aborts it.
 */
export const yogaClient = ({ server, context }: { server: YogaServerInstance<any, any>, context: Record<string, unknown> }) => ({
  subscription: (query: string, variables: unknown) => ({
    subscribe: (sink: (result: any) => void) => {
      const controller = new AbortController()
      void (async () => {
        const response = await server.handleRequest(request(query, variables, controller.signal), { ...context })
        if (response.status === 204 || !response.body) return
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
        let buffer = ''
        try {
          for (;;) {
            const { value, done } = await reader.read()
            if (done) return
            buffer += value
            let end: number
            while ((end = buffer.indexOf('\n\n')) !== -1) {
              const event = buffer.slice(0, end)
              buffer = buffer.slice(end + 2)
              const data = /^data: (.+)$/m.exec(event)?.[1]
              if (data) sink(JSON.parse(data))
            }
          }
        } catch {
          // aborted by unsubscribe
        }
      })()
      return { unsubscribe: () => controller.abort() }
    },
  }),
  mutation: (query: string, variables: unknown) => ({
    toPromise: async () => {
      const response = await server.handleRequest(
        new Request('http://d/graphql', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ query, variables }),
        }),
        { ...context },
      )
      return await response.json()
    },
  }),
})

/** Every payload of one subscription, until it ends or `count` have arrived. */
export const payloads = async (
  { server, context }: { server: YogaServerInstance<any, any>, context: Record<string, unknown> },
  query: string,
  variables: unknown,
  count = Infinity,
) => {
  const controller = new AbortController()
  const response = await server.handleRequest(request(query, variables, controller.signal), { ...context })
  const results: any[] = []
  if (response.status === 204 || !response.body) return { status: response.status, results }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  while (results.length < count) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let end: number
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      const data = /^data: (.+)$/m.exec(buffer.slice(0, end))?.[1]
      buffer = buffer.slice(end + 2)
      if (data) results.push(JSON.parse(data))
    }
  }
  controller.abort()
  await reader.cancel().catch(() => {})
  return { status: response.status, results }
}
