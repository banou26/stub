import type { DelegatedTracks, ExternalThumbnails, MediaChapter, PassThroughPictureInPicture } from '@banou/media-player'
import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { ComponentChildren, FunctionComponent } from 'preact'

import { MediaPlayer } from '@banou/media-player'
import { exposePlayer } from '@banou/media-player/remote'
import { useEffect, useMemo } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { useHostFullscreen } from '../../embed-fullscreen'
import { tellTrackLanguage } from '../../embed-languages'
import { rememberPlayerVolume } from '../../utils/player-volume'
import { usePageFrameStep } from '../frame-steps'
import { withTimelineSeek } from './timeline-seek'

type Props = {
  title?: string
  remote: RemoteVideoElement | null
  frame: Frame | null
  subtitles?: DelegatedTracks
  audioTracks?: DelegatedTracks
  quality?: DelegatedTracks
  thumbnails?: ExternalThumbnails
  chapters?: MediaChapter[]
  pictureInPicture?: PassThroughPictureInPicture
  /** whether the watch page is served the player yet */
  expose?: boolean
  children?: ComponentChildren
}

// the element `frame.locator('video')` hands over as the player's media
const PAGE_VIDEO = { video: 'video' }

// the iframe renders *inside* the chrome's `.video` div: the player fullscreens its container
// element, and the `pointer-events: none` iframe lets taps land on the click region above it
const CrunchyrollVideoJSPlayer = ({ title, remote, frame, subtitles, audioTracks, quality, thumbnails, chapters, pictureInPicture, expose = true, children }: Props) => {
  const { locale } = useIntl()
  const volume = useMemo(() => (remote ? rememberPlayerVolume(remote) : null), [remote])
  useEffect(() => volume?.hold(), [volume])
  // memoized on both inputs: the player re-attaches whenever the media identity changes, so a fresh
  // Proxy every render would tear the store's attach down and rebuild it on every paint
  const media = useMemo(
    () => (volume && frame ? withTimelineSeek(volume.media, frame) : null),
    [volume, frame],
  )
  // served to the page that frames this embed, which is stub's own watch page: the party's playback
  // sync reads and moves the player through it, and a document nobody frames serves nobody
  useEffect(() => (volume && media && expose ? exposePlayer(volume.served(media)) : undefined), [volume, media, expose])
  // on the element itself, never through `media`: the scrubber it seeks would round a step to its 0.25 s
  const stepFrame = usePageFrameStep(frame, remote, PAGE_VIDEO)
  const fullscreen = useHostFullscreen()

  return (
    <MediaPlayer
      // Always pass the key, even as null. Its PRESENCE is what selects the arm that drives a media
      // it does not own; spreading it conditionally would fall through to the local arm, which draws
      // an idle <video> over the Crunchyroll frame below.
      media={media}
      title={title}
      subtitles={subtitles}
      audioTracks={audioTracks}
      quality={quality}
      thumbnails={thumbnails}
      chapters={chapters}
      pictureInPicture={pictureInPicture}
      fullscreen={fullscreen}
      onPreferredAudioLanguageChange={language => tellTrackLanguage('audio', language)}
      onPreferredSubtitleLanguageChange={language => tellTrackLanguage('subtitles', language)}
      stepFrame={stepFrame}
      language={locale}
    >
      {children}
    </MediaPlayer>
  )
}

export default CrunchyrollVideoJSPlayer as FunctionComponent<Props>
