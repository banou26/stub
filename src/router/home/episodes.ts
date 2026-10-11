// Which of a series' episodes are not out yet. No app imports, for the reason ./movie.ts gives.

import { isUpcoming } from './movie'
import { parseReleaseDate } from '../../utils/release-date'

type DatedEpisode = { episodeNumber?: number | null, releaseDate?: string | null }

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
 * An episode a source dated before today is released, so a stale schedule cannot dim it. One dated
 * ahead is unreleased. The rest, dated today (it may air later today) or undated, are unreleased from
 * `first` onward.
 */
export const isUnreleased = (episode: DatedEpisode, first: number | undefined, now = new Date()): boolean => {
  const date = parseReleaseDate(episode.releaseDate)
  if (date && isUpcoming(now.toISOString(), date)) return false
  return isUpcoming(episode.releaseDate, now)
    || (first !== undefined && episode.episodeNumber != null && episode.episodeNumber >= first)
}
