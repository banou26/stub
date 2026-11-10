import type { Media } from '../generated/graphql'

import { intl } from '../i18n'
import { isMovieMedia } from '../router/home/movie'

/**
 * A media as the search page's card and list modes read it.
 *
 * One type for both, so the page's query only has to satisfy a single shape and a field added for one
 * mode cannot go missing in the other.
 */
export type ListedMedia = Pick<Media,
  '_id' | 'uri' | 'titles' | 'covers' | 'genres' | 'shortDescriptions'
  | 'averageScore' | 'popularity' | 'followers' | 'episodeCount' | 'type' | 'categories' | 'status' | 'season' | 'seasonYear' | 'startDate'
  | 'nextAiringEpisode'
>

/** The countdown a media's schedule still has ahead of `now`, in milliseconds, or nothing. */
export const airsIn = (media: Pick<ListedMedia, 'nextAiringEpisode'>, now: number): number | undefined => {
  const airingAt = media.nextAiringEpisode?.airingAt
  if (!airingAt) return undefined
  const at = new Date(airingAt).getTime()
  return Number.isFinite(at) ? at - now : undefined
}

/** A media's episode count as words, or nothing for none and for a film, which is one work and not one episode. */
export const episodesLabel = (media: Partial<Pick<ListedMedia, 'episodeCount' | 'type' | 'categories'>>): string | undefined =>
  media.episodeCount == null || isMovieMedia(media) ? undefined
  : intl.formatMessage({ id: '{count, plural, one {{count} episode} other {{count} episodes}}', defaultMessage: '{count, plural, one {{count} episode} other {{count} episodes}}' }, { count: media.episodeCount })
