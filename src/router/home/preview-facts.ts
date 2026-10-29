// The preview's words beside its description: a series' line over its title and either view's side column. Pure, so
// they are tested without rendering the modal.

import type { Fact, TitleMedia } from '../title/facts'

import { intl, NAME_LIST } from '../../i18n'
import { site } from '../../site'
import { releaseDateLabel } from '../../utils/release-date'
import { formatLabel } from '../search/params'
import { episodesLabel, releasedLabel } from '../title/facts'
import { filmRelease } from './episodes'
import { runtimeText } from './movie'

type FilmEpisode = NonNullable<Parameters<typeof filmRelease>[0]['episode']> & { runtime?: number | null }

/** What the preview's facts read of a media: the details the modal asks for, a film's one episode among them. */
export type PreviewMedia = Pick<TitleMedia, 'type' | 'status' | 'startDate' | 'season' | 'seasonYear' | 'episodeCount' | 'genres' | 'tags' | 'duration'> & {
  averageScore?: number | null
  episodes?: readonly FilmEpisode[] | null
}

// spellings and endings of one name across sources: "Sci-Fi" and "Science-Fiction", "Medical" and "Medicine"
const SYNONYMS: Readonly<Record<string, string>> = { sciencefiction: 'scifi' }
const keyOf = (name: string) => {
  const letters = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  return (SYNONYMS[letters] ?? letters).replace(/(ine|al|s)$/, '')
}
// every title the anime site lists is both
const leftOut = () => new Set(site === 'anime' ? ['Animation', 'Anime'].map(keyOf) : [])
const partsOf = (genre: string) => genre.split(/\s*(?:&|\/|\band\b)\s*/i).filter(Boolean).map(keyOf)

/**
 * Every genre, then the first five tags no genre names, less what merging the sources repeats: Animation on
 * the anime site, a combined genre one of whose parts is listed alone ("Action & Adventure" beside "Adventure"), and a
 * name met before in another spelling or ending.
 */
export const categories = (allGenres: readonly string[] = [], allTags: readonly string[] = []): { genres: string[], tags: string[] } => {
  const left = leftOut()
  const single = new Set(allGenres.map(partsOf).flatMap(keys => keys.length === 1 ? keys : []))
  const seen = new Set<string>()
  const genres = allGenres.filter(genre => {
    const keys = partsOf(genre)
    const key = keys.join('+')
    const dropped = seen.has(key) || (keys.length === 1 ? left.has(key) : keys.some(part => single.has(part)))
    seen.add(key)
    return !dropped
  })
  const named = new Set([...left, ...genres.flatMap(partsOf)])
  const tags = allTags.filter(tag => {
    const fresh = !named.has(keyOf(tag))
    named.add(keyOf(tag))
    return fresh
  }).slice(0, 5)
  return { genres, tags }
}

/** The line over a series' title: its format, its release and its episodes, each left out when no source named it. */
export const seriesLine = (media: PreviewMedia): string =>
  [formatLabel(media.type), releasedLabel(media, { locale: intl.locale }), episodesLabel(media.episodeCount)].filter(Boolean).join(' · ')

/**
 * The side column, each fact left out when no source gave it. A film's: its format, release (as of `now`, by the rule
 * the modal's Play goes by), length, categories and score; a series': its categories, when it aired and its score.
 */
export const previewFacts = (media: PreviewMedia, movie: boolean, now = new Date()): Fact[] => {
  const names = (list: string[]) => list.length ? intl.formatList(list, NAME_LIST) : undefined
  const { genres, tags } = categories(media.genres ?? [], media.tags ?? [])
  const shared = [
    { label: intl.formatMessage({ id: 'Genres', defaultMessage: 'Genres' }), value: names(genres) },
    { label: intl.formatMessage({ id: 'Tags', defaultMessage: 'Tags' }), value: names(tags) },
  ]
  const score = {
    label: intl.formatMessage({ id: 'Score', defaultMessage: 'Score' }),
    value: media.averageScore ? intl.formatNumber(media.averageScore, { style: 'unit', unit: 'percent', maximumFractionDigits: 0 }) : undefined,
  }
  const film = media.episodes?.at(0)
  const { released, upcoming } = filmRelease({ startDate: media.startDate, status: media.status, episode: film }, now)
  const facts = movie
    ? [
      { label: intl.formatMessage({ id: 'Format', defaultMessage: 'Format' }), value: intl.formatMessage({ id: 'Movie', defaultMessage: 'Movie' }) },
      {
        label: upcoming ? intl.formatMessage({ id: 'Releases#verb', defaultMessage: 'Releases', description: 'verb' }) : intl.formatMessage({ id: 'Released', defaultMessage: 'Released' }),
        value: releaseDateLabel(released, { locale: intl.locale }),
      },
      { label: intl.formatMessage({ id: 'Length', defaultMessage: 'Length' }), value: runtimeText(film?.runtime ?? media.duration) },
      ...shared,
      score,
    ]
    : [...shared, { label: intl.formatMessage({ id: 'Aired', defaultMessage: 'Aired' }), value: releasedLabel(media, { locale: intl.locale }) }, score]
  return facts.flatMap(({ label, value }) => value ? [{ label, value }] : [])
}
