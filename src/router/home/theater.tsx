import type { GetReleasingMediaPageSubscription } from '../../generated/graphql'

import { css } from '@emotion/react'
import { useSubscription } from 'urql'
import { useCallback, useMemo, useRef, useState } from 'preact/compat'
import { LucidePause, LucidePlay } from 'lucide-react'
import { useRoute } from 'wouter'

import YoutubeMinimalPlayer from '../../components/yt-minimal-player'
import VolumeControl from '../../components/volume-control'
import TextEllipsis from '../../components/text-ellipsis'
import { gql } from '../../generated'
import { holdTheaterPick, theaterCandidates, theaterKey } from '../../utils/theater'
import { getRouterRoutePath, Route } from '../path'

const style = css`
height: 70vh;
.player-wrapper {
  position: absolute;
  width: 100%;
  height: calc(100vh - 5rem);
  user-select: none;

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

const GET_THEATHER_MEDIA = gql(`
  subscription GetTheatherMedia($input: MediaInput!, $shortDescriptionInput: MediaShortDescriptionInput!) {
    media(input: $input) {
      ...MediaFragment
      titles {
        language
        title
        score
      }
      shortDescriptions(input: $shortDescriptionInput) {
        language
        shortDescription
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
    }
  }
`)

const HomeHeader = ({ mediaNodes }: { mediaNodes: GetReleasingMediaPageSubscription['mediaPage']['nodes'] }) => {
  const [matchMediaRoute] = useRoute(getRouterRoutePath(Route.MEDIA))
  const [bannedMedia, setBannedMedia] = useState<string[]>([])
  // selected on the fields the hero renders rather than on a source-confidence score, see ../../utils/theater
  const candidates = useMemo(() => theaterCandidates(mediaNodes), [mediaNodes])
  // The pick is HELD by key, not re-rolled per render: it used to be a random INDEX memoized on the
  // candidate COUNT, so every source that answered grew the count and chose a different show, and the
  // hero flipped through several in the first second. See `holdTheaterPick`.
  const held = useRef<string | undefined>(undefined)
  const selectedMedia = useMemo(() => {
    const chosen = holdTheaterPick(candidates, held.current, bannedMedia)
    held.current = chosen ? theaterKey(chosen) : undefined
    return chosen
  }, [candidates, bannedMedia])
  const [{ data }] = useSubscription({
    query: GET_THEATHER_MEDIA,
    variables: {
      input: {
        uri: selectedMedia?.uri
      },
      shortDescriptionInput: {
        count: 1
      }
    },
    pause: !selectedMedia
  })
  const theaterMedia = data?.media ?? selectedMedia

  // todo: instead of just selecting 0, should make a query that selects the wanted language and sort by score
  const title = useMemo(() => theaterMedia?.titles?.at(0)?.title, [theaterMedia])
  const shortDescription = useMemo(() => theaterMedia?.shortDescriptions?.at(0)?.shortDescription, [theaterMedia])
  const trailer = useMemo(() => theaterMedia?.trailers?.at(0), [theaterMedia])

  const [playerPaused, setPlayerPaused] = useState(false)
  const [playerMuted, setPlayerMuted] = useState(true)
  const [playerVolume, setPlayerVolume] = useState(0.25)

  const onTrailerError = useCallback(() => {
    // nothing was selected, so there is no choice to ban and re-picking would loop on the same miss
    const key = selectedMedia && theaterKey(selectedMedia)
    if (!key) return
    setBannedMedia(banned => banned.includes(key) ? banned : [...banned, key])
  }, [selectedMedia])

  return (
    <div css={style} className='theater'>
      <div className="player-wrapper">
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
        <div className="title">{title}</div>
        <TextEllipsis className="short-description">
          {shortDescription}
        </TextEllipsis>
      </div>
    </div>
  )
}

export default HomeHeader
