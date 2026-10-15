import { css, keyframes } from '@emotion/react'

const sweep = keyframes`
  from { background-position: 100% 0; }
  to { background-position: -100% 0; }
`

const style = css`
  display: block;
  border-radius: 0.4rem;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06) 30%, rgba(255, 255, 255, 0.14) 50%, rgba(255, 255, 255, 0.06) 70%) 0 0 / 200% 100%;
  animation: ${sweep} 1.6s linear infinite;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

const linesStyle = css`
  display: flex;
  flex-direction: column;
  gap: 0.5em;

  & > * { height: 1em; }
  & > :last-child { width: 60%; }
`

/**
 * A box standing in for something still loading, sized by the caller's own rules for what it stands in
 * for: a highlight sweeps across it, and stays still for a viewer who asks for reduced motion.
 */
const Placeholder = ({ className }: { className?: string }) => <span css={style} className={className} aria-hidden="true"/>

/** `count` lines of text still loading, at the caller's font size, the last one shorter. */
export const PlaceholderLines = ({ count, className }: { count: number, className?: string }) => (
  <span css={linesStyle} className={className} aria-hidden="true">
    {Array.from({ length: count }, (_, index) => <Placeholder key={index}/>)}
  </span>
)

export default Placeholder
