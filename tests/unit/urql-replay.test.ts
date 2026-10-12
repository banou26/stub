import type { Exchange } from 'urql'

import { describe, expect, test } from 'vite-plus/test'
import { Client, gql, makeResult } from 'urql'
import { filter, fromValue, merge, mergeMap, never, pipe, share, subscribe, takeUntil } from 'wonka'

import { subscriptionReplay } from '../../src/urql-replay'

const ORIGINS = gql`subscription Origins($ids: [String!]!) { origins(ids: $ids) { id } }`

// the worker as a settled page sees it: each subscription answered once, then open and silent until torn down
const answersOnce = (sent: number[]): Exchange => () => operations$ => {
  const shared = pipe(operations$, share)
  return pipe(
    shared,
    filter(operation => operation.kind === 'subscription'),
    mergeMap(operation => {
      sent.push(operation.key)
      const answer = sent.length
      return pipe(
        merge([fromValue(makeResult(operation, { data: { origins: [{ id: `answer ${answer}` }] } })), never]),
        takeUntil(pipe(shared, filter(next => next.kind === 'teardown' && next.key === operation.key))),
      )
    }),
  )
}

const clientOf = (sent: number[]) => {
  const replay = subscriptionReplay()
  return replay.replay(new Client({ url: 'http://stub.test/graphql', exchanges: [replay.exchange, answersOnce(sent)] }))
}

const ids = (data: unknown) => (data as { origins: { id: string }[] }).origins.map(origin => origin.id)

describe('a subscription identical to one already running', () => {
  test('starts from the answer the running one already had, and sends nothing new', async () => {
    const sent: number[] = []
    const client = clientOf(sent)
    const first: string[][] = []
    const late: string[][] = []
    const a = pipe(client.subscription(ORIGINS, { ids: ['cr'] }), subscribe(result => first.push(ids(result.data))))
    await expect.poll(() => first).toEqual([['answer 1']])
    const b = pipe(client.subscription(ORIGINS, { ids: ['cr'] }), subscribe(result => late.push(ids(result.data))))
    await expect.poll(() => late).toEqual([['answer 1']])
    expect(sent, 'the running subscription is shared, not sent again').toHaveLength(1)
    expect(first, 'and the first subscriber is not answered twice').toEqual([['answer 1']])
    a.unsubscribe()
    b.unsubscribe()
  })

  test('once every subscriber has left, a new one is sent again and never handed the old answer', async () => {
    const sent: number[] = []
    const client = clientOf(sent)
    const first: string[][] = []
    const again: string[][] = []
    const a = pipe(client.subscription(ORIGINS, { ids: ['cr'] }), subscribe(result => first.push(ids(result.data))))
    await expect.poll(() => first).toEqual([['answer 1']])
    a.unsubscribe()
    const b = pipe(client.subscription(ORIGINS, { ids: ['cr'] }), subscribe(result => again.push(ids(result.data))))
    await expect.poll(() => again).toEqual([['answer 2']])
    expect(sent).toHaveLength(2)
    b.unsubscribe()
  })

  test('a different subscription is not handed another one\'s answer', async () => {
    const sent: number[] = []
    const client = clientOf(sent)
    const cr: string[][] = []
    const nf: string[][] = []
    const a = pipe(client.subscription(ORIGINS, { ids: ['cr'] }), subscribe(result => cr.push(ids(result.data))))
    await expect.poll(() => cr).toEqual([['answer 1']])
    const b = pipe(client.subscription(ORIGINS, { ids: ['nf'] }), subscribe(result => nf.push(ids(result.data))))
    await expect.poll(() => nf).toEqual([['answer 2']])
    a.unsubscribe()
    b.unsubscribe()
  })
})
