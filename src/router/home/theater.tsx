import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'

import { css } from '@emotion/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'preact/compat'
import { LucidePause, LucidePlay } from 'lucide-react'
import { useSubscription } from 'urql'
import { useRoute } from 'wouter'

import { MediaDescriptionContentType } from '../../generated/graphql'
import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import VolumeControl from '../../components/volume-control'
import TextEllipsis from '../../components/text-ellipsis'
import Placeholder, { PlaceholderLines } from '../../components/placeholder'
import { SOURCES_WAIT_MS, THEATER_WAIT_MS, fromGoodSource, holdTheaterPick, isSameShow, slowConnection, theaterCandidates, theaterKey, type ConnectionReading } from '../../utils/theater'
import { headerImages, useCoverUrl } from '../../utils/use-cover-url'
import { onPluginsChange, pluginStatuses } from '../../plugins'
import { getRouterRoutePath, Route } from '../path'
import { GET_MEDIA_DETAILS, MediaPlay } from './media-details'

const style = css`
height: 70vh;
.player-wrapper {
  position: absolute;
  width: 100%;
  height: calc(100vh - 5rem);
  user-select: none;
  background-size: cover;
  background-position: center 20%;

  .shadow {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 30vh;

    background:
      linear-gradient(
        0deg,
        rgba(15, 15, 15, 1) 0%,
        rgba(15, 15, 15, 0.5) calc(100% - 10rem),
        rgba(15, 15, 15, 0) 100%
      );
  }
}

.information {
  position: absolute;
  inset: 0;
  left: 10rem;
  max-width: 75rem;
  display: flex;
  flex-direction: column;
  align-items: start;
  justify-content: center;
  text-shadow: rgb(0 0 0 / 80%) -1px -1px 0, rgb(0 0 0 / 80%) -1px 1px 0, rgb(0 0 0 / 80%) 1px -1px 0, rgb(0 0 0 / 80%) 1px 1px 0;

  .player-controls {
    padding: 2.5rem 0;
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

  .title {
    font-size: 4rem;
    font-weight: bold;
    margin-bottom: 1rem;
    cursor: default;
  }

  .short-description {
    font-size: 2rem;
    margin-bottom: 1rem;
    cursor: default;
    overflow: hidden;
    max-height: 10rem;
    white-space: pre-wrap;
  }

  /* the block shrinks to its content, so a width in % would size against itself */
  .title > .pending {
    width: min(40rem, 60vw);
    height: 1.2em;
  }

  .short-description.pending {
    width: min(60rem, 80vw);
  }

  /* reserved before the button arrives, since the block is centred and would otherwise move up */
  .actions {
    height: 4.4rem;
  }

  .play {
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
    text-shadow: none;
  }

  .play:hover { background: rgba(255, 255, 255, 0.85); }
}

@media (max-width: 768px) {
  height: 56vh;

  .information {
    left: 1.5rem;
    right: 1.5rem;
    max-width: none;

    .player-controls {
      padding: 1.5rem 0;
    }

    .title {
      font-size: 2.6rem;
    }

    .short-description {
      font-size: 1.5rem;
      max-height: 8rem;
    }
  }
}
`

type Connection = ConnectionReading & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

const connection = () => (globalThis.navigator as { connection?: Connection } | undefined)?.connection

const onConnectionChange = (listener: () => void) => {
  const link = connection()
  link?.addEventListener('change', listener)
  return () => link?.removeEventListener('change', listener)
}

/** The show's Play, Continue or Rewatch. Keyed by the show, since urql keeps the last show's answer when the uri changes. */
const TheaterPlay = ({ uri }: { uri: string }) => {
  const [{ data }] = useSubscription({
    query: GET_MEDIA_DETAILS,
    variables: { input: { uri }, descriptionInput: { type: MediaDescriptionContentType.Html } },
  })
  return <MediaPlay media={data?.media}/>
}

const HomeHeader = ({ mediaNodes }: { mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }) => {
  const [matchMediaRoute] = useRoute(getRouterRoutePath(Route.MEDIA))
  const [waiting, setWaiting] = useState(true)
  useEffect(() => {
    const timer = setTimeout(() => setWaiting(false), THEATER_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  // selected on the fields the hero renders, and for `THEATER_WAIT_MS` on a good source having filled them
  const candidates = useMemo(
    () => theaterCandidates(mediaNodes).filter(media => !waiting || fromGoodSource(media)),
    [mediaNodes, waiting]
  )
  // held as shown once a good source has filled it, so later merges change nothing on screen, see `holdTheaterPick`
  const held = useRef<typeof candidates[number] | undefined>(undefined)
  held.current = holdTheaterPick(candidates, held.current)
  const media = held.current

  const title = media?.titles?.at(0)?.title
  const shortDescription = media?.shortDescriptions?.at(0)?.shortDescription
  const slowLink = useSyncExternalStore(onConnectionChange, () => slowConnection(connection()))
  // a trailer playing while a source connects shares the link with the source's files: at 6 KB/s and
  // 300 ms, holding it let the source connect 8 to 12 s sooner (measured 2026-10-16)
  const starting = useSyncExternalStore(onPluginsChange, () => pluginStatuses().some(source => source.state === 'connecting' && !source.retry))
  const [waitedForSources, setWaitedForSources] = useState(false)
  useEffect(() => {
    if (!starting) return
    const timer = setTimeout(() => setWaitedForSources(true), SOURCES_WAIT_MS)
    return () => {
      clearTimeout(timer)
      setWaitedForSources(false)
    }
  }, [starting])
  // a failed trailer gives way to the show's next one, or to none, never to another show: with YouTube
  // unreachable every embed fails, and re-picking on each one cycled the hero every 10 s (measured 2026-10-10)
  const [deadTrailers, setDeadTrailers] = useState<string[]>([])
  const trailer = slowLink || (starting && !waitedForSources)
    ? undefined
    : media?.trailers?.find(trailer => !deadTrailers.includes(trailer.uri))
  // with no trailer left to play, the show's banner (or cover) stands in, as in the media modal. Read off
  // the listing rather than the pick as held, since banners merge in after the pick: over the ten picks
  // with the trailer held, the pick as held ended on a 425x600 poster in 3 and never on AniZip's
  // 1920x1080 fanart, which the listing's node drew in 8 (measured 2026-10-25)
  const listed = media && mediaNodes.find(node => isSameShow(node, media))
  // the viewport stands in for the hero's own box, 5rem shorter, since each merge would otherwise swap
  // the backdrop for any higher ranked banner, also one no sharper (Kitsu's 4096x1049 to AniZip's
  // 1920x1080, measured 2026-10-25)
  const backdrop = useCoverUrl(
    trailer?.url ? undefined : headerImages(listed ?? media),
    media,
    { box: { width: globalThis.innerWidth, height: globalThis.innerHeight } }
  )

  const [playerPaused, setPlayerPaused] = useState(false)
  const [playerMuted, setPlayerMuted] = useState(true)
  const [playerVolume, setPlayerVolume] = useState(0.25)

  const onTrailerError = useCallback(() => {
    if (trailer) setDeadTrailers(dead => [...dead, trailer.uri])
  }, [trailer])

  return (
    <div css={style} className='theater'>
      <div className="player-wrapper" style={!trailer?.url && backdrop ? { backgroundImage: `url(${backdrop})` } : undefined}>
        {
          trailer?.url && (
            <YoutubeMinimalPlayer
              url={trailer.url}
              paused={playerPaused || matchMediaRoute}
              onError={onTrailerError}
              volume={playerMuted ? 0 : playerVolume}
              className="player"
            />
          )
        }
        <div className="shadow"/>
      </div>
      <div className="information" css={style}>
        {trailer?.url && (
          <div className="player-controls">
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
        )}
        {/* held while the hero waits for a show, and no longer, so a row that never fills does not keep it loading */}
        <div className="title">{title ?? (media || !waiting ? undefined : <Placeholder className="pending"/>)}</div>
        {
          media || !waiting
            ? (
              <TextEllipsis className="short-description">
                {shortDescription}
              </TextEllipsis>
            )
            : <PlaceholderLines count={3} className="short-description pending"/>
        }
        <div className="actions">
          {media?.uri ? <TheaterPlay key={theaterKey(media)} uri={media.uri}/> : undefined}
        </div>
      </div>
    </div>
  )
}

export default HomeHeader
