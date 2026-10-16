import { describe, expect, test } from 'vite-plus/test'

import { sortRelations, watchableRelations, type RelationEdge } from '../../../src/utils/relations'

const edge = (relation: string, id: string, format = 'TV'): RelationEdge =>
  ({ relation, format, node: { uri: `anilist:${id}`, titles: [{ title: id }] } } as unknown as RelationEdge)

const uris = (edges: readonly RelationEdge[]) => edges.map(e => e.node.uri)

describe('sortRelations', () => {
  test('ranks by what the relation is, ties in the order they came', () => {
    const sorted = sortRelations([edge('OTHER', 'z'), edge('SIDE_STORY', 'm1'), edge('SEQUEL', 'next'), edge('SIDE_STORY', 'm2'), edge('PREQUEL', 'previous')])
    expect(uris(sorted)).toEqual(['anilist:previous', 'anilist:next', 'anilist:m1', 'anilist:m2', 'anilist:z'])
  })
})

describe('watchableRelations', () => {
  test('keeps the works this app can play and drops a novel or a manga', () => {
    expect(uris(watchableRelations([edge('SOURCE', 'novel', 'NOVEL'), edge('PREQUEL', 'season'), edge('ALTERNATIVE', 'manga', 'MANGA')])))
      .toEqual(['anilist:season'])
  })
})
