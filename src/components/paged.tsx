import type { ComponentChildren } from 'preact'

import { css } from '@emotion/react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

// a gap's mark, the same in every language
const GAP = '…'

const style = css`
  /* below the fixed header when a page change scrolls the list back into view */
  & > .page {
    scroll-margin-top: calc(var(--stub-header-height, 0px) + var(--fkn-inset-top, 0px) + 1.6rem);
  }

  & > nav {
    display: flex;
    gap: 0.4rem;
    margin-top: 1.2rem;

    @media (max-width: 768px) {
      gap: 0.2rem;
    }
  }

  /* one width for every slot, shrinking together on a narrow screen, so nothing moves as the page does */
  & > nav > * {
    flex: 0 1 4rem;
    min-width: 0;
    height: 4rem;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 0.6rem;
    color: #fff;
    font: inherit;
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
  }

  & > nav > button {
    border: 0.1rem solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
    cursor: pointer;
  }

  & > nav > button:hover { background: rgba(255, 255, 255, 0.12); }
  & > nav > button:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.8); outline-offset: 2px; }

  & > nav > button[aria-current] {
    border-color: #fff;
    background: #fff;
    color: #000;
    font-weight: 700;
  }

  & > nav > button[aria-disabled='true'] {
    opacity: 0.35;
    background: rgba(255, 255, 255, 0.05);
    cursor: default;
  }

  & > nav > .gap { color: rgba(255, 255, 255, 0.55); }

  & > nav > [role='status'] {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
`

/**
 * The slots under a list, 0 based: every page up to seven, and past that always seven, the first and last pages,
 * the current one with its neighbours, and for each run of pages left out a gap leading halfway across it, so any
 * page is a few clicks away.
 */
export const pageSlots = (page: number, pages: number): { page: number, gap: boolean }[] => {
  const shown = pages <= 7 ? Array.from({ length: pages }, (_, index) => index)
    : page < 4 ? [0, 1, 2, 3, 4, undefined, pages - 1]
    : page > pages - 5 ? [0, undefined, pages - 5, pages - 4, pages - 3, pages - 2, pages - 1]
    : [0, undefined, page - 1, page, page + 1, undefined, pages - 1]
  return shown.map((slot, index) =>
    slot === undefined ? { page: Math.floor((shown[index - 1]! + shown[index + 1]!) / 2), gap: true } : { page: slot, gap: false })
}

/**
 * A long list a page of `size` at a time, with Previous, Next and page numbers under it; no controls for
 * one page. `children` draws a page's items, `offset` being the first one's index in `items`.
 *
 * It opens on the page holding item `start`, and follows `start` until a page is picked. A page change
 * brings the list's top back into view when it was scrolled past, and otherwise keeps the list as tall as
 * it has been, so the controls stay under the pointer.
 */
const Paged = <T,>({ items, size, label, start = 0, children }: {
  items: readonly T[]
  size: number
  /** What the list is, in the language shown, naming its controls: "Characters" gives "Characters pages". */
  label: string
  start?: number
  children: (page: T[], offset: number) => ComponentChildren
}) => {
  const intl = useIntl()
  const [picked, setPicked] = useState<number>()
  const [held, setHeld] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const pages = Math.max(1, Math.ceil(items.length / size))
  const page = Math.min(Math.max(picked ?? Math.floor(start / size), 0), pages - 1)

  const go = (next: number) => {
    if (next < 0 || next >= pages || next === page) return
    const element = list.current!
    const { top, height } = element.getBoundingClientRect()
    setPicked(next)
    if (top < 0) {
      setHeld(0)
      element.scrollIntoView({ block: 'start', behavior: 'instant' })
    } else setHeld(Math.max(held, height))
  }

  return (
    <div css={style}>
      <div className="page" ref={list} style={held ? { minHeight: `${held}px` } : undefined}>
        {children(items.slice(page * size, (page + 1) * size), page * size)}
      </div>
      {
        pages > 1
          ? (
            <nav aria-label={intl.formatMessage({ id: '{list} pages', defaultMessage: '{list} pages' }, { list: label })}>
              <button type="button" aria-label={intl.formatMessage({ id: 'Previous page', defaultMessage: 'Previous page' })} aria-disabled={page === 0} onClick={() => go(page - 1)}>
                <ChevronLeft size={18} aria-hidden="true"/>
              </button>
              {pageSlots(page, pages).map(({ page: slot, gap }) => (
                // keyed by page, so a gap picked is the button of the page it led to, focus and all
                <button key={slot} type="button" className={gap ? 'gap' : undefined} aria-label={intl.formatMessage({ id: 'Page {page}', defaultMessage: 'Page {page}' }, { page: slot + 1 })} aria-current={slot === page ? 'page' : undefined} onClick={() => go(slot)}>
                  {gap ? GAP : slot + 1}
                </button>
              ))}
              <button type="button" aria-label={intl.formatMessage({ id: 'Next page', defaultMessage: 'Next page' })} aria-disabled={page === pages - 1} onClick={() => go(page + 1)}>
                <ChevronRight size={18} aria-hidden="true"/>
              </button>
              {/* quiet until a page is picked, so a list growing as sources answer announces nothing */}
              <span role="status">{picked === undefined ? '' : intl.formatMessage({ id: 'Page {page} of {pages}', defaultMessage: 'Page {page} of {pages}' }, { page: page + 1, pages })}</span>
            </nav>
          )
          : undefined
      }
    </div>
  )
}

export default Paged
