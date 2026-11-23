import type { RefObject } from 'preact'

import { css } from '@emotion/react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { useIntl } from 'react-intl'
import { useLocation } from 'wouter'

type StepLink = { href: string, title?: string }

const buttonStyle = css`
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 4.4rem;
  height: 4.4rem;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
  background: rgba(18, 18, 20, 0.62);
  color: #fff;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, border-color 0.15s ease;

  &.previous {
    inset-inline-start: 1.6rem;
  }

  &.next {
    inset-inline-end: 1.6rem;
  }

  &.player-episode-step:hover,
  &.player-episode-step:focus-visible {
    opacity: 1;
    background: rgba(18, 18, 20, 0.88);
    border-color: rgba(255, 255, 255, 0.45);
  }

  @media (hover: none), (pointer: coarse) {
    width: 3.8rem;
    height: 3.8rem;
    opacity: 0.65;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
`

/**
 * Previous and next episode double-arrow controls overlaid on the left and right edges of `.player-container`.
 *
 * Exits player-owned fullscreen before navigating so switching episodes inside a stage fullscreen keeps routing cleanly.
 */
const EpisodeArrows = ({ previous, next, stage, onStep }: {
  previous?: StepLink
  next?: StepLink
  stage: RefObject<HTMLElement | null>
  onStep?: (direction: 'previous' | 'next') => void
}) => {
  const intl = useIntl()
  const [, navigate] = useLocation()

  if (!previous && !next) return null

  const open = (direction: 'previous' | 'next', href: string) => {
    onStep?.(direction)
    const leaving = document.fullscreenElement && document.fullscreenElement !== stage.current
      ? document.exitFullscreen().catch(() => {})
      : undefined
    if (leaving) void leaving.then(() => navigate(href))
    else navigate(href)
  }

  const prevLabel = intl.formatMessage({ id: 'Previous episode', defaultMessage: 'Previous episode' })
  const nextLabel = intl.formatMessage({ id: 'Next episode', defaultMessage: 'Next episode' })

  return (
    <>
      {previous ? (
        <button
          type="button"
          css={buttonStyle}
          className="player-episode-step previous"
          data-player-step="previous"
          aria-label={prevLabel}
          title={previous.title ?? prevLabel}
          onClick={() => open('previous', previous.href)}
        >
          <ChevronsLeft size={22}/>
        </button>
      ) : undefined}
      {next ? (
        <button
          type="button"
          css={buttonStyle}
          className="player-episode-step next"
          data-player-step="next"
          aria-label={nextLabel}
          title={next.title ?? nextLabel}
          onClick={() => open('next', next.href)}
        >
          <ChevronsRight size={22}/>
        </button>
      ) : undefined}
    </>
  )
}

export default EpisodeArrows
