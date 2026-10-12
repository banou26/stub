import type { Client, Exchange, OperationResult, OperationResultSource } from 'urql'

import { filter, fromValue, lazy, merge, pipe, subscribe, take, tap, toPromise } from 'wonka'

/**
 * A subscription mounted after an identical one has answered starts from that answer.
 *
 * urql replays a past result to a late subscriber of an identical QUERY only, and never sends an operation that is
 * already running again (`executeRequestOperation`, @urql/core 5.2.0, unchanged in 6.0.3), so the late subscriber
 * waited for a next answer a settled page never sends. An exchange alone cannot fix it, since the late subscriber
 * dispatches nothing: `exchange` records each running subscription's last result, and `replay` wraps the client so
 * a subscriber starts from it.
 */
export const subscriptionReplay = () => {
  const latest = new Map<number, OperationResult>()

  const exchange: Exchange = ({ forward }) => operations$ => pipe(
    forward(pipe(operations$, tap(operation => { if (operation.kind === 'teardown') latest.delete(operation.key) }))),
    tap(result => { if (result.operation.kind === 'subscription') latest.set(result.operation.key, result) }),
  )

  const replay = (client: Client) => {
    const execute = client.executeRequestOperation.bind(client)
    client.executeRequestOperation = (operation => {
      const results = execute(operation)
      if (operation.kind !== 'subscription') return results
      // read when a subscriber starts, not when the source is made
      const source = lazy(() => {
        const last = latest.get(operation.key)
        return last ? merge([fromValue(last), results]) : results
      })
      const settled = () => toPromise(pipe(source, filter(result => !result.stale && !result.hasNext), take(1)))
      return Object.assign(source, {
        toPromise: settled,
        // oxlint-disable-next-line unicorn/no-thenable
        then: ((onFulfilled, onRejected) => settled().then(onFulfilled, onRejected)) as OperationResultSource<OperationResult>['then'],
        subscribe: (onResult: (result: OperationResult) => void) => pipe(source, subscribe(onResult)),
      })
    }) as Client['executeRequestOperation']
    return client
  }

  return { exchange, replay }
}
