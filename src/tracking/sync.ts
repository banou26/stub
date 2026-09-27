// Per-media sync: one tracker's own answer copied onto the trackers the viewer names, and onto no
// other. Everything a sync would change is computed here, as data, before anything is written: the
// panel shows it, and applies it one target per `saveListEntry`. Pure, over the answers alone, so
// every rule is pinned under vitest.

import type { ListEntryInput, ListStatus, TrackingField } from '../generated/schema/types.generated'

import { dateKey } from './aggregate'
import { isScored, nativeScore, onScale, sameScore, scoreLabel } from './score-scale'

type SyncDate = { year?: number | null, month?: number | null, day?: number | null }

/** The part of a tracker's entry a sync reads. The panel's entries are one. */
export type SyncEntry = {
  status?: string | null
  progress?: number | null
  /** 0 to 100, whatever scale the tracker keeps. */
  score?: number | null
  /** The score in the tracker's own scale, as the tracker put it. */
  scoreLabel?: string | null
  startedAt?: SyncDate | null
  completedAt?: SyncDate | null
  rewatchCount?: number | null
  /** How many episodes THIS tracker counts for its entry. */
  episodeCount?: number | null
}

/** The part of a tracker's answer a sync reads. The panel's answers are one. */
export type SyncAnswer = {
  state: string
  /** Writes the tracker accepted and has not sent yet. */
  pending?: number | null
  /** How many episodes the tracker counts for the media, listed or not. */
  episodeCount?: number | null
  tracker: {
    id: string
    name: string
    canWrite: boolean
    scoreScale?: string | null
    /** A write stores the page's episode count as this tracker's own. */
    keepsPageEpisodeCount?: boolean | null
  }
  entry?: SyncEntry | null
}

/** What the page a sync runs from sends beside every entry it writes. */
export type SyncPage = { episodeCount?: number | null }

/** One field as it stands on a target now, and as it will once the sync is applied. */
export type FieldChange = {
  field: TrackingField
  /** In the target's own terms; null when the target holds nothing for it. */
  from: string | null
  to: string
  /** Less progress, fewer rewatches, or out of COMPLETED: a change the viewer should see coming. */
  backwards: boolean
}

/** A field that differs and is not copied, and why. */
export type HeldField = { field: TrackingField, reason: string }

export type TargetPlan = {
  tracker: string
  /** Why this target takes nothing, when it takes nothing. */
  refusal?: string
  changes: FieldChange[]
  held: HeldField[]
  /** The write: the changed fields and no other, or null when there is nothing to write. */
  entry: ListEntryInput | null
}

export type SyncPlan = {
  source: string
  /** Why nothing can be copied from the source, when nothing can. */
  refusal?: string
  targets: TargetPlan[]
}

export const SYNC_FIELDS: readonly TrackingField[] = ['STATUS', 'PROGRESS', 'SCORE', 'STARTED_AT', 'COMPLETED_AT', 'REWATCH_COUNT']

export const FIELD_LABELS: Record<TrackingField, string> = {
  STATUS: 'Status',
  PROGRESS: 'Progress',
  SCORE: 'Score',
  STARTED_AT: 'Started',
  COMPLETED_AT: 'Completed',
  REWATCH_COUNT: 'Rewatches',
}

export const STATUS_LABELS: Record<string, string> = {
  WATCHING: 'Watching',
  REWATCHING: 'Rewatching',
  PLANNING: 'Plan to watch',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
}

const statusText = (status: string | null | undefined) => status ? STATUS_LABELS[status] ?? status : null

const progressText = (progress: number | null | undefined, count: number | null | undefined) =>
  progress == null ? null : count ? `${progress} / ${count}` : String(progress)

/**
 * A 0 to 100 score in the scale the viewer keeps on a tracker: the tracker's own words where it gave
 * them, a percentage on a 100 point scale, as the panel's rows read.
 */
export const scoreText = (score: number | null | undefined, scale: string | null | undefined, label?: string | null) =>
  !isScored(score) ? null
  : scale && scale !== 'POINT_100' ? label ?? scoreLabel(nativeScore(score, scale), scale)
  : `${score}%`

const pad = (value: number) => String(value).padStart(2, '0')
const dateText = (date: SyncDate | null | undefined) =>
  !date?.year ? null
  : date.month == null ? String(date.year)
  : date.day == null ? `${date.year}-${pad(date.month)}`
  : `${date.year}-${pad(date.month)}-${pad(date.day)}`

/** One field of one entry, in the terms of the tracker holding it. */
export const fieldText = (field: TrackingField, entry: SyncEntry | null | undefined, scale: string | null | undefined): string | null => {
  if (!entry) return null
  switch (field) {
    case 'STATUS': return statusText(entry.status)
    case 'PROGRESS': return progressText(entry.progress, entry.episodeCount)
    case 'SCORE': return scoreText(entry.score, scale, entry.scoreLabel)
    case 'STARTED_AT': return dateText(entry.startedAt)
    case 'COMPLETED_AT': return dateText(entry.completedAt)
    case 'REWATCH_COUNT': return entry.rewatchCount ? String(entry.rewatchCount) : null
  }
}

// the entry's own count, else the one the tracker gave for the media while listing nothing
const countOf = (answer: SyncAnswer) => answer.entry?.episodeCount ?? answer.episodeCount ?? null
// what a target counts once written to; a page with no count leaves the entry's as it is
const countAfterWrite = (answer: SyncAnswer, page: SyncPage) =>
  answer.tracker.keepsPageEpisodeCount ? page.episodeCount ?? countOf(answer) : countOf(answer)

// a date as an input: only its three parts, so a cache's __typename never reaches the schema
const dateInput = (date: SyncDate) => ({ year: date.year ?? null, month: date.month ?? null, day: date.day ?? null })

type Compared = { change: FieldChange, input: ListEntryInput } | { held: HeldField } | undefined

/**
 * What copying one field of `source` onto `target` does. Undefined when nothing: the two agree, or
 * the source holds nothing for the field, since a sync never clears what a target holds.
 */
const compareField = (field: TrackingField, source: SyncAnswer, target: SyncAnswer, page: SyncPage): Compared => {
  const from = source.entry
  const to = target.entry ?? null
  if (!from) return undefined
  const scale = target.tracker.scoreScale
  const change = (value: string, backwards: boolean, input: ListEntryInput): Compared =>
    ({ change: { field, from: fieldText(field, to, scale), to: value, backwards }, input })

  switch (field) {
    case 'STATUS': {
      if (!from.status || from.status === to?.status) return undefined
      const backwards = to?.status === 'COMPLETED' && from.status !== 'COMPLETED' && from.status !== 'REWATCHING'
      return change(statusText(from.status)!, backwards, { status: from.status as ListStatus })
    }
    case 'PROGRESS': {
      if (from.progress == null || from.progress === to?.progress) return undefined
      // two trackers can split one run differently, and 18 of AniList's 24 is not 18 of a 12 episode part
      const counts = [countOf(source), countAfterWrite(target, page)]
      if (counts[0] != null && counts[1] != null && counts[0] !== counts[1]) {
        return { held: { field, reason: `${source.tracker.name} counts ${counts[0]} episodes and ${target.tracker.name} counts ${counts[1]}, so progress is not copied` } }
      }
      const backwards = to?.progress != null && from.progress < to.progress
      return change(progressText(from.progress, counts[1])!, backwards, { progress: from.progress })
    }
    case 'SCORE': {
      const held = to?.score
      if (!isScored(from.score)) return undefined
      if (isScored(held) && sameScore(from.score, held, [source.tracker.scoreScale, scale])) return undefined
      // through 0 to 100 onto the target's scale, at the value the target keeps, so what is shown is
      // what it holds afterwards
      const score = onScale(from.score, scale)
      if (score === to?.score) return undefined
      return change(scoreText(score, scale)!, false, { score })
    }
    case 'STARTED_AT':
    case 'COMPLETED_AT': {
      const key = field === 'STARTED_AT' ? 'startedAt' : 'completedAt'
      const date = from[key]
      if (!date || !dateKey(date) || dateKey(date) === dateKey(to?.[key])) return undefined
      return change(dateText(date)!, false, key === 'startedAt' ? { startedAt: dateInput(date) } : { completedAt: dateInput(date) })
    }
    case 'REWATCH_COUNT': {
      if (!from.rewatchCount || from.rewatchCount === (to?.rewatchCount ?? 0)) return undefined
      return change(String(from.rewatchCount), from.rewatchCount < (to?.rewatchCount ?? 0), { rewatchCount: from.rewatchCount })
    }
  }
}

const STATE_REFUSALS: Record<string, (name: string) => string> = {
  NOT_LISTED: name => `${name} lists nothing for this media`,
  NO_ID: name => `${name} has no id for this media`,
  AMBIGUOUS: name => `${name} names two entries for this media and cannot tell which one is meant`,
  SIGNED_OUT: name => `Sign in to ${name} first`,
  PAUSED: name => `${name} asked stub to wait`,
  ERROR: name => `${name} could not answer`,
}

const stateRefusal = (answer: SyncAnswer) => (STATE_REFUSALS[answer.state] ?? (name => `${name} could not answer`))(answer.tracker.name)

/**
 * Why a tracker's answer cannot be copied from, or undefined when it can: only a listed entry is, and
 * never one with writes still waiting to go out, since the answer is then not what the tracker will
 * hold. A tracker that lists nothing has nothing to copy: deletes are never synced.
 */
export const sourceRefusal = (answer: SyncAnswer): string | undefined => {
  if (answer.state !== 'LISTED' || !answer.entry) return stateRefusal(answer)
  const pending = answer.pending ?? 0
  if (pending > 0) return `${answer.tracker.name} has ${pending} change${pending === 1 ? '' : 's'} still waiting to be sent`
  return undefined
}

/**
 * Why a tracker cannot be synced onto, or undefined when it can: it has to have answered for this
 * media, listed or not, and take writes. An AMBIGUOUS or SIGNED_OUT tracker is never one.
 */
export const targetRefusal = (answer: SyncAnswer): string | undefined =>
  answer.state !== 'LISTED' && answer.state !== 'NOT_LISTED' ? stateRefusal(answer)
  : !answer.tracker.canWrite ? `${answer.tracker.name} takes no writes`
  : undefined

/**
 * What copying `source` onto `target` would change there, field by field, and the write that does it.
 * `page` is what the write sends beside the entry, which a tracker that keeps the page's count takes.
 */
export const planTarget = (source: SyncAnswer, target: SyncAnswer, page: SyncPage = {}): TargetPlan => {
  const refusal = targetRefusal(target)
  if (refusal) return { tracker: target.tracker.id, refusal, changes: [], held: [], entry: null }
  const changes: FieldChange[] = []
  const held: HeldField[] = []
  let entry: ListEntryInput = {}
  for (const field of SYNC_FIELDS) {
    const compared = compareField(field, source, target, page)
    if (!compared) continue
    if ('held' in compared) held.push(compared.held)
    else {
      changes.push(compared.change)
      entry = { ...entry, ...compared.input }
    }
  }
  return { tracker: target.tracker.id, changes, held, entry: changes.length ? entry : null }
}

/**
 * The sync the viewer asked for: `source` copied onto each of `targets` and onto no other tracker,
 * with `page` sent beside each write. The source itself is never a target.
 */
export const planSync = (answers: readonly SyncAnswer[], source: string, targets: readonly string[], page: SyncPage = {}): SyncPlan => {
  const from = answers.find(answer => answer.tracker.id === source)
  if (!from) return { source, refusal: `There is no tracker called ${source}`, targets: [] }
  const refusal = sourceRefusal(from)
  if (refusal) return { source, refusal, targets: [] }
  return {
    source,
    targets: [...new Set(targets)].filter(id => id !== source).map(id => {
      const target = answers.find(answer => answer.tracker.id === id)
      return target ? planTarget(from, target, page) : { tracker: id, refusal: `There is no tracker called ${id}`, changes: [], held: [], entry: null }
    }),
  }
}

/** One field across the trackers that answered, each in its own terms. */
export type ComparedField = { field: TrackingField, cells: { tracker: string, text: string | null }[] }

/**
 * The fields on which a sync from one tracker would change another, with every answering tracker's
 * value beside them. The trackers are those that answered for the media, listed or not; empty when
 * fewer than two did or nothing differs.
 */
export const differences = (answers: readonly SyncAnswer[]): ComparedField[] => {
  const answered = answers.filter(answer => answer.state === 'LISTED' || answer.state === 'NOT_LISTED')
  if (answered.length < 2) return []
  const sources = answered.filter(answer => answer.state === 'LISTED' && answer.entry)
  // no page: its count only decides whether progress is held or copied, and it differs either way
  return SYNC_FIELDS
    .filter(field => sources.some(source => answered.some(target => target !== source && compareField(field, source, target, {}))))
    .map(field => ({
      field,
      cells: answered.map(answer => ({ tracker: answer.tracker.id, text: fieldText(field, answer.entry, answer.tracker.scoreScale) })),
    }))
}

/** How one target's write went, as `saveListEntry` reports it. */
export type SyncOutcome = { tracker: string, outcome: string, error: string | null }

/** A write to exactly one tracker, which is what `saveListEntry` with a single target is. */
export type SyncWrite = (tracker: string, entry: ListEntryInput) => Promise<readonly { tracker: string, outcome: string, error?: string | null }[]>

/**
 * Every target of a plan written at once, each on its own and to itself alone, so one that fails
 * reports its own error while the others still apply. A target the plan refuses, or that has nothing
 * to change, is not written; a plan whose source is refused writes nothing.
 */
export const applySync = async (plan: SyncPlan, write: SyncWrite): Promise<SyncOutcome[]> => {
  if (plan.refusal) return []
  return await Promise.all(plan.targets.flatMap(({ tracker, refusal, entry }) => refusal || !entry ? [] : [(async (): Promise<SyncOutcome> => {
    try {
      const outcomes = await write(tracker, entry)
      // a write that failed before reaching any tracker reports under no tracker's name
      const own = outcomes.find(outcome => outcome.tracker === tracker) ?? outcomes.find(outcome => !outcome.tracker)
      return own
        ? { tracker, outcome: own.outcome, error: own.error ?? null }
        : { tracker, outcome: 'FAILED', error: 'The write came back with no answer for this tracker' }
    } catch (error) {
      return { tracker, outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) }
    }
  })()]))
}
