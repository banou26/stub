// The display-only summary of every tracker's answer about one media. Import free so it can be pinned
// under vitest. Nothing here is ever written anywhere: a write names its trackers.

import type { ListEntry, Tracking, TrackerAnswer, TrackingField } from '../generated/schema/types.generated'

import { coarser, nativeScore } from './score-scale'

export const trackingId = (uri: string) => `tracking:${uri}`

/**
 * The summary's `_id`. No tracker's entry uses this shape (theirs are `<tracker>:<id>`, and no tracker
 * is called `summary`), so a normalising cache never folds the summary into one tracker's entry.
 */
export const summaryId = (uri: string) => `summary:${uri}`

const time = (entry: ListEntry) => entry.updatedAt ? Date.parse(entry.updatedAt) || 0 : 0
const byNewest = (a: ListEntry, b: ListEntry) => time(b) - time(a)

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
  const score = entries.find(entry => entry.score != null)?.score ?? null
  return {
    _id: summaryId(uri),
    tracker: 'summary',
    mediaUri: uri,
    status,
    progress,
    score,
    updatedAt: entries[0]!.updatedAt ?? null,
    url: null,
    title: entries.find(entry => entry.title)?.title ?? null,
    cover: entries.find(entry => entry.cover)?.cover ?? null,
    episodeCount,
  }
}

/**
 * The fields on which two comparable answers hold different values. An unset field agrees with anything.
 * Scores are compared at the coarsest scale among the trackers holding them (tracking/score-scale.ts),
 * so AniList's 85 and a ten point 8 are not a disagreement merely because one tracker cannot say 85.
 */
const disagreementsOf = (listed: Listed[]): TrackingField[] => {
  const differ = (values: (string | number | null | undefined)[]) => new Set(values.filter(value => value != null)).size > 1
  const scale = listed.filter(({ entry }) => entry.score != null).map(({ scale }) => scale).reduce<string | null | undefined>(coarser, 'POINT_100')
  const fields: [TrackingField, (entry: ListEntry) => string | number | null | undefined][] = [
    ['STATUS', entry => entry.status],
    ['PROGRESS', entry => entry.progress],
    ['SCORE', entry => entry.score == null ? null : nativeScore(entry.score, scale)],
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
