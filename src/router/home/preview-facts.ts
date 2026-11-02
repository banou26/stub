// The preview's words around its description: the line over its title and the side column. Pure, so they are tested
// without rendering the modal.

import type { TitleMedia } from '../title/facts'

import { intl } from '../../i18n'
import { site } from '../../site'
import { releaseDateLabel } from '../../utils/release-date'
import { formatLabel, genreLabel } from '../search/params'
import { episodesLabel, releasedLabel } from '../title/facts'
import { filmRelease } from './episodes'
import { runtimeText } from './movie'

type FilmEpisode = NonNullable<Parameters<typeof filmRelease>[0]['episode']> & { runtime?: number | null }

/** What the preview's facts read of a media: the details the modal asks for, a film's one episode among them. */
export type PreviewMedia = Pick<TitleMedia, 'type' | 'categories' | 'status' | 'startDate' | 'season' | 'seasonYear' | 'episodeCount' | 'genres' | 'tags' | 'duration'> & {
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
  [formatLabel(media.type), releasedLabel(media, { locale: intl.locale }), episodesLabel(media)].filter(Boolean).join(' · ')

/**
 * The line over a film's title: Movie, its release once it is out as of `now` (by the rule the modal's Play goes by;
 * until then the date under the title names it), and its length, each left out when no source named it.
 */
export const filmLine = (media: PreviewMedia, now = new Date()): string => {
  const film = media.episodes?.at(0)
  const { released, upcoming } = filmRelease({ startDate: media.startDate, status: media.status, episode: film }, now)
  return [
    intl.formatMessage({ id: 'Movie', defaultMessage: 'Movie' }),
    upcoming ? undefined : releaseDateLabel(released, { locale: intl.locale }),
    runtimeText(film?.runtime ?? media.duration),
  ].filter(Boolean).join(' · ')
}

/**
 * The side column's words: the categories drawn as pills, the genres in the language shown, and for a series when it
 * aired, left out when no source gave it.
 */
export const sideFacts = (media: PreviewMedia, film: boolean): { genres: string[], tags: string[], aired: string | undefined } => {
  const { genres, tags } = categories(media.genres ?? [], media.tags ?? [])
  return { genres: genres.map(genreLabel), tags, aired: film ? undefined : releasedLabel(media, { locale: intl.locale }) }
}
