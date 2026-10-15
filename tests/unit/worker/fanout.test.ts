// The fan-out is shared by media sources and trackers, so both of its callers are pinned here against
// fake entries: the media page's uri collection, and the per-provider hook the tracking aggregate is
// built on.
import { afterEach, describe, expect, test, vi } from 'vite-plus/test'

import { Client, fetchExchange } from '@urql/core'
import { createSchema, createYoga } from 'graphql-yoga'

import { ASK_BOUND_MS, askEntry, collectUris, createSettling, joinFanout, leaveFanout, openFanout, type FanoutEntry } from '../../../src/worker/fanout'
import { closeRoot, openRoot, resetRegistry } from '../../../src/worker/request-context'

type Fake = FanoutEntry & { asked: { query: unknown, variables: any }[], emit: (result: unknown) => void, unsubscribed: number }

const fake = (name: string): Fake => {
  const sinks: ((result: unknown) => void)[] = []
  const entry: Fake = {
    name,
    asked: [],
    unsubscribed: 0,
    emit: (result) => { for (const sink of sinks) sink(result) },
    client: {
      subscription: (query, variables) => {
        entry.asked.push({ query, variables })
        return {
          subscribe: (sink) => {
            sinks.push(sink)
            return { unsubscribe: () => { entry.unsubscribed++ } }
          },
        }
      },
    },
  }
  return entry
}

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); resetRegistry() })

describe('openFanout', () => {
  test('asks every entry passed in, and hands each result to onResult with the entry that answered', () => {
    const stub = fake('stub')
    const other = fake('other')
    const seen: [string, unknown][] = []
    const fanout = openFanout({
      entries: [stub, other],
      query: 'Q',
      variables: { input: { uri: 'ag:(anilist:1)' } },
      onResult: (entry, result) => { seen.push([entry.name, result]) },
    })

    stub.emit({ data: 'first' })
    other.emit({ data: 'second' })
    stub.emit({ data: 'third' })

    expect(seen).toEqual([['stub', { data: 'first' }], ['other', { data: 'second' }], ['stub', { data: 'third' }]])
    expect(fanout.subscriptions).toHaveLength(2)
  })

  test('only the entries passed in are asked, which is how a tracker question never reaches a media source', () => {
    const tracker = fake('tracker')
    const source = fake('source')
    openFanout({ entries: [tracker], query: 'Q', variables: { input: {} } })

    expect(tracker.asked).toHaveLength(1)
    expect(source.asked, 'an entry left out is never subscribed').toHaveLength(0)
  })

  test('stamps the root context onto the input when there is one, and leaves the variables alone when there is not', () => {
    const media = fake('media')
    const tracker = fake('tracker')
    const root = openRoot('MEDIA')
    openFanout({ entries: [media], query: 'Q', variables: { input: { uri: 'x:1' } }, root })
    openFanout({ entries: [tracker], query: 'Q', variables: { input: { uri: 'x:1' } } })

    expect(media.asked[0]!.variables.input.context?.rootId).toBe(root.rootId)
    expect(tracker.asked[0]!.variables, 'a TrackingInput has no context field to receive one').toEqual({ input: { uri: 'x:1' } })
    closeRoot(root.rootId)
  })

  test('an entry that cannot start is skipped and the rest still answer', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken: FanoutEntry = { name: 'broken', client: { subscription: () => { throw new Error('no') } } }
    const other = fake('other')
    const seen: string[] = []
    const fanout = openFanout({ entries: [broken, other], query: 'Q', variables: {}, onResult: entry => { seen.push(entry.name) } })
    other.emit({})

    expect(seen).toEqual(['other'])
    expect(fanout.subscriptions).toHaveLength(1)
    expect(errors).toHaveBeenCalledOnce()
  })

  test('a hook that throws on one result costs that result and nothing else', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stub = fake('stub')
    const seen: unknown[] = []
    openFanout({
      entries: [stub],
      query: 'Q',
      variables: {},
      onResult: (_entry, result) => {
        if (result === 'bad') throw new Error('unreadable')
        seen.push(result)
      },
    })
    stub.emit('bad')
    stub.emit('good')

    expect(seen).toEqual(['good'])
  })

  test('a late joiner joins once, and leaving unsubscribes it and drops it from the teardown list', () => {
    const early = fake('early')
    const late = fake('late')
    const fanout = openFanout({ entries: [early], query: 'Q', variables: {} })
    joinFanout(fanout, late)
    joinFanout(fanout, late)

    expect(late.asked).toHaveLength(1)
    expect(fanout.subscriptions).toHaveLength(2)

    leaveFanout(fanout, late)
    expect(late.unsubscribed).toBe(1)
    expect(fanout.subscriptions).toHaveLength(1)
  })
})

describe('collectUris, the media page hook', () => {
  test('gathers every uri every answer names into one set', () => {
    const a = fake('a')
    const b = fake('b')
    const inserted = new Set<string>()
    openFanout({
      entries: [a, b],
      query: 'Q',
      variables: {},
      onResult: collectUris((result: { nodes: string[] }) => result.nodes, inserted),
    })
    a.emit({ nodes: ['a:1', 'a:2'] })
    b.emit({ nodes: ['b:1', 'a:1'] })

    expect([...inserted].sort()).toEqual(['a:1', 'a:2', 'b:1'])
  })
})

describe('settling, what the media page waits on before it says a media has no episodes', () => {
  const settlingFanout = (entries: Fake[]) => {
    const onSettled = vi.fn()
    const settling = createSettling(onSettled)
    const fanout = openFanout({ entries, query: 'Q', variables: {}, settling })
    return { fanout, settling, onSettled }
  }

  test('settles once every entry asked has answered for the last time, and not before', () => {
    const anilist = fake('anilist')
    const anizip = fake('anizip')
    const { settling, onSettled } = settlingFanout([anilist, anizip])

    anilist.emit({ data: {}, hasNext: true })
    anilist.emit({ data: {}, hasNext: false })
    expect(settling.settled(), 'anizip is still out').toBe(false)
    anizip.emit({ data: {}, hasNext: true })
    expect(settling.settled(), 'a payload that is not the last').toBe(false)

    anizip.emit({ data: {}, hasNext: false })
    expect(settling.settled()).toBe(true)
    expect(onSettled).toHaveBeenCalledOnce()
  })

  test('an entry that never answers counts as settled once the bound has passed', () => {
    vi.useFakeTimers()
    const anilist = fake('anilist')
    const { settling, onSettled } = settlingFanout([anilist, fake('never')])
    anilist.emit({ hasNext: false })

    vi.advanceTimersByTime(ASK_BOUND_MS - 1)
    expect(settling.settled()).toBe(false)
    vi.advanceTimersByTime(1)
    expect(settling.settled()).toBe(true)
    expect(onSettled).toHaveBeenCalledOnce()
  })

  test('an entry that cannot start holds nothing', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = { name: 'broken', client: { subscription: () => { throw new Error('no') } } } as unknown as Fake
    const other = fake('other')
    const { settling } = settlingFanout([broken, other])
    other.emit({ hasNext: false })

    expect(settling.settled()).toBe(true)
  })

  test('an entry asked again is out again until that answer ends', () => {
    const anilist = fake('anilist')
    const cr = fake('cr')
    const { fanout, settling, onSettled } = settlingFanout([anilist])
    anilist.emit({ hasNext: false })
    expect(settling.settled(), 'the control: settled before the re-ask').toBe(true)

    askEntry(fanout, cr, { input: { uri: 'ag:(anilist:1,cr:1)' } })
    expect(settling.settled()).toBe(false)
    cr.emit({ hasNext: false })
    expect(settling.settled()).toBe(true)
    expect(onSettled).toHaveBeenCalledTimes(2)
  })

  test('a tracked promise is out until it settles, a rejected one included', async () => {
    const settling = createSettling(() => {})
    let fail: (error: Error) => void = () => {}
    settling.track(new Promise((_resolve, reject) => { fail = reject }))
    expect(settling.settled()).toBe(false)

    fail(new Error('the placeholder ask failed'))
    await Promise.resolve()
    expect(settling.settled()).toBe(true)
  })

  // the urql client every source answers through ends each subscription on a `hasNext: false` result,
  // and the count rests on it: a stream that answered, one that answered nothing, and one that failed
  test("a real urql client ends every source's answer on a result the count reads", async () => {
    const server = createYoga({
      schema: createSchema({
        typeDefs: 'type Query { _: Int } type Subscription { answered: Int, nothing: Int, failed: Int }',
        resolvers: {
          Subscription: {
            answered: { subscribe: async function* () { yield { answered: 1 } } },
            nothing: { subscribe: async function* () { yield* [] } },
            failed: { subscribe: async function* () { yield await Promise.reject(new Error('upstream down')) } },
          },
        },
      }),
      logging: false,
    })
    const client = new Client({
      url: 'http://d/graphql',
      exchanges: [fetchExchange],
      fetchSubscriptions: true,
      fetch: (input, init) => server.handleRequest(new Request(input, init), {}) as Promise<Response>,
    })
    for (const field of ['answered', 'nothing', 'failed']) {
      const settled = new Promise<void>(resolve => {
        openFanout({ entries: [{ name: field, client }], query: `subscription { ${field} }`, variables: {}, settling: createSettling(resolve) })
      })
      expect(await Promise.race([settled.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('still out'), 1_000))]), field).toBe('settled')
    }
  })
})
