import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'
import type { RouteParams } from '../path'

import { css } from '@emotion/react'
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useSubscription } from 'urql'
import { Link, Redirect, useLocation, useParams, useSearch } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import { LucidePause, LucidePlay } from 'lucide-react'
import VolumeControl from '../../components/volume-control'
import Collapsible from '../../components/collapsible'
import MediaRelations from '../../components/media-relations'
import MediaSeasons from '../../components/media-seasons'
import MediaFranchise from '../../components/media-franchise'
import MediaTracking from '../../components/media-tracking'
import ModalBackdrop from '../../components/modal-backdrop'
import Placeholder, { PlaceholderLines } from '../../components/placeholder'
import TraceLink from '../debug/link'
import { carriedSearch } from '../debug/trace'
import { AggregatedUri, asAggregatedUri, matchAggregatedUris, decodeRouteUri, shouldGrowAddress } from '../../utils/uri'
import { currentMedia, listedMediaFor } from './modal-media'
import { isMovieMedia } from './movie'
import MoviePlay from './movie-play'
import { Episodes, EpisodesPlaceholder, GET_MEDIA_DETAILS, SourceLinks, useTrackingSummary } from './media-details'
import { getRoutePath, Route } from '../path'
import { useCoverUrl } from '../../utils/use-cover-url'
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
  /* it takes the focus on open (see ModalBackdrop), and a box is not a control to ring */
  outline: none;

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
    position: relative;
    overflow: hidden;
    aspect-ratio: 16 / 9;
    background-size: cover;
    /* the cover fallback is a portrait poster: its faces sit in the top third, not the middle band */
    background-position: center 20%;
    .player {
      border-radius: 1rem 1rem 0 0;
      overflow: hidden;
      user-select: none;
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
      /* the source icons' height, so the header is one height before and after they land */
      min-height: 4rem;

      & > .title {
        font-size: 3rem;
        font-weight: 600;
        cursor: default;
      }

      & > .title-pending {
        align-self: center;
        width: 30rem;
        height: 3.6rem;
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
          & > .letter {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 4rem;
            width: 4rem;
            border-radius: 0.6rem;
            background: rgba(255, 255, 255, 0.1);
            font-size: 1.8rem;
            font-weight: 700;
          }
        }
      }

      & > .more {
        align-self: center;
        margin-left: auto;
        padding: 0.8rem 1.4rem;
        border-radius: 0.6rem;
        border: 0.1rem solid rgba(255, 255, 255, 0.18);
        background: rgba(255, 255, 255, 0.05);
        color: #fff;
        font-size: 1.4rem;
        font-weight: 600;
        text-decoration: none;
        white-space: nowrap;
      }

      & > .more:hover { background: rgba(255, 255, 255, 0.12); }
    }

    & > .movie {
      display: flex;
      flex-direction: column;
      gap: 1.4rem;
      margin: 1rem 0 2rem;

      & > .facts {
        font-size: 1.5rem;
        color: rgba(255, 255, 255, 0.65);
      }

      & > .play-bar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem 1.6rem;

        & > .play {
          display: inline-flex;
          align-items: center;
          gap: 0.8rem;
          height: 4.4rem;
          padding: 0 2.4rem 0 2rem;
          border-radius: 0.6rem;
          background: #fff;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1);
          color: #000;
          font-size: 1.7rem;
          font-weight: 700;
          text-decoration: none;
        }

        & > .play:hover { background: rgba(255, 255, 255, 0.85); }
        & > .play:focus-visible { outline: 2px solid rgba(255, 255, 255, 0.8); outline-offset: 2px; }

        & > .when {
          font-size: 1.5rem;
          color: rgba(255, 255, 255, 0.8);
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

    /* the collapsed description's size, five lines in it */
    & > .description.pending {
      height: 20rem;
      font-size: 1.6rem;
    }

    & > .seasons, & > .episode-list {
      margin-top: 4rem;
    }
  }
}

@media (max-width: 768px) {
  padding: 4rem 0.6rem;

  .modal {
    .trailer {
      .player-controls {
        padding: 1.5rem;
      }
    }

    & > .content {
      padding: 1.5rem;

      & > .header {
        flex-wrap: wrap;
      }

      /* a line of its own, so the source icons landing beside it never wrap the header to a second */
      & > .header > .title {
        flex-basis: 100%;
        font-size: 2.2rem;
      }

      & > .header > .title-pending {
        width: 60%;
        height: 2.6rem;
        margin-right: 40%;
      }

      /* and the icons scroll beside More details rather than wrapping it to a third line as they land,
         fading at the edge so a row cut between two icons still shows there are more */
      & > .header > .origins {
        flex: 1 1 0;
        min-width: 0;
        overflow-x: auto;
        scrollbar-width: none;
        mask-image: linear-gradient(to right, #000 calc(100% - 3rem), transparent);
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

      & > .seasons, & > .episode-list {
        margin-top: 2.5rem;
      }
    }
  }
}
`

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

  const [{ data, operation }] = useSubscription({
    query: GET_MEDIA_DETAILS,
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
  const current = currentMedia({ data, operation }, uri)
  const title = useMemo(() => media?.titles?.at(0)?.title, [media])
  const isMovie = Boolean(data?.media && isMovieMedia(data.media))
  const tracked = useTrackingSummary(data?.media?.uri)
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
  const coverUrl = useCoverUrl(media?.covers, media)

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
  const search = carriedSearch(useSearch())

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
    /* `data-party-scroll`: this overlay locks the body and scrolls inside itself, so the watch party
       has to follow THIS box rather than the frozen page (see components/party-sync.tsx). */
    <ModalBackdrop data-party-scroll css={style} onClose={() => onOpenChange(false)}>
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
                ? <LucidePlay className="icon-outline" size={30} strokeWidth={3} stroke="black" onClick={() => setPlayerPaused(false)} />
                : <LucidePause className="icon-outline" size={30} strokeWidth={3} stroke="black" onClick={() => setPlayerPaused(true)} />
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
          {title || current?.settled ? <span className="title">{title}</span> : <Placeholder className="title-pending"/>}
          {/* 7.5's trace, behind `?trace=1`: nothing at all without the flag. The uri is the
              address the store has grown to, which is the one the graph knows this work by. */}
          <TraceLink uri={media?.uri}/>
          <SourceLinks uri={data?.media?.uri} handles={media?.handles}/>
          <Link className="more" href={`${getRoutePath(Route.TITLE, { uri: media?.uri ?? params.uri })}${search}`}>More details</Link>
        </div>
        {
          isMovie && media
            ? (
              <MoviePlay
                episode={'episodes' in media ? media.episodes?.at(0) : undefined}
                mediaUri={media.uri}
                handles={media.handles}
                startDate={'startDate' in media ? media.startDate : undefined}
                genres={'genres' in media ? media.genres : undefined}
              />
            )
            : undefined
        }
        <MediaTracking
          work={uri}
          address={params.uri}
          uri={current?.uri}
          title={title}
          cover={coverUrl}
          episodeCount={current?.episodeCount}
          movie={isMovie}
        />
        {
          description
            ? (
              <Collapsible collapsedHeight={200} className="description">
                <div dangerouslySetInnerHTML={{ __html: description }}/>
              </Collapsible>
            )
            : current?.settled ? undefined : <PlaceholderLines count={5} className="description pending"/>
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
        <MediaSeasons
          seasons={data?.media?.seasons}
          currentUris={data?.media?.handles.map(handle => handle.node.uri) ?? []}
          href={uri => `${getRoutePath(Route.MEDIA, { uri })}${search}`}
        />
        {
          isMovie || !data?.media ? undefined : (
            <div className="episode-list">
              {current ? <Episodes key={uri} media={current} tracked={tracked}/> : <EpisodesPlaceholder/>}
            </div>
          )
        }
      </div>
    </ModalBackdrop>
  )
}

export default MediaModal
