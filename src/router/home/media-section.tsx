import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'
import type { RowCellProps } from './card-row'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/compat'
import {
  autoUpdate, offset, useFloating, shift,
  useHover, useInteractions, safePolygon,
  FloatingPortal,
  useTransitionStyles
} from '@floating-ui/react'

import { getRoutePath, Route } from '../path'
import MediaTitle from '../../components/media-title'
import { MediaPreview } from '../../components/media-preview'
import RowTitle from './row-title'
import CardRow, { PHONE_ROW_CARD, ROW_CARD } from './card-row'
import Placeholder from '../../components/placeholder'
import { layer } from '../../layers'

const style = css`
display: flex;
flex-direction: column;
position: relative;
--card-gutter: 100px;

/* the cells' own size and spacing, from card-row.tsx */
& > .list-container > .pending {
  display: flex;
  gap: 10px;
  height: ${ROW_CARD.height + 5}px;
  padding-left: var(--card-gutter);
  overflow: hidden;

  & > * { flex: 0 0 ${ROW_CARD.width}px; height: ${ROW_CARD.height}px; border-radius: 1rem; }
}

@media (max-width: 768px) {
  --card-gutter: 1.5rem;

  & > .list-container > .pending {
    height: ${PHONE_ROW_CARD.height + 5}px;

    & > * { flex-basis: ${PHONE_ROW_CARD.width}px; height: ${PHONE_ROW_CARD.height}px; }
  }
}
`

const CellComponent = (
  { style, mediaNodes, columnIndex, card }: RowCellProps<{ mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }>
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
          width: card.width,
          height: card.height,
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
  // held as long as the search page waits before it finds nothing, so a row whose sources answer nothing ends empty
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 5_000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div css={style} className='home-row'>
      <RowTitle title={title} to={titleTo}/>
      {
        mediaNodes.length || waited
          ? <CardRow count={mediaNodes.length} cell={CellComponent} cellProps={{ mediaNodes }}/>
          : (
            <div className='list-container'>
              <div className="pending">{Array.from({ length: 8 }, (_, index) => <Placeholder key={index}/>)}</div>
            </div>
          )
      }
    </div>
  )
}

export default MediaSection
