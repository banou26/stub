import type { DetailsEpisode } from './media-details'

import { LucidePlay } from 'lucide-react'
import { Link } from 'wouter'

import SourceSelector from '../../components/source-selector'
import { releaseDateLabel } from '../../utils/release-date'
import { useNow } from '../../utils/use-now'
import { getRoutePath, Route } from '../path'
import { filmRelease } from './episodes'
import { useWatchSources } from './media-details'
import { movieFacts } from './movie'

/**
 * What a movie shows in place of an episode list: a line of facts and one play bar. Play opens the
 * watch page, which picks the source, and is drawn when some source plays in stub; until the release
 * it says when, and offers no Play.
 */
const MoviePlay = (
  { episode, mediaUri, handles, startDate, status, genres }:
  {
    episode: DetailsEpisode | undefined
    mediaUri: string
    handles?: Parameters<typeof useWatchSources>[2]
    startDate?: string | null
    status?: string | null
    genres?: readonly string[] | null
  }
) => {
  const sources = useWatchSources(episode, mediaUri, handles)
  const now = useNow()
  const { released, upcoming } = filmRelease({ startDate, status, episode }, new Date(now))
  const play = !upcoming && episode?.uri && sources.some(source => !source.external)
    ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })
    : undefined
  const day = releaseDateLabel(released)
  return (
    <div className="movie">
      <div className="facts">{movieFacts({ released, runtime: episode?.runtime, genres }).join(' · ')}</div>
      <div className="play-bar">
        {play ? <Link className="play" href={play}><LucidePlay size={20} fill="currentColor" aria-hidden="true"/>Play</Link> : undefined}
        {sources.length ? <SourceSelector compact sources={sources}/> : undefined}
        {upcoming && day ? <span className="when">Releases {day}</span> : undefined}
        {!upcoming && !sources.length ? <span className="when">No sources yet</span> : undefined}
      </div>
    </div>
  )
}

export default MoviePlay
