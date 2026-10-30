import type { EmbedTracks, TrackKind, TracksLink } from '../embed-tracks'
import type { PlaybackLink } from '../party/bridge'
import type { PlaybackState } from '../party'
import type { FollowerState, PlayerAsk, PlayerControl } from '../party/protocol'

import { useEffect, useRef } from 'preact/hooks'

import { party } from '../party'
import { TRACK_KINDS } from '../embed-tracks'
import { advance, ASK_HOLD_MS, ASK_THROTTLE_MS, askedState, personAction, playbackCorrection, SEEK_TOLERANCE_S, SETTLE_MS } from '../party/playback'
import { toHostTime, toLocalTime } from '../party/clock'
import { HAVE_FUTURE_DATA, readiness, STATUS_CHECK_MS } from '../party/status'
import { nextMine, trackToSelect } from '../party/tracks'
import { useParty, usePartyMessages } from '../party/use-party'
import { withoutPluginUris } from '../utils/plugin-links'

const here = () => withoutPluginUris(location.pathname + location.search)

/**
 * The watch page's half of playback sync, over whichever player the page has up.
 *
 * A host forwards what its player reports and keeps the store's snapshot current, so a joiner is told
 * where the video is, and applies a follower's granted ask to its own player, whose report then moves
 * everyone. A guest applies what the host said, and applies it AGAIN on every report from its own
 * player, unless the report is a person using a control the guest was granted: that is asked of the
 * host, and the player is left alone for ASK_HOLD_MS while the answer comes back. A guest that stopped
 * following playback applies nothing and asks nothing, and is put back where the host is when it follows again.
 *
 * Telling a person from a correction is inference: a report within SETTLE_MS of a correction that
 * played, paused or seeked is the player answering it, and anything else that moved is the person.
 *
 * With `tracks`, every member's player is put on the party's subtitles and audio, or on the member's
 * own pick. A track switch can reload the stream and put the player back where it was, so while one
 * runs a guest applies and reads nothing and a host sends nothing; afterwards a host more than the
 * tolerance from where it told the party it was seeks there.
 *
 * A guest also tells the host where it stands, once a second (see party/status.ts): ready or loading
 * by what its player holds at the party's second, away once it stops following or leaves the host's
 * page, and where its player is.
 */
// A player also resumes by itself (a rebuild after a stall autoplays). Only a click or a key press gives the page
// user activation, one inside the player's cross-origin frame included (measured in Chrome, 2026-10-11), so a
// change made without one is not the person's.
const byPerson = () => navigator.userActivation?.isActive ?? true

const PartyPlayback = ({ link, tracks }: { link: PlaybackLink | undefined, tracks?: TracksLink }) => {
  const state = useParty()
  const role = state.status === 'active' ? state.role : undefined
  const following = party.following()
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
  // the host's last playback sent, which the party follows while the host's own player is busy
  const sent = useRef<PlaybackState | undefined>(undefined)
  const local = useRef<EmbedTracks | undefined>(undefined)
  const requested = useRef(new Map<TrackKind, string | null>())
  const busy = () => local.current?.busy ?? false

  const apply = (target: PlaybackState, measured: boolean) => {
    // read live: the report listener and the hold timer hold an older render
    if (!link || !party.following() || busy()) return
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
    sent.current = undefined
    seekingTo.current = undefined
    if (!link || !role) return
    const off = link.onReport(reported => {
      const before = last.current
      last.current = reported
      if (role === 'host') {
        if (busy()) return
        sent.current = reported
        party.setPlayback(reported)
        party.send({ t: 'playback', s: reported })
        return
      }
      const heard = wanted.current
      // off the host's page the player is its own, and at the end the browser paused it, not a person
      if (!heard || link.ended?.() || !party.following() || busy()) return
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

  useEffect(() => { if (following) reapply() }, [following])

  useEffect(() => {
    if (role !== 'guest') return
    let was: FollowerState | undefined
    let live = true
    const check = async () => {
      const page = here()
      const hostPath = party.hostPath()
      if (hostPath === undefined) return
      if (hostPath !== page) { party.setStatus({ s: 'away' }); return }
      const buffer = await link?.buffer?.()
      if (!live) return
      const now = Date.now()
      const own = last.current && advance(last.current, last.current.at, now)
      const time = buffer?.time ?? own?.time
      const moving = own && !own.paused && (buffer?.readyState ?? HAVE_FUTURE_DATA) >= HAVE_FUTURE_DATA
      const where = time === undefined ? {} : { time, rate: moving ? own.rate : 0 }
      if (!party.following()) { party.setStatus({ s: 'away', path: page, ...where }); return }
      // judged only at a second the host said to this player: its own is not the party's
      const heard = wanted.current
      was = heard ? readiness(was, buffer, advance(heard.state, heard.receivedAt, now).time, link?.duration?.()) : 'loading'
      party.setStatus({ s: was, path: page, ...where })
    }
    void check()
    const timer = setInterval(() => { void check() }, STATUS_CHECK_MS)
    return () => { live = false; clearInterval(timer) }
  }, [role, link])
  useEffect(() => () => { if (role === 'guest') party.setStatus({ s: 'away' }) }, [role])

  const followTracks = () => {
    const heard = local.current
    if (!tracks || !heard || !role) return
    for (const kind of TRACK_KINDS) {
      const list = heard[kind]
      const id = list && trackToSelect(party.partyTrack(kind), party.mine(kind), { ...list, busy: heard.busy })
      // a request lasts until nothing is wanted, or a change the member makes later reads as the code's own
      if (id === undefined && !heard.busy) requested.current.delete(kind)
      // a switch asked for and not reached is not asked again: the source refused it
      if (id === undefined || requested.current.get(kind) === id) continue
      requested.current.set(kind, id)
      tracks.select(kind, id)
    }
  }
  const switched = () => {
    if (role === 'guest') { reapply(); return }
    const told = sent.current
    const own = last.current
    if (!link || !told || !own) return
    const now = Date.now()
    const where = advance(told, told.at, now)
    const player = advance(own, own.at, now)
    if (Math.abs(where.time - player.time) > SEEK_TOLERANCE_S) link.apply({ ...player, time: where.time }, true)
    else {
      sent.current = own
      party.setPlayback(own)
      party.send({ t: 'playback', s: own })
    }
  }

  useEffect(() => {
    local.current = undefined
    requested.current.clear()
    if (!tracks || !role) return
    const off = tracks.onTracks(next => {
      const before = local.current
      local.current = next
      for (const kind of TRACK_KINDS) {
        const list = next[kind]
        if (!list) continue
        const mine = nextMine(party.mine(kind), party.partyTrack(kind), before?.[kind], list, requested.current.get(kind))
        if (mine !== party.mine(kind)) party.setMine(kind, mine)
      }
      party.setPlayerTracks(next)
      if (before?.busy && !next.busy) switched()
      followTracks()
    })
    return () => { off(); local.current = undefined; party.setPlayerTracks(undefined) }
  }, [role, tracks, link])

  // the party's choice or this member's own moved
  useEffect(followTracks)

  usePartyMessages(message => {
    if (role === 'host') {
      // the store already dropped an ask its sender was not granted
      if (message.t !== 'ask' || !('s' in message) || message.path !== here() || !link || !last.current) return
      const target = askedState(last.current, message, Date.now())
      if (!target) return
      // where a switch running now ends up sending the player back to
      if (busy()) sent.current = target
      link.apply(target, true)
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
