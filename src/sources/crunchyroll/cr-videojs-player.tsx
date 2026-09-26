import type { DelegatedTracks, ExternalThumbnails, MediaChapter } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren, FunctionComponent } from 'preact'

import { MediaPlayer } from '@banou/media-player'
import { useMemo } from 'preact/hooks'

import { withTimelineSeek } from './timeline-seek'

type Props = {
  title?: string
  remote: RemoteVideoElement | null
  frame: Frame | null
  subtitles?: DelegatedTracks
  audioTracks?: DelegatedTracks
  thumbnails?: ExternalThumbnails
  chapters?: MediaChapter[]
  children?: ComponentChildren
}

// the iframe renders *inside* the chrome's `.video` div: the player fullscreens its container
// element, and the `pointer-events: none` iframe lets taps land on the click region above it
const CrunchyrollVideoJSPlayer = ({ title, remote, frame, subtitles, audioTracks, thumbnails, chapters, children }: Props) => {
  // memoized on both inputs: the player re-attaches whenever the media identity changes, so a fresh
  // Proxy every render would tear the store's attach down and rebuild it on every paint
  const media = useMemo(
    () => (remote && frame ? withTimelineSeek(remote, frame) : null),
    [remote, frame],
  )

  return (
    <MediaPlayer
      // served to the page that frames this embed, which is stub's own watch page: the party's playback
      // sync reads and moves the player through it, and a document nobody frames serves nobody
      expose
      // Always pass the key, even as null. Its PRESENCE is what selects the arm that drives a media
      // it does not own; spreading it conditionally would fall through to the local arm, which draws
      // an idle <video> over the Crunchyroll frame below.
      media={media}
      title={title}
      subtitles={subtitles}
      audioTracks={audioTracks}
      thumbnails={thumbnails}
      chapters={chapters}
    >
      {children}
    </MediaPlayer>
  )
}

export default CrunchyrollVideoJSPlayer as FunctionComponent<Props>
