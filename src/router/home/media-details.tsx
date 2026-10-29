// What the media modal and the title page both draw: one query, the episode rows, where an episode
// plays, and the links to each source. One copy, so the two views cannot drift.

import type { GetMediaDetailsSubscription, GetMediaOriginsSubscription } from '../../generated/graphql'
import type { WatchSource } from '../../components/source-selector'
import type { FknBackend } from '../../utils/fkn-backend'

import { css } from '@emotion/react'
import { LucidePlay } from 'lucide-react'
import { useEffect, useRef, useState } from 'preact/hooks'
import { defineMessages, useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { OriginFilter } from '../../generated/graphql'
import { gql } from '../../generated'
import Paged from '../../components/paged'
import Placeholder from '../../components/placeholder'
import TextEllipsis from '../../components/text-ellipsis'
import OriginIcon from '../../components/origin-icon'
import SourceSelector from '../../components/source-selector'
import { MEDIA_TRACKING } from '../../components/media-tracking-query'
import { AggregatedUri, fromAggregatedUri } from '../../utils/uri'
import { filmRelease, releasedAtOf, scheduledAt, timedAt, unreleasedEpisodes } from './episodes'
import { isMovieMedia } from './movie'
import { nextThumbnail } from '../../utils/thumbnails'
import { getRoutePath, Route } from '../path'
import { releaseDateAttribute, releaseDateDisplay } from '../../utils/release-date'
import { formatCountdown } from '../../utils/countdown'
import { useNow } from '../../utils/use-now'
import { canPlay } from '../../sources/playable'
import { useHiddenIcons } from '../../sources/hidden-icons'
import { viewerCountry } from '../../sources/country'
import { detectBackend } from '../../utils/fkn-backend'
import { PACKAGE_ORIGIN_MAP } from '../../sources/justwatch/id'
import { episodeOriginIds } from './episode-origins'
import { namesSameWork } from './modal-media'
import { currentEpisode, playTarget, watchedEpisode, type Tracked } from '../title/facts'
import { newestPosition, usePositions } from '../../utils/watch-positions'

export const GET_MEDIA_DETAILS = gql(`
  subscription GetMediaDetails($input: MediaInput!, $descriptionInput: MediaDescriptionInput!, $details: Boolean! = false) {
    media(input: $input) {
      ...MediaFragment
      titles {
        language
        title
        score
      }
      descriptions(input: $descriptionInput) {
        language
        description
      }
      covers {
        language
        url
      }
      banners {
        language
        url
      }
      trailers {
        uri
        origin
        id
        url
        thumbnail
      }
      popularity
      categories
      type
      startDate
      endDate
      season
      seasonYear
      averageScore
      genres
      tags
      franchise {
        nodes {
          uri
          format
          status
          episodeCount
          startDate
          titles {
            title
          }
        }
        edges {
          from
          to
          relation
        }
      }
      relations {
        relation
        format
        node {
          _id
          uri
          origin
          id
          url
          status
          episodeCount
          startDate
          titles {
            title
          }
          covers {
            url
            color
          }
        }
      }
      episodes {
        ...EpisodeFragment
        episodeNumber
        releaseDate
        runtime
        titles {
          title
        }
        shortDescriptions {
          language
          shortDescription
        }
        thumbnails {
          url
        }
        handles {
          relation
          node {
            ...EpisodeFragment
            episodeNumber
            releaseDate
            titles {
              title
            }
            shortDescriptions {
              language
              shortDescription
            }
            thumbnails {
              url
            }
          }
        }
      }
      handles {
        relation
        node {
          ...MediaFragment
          handles {
            relation
            node {
              ...MediaFragment
              episodes {
                ...EpisodeFragment
              }
            }
          }
          episodes {
            ...EpisodeFragment
          }
        }
      }
      episodeCount
      status
      settled
      seasons {
        number
        uri
      }
      nextAiringEpisode {
        episodeNumber
        airingAt
      }
      airingSchedule {
        episodeNumber
        airingAt
      }
      duration
      sourceMaterial @include(if: $details)
      studios @include(if: $details)
      characters @include(if: $details) {
        name
        image
        url
        role
        voiceActors {
          name
          image
          url
          language
        }
      }
      staff @include(if: $details) {
        name
        image
        url
        roles
      }
      themes @include(if: $details) {
        kind
        sequence
        title
        artists
        video
      }
      ratings @include(if: $details) {
        source
        value
        scale
      }
      recommendations @include(if: $details) {
        rating
        node {
          ...MediaFragment
          type
          status
          startDate
          titles {
            title
          }
          covers {
            url
            color
          }
        }
      }
      streamingLinks {
        site
        url
        icon
        country
      }
    }
  }
`)

const GET_MEDIA_ORIGINS = gql(`
  subscription GetMediaOrigins($input: OriginPageInput!) {
    originPage(input: $input) {
      nodes {
        ...OriginFragment
      }
    }
  }
`)

export type DetailsMedia = NonNullable<GetMediaDetailsSubscription['media']>
export type DetailsEpisode = DetailsMedia['episodes'][number]
type DetailsHandle = DetailsEpisode['handles'][number]
/** What an episode row reads, which the watch page's query asks for too. */
type ListEpisode = Pick<DetailsEpisode, 'uri' | 'episodeNumber' | 'releaseDate' | 'titles' | 'shortDescriptions' | 'thumbnails'>
  & { handles: { relation: string, node: Pick<DetailsHandle['node'], 'uri' | 'origin' | 'url' | 'releaseDate' | 'titles'> }[] }
type ListMedia = Pick<DetailsMedia, 'uri' | 'status' | 'settled' | 'episodeCount' | 'nextAiringEpisode' | 'airingSchedule'>
  & { episodes: readonly ListEpisode[] }

/**
 * The viewer's tracking of a media, its status and progress, once the worker has answered for that
 * work: urql keeps the last result while a new subscription starts, which after a navigation is the
 * previous work's.
 */
export const useTrackingSummary = (uri: string | undefined): Tracked => {
  const [{ data }] = useSubscription({
    query: MEDIA_TRACKING,
    variables: { input: { uri: uri ?? '' } },
    pause: !uri
  })
  const tracking = data?.tracking
  // `tracking:<uri>`, tracking/aggregate.ts `trackingId`
  return tracking && namesSameWork(tracking._id.slice('tracking:'.length), uri) ? tracking.summary : undefined
}

const PLAY_LABELS = defineMessages({
  Play: { id: 'Play', defaultMessage: 'Play' },
  Continue: { id: 'Continue#resume watching', defaultMessage: 'Continue', description: 'resume watching' },
  Rewatch: { id: 'Rewatch', defaultMessage: 'Rewatch' },
})

/** The Play button of a media: Play, Continue or Rewatch from the viewer's tracking, opening that episode. Nothing while it is not out at `useNow`'s time, a film by the modal's rule. */
export const MediaPlay = ({ media }: { media: DetailsMedia | null | undefined }) => {
  const intl = useIntl()
  const tracked = useTrackingSummary(media?.uri)
  const now = useNow()
  if (!media) return null
  // a film is out by the modal's rule, its own day before its episode's air time
  const film = isMovieMedia(media) && filmRelease({ startDate: media.startDate, status: media.status, episode: media.episodes.at(0) }, new Date(now))
  const unreleased = film ? media.episodes.map(() => film.upcoming) : unreleasedEpisodes(media, new Date(now))
  const target = playTarget(media.episodes.map((episode, index) => ({ ...episode, unreleased: unreleased[index]! })), tracked)
  return target
    ? (
      <Link className="play" href={getRoutePath(Route.WATCH, { mediaUri: media.uri, episodeUri: target.episodeUri })}>
        <LucidePlay size={20} fill="currentColor" aria-hidden="true"/>{intl.formatMessage(PLAY_LABELS[target.label])}
      </Link>
    )
    : null
}

const STREAMING_ORIGINS = new Set(Object.values(PACKAGE_ORIGIN_MAP))

type Origin = GetMediaOriginsSubscription['originPage']['nodes'][number]
type Offer = { relation: string, node: { origin: string, url?: string | null } }

const useOrigins = (ids: string[] | undefined) => {
  const [{ data, operation }] = useSubscription({
    query: GET_MEDIA_ORIGINS,
    variables: { input: { ids: ids ?? [], filters: [OriginFilter.IsNotApiOnly] } },
    pause: !ids
  })
  const asked = operation?.variables.input.ids
  return { origins: data?.originPage?.nodes ?? [], answered: !ids || ids.every(id => asked?.includes(id)) }
}

const useBackend = () => {
  const [backend, setBackend] = useState<FknBackend>()
  useEffect(() => {
    let cancelled = false
    void detectBackend().then(detected => { if (!cancelled) setBackend(detected) })
    return () => { cancelled = true }
  }, [])
  return backend
}

const watchLinks = (offers: readonly Offer[]) =>
  offers.filter(handle => handle.relation === 'SAME_AS' && handle.node.url && STREAMING_ORIGINS.has(handle.node.origin))

/**
 * The origins `useWatchSources` draws its sources from, known in the same render as the media, while the sources
 * themselves wait on their own query.
 */
export const watchOriginIds = (episode: DetailsEpisode | undefined, offers: readonly Offer[] = []): string[] =>
  episode ? [...new Set([...episodeOriginIds(episode), ...watchLinks(offers).map(handle => handle.node.origin)])] : []

/**
 * Where an episode plays or can be watched: stub's own players first, then the sites' own pages.
 * `offers` are media-level handles, linked out for a streaming site the episode itself does not name,
 * which is where a film's offers live. Until `answered`, a source just named waits on its origin's own
 * answer, a worker round trip after the media's, and is missing from `sources`.
 */
export const useWatchSources = (
  episode: DetailsEpisode | undefined,
  mediaUri: string,
  offers: readonly Offer[] = []
): { sources: WatchSource[], answered: boolean } => {
  const { origins, answered } = useOrigins(episode ? watchOriginIds(episode, offers) : undefined)
  const backend = useBackend()
  return { sources: episode ? watchSources(episode, mediaUri, origins, backend, watchLinks(offers)) : [], answered }
}

/**
 * Whether the media asked for at `uri` has settled since the page asked: a source joining later turns `settled` false
 * again, and a place held until the media settles is not held a second time.
 */
export const useSettledOnce = (uri: string | undefined, settled: boolean | null | undefined) => {
  const once = useRef<string | undefined>(undefined)
  if (settled) once.current = uri
  return once.current !== undefined && once.current === uri
}

const watchSources = (
  episode: ListEpisode, mediaUri: string, origins: readonly Origin[], backend: FknBackend | undefined, links: readonly Offer[] = []
): WatchSource[] =>
  origins
    .map(origin => {
      // SAME_AS only. Everything below routes into PLAYBACK: `sourceUri` is handed to the watch route
      // and resolved back to a handle to play, so a node that is merely PART_OF this episode would be
      // asked to play a different episode. No source emits a PART_OF episode handle today; the filter
      // is here so that the day one does, it shows up as a missing row rather than a wrong stream.
      const handles =
        (episode.handles ?? [])
          .filter(handle => handle.relation === 'SAME_AS' && handle.node.origin === origin.id)
          .map(handle => handle.node)
      const handle = handles.at(0)
      const sourceUri = handle?.uri
      const playable = canPlay(origin.id, handle?.url, backend)
      // named even for several releases: a watch address with no source opens the page's own pick
      const watchPath = episode.uri && sourceUri
        ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri, sourceUri })
        : undefined
      // a browser opens no magnet, so a release off the web plays on the watch page, which hands it to its plugin
      const inApp = handles.length > 1 || playable || (handle?.url != null && !/^https?:/.test(handle.url))
      return {
        id: origin.id,
        name: origin.name ?? origin.id,
        icon: origin.icon,
        color: origin.color,
        href: inApp
          ? watchPath
          : (handle?.url ?? links.find(link => link.node.origin === origin.id)?.node.url ?? undefined),
        external: !inApp,
        active: false,
        releases: handles.length > 1
          ? handles.map(node => ({ uri: node.uri, label: node.titles?.at(0)?.title ?? node.uri, external: false, active: false }))
          : undefined,
      } satisfies WatchSource
    })
    .filter(source => source.href)
    .sort((a, b) => Number(a.external) - Number(b.external))

type StreamingLink = NonNullable<DetailsMedia['streamingLinks']>[number]

const hostOf = (url: string | null | undefined) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : undefined
  } catch {
    return undefined
  }
}

// a site's other hosts are parents or parts of it: AniList links Prime Video on www.amazon.com, and its icon a handle on
// watch.amazon.com (2026-10-30)
const sameSite = (host: string, other: string) => host === other || host.endsWith(`.${other}`) || other.endsWith(`.${host}`)

/**
 * The streaming links to draw: the viewer's country's and those naming none, one per site, and none on a site of
 * `taken`, the addresses of the sources and of their handles, drawn or hidden.
 */
const linksToDraw = (links: readonly StreamingLink[], taken: readonly (string | null | undefined)[]) => {
  const country = viewerCountry()
  const seen = taken.flatMap(url => hostOf(url) ?? [])
  return links.flatMap(link => {
    const host = hostOf(link.url)
    if (!host || seen.some(site => sameSite(site, host)) || (link.country && link.country !== country)) return []
    seen.push(host)
    return [{ ...link, host }]
  })
}

/**
 * The links to each site that names this media but the origins in `except`, as icons, unstyled: each view sizes them
 * itself, then `links` to a site no source icon stands for. Nothing until the worker has answered for the media.
 */
export const SourceLinks = (
  { uri, handles, links, except = [] }:
  {
    uri: string | undefined
    handles: readonly { relation: string, node: { origin: string, url?: string | null } }[] | undefined
    links?: readonly StreamingLink[] | null
    except?: readonly string[]
  }
) => {
  const origins = uri ? fromAggregatedUri(uri as AggregatedUri)?.handleUrisValues : undefined
  // The aggregated uri names the SAME_AS cluster and nothing else, by construction: `aggregateMedia`
  // builds it from the cluster members. So an origin that reaches this media only as PART_OF, which is
  // every origin that cannot name a run, was never in this list and its row was never rendered. Its
  // url was carried all the way to the client and dropped one line short of the screen.
  //
  // Unioned rather than replaced: the uri can name an origin whose handle row is not in this
  // selection, so deriving from `handles` alone would silently remove rows that render today.
  const originIds = [
    ...new Set([
      ...origins?.map(origin => origin.origin) ?? [],
      ...handles?.map(handle => handle.node.origin) ?? [],
    ])
  ]
  const hidden = useHiddenIcons()
  // the hidden ones too, so a link to a site whose icon the viewer hid stays hidden with it, and unfiltered, so the
  // answer names every source here
  const ids = [...new Set([...originIds, ...hidden])]
  const [{ data: originData, operation }] = useSubscription({
    query: GET_MEDIA_ORIGINS,
    variables: { input: { ids } },
  })
  const answered = originData?.originPage?.nodes
  // The links wait for the answer naming every source here, as until then the sites they must not stand on are not all
  // known. The answer shown is the last one's until the worker answers for a source just named (the modal's links drew
  // beside no icon, 2026-10-29), and a cold worker's first comes before its sources have said who they are (2026-10-30).
  const asked = operation?.variables.input.ids
  const ready = answered && ids.every(id => asked?.includes(id)) && originIds.every(id => answered.some(origin => origin.id === id))
  return (
    <span className="origins">
      {
        answered
          ?.map(origin => {
            // BOTH RELATIONS, deliberately. This row wants a url and an origin and nothing else: no
            // sameness is assumed and nothing is merged across it. A PART_OF handle is exactly as
            // good here as a SAME_AS one, which is why IMDb can render as a link rather than the dead
            // grey icon in the branch below.
            // SAME_AS FIRST, then anything. `handles` is ordered by score, which says nothing about
            // relation, so a plain `find` could hand the Crunchyroll icon a PART_OF `cr:<seriesId>`
            // while the SAME_AS `cr:<seriesId>-<seasonId>` for this very cour sat later in the list.
            const forOrigin = handles?.filter(handle => handle.node.origin === origin.id && handle.node.url) ?? []
            const link = (forOrigin.find(handle => handle.relation === 'SAME_AS') ?? forOrigin.at(0))?.node.url
            if (!origin.icon || origin.isApiOnly || hidden.has(origin.id) || except.includes(origin.id)) return undefined
            return (
              link
                ? (
                  <a className="origin" href={link} target="_blank" rel="noreferrer" title={origin.name} key={origin.id}>
                    <OriginIcon icon={origin.icon} name={origin.name ?? origin.id}/>
                  </a>
                )
                : (
                  <div className="origin" title={origin.name} key={origin.id}>
                    <OriginIcon icon={origin.icon} name={origin.name ?? origin.id}/>
                  </div>
                )
            )
          })
          .filter(Boolean)
      }
      {
        ready && linksToDraw(links ?? [], [...answered.map(origin => origin.url), ...handles?.map(handle => handle.node.url) ?? []]).map(link => (
          <a className="origin" href={link.url} target="_blank" rel="noreferrer" title={link.site} key={link.host}>
            <OriginIcon icon={link.icon} name={link.site}/>
          </a>
        ))
      }
    </span>
  )
}

const episodesStyle = css`
  border-top: 0.1rem solid rgba(255, 255, 255, 0.1);

  .episode {
    position: relative;
    display: flex;
    border-bottom: 0.1rem solid rgba(255, 255, 255, 0.1);
    color: rgb(255, 255, 255);
    text-decoration: none;
    overflow: hidden;
    height: 10rem;

    & > .episode-link {
      position: absolute;
      inset: 0;
      z-index: 0;
      color: inherit;
      text-decoration: none;
    }

    /* inside the row, which clips what is drawn past it */
    & > .episode-link:focus-visible {
      outline: 2px solid rgba(255, 255, 255, 0.8);
      outline-offset: -2px;
    }

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
    }

    /* the episode playing */
    &:has(> .episode-link[aria-current]) {
      background-color: rgba(255, 255, 255, 0.08);
      box-shadow: inset 0.3rem 0 0 #fff;
    }

    &.unreleased {
      opacity: 0.45;
    }

    .number {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
      font-weight: bold;
      min-width: 7.5rem;
    }

    .thumbnail {
      position: relative;
      overflow: hidden;
      flex-shrink: 0;
      margin: auto 0;
      height: 7.5rem;
      aspect-ratio: 16 / 9;
      background-color: rgb(35, 35, 35);
      border-radius: .5rem;
      margin-right: 2.5rem;
      /* decorative only, let the row link under it take hovers and clicks */
      pointer-events: none;

      & > img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      & > .bar {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 0.4rem;
        background-color: rgb(229, 9, 20);
      }
    }

    .content {
      display: flex;
      flex-direction: column;
      justify-content: center;

      & > .header {
        display: flex;

        & > .title {
         font-size: 2rem;
         font-weight: bold;
        }
        & > .origins {
          position: relative;
          z-index: 1;
          display: flex;
          align-items: center;
          margin-left: 1rem;
        }
      }

      & > .description {
        margin-top: 0.5rem;
        max-height: 6rem;
        overflow: hidden;

        * > .ellipsis {
          max-height: 6rem;
          white-space: pre-wrap;
          overflow: hidden;
        }
      }
    }

    .side {
      /* auto rather than a grown .content: the row's other children keep the widths they had, and
         the date sits against the right edge however long the title and description turn out */
      margin-left: auto;
      display: flex;
      align-items: center;
      flex-shrink: 0;
      padding: 0 2.5rem 0 2rem;
      /* decorative, like the thumbnail above it: the whole row is one link */
      pointer-events: none;

      & > .date {
        font-size: 1.5rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.8);
        white-space: nowrap;
        text-align: right;
      }
    }
  }

  & > .empty {
    padding: 3rem 0;
    color: rgba(255, 255, 255, 0.6);
    font-size: 1.6rem;
    text-align: center;
  }

  /* not a width in %: on a wide screen the row's content column shrinks to what is in it */
  .episode.placeholder .title-pending {
    width: 20rem;
    height: 2rem;
  }

  @media (max-width: 768px) {
    .episode {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr);
      align-content: center;
      /* one height whatever has arrived, since a row's icons and description land after its title */
      height: 12.5rem;
      padding: 0.8rem 0;

      .number {
        grid-row: span 2;
        min-width: 3.5rem;
        font-size: 1.6rem;
      }

      .thumbnail {
        grid-row: span 2;
        height: 5rem;
        margin-right: 1rem;
      }

      .content {
        & > .header {
          flex-wrap: wrap;
          gap: 0.4rem 1rem;

          & > .title {
            flex-basis: 100%;
            font-size: 1.5rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          & > .origins {
            min-height: 2.8rem;
            margin-left: 0;
          }
        }
        & > .description {
          font-size: 1.3rem;
          max-height: 3.2rem;
        }
      }

      .side {
        margin-left: 0;
        padding: 0.4rem 1rem 0 0;
      }
    }
  }
`

const Episode = (
  { episode, index, mediaUri, sourceUri, current, origins, backend, unreleased, airingAt, scheduled, now, watched, progress }:
  {
    episode: ListEpisode, index: number, mediaUri: string, sourceUri?: string, current: boolean, origins: readonly Origin[], backend: FknBackend | undefined
    unreleased: boolean, airingAt?: string, scheduled?: string, now: number, watched: boolean, progress?: number
  }
) => {
  const intl = useIntl()
  // one thumbnail per source, score first; a host that refuses this viewer must not blank the row
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set())
  const thumbnail = nextThumbnail(episode.thumbnails, failedThumbnails)
  const releasedAt = airingAt ?? scheduled ?? releasedAtOf(episode)
  const airsIn = unreleased && airingAt ? formatCountdown(Date.parse(airingAt) - now) : undefined
  const released = airsIn ? intl.formatMessage({ id: 'in {countdown}', defaultMessage: 'in {countdown}' }, { countdown: airsIn }) : releaseDateDisplay(releasedAt, { upcoming: unreleased, locale: intl.locale })
  const sources = unreleased ? [] : watchSources(episode, mediaUri, origins, backend)
  const bar = unreleased ? undefined : progress ?? (watched ? 1 : undefined)

  return (
    <div className={unreleased ? 'episode unreleased' : 'episode'}>
      {
        episode.uri && !unreleased
          ? (
            <Link
              className="episode-link"
              href={getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri, sourceUri })}
              aria-current={current ? 'page' : undefined}
            />
          )
          : undefined
      }
      <div className="number">{episode.episodeNumber}</div>
      <div className="thumbnail">
        {thumbnail ? <img src={thumbnail} onError={() => setFailedThumbnails(prev => new Set(prev).add(thumbnail))}/> : undefined}
        {
          bar === undefined ? undefined
            : <div className="bar" role="progressbar" aria-label={intl.formatMessage({ id: 'Watched#progress', defaultMessage: 'Watched', description: 'progress' })} aria-valuenow={Math.round(bar * 100)} style={{ width: `${bar * 100}%` }}/>
        }
      </div>
      <div className="content">
        <div className="header">
          <div className="title">{episode.titles?.at(0)?.title ?? (unreleased ? intl.formatMessage({ id: 'Unreleased episode', defaultMessage: 'Unreleased episode' }) : intl.formatMessage({ id: 'Episode {number}', defaultMessage: 'Episode {number}' }, { number: index + 1 }))}</div>
          <span className="origins">
            <SourceSelector compact sources={sources} />
          </span>
        </div>
        {
          episode.shortDescriptions?.at(0)
            ? (
              <div className="description">
                <TextEllipsis className="ellipsis">
                  {episode.shortDescriptions?.at(0)?.shortDescription}
                </TextEllipsis>
              </div>
            )
            : undefined
        }
      </div>
      <div className="side">
        {
          released
            ? <time className="date" dateTime={releaseDateAttribute(releasedAt)}>{released}</time>
            : undefined
        }
      </div>
    </div>
  )
}

// a cour
const EPISODES_PAGE = 12

// SAME_AS only, the sources that play this episode, as in `watchSources`
const playableUris = (episode: ListEpisode) =>
  (episode.handles ?? []).filter(handle => handle.relation === 'SAME_AS').map(handle => handle.node.uri)

/** `count` rows' placeholders, for a list whose rows have not arrived. */
export const EpisodesPlaceholder = ({ count = 3 }: { count?: number }) => (
  <div className="episodes" css={episodesStyle}>
    {Array.from({ length: count }, (_, index) => (
      <div className="episode placeholder" key={index} aria-hidden="true">
        <div className="number"/>
        <Placeholder className="thumbnail"/>
        <div className="content">
          <div className="header"><Placeholder className="title-pending"/></div>
        </div>
      </div>
    ))}
  </div>
)

// past seven pages, the box to type an episode's number in
const JUMP_PAGES = 7

const jumpStyle = css`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1.2rem;

  & > label {
    display: flex;
    align-items: center;
    gap: 0.8rem;
    font-size: 1.4rem;
    color: rgba(255, 255, 255, 0.8);
  }

  & input {
    width: 9rem;
    height: 3.2rem;
    padding: 0 0.8rem;
    border-radius: 0.6rem;
    border: 0.1rem solid rgba(255, 255, 255, 0.18);
    background: rgb(30, 30, 30);
    color: #fff;
    font: inherit;
    font-variant-numeric: tabular-nums;
  }
`

/**
 * A series' episode rows a page at a time, opening on the page holding `current`, else the viewer's next episode by
 * `tracked`; an unreleased one dimmed, not linked and dated by AniList's schedule while that time is ahead, before any
 * source, the first of them counting down to its time when AniList or its best-ranked source names one. Each thumbnail
 * carries a bar for how far the viewer got: the share where they last stopped in any of the episode's sources, else
 * full once `tracked` says it is watched. With no rows, rows' placeholders until every source has answered, then "No
 * episodes found". Past seven pages a box takes an episode's number and shows its page.
 *
 * `current` is the index of the episode playing, its row marked, and the list goes back to it whenever it changes.
 * Each row opens its episode under `mediaUri`, by default `media.uri`, on the source `sourceOf` names for it, or
 * where the Play pick decides when it names none.
 */
export const Episodes = ({ media, tracked, current, mediaUri = media.uri, sourceOf }: {
  media: ListMedia
  tracked?: Tracked
  current?: number
  mediaUri?: string
  sourceOf?: (episode: ListEpisode) => string | undefined
}) => {
  const intl = useIntl()
  const now = useNow()
  // the row the box last showed while the same episode played, and how often, so the same number typed again shows it again
  const [jump, setJump] = useState<{ index: number, current?: number, times: number }>()
  const box = useRef<HTMLInputElement>(null)
  const rows = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (jump) rows.current?.children[jump.index % EPISODES_PAGE]?.querySelector<HTMLElement>('.episode-link')?.focus()
  }, [jump])
  const unreleased = unreleasedEpisodes(media, new Date(now))
  const next = unreleased.indexOf(true)
  const schedule = new Map<number | null | undefined, string>(
    media.airingSchedule?.filter(({ airingAt }) => Date.parse(airingAt) > now).map(({ episodeNumber, airingAt }) => [episodeNumber, airingAt])
  )
  // one query for every page's rows, so a page drawn later starts with its sources' icons too
  const { origins } = useOrigins([...new Set(media.episodes.flatMap(episodeOriginIds))])
  const backend = useBackend()
  const positions = usePositions()
  if (!media.episodes.length) {
    return media.settled
      ? <div className="episodes" css={episodesStyle}><div className="empty">{intl.formatMessage({ id: 'No episodes found', defaultMessage: 'No episodes found' })}</div></div>
      : <EpisodesPlaceholder count={Math.min(media.episodeCount || 3, EPISODES_PAGE)}/>
  }
  const jumped = jump?.current === current ? jump : undefined
  const show = (event: Event) => {
    event.preventDefault()
    const number = Number.parseInt(box.current!.value, 10)
    if (Number.isNaN(number)) return
    const at = media.episodes.findIndex(({ episodeNumber }) => episodeNumber != null && episodeNumber >= number)
    setJump({ index: at < 0 ? media.episodes.length - 1 : at, current, times: (jumped?.times ?? 0) + 1 })
  }
  return (
    <>
      {
        media.episodes.length > JUMP_PAGES * EPISODES_PAGE
          ? (
            <form css={jumpStyle} onSubmit={show}>
              <label>
                {intl.formatMessage({ id: 'Episode', defaultMessage: 'Episode' })}
                <input ref={box} type="number" inputMode="numeric"/>
              </label>
            </form>
          )
          : undefined
      }
      <Paged
        key={`${current} ${jumped?.times}`}
        items={media.episodes}
        size={EPISODES_PAGE}
        label={intl.formatMessage({ id: 'Episodes', defaultMessage: 'Episodes' })}
        start={jumped?.index ?? current ?? currentEpisode(media.episodes, tracked)}
      >
        {(page, offset) => (
          <div className="episodes" css={episodesStyle} ref={rows}>
            {page.map((episode, at) => {
              const index = offset + at
              const saved = newestPosition(playableUris(episode), positions)
              const scheduled = unreleased[index] ? schedule.get(episode.episodeNumber) : undefined
              return (
                <Episode
                  key={episode.episodeNumber ?? episode.uri ?? index}
                  episode={episode}
                  index={index}
                  mediaUri={mediaUri}
                  sourceUri={sourceOf?.(episode)}
                  current={index === current}
                  origins={origins}
                  backend={backend}
                  unreleased={unreleased[index]!}
                  airingAt={scheduledAt(episode, media.nextAiringEpisode) ?? (index === next ? scheduled ?? timedAt(episode) : undefined)}
                  scheduled={scheduled}
                  now={now}
                  watched={watchedEpisode(episode.episodeNumber, tracked, media.episodeCount)}
                  progress={saved?.[2] ? saved[1] / saved[2] : undefined}
                />
              )
            })}
          </div>
        )}
      </Paged>
    </>
  )
}
