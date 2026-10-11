import type { GetMediaDetailsSubscription } from '../generated/graphql'

import type { EdgeProps, NodeProps } from '@xyflow/react'

import { css } from '@emotion/react'
import { Background, BackgroundVariant, Handle, Position, ReactFlow } from '@xyflow/react'
import { FloatingFocusManager, FloatingOverlay, FloatingPortal, useClick, useDismiss, useFloating, useInteractions, useRole } from '@floating-ui/react'
import { Network, X } from 'lucide-react'
import { createContext } from 'preact'
import { useCallback, useContext, useMemo, useState } from 'preact/hooks'
import { Link, useSearch } from 'wouter'

import { getRoutePath, Route } from '../router/path'
import { carriedSearch } from '../router/debug/trace'
import { asAggregatedUri } from '../utils/uri'
import { formatsIn, isVideoFormat, layoutFranchise, onlyFormats } from '../utils/franchise-layout'
import type { HoverTarget } from '../utils/franchise-layout'
import { franchiseFlowGraph, NODE_H, NODE_W } from '../utils/franchise-flow'
import type { FranchiseFlowEdge, FranchiseFlowNode } from '../utils/franchise-flow'
import { workFormatLabel } from '../utils/relation-labels'
import { layer } from '../layers'

import '@xyflow/react/dist/style.css'

/**
 * Every work in a series, drawn left to right IN THE ORDER IT HAPPENED.
 *
 * INLINE SVG and hand placed, because nothing in this tree lays out a graph: there is no d3, dagre,
 * elkjs, cytoscape or react-flow in the dependencies and none reachable transitively. The arithmetic
 * lives in utils/franchise-layout.ts where it can be tested; this turns columns and rows into pixels.
 *
 * TWO KINDS OF ARROW, and the difference is the point. A dashed labelled one is a relationship a
 * source stated: sequel, side story, spin off. A solid unlabelled one is the READING ORDER, derived
 * here from the dates, and it runs straight along the timeline so "season one, season two, the film,
 * season three" can be read off the picture without following any relation at all. An earlier version
 * laid works out by graph depth instead, which hung the whole series off its source novel and left
 * the order nowhere in the shape.
 *
 * FOREIGN OBJECT is deliberately not used for the boxes. It is the obvious way to put wrapped HTML
 * text in an SVG and it is the one thing here that renders differently across engines, so a node's
 * label is `<text>` with explicit lines instead.
 */

type Franchise = NonNullable<NonNullable<GetMediaDetailsSubscription['media']>['franchise']>


const triggerStyle = css`
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.5rem 1.1rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 0.5rem;
  background: transparent;
  color: rgba(255, 255, 255, 0.75);
  font-family: inherit;
  font-size: 1.3rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.4);
    background: rgba(255, 255, 255, 0.06);
  }

  svg { width: 1.5rem; height: 1.5rem; }
`

const overlayStyle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  background: rgba(0, 0, 0, 0.75);
  z-index: ${layer.franchiseDialog};

  .sheet {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    max-width: 170rem;
    background: rgb(18, 18, 20);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.8rem;
    overflow: hidden;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 2rem;
    /* right padding clears the close button, which is positioned rather than in the flow */
    padding: 1.5rem 7rem 1.5rem 2rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);

    & > .title {
      font-size: 1.8rem;
      font-weight: 700;
      color: #fff;
      flex-shrink: 0;
    }

  }

  .close {
    position: absolute;
    top: 1.4rem;
    right: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.4rem;
    height: 3.4rem;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 50%;
    background: transparent;
    color: rgba(255, 255, 255, 0.7);
    cursor: pointer;

    &:hover { color: #fff; border-color: rgba(255, 255, 255, 0.4); }
    svg { width: 1.7rem; height: 1.7rem; }
  }

  /* Over the canvas rather than up in the bar, so the control sits with the thing it controls. It is
     the one part of the surface that is NOT draggable, hence the pointer handlers it stops. */
  .kinds {
    position: absolute;
    top: 1.2rem;
    left: 1.2rem;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.9rem 1.1rem;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 0.6rem;
    background: rgba(18, 18, 20, 0.9);
    backdrop-filter: blur(6px);
    cursor: default;

    & > .legend {
      font-size: 1.1rem;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 0.4rem;
    }

    & > label {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      font-size: 1.3rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.55);
      cursor: pointer;
      white-space: nowrap;

      &.on { color: #fff; }

      input {
        width: 1.4rem;
        height: 1.4rem;
        margin: 0;
        accent-color: rgb(61, 180, 242);
        cursor: pointer;
      }
    }
  }

  .canvas {
    flex: 1;
    /* HIDDEN, not auto. The drawing is moved by a transform rather than by a scroll offset, so there
       is nothing here to scroll and no content bounds to be stopped by: the surface is unbounded in
       every direction and at every zoom. */
    overflow: hidden;
    position: relative;
  }

  /* the library paints its own surface, so the app's dark ground is stated rather than inherited:
     its default is a light one and the modal around this box is not. The dot grid is the library's
     own Background component now, registered with the transform by it rather than by hand. */
  .react-flow { background-color: rgb(9, 9, 10); }
  .react-flow__pane { cursor: grab; }
  .react-flow__pane.dragging { cursor: grabbing; }
  .react-flow__attribution { background: rgba(0, 0, 0, 0.4); a { color: rgba(255, 255, 255, 0.4); } }
  /* the handles carry the geometry and nothing else: nobody connects this graph by hand */
  .react-flow__handle { opacity: 0; pointer-events: none; }

  /* a relationship a source stated */
  .edge {
    fill: none;
    stroke: rgba(255, 255, 255, 0.22);
    stroke-width: 1.5;
    stroke-dasharray: 4 3;
  }

  /* the reading order, derived from the dates: solid, brighter, and never labelled */
  .chain {
    fill: none;
    stroke: rgba(61, 180, 242, 0.55);
    stroke-width: 2;
  }

  .edge-label {
    fill: rgba(255, 255, 255, 0.5);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-anchor: middle;
  }

  /* An HTML box rather than an SVG one, which is what the move to xyflow bought here. The old
     version avoided foreignObject on purpose, since it is the one thing that renders differently
     across engines, and paid for it by breaking every title into lines by CHARACTER COUNT. The lines
     are still computed (see titleLines), because two of them is a deliberate cap rather than a
     limitation, but they are laid out by the browser now. */
  .work-node {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.2rem;
    box-sizing: border-box;
    width: ${NODE_W}px;
    height: ${NODE_H}px;
    padding: 0.4rem 0.6rem;
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 6px;
    background: rgb(28, 28, 30);
    text-align: center;
    text-decoration: none;
    overflow: hidden;

    &:hover { background: rgb(42, 42, 46); border-color: rgba(255, 255, 255, 0.35); }
    &.current { border-color: rgb(61, 180, 242); border-width: 2px; }

    .title { color: rgba(255, 255, 255, 0.95); font-size: 12px; font-weight: 700; line-height: 1.25; }
    .meta { color: rgba(255, 255, 255, 0.5); font-size: 10px; }
  }

  /* One colour for "what the pointer is talking about", amber so it never reads as the blue that
     means "the work you came from". Both hovering a work and hovering an arrow use it, which is what
     makes the two gestures feel like the same question asked from either end. */
  .work-node.lit {
    border-color: rgb(255, 176, 62);
    border-width: 2px;
    background: rgb(52, 42, 26);

    .title { color: #fff; }
  }
  .edge.lit { stroke: rgb(255, 176, 62); stroke-width: 2.5; stroke-dasharray: none; }
  .chain.lit { stroke: rgb(255, 176, 62); stroke-width: 3; }
  .edge-label.lit { fill: rgb(255, 176, 62); }

  /* the text alone is a thin target, so each label carries an invisible pad it can be caught by */
  .label-hit { fill: transparent; cursor: pointer; }
`

/**
 * Which of the two things the pointer is on, shared with the custom node and edge components.
 *
 * A CONTEXT rather than a field on each node's `data`, because `data` is compared by identity: a
 * callback rebuilt each render would re-mount every box on every pointer move, and the hover would
 * fight the thing it is trying to highlight.
 */
const Hover = createContext<(target: HoverTarget) => void>(() => {})

const WorkNode = ({ data }: NodeProps<FranchiseFlowNode>) => {
  const search = useContext(Search)
  return (
    <Link
      className={`work-node${data.current ? ' current' : ''}${data.lit ? ' lit' : ''}`}
      to={`${getRoutePath(Route.MEDIA, { uri: asAggregatedUri(data.uri) })}${search}`}
      title={data.title}
    >
      <Handle type="target" position={Position.Left}/>
      <div className="title">{data.lines.map(line => <div key={line}>{line}</div>)}</div>
      {data.meta ? <div className="meta">{data.meta}</div> : undefined}
      <Handle type="source" position={Position.Right}/>
    </Link>
  )
}

/** The session's engine flags, so a work clicked out of this graph lands on a reproducible address. */
const Search = createContext('')

/** A curve from one box's right edge to the next box's left edge, which is both arrow kinds' shape. */
const curve = (sourceX: number, sourceY: number, targetX: number, targetY: number) => {
  const forward = targetX >= sourceX
  const bend = Math.max(20, Math.abs(targetX - sourceX) / 2) * (forward ? 1 : -1)
  return `M ${sourceX} ${sourceY} C ${sourceX + bend} ${sourceY}, ${targetX - bend} ${targetY}, ${targetX} ${targetY}`
}

/** The reading order, derived from the dates: solid, brighter, and never labelled. */
const ChainEdge = ({ data, sourceX, sourceY, targetX, targetY }: EdgeProps<FranchiseFlowEdge>) => (
  <path className={`chain${data?.lit ? ' lit' : ''}`} d={curve(sourceX, sourceY, targetX, targetY)}/>
)

const RelationEdge = ({ id, data, sourceX, sourceY, targetX, targetY }: EdgeProps<FranchiseFlowEdge>) => {
  const setHover = useContext(Hover)
  const label = data?.label ?? ''
  const on = data?.lit ? ' lit' : ''
  // a third of the way along rather than the midpoint: everything pointing AT one work converges
  // there, so midpoint labels land on each other in a stack
  const ALONG = 0.34
  const at = (a: number, b: number) => a + (b - a) * ALONG
  const labelX = at(sourceX, targetX)
  const labelY = at(sourceY, targetY) - 6
  // Measured in CHARACTERS, since measuring text needs a live layout and this redraws on every store
  // update. It only has to be big enough to catch a pointer aimed at the word.
  const hitWidth = label.length * 6.4 + 12

  return (
    <>
      <path className={`edge${on}`} d={curve(sourceX, sourceY, targetX, targetY)}/>
      {/* The pad and the word are ONE target. With the handlers on the pad alone the word sits above
          it and takes the hit itself, so the pointer never enters the pad and nothing ever lights:
          measured 2026-09-09, every label dead to the pointer. */}
      <g
        className="label"
        onPointerEnter={() => setHover({ kind: 'edge', key: id })}
        onPointerLeave={() => setHover(undefined)}
      >
        <rect className="label-hit" x={labelX - hitWidth / 2} y={labelY - 11} width={hitWidth} height={15}/>
        <text className={`edge-label${on}`} x={labelX} y={labelY}>{label}</text>
      </g>
    </>
  )
}

// module scope: xyflow re-mounts every node and edge when these object identities change
const nodeTypes = { work: WorkNode }
const edgeTypes = { chain: ChainEdge, relation: RelationEdge }

const Graph = ({ franchise, currentUris }: { franchise: Franchise, currentUris: readonly string[] }) => {
  // the session's engine flags, so a node clicked out of this graph lands on an address that
  // reproduces the page it came from (`carriedSearch`, and the relation cards do the same)
  const search = carriedSearch(useSearch())
  const formats = useMemo(() => formatsIn(franchise), [franchise])
  // Video by default. Stub aggregates things you watch, so a novel or a manga is context rather than
  // somewhere to go: its page here has no episodes and nothing to read.
  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set(formats.filter(isVideoFormat)))

  /**
   * Which layout, decided by what is on screen rather than by a second control.
   *
   * A timeline is the right picture while everything shown is something you watch: a handful of works
   * in a line, in order. Switch the books on and it stops being right, because a franchise has far
   * more volumes than seasons and they share dates freely, so the timeline becomes a mile of nearly
   * empty columns. Depth packs those against the works they adapt.
   */
  const mode = [...shown].every(isVideoFormat) ? 'story' : 'graph'

  const layout = useMemo(
    () => layoutFranchise(onlyFormats(franchise, node => !node.format || shown.has(node.format)), mode),
    [franchise, shown, mode],
  )

  const [hover, setHover] = useState<HoverTarget>(undefined)
  const current = useMemo(() => new Set(currentUris), [currentUris])
  const { nodes, edges } = useMemo(
    () => franchiseFlowGraph(layout, { current, hover }),
    [layout, current, hover],
  )

  const onNodeEnter = useCallback((_: unknown, node: { id: string }) => setHover({ kind: 'node', uri: node.id }), [])
  const onLeave = useCallback(() => setHover(undefined), [])

  const toggle = (format: string) =>
    setShown(previous => {
      const next = new Set(previous)
      if (next.has(format)) next.delete(format)
      else next.add(format)
      return next
    })

  return (
    <>
      <div className="bar">
        <div className="title">Series</div>
      </div>
      <div className="canvas" data-canvas>
        {
          formats.length
            ? (
              <div
                className="kinds"
                /* the panel is not part of the surface: `nopan` is what stops a press here from
                   dragging the graph out from under the checkbox being aimed at */
                onPointerDown={event => event.stopPropagation()}
              >
                <div className="legend">Show</div>
                {
                  formats.map(format => (
                    <label key={format} className={shown.has(format) ? 'on' : undefined}>
                      <input type="checkbox" checked={shown.has(format)} onChange={() => toggle(format)}/>
                      <span>{workFormatLabel(format)}</span>
                    </label>
                  ))
                }
              </div>
            )
            : undefined
        }
        <Search.Provider value={search}>
          <Hover.Provider value={setHover}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeMouseEnter={onNodeEnter}
              onNodeMouseLeave={onLeave}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable={false}
              fitView
              minZoom={0.05}
              maxZoom={20}
              aria-label="Every work in this series, in order"
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="rgba(255, 255, 255, 0.14)"/>
            </ReactFlow>
          </Hover.Provider>
        </Search.Provider>
      </div>
    </>
  )
}

const MediaFranchise = ({ franchise, currentUris }: { franchise: Franchise | null | undefined, currentUris: readonly string[] }) => {
  const [open, setOpen] = useState(false)
  const { refs, context } = useFloating({ open, onOpenChange: setOpen })
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, { outsidePress: true }),
    useRole(context, { role: 'dialog' }),
  ])

  // A graph of one work is the work itself, which the page already shows.
  if (!franchise || (franchise.nodes?.length ?? 0) < 2) return null

  return (
    <>
      <button type="button" css={triggerStyle} ref={refs.setReference} {...getReferenceProps()} data-franchise-open>
        <Network/>
        See detailed relation graph
      </button>
      {
        open
          ? (
            <FloatingPortal>
              <FloatingOverlay lockScroll css={overlayStyle} data-franchise>
                <FloatingFocusManager context={context}>
                  <div className="sheet" ref={refs.setFloating} {...getFloatingProps()}>
                    <Graph franchise={franchise} currentUris={currentUris}/>
                    <button type="button" className="close" aria-label="Close" onClick={() => setOpen(false)}>
                      <X/>
                    </button>
                  </div>
                </FloatingFocusManager>
              </FloatingOverlay>
            </FloatingPortal>
          )
          : undefined
      }
    </>
  )
}

export default MediaFranchise
