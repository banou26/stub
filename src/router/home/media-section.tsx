import type { CSSProperties } from 'react'
import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'

import { css } from '@emotion/react'
import { Grid, useGridRef } from 'react-window'
import { useCallback, useEffect, useState } from 'preact/compat'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  autoUpdate, offset, useFloating, shift,
  useHover, useInteractions, safePolygon,
  FloatingPortal,
  useTransitionStyles
} from '@floating-ui/react'

import { Link } from 'wouter'

import { getRoutePath, Route } from '../path'
import MediaTitle from '../../components/media-title'
import Draggable from '../../components/draggable'
import { MediaPreview } from '../../components/media-preview'
import Placeholder from '../../components/placeholder'
import { layer } from '../../layers'

const style = css`
display: flex;
flex-direction: column;
position: relative;
--card-gutter: 100px;
& > .title {
  position: relative;
  /* The section is a flex COLUMN, which blockifies this <a> and stretches it across the viewport,
     so the heading's box (and its hover and focus ring) ran the full width of the screen for a few
     words of text. Cross-axis start keeps the box the size of the words in it. */
  align-self: flex-start;
  margin-left: 10rem;
  font-size: 4rem;
  font-weight: bold;
  color: rgb(255, 255, 255);
  text-shadow: rgba(0, 0, 0, 0.8) -1px -1px 0px, rgba(0, 0, 0, 0.8) -1px 1px 0px, rgba(0, 0, 0, 0.8) 1px -1px 0px, rgba(0, 0, 0, 0.8) 1px 1px 0px;
  padding-bottom: 0.5rem;
  user-select: none;
}
& > .list-container {
  position: relative;
  & > .scroll-button {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 60px;
    height: 60px;
    background: rgba(0, 0, 0, 0.7);
    border: none;
    border-radius: 2.5rem;
    color: white;
    font-size: 24px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.2s ease;
    &:hover {
      background: rgba(0, 0, 0, 0.9);
    }
    &.left {
      left: 20px;
    }
    &.right {
      right: 20px;
    }
  }

  /* the cells' own size and spacing, from the grid below and media-title.tsx */
  & > .pending {
    display: flex;
    gap: 10px;
    height: 355px;
    padding-left: var(--card-gutter);
    overflow: hidden;

    & > * { flex: 0 0 250px; height: 350px; border-radius: 1rem; }
  }

  & > div > .virtual-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    grid-gap: 1rem;
    padding-bottom: 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: rgb(134, 132, 141) rgb(15, 15, 15);
  }
}

@media (max-width: 768px) {
  --card-gutter: 1.5rem;

  & > .title {
    margin-left: 1.5rem;
    font-size: 2.4rem;
  }

  & > .list-container > .scroll-button {
    display: none;
  }
}
`

const CellComponent = (
  { style, mediaNodes, columnIndex }: {
    style: CSSProperties
    columnIndex: number
    mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes']
  }
) => {
  const media = mediaNodes[columnIndex]
  if (!media) return null

  const [open, onOpenChange] = useState(false)
  const { x, y, strategy, refs, context } = useFloating({
    open,
    onOpenChange,
    whileElementsMounted: autoUpdate,
    placement: 'top',
    middleware: [
      offset(({ rects }) => (-rects.reference.height / 2 - rects.floating.height / 2)),
      shift({ crossAxis: true, padding: 25 })
    ]
  })
  const hover = useHover(context, { restMs: 400, handleClose: safePolygon() })
  const {styles} = useTransitionStyles(context, {
    initial: {
      opacity: 0,
      transform: 'scale(0.8)',
    },
    open: {
      opacity: 1,
      transform: 'scale(1)'
    },
    duration: 150
  })
  const {getReferenceProps, getFloatingProps} = useInteractions([hover])

  return (
    <>
      {
        open && (
          <FloatingPortal>
            <MediaPreview
              media={media}
              ref={refs.setFloating}
              style={{
                ...styles,
                position: strategy,
                top: y ?? 0,
                left: x ?? 0,
                zIndex: layer.hoverCard
              }}
              {...getFloatingProps()}
            />
          </FloatingPortal>
        )
      }
      <MediaTitle
        media={media}
        to={getRoutePath(Route.MEDIA, { uri: media.uri })}
        standIn
        style={{
          ...style,
          width: 250,
          marginLeft: 'var(--card-gutter, 100px)'
        }}
        onMouseEnter={(e) => {
          if (!(e.target instanceof HTMLElement)) return
          refs.setReference(e.target)
        }}
        {...getReferenceProps()}
      />
    </>
  )
}

export const MediaSection = ({ title, titleTo, mediaNodes }: { title: string, titleTo?: string, mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }) => {
  const [visibleStartIndex, setVisibleStartIndex] = useState(0)
  const [visibleEndIndex, setVisibleEndIndex] = useState(0)

  const [isDragging, setIsDragging] = useState(false)
  const virtualListRef = useGridRef(null)

  const scrollTo = useCallback((direction: 'left' | 'right') => {
    const grid = virtualListRef.current
    if (!grid) return

    grid.scrollToColumn({
      index:
        direction === 'left'
          ? (
            visibleStartIndex <= 0
              ? 0
              : visibleStartIndex
          )
          : (
            visibleEndIndex + 1 >= mediaNodes.length
              ? mediaNodes.length - 1
              : visibleEndIndex
          ),
      behavior: 'smooth'
    })
  }, [visibleStartIndex, visibleEndIndex, mediaNodes.length, virtualListRef])

  // held as long as the search page waits before it finds nothing, so a row whose sources answer nothing ends empty
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 5_000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div css={style}>
      {
        // A <Link> renders an <a class="title">, still a direct child, so the `& > .title` rule above
        // keeps styling it and outranks the global `a` colour on specificity.
        titleTo
          ? <Link to={titleTo} className='title'>{title}</Link>
          : <span className='title'>{title}</span>
      }
      <div className='list-container'>
        {
          mediaNodes.length || waited
            ? (
              <>
                <Draggable isDragging={isDragging} setIsDragging={setIsDragging}>
                  <Grid<{ mediaNodes: typeof mediaNodes }>
                    gridRef={virtualListRef}
                    className='virtual-list'
                    cellComponent={CellComponent}
                    cellProps={{ mediaNodes }}
                    columnCount={mediaNodes.length}
                    columnWidth={260}
                    rowCount={1}
                    rowHeight={350}
                    overscanCount={5}
                    onCellsRendered={({ columnStartIndex, columnStopIndex }) => {
                      setVisibleStartIndex(columnStartIndex)
                      setVisibleEndIndex(columnStopIndex)
                    }}
                  />
                </Draggable>
                <button className='scroll-button left' onClick={() => scrollTo('left')}>
                  <ChevronLeft />
                </button>
                <button className='scroll-button right' onClick={() => scrollTo('right')}>
                  <ChevronRight />
                </button>
              </>
            )
            : <div className="pending">{Array.from({ length: 8 }, (_, index) => <Placeholder key={index}/>)}</div>
        }
      </div>
    </div>
  )
}

export default MediaSection
