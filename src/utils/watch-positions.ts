import { useEffect, useState } from 'preact/hooks'

import { createSettings } from '../settings-store'
import { WATCHED_AT } from '../tracking/watched'

/** Where the viewer stopped in each episode not finished, in localStorage: a list of `KeptPosition`, oldest first. */
export const WATCH_POSITIONS_KEY = 'stub.player.positions'

/** The localStorage key holding the FKN account's points as last read, while this browser uses them. */
export const ACCOUNT_POSITIONS_KEY = 'stub.player.positions.account'

/** How many points are kept, and as many finished sources: past it, the oldest goes. */
export const KEPT_POSITIONS = 200

/** The seconds into an episode under which no point is kept, and under which a player opened is resumed. */
export const RESUME_FROM = 30

/** Where a source stopped, in seconds, its length, 0 for a player that never says it, and when, in ms. */
export type WatchPosition = [sourceUri: string, time: number, duration: number, savedAt: number]

/** A source played to WATCHED_AT or its end, and when: kept so that its point leaves every device. */
export type Finished = [sourceUri: string, savedAt: number]

/** What is kept of a source: where it stopped, or that it was finished. */
export type KeptPosition = WatchPosition | Finished

const savedAt = (kept: KeptPosition) => kept.length === 2 ? kept[1] : kept[3]

// a point kept before the points had a time, [source, time, length], reads as the oldest
const keptOf = (value: unknown): KeptPosition[] => {
  if (!Array.isArray(value) || typeof value[0] !== 'string' || !value.slice(1).every(item => typeof item === 'number')) return []
  const [uri, ...numbers] = value as [string, ...number[]]
  if (numbers.length === 1) return [[uri, numbers[0]!]]
  return numbers.length === 2 || numbers.length === 3 ? [[uri, numbers[0]!, numbers[1]!, numbers[2] ?? 0]] : []
}

const parse = (text: string | null): KeptPosition[] => {
  try {
    const saved: unknown = JSON.parse(text ?? '[]')
    return Array.isArray(saved) ? saved.flatMap(keptOf) : []
  } catch {
    return []
  }
}

/**
 * Two lists of `KeptPosition` as one, either null for none: each source's newest entry, `mine` on a tie,
 * oldest first, then only the KEPT_POSITIONS newest points and as many of the newest finished sources.
 */
export const mergePositions = (theirs: string | null, mine: string | null): string => {
  const newest = new Map<string, KeptPosition>()
  for (const kept of [...parse(theirs), ...parse(mine)]) {
    const before = newest.get(kept[0])
    if (before && savedAt(before) > savedAt(kept)) continue
    // moved to the end, so a tie of times still sorts the newer one last
    newest.delete(kept[0])
    newest.set(kept[0], kept)
  }
  const sorted = [...newest.values()].sort((a, b) => savedAt(a) - savedAt(b))
  const kept = new Set([
    ...sorted.filter(entry => entry.length === 4).slice(-KEPT_POSITIONS),
    ...sorted.filter(entry => entry.length === 2).slice(-KEPT_POSITIONS),
  ])
  return JSON.stringify(sorted.filter(entry => kept.has(entry)))
}

/** The store of the points over `storage`, following the FKN account through src/settings-sync.ts's `positionsSync`. */
export const positionsStore = (storage?: Parameters<typeof createSettings>[0]) =>
  createSettings(storage, { accountKey: ACCOUNT_POSITIONS_KEY, merge: mergePositions })

/** This browser's points, one store for every reader on the page. */
export const positions = positionsStore()

/** The kept points and finished sources, oldest first; none when storage cannot be read. */
export const readPositions = (): KeptPosition[] => parse(positions.getItem(WATCH_POSITIONS_KEY))

/** The newest point in `kept`, the kept ones by default, for any of `uris`, an episode's sources; none once the newest of them is finished. */
export const newestPosition = (uris: readonly string[], kept = readPositions()): WatchPosition | undefined => {
  const newest = kept.findLast(([uri]) => uris.includes(uri))
  return newest?.length === 4 ? newest : undefined
}

/** The kept points, kept current with this tab, another one and the account. */
export const usePositions = (): KeptPosition[] => {
  const [kept, setKept] = useState(readPositions)
  useEffect(() => positions.watch(WATCH_POSITIONS_KEY, () => setKept(readPositions())), [])
  return kept
}

/**
 * Keeps where `uri` is: finished once the share played reaches WATCHED_AT or the player ended, left as
 * it was under RESUME_FROM seconds or while `duration` is 0 (a player that says its length has not said
 * it yet), and otherwise moved to the newest place. `duration` is undefined for a player that never
 * says its length. Merged into what is stored on each save, so two tabs do not undo each other.
 */
export const savePosition = (uri: string, { time, duration, ended = false }: { time: number, duration?: number, ended?: boolean }) => {
  const finished = ended || (duration !== undefined && duration > 0 && time / duration >= WATCHED_AT)
  if (!finished && (time < RESUME_FROM || duration === 0)) return
  // through the credits, a source stays finished when it first was
  if (finished && readPositions().find(([kept]) => kept === uri)?.length === 2) return
  const kept: KeptPosition = finished ? [uri, Date.now()] : [uri, time, duration ?? 0, Date.now()]
  try {
    positions.setItem(WATCH_POSITIONS_KEY, JSON.stringify([kept]))
  } catch {}
}
