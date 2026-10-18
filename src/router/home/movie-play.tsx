import type { WatchSource } from '../../components/source-selector'
import type { DetailsEpisode } from './media-details'

import { LucidePlay } from 'lucide-react'
import { Link } from 'wouter'

import { canPlay } from '../../sources/playable'
import { releaseDateLabel } from '../../utils/release-date'
import { useNow } from '../../utils/use-now'
import { getRoutePath, Route } from '../path'
import { filmRelease } from './episodes'
import { movieFacts } from './movie'

/**
 * What a movie shows in place of an episode list: a line of facts and one play bar. Play opens the
 * watch page, which picks the source, and is drawn when one of `sources` plays in stub, or would with
 * the extension, as the watch page's pick counts it; until the release it says when, and offers no
 * Play. Until the media has `settled`, the bar holds Play's place while no source has landed, or while
 * one stub plays still links out because its episode has not landed; with nothing to hold, there is no bar.
 */
const MoviePlay = (
  { episode, mediaUri, sources, settled, startDate, status, genres }:
  {
    episode: DetailsEpisode | undefined
    mediaUri: string
    sources: WatchSource[]
    settled: boolean
    startDate?: string | null
    status?: string | null
    genres?: readonly string[] | null
  }
) => {
  const now = useNow()
  const { released, upcoming } = filmRelease({ startDate, status, episode }, new Date(now))
  const plays = (source: WatchSource) => !source.external || Boolean(episode?.handles?.some(({ relation, node }) =>
    relation === 'SAME_AS' && node.origin === source.id && canPlay(node.origin, node.url, 'extension')))
  const play = !upcoming && episode?.uri && sources.some(plays)
    ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })
    : undefined
  const day = releaseDateLabel(released)
  const none = !upcoming && !sources.length
  const when = upcoming ? day && `Releases ${day}` : none && settled ? 'No sources yet' : undefined
  const held = !play && !upcoming && !settled && (none || sources.some(source => source.external && canPlay(source.id, source.href, 'extension')))
  return (
    <div className="movie">
      <div className="facts">{movieFacts({ released, runtime: episode?.runtime, genres }).join(' · ')}</div>
      {
        play || when || held
          ? (
            <div className={held ? 'play-bar held' : 'play-bar'}>
              {play ? <Link className="play" href={play}><LucidePlay size={20} fill="currentColor" aria-hidden="true"/>Play</Link> : undefined}
              {when ? <span className="when">{when}</span> : undefined}
            </div>
          )
          : undefined
      }
    </div>
  )
}

export default MoviePlay
