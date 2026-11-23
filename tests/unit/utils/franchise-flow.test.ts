import { expect, test } from 'vite-plus/test'

import { startLanguage } from '../../../src/i18n'

import { franchiseFlowGraph, labelBox, NODE_H, NODE_W } from '../../../src/utils/franchise-flow'
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

test('right to left, each part of a box\'s line is isolated', async () => {
  try {
    await startLanguage({ language: 'ar', languages: ['ar'] })
    expect(graph().nodes.find(node => node.id === 'a')!.data.meta).toBe('\u2068TV\u2069 · \u2068الحلقات: \u20681100\u2069\u2069')
  } finally {
    await startLanguage({ language: 'en', languages: ['en-US'] })
  }
})

test('a stated relation is labelled in capitals, from the page the reader is on', () => {
  const labels = graph().edges.filter(edge => edge.type === 'relation').map(edge => [edge.source, edge.target, edge.data?.label])
  expect(labels).toEqual(expect.arrayContaining([['b', 'a', 'PARENT STORY'], ['a', 'c', 'SPIN OFF'], ['a', 'd', 'RELATED']]))
  expect(labels).toHaveLength(3)
})

const boxesOverlap = (a: { left: number, right: number, top: number, bottom: number }, b: { left: number, right: number, top: number, bottom: number }) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

test('parallel, backward, and multi-column relation labels sit clear of every card and every other label', () => {
  const dense = {
    nodes: [
      { uri: 'n1', titles: [{ title: 'Season 1' }], format: 'TV', episodeCount: 28, startDate: '2023-09-29' },
      { uri: 'n2', titles: [{ title: 'Specials' }], format: 'OVA', episodeCount: 4, startDate: '2023-10-11' },
      { uri: 'n3', titles: [{ title: 'Short Stories' }], format: 'ONA', episodeCount: 5, startDate: '2024-03-01' },
      { uri: 'n4', titles: [{ title: 'Season 2' }], format: 'TV', episodeCount: 10, startDate: '2026-01-16' },
      { uri: 'n5', titles: [{ title: 'Movie' }], format: 'MOVIE', episodeCount: 1, startDate: '2026-07-01' },
    ],
    edges: [
      { from: 'n1', to: 'n2', relation: 'SIDE_STORY' },
      { from: 'n1', to: 'n3', relation: 'SIDE_STORY' },
      { from: 'n1', to: 'n4', relation: 'SEQUEL' },
      { from: 'n2', to: 'n3', relation: 'SEQUEL' },
      { from: 'n2', to: 'n3', relation: 'OTHER' },
      { from: 'n4', to: 'n5', relation: 'SEQUEL' },
      { from: 'n1', to: 'n5', relation: 'SPIN_OFF' },
    ],
  }
  const built = franchiseFlowGraph(layoutFranchise(dense), { current: new Set(['n1']), hover: undefined })
  const nodeBoxes = built.nodes.map(node => ({
    id: node.id,
    left: node.position.x,
    right: node.position.x + NODE_W,
    top: node.position.y,
    bottom: node.position.y + NODE_H,
  }))
  const relationLabels = built.edges
    .filter(edge => edge.type === 'relation')
    .map(edge => {
      expect(edge.data?.path).toMatch(/^M /)
      expect(edge.data?.labelX).toEqual(expect.any(Number))
      expect(edge.data?.labelY).toEqual(expect.any(Number))
      return { id: edge.id, box: labelBox(edge.data!.label, edge.data!.labelX!, edge.data!.labelY!) }
    })

  expect(relationLabels).toHaveLength(7)
  for (const label of relationLabels) {
    for (const node of nodeBoxes) {
      expect(boxesOverlap(label.box, node), `${label.id} overlaps node ${node.id}`).toBe(false)
    }
  }
  for (let i = 0; i < relationLabels.length; i++) {
    for (let j = i + 1; j < relationLabels.length; j++) {
      expect(
        boxesOverlap(relationLabels[i]!.box, relationLabels[j]!.box),
        `${relationLabels[i]!.id} overlaps ${relationLabels[j]!.id}`
      ).toBe(false)
    }
  }
})
