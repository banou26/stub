import { WATCHED_AT } from '../tracking/watched'

/** Where the viewer stopped in each episode not finished, in localStorage: a list of `WatchPosition`, oldest first. */
export const WATCH_POSITIONS_KEY = 'stub.player.positions'

/** How many points are kept: past it, the oldest goes. */
export const KEPT_POSITIONS = 200

/** The seconds into an episode under which no point is kept, and under which a player opened is resumed. */
export const RESUME_FROM = 30

/** Where a source stopped, in seconds, and its length, 0 for a player that never says it. */
export type WatchPosition = [sourceUri: string, time: number, duration: number]

const isPosition = (value: unknown): value is WatchPosition =>
  Array.isArray(value) && value.length === 3 && typeof value[0] === 'string' && typeof value[1] === 'number' && typeof value[2] === 'number'

/** The kept points, oldest first; none when storage cannot be read. */
export const readPositions = (): WatchPosition[] => {
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage.getItem(WATCH_POSITIONS_KEY) ?? '[]')
    return Array.isArray(saved) ? saved.filter(isPosition) : []
  } catch {
    return []
  }
}

/** The newest point in `positions`, the kept ones by default, for any of `uris`, an episode's sources. */
export const newestPosition = (uris: readonly string[], positions = readPositions()): WatchPosition | undefined =>
  positions.findLast(([uri]) => uris.includes(uri))

/**
 * Keeps where `uri` is: forgotten once the share played reaches WATCHED_AT or the player ended, left as
 * it was under RESUME_FROM seconds or while `duration` is 0 (a player that says its length has not said
 * it yet), and otherwise moved to the newest place. `duration` is undefined for a player that never
 * says its length. Read from storage on each save, so two tabs do not undo each other.
 */
export const savePosition = (uri: string, { time, duration, ended = false }: { time: number, duration?: number, ended?: boolean }) => {
  const forget = ended || (duration !== undefined && duration > 0 && time / duration >= WATCHED_AT)
  if (!forget && (time < RESUME_FROM || duration === 0)) return
  const others = readPositions().filter(([kept]) => kept !== uri)
  const positions: WatchPosition[] = forget ? others : [...others, [uri, time, duration ?? 0]]
  try {
    globalThis.localStorage.setItem(WATCH_POSITIONS_KEY, JSON.stringify(positions.slice(-KEPT_POSITIONS)))
  } catch {}
}
