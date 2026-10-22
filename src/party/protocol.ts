// What crosses the room, as data. Pure, with no runtime imports, so it can be tested: the store that sends it
// reaches @fkn/lib, which cannot load under vitest.
import type { TrackKind } from '../embed-tracks'

/** What the host's player is doing, as the followers are told it. `at` is the host's own clock. */
export type PlaybackState = {
  paused: boolean
  time: number
  rate: number
  at: number
}

/** Where a follower stands, as the host sees it: ready to play, loading, or away from the host's episode. */
export type FollowerState = 'ready' | 'loading' | 'away'
export const FOLLOWER_STATES: readonly FollowerState[] = ['ready', 'loading', 'away']

/** A control the host can hand out to followers. Each one joins the list in the change that wires it. */
export type Control = 'play' | 'seek' | 'rate' | 'go' | 'subs' | 'audio'
export const CONTROLS: readonly Control[] = ['play', 'seek', 'go', 'rate', 'subs', 'audio']
/** The controls a follower uses on its player, whose ask carries the player's state. */
export type PlayerControl = Exclude<Control, 'go' | 'subs' | 'audio'>

/** The control that sets the party's track of a kind. */
export const TRACK_CONTROL = { subtitles: 'subs', audio: 'audio' } as const satisfies Record<TrackKind, Control>

/**
 * Who may use which control. `all` is every follower; `by` is per member, where `true` gives a control,
 * `false` takes it away, and an absent control follows `all`. Memory only: never stored, never logged.
 */
export type Grants = { all: Control[], by: Record<string, Partial<Record<Control, boolean>>> }
export const NO_GRANTS: Grants = { all: [], by: {} }

export const allowed = (grants: Grants, id: string, control: Control): boolean =>
  grants.by[id]?.[control] ?? grants.all.includes(control)

/**
 * What crosses the room, in two classes.
 *
 * HOST ONLY: `nav` and `scroll` are where the host is, `cursor` is where the host is pointing,
 * `playback` is what the host's player did, and `state` is location, scroll and playback at once,
 * sent to whoever just joined so they land where the party already is. A follower drops any of these
 * from anyone but the room's owner, whatever the api let through.
 *
 * ANYONE: `chat` is a line of text for the room, `name` is what the sender wants to be called,
 * `ping` is a follower timing a round trip so it can tell the host's clock from its own, and `ask` is
 * a follower asking the host to use a control: `s` is the asker's player right after the person acted
 * (its `at` on the host's clock once measured), `path` the page it acted on. A `go` ask carries only
 * the watch page the follower wants the party on. Only the host acts on an ask, and every member
 * drops one whose sender the last `grants` do not allow.
 *
 * `state.grants` is who may use what; absent is nobody. `state.sub` and `state.audio` are the party's
 * subtitles and audio track: absent, the party sets none; null, off; a string, a track id as the player
 * names it. A `subs` or `audio` ask carries the track the follower wants the party on, in the same form.
 *
 * `status` is a follower telling the host where it stands (see status.ts): `path` is the watch page it
 * is about, absent once it is off the host's page, so it never says where it went; `time` is where its
 * player is as it sends, and `rate` how fast that moves, 0 while paused or waiting for data.
 *
 * `pong` is host only and is the reply to one ping: it carries the asker's own `at` back untouched
 * plus the host's clock at the moment it answered, which is everything Cristian's algorithm needs
 * (see clock.ts). `n` is the asker's nonce, since every member hears every reply.
 */
export type PartyMessage =
  | { t: 'nav', path: string }
  | { t: 'scroll', y: number }
  | { t: 'cursor', x: number, y: number }
  | { t: 'playback', s: PlaybackState }
  | { t: 'state', path: string, y: number, s?: PlaybackState, grants?: Grants, sub?: string | null, audio?: string | null }
  | { t: 'ask', c: PlayerControl, path: string, s: PlaybackState }
  | { t: 'ask', c: 'go', path: string }
  | { t: 'ask', c: 'subs', sub: string | null }
  | { t: 'ask', c: 'audio', audio: string | null }
  | { t: 'chat', text: string }
  | { t: 'name', name: string }
  | { t: 'ping', n: number, at: number }
  | { t: 'pong', n: number, at: number, host: number }
  | { t: 'status', s: FollowerState, path?: string, time?: number, rate?: number }

/** An ask about the follower's player, as opposed to where the party is. */
export type PlayerAsk = Extract<PartyMessage, { t: 'ask', c: PlayerControl }>

const HOST_ONLY: ReadonlySet<PartyMessage['t']> = new Set(['nav', 'scroll', 'cursor', 'playback', 'state', 'pong'])

/** Whether a message is the host steering the party, as opposed to anyone talking in it. */
export const isHostOnly = (message: PartyMessage): boolean => HOST_ONLY.has(message.t)

/** The longest chat line and name the room carries. The room's own cap is 262,144 bytes of the whole message. */
export const CHAT_MAX_CHARS = 500
export const NAME_MAX_CHARS = 32

/** A typed line or name as the wire carries it: trimmed, bounded, and nothing when empty. */
export const chatText = (raw: string): string | undefined => {
  const text = raw.trim().slice(0, CHAT_MAX_CHARS)
  return text ? text : undefined
}
export const displayName = (raw: string): string | undefined => {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX_CHARS)
  return name ? name : undefined
}

/** Bumped when a message shape changes; a follower on another version ignores what it cannot read. */
export const PARTY_PROTOCOL = 1

export const encodePartyMessage = (message: PartyMessage): string =>
  JSON.stringify({ v: PARTY_PROTOCOL, ...message })

/**
 * A room message as a party message, or nothing.
 *
 * Nothing rather than a throw for every way it can be wrong: another version, a text that is not
 * JSON, a shape a field short, a path that would leave the app. A follower applies what it decodes
 * to its own location bar, so a message it cannot vouch for has to fall on the floor.
 */
export const decodePartyMessage = (text: string): PartyMessage | undefined => {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return undefined }
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  if (value.v !== PARTY_PROTOCOL) return undefined

  switch (value.t) {
    case 'nav':
      return isAppPath(value.path) ? { t: 'nav', path: value.path } : undefined
    case 'scroll':
      return isFraction(value.y) ? { t: 'scroll', y: value.y } : undefined
    case 'cursor':
      return isFraction(value.x) && isFraction(value.y) ? { t: 'cursor', x: value.x, y: value.y } : undefined
    case 'chat': {
      const text = typeof value.text === 'string' ? chatText(value.text) : undefined
      return text ? { t: 'chat', text } : undefined
    }
    case 'name': {
      const name = typeof value.name === 'string' ? displayName(value.name) : undefined
      return name ? { t: 'name', name } : undefined
    }
    case 'ping':
      return isStamp(value.n) && isStamp(value.at) ? { t: 'ping', n: value.n, at: value.at } : undefined
    case 'pong':
      return isStamp(value.n) && isStamp(value.at) && isStamp(value.host)
        ? { t: 'pong', n: value.n, at: value.at, host: value.host }
        : undefined
    case 'playback':
      return isPlaybackState(value.s) ? { t: 'playback', s: value.s } : undefined
    case 'state': {
      if (!isAppPath(value.path) || !isFraction(value.y)) return undefined
      if (value.s !== undefined && !isPlaybackState(value.s)) return undefined
      const grants = decodeGrants(value.grants)
      const sub = trackId(value.sub)
      const audio = trackId(value.audio)
      return {
        t: 'state', path: value.path, y: value.y,
        ...value.s ? { s: value.s } : {},
        ...grants ? { grants } : {},
        ...sub !== undefined ? { sub } : {},
        ...audio !== undefined ? { audio } : {},
      }
    }
    case 'status': {
      if (!FOLLOWER_STATES.includes(value.s as FollowerState)) return undefined
      if (value.path !== undefined && !isWatchPath(value.path)) return undefined
      const timed = isSeconds(value.time) && typeof value.rate === 'number' && value.rate >= 0 && value.rate <= 16
      if (!timed && (value.time !== undefined || value.rate !== undefined)) return undefined
      return {
        t: 'status', s: value.s as FollowerState,
        ...value.path !== undefined ? { path: value.path } : {},
        ...timed ? { time: value.time as number, rate: value.rate as number } : {},
      }
    }
    case 'ask': {
      if (value.c === 'go') return isWatchPath(value.path) ? { t: 'ask', c: 'go', path: value.path } : undefined
      if (value.c === 'subs') {
        const sub = trackId(value.sub)
        return sub === undefined ? undefined : { t: 'ask', c: 'subs', sub }
      }
      if (value.c === 'audio') {
        const audio = trackId(value.audio)
        return audio === undefined ? undefined : { t: 'ask', c: 'audio', audio }
      }
      return isControl(value.c) && isAppPath(value.path) && isPlaybackState(value.s)
        ? { t: 'ask', c: value.c as PlayerControl, path: value.path, s: value.s }
        : undefined
    }
    default:
      return undefined
  }
}

const isControl = (value: unknown): value is Control => CONTROLS.includes(value as Control)

/**
 * Grants as the wire carries them, or nothing (which reads as nobody may) for a shape that is wrong.
 *
 * A control this version does not know is skipped rather than failing the whole, so the next control
 * added does not make every older follower drop every `state`. More than MAX_GRANTED members cannot
 * come from a room of a hundred.
 */
const decodeGrants = (value: unknown): Grants | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { all, by } = value as Record<string, unknown>
  if (!Array.isArray(all) || !by || typeof by !== 'object' || Array.isArray(by)) return undefined
  const entries = Object.entries(by)
  if (entries.length > MAX_GRANTED) return undefined
  const decoded: Grants = { all: all.filter(isControl), by: {} }
  for (const [id, controls] of entries) {
    if (!id || id.length > 128 || !controls || typeof controls !== 'object') return undefined
    decoded.by[id] = Object.fromEntries(Object.entries(controls).filter(([control, on]) => isControl(control) && typeof on === 'boolean'))
  }
  return decoded
}

const MAX_GRANTED = 100

/** A track id as the wire carries it: 1 to 64 characters once its spaces are collapsed, or null for off. Anything else is nothing. */
const trackId = (value: unknown): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const id = value.replace(/\s+/g, ' ').trim()
  return id && id.length <= 64 ? id : undefined
}

/** What an ask did, as a chat line says it after the member's name. */
export const actionText = (ask: Extract<PartyMessage, { t: 'ask' }>): string =>
  ask.c === 'go' ? 'changed the episode'
  : ask.c === 'subs' ? trackText('subtitles', ask.sub)
  : ask.c === 'audio' ? trackText('audio', ask.audio)
  : ask.c === 'seek' ? `skipped to ${clockText(ask.s.time)}`
  : ask.c === 'rate' ? `set speed to ${Number(ask.s.rate.toFixed(2))}x`
  : ask.s.paused ? 'paused' : 'resumed'

const trackText = (noun: string, id: string | null) => id === null ? `turned ${noun} off` : `set ${noun} to ${id}`

/** A player's time as a clock reads it: 4:05, or 1:02:05 past the hour. */
export const clockText = (seconds: number): string => {
  const total = Math.floor(seconds)
  const pad = (value: number) => String(value).padStart(2, '0')
  const minutes = Math.floor(total / 60) % 60
  return total >= 3600 ? `${Math.floor(total / 3600)}:${pad(minutes)}:${pad(total % 60)}` : `${minutes}:${pad(total % 60)}`
}

/**
 * Whether a string is a path INSIDE this app.
 *
 * A follower hands a decoded path straight to the router, so this is the one place that decides what
 * a host can make a follower open. A single leading slash and nothing else: `//host` is a
 * protocol-relative url, and a scheme or a backslash is a browser reinterpreting the string.
 */
export const isAppPath = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && value.length <= 2048
  && value.startsWith('/')
  && !value.startsWith('//')
  && !value.startsWith('/\\')
  && !/[\r\n\t]/.test(value)

/**
 * Whether a path is a watch page, the only place a follower can ask the party to go. Read on the path
 * the browser resolves, since a dot segment (`/watch/../party`, `%2e%2e`, a backslash) leaves the prefix.
 */
export const isWatchPath = (value: unknown): value is string =>
  isAppPath(value) && new URL(value, 'https://stub.invalid').pathname.startsWith('/watch/')

/**
 * A number a clock exchange may carry.
 *
 * Finite is the whole requirement and it is load bearing: a NaN or an Infinity anywhere in the
 * arithmetic makes the offset NaN, and a NaN offset silently turns every target time into NaN, which
 * a player takes as a seek to nowhere. Sign is not checked, since an offset is a difference.
 */
const isStamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isSeconds = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

const isFraction = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1

/** Whether a value is a playback state a follower could act on. A package's report is vetted with it before it reaches the room. */
export const isPlaybackState = (value: unknown): value is PlaybackState => {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  return typeof state.paused === 'boolean'
    && isSeconds(state.time)
    && typeof state.rate === 'number' && Number.isFinite(state.rate) && state.rate > 0 && state.rate <= 16
    && typeof state.at === 'number' && Number.isFinite(state.at)
}
