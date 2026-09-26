import type { GetMediaModalSubscription, GetReleasingMediaPageSubscription } from '../../generated/graphql'
import type { Episode } from '../../generated/schema/types.generated'
import type { RouteParams } from '../path'
import type { WatchSource } from '../../components/source-selector'

import { css } from '@emotion/react'
import {
  FloatingFocusManager, FloatingOverlay, FloatingPortal,
  useClick, useFloating, useInteractions
} from '@floating-ui/react'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link, Redirect, useLocation, useParams } from 'wouter'

import { MediaCategory, MediaDescriptionContentType, OriginFilter } from '../../generated/graphql'
import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import { LucidePause, LucidePlay } from 'lucide-react'
import VolumeControl from '../../components/volume-control'
import TextEllipsis from '../../components/text-ellipsis'
import Collapsible from '../../components/collapsible'
import MediaRelations from '../../components/media-relations'
import MediaFranchise from '../../components/media-franchise'
import MediaTracking from '../../components/media-tracking'
import TraceLink from '../debug/link'
import { gql } from '../../generated'
import { AggregatedUri, asAggregatedUri, fromAggregatedUri, isUri, matchAggregatedUris, decodeRouteUri, shouldGrowAddress } from '../../utils/uri'
import { listedMediaFor } from './modal-media'
import { nextThumbnail } from '../../utils/thumbnails'
import { getRoutePath, Route } from '../path'
import { releaseDateAttribute, releaseDateDisplay } from '../../utils/release-date'
import { canPlay } from '../../sources/playable'
import SourceSelector from '../../components/source-selector'
import { useCoverUrl } from '../../utils/use-cover-url'
import { episodeOriginIds } from './episode-origins'
import { layer } from '../../layers'

const style = css`
z-index: ${layer.mediaModal};
padding: 5rem 1rem;
background-color: hsla(0, 0%, 0%, 0.439);
animation: overlayShow 150ms cubic-bezier(0.16, 1, 0.3, 1);

@media (min-width: 1024px) {
    padding: 5rem 1rem;
}
@media (min-width: 1440px) {
    padding: 5rem 4rem;
}

.modal {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 80rem;
  background-color: rgb(35, 35, 35);
  border-radius: 1rem;
  box-shadow: hsl(206 22% 7% / 35%) 0px 10px 38px -10px, hsl(206 22% 7% / 20%) 0px 10px 20px -15px;
  overflow: hidden;
  margin: auto;

  @media (min-width: 1024px) {
      max-width: 100rem;
  }
  @media (min-width: 1440px) {
      max-width: 130rem;
  }
  @media (min-width: 2560px) {
      max-width: 180rem;
  }


  .trailer {
    --yt-top-margin: -24.5rem;
    --yt-height: 150.25rem;
    --trailer-height: 101rem;
    position: relative;
    overflow: hidden;
    height: var(--trailer-height);
    background-size: cover;
    background-position: center;
    .player {
      border-radius: 1rem 1rem 0 0;
      overflow: hidden;
      height: var(--trailer-height);
      user-select: none;

      youtube-video {
        grid-area: container;
        pointer-events: none;
        margin-top: var(--yt-top-margin) !important;
        height: var(--yt-height) !important;
      }
    }
    .player-controls {
      position: absolute;
      bottom: 0rem;
      padding: 2.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;

      & > span {
        position: relative;
        width: 3rem;
        height: 3rem;
        cursor: pointer;

        .icon-body {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
        .icon-outline {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
        }
      }
    }
  }

  & > .content {
    padding: 2.5rem;
    & > .header {
      display: flex;
      gap: 1rem;

      & > .title {
        font-size: 3rem;
        font-weight: 600;
        cursor: default;
      }

      & > .origins {
        display: flex;
        gap: 1rem;
        align-items: center;

        & > .origin {
          height: 4rem;
          & > img {
            height: 4rem;
            width: 4rem;
          }
        }
      }
    }

    & > .description {
      white-space: pre-wrap;
      margin-top: 2.5rem;
      cursor: default;

      &.collapsed {
        max-height: 20rem;
      }
    }

    .episodes {
      margin-top: 4rem;
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
          /*align-items: center;*/
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
    }
  }
}

@media (max-width: 768px) {
  padding: 4rem 0.6rem;

  .modal {
    .trailer {
      /* The desktop crop is fixed-rem, tuned for an 80rem modal; on a full-width
         mobile modal retune it in vw so the same crop ratio tracks the width. */
      --trailer-height: 64vw;
      --yt-height: 95vw;
      --yt-top-margin: -15.5vw;

      .player-controls {
        padding: 1.5rem;
      }
    }

    & > .content {
      padding: 1.5rem;

      & > .header > .title {
        font-size: 2.2rem;
      }

      & > .header > .origins > .origin {
        height: 3rem;
        & > img {
          height: 3rem;
          width: 3rem;
        }
      }

      & > .description {
        margin-top: 1.5rem;
        font-size: 1.4rem;
      }

      .episodes {
        margin-top: 2.5rem;

        .episode {
          height: auto;
          min-height: 7rem;
          padding: 0.8rem 0;

          .number {
            min-width: 3.5rem;
            font-size: 1.6rem;
          }

          .thumbnail {
            height: 5rem;
            margin-right: 1rem;
          }

          .content {
            & > .header > .title {
              font-size: 1.5rem;
            }
            & > .description {
              font-size: 1.3rem;
              max-height: 4.5rem;
            }
          }
        }
      }
    }
  }
}
`

const GET_MEDIA_MODAL = gql(`
  subscription GetMediaModal($input: MediaInput!, $descriptionInput: MediaDescriptionInput!) {
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
    }
  }
`)

const GET_MEDIA_MODAL_ORIGINS = gql(`
  subscription GetMediaModalOrigins($input: OriginPageInput!) {
    originPage(input: $input) {
      nodes {
        ...OriginFragment
      }
    }
  }
`)

const Episode = (
  { episode, index, mediaUri, isMovie }:
  { episode: NonNullable<GetMediaModalSubscription['media']>['episodes'][number], index: number, mediaUri: string, isMovie?: boolean }
) => {
  // one thumbnail per source, score first; a host that refuses this viewer must not blank the row
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(() => new Set())
  const thumbnail = nextThumbnail(episode.thumbnails, failedThumbnails)
  // The store already merges a date across the sources it folded into this row, so the handle is a
  // fallback rather than the path: it covers an episode whose date only one source knows and which
  // was not the row merged into. Four sources supply one at all (anizip, Crunchyroll, the bundled
  // catalogue and Apple TV), so plenty of episodes have none and the column is simply empty there.
  const releasedAt = episode.releaseDate ?? episode.handles?.find(handle => handle.node.releaseDate)?.node.releaseDate
  const released = releaseDateDisplay(releasedAt)
  const originIds = episodeOriginIds(episode)
  const [{ data: originData }] = useSubscription({
    query: GET_MEDIA_MODAL_ORIGINS,
    variables: { input: { ids: originIds, filters: [OriginFilter.IsNotApiOnly] } },
    pause: !originIds
  })

  const sources: WatchSource[] = (originData?.originPage?.nodes ?? [])
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
      // several releases always route inward with no sourceUri, so the user picks on the watch page
      const watchPath =
        episode.uri
          ? handles.length > 1
            ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })
            : sourceUri
              ? getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri, sourceUri })
              : undefined
          : undefined
      const multiple = handles.length > 1
      return {
        id: origin.id,
        name: origin.name ?? origin.id,
        icon: origin.icon,
        color: origin.color,
        href: multiple ? watchPath : playable ? watchPath : (handle?.url ?? undefined),
        external: multiple ? false : !playable,
        active: false,
      } satisfies WatchSource
    })
    .filter(source => source.href)
    .sort((a, b) => Number(a.external) - Number(b.external))
    .slice(0, 5)

  return (
    <div className="episode">
      {
        episode.uri
          ? (
            <Link
              className="episode-link"
              href={getRoutePath(Route.WATCH, { mediaUri, episodeUri: episode.uri })}
            />
          )
          : undefined
      }
      {isMovie ? undefined : <div className="number">{episode.episodeNumber}</div>}
      {
        thumbnail
          ? <img className="thumbnail" src={thumbnail} onError={() => setFailedThumbnails(prev => new Set(prev).add(thumbnail))}></img>
          : <div className="thumbnail"></div>
      }
      {
        isMovie
          ? (
            <div className="content">
              <div className="header">
                <div className="title">Play</div>
                <span className="origins">
                  <SourceSelector compact sources={sources} />
                </span>
              </div>
            </div>
          )
          : episode.titles?.length
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
                <div className="title">Episode {index + 1}</div>
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

const MediaModal = ({ mediaNodes }: { mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }) => {
  const rawParams = useParams<RouteParams['MEDIA']>()
  // wouter hands the segment through undecoded, and an encoded uri is a page that never subscribes
  const params = { ...rawParams, uri: decodeRouteUri(rawParams.uri) }
  const [, navigate] = useLocation()
  // The listing is a SOURCE OF DRAWING, never the gate: `namesSameWork` asks whether the address and
  // a card share a source handle, because a shared link names whatever sources the store had folded
  // in when it was copied and the card names whatever it has now. Compared for equality the two are
  // different works, and the modal opened over a blank box (open problem 22).
  const foundMedia = listedMediaFor(params.uri, mediaNodes)

  const [uri, setUri] = useState(params.uri)
  useEffect(() => {
    // BOTH SPELLINGS, since a one-source page is addressed `mal:39535` by an old bookmark or party
    // link and `ag:(mal:39535)` by every address the store mints now that the singleton path is gone.
    // Compared as written the two are different works, so the subscription would restart on a
    // navigation that changed nothing.
    setUri(prev =>
      prev && matchAggregatedUris(asAggregatedUri(prev) as AggregatedUri, asAggregatedUri(params.uri ?? '') as AggregatedUri)
        ? prev
        : params.uri
    )
  }, [params.uri])

  const [{ data }] = useSubscription({
    query: GET_MEDIA_MODAL,
    variables: {
      input: {
        uri
      },
      descriptionInput: {
        type: MediaDescriptionContentType.Html
      }
    },
    pause: !uri
  })
  const media = data?.media ?? foundMedia
  const origins =
    data?.media?.uri
      ? fromAggregatedUri(data.media.uri as AggregatedUri)?.handleUrisValues
      : undefined
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
      ...media?.handles?.map(handle => handle.node.origin) ?? [],
    ])
  ]
  const [{ data: originData }] = useSubscription({
    query: GET_MEDIA_MODAL_ORIGINS,
    variables: { input: { ids: originIds!, filters: [OriginFilter.IsNotApiOnly] } },
    pause: !originIds
  })
  const title = useMemo(() => media?.titles?.at(0)?.title, [media])
  const description = useMemo(
    () =>
      media
      && 'descriptions' in media
      && (
        media
          .descriptions
          .sort((desc1, desc2) => desc2.description.length - desc1.description.length)
          ?.at(0)
          ?.description
      ),
    [media]
  )
  const coverUrl = useCoverUrl(media?.covers)

  const [bannedTrailerUris, setBannedTrailerUris] = useState<string[]>([])
  const [pinnedTrailerUri, setPinnedTrailerUri] = useState<string>()
  const selectedTrailer = useMemo(
    () => {
      const trailers = (media?.trailers ?? []).filter((trailer) => !bannedTrailerUris.includes(trailer.uri))
      return trailers.find(trailer => trailer.uri === pinnedTrailerUri) ?? trailers.at(0)
    },
    [media?.trailers, bannedTrailerUris, pinnedTrailerUri]
  )

  useEffect(() => {
    if (selectedTrailer?.uri && selectedTrailer.uri !== pinnedTrailerUri) setPinnedTrailerUri(selectedTrailer.uri)
  }, [selectedTrailer?.uri, pinnedTrailerUri])

  const onTrailerError = useCallback(() => {
    if (!selectedTrailer) return
    setBannedTrailerUris([...bannedTrailerUris, selectedTrailer.uri])
  }, [selectedTrailer, bannedTrailerUris])

  // THE ROUTE IS WHAT OPENS THIS, and nothing else gets a vote. Not `foundMedia`, since a link to a
  // work the current season listing does not carry is still a link to a work the store answers for,
  // and not `params.uri` either: on a browser popstate this renders a beat before wouter's `<Switch>`
  // does, holding the previous route's empty params, so gating on the uri would redirect home on
  // every back and forward (see `fromAggregatedUri` in utils/uri.ts).
  const [open, onOpenChange] = useState(true)
  const { refs, context } = useFloating({
    open,
    onOpenChange: (_, ev) => {
      if (ev?.target !== refs.reference.current) return
      onOpenChange(false)
    }
  })
  const click = useClick(context)
  const {getReferenceProps, getFloatingProps} = useInteractions([click])

  const [playerPaused, setPlayerPaused] = useState(false)
  const [playerMuted, setPlayerMuted] = useState(true)
  const [playerVolume, setPlayerVolume] = useState(0.25)

  // The address grows as the store folds more sources into the cluster, so a page opened knowing one
  // source ends up at the uri naming all of them.
  //
  // ONLY WHEN THE MEDIA IN HAND IS THE WORK THE ADDRESS NAMES, which the length comparison alone does
  // not establish. On a navigation the address changes first and `media` is still the PREVIOUS work
  // for a beat, so a link to a work known through one source ran this with the old cluster's eight
  // handles against the new address's one, decided the address had shrunk, and replaced it with the
  // page you were leaving. Clicking a relation or a graph node did nothing at all, twice out of twice
  // (measured 2026-09-09); before these linked to a bare source uri the guard above happened to hide
  // it, since a bare uri is not aggregated and the effect returned early.
  useEffect(() => {
    if (shouldGrowAddress(media?.uri, params.uri)) {
      // THE QUERY STRING COMES ALONG. This replace is the reason a media url loses its flags: opened
      // at `/media/...?graph=1&trace=1`, the address grows a beat later and the url it is replaced
      // with carried the path alone, so `location.search` was empty for the rest of the session and
      // the url a reader copied out of the address bar no longer reproduced their page (measured
      // 2026-09-13). The flags the worker read at load are unaffected, which is what made this
      // invisible.
      navigate(`${getRoutePath(Route.MEDIA, { uri: media!.uri })}${location.search}`, { replace: true })
    }
  }, [media?.uri, params.uri])

  if (!open) return <Redirect to="/" />

  return (
    <FloatingPortal>
      {/* `data-party-scroll`: this overlay locks the body and scrolls inside itself, so the watch
          party has to follow THIS box rather than the frozen page (see components/party-sync.tsx). */}
      <FloatingOverlay lockScroll data-party-scroll css={style} ref={refs.setReference} {...getReferenceProps()}>
        <FloatingFocusManager context={context}>
          <div className="modal" ref={refs.setFloating} {...getFloatingProps()}>
            <div className="trailer" style={!selectedTrailer?.url && coverUrl ? { backgroundImage: `url(${coverUrl})` } : {}}>
              {
                selectedTrailer?.url
                  ? (
                    <YoutubeMinimalPlayer
                      key={selectedTrailer.url}
                      url={selectedTrailer.url}
                      className="player"
                      onError={onTrailerError}
                      paused={playerPaused}
                      volume={playerMuted ? 0 : playerVolume}
                    />
                  )
                  : undefined
              }
              <div className={`player-controls ${!selectedTrailer?.url ? 'hidden' : ''}`}>
                <span className="playback">
                  {
                    playerPaused
                      ? <LucidePlay className="icon-outline" size={30} strokeWidth={3} color="black" onClick={() => setPlayerPaused(false)} />
                      : <LucidePause className="icon-outline" size={30} strokeWidth={3} color="black" onClick={() => setPlayerPaused(true)} />
                  }
                  {
                    playerPaused
                      ? <LucidePlay className="icon-body" size={30} onClick={() => setPlayerPaused(false)}/>
                      : <LucidePause className="icon-body" size={30} onClick={() => setPlayerPaused(true)}/>
                  }
                </span>
                <VolumeControl
                  defaultMuted={playerMuted}
                  onMutedUpdate={setPlayerMuted}
                  defaultVolume={playerVolume}
                  onVolumeUpdate={volume => setPlayerVolume(volume)}
                />
              </div>
            </div>
            <div className="content">
              <div className="header">
                <span className="title">{title}</span>
                {/* 7.5's trace, behind `?trace=1`: nothing at all without the flag. The uri is the
                    address the store has grown to, which is the one the graph knows this work by. */}
                <TraceLink uri={media?.uri}/>
                <span className="origins">
                  {
                    originData
                      ?.originPage
                      ?.nodes
                      ?.map(origin => {
                        // BOTH RELATIONS, deliberately, and this row is the whole point of the
                        // refactor. It wants a url and an origin and nothing else: no sameness is
                        // assumed and nothing is merged across it. A PART_OF handle is exactly as
                        // good here as a SAME_AS one, which is why IMDb can finally render as a link
                        // rather than the dead grey icon in the branch below.
                        // SAME_AS FIRST, then anything. `handles` is ordered by score, which says
                        // nothing about relation, so a plain `find` could hand the Crunchyroll icon a
                        // PART_OF `cr:<seriesId>` while the SAME_AS `cr:<seriesId>-<seasonId>` for
                        // this very cour sat later in the list.
                        const forOrigin =
                          media?.handles.filter(handle => handle.node.origin === origin.id && handle.node.url) ?? []
                        const link =
                          (forOrigin.find(handle => handle.relation === 'SAME_AS') ?? forOrigin.at(0))
                            ?.node.url
                        if (!origin.icon) return undefined
                        return (
                          link
                            ? (
                              <a className="origin" href={link} target="_blank" rel="noreferrer" title={origin.name}>
                                <img src={origin.icon}/>
                              </a>
                            )
                            : (
                              <div className="origin">
                                <img src={origin.icon}/>
                              </div>
                            )
                        )
                      })
                      .filter(Boolean)
                  }
                </span>
              </div>
              {/* on the address the store has grown to, so the trackers are asked again as the media
                  gains ids; nothing until the worker has answered for this media at all */}
              <MediaTracking
                uri={data?.media?.uri}
                title={title}
                cover={coverUrl}
                episodeCount={data?.media?.episodeCount}
              />
              {
                description
                  ? (
                    <Collapsible collapsedHeight={200} className="description">
                      <div dangerouslySetInnerHTML={{ __html: description }}/>
                    </Collapsible>
                  )
                  : undefined
              }
              <MediaRelations
                relations={media && 'relations' in media ? media.relations ?? [] : []}
                action={
                  <MediaFranchise
                    franchise={media && 'franchise' in media ? media.franchise : undefined}
                    /* every uri this cluster answers to, so the node the reader is on is the one
                       marked, whichever of its sources named it in the graph */
                    currentUris={media?.handles?.map(handle => handle.node.uri) ?? []}
                  />
                }
              />
              <div className="episodes">
                {
                  media &&
                  'episodes' in media &&
                  media
                    .episodes
                    ?.map((episode, index) =>
                      <Episode
                        key={episode.episodeNumber ?? episode.uri ?? index}
                        episode={episode}
                        index={index}
                        mediaUri={media.uri}
                        isMovie={'categories' in media && media.categories?.includes(MediaCategory.Movie)}
                      />
                    )
                }
              </div>
            </div>
          </div>
        </FloatingFocusManager>
      </FloatingOverlay>
    </FloatingPortal>
  )
}

export default MediaModal
