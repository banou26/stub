/**
 * How stub names an episode: `E5 - Title`, `Title` with no number, `Episode 5` with no title, and
 * undefined with neither. The watch page's heading and the title drawn on the player both use it, so
 * the two always read the same.
 */
export const episodeLabel = (episodeNumber: number | null | undefined, title: string | null | undefined) =>
  title
    ? `${episodeNumber != null ? `E${episodeNumber} - ` : ''}${title}`
    : episodeNumber != null
      ? `Episode ${episodeNumber}`
      : undefined
