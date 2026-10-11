// What a movie's page shows in place of a series' episode list: one line of facts and a release that
// may still be ahead. No app imports, so the rules are tested without rendering the modal (which
// cannot load under vitest, see tests/unit/router/modal-media.test.ts).

import { parseReleaseDate } from '../../utils/release-date'

/** "1h 52m" for 112 minutes, "45m" under an hour, undefined for none. */
export const runtimeText = (minutes: number | null | undefined): string | undefined => {
  if (!minutes || minutes <= 0) return undefined
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours ? (rest ? `${hours}h ${rest}m` : `${hours}h`) : `${rest}m`
}

/** The line under a movie's title: "Movie", its year, its runtime and up to three genres. */
export const movieFacts = (
  { released, runtime, genres }: { released?: string | null, runtime?: number | null, genres?: readonly string[] | null }
): string[] => {
  const year = parseReleaseDate(released)?.getUTCFullYear()
  return [
    'Movie',
    year ? String(year) : undefined,
    runtimeText(runtime),
    genres?.length ? genres.slice(0, 3).join(', ') : undefined,
  ].filter((fact): fact is string => !!fact)
}

/** Whether a media draws as a film: a movie of one episode or none, since a film released in parts keeps its episode list. */
export const isMovieMedia = (
  { categories, episodes }: { categories?: readonly string[] | null, episodes?: readonly unknown[] | null }
): boolean => Boolean(categories?.includes('MOVIE') && (episodes?.length ?? 0) <= 1)

/** Whether a release day is still ahead of `now`, read as a whole day in UTC. */
export const isUpcoming = (released: string | null | undefined, now = new Date()): boolean => {
  const date = parseReleaseDate(released)
  if (!date) return false
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  return day > Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}
