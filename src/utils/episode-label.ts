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

/**
 * How stub names `episode` of `media`: a film by its own title alone (its entry's when it has none), an episode as
 * `episodeLabel` does. The watch page's heading, the title drawn on the player and the previous and next buttons all
 * use it, so they always read the same.
 */
export const entryLabel = (
  media: Parameters<typeof isMovieMedia>[0] & Titled | null | undefined,
  episode: Titled & { episodeNumber?: number | null } | null | undefined,
) => {
  const title = episode?.titles?.at(0)?.title
  return media && isMovieMedia(media) ? media.titles?.at(0)?.title ?? title : episodeLabel(episode?.episodeNumber, title)
}
