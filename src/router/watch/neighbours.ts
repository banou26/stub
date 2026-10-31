// The episodes either side of the one playing, and the source each opens on. Imports nothing that
// reaches the worker, so it is tested without the watch page.

import { bestSource, type Ways } from './auto-pick'
import { unreleasedEpisodes } from '../home/episodes'
import { isMovieMedia } from '../home/movie'
import { isVideoFormat } from '../../utils/franchise-layout'
import { asAggregatedUri } from '../../utils/uri'

type Dated = Parameters<typeof unreleasedEpisodes>[0]

/** One run of episodes, a season or a film, with what says which of them are out. */
type Run<T extends Dated['episodes'][number]> = Omit<Dated, 'episodes'> & { uri: string, episodes: readonly T[] }

/**
 * The run after this one (`1`) or before it (`-1`) as a cluster, since a bare address is answered by
 * few sources: a show's next or previous season, else an anime's sequel or prequel that plays, one of
 * its own format first, so a TV season goes on to the next TV season rather than to a recap special or
 * a film listed beside it. Undefined for a film, and when there is none.
 */
export const adjacentRun = (
  media: {
    /** Every row the media is, which is how it is found in `seasons`. */
    handles: readonly { node: { uri: string } }[]
    seasons?: readonly { uri: string }[] | null
    relations?: readonly { relation: string, format?: string | null, node: { uri: string } }[]
    type?: string | null
    categories?: readonly string[] | null
  },
  step: 1 | -1,
): string | undefined => {
  if (isMovieMedia(media)) return undefined
  const { handles, seasons, relations, type } = media
  const at = seasons?.findIndex(season => handles.some(handle => handle.node.uri === season.uri)) ?? -1
  if (seasons && at >= 0) {
    const season = seasons[at + step]
    return season && asAggregatedUri(season.uri)
  }
  const relation = step > 0 ? 'SEQUEL' : 'PREQUEL'
  // listed in uri order, which says nothing about which came first
  const runs = relations?.filter(edge => edge.relation === relation && isVideoFormat(edge.format)) ?? []
  const run = runs.find(edge => edge.format === type) ?? runs[0]
  return run && asAggregatedUri(run.node.uri)
}

/**
 * The episode before the one at `index` of `run`, and the one after it once it is out at `now`, each
 * with the uri of the run it is in. Rows are in episode order, so a gap in the numbering is stepped
 * over, and past either end of `run` the neighbour is the last episode of `before` or the first of
 * `after`.
 */
export const neighbours = <T extends Dated['episodes'][number]>(
  [before, run, after]: readonly [Run<T> | undefined, Run<T> | undefined, Run<T> | undefined],
  index: number,
  now = new Date(),
) => {
  const runs = [before, run, after].filter(each => each !== undefined)
  const rows = runs.flatMap(({ uri, episodes }) => episodes.map(episode => ({ episode, mediaUri: uri })))
  const unreleased = runs.flatMap(each => unreleasedEpisodes(each, now))
  const at = index < 0 ? -1 : index + (before?.episodes.length ?? 0)
  return {
    previous: at > 0 ? rows[at - 1] : undefined,
    next: at >= 0 && !unreleased[at + 1] ? rows[at + 1] : undefined,
  }
}

/**
 * The source another episode opens on: its best handle `origin` plays, so a viewer stays on the
 * site or the release they chose, and one at `playing`, the url of the release playing, first: the
 * next file of the torrent playing, which its player holds the peers and the file list of already.
 * Undefined when that origin has none, and the address then names no source, so the Play pick
 * decides there.
 */
export const sourceFor = (handles: Parameters<typeof bestSource>[0], origin: string | undefined, ways: Ways, playing?: string) => {
  if (!origin) return undefined
  const own = handles.filter(handle => handle.origin === origin)
  return (playing ? bestSource(own.filter(handle => handle.url === playing), ways) : undefined)?.uri ?? bestSource(own, ways)?.uri
}
