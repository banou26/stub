import type { DelegatedTracks } from '@banou/media-player'
import type { RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren, FunctionComponent } from 'preact'

import { MediaPlayer } from '@banou/media-player'
import { exposePlayer } from '@banou/media-player/remote'
import { useEffect, useMemo } from 'preact/hooks'

import { rememberPlayerVolume } from '../../utils/player-volume'

type Props = {
  title?: string
  remote: RemoteVideoElement | null
  quality?: DelegatedTracks
  children?: ComponentChildren
}

// A seek is a plain `currentTime` write on the remote video: on Prime it seeks in about 0.2 s and
// Amazon's own player follows (measured 2026-10-12), so no scrubber has to be driven.
const PrimeMediaPlayer = ({ title, remote, quality, children }: Props) => {
  const volume = useMemo(() => (remote ? rememberPlayerVolume(remote) : null), [remote])
  useEffect(() => volume?.hold(), [volume])
  useEffect(() => (volume ? exposePlayer(volume.served(volume.media)) : undefined), [volume])

  return (
    // `media` is passed even as null: its presence is what makes the player drive a media it does not own
    <MediaPlayer media={volume?.media ?? null} title={title} quality={quality}>
      {children}
    </MediaPlayer>
  )
}

export default PrimeMediaPlayer as FunctionComponent<Props>
