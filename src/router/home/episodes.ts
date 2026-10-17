// Which of a series' episodes are not out yet. No app imports, for the reason ./movie.ts gives.

import { isUpcoming, releaseSide } from './movie'
import { isDateOnly, isPartialDate, parseReleaseDate, releaseDay } from '../../utils/release-date'

type DatedEpisode = { episodeNumber?: number | null, releaseDate?: string | null }
type SourcedEpisode = DatedEpisode & { handles?: readonly { node: { releaseDate?: string | null } }[] }

/**
 * The smallest episode number not out yet, or undefined when nothing says one is ahead.
 *
 * AniList's next episode decides alone when present, since `status` can come from a source that
 * flips it by hand a day late. Its N counts while its time is ahead and gives N + 1 once it has
 * passed, since that value is worked out when AniList answered and a page stays open across an airing.
 */
export const firstUnreleased = (
  { status, nextAiringEpisode, episodes }:
  {
    status?: string | null,
    nextAiringEpisode?: { episodeNumber: number, airingAt: string } | null,
    episodes: readonly DatedEpisode[],
  },
  now = new Date()
): number | undefined => {
  if (nextAiringEpisode) {
    return nextAiringEpisode.episodeNumber + (Date.parse(nextAiringEpisode.airingAt) > now.getTime() ? 0 : 1)
  }
  const numbers = [
    ...episodes.filter(episode => isUpcoming(episode.releaseDate, now)).map(episode => episode.episodeNumber),
    status === 'NOT_YET_RELEASED' ? 1 : undefined,
  ].filter((number): number is number => typeof number === 'number')
  return numbers.length ? Math.min(...numbers) : undefined
}

/**
 * An episode a source dates as out (its air time passed, or a day before today) is released, so a stale
 * schedule cannot dim it. One dated ahead is unreleased. The rest, dated today with no time (it may air
 * later today) or undated, are unreleased from `first` onward.
 */
const isUnreleased = (episode: DatedEpisode, first: number | undefined, now = new Date()): boolean => {
  const side = releaseSide(episode.releaseDate, now)
  return side === 1
    || (side !== -1 && first !== undefined && episode.episodeNumber != null && episode.episodeNumber >= first)
}

// The store already merges a date across the sources it folded into this row, so the handle is a
// fallback rather than the path: it covers an episode whose date only one source knows and which
// was not the row merged into. Four sources supply one at all (anizip, Crunchyroll, the bundled
// catalogue and Apple TV), so plenty of episodes have none and the column is simply empty there.
export const releasedAtOf = (episode: SourcedEpisode | undefined) =>
  episode?.releaseDate ?? episode?.handles?.find(handle => handle.node.releaseDate)?.node.releaseDate

const DAY_MS = 86_400_000

/**
 * Whether `airingAt`, an instant, falls within a day of what `sourced` names, or `sourced` names nothing.
 * A value at midnight UTC may name a day rather than an hour, so it spans that whole day. A day is the
 * margin because AniZip's air times were 10 minutes to 4 hours early or 5 minutes to 1.5 hours late
 * against AniList's for 5 of the 21 shows both timed that week (2026-10-17).
 */
export const withinADay = (sourced: string | null | undefined, airingAt: string) => {
  const start = parseReleaseDate(sourced)?.getTime()
  if (start === undefined) return true
  const at = Date.parse(airingAt)
  const end = start % DAY_MS ? start : start + DAY_MS
  return end > at - DAY_MS && start < at + DAY_MS
}

/**
 * AniList's time for the episode it schedules next, which decides when that episode is out unless a
 * source dates it a day or more either side of that: a schedule gone stale, or a delay it does not have
 * yet. Undefined for any other episode.
 */
export const scheduledAt = (
  episode: SourcedEpisode,
  next: { episodeNumber: number, airingAt: string } | null | undefined
): string | undefined =>
  next && episode.episodeNumber === next.episodeNumber && withinADay(releasedAtOf(episode), next.airingAt) ? next.airingAt : undefined

/** Which of a media's episodes are not out yet, in the order `episodes` lists them. */
export const unreleasedEpisodes = (
  media: Omit<Parameters<typeof firstUnreleased>[0], 'episodes'> & { episodes: readonly SourcedEpisode[] },
  now = new Date()
): boolean[] => {
  const next = media.nextAiringEpisode
  const dated = media.episodes.map(episode => ({ episodeNumber: episode.episodeNumber, releaseDate: scheduledAt(episode, next) ?? releasedAtOf(episode) }))
  const first = firstUnreleased({ status: media.status, nextAiringEpisode: next, episodes: dated }, now)
  return dated.map(episode => isUnreleased(episode, first, now))
}

/**
 * A film's release, the one rule the modal, the title page and the hero go by: `released` is its own day before
 * its episode's air time, which falls on another day in some zones, but its year or month alone after it. It is
 * out when that episode airs if that is within a day of its own day, and a year or month alone that has begun is
 * out unless the film is known not to be.
 */
export const filmRelease = (
  { startDate, status, episode }: { startDate?: string | null, status?: string | null, episode?: SourcedEpisode },
  now = new Date()
): { released: string | undefined, upcoming: boolean } => {
  const own = releaseDay(startDate)
  const airs = releasedAtOf(episode) ?? undefined
  const released = (isPartialDate(own) ? undefined : own) ?? airs ?? own
  const side = releaseSide(airs && !isDateOnly(airs) && withinADay(released, airs) ? airs : released, now)
  return { released, upcoming: side === 1 || (side === 0 && isPartialDate(released) && status === 'NOT_YET_RELEASED') }
}
