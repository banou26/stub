import type { PlaybackLink } from '../../party/bridge'

import { css, keyframes } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

/** How long the next episode waits once the one playing has ended. */
export const UP_NEXT_MS = 5_000

const fill = keyframes`
  to { background-size: 100% 100%; }
`

const style = css`
  position: absolute;
  right: 2.4rem;
  bottom: 8rem;
  display: flex;
  gap: 0.8rem;

  button {
    padding: 1rem 1.6rem;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 1rem;
    background: rgba(28, 28, 30, 0.9);
    color: #fff;
    font: inherit;
    font-size: 1.4rem;
    font-weight: 600;
    cursor: pointer;
  }

  .up-next {
    border-color: transparent;
    /* the color on its own line: in the shorthand it makes a second layer, and the fill's single size then does not animate */
    background: linear-gradient(rgba(0, 0, 0, 0.15), rgba(0, 0, 0, 0.15)) left / 0% 100% no-repeat;
    background-color: #fff;
    color: #000;
    animation: ${fill} ${UP_NEXT_MS}ms linear forwards;
  }
`

/**
 * Next episode and Cancel over the player once it has ended, and `next` opened when `UP_NEXT_MS` is
 * out. Nothing without a `next`; a report that the player is no longer at its end (a seek back, a
 * play) withdraws it.
 */
const UpNext = ({ link, next }: { link: PlaybackLink | undefined, next: { href: string, title?: string } | undefined }) => {
  const [, navigate] = useLocation()
  const [counting, setCounting] = useState(false)
  const href = next?.href

  useEffect(() => {
    setCounting(false)
    if (!link || !href) return
    // Only an end after a play counts, and once: a link tells every new ear where the player is,
    // and that repeat must not bring back a countdown the viewer cancelled.
    let played = false
    return link.onReport(({ paused }) => {
      if (!link.ended?.()) {
        played ||= !paused
        setCounting(false)
      } else if (played) {
        played = false
        // a player fullscreened inside its frame hides anything the page draws
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
        setCounting(true)
      }
    })
    // whether there is a next, not its address: that grows as sources join the episode, mid-countdown too
  }, [link, Boolean(href)])

  useEffect(() => {
    if (!counting || !href) return
    const timer = setTimeout(() => navigate(href), UP_NEXT_MS)
    return () => clearTimeout(timer)
  }, [counting, href])

  if (!counting || !href) return null
  return (
    <div css={style}>
      <button type="button" className="up-next" title={next?.title} onClick={() => navigate(href)}>Next episode</button>
      <button type="button" className="up-next-cancel" onClick={() => setCounting(false)}>Cancel</button>
    </div>
  )
}

export default UpNext
