import type { Frame, RemoteVideoElement } from '@fkn/lib'
import type { Media } from '@videojs/media/dom'
import type { ComponentChildren, FunctionComponent } from 'preact'
import type { PlayerCapabilities, PlayerMediaAdapter, PlayerMediaBinding } from './types'

import { css } from '@emotion/react'
import { useEffect } from 'preact/hooks'
import { createPlayer, useMediaAttach } from '@videojs/react'
import '@videojs/react/video/skin.css'

import { exposePlayer } from '@banou/media-player/remote'

import { rememberPlayerVolume } from '../../utils/player-volume'
import { hostFullscreenFeatures } from './host-fullscreen'
import LeftToRight from './left-to-right'
import VideoSurface from './video-surface'

const { Provider } = createPlayer({ features: hostFullscreenFeatures })

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
    const volume = rememberPlayerVolume(remote)
    const adapted = adapter ? adapter(volume.media, frame) : volume.media
    if (!adapted) return
    const binding = normalizeBinding(adapted)
    // before the attach, so the store's first read of the media already finds the kept volume
    const releaseVolume = volume.hold()
    setMedia(binding.media)
    // served to the page that frames this embed, stub's own watch page, and nobody else: the party's
    // playback sync reads and moves the player through it
    const stop = exposePlayer(volume.served(binding.media) as unknown as Parameters<typeof exposePlayer>[0])
    return () => {
      stop()
      releaseVolume()
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
  .stub-menu__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.4rem 0.6rem 0.4rem 1rem;
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
  }
  .stub-menu__title {
    font-size: 1.1rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    opacity: 0.7;
  }
  .stub-menu__back {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 1.2rem;
    font-weight: 600;
    padding: 0.2rem 0.4rem 0.2rem 0;
    cursor: pointer;

    &:hover {
      opacity: 0.8;
    }
  }
  .stub-menu__action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: rgba(255, 255, 255, 0.75);
    padding: 0.35rem;
    cursor: pointer;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
    }
  }
  .stub-settings__section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.6rem 0.8rem;
  }
  .stub-settings__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    font-size: 1.2rem;
  }
  .stub-settings__value {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 1.15rem;
    opacity: 0.85;
  }
  .stub-settings__steps {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.4rem;
  }
  .stub-settings__scale {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }
  .stub-settings__bg {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.35rem;
  }
  .stub-pill {
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    font-size: 1.1rem;
    padding: 0.35rem 0.3rem;
    min-width: 2.4rem;
    text-align: center;
    cursor: pointer;

    &:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.18);
    }
    &[aria-pressed='true'] {
      background: #fff;
      color: #111;
      border-color: #fff;
      font-weight: 600;
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
    }
  }
  .stub-reset-btn {
    border: 1px solid rgba(255, 255, 255, 0.24);
    border-radius: 0.4rem;
    background: transparent;
    color: inherit;
    font-size: 1.05rem;
    padding: 0.15rem 0.5rem;
    cursor: pointer;

    &:hover {
      background: rgba(255, 255, 255, 0.14);
    }
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
  .stub-menu__tag {
    padding: 0.1rem 0.5rem;
    border-radius: 0.4rem;
    font-size: 1rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    line-height: 1.3;
    white-space: nowrap;
    background: rgba(255, 255, 255, 0.14);
    color: rgba(255, 255, 255, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.18);
    flex-shrink: 0;
  }
  .stub-menu__tag--external {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.28);
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
  <LeftToRight>
    <Provider>
      <MediaAttach remote={remote} frame={frame} adapter={adapter} />
      <VideoSurface remote={remote} capabilities={capabilities} css={style}>
        {children}
      </VideoSurface>
    </Provider>
  </LeftToRight>
)

export default Player as FunctionComponent<PlayerProps>
export type { PlayerCapabilities, PlayerChoice, PlayerMediaAdapter, PlayerMediaBinding, PlayerSelection } from './types'
