import type { PlaybackLink } from '../party/bridge'
import type { PlaybackState } from '../party'
import type { PlayerAsk, PlayerControl } from '../party/protocol'

import { useEffect, useRef } from 'preact/hooks'

import { party } from '../party'
import { advance, ASK_HOLD_MS, ASK_THROTTLE_MS, askedState, personAction, playbackCorrection, SEEK_TOLERANCE_S, SETTLE_MS } from '../party/playback'
import { toHostTime, toLocalTime } from '../party/clock'
import { useParty, usePartyMessages } from '../party/use-party'

const here = () => location.pathname + location.search

/**
 * The watch page's half of playback sync, over whichever player the page has up.
 *
 * A host forwards what its player reports and keeps the store's snapshot current, so a joiner is told
 * where the video is, and applies a follower's granted ask to its own player, whose report then moves
 * everyone. A guest applies what the host said, and applies it AGAIN on every report from its own
 * player, unless the report is a person using a control the guest was granted: that is asked of the
 * host, and the player is left alone for ASK_HOLD_MS while the answer comes back.
 *
 * Telling a person from a correction is inference: a report within SETTLE_MS of a correction that
 * played, paused or seeked is the player answering it, and anything else that moved is the person.
 */
// A player also resumes by itself (a rebuild after a stall autoplays). Only a click or a key press gives the page
// user activation, one inside the player's cross-origin frame included (measured in Chrome, 2026-10-11), so a
// change made without one is not the person's.
const byPerson = () => navigator.userActivation?.isActive ?? true

const PartyPlayback = ({ link }: { link: PlaybackLink | undefined }) => {
  const state = useParty()
  const role = state.status === 'active' ? state.role : undefined
  // what the host last said, and WHEN it was heard on this clock, so a re-apply later is moved
  // forward by the time that passed rather than seeking the player back to a stale second
  const wanted = useRef<{ state: PlaybackState, receivedAt: number, measured: boolean } | undefined>(undefined)
  // the player's own last report: a guest reads a person against it, a host answers an ask from it
  const last = useRef<PlaybackState | undefined>(undefined)
  const holdUntil = useRef(0)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settleUntil = useRef(0)
  // a correction seek is the player's until it lands, however long that takes: a torrent player seeking
  // into a range it has not buffered can take longer than SETTLE_MS
  const seekingTo = useRef<number | undefined>(undefined)
  const throttled = useRef(new Map<PlayerControl, { sentAt: number, next?: PlayerAsk, timer?: ReturnType<typeof setTimeout> }>())

  const apply = (target: PlaybackState, measured: boolean) => {
    if (!link) return
    const now = Date.now()
    const local = last.current && advance(last.current, last.current.at, now)
    const correction = local && playbackCorrection(local, target, now, measured)
    // play() on an ended player starts it over from 0: it follows the host only somewhere else
    if (link.ended?.() && correction?.seek === undefined) return
    if (!correction || correction.seek !== undefined || correction.play || correction.pause) settleUntil.current = now + SETTLE_MS
    if (correction?.seek !== undefined) seekingTo.current = correction.seek
    link.apply(target, measured)
  }
  const reapply = () => {
    const heard = wanted.current
    if (heard) apply(advance(heard.state, heard.receivedAt, Date.now()), heard.measured)
  }
  const ask = (controls: PlayerControl[], reported: PlaybackState) => {
    const clock = party.hostClock()
    const s = clock ? { ...reported, at: toHostTime(reported.at, clock.offset) } : reported
    for (const c of controls) {
      const slot = throttled.current.get(c) ?? { sentAt: 0 }
      throttled.current.set(c, slot)
      slot.next = { t: 'ask', c, path: here(), s }
      if (slot.timer) continue
      const flush = () => { slot.timer = undefined; slot.sentAt = Date.now(); party.send(slot.next!) }
      const wait = slot.sentAt + ASK_THROTTLE_MS - Date.now()
      if (wait <= 0) flush()
      else slot.timer = setTimeout(flush, wait)
    }
    holdUntil.current = Date.now() + ASK_HOLD_MS
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(reapply, ASK_HOLD_MS)
  }

  useEffect(() => {
    // a state heard for one player is not for the next: a new link is a new player, or the same
    // player on a different release, and either way it starts from what the host says next
    wanted.current = undefined
    last.current = undefined
    seekingTo.current = undefined
    if (!link || !role) return
    const off = link.onReport(reported => {
      const before = last.current
      last.current = reported
      if (role === 'host') {
        party.setPlayback(reported)
        party.send({ t: 'playback', s: reported })
        return
      }
      const heard = wanted.current
      // off the host's page the player is its own, and at the end the browser paused it, not a person
      if (!heard || link.ended?.()) return
      const now = Date.now()
      const holding = now < holdUntil.current
      const target = advance(heard.state, heard.receivedAt, now)
      const landed = seekingTo.current !== undefined && Math.abs(reported.time - seekingTo.current) <= SEEK_TOLERANCE_S
      if (landed) seekingTo.current = undefined
      // while holding nothing is applied, so the person is read against the player's own last report
      const used = before && byPerson() && (holding || now >= settleUntil.current)
        ? personAction(before, reported, holding ? before : target).filter(control => party.may(control) && !(landed && control === 'seek'))
        : []
      if (used.length) ask(used, reported)
      else if (!holding) apply(target, heard.measured)
    })
    return () => {
      off()
      clearTimeout(holdTimer.current)
      for (const slot of throttled.current.values()) clearTimeout(slot.timer)
      throttled.current.clear()
      holdUntil.current = 0
      if (role === 'host') party.setPlayback(undefined)
    }
  }, [role, link])

  usePartyMessages(message => {
    if (role === 'host') {
      // the store already dropped an ask its sender was not granted
      if (message.t !== 'ask' || message.c === 'go' || message.path !== here() || !link || !last.current) return
      const target = askedState(last.current, message, Date.now())
      if (target) link.apply(target, true)
      return
    }
    if (role !== 'guest') return
    const next = message.t === 'playback' ? message.s : message.t === 'state' ? message.s : undefined
    if (!next) return
    // the host's playback is for the host's page: a guest on another episode keeps its own
    if (party.hostPath() !== here()) return
    // The host stamped `at` on ITS clock. Once a round trip has been timed the two are reconciled
    // here, once, so everything downstream (advance, the tolerance, a source package's own reading)
    // works in local time and can trust the age of the report in full rather than capping it.
    // Unmeasured it is passed through as it always was, and read cautiously.
    const clock = party.hostClock()
    const state = clock ? { ...next, at: toLocalTime(next.at, clock.offset) } : next
    wanted.current = { state, receivedAt: Date.now(), measured: !!clock }
    if (Date.now() >= holdUntil.current) apply(state, !!clock)
  })

  return null
}

export default PartyPlayback
