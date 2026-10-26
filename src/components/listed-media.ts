import type { Media } from '../generated/graphql'

import { intl } from '../i18n'

/**
 * A media as the search page's card and list modes read it.
 *
 * One type for both, so the page's query only has to satisfy a single shape and a field added for one
 * mode cannot go missing in the other.
 */
export type ListedMedia = Pick<Media,
  '_id' | 'uri' | 'titles' | 'covers' | 'genres' | 'shortDescriptions'
  | 'averageScore' | 'popularity' | 'episodeCount' | 'type' | 'status' | 'season' | 'seasonYear'
  | 'nextAiringEpisode'
>

/** The countdown a media's schedule still has ahead of `now`, in milliseconds, or nothing. */
export const airsIn = (media: Pick<ListedMedia, 'nextAiringEpisode'>, now: number): number | undefined => {
  const airingAt = media.nextAiringEpisode?.airingAt
  if (!airingAt) return undefined
  const at = new Date(airingAt).getTime()
  return Number.isFinite(at) ? at - now : undefined
}

/** An episode count as words, or nothing. Singular because a one-episode film read "1 episodes". */
export const episodesLabel = (count: number | null | undefined): string | undefined =>
  count == null ? undefined : intl.formatMessage({ id: '{count, plural, one {{count} episode} other {{count} episodes}}', defaultMessage: '{count, plural, one {{count} episode} other {{count} episodes}}' }, { count })
