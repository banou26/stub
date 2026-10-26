import { expect, test } from 'vite-plus/test'

import { franchiseFlowGraph } from '../../../src/utils/franchise-flow'
import { layoutFranchise } from '../../../src/utils/franchise-layout'

const FRANCHISE = {
  nodes: [
    { uri: 'a', titles: [{ title: 'One Piece' }], format: 'TV', episodeCount: 1100, startDate: '1999-10-20' },
    { uri: 'b', titles: [{ title: 'One Piece Film: Red' }], format: 'MOVIE', episodeCount: 1, startDate: '2022-08-06' },
    { uri: 'c', titles: [{ title: 'One Piece Fan Letter' }], format: 'SPECIAL', startDate: '2024-10-20' },
    { uri: 'd', titles: [{ title: 'One Piece Gold' }], episodeCount: 2, startDate: '2016-07-23' },
  ],
  edges: [
    { from: 'a', to: 'b', relation: 'SIDE_STORY' },
    { from: 'a', to: 'c', relation: 'SPIN_OFF' },
    { from: 'a', to: 'd', relation: 'OTHER' },
  ],
}

const graph = () => franchiseFlowGraph(layoutFranchise(FRANCHISE), { current: new Set(['a']), hover: undefined })

test('a box names the work\'s kind and its episodes, as the sources count them', () => {
  expect(Object.fromEntries(graph().nodes.map(node => [node.id, node.data.meta]))).toEqual({
    a: 'TV · 1100 ep',
    b: 'Movie · 1 ep',
    c: 'Special',
    d: '2 ep',
  })
})

test('a stated relation is labelled in capitals, from the page the reader is on', () => {
  const labels = graph().edges.filter(edge => edge.type === 'relation').map(edge => [edge.source, edge.target, edge.data?.label])
  expect(labels).toEqual(expect.arrayContaining([['b', 'a', 'PARENT STORY'], ['a', 'c', 'SPIN OFF'], ['a', 'd', 'RELATED']]))
  expect(labels).toHaveLength(3)
})
