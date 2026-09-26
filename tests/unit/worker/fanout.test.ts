// The fan-out is shared by media sources and trackers, so both of its callers are pinned here against
// fake entries: the media page's uri collection, and the per-provider hook the tracking aggregate is
// built on.
import { afterEach, describe, expect, test, vi } from 'vitest'

import { collectUris, joinFanout, leaveFanout, openFanout, type FanoutEntry } from '../../../src/worker/fanout'
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

afterEach(() => { vi.restoreAllMocks(); resetRegistry() })

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
