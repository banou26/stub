import { describe, expect, test } from 'vite-plus/test'

import { createGraph, lastWriteLongestArray } from '../../../../src/worker/store/graph'

describe('lastWriteLongestArray', () => {
  test('an incoming empty array never beats a filled one', () => {
    expect(lastWriteLongestArray({ titles: [] }, { titles: ['a'] })).toEqual({ titles: ['a'] })
  })

  test('an incoming filled array beats an empty one', () => {
    expect(lastWriteLongestArray({ titles: ['a'] }, { titles: [] })).toEqual({ titles: ['a'] })
  })

  test('equal non-zero lengths take the incoming', () => {
    expect(lastWriteLongestArray({ titles: ['new'] }, { titles: ['old'] })).toEqual({ titles: ['new'] })
  })

  test('an incoming null scalar keeps the existing value', () => {
    expect(lastWriteLongestArray({ status: null as string | null }, { status: 'RELEASING' })).toEqual({ status: 'RELEASING' })
    expect(lastWriteLongestArray({ status: undefined as string | undefined }, { status: 'RELEASING' })).toEqual({ status: 'RELEASING' })
  })

  test('an incoming non-null scalar wins', () => {
    expect(lastWriteLongestArray({ url: 'https://new' }, { url: 'https://old' })).toEqual({ url: 'https://new' })
  })
})

describe('neighbours', () => {
  test('reads back the undirected adjacency of one label, both ways', () => {
    const graph = createGraph<{ uri: string }>()
    graph.link('a', 'b', 'L')
    expect([...graph.neighbours('a', 'L')]).toEqual(['b'])
    expect([...graph.neighbours('b', 'L')]).toEqual(['a'])
  })

  test('connect records the pair and unions nothing', () => {
    const graph = createGraph<{ uri: string }>()
    graph.set('a', { uri: 'a' })
    graph.set('b', { uri: 'b' })
    expect(graph.connect('a', 'b', 'L'), 'a new pair').toBe(true)
    expect(graph.connect('a', 'b', 'L'), 'the same pair again').toBe(false)
    expect([...graph.neighbours('a', 'L')]).toEqual(['b'])
    // the control: `link` on the same pair WOULD put both in one cluster, which is the whole
    // difference the export reads
    expect(graph.cluster('a', 'L').map(node => node.uri)).toEqual(['a'])
    graph.link('a', 'b', 'L')
    expect(graph.cluster('a', 'L').map(node => node.uri)).toEqual(['a', 'b'])
  })

  test('a link under one label is invisible under another', () => {
    const graph = createGraph<{ uri: string }>()
    graph.link('a', 'b', 'L')
    expect(graph.neighbours('a', 'other').size).toBe(0)
    expect(graph.neighbours('c', 'L').size).toBe(0)
  })

  test('clear empties it', () => {
    const graph = createGraph<{ uri: string }>()
    graph.link('a', 'b', 'L')
    graph.clear()
    expect(graph.neighbours('a', 'L').size).toBe(0)
  })
})
