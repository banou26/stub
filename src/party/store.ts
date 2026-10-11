import type { rooms } from '@fkn/lib'
import type { EmbedTracks, TrackKind } from '../embed-tracks'
import type { Control, Grants, PartyMessage, PlaybackState } from './protocol'
import type { MyTrack } from './tracks'

import { actionText, allowed, decodePartyMessage, encodePartyMessage, isHostOnly, NO_GRANTS, TRACK_CONTROL } from './protocol'
import { advance } from './playback'
import { bestSample, clockSample, MAX_USABLE_RTT_MS, type ClockSample } from './clock'

// The party's state machine, over a room it is handed rather than one it imports: @fkn/lib cannot
// load under vitest, and the machine is where the bugs would live (who may speak, who is ignored,
// what a joiner is told, what ends the party). ./index.ts binds it to the real rooms api.

/** The slice of `@fkn/lib`'s rooms namespace the store calls, so a test can hand it a fake. */
export type RoomsApi = Pick<typeof rooms, 'available' | 'create' | 'join'>
export type Room = rooms.Room

export type PartyRole = 'host' | 'guest'

/** Why a party stopped. The room's own reasons, plus the one only this store can see. */
export type PartyEndReason = rooms.RoomEnd['reason'] | 'host-left'

export type PartyState =
  | { status: 'idle' }
  | { status: 'joining', invite: string }
  | { status: 'active', role: PartyRole, invite: string, members: number, self: string, owner: string }
  | { status: 'ended', reason: PartyEndReason }
  | { status: 'failed', code: rooms.RoomsErrorCode | 'unknown' }

/** Who is in the party, as the party page lists them. */
export type PartyMember = { id: string, name?: string, host: boolean, self: boolean }

/**
 * One line of the room's chat. `seq` is the api's, so two tabs order it the same way. `action` marks a
 * member's granted ask ("paused"), whose `text` follows the member's name.
 */
export type PartyChatLine = { seq: number, from: string, name?: string, text: string, at: number, self: boolean, action?: Control }

/** What a message listener is told beside the message. */
export type PartyMessageMeta = { replayed: boolean, from: string, self: boolean }

/** Where the host is, as the host's own app keeps reporting it. What a joiner is handed. */
export type PartySnapshot = { path: string, y: number, playback?: PlaybackState, playbackAt?: number }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type PartyStore = {
  getState: () => PartyState
  subscribe: (listener: (state: PartyState) => void) => () => void
  /**
   * What the room said, decoded and vetted: a host-only message only ever from the owner, and never
   * the host's own echo of one; anyone's chat and name, echoes included, so a line renders once, in
   * the order the api gave it.
   *
   * `replayed` is true when `replay` is saying it again, which is a guest asking to be caught up
   * rather than the host saying something new.
   */
  onMessage: (listener: (message: PartyMessage, meta: PartyMessageMeta) => void) => () => void
  create: () => Promise<void>
  join: (invite: string) => Promise<void>
  leave: () => Promise<void>
  /** Rejoin whatever this tab was in before a reload, inside the api's hold. Silent when there was nothing. */
  resume: () => Promise<void>
  /** Steering is the host's; talking is anyone's. A guest's steering message is dropped here. */
  send: (message: PartyMessage) => void
  /** Everyone in the party, names included where they were given. */
  roster: () => Promise<PartyMember[]>
  /**
   * What a member calls itself, if it has said so.
   *
   * Everyone with a name repeats it on a heartbeat and on every join, so this fills in shortly after
   * anyone arrives and does not depend on them having spoken in the chat.
   */
  nameOf: (id: string) => string | undefined
  /** The chat so far, newest last. */
  chat: () => PartyChatLine[]
  /** Call yourself this, here and in every room this tab joins. */
  setName: (name: string | undefined) => void
  name: () => string | undefined
  /** Host only: put a member out; they can come back through the invite. */
  kick: (id: string) => Promise<void>
  /** Host only: put a member out and keep them out for the room's life. */
  ban: (id: string) => Promise<void>
  /** Whether the host's player is running, which is when a pointer on the page means nothing. */
  playing: () => boolean
  /** The host's app keeps these current so a joiner can be told where the party is. */
  setLocation: (path: string, y: number) => void
  setPlayback: (playback: PlaybackState | undefined) => void
  /** Host only: what the host hands out, as last set. Sent at once and with every `state`. */
  issued: () => Grants
  setGrants: (grants: Grants) => void
  /**
   * Whether this member may use a control: always for the host; for a follower, by the grants in
   * force, which are the owner's last `state` in room order. The host judges an ask by them too,
   * through its own echo, so every member judges it alike.
   */
  may: (control: Control) => boolean
  /** The party's track of a kind, by the owner's last `state` like the grants: undefined sets none, null is off. */
  partyTrack: (kind: TrackKind) => string | null | undefined
  /** The host sets the party's track; a follower granted its control asks the host for it. */
  setPartyTrack: (kind: TrackKind, id: string | null) => void
  /** This member's own choice of a kind, `'party'` until it picks one. Memory only, reset when the party ends. */
  mine: (kind: TrackKind) => MyTrack
  setMine: (kind: TrackKind, mine: MyTrack) => void
  /** The tracks of the player on this page, kept current by the watch page for the widget. */
  playerTracks: () => EmbedTracks | undefined
  setPlayerTracks: (tracks: EmbedTracks | undefined) => void
  /** The link for a follower, or nothing outside an active party. */
  invite: () => string | undefined
  /** Where the host last said it was, for a guest deciding whether a scroll or a playback is for the page it is on. */
  hostPath: () => string | undefined
  /**
   * How the host's clock compares to this one, once a guest has timed a round trip; undefined until
   * then, and always undefined for a host, which IS the reference.
   *
   * A reader turns a host timestamp into a local one with `toLocalTime` and applies the age of a
   * report in full. Without it the age has unknown clock skew in it and is only trusted up to a
   * cap, which is what everything did before this existed.
   */
  hostClock: () => ClockSample | undefined
  /**
   * Whether a follower applies the host's playback: on for every party it joins, held in memory only.
   * Off, its player is its own and asks nothing; navigation still follows the host.
   */
  following: () => boolean
  setFollowing: (on: boolean) => void
  /**
   * Say the last thing the host said again, for a guest who wandered off and wants back. Follows playback again,
   * after the re-tell, so the player is applied once, from the freshest.
   */
  replay: () => void
  /** Clear an ended or failed party from view. */
  dismiss: () => void
}

export const PARTY_SESSION_KEY = 'stub-party-invite'
export const PARTY_NAME_KEY = 'stub-party-name'
/** How much chat a tab keeps. The room keeps none: a joiner sees what is said from then on. */
export const CHAT_KEEP = 200

/**
 * How often a host repeats where the party is, whether or not anything happened.
 *
 * A joiner is told on `joined`, but a follower coming back inside the api's hold (a reload, a phone
 * unlocking) is not a joiner: the api reserved its seat, so nobody is told it left or returned, and
 * a store rebuilt by the reload has heard nothing. Ten seconds is one message in ten of the budget a
 * member has every second, and the longest a returning follower waits with nothing to follow.
 */
export const STATE_HEARTBEAT_MS = 10_000

/**
 * How often everyone with a name says it again. Same blind spot as the state heartbeat: a member
 * back from a reload heard no introductions and nobody was told to repeat them. One message per
 * named member per half minute.
 */
export const NAME_HEARTBEAT_MS = 30_000

/**
 * How a guest times the host's clock: this many round trips, spaced this far apart, redone this often.
 *
 * Several rather than one because the offset a sample gives is only as good as its round trip was
 * quick, and one exchange that happened to queue behind something is indistinguishable from a clock
 * that is genuinely off by that much. Spaced so they do not share a congested moment. Repeated
 * because clocks drift, a laptop that slept comes back wrong, and a route can change under a party
 * that runs for hours.
 *
 * The whole round is 5 messages each way per guest per minute, against a room that admits 10 a
 * second from each member.
 */
export const CLOCK_SAMPLES = 5
export const CLOCK_SPACING_MS = 400
export const CLOCK_INTERVAL_MS = 60_000

const FOLLOW_PARTY: Record<TrackKind, MyTrack> = { subtitles: 'party', audio: 'party' }

const defaultStorage = (): StorageLike | undefined => {
  try { return globalThis.sessionStorage } catch { return undefined }
}

const isRoomsError = (error: unknown): error is rooms.RoomsError =>
  error instanceof Error && typeof (error as { code?: unknown }).code === 'string'

export const createPartyStore = (api: RoomsApi, storage: StorageLike | undefined = defaultStorage()): PartyStore => {
  let state: PartyState = { status: 'idle' }
  let room: Room | undefined
  let unlisten: (() => void) | undefined
  const snapshot: PartySnapshot = { path: '/', y: 0 }
  const stateListeners = new Set<(state: PartyState) => void>()
  const messageListeners = new Set<(message: PartyMessage, meta: PartyMessageMeta) => void>()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let introductions: ReturnType<typeof setInterval> | undefined
  // the latest of each kind the host said, so a guest can be brought back without asking the host
  const heard = new Map<PartyMessage['t'], PartyMessage>()
  const names = new Map<string, string>()
  const lines: PartyChatLine[] = []
  let issued: Grants | undefined
  let grants: Grants = NO_GRANTS
  let following = true
  // the host's choice of the party's tracks, and the choice in force as every member heard it
  let chosen: Partial<Record<TrackKind, string | null>> = {}
  let partyTracks: Partial<Record<TrackKind, string | null>> = {}
  let mine = FOLLOW_PARTY
  let playerTracks: EmbedTracks | undefined
  // What the host's clock reads relative to this one, and the round being collected. A guest that has
  // measured nothing keeps `undefined`, which every reader treats as no offset: the behaviour there
  // is exactly what it was before any of this existed.
  let clock: ClockSample | undefined
  let collecting: ClockSample[] | undefined
  let clockTimer: ReturnType<typeof setInterval> | undefined
  const pings = new Map<number, number>()
  let nonce = 1
  let ownName: string | undefined = (() => { try { return storage?.getItem(PARTY_NAME_KEY) ?? undefined } catch { return undefined } })()

  const setState = (next: PartyState) => {
    state = next
    for (const listener of stateListeners) listener(state)
  }

  const remember = (invite: string) => { try { storage?.setItem(PARTY_SESSION_KEY, invite) } catch {} }
  const forget = () => { try { storage?.removeItem(PARTY_SESSION_KEY) } catch {} }
  const remembered = (): string | undefined => { try { return storage?.getItem(PARTY_SESSION_KEY) ?? undefined } catch { return undefined } }

  const roleIn = (joined: Room): PartyRole => joined.owner === joined.self.id ? 'host' : 'guest'

  const tell = (message: PartyMessage, meta: PartyMessageMeta) => { for (const listener of messageListeners) listener(message, meta) }

  const memberCount = async (joined: Room) => {
    const members = await joined.members().catch(() => undefined)
    if (room !== joined || state.status !== 'active') return
    if (members) setState({ ...state, members: members.length })
  }

  // Sending is fire and forget: a refusal on one message is not the party's business. `rate-limited`
  // is the host scrubbing faster than the room admits, and the next heartbeat carries the position
  // anyway; `closed` is answered through `room.closed` below.
  const send = (message: PartyMessage) => {
    if (!room || state.status !== 'active') return
    if (isHostOnly(message) && state.role !== 'host') return
    room.send(encodePartyMessage(message)).catch(() => {})
  }

  /**
   * One round of round trips, as a guest.
   *
   * Each ping is stamped and remembered under a nonce, since every member hears every reply and a
   * guest must only believe the one answering its own question. The round's fastest sample replaces
   * the standing one when it closes, rather than the fastest ever seen: a sample kept forever would
   * be a measurement of a network moment years of drift could never dislodge.
   */
  const measureClock = () => {
    if (!room || state.status !== 'active' || state.role !== 'guest') return
    const joined = room
    const round: ClockSample[] = []
    collecting = round
    for (let index = 0; index < CLOCK_SAMPLES; index++) {
      setTimeout(() => {
        if (collecting !== round || room !== joined) return
        const at = Date.now()
        const n = nonce++
        pings.set(n, at)
        // a question nobody answered must not sit in the map for the life of the party
        setTimeout(() => pings.delete(n), MAX_USABLE_RTT_MS)
        send({ t: 'ping', n, at })
      }, index * CLOCK_SPACING_MS)
    }
    setTimeout(() => {
      if (collecting !== round || room !== joined) return
      collecting = undefined
      const best = bestSample(round)
      if (best) clock = best
    }, CLOCK_SAMPLES * CLOCK_SPACING_MS + MAX_USABLE_RTT_MS)
  }

  // The playback is moved to NOW before it goes out. The player reported it some seconds ago and a
  // joiner would otherwise be handed that second, then corrected by the next heartbeat; on the host's
  // own clock the move is exact.
  const whereWeAre = (): PartyMessage => ({
    t: 'state',
    path: snapshot.path,
    y: snapshot.y,
    ...snapshot.playback ? { s: advance(snapshot.playback, snapshot.playbackAt ?? Date.now(), Date.now()) } : {},
    ...issued ? { grants: issued } : {},
    ...chosen.subtitles !== undefined ? { sub: chosen.subtitles } : {},
    ...chosen.audio !== undefined ? { audio: chosen.audio } : {},
  })

  const hear = ({ grants: next = NO_GRANTS, sub, audio }: Extract<PartyMessage, { t: 'state' }>) => {
    const tracks = { subtitles: sub, audio }
    if (JSON.stringify([next, tracks]) === JSON.stringify([grants, partyTracks])) return
    grants = next
    partyTracks = tracks
    if (state.status === 'active') setState({ ...state })
  }

  const choose = (kind: TrackKind, id: string | null) => {
    chosen = { ...chosen, [kind]: id }
    send(whereWeAre())
  }

  /**
   * The host's last `state`, carrying the newest position the host has reported rather than the one
   * that state was built with.
   *
   * A `state` goes out on a STATE_HEARTBEAT_MS timer, so its position can be ten seconds old, while a
   * `scroll` goes out twice a second whenever the host moves. When the scroll is the later of the two
   * it is the host's own correction to the same page, and a listener asking to be caught up should be
   * placed there. Measured 2026-09-08: Catch up put followers at the top of a page the host was
   * 1,080px down, whenever no heartbeat happened to fall between the host's move and the ask.
   *
   * `heard` is rewritten on every message (deleted, then set), so its key order IS arrival order.
   */
  const freshestState = (): PartyMessage | undefined => {
    const state = heard.get('state')
    const scroll = heard.get('scroll')
    if (state?.t !== 'state' || scroll?.t !== 'scroll') return state
    const order = [...heard.keys()]
    return order.indexOf('scroll') > order.indexOf('state') ? { ...state, y: scroll.y } : state
  }

  const detach = () => {
    unlisten?.()
    unlisten = undefined
    room = undefined
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = undefined
    if (introductions) clearInterval(introductions)
    introductions = undefined
    if (clockTimer) clearInterval(clockTimer)
    clockTimer = undefined
    // a fresh party is a fresh clock: the next host is another machine
    collecting = undefined
    clock = undefined
    pings.clear()
    mine = FOLLOW_PARTY
  }

  const attach = async (joined: Room) => {
    room = joined
    const role = roleIn(joined)
    names.clear()
    lines.length = 0
    issued = undefined
    grants = NO_GRANTS
    following = true
    chosen = {}
    partyTracks = {}
    setState({ status: 'active', role, invite: joined.invite, members: 1, self: joined.self.id, owner: joined.owner })
    remember(joined.invite)

    unlisten = await joined.on(event => {
      if (room !== joined) return
      switch (event.type) {
        case 'message': {
          const message = decodePartyMessage(event.message.text)
          if (!message) return
          const from = event.message.from
          const self = from === joined.self.id
          // The clock exchange is plumbing: it answers or it is answered, and nothing above the
          // store ever sees it. Handled before the steering branch so a pong is not filed as the
          // last thing the host said and replayed to a listener years of milliseconds later.
          if (message.t === 'ping') {
            if (role === 'host' && !self) send({ t: 'pong', n: message.n, at: message.at, host: Date.now() })
            return
          }
          if (message.t === 'pong') {
            if (role !== 'guest' || from !== joined.owner) return
            const sent = pings.get(message.n)
            // the echoed stamp must be the one that went out under that nonce, or it is not our trip
            if (sent === undefined || sent !== message.at) return
            pings.delete(message.n)
            const sample = clockSample(sent, message.host, Date.now())
            if (sample.rtt > MAX_USABLE_RTT_MS) return
            collecting?.push(sample)
            // the first answer beats no answer: a guest should not watch a whole round go by on the
            // old assumption when it already has something measured
            if (!clock) clock = sample
            return
          }
          // Steering is the owner's, and the api hands a sender its own message back with the same
          // seq: the host must not follow itself, and nobody follows anyone but the host, whatever
          // the room let through.
          if (isHostOnly(message)) {
            if (from !== joined.owner) return
            if (message.t === 'state') hear(message)
            if (role === 'host') return
            heard.delete(message.t)
            heard.set(message.t, message)
            tell(message, { replayed: false, from, self })
            return
          }
          if (message.t === 'ask') {
            if (!allowed(grants, from, message.c)) return
            // the same member using the same control again replaces its line, so a scrub reads as one
            const last = lines.at(-1)
            if (last?.from === from && last.action === message.c) lines.pop()
            // here rather than on the watch page, so the party's track is set from any page
            if (role === 'host' && message.c === 'subs') choose('subtitles', message.sub)
            if (role === 'host' && message.c === 'audio') choose('audio', message.audio)
          }
          if (message.t === 'name') names.set(from, message.name)
          if (message.t === 'chat' || message.t === 'ask') {
            const said = message.t === 'chat' ? { text: message.text } : { text: actionText(message), action: message.c }
            lines.push({ seq: event.message.seq, from, name: names.get(from), at: event.message.at, self, ...said })
            if (lines.length > CHAT_KEEP) lines.splice(0, lines.length - CHAT_KEEP)
          }
          tell(message, { replayed: false, from, self })
          return
        }
        case 'joined': {
          // What a joiner needs is where the party is NOW, so it is built from the latest report
          // rather than from the last thing that happened to be sent. And everyone with a name says
          // it again, since a joiner heard none of the introductions.
          if (role === 'host') send(whereWeAre())
          if (ownName) send({ t: 'name', name: ownName })
          void memberCount(joined)
          return
        }
        case 'left': {
          // A room outlives its owner, a party does not: nobody else can ever send, so a room whose
          // host is gone is a room where nothing will ever happen again.
          if (role === 'guest' && event.id === joined.owner) {
            void end('host-left')
            return
          }
          // A kick or a block arrives as `left` too, and a member who is gone needs no grants. A denial
          // stays: the same tab comes back with the same id after the seat hold, and "everyone except
          // Sam" must not lift because Sam's connection dropped.
          const entry = issued?.by[event.id]
          if (role === 'host' && issued && entry && !Object.values(entry).includes(false)) {
            issued = { ...issued, by: Object.fromEntries(Object.entries(issued.by).filter(([id]) => id !== event.id)) }
            send(whereWeAre())
            setState({ ...state })
          }
          void memberCount(joined)
          return
        }
      }
    })
    if (room !== joined) { unlisten(); unlisten = undefined; return }

    if (role === 'host') heartbeat = setInterval(() => send(whereWeAre()), STATE_HEARTBEAT_MS)
    if (role === 'guest') {
      measureClock()
      clockTimer = setInterval(measureClock, CLOCK_INTERVAL_MS)
    }
    introductions = setInterval(() => { if (ownName) send({ t: 'name', name: ownName }) }, NAME_HEARTBEAT_MS)
    if (ownName) send({ t: 'name', name: ownName })
    void memberCount(joined)
    joined.closed.then(({ reason }) => {
      if (room !== joined) return
      detach()
      forget()
      setState({ status: 'ended', reason })
    })
  }

  const may = (control: Control) => state.status === 'active' && (state.role === 'host' || allowed(grants, state.self, control))

  const end = async (reason: PartyEndReason) => {
    const leaving = room
    detach()
    forget()
    setState({ status: 'ended', reason })
    await leaving?.leave().catch(() => {})
  }

  const fail = (error: unknown, resuming: boolean) => {
    forget()
    // A resume that finds no room is a party that ended while the tab was closed, and there is
    // nothing to announce on a page that never showed one.
    if (resuming) { setState({ status: 'idle' }); return }
    setState({ status: 'failed', code: isRoomsError(error) ? error.code : 'unknown' })
  }

  const open = async (invite: string | undefined, start: () => Promise<Room>, resuming = false) => {
    if (room) await end('left')
    heard.clear()
    setState({ status: 'joining', invite: invite ?? '' })
    try {
      const joined = await start()
      await attach(joined)
    } catch (error) {
      fail(error, resuming)
    }
  }

  return {
    getState: () => state,
    subscribe: listener => { stateListeners.add(listener); return () => { stateListeners.delete(listener) } },
    onMessage: listener => { messageListeners.add(listener); return () => { messageListeners.delete(listener) } },
    // Everyone may send, because everyone may talk. What keeps steering the host's is the class check
    // on receipt above, and what keeps a room civil is the host's `kick` and `ban`.
    create: () => open(undefined, () => api.create()),
    join: invite => open(invite, () => api.join(invite)),
    resume: async () => {
      const invite = remembered()
      if (!invite || room) return
      await open(invite, () => api.join(invite), true)
    },
    leave: async () => { if (room) await end('left') },
    send,
    setLocation: (path, y) => { snapshot.path = path; snapshot.y = y },
    setPlayback: playback => { snapshot.playback = playback; snapshot.playbackAt = Date.now() },
    issued: () => issued ?? NO_GRANTS,
    setGrants: next => {
      if (state.status !== 'active' || state.role !== 'host') return
      issued = next
      send(whereWeAre())
      setState({ ...state })
    },
    may,
    partyTrack: kind => partyTracks[kind],
    setPartyTrack: (kind, id) => {
      if (state.status !== 'active') return
      if (state.role === 'host') choose(kind, id)
      else if (may(TRACK_CONTROL[kind])) send(kind === 'subtitles' ? { t: 'ask', c: 'subs', sub: id } : { t: 'ask', c: 'audio', audio: id })
    },
    mine: kind => mine[kind],
    setMine: (kind, next) => { mine = { ...mine, [kind]: next }; setState({ ...state }) },
    playerTracks: () => playerTracks,
    setPlayerTracks: tracks => { playerTracks = tracks; setState({ ...state }) },
    invite: () => state.status === 'active' ? state.invite : undefined,
    hostClock: () => clock,
    hostPath: () => {
      const last = [...heard.values()].filter((message): message is Extract<PartyMessage, { path: string }> => 'path' in message)
      // whichever of the two carried a path was heard last: the store keeps one per kind, so the later
      // one is the one with the higher seq, and both are set in order of arrival
      return last.at(-1)?.path
    },
    following: () => following,
    setFollowing: on => { following = on; setState({ ...state }) },
    replay: () => {
      // The state first, since it is the only one carrying a path and a position together, so a scroll
      // or a playback after it lands on the page it was meant for.
      for (const kind of ['state', 'nav', 'scroll', 'playback'] as const) {
        const message = kind === 'state' ? freshestState() : heard.get(kind)
        if (message && room) tell(message, { replayed: true, from: room.owner, self: false })
      }
      if (!following) { following = true; setState({ ...state }) }
    },
    nameOf: id => names.get(id),
    roster: async () => {
      if (!room) return []
      const current = room
      const members = await current.members().catch(() => [])
      return members.map(member => ({
        id: member.id,
        name: names.get(member.id),
        host: member.id === current.owner,
        self: member.id === current.self.id,
      }))
    },
    chat: () => lines.slice(),
    setName: name => {
      ownName = name
      try { name ? storage?.setItem(PARTY_NAME_KEY, name) : storage?.removeItem(PARTY_NAME_KEY) } catch {}
      if (name) send({ t: 'name', name })
    },
    name: () => ownName,
    kick: async id => { if (room && state.status === 'active' && state.role === 'host') await room.remove(id) },
    ban: async id => { if (room && state.status === 'active' && state.role === 'host') await room.block(id) },
    playing: () => Boolean(snapshot.playback && !snapshot.playback.paused),
    dismiss: () => { if (state.status === 'ended' || state.status === 'failed') setState({ status: 'idle' }) },
  }
}
