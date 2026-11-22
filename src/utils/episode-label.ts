import { intl } from '../i18n'
import { isMovieMedia } from '../router/home/movie'

/** How stub names an episode: `E5 - Title`, `Title` with no number, `Episode 5` with no title, and undefined with neither. */
export const episodeLabel = (episodeNumber: number | null | undefined, title: string | null | undefined) =>
  title
    ? episodeNumber != null ? intl.formatMessage({ id: 'E{number} - {title}', defaultMessage: 'E{number} - {title}' }, { number: episodeNumber, title }) : title
    : episodeNumber != null
      ? intl.formatMessage({ id: 'Episode {number}', defaultMessage: 'Episode {number}' }, { number: episodeNumber })
      : undefined

type Titled = { titles?: readonly { title: string }[] | null }
type Media = Parameters<typeof isMovieMedia>[0] & Titled & { episodes?: readonly unknown[] | null }

/** Whether `media` is a film of a single entry, which stub names by the film's title rather than as an episode. */
export const isSingleFilm = (media: Media | null | undefined) =>
  Boolean(media && isMovieMedia(media) && (media.episodes?.length ?? 0) <= 1)

/**
 * How stub names `episode` of `media`: a film of a single entry by its own title alone (its entry's when it has none),
 * anything else, a film's parts included, as `episodeLabel` does. The watch page's heading, the title drawn on the
 * player and the previous and next buttons all use it, so they always read the same.
 */
export const entryLabel = (
  media: Media | null | undefined,
  episode: Titled & { episodeNumber?: number | null } | null | undefined,
) => {
  const title = episode?.titles?.at(0)?.title
  return isSingleFilm(media) ? media?.titles?.at(0)?.title ?? title : episodeLabel(episode?.episodeNumber, title)
}

const MARKER = '\uE000'

/**
 * Splits `entryLabel` around the episode title so RTL views can isolate and ellipsize the title at
 * its own end without clipping the leading words of an LTR title behind an RTL episode prefix.
 */
export const entryLabelParts = (
  media: Media | null | undefined,
  episode: Titled & { episodeNumber?: number | null } | null | undefined,
): { prefix: string, title: string, suffix: string } | undefined => {
  const title = episode?.titles?.at(0)?.title
  if (isSingleFilm(media)) {
    const resolved = media?.titles?.at(0)?.title ?? title
    return resolved ? { prefix: '', title: resolved, suffix: '' } : undefined
  }
  if (!title) return undefined
  if (episode?.episodeNumber == null) return { prefix: '', title, suffix: '' }
  const formatted = intl.formatMessage({ id: 'E{number} - {title}', defaultMessage: 'E{number} - {title}' }, { number: episode.episodeNumber, title: MARKER })
  const at = formatted.indexOf(MARKER)
  if (at === -1) return undefined
  const before = formatted.slice(0, at)
  const after = formatted.slice(at + MARKER.length)
  return {
    prefix: before.endsWith('\u2068') ? before.slice(0, -1) : before,
    title,
    suffix: after.startsWith('\u2069') ? after.slice(1) : after,
  }
}
