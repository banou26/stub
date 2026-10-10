import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { Media } from '@videojs/media/dom'
import type { ComponentChildren, FunctionComponent } from 'preact'
import type { PlayerCapabilities, PlayerMediaAdapter, PlayerMediaBinding } from './types'

import { css } from '@emotion/react'
import { useEffect } from 'preact/hooks'
import { videoFeatures } from '@videojs/core/dom'
import { createPlayer, useMediaAttach } from '@videojs/react'
import '@videojs/react/video/skin.css'

import { exposePlayer } from '@banou/media-player/remote'

import { rememberPlayerVolume } from '../../utils/player-volume'
import VideoSurface from './video-surface'

const { Provider } = createPlayer({ features: videoFeatures })

const normalizeBinding = (value: Media | PlayerMediaBinding): PlayerMediaBinding =>
  'media' in value ? value : { media: value }

const MediaAttach = ({ remote, frame, adapter }: {
  remote: RemoteVideoElement | null
  frame: Frame | null
  adapter?: PlayerMediaAdapter
}) => {
  const setMedia = useMediaAttach()
  useEffect(() => {
    if (!setMedia || !remote || !frame) return
    const adapted = adapter ? adapter(remote, frame) : remote
    if (!adapted) return
    const binding = normalizeBinding(adapted)
    // before the attach, so the store's first read of the media already finds the kept volume
    const forgetVolume = rememberPlayerVolume(remote)
    setMedia(binding.media)
    // served to the page that frames this embed, stub's own watch page, and nobody else: the party's
    // playback sync reads and moves the player through it. This is stub's videojs player rather than
    // @banou/media-player's, so the prop that does it there is a call here.
    const stop = exposePlayer(binding.media as unknown as Parameters<typeof exposePlayer>[0])
    return () => {
      stop()
      forgetVolume()
      setMedia(null)
      binding.dispose?.()
    }
  }, [remote, frame, adapter, setMedia])
  return null
}

const style = css`
  position: absolute;
  inset: 0;
  border-radius: 0.8rem;
  background: transparent !important;
  &.media-default-skin--video {
    background: transparent !important;
  }

  .media-popover--menu {
    padding: 0.4rem;
  }

  /**
   * The track menu is stub's own markup, so it carries a stub prefix rather than a media one.
   *
   * It was named \`media-menu\` when the skin had no menu of its own. videojs beta.26 added one, and
   * upstream's nested \`.media-default-skin .media-menu .media-menu__item\` is specificity (0,3,0)
   * against this file's (0,2,0), so it silently took over padding, gap, cursor and justification the
   * moment the dependency moved. A prefix upstream will never mint is the only durable fix; matching
   * their specificity would just move the race to insertion order.
   */
  .stub-menu {
    display: flex;
    flex-direction: column;
    min-width: 18rem;
    max-height: 32rem;
    overflow-y: auto;
  }
  .stub-menu__heading {
    padding: 0.6rem 1rem 0.4rem;
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.6;
  }
  .stub-menu__item {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    width: 100%;
    padding: 0.6rem 1rem;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: inherit;
    font-size: 1.3rem;
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.12);
    }
    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }
  .stub-menu__check {
    display: inline-flex;
    width: 1.6rem;
    flex: none;
  }
  .stub-menu__label {
    flex: 1;
  }
  .stub-menu__description {
    opacity: 0.6;
    font-size: 1.1rem;
  }
  .media-button--error {
    color: #f66;
  }
`

export type PlayerProps = {
  remote: RemoteVideoElement | null
  frame: Frame | null
  adapter?: PlayerMediaAdapter
  capabilities?: PlayerCapabilities
  children?: ComponentChildren
}

const Player = ({ remote, frame, adapter, capabilities, children }: PlayerProps) => (
  <Provider>
    <MediaAttach remote={remote} frame={frame} adapter={adapter} />
    <VideoSurface capabilities={capabilities} css={style}>
      {children}
    </VideoSurface>
  </Provider>
)

export default Player as FunctionComponent<PlayerProps>
export type { PlayerCapabilities, PlayerChoice, PlayerMediaAdapter, PlayerMediaBinding, PlayerSelection } from './types'
