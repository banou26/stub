import type { MediaChapter } from '@banou/media-player'
import type { RefObject } from 'preact'
import type { PlaybackLink } from '../../party/bridge'

import { css, keyframes } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useLocation } from 'wouter'

import { readAutoplay } from '../../utils/autoplay'
import { nextOfferAt } from '../../utils/next-offer'

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
  }

  .up-next.counting {
    animation: ${fill} ${UP_NEXT_MS}ms linear forwards;
  }
`

/**
 * Next episode over the player, from the moment `nextOfferAt` reads off `chapters` and once the player
 * has ended. With autoplay on, the end counts down with Cancel beside it and opens `next` when
 * `UP_NEXT_MS` is out. Nothing without a `next`. A seek back or a pause before the moment withdraws the
 * button, and a report that the player is no longer at its end (a seek back, a play) withdraws the countdown.
 * The `stage` it is drawn on stays fullscreen; a player fullscreened above it is let out first.
 */
const UpNext = ({ link, next, chapters, stage }: { link: PlaybackLink | undefined, next: { href: string, title?: string } | undefined, chapters: MediaChapter[], stage: RefObject<HTMLElement | null> }) => {
  const [, navigate] = useLocation()
  const [shown, setShown] = useState<'counting' | 'offered'>()
  const href = next?.href
  // a player fullscreened inside its frame hides anything the page draws, and takes the stage under it out of
  // fullscreen when its frame goes, unless it has left first
  const leaveFrameFullscreen = () => document.fullscreenElement && document.fullscreenElement !== stage.current
    ? document.exitFullscreen().catch(() => {})
    : undefined
  const open = (to: string) => {
    const leaving = leaveFrameFullscreen()
    if (leaving) void leaving.then(() => navigate(to))
    else navigate(to)
  }
  // the keys go back to the player, as the button they were on goes
  const cancel = () => {
    setShown(undefined)
    stage.current?.querySelector('iframe')?.focus()
  }
  // read at each report rather than keyed on: chapters landing mid-episode must not reset what the reports said
  const marks = useRef(chapters)
  marks.current = chapters

  useEffect(() => {
    setShown(undefined)
    if (!link || !href) return
    // Only an end after a play counts, and once: a link tells every new ear where the player is,
    // and that repeat must not bring back a countdown the viewer cancelled.
    let played = false
    let last: number | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    // the early button waits for a press: only the end counts down
    const offer = () => setShown('offered')
    const stop = link.onReport(({ paused, time, rate }) => {
      clearTimeout(timer)
      const before = last
      last = time
      if (link.ended?.()) {
        if (!played) return
        played = false
        void leaveFrameFullscreen()
        setShown(readAutoplay() ? 'counting' : 'offered')
        return
      }
      played ||= !paused
      const at = nextOfferAt(marks.current, link.duration?.())
      if (at !== undefined && time >= at) offer()
      // a stall reaches the page only as a playing report behind the timer, which keeps the button; one gone
      // back is a seek, and a paused one is where the player is
      else if (at === undefined || before === undefined || paused || time < before) setShown(undefined)
      if (at !== undefined && time < at && !paused && rate > 0) timer = setTimeout(offer, (at - time) / rate * 1000)
    })
    return () => {
      stop()
      clearTimeout(timer)
    }
    // whether there is a next, not its address: that grows as sources join the episode, mid-countdown too
  }, [link, Boolean(href)])

  useEffect(() => {
    if (shown !== 'counting' || !href) return
    const timer = setTimeout(() => open(href), UP_NEXT_MS)
    return () => clearTimeout(timer)
  }, [shown, href])

  if (!shown || !href) return null
  return (
    <div css={style}>
      <button type="button" className={`up-next ${shown}`} title={next?.title} onClick={() => open(href)}>Next episode</button>
      {shown === 'counting' ? <button type="button" className="up-next-cancel" onClick={cancel}>Cancel</button> : undefined}
    </div>
  )
}

export default UpNext
