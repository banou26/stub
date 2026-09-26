// The display-only summary of every tracker's answer about one media. Import free so it can be pinned
// under vitest. Nothing here is ever written anywhere: a write names its trackers.

import type { FuzzyDate, ListEntry, Tracking, TrackerAnswer, TrackingField } from '../generated/schema/types.generated'

export const trackingId = (uri: string) => `tracking:${uri}`

/**
 * The summary's `_id`. No tracker's entry uses this shape (theirs are `<tracker>:<id>`, and no tracker
 * is called `summary`), so a normalising cache never folds the summary into one tracker's entry.
 */
export const summaryId = (uri: string) => `summary:${uri}`

/**
 * How coarse a tracker's scores are on the 0 to 100 wire scale. Two scores are compared at the
 * coarsest step among the trackers holding them, so AniList's 85 and a ten point 90 are not a
 * disagreement merely because one tracker cannot say 85.
 */
const SCORE_STEP: Record<string, number> = { POINT_100: 1, POINT_10_DECIMAL: 1, POINT_10: 10, POINT_5: 20, POINT_3: 33 }

const time = (entry: ListEntry) => entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0
const byNewest = (a: ListEntry, b: ListEntry) => time(b) - time(a)

const pad = (value: number | null | undefined, length: number) => String(value ?? 0).padStart(length, '0')
const dateKey = (date: FuzzyDate | null | undefined) =>
  date?.year ? `${pad(date.year, 4)}-${pad(date.month, 2)}-${pad(date.day, 2)}` : undefined

type Listed = { entry: ListEntry, scale: string }

/**
 * The listed answers whose episode counts agree, which are the only ones a summary may combine.
 *
 * Two trackers can split one run differently (AniList's 24 episode entry against MyAnimeList's 12
 * episode part), and a progress of 18 means different things on each. The count of the most recently
 * updated answer that knows one is the reference; an answer with no count is comparable to anything.
 */
const comparable = (listed: Listed[]): { kept: Listed[], episodeCount: number | null } => {
  const reference = [...listed].sort((a, b) => byNewest(a.entry, b.entry)).find(({ entry }) => entry.episodeCount != null)?.entry.episodeCount ?? null
  return {
    kept: listed.filter(({ entry }) => reference == null || entry.episodeCount == null || entry.episodeCount === reference),
    episodeCount: reference,
  }
}

const summarize = (uri: string, listed: Listed[], episodeCount: number | null): ListEntry | null => {
  if (!listed.length) return null
  const entries = listed.map(({ entry }) => entry).sort(byNewest)
  const progresses = entries.filter(entry => entry.progress != null)
  const progress = progresses.length ? Math.max(...progresses.map(entry => entry.progress!)) : null
  // the status belongs with the progress it was set beside, newest first on a tie
  const status =
    (progress != null ? entries.find(entry => entry.progress === progress && entry.status)?.status : undefined)
    ?? entries.find(entry => entry.status)?.status
    ?? null
  const started = entries.map(entry => entry.startedAt).filter(date => dateKey(date)).sort((a, b) => dateKey(a)!.localeCompare(dateKey(b)!))
  const completed = entries.map(entry => entry.completedAt).filter(date => dateKey(date)).sort((a, b) => dateKey(b)!.localeCompare(dateKey(a)!))
  const rewatches = entries.filter(entry => entry.rewatchCount != null).map(entry => entry.rewatchCount!)
  const score = entries.find(entry => entry.score != null)?.score ?? null
  return {
    _id: summaryId(uri),
    tracker: 'summary',
    mediaUri: uri,
    status,
    progress,
    score,
    scoreLabel: score != null ? String(score) : null,
    startedAt: started[0] ?? null,
    completedAt: completed[0] ?? null,
    rewatchCount: rewatches.length ? Math.max(...rewatches) : null,
    updatedAt: entries[0]!.updatedAt ?? null,
    url: null,
    title: entries.find(entry => entry.title)?.title ?? null,
    cover: entries.find(entry => entry.cover)?.cover ?? null,
    episodeCount,
  }
}

/** The fields on which two comparable answers hold different values. An unset field agrees with anything. */
const disagreementsOf = (listed: Listed[]): TrackingField[] => {
  const differ = (values: (string | number | null | undefined)[]) => new Set(values.filter(value => value != null)).size > 1
  const step = Math.max(1, ...listed.filter(({ entry }) => entry.score != null).map(({ scale }) => SCORE_STEP[scale] ?? 1))
  const fields: [TrackingField, (entry: ListEntry) => string | number | null | undefined][] = [
    ['STATUS', entry => entry.status],
    ['PROGRESS', entry => entry.progress],
    ['SCORE', entry => entry.score == null ? null : Math.round(entry.score / step)],
    ['STARTED_AT', entry => dateKey(entry.startedAt)],
    ['COMPLETED_AT', entry => dateKey(entry.completedAt)],
    ['REWATCH_COUNT', entry => entry.rewatchCount],
  ]
  return fields.filter(([, read]) => differ(listed.map(({ entry }) => read(entry)))).map(([field]) => field)
}

/**
 * Every answer, unchanged and in the order given, with the summary and the disagreements beside them.
 * Only LISTED answers are summarised: an AMBIGUOUS, NO_ID or ERROR answer is shown as itself.
 */
export const aggregateTracking = (uri: string, answers: TrackerAnswer[]): Tracking => {
  const listed = answers
    .filter(answer => answer.state === 'LISTED' && answer.entry)
    .map(answer => ({ entry: answer.entry!, scale: answer.tracker.scoreScale }))
  const { kept, episodeCount } = comparable(listed)
  return {
    _id: trackingId(uri),
    answers,
    summary: summarize(uri, kept, episodeCount),
    disagreements: disagreementsOf(kept),
  }
}
