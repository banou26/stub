import { MediaPlayer } from '@banou/media-player'
import { useEffect, useState } from 'preact/hooks'

import { keepVideoVolume } from '../../utils/player-volume'

/** A theme's video in @banou/media-player, started at once: it is mounted by a click on Play. */
const ThemePlayer = ({ url }: { url: string }) => {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  useEffect(() => video ? keepVideoVolume(video) : undefined, [video])
  useEffect(() => { video?.play().catch(() => {}) }, [video])
  // the video is ours and the player only drives it: a WebM the browser plays needs no remux
  return (
    <MediaPlayer media={video} shortcuts="player">
      <video ref={setVideo} src={url} playsInline/>
    </MediaPlayer>
  )
}

export default ThemePlayer
