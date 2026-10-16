// What the media modal and the title page both draw: one query, the episode rows, where an episode
// plays, and the links to each source. One copy, so the two views cannot drift.

import type { GetMediaDetailsSubscription, GetMediaOriginsSubscription } from '../../generated/graphql'
import type { WatchSource } from '../../components/source-selector'
import type { FknBackend } from '../../utils/fkn-backend'

import { css } from '@emotion/react'
import { useEffect, useState } from 'preact/hooks'
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
import { releasedAtOf, unreleasedEpisodes } from './episodes'
import { nextThumbnail } from '../../utils/thumbnails'
import { getRoutePath, Route } from '../path'
import { releaseDateAttribute, releaseDateDisplay } from '../../utils/release-date'
import { formatCountdown } from '../../utils/countdown'
import { useNow } from '../../utils/use-now'
import { canPlay } from '../../sources/playable'
import { detectBackend } from '../../utils/fkn-backend'
import { PACKAGE_ORIGIN_MAP } from '../../sources/justwatch/id'
import { episodeOriginIds } from './episode-origins'
import { namesSameWork } from './modal-media'
import { playTarget, type PlayLabel, type Tracked } from '../title/facts'

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
      duration @include(if: $details)
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

/** The Play button of a media: Play, Continue or Rewatch from the viewer's tracking, and the episode it opens. Nothing when that episode is not out. */
export const playOf = (media: DetailsMedia, tracked: Tracked): { label: PlayLabel, href: string } | undefined => {
  const unreleased = unreleasedEpisodes(media)
  const target = playTarget(media.episodes.map((episode, index) => ({ ...episode, unreleased: unreleased[index]! })), tracked)
  return target && { label: target.label, href: getRoutePath(Route.WATCH, { mediaUri: media.uri, episodeUri: target.episodeUri }) }
}

/** `playOf` on the viewer's tracking, subscribed here. */
export const usePlay = (media: DetailsMedia | null | undefined) => {
  const tracked = useTrackingSummary(media?.uri)
  return media ? playOf(media, tracked) : undefined
}

const STREAMING_ORIGINS = new Set(Object.values(PACKAGE_ORIGIN_MAP))

type Origin = GetMediaOriginsSubscription['originPage']['nodes'][number]
type Offer = { relation: string, node: { origin: string, url?: string | null } }

const useOrigins = (ids: string[] | undefined): readonly Origin[] => {
  const [{ data }] = useSubscription({
    query: GET_MEDIA_ORIGINS,
    variables: { input: { ids: ids ?? [], filters: [OriginFilter.IsNotApiOnly] } },
    pause: !ids
  })
  return data?.originPage?.nodes ?? []
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

/**
 * Where an episode plays or can be watched: stub's own players first, then the sites' own pages.
 * `offers` are media-level handles, linked out for a streaming site the episode itself does not name,
 * which is where a film's offers live.
 */
export const useWatchSources = (
  episode: DetailsEpisode | undefined,
  mediaUri: string,
  offers: readonly Offer[] = []
): WatchSource[] => {
  const links = offers.filter(handle => handle.relation === 'SAME_AS' && handle.node.url && STREAMING_ORIGINS.has(handle.node.origin))
  const origins = useOrigins(episode ? [...new Set([...episodeOriginIds(episode), ...links.map(handle => handle.node.origin)])] : undefined)
  const backend = useBackend()
  return episode ? watchSources(episode, mediaUri, origins, backend, links) : []
}

const watchSources = (
  episode: DetailsEpisode, mediaUri: string, origins: readonly Origin[], backend: FknBackend | undefined, links: readonly Offer[] = []
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
      const multiple = handles.length > 1
      return {
        id: origin.id,
        name: origin.name ?? origin.id,
        icon: origin.icon,
        color: origin.color,
        href: multiple || playable
          ? watchPath
          : (handle?.url ?? links.find(link => link.node.origin === origin.id)?.node.url ?? undefined),
        external: multiple ? false : !playable,
        active: false,
      } satisfies WatchSource
    })
    .filter(source => source.href)
    .sort((a, b) => Number(a.external) - Number(b.external))
    .slice(0, 5)

/**
 * The links to each site that names this media, as icons, unstyled: each view sizes them itself.
 * Nothing until the worker has answered for the media.
 */
export const SourceLinks = (
  { uri, handles }:
  { uri: string | undefined, handles: readonly { relation: string, node: { origin: string, url?: string | null } }[] | undefined }
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
  const [{ data: originData }] = useSubscription({
    query: GET_MEDIA_ORIGINS,
    variables: { input: { ids: originIds, filters: [OriginFilter.IsNotApiOnly] } },
  })
  return (
    <span className="origins">
      {
        originData
          ?.originPage
          ?.nodes
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
            if (!origin.icon) return undefined
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

    &:hover {
      background-color: rgba(255, 255, 255, 0.05);
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
      flex-shrink: 0;
      margin: auto 0;
      height: 7.5rem;
      aspect-ratio: 16 / 9;
      object-fit: cover;
      background-color: rgb(35, 35, 35);
      border-radius: .5rem;
      margin-right: 2.5rem;
      /* decorative only, let the row link under it take hovers and clicks */
      pointer-events: none;
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
  { episode, index, mediaUri, origins, backend, unreleased, airingAt, now }:
  { episode: DetailsEpisode, index: number, mediaUri: string, origins: readonly Origin[], backend: FknBackend | undefined, unreleased: boolean, airingAt?: string, now: number }
) => {
  // one thumbnail per source, score first; a host that refuses this viewer must not blank the row
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set())
  const thumbnail = nextThumbnail(episode.thumbnails, failedThumbnails)
  const releasedAt = releasedAtOf(episode) ?? airingAt
  const airsIn = unreleased && airingAt ? formatCountdown(Date.parse(airingAt) - now) : undefined
  const released = airsIn ? `in ${airsIn}` : releaseDateDisplay(releasedAt)
  const sources = unreleased ? [] : watchSources(episode, mediaUri, origins, backend)

  return (
    <div className={unreleased ? 'episode unreleased' : 'episode'}>
      {
        episode.uri && !unreleased
          ? (
            <Link
              className="episode-link"
              href={getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })}
            />
          )
          : undefined
      }
      <div className="number">{episode.episodeNumber}</div>
      {
        thumbnail
          ? <img className="thumbnail" src={thumbnail} onError={() => setFailedThumbnails(prev => new Set(prev).add(thumbnail))}></img>
          : <div className="thumbnail"></div>
      }
      <div className="content">
        <div className="header">
          <div className="title">{episode.titles?.at(0)?.title ?? (unreleased ? 'Unreleased episode' : `Episode ${index + 1}`)}</div>
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

/**
 * A series' episode rows a page at a time, opening on the page holding episode `start`; an unreleased one
 * dimmed and not linked. With no rows, rows' placeholders until every source has answered, then
 * "No episodes found".
 */
export const Episodes = ({ media, start }: { media: DetailsMedia, start?: number }) => {
  const now = useNow()
  const unreleased = unreleasedEpisodes(media, new Date(now))
  const nextAiring = media.nextAiringEpisode
  // one query for every page's rows, so a page drawn later starts with its sources' icons too
  const origins = useOrigins([...new Set(media.episodes.flatMap(episodeOriginIds))])
  const backend = useBackend()
  if (!media.episodes.length) {
    return media.settled
      ? <div className="episodes" css={episodesStyle}><div className="empty">No episodes found</div></div>
      : <EpisodesPlaceholder count={Math.min(media.episodeCount || 3, EPISODES_PAGE)}/>
  }
  return (
    <Paged items={media.episodes} size={EPISODES_PAGE} label="Episodes" start={start}>
      {(page, offset) => (
        <div className="episodes" css={episodesStyle}>
          {page.map((episode, at) => {
            const index = offset + at
            return (
              <Episode
                key={episode.episodeNumber ?? episode.uri ?? index}
                episode={episode}
                index={index}
                mediaUri={media.uri}
                origins={origins}
                backend={backend}
                unreleased={unreleased[index]!}
                airingAt={episode.episodeNumber === nextAiring?.episodeNumber ? nextAiring?.airingAt : undefined}
                now={now}
              />
            )
          })}
        </div>
      )}
    </Paged>
  )
}
