import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'

import { css } from '@emotion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/compat'
import { LucidePause, LucidePlay } from 'lucide-react'
import { useRoute } from 'wouter'

import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import VolumeControl from '../../components/volume-control'
import TextEllipsis from '../../components/text-ellipsis'
import { THEATER_WAIT_MS, fromGoodSource, holdTheaterPick, theaterCandidates } from '../../utils/theater'
import { useCoverUrl } from '../../utils/use-cover-url'
import { getRouterRoutePath, Route } from '../path'

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
  // a failed trailer gives way to the show's next one, or to none, never to another show: with YouTube
  // unreachable every embed fails, and re-picking on each one cycled the hero every 10 s (measured 2026-10-10)
  const [deadTrailers, setDeadTrailers] = useState<string[]>([])
  const trailer = media?.trailers?.find(trailer => !deadTrailers.includes(trailer.uri))
  // with no trailer left to play, the show's banner (or cover) stands in, as in the media modal
  const backdrop = useCoverUrl(trailer?.url ? undefined : media?.banners?.length ? media.banners : media?.covers)

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
        )}
        <div className="title">{title}</div>
        <TextEllipsis className="short-description">
          {shortDescription}
        </TextEllipsis>
      </div>
    </div>
  )
}

export default HomeHeader
