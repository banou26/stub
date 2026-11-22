import type { HTMLAttributes } from 'react'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'

// a set line height, never `normal`: that is the font's own, which on Chrome 155 for Montserrat at 15px is 19px,
// so a clamp counting 1.2 per line cut the last line's descenders (measured 2026-10-13)
const style = css`
display: -webkit-box;
-webkit-box-orient: vertical;
overflow: hidden;
text-overflow: ellipsis;
line-height: 1.2;
width: 100%;
max-height: 100%;
`

/** Clamps its text to whole lines within its own or its clipping parent's available height. */
export const TextEllipsis = (
  { children, ...rest }:
  HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }
) => {
  const [ref, setRef] = useState<HTMLDivElement | null>(null)
  const [lineHeight, setLineHeight] = useState(0)
  const [lineClamp, setLineClamp] = useState(0)

  useEffect(() => {
    if (!ref) return

    let frame = 0
    const update = () => {
      const prevClamp = ref.style.webkitLineClamp
      const prevMaxHeight = ref.style.maxHeight
      // Clear previous clamp constraints so layout reports unconstrained available height.
      ref.style.webkitLineClamp = ''
      ref.style.maxHeight = ''
      ref.style.height = ''

      const lineHeightPx = parseFloat(window.getComputedStyle(ref).lineHeight)
      let available = ref.getBoundingClientRect().height
      const parent = ref.parentElement
      if (parent) {
        const parentStyle = window.getComputedStyle(parent)
        if (parentStyle.overflowY === 'hidden' || parentStyle.overflowY === 'clip') {
          const innerHeight =
            parent.getBoundingClientRect().height -
            (parseFloat(parentStyle.paddingTop) || 0) -
            (parseFloat(parentStyle.paddingBottom) || 0)
          available = Math.min(available, innerHeight)
        }
      }

      if (lineHeightPx > 0 && available > 0) {
        // 0.1px absorbs subpixel layout-unit rounding on exact multiples (such as 2 * 19.2 = 38.4px).
        const nextClamp = Math.max(1, Math.floor((available + 0.1) / lineHeightPx))
        ref.style.webkitLineClamp = String(nextClamp)
        ref.style.maxHeight = `${nextClamp * lineHeightPx}px`
        setLineHeight(prev => (prev === lineHeightPx ? prev : lineHeightPx))
        setLineClamp(prev => (prev === nextClamp ? prev : nextClamp))
      } else {
        ref.style.webkitLineClamp = prevClamp
        ref.style.maxHeight = prevMaxHeight
      }
    }

    // Measure on the next frame: writing line-clamp/max-height back onto the observed element re-enters the observer, which throws "ResizeObserver loop completed with undelivered notifications"
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }

    const resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(ref)
    if (ref.parentElement) resizeObserver.observe(ref.parentElement)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [ref, children])

  return (
    <div
      {...rest}
      ref={setRef}
      css={style}
      style={{
        ...(typeof rest.style === 'object' ? rest.style : undefined),
        WebkitLineClamp: lineClamp || undefined,
        maxHeight: lineHeight && lineClamp ? lineHeight * lineClamp : undefined
      }}
    >
      {children}
    </div>
  )
}

export default TextEllipsis
