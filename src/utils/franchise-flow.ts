import type { Edge, Node } from '@xyflow/react'

import type { Layout } from './franchise-layout'

import { intl } from '../i18n'
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
const COL_GAP = 90
const ROW_GAP = 24
const PAD = 40
const COL_W = NODE_W + COL_GAP
const ROW_H = NODE_H + ROW_GAP

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
}

export type FranchiseFlowNode = Node<FranchiseNodeData, 'work'>
export type FranchiseFlowEdge = Edge<FranchiseEdgeData, 'chain' | 'relation'>

export const franchiseFlowGraph = (
  layout: Layout,
  options: { current: ReadonlySet<string>, hover: HoverTarget },
): { nodes: FranchiseFlowNode[], edges: FranchiseFlowEdge[] } => {
  const lit = highlightFor(options.hover, layout.edges)
  const drawn = new Set(layout.nodes.map(node => node.uri))

  const nodes: FranchiseFlowNode[] = layout.nodes.map(node => {
    const title = nodeTitle(node)
    return {
      id: node.uri,
      type: 'work',
      position: { x: PAD + node.column * COL_W, y: PAD + node.row * ROW_H },
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
        meta: [workFormatLabel(node.format), node.episodeCount ? intl.formatMessage({ id: '{count} ep', defaultMessage: '{count} ep' }, { count: node.episodeCount }) : undefined]
          .filter(Boolean).join(' · '),
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

  const relations: FranchiseFlowEdge[] = layout.edges
    .filter(edge => drawn.has(edge.from) && drawn.has(edge.to))
    .map(edge => {
      const key = edgeKey(edge)
      return {
        id: key,
        type: 'relation' as const,
        source: edge.from,
        target: edge.to,
        data: {
          kind: 'relation' as const,
          label: relationLabel(edge.relation).toLocaleUpperCase(intl.locale),
          lit: lit.edges.has(key),
        },
      }
    })

  // the chain paints UNDER the stated relations, which is the order the hand drawn version used: the
  // reading order is the background the relations are read against
  return { nodes, edges: [...chain, ...relations] }
}
