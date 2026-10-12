import type { Exchange } from 'urql'

import { Client, fetchExchange, mapExchange } from 'urql'
import { devtoolsExchange } from '@urql/devtools'
import { cacheExchange } from '@urql/exchange-graphcache'

import { handleRequest } from './worker'
import { keyResolvers } from './urql-keys'
import { subscriptionReplay } from './urql-replay'
import introspection from './generated/graphql.schema.json'

const cache = cacheExchange({
  schema: introspection,
  keys: keyResolvers,
  resolvers: {

  }
})

const replay = subscriptionReplay()

const client = replay.replay(new Client({
  url: 'http://d/graphql',
  exchanges: [
    replay.exchange,
    mapExchange({
      onError(combinedError, operation) {
        for (const error of combinedError.graphQLErrors) {
          console.error(
            new Error(
              error.message,
              {
                cause:
                  `GQL Error originated from ${
                    operation
                      .query
                      .definitions
                      .find(def => def.kind === 'OperationDefinition')
                      ?.name
                      ?.value
                  }`
              }
            )
          )
        }
      }
    }),
    devtoolsExchange,
    cache as Exchange,
    fetchExchange,
  ],
  fetchSubscriptions: true,
  fetch: async (input: RequestInfo | URL, init?: RequestInit) => handleRequest(input, init)
}))

export default client
