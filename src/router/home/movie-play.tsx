import type { ComponentChildren } from 'preact'
import type { WatchSource } from '../../components/source-selector'
import type { DetailsEpisode } from './media-details'

import { LucidePlay } from 'lucide-react'
import { useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { Link } from 'wouter'

import Placeholder from '../../components/placeholder'
import { useHiddenIcons } from '../../sources/hidden-icons'
import { serviceLogo } from '../../sources/justwatch/logos'
import { canPlay } from '../../sources/playable'
import { useNow } from '../../utils/use-now'
import { getRoutePath, Route } from '../path'
import { filmRelease } from './episodes'
import { filmDate } from './movie'

const HELD_ROWS = 3

/** What a film's preview draws its release, Play and services from: `settled` once every source has answered. */
export type FilmProps = {
  episode: DetailsEpisode | undefined
  mediaUri: string
  sources: WatchSource[]
  settled: boolean
  startDate?: string | null
  status?: string | null
}

const filmState = ({ episode, mediaUri, sources, settled, startDate, status }: FilmProps, now: number) => {
  const { released, upcoming } = filmRelease({ startDate, status, episode }, new Date(now))
  const plays = (source: WatchSource) => !source.external || Boolean(episode?.handles?.some(({ relation, node }) =>
    relation === 'SAME_AS' && node.origin === source.id && canPlay(node.origin, node.url, 'extension')))
  const play = !upcoming && episode?.uri && sources.some(plays)
    ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })
    : undefined
  const none = !upcoming && !sources.length
  const announced = none && !released && status === 'NOT_YET_RELEASED'
  return { released, upcoming, play, none, announced, holding: !upcoming && !announced && !settled }
}

const hostOf = (href: string | undefined) => {
  try {
    return new URL(href ?? '').hostname.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

// JustWatch's sharp logo, else the site's own icon, else the name's first letter
const Logo = ({ source }: { source: WatchSource }) => {
  const sharp = serviceLogo(source.id)
  const urls = [sharp, source.icon].filter((url): url is string => !!url)
  const [failed, setFailed] = useState(0)
  const url = urls[failed]
  return (
    <span className={sharp && url === sharp ? 'logo sharp' : 'logo'}>
      {url ? <img src={url} alt="" onError={() => setFailed(failed + 1)}/> : source.name.charAt(0)}
    </span>
  )
}

const Service = ({ source }: { source: WatchSource }) => {
  const intl = useIntl()
  const content = (
    <>
      <Logo source={source}/>
      <span className="name">{source.name}</span>
      {source.releases && source.releases.length > 1 ? <span className="count">{source.releases.length}</span> : undefined}
      <span className="how">{source.external ? hostOf(source.href) : intl.formatMessage({ id: 'Plays here', defaultMessage: 'Plays here' })}</span>
    </>
  )
  // a source played in stub is a client side navigation, which keeps the worker and every match it made this session
  return source.external || !source.href
    ? <a className="source" href={source.href} target="_blank" rel="noreferrer" title={source.name}>{content}</a>
    : <Link className="source plays" href={source.href} title={source.name}>{content}</Link>
}

/**
 * What a film shows under its title in place of a series' episode list: until it is out, its date in large type
 * ("Coming soon" while its status says it is not out and nothing dates it); then Play, opening the watch page, beside
 * `children` (the tracking). Play is drawn when one of `sources` plays in stub, or would with the extension, as the
 * watch page's pick counts it. Until the media has `settled`, Play's place is held while no source has landed, or while
 * one stub plays still links out because its episode has not landed.
 */
const MoviePlay = ({ children, ...film }: FilmProps & { children?: ComponentChildren }) => {
  const intl = useIntl()
  const now = useNow()
  const { released, upcoming, play, none, announced, holding } = filmState(film, now)
  const held = !play && holding && (none || film.sources.some(source => source.external && canPlay(source.id, source.href, 'extension')))
  const date = upcoming ? filmDate(released, new Date(now)) : undefined
  return (
    <div className="movie">
      {
        date
          ? (
            <div className="release">
              <span className={date.partial ? 'day partial' : 'day'}>{date.day}</span>
              <span className="date">{date.date}</span>
              {date.count ? <span className="count">{date.count}</span> : undefined}
            </div>
          )
          : announced
            ? (
              <div className="release">
                <span className="day partial">{intl.formatMessage({ id: 'Coming soon', defaultMessage: 'Coming soon' })}</span>
                <span className="date">{intl.formatMessage({ id: 'No release date yet', defaultMessage: 'No release date yet' })}</span>
              </div>
            )
            : undefined
      }
      <div className="actions">
        {
          play ? <Link className="play" href={play}><LucidePlay size={20} fill="currentColor" aria-hidden="true"/>{intl.formatMessage({ id: 'Play', defaultMessage: 'Play' })}</Link>
          : held ? <Placeholder className="play-pending"/>
          : undefined
        }
        {children}
      </div>
    </div>
  )
}

/**
 * Every place a film plays or can be watched, a row each naming what a click does, or "No sources yet" once it has
 * `settled` with none while out. Until then three rows' place is held, each landing row taking one.
 */
export const FilmSources = (film: FilmProps) => {
  const intl = useIntl()
  const hidden = useHiddenIcons()
  const { none, announced, holding } = filmState(film, useNow())
  const shown = film.sources.filter(source => !hidden.has(source.id))
  const slots = holding ? Math.max(0, HELD_ROWS - shown.length) : 0
  return shown.length || slots
    ? (
      <ul className="sources">
        {shown.map(source => <li key={source.id}><Service source={source}/></li>)}
        {Array.from({ length: slots }, (_, index) => <li key={index}><Placeholder className="source-pending"/></li>)}
      </ul>
    )
    : none && film.settled && !announced ? <p className="none">{intl.formatMessage({ id: 'No sources yet', defaultMessage: 'No sources yet' })}</p>
    : null
}

export default MoviePlay
