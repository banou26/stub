import type { Edge, Node } from '@xyflow/react'

import type { Layout } from './franchise-layout'

import { intl, joinFacts } from '../i18n'
import { edgeKey, highlightFor, nodeTitle } from './franchise-layout'
import { relationLabel, workFormatLabel } from './relation-labels'

import type { HoverTarget } from './franchise-layout'

/**
 * A laid out franchise as the two lists `@xyflow/react` draws.
 *
 * The same split as `router/debug/flow.ts`, for the same reason: everything worth asserting about
 * this picture is a question about which works became boxes, which arrows joined them, which of the
 * two ARROW KINDS each one is, and what lights when the pointer is somewhere. None of that is a
 * question about pixels, and a component test here could not ask it anyway, since the suite runs
 * under linkedom and xyflow draws no edge without a box model to measure
 * (`tests/unit/components/xyflow-env.test.tsx`).
 *
 * Positions still come from `layoutFranchise`. The library does not lay out graphs, and the column
 * packing is the part with the actual thinking in it.
 */

export const NODE_W = 190
export const NODE_H = 74
export const COL_GAP = 140
export const ROW_GAP = 56
export const PAD = 40
const COL_W = NODE_W + COL_GAP
const ROW_H = NODE_H + ROW_GAP

export type Box = { left: number, right: number, top: number, bottom: number }

export const labelBox = (label: string, x: number, y: number): Box => {
  const width = Math.ceil(label.length * 7.2) + 20
  const height = 22
  return { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 }
}

const overlaps = (a: Box, b: Box, margin = 4): boolean =>
  a.left < b.right + margin && a.right + margin > b.left && a.top < b.bottom + margin && a.bottom + margin > b.top

/** A title broken into at most two lines that fit the box, measured in characters. */
const LINE = 24
export const titleLines = (title: string): string[] => {
  const words = title.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (next.length <= LINE) { line = next; continue }
    if (lines.length === 1) break
    if (line) lines.push(line)
    line = word
  }
  if (line && lines.length < 2) lines.push(line)
  const shown = lines.slice(0, 2)
  if (shown.join(' ').length < title.length && shown.length) {
    shown[shown.length - 1] = `${shown[shown.length - 1]!.slice(0, LINE - 1)}…`
  }
  return shown.length ? shown : [title.slice(0, LINE)]
}

export type FranchiseNodeData = {
  uri: string
  lines: string[]
  title: string
  meta: string
  /** The work the reader came from, which is the blue outline and is never the same thing as `lit`. */
  current: boolean
  lit: boolean
}

export type FranchiseEdgeData = {
  /** `chain` is the reading order derived from the dates; `relation` is something a source stated. */
  kind: 'chain' | 'relation'
  label: string
  lit: boolean
  path?: string
  labelX?: number
  labelY?: number
}

export type FranchiseFlowNode = Node<FranchiseNodeData, 'work'>
export type FranchiseFlowEdge = Edge<FranchiseEdgeData, 'chain' | 'relation'>

type NodeGeom = {
  column: number
  row: number
  x: number
  y: number
  sx: number
  sy: number
  tx: number
  ty: number
  box: Box
}

const spanOverlaps = (a: [number, number], b: [number, number]) => a[0] <= b[1] && b[0] <= a[1]

const allocLane = (lanes: [number, number][][], span: [number, number]): number => {
  for (let i = 0; i < lanes.length; i++) {
    if (!lanes[i]!.some(used => spanOverlaps(used, span))) {
      lanes[i]!.push(span)
      return i
    }
  }
  lanes.push([span])
  return lanes.length - 1
}

const VERTICAL_OFFSETS = (() => {
  const list = [0]
  for (let step = 1; step <= 16; step++) list.push(-step * 26, step * 26)
  return list
})()
const HORIZONTAL_OFFSETS = [0, -40, 40, -80, 80]

export const franchiseFlowGraph = (
  layout: Layout,
  options: { current: ReadonlySet<string>, hover: HoverTarget },
): { nodes: FranchiseFlowNode[], edges: FranchiseFlowEdge[] } => {
  const lit = highlightFor(options.hover, layout.edges)
  const drawn = new Set(layout.nodes.map(node => node.uri))

  const geom = new Map<string, NodeGeom>()
  const nodes: FranchiseFlowNode[] = layout.nodes.map(node => {
    const title = nodeTitle(node)
    const x = PAD + node.column * COL_W
    const y = PAD + node.row * ROW_H
    geom.set(node.uri, {
      column: node.column,
      row: node.row,
      x,
      y,
      sx: x + NODE_W,
      sy: y + NODE_H / 2,
      tx: x,
      ty: y + NODE_H / 2,
      box: { left: x, right: x + NODE_W, top: y, bottom: y + NODE_H },
    })
    return {
      id: node.uri,
      type: 'work',
      position: { x, y },
      width: NODE_W,
      height: NODE_H,
      draggable: false,
      // the box's position is its place in the series, so a reader who could drag one would be
      // destroying the only thing the layout is saying
      selectable: false,
      data: {
        uri: node.uri,
        title,
        lines: titleLines(title),
        meta: joinFacts([workFormatLabel(node.format), node.episodeCount ? intl.formatMessage({ id: '{count} ep', defaultMessage: '{count} ep' }, { count: node.episodeCount }) : undefined]),
        current: options.current.has(node.uri),
        lit: lit.nodes.has(node.uri),
      },
    }
  })

  /**
   * A chain step is lit by the work at either END of it, the same way a relation arrow is.
   *
   * It is not in `highlightFor`'s edge set, and deliberately: that set is keyed by `edgeKey`, which is
   * about a STATED relation, and the chain is derived here from the dates rather than claimed by
   * anybody. So it answers the hover itself.
   */
  const chainLit = (step: { from: string, to: string }) =>
    options.hover?.kind === 'node' && (step.from === options.hover.uri || step.to === options.hover.uri)

  const chain: FranchiseFlowEdge[] = layout.chain
    .filter(step => drawn.has(step.from) && drawn.has(step.to))
    .map(step => ({
      id: `chain\u0000${step.from}\u0000${step.to}`,
      type: 'chain' as const,
      source: step.from,
      target: step.to,
      data: { kind: 'chain' as const, label: '', lit: chainLit(step) },
    }))

  const drawable = layout.edges.filter(edge => drawn.has(edge.from) && drawn.has(edge.to))
  const adjacentCounts = new Map<string, number>()
  for (const edge of drawable) {
    const src = geom.get(edge.from)!
    const dst = geom.get(edge.to)!
    if (dst.column === src.column + 1) {
      const pairKey = `${edge.from}\u0000${edge.to}`
      adjacentCounts.set(pairKey, (adjacentCounts.get(pairKey) ?? 0) + 1)
    }
  }
  const adjacentSeen = new Map<string, number>()
  const aboveLanes: [number, number][][] = []
  const belowLanes: [number, number][][] = []
  const placedBoxes: Box[] = [...geom.values()].map(node => node.box)

  const spanBounds = (minCol: number, maxCol: number) => {
    let minY = Infinity
    let maxBottom = -Infinity
    for (const node of geom.values()) {
      if (node.column >= minCol && node.column <= maxCol) {
        if (node.y < minY) minY = node.y
        if (node.box.bottom > maxBottom) maxBottom = node.box.bottom
      }
    }
    return { minY, maxBottom }
  }

  const resolveLabel = (label: string, baseX: number, baseY: number) => {
    for (const dx of HORIZONTAL_OFFSETS) {
      for (const dy of VERTICAL_OFFSETS) {
        const x = baseX + dx
        const y = baseY + dy
        const candidate = labelBox(label, x, y)
        if (!placedBoxes.some(obstacle => overlaps(candidate, obstacle))) {
          placedBoxes.push(candidate)
          return { x, y }
        }
      }
    }
    placedBoxes.push(labelBox(label, baseX, baseY))
    return { x: baseX, y: baseY }
  }

  const relations: FranchiseFlowEdge[] = drawable.map(edge => {
    const key = edgeKey(edge)
    const label = relationLabel(edge.relation).toLocaleUpperCase(intl.locale)
    const src = geom.get(edge.from)!
    const dst = geom.get(edge.to)!
    let path: string
    let candX: number
    let candY: number

    if (dst.column === src.column + 1) {
      const pairKey = `${edge.from}\u0000${edge.to}`
      const count = adjacentCounts.get(pairKey) ?? 1
      const idx = adjacentSeen.get(pairKey) ?? 0
      adjacentSeen.set(pairKey, idx + 1)
      const arcOffset = (idx - (count - 1) / 2) * 38
      const bend = Math.max(24, Math.abs(dst.tx - src.sx) / 2)
      path = `M ${src.sx} ${src.sy} C ${src.sx + bend} ${src.sy + arcOffset}, ${dst.tx - bend} ${dst.ty + arcOffset}, ${dst.tx} ${dst.ty}`
      candX = (src.sx + dst.tx) / 2
      candY = (src.sy + dst.ty) / 2 + 0.75 * arcOffset
    } else {
      const minCol = Math.min(src.column, dst.column)
      const maxCol = Math.max(src.column, dst.column)
      const span: [number, number] = [minCol, maxCol]
      const { minY, maxBottom } = spanBounds(minCol, maxCol)
      const targetApexY = dst.column <= src.column
        ? minY - 36 - allocLane(aboveLanes, span) * 28
        : maxBottom + 36 + allocLane(belowLanes, span) * 28
      const archY = (targetApexY - 0.125 * (src.sy + dst.ty)) / 0.75
      const outX = 48
      path = `M ${src.sx} ${src.sy} C ${src.sx + outX} ${archY}, ${dst.tx - outX} ${archY}, ${dst.tx} ${dst.ty}`
      candX = (src.sx + dst.tx) / 2
      candY = targetApexY
    }

    const { x: labelX, y: labelY } = resolveLabel(label, candX, candY)
    return {
      id: key,
      type: 'relation' as const,
      source: edge.from,
      target: edge.to,
      data: {
        kind: 'relation' as const,
        label,
        lit: lit.edges.has(key),
        path,
        labelX,
        labelY,
      },
    }
  })

  // the chain paints UNDER the stated relations, which is the order the hand drawn version used: the
  // reading order is the background the relations are read against
  return { nodes, edges: [...chain, ...relations] }
}
