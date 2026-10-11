// The title page's words: its chips, its facts and what its Play button says. Pure, so they are tested
// without rendering the page (which cannot load under vitest, see tests/unit/router/modal-media.test.ts).

import type { MediaSeason } from '../../generated/graphql'
import type { ReleaseDateOptions } from '../../utils/release-date'

import { MediaStatus, MediaType } from '../../generated/graphql'
import { formatLabel, seasonLabel, statusLabel } from '../search/params'
import { parseReleaseDate, releaseDateLabel } from '../../utils/release-date'

export type TitleMedia = {
  titles?: readonly { title: string }[] | null
  type?: MediaType | null
  status?: MediaStatus | null
  episodeCount?: number | null
  startDate?: string | null
  endDate?: string | null
  season?: MediaSeason | null
  seasonYear?: number | null
  genres?: readonly string[] | null
  tags?: readonly string[] | null
  duration?: number | null
  studios?: readonly string[] | null
  sourceMaterial?: string | null
  ratings?: readonly { source: string, value: number, scale: number }[] | null
}

export type Fact = { label: string, value: string }

// A media's start and end are days, which AniList and Jikan write as UTC midnight with a time attached
const day = (value: string | null | undefined) => parseReleaseDate(value)?.toISOString().slice(0, 10)

const episodesLabel = (count: number | null | undefined) =>
  count ? `${count} ${count === 1 ? 'Episode' : 'Episodes'}` : undefined

// AniList's word, LIGHT_NOVEL, as a label: Light novel
const sourceLabel = (source: string | null | undefined) =>
  source ? source.charAt(0) + source.slice(1).toLowerCase().replaceAll('_', ' ') : undefined

const ratingLabel = ({ source, value, scale }: NonNullable<TitleMedia['ratings']>[number]) =>
  `${source} ${scale === 100 ? `${Math.round(value)}%` : value.toFixed(1)}`

/** The second title under the main one: the first that reads differently, usually the romaji or the native. */
export const secondTitle = (titles: TitleMedia['titles']): string | undefined =>
  titles?.find(({ title }) => title !== titles[0]?.title)?.title

/** The chips under the title: episodes, format and status, each left out when no source named it. */
export const titleChips = (media: TitleMedia): string[] =>
  [episodesLabel(media.episodeCount), formatLabel(media.type), statusLabel(media.status)]
    .filter((chip): chip is string => !!chip)

/** The labelled facts, in reading order. A fact no source gave is left out rather than shown empty. */
export const titleFacts = (media: TitleMedia, options: ReleaseDateOptions = {}): Fact[] => {
  const start = releaseDateLabel(day(media.startDate), options)
  // while it airs, a source's end is the last scheduled airing
  const airing = media.status === MediaStatus.Releasing || media.status === MediaStatus.NotYetReleased
  const end = airing ? undefined : releaseDateLabel(day(media.endDate), options)
  const named = [media.titles?.[0]?.title, secondTitle(media.titles)]
  const others = [...new Set(media.titles?.map(({ title }) => title))].filter(title => !named.includes(title))
  return [
    { label: 'Format', value: formatLabel(media.type) },
    { label: 'Episodes', value: media.episodeCount ? String(media.episodeCount) : undefined },
    { label: media.type === MediaType.Movie ? 'Length' : 'Episode length', value: media.duration ? `${media.duration} min` : undefined },
    { label: 'Status', value: statusLabel(media.status) },
    { label: 'Aired', value: start && end && end !== start ? `${start} to ${end}` : start },
    { label: 'Season', value: seasonLabel(media.season, media.seasonYear) },
    { label: 'Studios', value: media.studios?.join(', ') },
    { label: 'Source', value: sourceLabel(media.sourceMaterial) },
    { label: 'Ratings', value: media.ratings?.map(ratingLabel).join(' · ') },
    { label: 'Genres', value: media.genres?.join(', ') },
    { label: 'Tags', value: media.tags?.join(', ') },
    { label: 'Also known as', value: others.join(', ') },
  ].filter((fact): fact is Fact => !!fact.value)
}

export type PlayLabel = 'Play' | 'Continue' | 'Rewatch'

type Tracked = { status?: string | null, progress?: number | null } | null | undefined
type Playable = { episodeNumber?: number | null, uri?: string | null, unreleased: boolean }

/** What the Play button says: Rewatch once completed, Continue once an episode is watched, Play otherwise. */
export const playLabel = (summary: Tracked): PlayLabel =>
  summary?.status === 'COMPLETED' ? 'Rewatch'
  : (summary?.progress ?? 0) > 0 ? 'Continue'
  : 'Play'

/**
 * The Play button: its label, and the episode it opens, the one after the progress to continue and
 * the first otherwise. Nothing when that episode is not out or has no page to watch it on.
 */
export const playTarget = (episodes: readonly Playable[], summary: Tracked): { label: PlayLabel, episodeUri: string } | undefined => {
  const label = playLabel(summary)
  const episode = label === 'Continue'
    ? episodes.find(({ episodeNumber }) => episodeNumber === (summary?.progress ?? 0) + 1)
    : episodes[0]
  return episode?.uri && !episode.unreleased ? { label, episodeUri: episode.uri } : undefined
}
