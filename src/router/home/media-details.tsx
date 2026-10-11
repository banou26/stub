// What the media modal and the title page both draw: one query, the episode rows, where an episode
// plays, and the links to each source. One copy, so the two views cannot drift.

import type { GetMediaDetailsSubscription } from '../../generated/graphql'
import type { WatchSource } from '../../components/source-selector'

import { css } from '@emotion/react'
import { useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link } from 'wouter'

import { OriginFilter } from '../../generated/graphql'
import { gql } from '../../generated'
import TextEllipsis from '../../components/text-ellipsis'
import OriginIcon from '../../components/origin-icon'
import SourceSelector from '../../components/source-selector'
import { MEDIA_TRACKING } from '../../components/media-tracking-query'
import { AggregatedUri, fromAggregatedUri } from '../../utils/uri'
import { firstUnreleased, isUnreleased } from './episodes'
import { nextThumbnail } from '../../utils/thumbnails'
import { getRoutePath, Route } from '../path'
import { releaseDateAttribute, releaseDateDisplay } from '../../utils/release-date'
import { canPlay } from '../../sources/playable'
import { PACKAGE_ORIGIN_MAP } from '../../sources/justwatch/id'
import { episodeOriginIds } from './episode-origins'
import { playTarget, type PlayLabel } from '../title/facts'

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

// The store already merges a date across the sources it folded into this row, so the handle is a
// fallback rather than the path: it covers an episode whose date only one source knows and which
// was not the row merged into. Four sources supply one at all (anizip, Crunchyroll, the bundled
// catalogue and Apple TV), so plenty of episodes have none and the column is simply empty there.
export const releasedAtOf = (episode: DetailsEpisode | undefined) =>
  episode?.releaseDate ?? episode?.handles?.find(handle => handle.node.releaseDate)?.node.releaseDate

/** Which of a media's episodes are not out yet, in the order `episodes` lists them. */
const unreleasedEpisodes = (media: DetailsMedia): boolean[] => {
  const dated = media.episodes.map(episode => ({ episodeNumber: episode.episodeNumber, releaseDate: releasedAtOf(episode) }))
  const first = firstUnreleased({ status: media.status, nextAiringEpisode: media.nextAiringEpisode, episodes: dated })
  return dated.map(episode => isUnreleased(episode, first))
}

/** The Play button of a media: Play, Continue or Rewatch from the viewer's tracking, and the episode it opens. Nothing when that episode is not out. */
export const usePlay = (media: DetailsMedia | null | undefined): { label: PlayLabel, href: string } | undefined => {
  const [{ data: tracking }] = useSubscription({
    query: MEDIA_TRACKING,
    variables: { input: { uri: media?.uri ?? '' } },
    pause: !media?.uri
  })
  if (!media) return undefined
  const unreleased = unreleasedEpisodes(media)
  const target = playTarget(
    media.episodes.map((episode, index) => ({ ...episode, unreleased: unreleased[index]! })),
    tracking?.tracking?.summary
  )
  return target && { label: target.label, href: getRoutePath(Route.WATCH, { mediaUri: media.uri, episodeUri: target.episodeUri }) }
}

const STREAMING_ORIGINS = new Set(Object.values(PACKAGE_ORIGIN_MAP))

/**
 * Where an episode plays or can be watched: stub's own players first, then the sites' own pages.
 * `offers` are media-level handles, linked out for a streaming site the episode itself does not name,
 * which is where a film's offers live.
 */
export const useWatchSources = (
  episode: DetailsEpisode | undefined,
  mediaUri: string,
  offers: readonly { relation: string, node: { origin: string, url?: string | null } }[] = []
): WatchSource[] => {
  const links = offers.filter(handle => handle.relation === 'SAME_AS' && handle.node.url && STREAMING_ORIGINS.has(handle.node.origin))
  const originIds = episode ? [...new Set([...episodeOriginIds(episode), ...links.map(handle => handle.node.origin)])] : undefined
  const [{ data: originData }] = useSubscription({
    query: GET_MEDIA_ORIGINS,
    variables: { input: { ids: originIds ?? [], filters: [OriginFilter.IsNotApiOnly] } },
    pause: !originIds
  })

  if (!episode) return []
  return (originData?.originPage?.nodes ?? [])
    .map(origin => {
      // SAME_AS only. Everything below routes into PLAYBACK: `sourceUri` is handed to the watch route
      // and resolved back to a handle to play, so a node that is merely PART_OF this episode would be
      // asked to play a different episode. No source emits a PART_OF episode handle today; the filter
      // is here so that the day one does, it shows up as a missing row rather than a wrong stream.
      const handles =
        (episode?.handles ?? [])
          .filter(handle => handle.relation === 'SAME_AS' && handle.node.origin === origin.id)
          .map(handle => handle.node)
      const handle = handles.at(0)
      const sourceUri = handle?.uri
      const playable = Boolean(canPlay(origin.id) && handle?.url)
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
}

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

  @media (max-width: 768px) {
    .episode {
      display: grid;
      grid-template-columns: auto auto minmax(0, 1fr);
      align-content: center;
      height: auto;
      min-height: 7rem;
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
            font-size: 1.5rem;
          }
          & > .origins {
            margin-left: 0;
          }
        }
        & > .description {
          font-size: 1.3rem;
          max-height: 4.5rem;
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
  { episode, index, mediaUri, unreleased, airingAt }:
  { episode: DetailsEpisode, index: number, mediaUri: string, unreleased: boolean, airingAt?: string }
) => {
  // one thumbnail per source, score first; a host that refuses this viewer must not blank the row
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set())
  const thumbnail = nextThumbnail(episode.thumbnails, failedThumbnails)
  const releasedAt = releasedAtOf(episode) ?? airingAt
  const released = releaseDateDisplay(releasedAt)
  const sources = useWatchSources(unreleased ? undefined : episode, mediaUri)

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
      {
        episode.titles?.length
          ? (
            <div className="content">
              <div className="header">
                <div className="title">{episode.titles.at(0)?.title}</div>
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
          )
          : (
            <div className="content">
              <div className="header">
                <div className="title">{unreleased ? 'Unreleased episode' : `Episode ${index + 1}`}</div>
              </div>
            </div>
          )
      }
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

/** A series' episode rows, an unreleased one dimmed and not linked (HOR-344). */
export const Episodes = ({ media, limit }: { media: DetailsMedia, limit?: number }) => {
  const unreleased = unreleasedEpisodes(media)
  const nextAiring = media.nextAiringEpisode
  return (
    <div className="episodes" css={episodesStyle}>
      {
        media.episodes.slice(0, limit).map((episode, index) =>
          <Episode
            key={episode.episodeNumber ?? episode.uri ?? index}
            episode={episode}
            index={index}
            mediaUri={media.uri}
            unreleased={unreleased[index]!}
            airingAt={episode.episodeNumber === nextAiring?.episodeNumber ? nextAiring?.airingAt : undefined}
          />
        )
      }
    </div>
  )
}
