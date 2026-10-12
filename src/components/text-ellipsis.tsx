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
height: 100%;
`

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
      const lineHeightPx = parseFloat(window.getComputedStyle(ref).lineHeight)
      const height = ref.clientHeight
      // the min-1 floor and the prev === next guards: sub-pixel rounding of the written height kept the line count flip-flopping so it never settled
      setLineHeight(prev => (prev === lineHeightPx ? prev : lineHeightPx))
      if (lineHeightPx && height) {
        const nextClamp = Math.max(1, Math.floor(height / lineHeightPx))
        setLineClamp(prev => (prev === nextClamp ? prev : nextClamp))
      }
    }

    // Measure on the next frame: writing line-clamp/height back onto the observed element re-enters the observer, which throws "ResizeObserver loop completed with undelivered notifications"
    const resizeObserver = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    })

    resizeObserver.observe(ref)
    return () => {
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
    }
  }, [ref])

  return (
    <div
      {...rest}
      ref={setRef}
      css={style}
      style={{
        ...(typeof rest.style === 'object' ? rest.style : undefined),
        WebkitLineClamp: lineClamp,
        height: lineHeight && lineClamp ? lineClamp * lineHeight : undefined
      }}
    >
      {children}
    </div>
  )
}

export default TextEllipsis
