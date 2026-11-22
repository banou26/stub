import type { MediaChapter } from '@banou/media-player'
import type { RefObject } from 'preact'
import type { PlaybackLink } from '../../party/bridge'

import { css, keyframes } from '@emotion/react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useLocation } from 'wouter'

import { readAutoplay, watchAutoplay } from '../../utils/autoplay'
import { chaptersBesideNext, followSkipOffer, hasEnding, nextOfferAt, tailOfferAt } from '../../utils/next-offer'

/** How long the next episode waits once the one playing has ended. */
export const UP_NEXT_MS = 5_000

/** How far through an episode its player is asked to prepare the next one's release. */
export const PREPARE_AT = 0.8

const fill = keyframes`
  to { background-size: 100% 100%; }
`

const style = css`
  position: absolute;
  inset-inline-end: 2.4rem;
  bottom: 8rem;
  display: flex;
  gap: 0.8rem;
  /* down only once the player's skip offer has faded out, which takes it 0.18 s from a clock a frame or so behind stub's */
  transition: bottom 0.18s ease 0.2s, visibility 0s 0.2s;

  /* above the player's skip offer, which is sized in px wherever the page's rem goes: it tops out at 112 px, 134 px for a finger */
  &.above-skip {
    bottom: 120px;
    transition-delay: 0s;

    @media (pointer: coarse) {
      bottom: 142px;
    }

    /* a phone's player under 384 px wide is too short to hold Next between that offer and the player's title */
    @media (pointer: coarse) and (max-width: 383px) {
      bottom: 8rem;
      visibility: hidden;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    transition-duration: 0s;
  }

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
 * When to offer Next from the player's own `chapters`. Their ending with nothing after it has the player's Skip Ending
 * in Next's corner, so the player is asked to leave that out, and Next comes a second before the ending only once it
 * has said it did. Until then, and for a player that cannot, Next waits for the end, so the two never show at once.
 */
const ownOfferAt = (link: PlaybackLink, chapters: MediaChapter[], duration: number | undefined) => {
  const closes = chaptersBesideNext(chapters, duration).length < chapters.length
  link.offerEnding?.(!closes)
  return closes && link.endingOffered?.() !== false ? undefined : (nextOfferAt(chapters, duration) ?? tailOfferAt(duration))
}

/**
 * The chapters the player draws its skip offers from: a file's own, without the last ending once it has said that offer
 * is gone, and for stub's own embed the ones `chapters` says, which it is handed through `chaptersBesideNext`.
 */
const offeredOn = (link: PlaybackLink, chapters: MediaChapter[], duration: number | undefined) => {
  const marks = link.chapters ? link.chapters() ?? [] : chapters
  return link.chapters && link.endingOffered?.() !== false ? marks : chaptersBesideNext(marks, duration)
}

/**
 * Next episode over the player, from the moment `ownOfferAt` reads off the player's own chapters when they mark an
 * ending, else `nextOfferAt` off `chapters`, and once the player has ended. With autoplay on, the end counts down with
 * Cancel beside it and opens `next` when `UP_NEXT_MS` is out, and autoplay turned off meanwhile, in the player too, leaves
 * the button without the countdown. Nothing without a `next`, and a player that left its
 * Skip Ending out for one gets it back. A seek back or a pause before the moment withdraws the button, and a report
 * that the player is no longer at its end (a seek back, a play) withdraws the countdown. It stands above the player's
 * skip offer while one is up, or on a phone's player too short for both, waits for it to go.
 * The `stage` it is drawn on stays fullscreen; a player fullscreened above it is let out first.
 * At `PREPARE_AT` of the episode the player is asked once to prepare `release`, the one `next` opens. Nothing of one
 * `episode` carries into the next, whose player may be the same link.
 */
const UpNext = ({ link, next, chapters, stage, episode, release, onAdvance }: {
  link: PlaybackLink | undefined
  next: { href: string, title?: string } | undefined
  chapters: MediaChapter[]
  stage: RefObject<HTMLElement | null>
  episode?: string
  release?: { uri: string, url?: string }
  /** Called right as Next opens the following episode, manually or at countdown end. */
  onAdvance?: () => void
}) => {
  const intl = useIntl()
  const [, navigate] = useLocation()
  const [shown, setShown] = useState<'counting' | 'offered'>()
  const [aboveSkip, setAboveSkip] = useState(false)
  const href = next?.href
  // a player fullscreened inside its frame hides anything the page draws, and takes the stage under it out of
  // fullscreen when its frame goes, unless it has left first
  const leaveFrameFullscreen = () => document.fullscreenElement && document.fullscreenElement !== stage.current
    ? document.exitFullscreen().catch(() => {})
    : undefined
  const open = (to: string) => {
    onAdvance?.()
    const leaving = leaveFrameFullscreen()
    if (leaving) void leaving.then(() => navigate(to))
    else navigate(to)
  }
  // the keys go back to the player, as the button they were on goes
  const cancel = () => {
    setShown(undefined)
    if (link?.focus) link.focus()
    else stage.current?.querySelector('iframe')?.focus()
  }
  // read at each report rather than keyed on: chapters landing mid-episode must not reset what the reports said
  const marks = useRef(chapters)
  marks.current = chapters
  const ahead = useRef(release)
  ahead.current = release
  const recheck = useRef(() => {})

  useEffect(() => {
    setShown(undefined)
    if (!href) link?.offerEnding?.(true)
    if (!link || !href) return
    // Only an end after a play counts, and once: a link tells every new ear where the player is,
    // and that repeat must not bring back a countdown the viewer cancelled.
    let played = false
    let prepared = false
    let last: number | undefined
    let latestState: Parameters<Parameters<typeof link.onReport>[0]>[0] | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    // the early button waits for a press: only the end counts down
    const offer = () => setShown('offered')
    const skipOffer = followSkipOffer(setAboveSkip)
    const evaluate = (state: NonNullable<typeof latestState>, timed: boolean) => {
      const { paused, time, rate, at: reportedAt } = state
      clearTimeout(timer)
      const nowTime = timed && !paused && rate > 0
        ? time + Math.max(0, (Date.now() - reportedAt) / 1000) * rate
        : time
      if (!timed) latestState = state
      const before = last
      if (!timed) last = time
      skipOffer.hear(offeredOn(link, marks.current, link.duration?.()), timed ? { ...state, time: nowTime, at: Date.now() } : state)
      if (link.ended?.()) {
        if (!played) return
        played = false
        void leaveFrameFullscreen()
        setShown(readAutoplay() ? 'counting' : 'offered')
        return
      }
      played ||= !paused
      const own = link.chapters?.()
      const duration = link.duration?.()
      if (!prepared && ahead.current && link.prepare && duration && nowTime >= duration * PREPARE_AT) {
        prepared = true
        link.prepare(ahead.current)
      }
      const offerAt = own && hasEnding(own)
        ? ownOfferAt(link, own, duration)
        : (nextOfferAt(marks.current, duration) ?? tailOfferAt(duration))
      if (offerAt !== undefined && nowTime >= offerAt) offer()
      // a stall reaches the page only as a playing report behind the timer, which keeps the button; one gone
      // back is a seek, and a paused one is where the player is
      else if (offerAt === undefined || before === undefined || paused || timed || time < before) setShown(undefined)
      if (offerAt !== undefined && nowTime < offerAt && !paused && rate > 0) timer = setTimeout(offer, (offerAt - nowTime) / rate * 1000)
    }
    recheck.current = () => { if (latestState && !link.ended?.()) evaluate(latestState, true) }
    const stop = link.onReport(state => evaluate(state, false))
    return () => {
      recheck.current = () => {}
      stop()
      clearTimeout(timer)
      skipOffer.stop()
    }
    // whether there is a next, not its address: that grows as sources join the episode, mid-countdown too
  }, [link, Boolean(href), episode])

  useEffect(() => {
    recheck.current()
  }, [chapters])

  useEffect(() => {
    if (shown !== 'counting' || !href) return
    const timer = setTimeout(() => open(href), UP_NEXT_MS)
    const stop = watchAutoplay(() => { if (!readAutoplay()) setShown('offered') })
    return () => { clearTimeout(timer); stop() }
  }, [shown, href])

  if (!shown || !href) return null
  return (
    <div css={style} className={aboveSkip ? 'above-skip' : undefined}>
      <button type="button" className={`up-next ${shown}`} title={next?.title} onClick={() => open(href)}>{intl.formatMessage({ id: 'Next episode', defaultMessage: 'Next episode' })}</button>
      {shown === 'counting' ? <button type="button" className="up-next-cancel" onClick={cancel}>{intl.formatMessage({ id: 'Cancel', defaultMessage: 'Cancel' })}</button> : undefined}
    </div>
  )
}

export default UpNext
