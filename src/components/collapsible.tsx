import type { HTMLAttributes, RefObject } from 'react'

import { css } from '@emotion/react'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

// a collapse saving less hides text for nothing: Expand's own line takes about half of this
const LEAST_GAIN = 40

const style = css`
display: flex;
flex-direction: column;
gap: 0.8rem;
overflow-wrap: anywhere;

&.collapsed > .clip {
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 calc(100% - 6rem), transparent);
}

& > .toggle-button {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  color: rgba(255, 255, 255, 0.7);
  font-family: inherit;
  font-size: 1.4rem;
  font-weight: 600;
  line-height: 1.8rem;
  cursor: pointer;
}
`

/**
 * Text that hides what does not fit, only when hiding gains height. The height it has is `collapsedHeight`, or down to
 * the foot of the `beside` column when that reaches further, since that column holds the row open either way. Text
 * fitting in it, or past it by too little to be worth hiding, shows whole with no toggle; longer text collapses to
 * exactly it, with Expand and Collapse. A column stacked under this one holds nothing open, so there
 * `collapsedHeight` alone counts.
 */
export const Collapsible = (
  { children, collapsedHeight = 200, beside, ...rest }:
  HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode
    collapsedHeight?: number
    beside?: RefObject<HTMLElement | null>
  }
) => {
  const intl = useIntl()
  const [isExpanded, setIsExpanded] = useState(false)
  // undefined while the text shows whole
  const [foldedHeight, setFoldedHeight] = useState<number>()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  const collapsed = foldedHeight !== undefined && !isExpanded

  useLayoutEffect(() => {
    const box = boxRef.current!
    const text = textRef.current!
    const column = beside?.current
    const measure = () => {
      const { top, bottom } = box.getBoundingClientRect()
      const row = column?.getBoundingClientRect()
      const height = Math.max(collapsedHeight, row && row.top < bottom ? row.bottom - top : 0)
      setFoldedHeight(text.offsetHeight > height + LEAST_GAIN ? height : undefined)
    }

    // Watched: the text, which a box held at its fold no longer follows, and the parent, which also resizes with what
    // sits above this box. Measured on the next frame: folding resizes that parent too, which from inside the callback
    // ends in "ResizeObserver loop completed with undelivered notifications"
    let frame = 0
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    resizeObserver.observe(text)
    resizeObserver.observe(box.parentElement!)
    if (column) resizeObserver.observe(column)
    measure()

    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [collapsedHeight, beside])

  return (
    <div
      {...rest}
      ref={boxRef}
      css={style}
      className={`${rest.className || ''} ${collapsed ? 'collapsed' : ''}`}
      style={{ maxHeight: collapsed ? foldedHeight : undefined }}
    >
      <div className="clip">
        <div ref={textRef}>{children}</div>
      </div>
      {
        foldedHeight === undefined
          ? undefined
          : (
            <button className="toggle-button" onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? intl.formatMessage({ id: 'Collapse', defaultMessage: 'Collapse' }) : intl.formatMessage({ id: 'Expand', defaultMessage: 'Expand' })}
            </button>
          )
      }
    </div>
  )
}

export default Collapsible
