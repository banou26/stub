import type { HTMLAttributes } from 'react'

import { css } from '@emotion/react'
import { useState, useRef, useEffect } from 'preact/hooks'

const style = css`
position: relative;
overflow: hidden;
transition: max-height 0.3s ease-in-out;

& > .content {
  padding-bottom: 5rem;
}

&.collapsed {
  position: relative;
}

.fade-overlay {
  position: absolute;
  bottom: 2.5rem;
  left: 0;
  right: 0;
  height: 10rem;
  background: linear-gradient(to bottom, transparent, rgba(35, 35, 35, 1));
  pointer-events: none;
  transition: opacity 0.3s ease-in-out;
}

.toggle-button {
  font-family: inherit;
  font-size: 2.5rem;
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  padding: 1rem;
  border: none;
  font-weight: 500;
  cursor: pointer;
  width: 100%;
  background-color: rgb(35, 35, 35);
}
`

export const Collapsible = (
  { children, collapsedHeight = 200, ...rest }:
  HTMLAttributes<HTMLDivElement> & {
    children: React.ReactNode
    collapsedHeight?: number
  }
) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [needsToggle, setNeedsToggle] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    if (!contentRef.current) return

    const resizeObserver = new ResizeObserver(() => {
      if (contentRef.current) {
        const height = contentRef.current.scrollHeight
        setContentHeight(height)
        setNeedsToggle(height > collapsedHeight)
      }
    })

    resizeObserver.observe(contentRef.current)
    return () => resizeObserver.disconnect()
  }, [collapsedHeight])

  const toggleExpanded = () => setIsExpanded(!isExpanded)

  return (
    <div
      {...rest}
      ref={contentRef}
      css={style}
      className={`${rest.className || ''} ${!isExpanded && needsToggle ? 'collapsed' : 'expanded'}`}
    >
      <div className="content">
        {children}
      </div>

      {
        needsToggle && !isExpanded
          ? <div className="fade-overlay" />
          : undefined
      }
      {needsToggle
        ? (
          <button
            className="toggle-button"
            onClick={toggleExpanded}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        )
        : undefined
      }
    </div>
  )
}

export default Collapsible
