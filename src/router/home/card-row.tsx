import type { CSSProperties } from 'react'
import type { GridProps } from 'react-window'

import { css } from '@emotion/react'
import { Grid, useGridRef } from 'react-window'
import { useCallback, useEffect, useMemo, useState } from 'preact/compat'
import { ChevronLeft, ChevronRight } from 'lucide-react'

import Draggable from '../../components/draggable'

/** A home row card's size in CSS px: 25rem x 35rem, and the smaller 15rem x 21rem on a phone. */
export type RowCard = { width: number, height: number }
export const ROW_CARD: RowCard = { width: 250, height: 350 }
export const PHONE_ROW_CARD: RowCard = { width: 150, height: 210 }
const GAP = 10
const PHONE = '(max-width: 768px)'

const style = css`
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

  & > div > .virtual-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
    grid-gap: 1rem;
    padding-bottom: 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: rgb(134, 132, 141) rgb(15, 15, 15);
  }

  @media ${PHONE} {
    & > .scroll-button {
      display: none;
    }

    /* a 15rem card has room for less type than the 25rem one its title was sized for */
    .card .information {
      padding: 0.5rem 1rem 0;
    }

    .card .information .title {
      font-size: 1.6rem;
    }
  }
`

/** The card size for the viewport, following it as it crosses the phone width. */
export const useRowCard = (): RowCard => {
  const query = useMemo(() => globalThis.matchMedia?.(PHONE), [])
  const [phone, setPhone] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const change = () => setPhone(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [query])
  return phone ? PHONE_ROW_CARD : ROW_CARD
}

/** What a row draws in each cell: `style` places the cell, `card` is its size. */
export type RowCellProps<P> = P & { style: CSSProperties, columnIndex: number, card: RowCard }

/**
 * A home row's cards in one line, dragged with the pointer to scroll and stepped with the arrows on either side,
 * drawing only the cells in view. Every home row scrolls through this one, so they all move alike.
 */
export const CardRow = <P extends object>({ count, cell, cellProps }: { count: number, cell: (props: RowCellProps<P>) => JSX.Element | null, cellProps: P }) => {
  const card = useRowCard()
  const [visibleStartIndex, setVisibleStartIndex] = useState(0)
  const [visibleEndIndex, setVisibleEndIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const gridRef = useGridRef(null)

  const scrollTo = useCallback((direction: 'left' | 'right') => {
    const grid = gridRef.current
    if (!grid) return
    grid.scrollToColumn({
      index:
        direction === 'left'
          ? Math.max(visibleStartIndex, 0)
          : visibleEndIndex + 1 >= count ? count - 1 : visibleEndIndex,
      behavior: 'smooth'
    })
  }, [visibleStartIndex, visibleEndIndex, count, gridRef])

  return (
    <div className='list-container' css={style}>
      <Draggable isDragging={isDragging} setIsDragging={setIsDragging}>
        <Grid<P & { card: RowCard }>
          gridRef={gridRef}
          className='virtual-list'
          cellComponent={cell}
          cellProps={{ ...cellProps, card } as GridProps<P & { card: RowCard }>['cellProps']}
          columnCount={count}
          columnWidth={card.width + GAP}
          rowCount={1}
          rowHeight={card.height}
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
    </div>
  )
}

export default CardRow
