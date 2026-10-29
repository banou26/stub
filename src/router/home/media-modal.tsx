import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'
import type { RouteParams } from '../path'
import type { DetailsMedia } from './media-details'

import { css } from '@emotion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import { useSubscription } from 'urql'
import { Link, Redirect, useLocation, useParams, useSearch } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import { LucidePause, LucidePlay, LucideStar } from 'lucide-react'
import VolumeControl from '../../components/volume-control'
import Collapsible from '../../components/collapsible'
import MediaRelations from '../../components/media-relations'
import MediaSeasons, { firstSeasonRedirect } from '../../components/media-seasons'
import MediaFranchise from '../../components/media-franchise'
import MediaTracking from '../../components/media-tracking'
import ModalBackdrop from '../../components/modal-backdrop'
import Placeholder, { PlaceholderLines } from '../../components/placeholder'
import TraceLink from '../debug/link'
import ShareButton from '../../components/share-button'
import { carriedSearch } from '../debug/trace'
import { AggregatedUri, matchAggregatedUris, routeMediaUri, shouldRewriteAddress } from '../../utils/uri'
import { currentMedia, listedMediaFor } from './modal-media'
import { isMovieMedia } from './movie'
import MoviePlay, { FilmSources } from './movie-play'
import { Episodes, EpisodesPlaceholder, GET_MEDIA_DETAILS, SourceLinks, useSettledOnce, useTrackingSummary, useWatchSources, watchOriginIds } from './media-details'
import { filmFacts, filmLine, seriesFacts, seriesLine } from './preview-facts'
import { getRoutePath, Route } from '../path'
import { useNow } from '../../utils/use-now'
import { headerImages, useCoverUrl } from '../../utils/use-cover-url'
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
    /* darker behind the title over its foot */
    &::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(to top, rgb(35, 35, 35) 0%, rgba(35, 35, 35, 0.9) 20%, rgba(35, 35, 35, 0.3) 50%, transparent 70%),
        linear-gradient(to right, rgba(0, 0, 0, 0.5) 0%, transparent 55%);
    }
    .player-controls {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 1;
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

  /* the poster, line and title over the foot of the trailer, a film's date or Play under them */
  & > .hero {
    display: grid;

    /* one cell, so a block taller than the picture grows the hero rather than being cut at the modal's top */
    & > .trailer, & > .over {
      grid-area: 1 / 1;
    }

    & > .trailer {
      align-self: start;
    }

    & > .over {
      align-self: end;
      position: relative;
      z-index: 1;
      display: flex;
      align-items: flex-end;
      gap: 2.8rem;
      padding: 0 4rem 3.2rem;
    }

    /* the poster spans both rows and the first takes its extra height, so its foot is level with Play's row and the
       title sits right on the date or Play however short the two are */
    &.film > .over {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: 1fr auto;
      align-items: end;
      gap: 1.6rem 0;

      & > .poster {
        grid-row: 1 / 3;
        margin-right: 2.8rem;
      }

      & > .stack, & > .movie {
        grid-column: 2;
      }
    }

    .poster {
      flex-shrink: 0;
      width: 17rem;
      aspect-ratio: 2 / 3;
      object-fit: cover;
      border-radius: 0.8rem;
      border: 0.1rem solid rgba(255, 255, 255, 0.15);
      box-shadow: 0 1.2rem 3rem rgba(0, 0, 0, 0.6);
    }

    .stack {
      display: flex;
      flex-direction: column;
      gap: 1.2rem;
      min-width: 0;
      max-width: 86rem;
    }

    .line {
      font-size: 1.5rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.8);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
    }

    .title {
      margin: 0;
      font-size: 5.6rem;
      line-height: 1.05;
      font-weight: 800;
      text-shadow: 0 2px 12px rgba(0, 0, 0, 0.5);
    }

    .title-pending {
      width: 40rem;
      max-width: 100%;
      height: calc(5.6rem * 1.05);
    }
  }

  .movie {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1.6rem;
    min-width: 0;

    & > .release {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.6rem;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);

      & > .day {
        font-size: 4.8rem;
        font-weight: 800;
        line-height: 1.05;
        text-transform: uppercase;
      }

      /* a year, a month or Coming soon */
      & > .day.partial {
        text-transform: none;
      }

      & > .date {
        font-size: 1.8rem;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.85);
      }

      & > .count {
        margin-top: 0.4rem;
        padding: 0.4rem 1rem;
        border-radius: 0.4rem;
        background: rgb(229, 9, 20);
        font-size: 1.4rem;
        font-weight: 800;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        text-shadow: none;
      }
    }

    /* Play and the tracking share a row, wrapping onto two when both do not fit */
    & > .actions {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 1rem 1.6rem;
      max-width: 100%;

      & > .play {
        display: inline-flex;
        align-items: center;
        justify-content: center;
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

      /* Play's place while a source may still bring it */
      & > .play-pending {
        width: 11rem;
        height: 4.4rem;
        border-radius: 0.6rem;
      }

      /* the tracking's 3.4rem controls on Play's 4.4rem middle */
      & > .tracking-compact {
        margin-top: 0.5rem;
      }

      & > .tracking-compact .row, & > .tracking-compact .platforms {
        justify-content: flex-start;
      }

      /* a note wraps to the controls' width, or a long one widens the tracking and drops it under Play */
      & > .tracking-compact > .notes {
        contain: inline-size;
      }

      & > .stub-list-notice {
        flex-basis: 100%;
        margin-top: 0;
      }
    }
  }

  & > .content {
    padding: 3rem 4rem 4rem;

    /* the description's column and the facts', whose class names the episode rows below use too */
    & > .columns {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 36rem;
      gap: 5rem;
      align-items: start;

      & > .main {
        display: flex;
        flex-direction: column;
        gap: 2.4rem;
        min-width: 0;
      }

      & > .side {
        display: flex;
        flex-direction: column;
        gap: 1.6rem;
        min-width: 0;
      }

      .tracking-compact {
        margin-top: 0;
      }

      & > .main > .tracking-compact .row, & > .main > .tracking-compact .platforms {
        justify-content: flex-start;
      }

      & > .main > .description {
        white-space: pre-wrap;
        cursor: default;

        &.collapsed {
          max-height: 20rem;
        }
      }

      /* the collapsed description's size, five lines in it */
      & > .main > .description.pending {
        height: 20rem;
        font-size: 1.6rem;
      }

      /* a card a service, each about two thirds of the watch page's, and at least two to a line: under 1024 px the facts
         leave the description 26 to 31rem */
      & > .main > .sources {
        --picture: 11rem;
        --body: 5.6rem;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(16rem, calc(50% - 1rem)), 1fr));
        gap: 1rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      & > .main > .sources .source {
        display: flex;
        flex-direction: column;
        border-radius: 0.8rem;
        overflow: hidden;
        background: rgb(28, 28, 30);
        color: #fff;
        text-decoration: none;

        &:hover { outline: 0.2rem solid color-mix(in srgb, var(--brand) 60%, transparent); }
        &:focus-visible { outline: 0.2rem solid rgba(255, 255, 255, 0.8); outline-offset: 0.2rem; }

        .picture {
          position: relative;
          display: block;
          height: var(--picture);
          background: rgb(40, 40, 40);

          &::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(to top, rgba(0, 0, 0, 0.6), transparent 55%);
          }

          & > .still {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          & > .logo {
            position: absolute;
            left: 0.8rem;
            bottom: 0.8rem;
            z-index: 1;
            box-shadow: 0 0.3rem 0.8rem rgba(0, 0, 0, 0.5);
          }
        }

        /* no picture of its own: its logo, large, on its own colour */
        .picture.logo-led {
          display: flex;
          align-items: center;
          justify-content: center;
          background:
            radial-gradient(90% 120% at 50% 100%, color-mix(in srgb, var(--brand) 45%, transparent), transparent 70%),
            color-mix(in srgb, var(--brand) 14%, rgb(28, 28, 30));

          &::after { display: none; }

          & > .logo {
            position: static;
            width: 5.2rem;
            height: 5.2rem;
            border-radius: 1.1rem;
            font-size: 2.4rem;
          }
        }

        .logo {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 3rem;
          height: 3rem;
          border-radius: 0.6rem;
          overflow: hidden;
          background: rgba(255, 255, 255, 0.12);
          font-size: 1.4rem;
          font-weight: 700;

          & > img {
            box-sizing: border-box;
            width: 100%;
            height: 100%;
            padding: 12%;
            object-fit: contain;
          }
        }

        /* JustWatch's logos are whole app tiles, drawn edge to edge */
        .logo.sharp {
          background: none;
          & > img {
            padding: 0;
            object-fit: cover;
          }
        }

        .mark {
          position: absolute;
          right: 0.8rem;
          bottom: 0.8rem;
          z-index: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 2.4rem;
          height: 2.4rem;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.92);
          color: #000;
          font-size: 1.1rem;
        }

        .body {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 0.2rem;
          height: var(--body);
          padding: 0 1rem;
        }

        .head {
          display: flex;
          align-items: center;
          gap: 0.6rem;
          min-width: 0;
        }

        .name, .how {
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .name {
          font-size: 1.4rem;
          font-weight: 700;
        }

        .count {
          flex-shrink: 0;
          padding: 0 0.6rem;
          border-radius: 0.4rem;
          background: rgba(255, 255, 255, 0.1);
          font-size: 1.1rem;
          font-weight: 700;
        }

        .how {
          font-size: 1.2rem;
          color: rgba(255, 255, 255, 0.6);
        }
      }

      & > .main > .sources .source-pending {
        height: calc(var(--picture) + var(--body));
        border-radius: 0.8rem;
      }

      & > .main > .none {
        margin: 0;
        font-size: 2rem;
        font-weight: 700;
        color: rgba(255, 255, 255, 0.75);
      }

      & > .side > .score {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 1.5rem;
        font-weight: 700;
        color: #f5c518;
      }

      & > .side > .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 0.6rem;

        & > .chip {
          display: inline-flex;
          align-items: center;
          max-width: 100%;
          height: 2.8rem;
          padding: 0 1.1rem;
          border-radius: 0.6rem;
          font-size: 1.3rem;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        & > .genre { background: rgba(255, 255, 255, 0.12); color: #fff; }
        & > .tag { background: rgba(255, 255, 255, 0.04); color: rgba(255, 255, 255, 0.7); }
      }

      & > .side > .facts {
        display: flex;
        flex-direction: column;
        gap: 1.2rem;
        margin: 0;
        font-size: 1.5rem;
        line-height: 1.5;

        dt {
          color: rgba(255, 255, 255, 0.55);
          font-size: 1.3rem;
        }

        dd {
          margin: 0;
          overflow-wrap: anywhere;
        }
      }

      .links {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1.2rem;
      }

      .links > .origins {
        display: flex;
        flex-wrap: wrap;
        gap: 0.8rem;
        align-items: center;

        & > .origin {
          display: flex;
          height: 3.2rem;
          & > img {
            height: 3.2rem;
            width: 3.2rem;
          }
          & > .letter {
            display: flex;
            align-items: center;
            justify-content: center;
            height: 3.2rem;
            width: 3.2rem;
            border-radius: 0.5rem;
            background: rgba(255, 255, 255, 0.1);
            font-size: 1.5rem;
            font-weight: 700;
          }
        }
      }

      .links > .more {
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

      .links > .more:hover { background: rgba(255, 255, 255, 0.12); }
    }

    & > .relations, & > .seasons, & > .episode-list {
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

    .trailer::after {
      background: linear-gradient(to top, rgb(35, 35, 35) 0%, rgba(35, 35, 35, 0.6) 25%, transparent 50%);
    }

    & > .hero {
      display: block;

      /* under the picture rather than over it, its foot overlapping the picture's */
      & > .over {
        margin-top: -5rem;
        padding: 0 1.6rem;
        gap: 1.4rem;
      }

      /* a film's date or Play the whole width under the poster */
      &.film > .over {
        grid-template-rows: auto auto;
        gap: 1.6rem 0;

        & > .poster {
          grid-row: 1;
          margin-right: 1.4rem;
        }

        & > .movie {
          grid-column: 1 / -1;
        }
      }

      .poster {
        width: 8.4rem;
        border-radius: 0.6rem;
      }

      .line {
        font-size: 1.3rem;
      }

      .title {
        font-size: 2.8rem;
      }

      .title-pending {
        height: calc(2.8rem * 1.05);
      }
    }

    & > .content {
      padding: 2rem 1.6rem;

      /* the facts under the description */
      & > .columns {
        grid-template-columns: minmax(0, 1fr);
        gap: 2.4rem;
      }

      & > .columns > .main > .description {
        font-size: 1.4rem;
      }

      & > .columns > .main > .sources {
        --picture: 9.4rem;
        --body: 5.2rem;
        gap: 0.8rem;
      }

      & > .relations, & > .seasons, & > .episode-list {
        margin-top: 2.5rem;
      }
    }

    .movie {
      & > .release {
        & > .day {
          font-size: 3.4rem;
        }

        & > .date {
          font-size: 1.5rem;
        }

        & > .count {
          font-size: 1.2rem;
        }
      }

      & > .actions {
        align-self: stretch;
      }

      & > .actions > .play, & > .actions > .play-pending {
        flex-basis: 100%;
        height: 4.8rem;
      }
    }
  }
}
`

const Line = ({ media, movie }: { media: DetailsMedia, movie: boolean }) => {
  const now = useNow()
  return <span className="line">{movie ? filmLine(media, new Date(now)) : seriesLine(media)}</span>
}

const SeriesFacts = ({ media }: { media: DetailsMedia }) => {
  const facts = seriesFacts(media)
  return facts.length
    ? <dl className="facts">{facts.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    : null
}

const FilmFacts = ({ media }: { media: DetailsMedia }) => {
  const intl = useIntl()
  const { score, genres, tags } = filmFacts(media)
  return (
    <>
      {
        score
          ? (
            <span className="score">
              <LucideStar size={15} fill="currentColor" role="img" aria-label={intl.formatMessage({ id: 'Score', defaultMessage: 'Score' })}/>
              {score}
            </span>
          )
          : undefined
      }
      {
        genres.length || tags.length
          ? (
            <div className="chips">
              {genres.map(genre => <span key={genre} className="chip genre">{genre}</span>)}
              {tags.map(tag => <span key={tag} className="chip tag">{tag}</span>)}
            </div>
          )
          : undefined
      }
    </>
  )
}

const MediaModal = ({ mediaNodes }: { mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }) => {
  const intl = useIntl()
  const rawParams = useParams<RouteParams['MEDIA']>()
  const params = { ...rawParams, uri: routeMediaUri(rawParams.uri) }
  const [, navigate] = useLocation()
  // The listing is a SOURCE OF DRAWING, never the gate: `namesSameWork` asks whether the address and
  // a card share a source handle, because a shared link names whatever sources the store had folded
  // in when it was copied and the card names whatever it has now. Compared for equality the two are
  // different works, and the modal opened over a blank box (open problem 22).
  const foundMedia = listedMediaFor(params.uri, mediaNodes)

  // held across the address growing, so a wider spelling of the same work does not restart the subscription
  const [uri, setUri] = useState(params.uri)
  useEffect(() => {
    setUri(prev => prev && matchAggregatedUris(prev as AggregatedUri, (params.uri ?? '') as AggregatedUri) ? prev : params.uri)
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
  const film = isMovie ? data?.media?.episodes.at(0) : undefined
  const { sources, answered } = useWatchSources(film, media?.uri ?? '', media?.handles)
  const settled = useSettledOnce(uri, current?.settled && answered)
  const movie = isMovie && data?.media
    ? { episode: film, mediaUri: data.media.uri, sources, settled, startDate: data.media.startDate, status: data.media.status }
    : undefined
  const tracked = useTrackingSummary(data?.media?.uri)
  // drawn as HTML as it comes: the worker answers the HTML form sanitized (src/worker/resolvers/utils.ts)
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
  const headerUrl = useCoverUrl(selectedTrailer?.url ? undefined : headerImages(media), media)

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
  // source ends up at the uri naming all of them; an address the page wrote also follows a split down.
  //
  // ONLY WHEN THE MEDIA IN HAND IS THE WORK THE ADDRESS NAMES, which the length comparison alone does
  // not establish. On a navigation the address changes first and `media` is still the PREVIOUS work
  // for a beat, so a link to a work known through one source ran this with the old cluster's eight
  // handles against the new address's one, decided the address had shrunk, and replaced it with the
  // page you were leaving. Clicking a relation or a graph node did nothing at all, twice out of twice
  // (measured 2026-09-09).
  const written = useRef<string | undefined>(undefined)
  const seasonUris = data?.media?.handles.map(handle => handle.node.uri) ?? []
  useEffect(() => {
    if (!firstSeasonRedirect(data?.media?.seasons, seasonUris) && shouldRewriteAddress(media?.uri, params.uri, written.current)) {
      written.current = media!.uri
      // THE QUERY STRING COMES ALONG. This replace is the reason a media url loses its flags: opened
      // at `/media/...?graph=1&trace=1`, the address grows a beat later and the url it is replaced
      // with carried the path alone, so `location.search` was empty for the rest of the session and
      // the url a reader copied out of the address bar no longer reproduced their page (measured
      // 2026-09-13). The flags the worker read at load are unaffected, which is what made this
      // invisible.
      navigate(`${getRoutePath(Route.MEDIA, { uri: media!.uri })}${location.search}`, { replace: true })
    }
  }, [media?.uri, params.uri])

  const tracking = (
    <MediaTracking
      work={uri}
      address={params.uri}
      uri={current?.uri}
      title={title}
      cover={coverUrl}
      episodeCount={current?.episodeCount}
      movie={isMovie}
    />
  )
  const links = (
    <div className="links">
      {/* 7.5's trace, behind `?trace=1`: nothing at all without the flag. The uri is the
          address the store has grown to, which is the one the graph knows this work by. */}
      <TraceLink uri={media?.uri}/>
      <SourceLinks uri={data?.media?.uri} handles={media?.handles} links={data?.media?.streamingLinks} except={watchOriginIds(film, media?.handles)}/>
      <ShareButton path={getRoutePath(Route.TITLE, { uri: media?.uri ?? params.uri })} title={title}/>
      <Link className="more" href={`${getRoutePath(Route.TITLE, { uri: media?.uri ?? params.uri })}${search}`}>{intl.formatMessage({ id: 'More details', defaultMessage: 'More details' })}</Link>
    </div>
  )
  const heading = title || settled ? <h2 className="title">{title}</h2> : <Placeholder className="title-pending"/>

  if (!open) return <Redirect to="/" />

  return (
    /* `data-party-scroll`: this overlay locks the body and scrolls inside itself, so the watch party
       has to follow THIS box rather than the frozen page (see components/party-sync.tsx). */
    <ModalBackdrop data-party-scroll css={style} onClose={() => onOpenChange(false)}>
      {/* until the details say it is a film, the preview draws a series' */}
      <div className={movie ? 'hero film' : 'hero'}>
        <div className="trailer" style={!selectedTrailer?.url && headerUrl ? { backgroundImage: `url(${headerUrl})` } : {}}>
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
        <div className="over">
          {coverUrl ? <img className="poster" src={coverUrl} alt=""/> : undefined}
          <div className="stack">
            {data?.media ? <Line media={data.media} movie={isMovie}/> : undefined}
            {heading}
          </div>
          {movie ? <MoviePlay {...movie}>{tracking}</MoviePlay> : undefined}
        </div>
      </div>
      <div className="content">
        <div className="columns">
          <div className="main">
            {movie ? <FilmSources {...movie}/> : tracking}
            {
              description
                ? (
                  <Collapsible collapsedHeight={200} className="description">
                    <div dangerouslySetInnerHTML={{ __html: description }}/>
                  </Collapsible>
                )
                : settled ? undefined : <PlaceholderLines count={5} className="description pending"/>
            }
          </div>
          <aside className="side">
            {data?.media ? isMovie ? <FilmFacts media={data.media}/> : <SeriesFacts media={data.media}/> : undefined}
            {links}
          </aside>
        </div>
        <MediaRelations
          key={uri}
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
          currentUris={seasonUris}
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
