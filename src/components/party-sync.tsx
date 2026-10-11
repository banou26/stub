import { useEffect, useRef } from 'preact/hooks'
import { useLocation, useSearch } from 'wouter'

import { party } from '../party'
import { cancelReset } from '../router/scroll-reset'
import { scrollFraction, scrollRoom, scrollTo } from '../party/scroll'
import { PARTY_PATH } from '../party/invite'
import { getRoutePath, Route } from '../router/path'
import { useParty, usePartyMessages } from '../party/use-party'

// Where the host is, followed. Mounted once at the router root, so it outlives every page: a party
// is joined on one page and continues on the next.

/** The most scroll messages a host sends per second. The room admits ten of anything, and the heartbeat and the navs share it. */
const SCROLL_HZ = 2

/**
 * How long a follower keeps placing itself on a page that is still arriving, and how still that page
 * has to be before it stops.
 *
 * A search or a season listing fetches from several sources and grows for seconds, and a fraction of
 * a page that has not arrived is a position that does not exist yet. The loop ends the moment the
 * height holds for LANDING_STEADY_FRAMES, about a second, so a rendered page costs a second and only
 * a slow one uses the whole budget. A second rather than a sixth because ten frames was not enough:
 * a pause in the middle of loading looked exactly like the end of it. The budget is generous because the alternative is a
 * follower stranded at the top with nothing to correct it: the host is not scrolling, so no `scroll`
 * arrives, and a later `state` does not move a guest that is already synced.
 */
const LANDING_PATIENCE_MS = 8_000

/** What counts as the person taking over from the party and steering for themselves. */
const TAKEOVER_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const
const LANDING_STEADY_FRAMES = 60

const PartySync = () => {
  const state = useParty()
  const [location, navigate] = useLocation()
  const search = useSearch()
  const path = search ? `${location}?${search}` : location
  const role = state.status === 'active' ? state.role : undefined

  // The host: every move goes out, and the latest is what a joiner is told. Except the party's own
  // page: a host there is managing the door, not taking the party somewhere, and a follower dragged
  // to it would find nothing to follow. On the search page a move goes out once the url has held for
  // 350 ms, because the search box writes it on every keystroke and the room admits ten messages a
  // second, so the last navs of a fast typist, the ones carrying the finished query, would be refused.
  const atTheDoor = location === PARTY_PATH
  const searching = location === getRoutePath(Route.SEARCH)
  useEffect(() => {
    if (role !== 'host' || atTheDoor) return
    const send = () => {
      party.setLocation(path, scrollFraction())
      party.send({ t: 'nav', path })
    }
    if (!searching) return send()
    const timer = setTimeout(send, 350)
    return () => clearTimeout(timer)
  }, [role, path, atTheDoor])

  useEffect(() => {
    if (role !== 'host' || atTheDoor) return
    let last = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      pending = undefined
      last = Date.now()
      const y = scrollFraction()
      party.setLocation(path, y)
      party.send({ t: 'scroll', y })
    }
    // a trailing throttle: the last position of a scroll always goes out, never more than SCROLL_HZ
    const onScroll = () => {
      if (pending) return
      const wait = Math.max(0, 1000 / SCROLL_HZ - (Date.now() - last))
      pending = setTimeout(flush, wait)
    }
    // On the DOCUMENT in the capture phase, not on the window: a scroll inside an element does not
    // bubble, so a window listener hears the page and nothing else. Capture hears every scroll on
    // the way down, whichever box it happened in.
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      if (pending) clearTimeout(pending)
    }
  }, [role, path])

  // The guest: the host's location becomes this one. A scroll that names a page this guest is not on
  // yet is held until the navigation lands, since the new page has no height to scroll through
  // before it renders.
  const pendingScroll = useRef<number | undefined>(undefined)
  // Bumped whenever a newer instruction from the host is applied, so a landing still settling onto a
  // slow page steps aside for it rather than dragging the follower back to where the party WAS.
  const applied = useRef(0)
  useEffect(() => {
    if (pendingScroll.current === undefined) return
    const y = pendingScroll.current
    pendingScroll.current = undefined
    // Jumped, not glided: the page has only just rendered and the guest is being placed where the
    // party already is. Gliding there would crawl the whole way down a page nobody has seen yet.
    //
    // KEPT UP for a moment, because one frame is not enough. A page whose content is still arriving
    // has no height, so the fraction maps to the top and the follower is left there with nothing to
    // correct it: the host is not scrolling, so no `scroll` arrives, and a later `state` heartbeat
    // does not move a guest that is already synced. Catch up landed at 20px of a page the host was
    // 1,500px down, every time, until this was measured (2026-09-07).
    let frame = 0
    let lastRoom = -1
    let steady = 0
    let taken = false
    const mine = applied.current
    const until = Date.now() + LANDING_PATIENCE_MS
    // the person scrolling for themselves ends this at once: they have taken over, and being dragged
    // back for the rest of the window would be worse than landing in the wrong place
    const takeOver = () => { taken = true }
    for (const event of TAKEOVER_EVENTS) document.addEventListener(event, takeOver, { passive: true })
    const release = () => {
      cancelAnimationFrame(frame)
      for (const event of TAKEOVER_EVENTS) document.removeEventListener(event, takeOver)
    }

    // The navigation that brought this follower here scheduled a reset to the top for the next frame
    // (router/scroll-reset.ts). Placing the follower is the more specific instruction and it comes
    // from the host, so it wins: otherwise the reset lands a frame later and undoes the placement.
    cancelReset()

    // A host at the very top needs no chasing: the top of a page is the top whatever loads next, so one
    // placement settles it. Without this the loop below spins for its whole budget on the common case
    // of a host who has not scrolled, and on a page with nothing to scroll it never sees room appear.
    if (y === 0) {
      scrollTo(0)
      return release
    }

    const place = () => {
      // Waiting on the page to STOP GROWING, not on the fraction to match. The fraction matches
      // immediately and always, because the line above just set it: a first attempt at this stopped
      // on that condition and so settled happily onto a page with 118px of room that was still
      // loading, leaving the follower 20px down one the host was 1,350px down. What says the page has
      // arrived is its height holding still for a WHILE: stopping after ten still frames was fooled by
      // a pause mid-load and landed at 0.18 of the page against the host's 0.41.
      const room = scrollRoom()
      if (room === lastRoom) steady += 1
      else { steady = 0; lastRoom = room }
      const settled = room > 0 && steady >= LANDING_STEADY_FRAMES
      // released as soon as the landing is over, not merely when the page changes: four document
      // listeners outliving the thing that wanted them is how a page ends up with dozens
      if (taken || applied.current !== mine || settled || Date.now() > until) return release()
      scrollTo(y)
      frame = requestAnimationFrame(place)
    }
    frame = requestAnimationFrame(place)
    return release
  }, [path])

  // Whether this guest has been taken to the party yet. A `state` is the host saying where the party
  // IS, repeated every few seconds for whoever just arrived, and it moves a guest exactly once: on the
  // first one, and on Catch up. A guest who then wandered off on purpose stays wandered until the host
  // actually goes somewhere, which arrives as a `nav` and is always followed.
  const synced = useRef(false)
  const invite = state.status === 'active' ? state.invite : undefined
  useEffect(() => { synced.current = false }, [invite])

  const land = (to: string, y: number) => {
    synced.current = true
    if (to !== path) {
      pendingScroll.current = y
      navigate(to)
    } else {
      // already on the right page, so this is a catch up rather than an arrival: worth gliding, and
      // scroll.ts jumps instead on its own if the party turns out to be a long way off
      cancelReset()
      applied.current += 1
      scrollTo(y, { smooth: true })
    }
  }

  usePartyMessages((message, { replayed }) => {
    if (role !== 'guest') return
    switch (message.t) {
      case 'nav':
        synced.current = true
        if (message.path !== path) navigate(message.path)
        return
      case 'scroll':
        // the host's scroll is for the host's page; a guest elsewhere has nothing of its own to move
        // Glided, because this is the one that repeats: the host's position lands twice a second while
        // they scroll, and jumping to each in turn reads as a stutter rather than as following someone.
        if (party.hostPath() === path) { cancelReset(); applied.current += 1; scrollTo(message.y, { smooth: true }) }
        return
      case 'state':
        if (!synced.current || replayed) land(message.path, message.y)
        return
    }
  })

  return null
}

export default PartySync
