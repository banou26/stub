import type { DetailsEpisode } from './media-details'

import { LucidePlay } from 'lucide-react'
import { Link } from 'wouter'

import SourceSelector from '../../components/source-selector'
import { releaseDateLabel } from '../../utils/release-date'
import { getRoutePath, Route } from '../path'
import { releasedAtOf, useWatchSources } from './media-details'
import { isUpcoming, movieFacts } from './movie'

/**
 * What a movie shows in place of an episode list: a line of facts and one play bar. Play opens the
 * watch page, which picks the source, and is drawn when some source plays in stub; until the release
 * day it says when, and offers no Play.
 */
const MoviePlay = (
  { episode, mediaUri, handles, startDate, genres }:
  {
    episode: DetailsEpisode | undefined
    mediaUri: string
    handles?: Parameters<typeof useWatchSources>[2]
    startDate?: string | null
    genres?: readonly string[] | null
  }
) => {
  const sources = useWatchSources(episode, mediaUri, handles)
  const released = releasedAtOf(episode) ?? startDate
  const upcoming = isUpcoming(released)
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
