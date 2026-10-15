import type { CompactTracking, Fields, Row } from './compact'

import { countDiffers, rowOf, rowOfEntry, targetOf } from './compact'

/** The share of an episode played from which it counts as watched. */
export const WATCHED_AT = 0.85

/** How much of what was played: `played` from 0 to 1, of `episode`, or of a movie. */
export type Watched = { played: number, episode?: number | null, movie?: boolean }

/**
 * What one tracker is written once an episode is watched, from that tracker's own entry, or nothing.
 *
 * Progress only rises, a Completed entry is left as it is, and an episode past the tracker's count is
 * skipped: some sources number past it (Made in Abyss season 2 lists 14 and 15 on a 12 episode entry),
 * and clamping that to the last episode would mark the whole show watched. Otherwise progress goes to
 * the episode, with Watching for any status but Watching or Rewatching, and Completed at the last
 * episode. A movie is Completed with progress 1.
 */
export const watchedFields = ({ played, episode, movie }: Watched, entry: Pick<Row, 'status' | 'progress' | 'total'>): Fields | undefined => {
  if (played < WATCHED_AT || entry.status === 'COMPLETED') return undefined
  if (movie) return { status: 'COMPLETED', progress: 1 }
  if (episode == null || !Number.isInteger(episode) || episode <= entry.progress || (entry.total != null && episode > entry.total)) return undefined
  if (episode === entry.total) return { progress: episode, status: 'COMPLETED' }
  return { progress: episode, ...entry.status === 'WATCHING' || entry.status === 'REWATCHING' ? {} : { status: 'WATCHING' } }
}

/**
 * What an episode watched writes, by tracker id, to each tracker checked in `stored` (the row's
 * choices), on that tracker's own entry. Left out: a tracker that has not answered yet, one with no id
 * for the media (the row draws no chip for it), a read-only one, one that counts the media in other
 * episodes than the page, whose numbers mean something else, and every tracker while the row reads
 * Completed, since that is a rewatch. A checked tracker that cannot write now (paused, failing) is in
 * it too, for the page to say it was not saved; only a writable one is sent anything.
 */
export const watchedPatches = (
  watched: Watched,
  tracking: CompactTracking,
  stored: Record<string, boolean>,
  episodeCount?: number | null,
): Record<string, Fields> => {
  const row = rowOf(tracking, episodeCount)
  if (row.status === 'COMPLETED') return {}
  const patches: Record<string, Fields> = {}
  for (const answer of tracking.answers) {
    if (answer.state === 'NO_ID') continue
    const target = targetOf(answer, stored[answer.tracker.id])
    if (target.kind !== 'check' || !target.checked || countDiffers(answer, row.total)) continue
    const fields = watchedFields(watched, rowOfEntry(answer, row.total))
    if (fields) patches[answer.tracker.id] = fields
  }
  return patches
}
