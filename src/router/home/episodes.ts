// Which of a series' episodes are not out yet. No app imports, for the reason ./movie.ts gives.

import { isUpcoming, releaseSide } from './movie'
import { isDateOnly, isPartialDate, parseReleaseDate, releaseDay } from '../../utils/release-date'

type Dated = { origin?: string | null, releaseDate?: string | null }
type DatedEpisode = { episodeNumber?: number | null, releaseDate?: string | null }
type SourcedEpisode = DatedEpisode & { handles?: readonly { node: Dated }[] }

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
 * An episode below `first` is out whatever a source dates it, as `first` is AniList's while it names one and that
 * outranks every source. From `first` on, one a source dates as out (its air time passed, or a day before today) is
 * released, so a stale schedule cannot dim it, and the rest are unreleased. With no `first`, or no number, only one
 * dated ahead is unreleased.
 */
const isUnreleased = ({ episodeNumber, releaseDate }: DatedEpisode, first: number | undefined, now = new Date()): boolean => {
  const side = releaseSide(releaseDate, now)
  if (first === undefined || episodeNumber == null) return side === 1
  return episodeNumber >= first && side !== -1
}

/**
 * The sources an episode's date is taken from, best first, any other after them, and a time beats a day whatever its
 * source. AniList's schedule goes before them all for the episode it names next. Measured 2026-10-18 on that week's
 * airings, anime against Syoboi Calendar's first broadcast (152 episodes) and US series against TVmaze's own times
 * (172), so TVmaze's place for series is assumed: within an hour, AniList 94%, TVmaze 85% on anime, AniZip 85%, Trakt
 * 83% on anime and 76% on series, Simkl 80% on series; on the right day, IMDb 94% on series, Crunchyroll 92% on
 * anime, TMDB 88% and JustWatch 83% on both, and Apple TV too few to measure.
 */
const RANKED = ['tvmaze', 'anizip', 'trakt', 'simkl', 'omdb', 'cr', 'tmdb', 'jw', 'appletv']

const rankOf = ({ origin }: Dated) => {
  const at = RANKED.indexOf(origin ?? '')
  return at === -1 ? RANKED.length : at
}

/**
 * The sources whose stamps name a day, as its midnight UTC: all 75 Crunchyroll dated that week, and Apple TV's. Any
 * other midnight UTC is a time, as Trakt's 00:00 UTC for The Terminal List on Prime Video, or AniZip's for a 09:00
 * JST broadcast.
 */
const DAY_STAMPS = ['cr', 'appletv']

const isDay = ({ origin, releaseDate }: Dated) => Number(isDateOnly(releaseDate) || DAY_STAMPS.includes(origin ?? ''))

const bestDated = (episode: SourcedEpisode | undefined) =>
  episode?.handles?.map(handle => handle.node)
    .filter(dated => dated.releaseDate)
    .sort((a, b) => isDay(a) - isDay(b) || rankOf(a) - rankOf(b))
    .at(0)

/**
 * An episode's date by the best-ranked of its sources that gives one, or its own when none does. The store's merged
 * row takes its date from one of those sources, so ranking it among them would let its unlisted origin decide.
 */
export const releasedAtOf = (episode: SourcedEpisode | undefined): string | undefined =>
  bestDated(episode)?.releaseDate ?? episode?.releaseDate ?? undefined

/** The time an episode airs by the best-ranked of its sources, or undefined when that source names a day. */
export const timedAt = (episode: SourcedEpisode): string | undefined => {
  const dated = bestDated(episode)
  return dated && !isDay(dated) ? dated.releaseDate! : undefined
}

const DAY_MS = 86_400_000

/**
 * Whether `airingAt`, an instant, falls within a day of what `sourced` names, or `sourced` names nothing.
 * A value at midnight UTC may name a day rather than an hour, so it spans that whole day.
 */
const withinADay = (sourced: string | null | undefined, airingAt: string) => {
  const start = parseReleaseDate(sourced)?.getTime()
  if (start === undefined) return true
  const at = Date.parse(airingAt)
  const end = start % DAY_MS ? start : start + DAY_MS
  return end > at - DAY_MS && start < at + DAY_MS
}

/** AniList's time for the episode it schedules next, which outranks every source's date for it. Undefined for any other. */
export const scheduledAt = (
  episode: DatedEpisode,
  next: { episodeNumber: number, airingAt: string } | null | undefined
): string | undefined =>
  next && episode.episodeNumber === next.episodeNumber ? next.airingAt : undefined

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
  const airs = releasedAtOf(episode)
  const released = (isPartialDate(own) ? undefined : own) ?? airs ?? own
  const side = releaseSide(airs && !isDateOnly(airs) && withinADay(released, airs) ? airs : released, now)
  return { released, upcoming: side === 1 || (side === 0 && isPartialDate(released) && status === 'NOT_YET_RELEASED') }
}
