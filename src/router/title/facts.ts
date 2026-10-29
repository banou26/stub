// The title page's words: its chips, its facts and what its Play button says. Pure, so they are tested
// without rendering the page (which cannot load under vitest, see tests/unit/router/modal-media.test.ts).

import type { MessageDescriptor } from 'react-intl'

import type { MediaSeason } from '../../generated/graphql'
import type { ReleaseDateOptions } from '../../utils/release-date'

import { defineMessages } from 'react-intl'

import { MediaStatus, MediaType } from '../../generated/graphql'
import { intl, NAME_LIST } from '../../i18n'
import { formatLabel, genreLabel, seasonLabel, statusLabel } from '../search/params'
import { releaseDateLabel, releaseDay } from '../../utils/release-date'

export type TitleMedia = {
  titles?: readonly { title: string, language?: string | null }[] | null
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

/** A labelled fact; one with no value is held, its line kept for a source still to give it. */
export type Fact = { label: string, value?: string }

// AniList's MediaSource values
const SOURCES: Readonly<Record<string, MessageDescriptor>> = defineMessages({
  ORIGINAL: { id: 'Original#source material', defaultMessage: 'Original', description: 'source material' },
  MANGA: { id: 'Manga#source material', defaultMessage: 'Manga', description: 'source material' },
  LIGHT_NOVEL: { id: 'Light novel#source material', defaultMessage: 'Light novel', description: 'source material' },
  VISUAL_NOVEL: { id: 'Visual novel#source material', defaultMessage: 'Visual novel', description: 'source material' },
  VIDEO_GAME: { id: 'Video game#source material', defaultMessage: 'Video game', description: 'source material' },
  OTHER: { id: 'Other#source material', defaultMessage: 'Other', description: 'source material' },
  NOVEL: { id: 'Novel#source material', defaultMessage: 'Novel', description: 'source material' },
  DOUJINSHI: { id: 'Doujinshi#source material', defaultMessage: 'Doujinshi', description: 'source material' },
  ANIME: { id: 'Anime#source material', defaultMessage: 'Anime', description: 'source material' },
  WEB_NOVEL: { id: 'Web novel#source material', defaultMessage: 'Web novel', description: 'source material' },
  LIVE_ACTION: { id: 'Live action#source material', defaultMessage: 'Live action', description: 'source material' },
  GAME: { id: 'Game#source material', defaultMessage: 'Game', description: 'source material' },
  COMIC: { id: 'Comic#source material', defaultMessage: 'Comic', description: 'source material' },
  MULTIMEDIA_PROJECT: { id: 'Multimedia project#source material', defaultMessage: 'Multimedia project', description: 'source material' },
  PICTURE_BOOK: { id: 'Picture book#source material', defaultMessage: 'Picture book', description: 'source material' },
})

/** A count of episodes as the chips write it ("28 Episodes"), or nothing for none. */
export const episodesLabel = (count: number | null | undefined) =>
  count ? intl.formatMessage({ id: '{count, plural, one {{count} Episode} other {{count} Episodes}}', defaultMessage: '{count, plural, one {{count} Episode} other {{count} Episodes}}' }, { count }) : undefined

// a value AniList may add later reads as its own words: AUDIO_DRAMA as Audio drama
const sourceLabel = (source: string | null | undefined) =>
  !source ? undefined
  : SOURCES[source] ? intl.formatMessage(SOURCES[source])
  : source.charAt(0) + source.slice(1).toLowerCase().replaceAll('_', ' ')

const names = (list: readonly string[] | null | undefined) => list ? intl.formatList(list, NAME_LIST) : undefined

const ratingLabel = ({ source, value, scale }: NonNullable<TitleMedia['ratings']>[number]) =>
  `${source} ${intl.formatNumber(value, scale === 100 ? { style: 'unit', unit: 'percent', maximumFractionDigits: 0 } : { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`

/**
 * The second title under the main one, with its language: the first that reads differently in another language,
 * usually the romaji or the native, else the first that reads differently.
 */
export const secondTitle = (titles: TitleMedia['titles']): NonNullable<TitleMedia['titles']>[number] | undefined => {
  const others = titles?.filter(({ title }) => title !== titles[0]?.title) ?? []
  return others.find(({ language }) => language !== titles?.[0]?.language) ?? others[0]
}

/**
 * The release date the preview draws under a show's title: its start as precisely as a source names it, its season
 * when a source names only the year, and nothing when no source dates it.
 */
export const releasedLabel = (media: Pick<TitleMedia, 'startDate' | 'season' | 'seasonYear'>, options: ReleaseDateOptions = {}): string | undefined => {
  const start = releaseDay(media.startDate)
  return (start?.length === 4 ? undefined : releaseDateLabel(start, options))
    ?? seasonLabel(media.season, media.seasonYear)
    ?? releaseDateLabel(start, options)
}

/** The chips under the title: episodes, format and status, each left out when no source named it. */
export const titleChips = (media: TitleMedia): string[] =>
  [episodesLabel(media.episodeCount), formatLabel(media.type), statusLabel(media.status)]
    .filter((chip): chip is string => !!chip)

/** The chips after the score: each site's rating, IMDb 8.0 or Rotten Tomatoes 92%. */
export const ratingChips = (media: TitleMedia): string[] => media.ratings?.map(ratingLabel) ?? []

/**
 * The labelled facts, in reading order. A fact no source gave is left out rather than shown empty, unless `held`
 * (an anime's sources still answering), where it stays with no value, its line kept. An `upcoming` start reads
 * Releases rather than Aired.
 */
export const titleFacts = (media: TitleMedia, options: ReleaseDateOptions = {}, held = false, upcoming = false): Fact[] => {
  const start = releaseDateLabel(releaseDay(media.startDate), options)
  // while it airs, a source's end is the last scheduled airing
  const airing = media.status === MediaStatus.Releasing || media.status === MediaStatus.NotYetReleased
  const end = airing ? undefined : releaseDateLabel(releaseDay(media.endDate), options)
  const named = [media.titles?.[0]?.title, secondTitle(media.titles)?.title]
  const others = [...new Set(media.titles?.map(({ title }) => title))].filter(title => !named.includes(title))
  return [
    { label: intl.formatMessage({ id: 'Format', defaultMessage: 'Format' }), value: formatLabel(media.type) },
    { label: intl.formatMessage({ id: 'Episodes', defaultMessage: 'Episodes' }), value: media.episodeCount ? String(media.episodeCount) : undefined },
    {
      label: media.type === MediaType.Movie ? intl.formatMessage({ id: 'Length', defaultMessage: 'Length' }) : intl.formatMessage({ id: 'Episode length', defaultMessage: 'Episode length' }),
      value: media.duration ? intl.formatNumber(media.duration, { style: 'unit', unit: 'minute', unitDisplay: 'short', useGrouping: false }) : undefined,
    },
    { label: intl.formatMessage({ id: 'Status', defaultMessage: 'Status' }), value: statusLabel(media.status) },
    {
      label: upcoming ? intl.formatMessage({ id: 'Releases#verb', defaultMessage: 'Releases', description: 'verb' }) : intl.formatMessage({ id: 'Aired', defaultMessage: 'Aired' }),
      value: start && end && end !== start ? intl.formatMessage({ id: '{start} to {end}', defaultMessage: '{start} to {end}' }, { start, end }) : start,
    },
    { label: intl.formatMessage({ id: 'Season#broadcast season', defaultMessage: 'Season', description: 'broadcast season' }), value: seasonLabel(media.season, media.seasonYear) },
    { label: intl.formatMessage({ id: 'Studios', defaultMessage: 'Studios' }), value: names(media.studios) },
    { label: intl.formatMessage({ id: 'Source#adapted from', defaultMessage: 'Source', description: 'adapted from' }), value: sourceLabel(media.sourceMaterial) },
    { label: intl.formatMessage({ id: 'Genres', defaultMessage: 'Genres' }), value: names(media.genres?.map(genreLabel)) },
    { label: intl.formatMessage({ id: 'Tags', defaultMessage: 'Tags' }), value: names(media.tags) },
    { label: intl.formatMessage({ id: 'Also known as', defaultMessage: 'Also known as' }), value: names(others) },
  ].flatMap(({ label, value }): Fact[] => value ? [{ label, value }] : held ? [{ label }] : [])
}

export type PlayLabel = 'Play' | 'Continue' | 'Rewatch'

export type Tracked = { status?: string | null, progress?: number | null, episodeCount?: number | null } | null | undefined
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

/**
 * Where the episode list opens, as an index into `episodes`: the episode after the viewer's progress while they
 * are on a show, or the last one listed before it, and the first otherwise.
 */
export const currentEpisode = (episodes: readonly { episodeNumber?: number | null }[], summary: Tracked): number =>
  playLabel(summary) !== 'Continue' ? 0
  : Math.max(0, episodes.findLastIndex(({ episodeNumber }) => episodeNumber != null && episodeNumber <= (summary?.progress ?? 0) + 1))

/**
 * Whether the viewer watched episode `episodeNumber`: the show is Completed, or the episode is at or under
 * the progress, as Continue reads it. Never when the tracking counts the media in other episodes than
 * the page's `episodeCount`, where its progress means something else.
 */
export const watchedEpisode = (episodeNumber: number | null | undefined, summary: Tracked, episodeCount?: number | null): boolean =>
  !!summary
  && !(summary.episodeCount != null && episodeCount != null && summary.episodeCount !== episodeCount)
  && (summary.status === 'COMPLETED' || (episodeNumber != null && episodeNumber > 0 && episodeNumber <= (summary.progress ?? 0)))
