// The compact tracking row as data: what it shows, where a change goes, and how saves are paced.
// Import free but for the score scales, so every rule here is pinned under vitest.

import { coarser, isScored, onScale } from './score-scale'

export type CompactEntry = {
  status?: string | null
  progress?: number | null
  score?: number | null
  episodeCount?: number | null
}

export type CompactAnswer = {
  state: string
  candidates: string[]
  error?: string | null
  tracker: {
    id: string
    name: string
    canWrite: boolean
    scoreScale?: string | null
    icon?: string | null
    color?: string | null
    account?: string | null
  }
  entry?: CompactEntry | null
}

/** One media's tracking as the row reads it: the worker's summary and every tracker's own answer. */
export type CompactTracking = {
  summary?: CompactEntry | null
  disagreements: readonly string[]
  answers: readonly CompactAnswer[]
}

export const STATUS_LABELS: Record<string, string> = {
  WATCHING: 'Watching',
  REWATCHING: 'Rewatching',
  PLANNING: 'Plan to watch',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
}

/** The fields a change touched. A null score clears it; an absent key is left as the tracker has it. */
export type Fields = { status?: string, progress?: number, score?: number | null }

export type Row = {
  status: string | null
  progress: number
  score: number | null
  /** The episodes the row counts to, or null when nothing says. */
  total: number | null
  /** Which of the row's three fields the listed trackers hold differently. */
  differs: string[]
}

const WRITABLE_STATES = new Set(['LISTED', 'NOT_LISTED'])
/** A tracker that can write, and has answered with its entry or its lack of one. */
export const writable = (answer: CompactAnswer) => answer.tracker.canWrite && WRITABLE_STATES.has(answer.state)

/** What the row shows: the worker's summary, which covers every listed tracker whether or not the viewer writes to it. */
export const rowOf = (
  tracking: { summary?: CompactEntry | null, disagreements: readonly string[] } | null | undefined,
  episodeCount?: number | null,
): Row => {
  const summary = tracking?.summary
  return {
    status: summary?.status ?? null,
    progress: summary?.progress ?? 0,
    score: isScored(summary?.score) ? summary!.score! : null,
    total: summary?.episodeCount ?? episodeCount ?? null,
    differs: [...(tracking?.disagreements ?? [])],
  }
}

export type Target =
  | { kind: 'check', checked: boolean, sendable: boolean }
  | { kind: 'login' }
  | { kind: 'cannot', reason: string }

/**
 * How one tracker's chip reads. `stored` is the viewer's own choice on this device, if they made one;
 * without it every tracker that can write starts checked.
 */
export const targetOf = (answer: CompactAnswer, stored: boolean | undefined): Target => {
  switch (answer.state) {
    case 'SIGNED_OUT': return { kind: 'login' }
    case 'NO_ID': return { kind: 'cannot', reason: 'Has no id for this media' }
    case 'AMBIGUOUS': return { kind: 'cannot', reason: `Names ${answer.candidates.join(' and ')}, cannot tell which` }
  }
  if (!answer.tracker.canWrite) return { kind: 'cannot', reason: 'Is read only' }
  const checked = stored ?? true
  return { kind: 'check', checked, sendable: checked && writable(answer) }
}

/**
 * Whether a tracker counts the media in other episodes than the row does, which makes the row's
 * progress mean something else there (AniList's 24 episode entry against MyAnimeList's 12 episode part).
 */
export const countDiffers = (answer: CompactAnswer, total: number | null) => {
  const own = answer.entry?.episodeCount
  return own != null && total != null && own !== total
}

/**
 * What a change writes to one tracker.
 *
 * A listed tracker gets exactly the fields changed, so a + never overwrites a score or a status that
 * tracker holds differently. A tracker that lists nothing gets the whole row as shown, since a new
 * entry overwrites nothing, with Watching when the row has no status (MyAnimeList refuses an add with
 * none). Progress is held back from a tracker that counts other episodes.
 */
export const patchFor = (answer: CompactAnswer, change: Fields, row: Row): Fields | undefined => {
  const score = 'score' in change ? change.score : row.score
  const fields: Fields = answer.state === 'LISTED'
    ? { ...change }
    : {
      status: change.status ?? row.status ?? 'WATCHING',
      progress: change.progress ?? row.progress,
      // nothing to clear on an entry that does not exist yet
      ...(isScored(score) ? { score } : {}),
    }
  if (fields.progress !== undefined) {
    if (countDiffers(answer, row.total)) delete fields.progress
    else fields.progress = Math.max(0, Math.min(row.total ?? Infinity, fields.progress))
  }
  return Object.keys(fields).length ? fields : undefined
}

/** The scores a scale's menu offers, on 0 to 100, as each lands on its face (tracking/score-scale.ts). */
export const PICKS: Record<string, number[]> = {
  POINT_3: [30, 50, 85],
  POINT_5: [20, 40, 60, 80, 100],
  POINT_10: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  POINT_10_DECIMAL: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
  POINT_100: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
}

/**
 * The scale the star offers: the coarsest among the trackers a pick would go to, so no tracker is sent
 * a score it cannot keep. Undefined with none to go to. `mixed` says the scales differ.
 */
export const pickerScale = (scales: readonly (string | null | undefined)[]) => {
  if (!scales.length) return undefined
  const known = scales.map(scale => scale && PICKS[scale] ? scale : 'POINT_100')
  const scale = known.reduce<string>((a, b) => coarser(a, b) ?? 'POINT_100', 'POINT_100')
  return { scale, mixed: new Set(known).size > 1 }
}

/** A pick on `scale`, as the 0 to 100 value that is written. */
export const written = (score: number, scale: string) => onScale(score, scale)

export type Outcome = { outcome: string, error?: string | null }
/** How one tracker's write went, as `saveListEntry` reports it; a write that reached no tracker names none. */
export type TrackerOutcome = Outcome & { tracker: string }
export type Settled = { tracker: string, outcome: string, fields: Fields, error?: string | null }
export type QueueState = { busy: boolean, failed?: { fields: Fields, error: string }, refused?: string }

type Timers = { set: (run: () => void, ms: number) => unknown, clear: (handle: unknown) => void }

/**
 * The saves of one row, paced PER TRACKER.
 *
 * `stage` merges a change into each tracker's waiting fields (later fields win). An immediate stage
 * sends at once; any other waits for `delay` of quiet, which is what folds rapid + clicks into one
 * save. At most one save is in flight per tracker, and a change made meanwhile goes when it settles.
 * Trackers never wait on each other: stub's own tracker answers at once, MyAnimeList reads, writes and
 * reads back.
 *
 * FAILED keeps its fields for `retry` and for the next change, since every write sets absolute values.
 * REFUSED drops them: the same write would be refused again.
 */
export const createSaveQueue = (
  { send, onChange = () => {}, delay = 1000, timers = { set: (run, ms) => setTimeout(run, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) } }:
  {
    send: (tracker: string, fields: Fields) => Promise<Outcome>
    onChange?: (settled?: Settled) => void
    delay?: number
    timers?: Timers
  }
) => {
  const waiting = new Map<string, Fields>()
  const released = new Set<string>()
  const flying = new Map<string, Fields>()
  const failed = new Map<string, { fields: Fields, error: string }>()
  const refused = new Map<string, string>()
  let timer: unknown

  const next = (tracker: string) => {
    const fields = waiting.get(tracker)
    if (!fields || !released.has(tracker) || flying.has(tracker)) return
    waiting.delete(tracker)
    released.delete(tracker)
    flying.set(tracker, fields)
    const settle = (outcome: string, error?: string | null) => {
      flying.delete(tracker)
      if (outcome === 'SAVED' || outcome === 'QUEUED') failed.delete(tracker)
      else if (outcome === 'REFUSED') refused.set(tracker, error ?? 'Refused')
      else {
        failed.set(tracker, { fields, error: error ?? 'Did not save' })
        const later = waiting.get(tracker)
        if (later) waiting.set(tracker, { ...fields, ...later })
      }
      onChange({ tracker, outcome, fields, error })
      next(tracker)
    }
    send(tracker, fields).then(
      ({ outcome, error }) => settle(outcome, error),
      error => settle('FAILED', error instanceof Error ? error.message : String(error)),
    )
    onChange()
  }

  const flush = () => {
    if (timer !== undefined) timers.clear(timer)
    timer = undefined
    for (const tracker of waiting.keys()) released.add(tracker)
    for (const tracker of [...released]) next(tracker)
  }

  return {
    stage: (patches: Record<string, Fields>, immediate: boolean) => {
      for (const [tracker, fields] of Object.entries(patches)) {
        const carried = failed.get(tracker)?.fields
        failed.delete(tracker)
        refused.delete(tracker)
        waiting.set(tracker, { ...carried, ...waiting.get(tracker), ...fields })
      }
      if (immediate) flush()
      else {
        if (timer !== undefined) timers.clear(timer)
        timer = timers.set(flush, delay)
        onChange()
      }
    },
    flush,
    /** Records fields that could not go at all, a paused or failing tracker, as a failed save. */
    fail: (tracker: string, fields: Fields, error: string) => {
      failed.set(tracker, { fields: { ...failed.get(tracker)?.fields, ...fields }, error })
      onChange({ tracker, outcome: 'FAILED', fields, error })
    },
    retry: (tracker: string) => {
      const kept = failed.get(tracker)
      if (!kept) return
      failed.delete(tracker)
      waiting.set(tracker, { ...kept.fields, ...waiting.get(tracker) })
      released.add(tracker)
      next(tracker)
      onChange()
    },
    /** Forgets everything waiting for a tracker the viewer stopped writing to. */
    drop: (tracker: string) => {
      waiting.delete(tracker)
      released.delete(tracker)
      failed.delete(tracker)
      refused.delete(tracker)
      onChange()
    },
    dismiss: (tracker: string) => {
      refused.delete(tracker)
      onChange()
    },
    state: (tracker: string): QueueState => ({
      busy: flying.has(tracker) || waiting.has(tracker),
      failed: failed.get(tracker),
      refused: refused.get(tracker),
    }),
    idle: () => !flying.size && !waiting.size,
  }
}

export type SaveQueue = ReturnType<typeof createSaveQueue>
