import type { HTMLAttributes } from 'react'

import { useCallback, useEffect, useState } from 'preact/hooks'
import { css } from '@emotion/react'

import useScrub from '../utils/use-scrub'
import { Volume, Volume1, Volume2, VolumeX } from 'lucide-react'

const style = css`
display: flex;
align-items: center;
justify-content: center;
gap: 0.5rem;

& > button.volume-icon {
  position: relative;
  width: 3rem;
  height: 3rem;
  cursor: pointer;
  background-color: transparent;
  border: none;
  outline: none;
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

.volume-area {
    display: flex;
    cursor: pointer;
    color: #fff;

    .mute-button {
      color: #fff;
      border: none;
      background: none;
      height: 100%;
      width: 4.8rem;
      cursor: pointer;
    }

    .volume-panel {
      display: inline-block;
      width: 0;
      /* width: 100%; */
      /* width: 12rem; */
      height: 100%;
      -webkit-transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
      transition: margin .2s cubic-bezier(0.4,0,1,1),width .2s cubic-bezier(0.4,0,1,1);
      cursor: pointer;
      outline: 0;

      &.volume-control-hover {
        width: 6rem;
        /* width: 52px; */
        margin-right: 3px;
        -webkit-transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
        transition: margin .2s cubic-bezier(0,0,0.2,1),width .2s cubic-bezier(0,0,0.2,1);
      }

      .slider {
        height: 100%;
        min-height: 36px;
        position: relative;
        overflow: hidden;

        .slider-handle {
          /* left: 40px; */
          position: absolute;
          top: 50%;
          width: 12px;
          height: 12px;
          border-radius: 6px;
          margin-top: -6px;
          margin-left: -5px;
          /* background: #fff; */
        }
        .slider-handle::before, .slider-handle::after {
          content: "";
          position: absolute;
          display: block;
          top: 50%;
          left: 0;
          height: 3px;
          margin-top: -2px;
          width: 64px;
        }
        .slider-handle::before {
          left: -58px;
          background: #fff;
          border: 0.1rem solid #000;
        }
        .slider-handle::after {
          left: 6px;
          background: rgba(255,255,255,.2);
          border: 0.1rem solid #000;
        }
      }
    }
  }
}
`

export const VolumeControl = (
  { defaultMuted = true, defaultVolume = 1, onMutedUpdate, onVolumeUpdate }:
  { defaultMuted?: boolean, onMutedUpdate: (muted: boolean) => void, defaultVolume?: number, onVolumeUpdate: (adjustedVolume: number, volume: number) => void }
) => {
  const [volume, setVolume] = useState(defaultVolume)
  const [isMuted, setMuted] = useState(defaultMuted)
  const [volumeBarElement, setVolumeBarElement] = useState<HTMLDivElement | null>(null)
  const [hiddenVolumeArea, setHiddenVolumeArea] = useState(true)
  const { scrubHandler, value: volumeScrubValue } = useScrub({ element: volumeBarElement, defaultValue: volume })

  useEffect(() => {
    if (volumeScrubValue === undefined) return
    setVolume(volumeScrubValue)
    onVolumeUpdate(volumeScrubValue ** 2, volumeScrubValue)
  }, [setVolume, volumeScrubValue])

  const toggleMuteButton = useCallback(() => {
    if (volumeScrubValue === undefined) return
    setMuted(value => !value)
    onMutedUpdate(isMuted ? false : true)
  }, [setMuted, setVolume, volumeScrubValue, isMuted])

  const hoverVolumeArea: HTMLAttributes<HTMLDivElement | HTMLButtonElement>['onMouseOver'] = useCallback(() => {
    setHiddenVolumeArea(false)
  }, [setHiddenVolumeArea])

  const mouseOutBottom: HTMLAttributes<HTMLDivElement>['onMouseOut'] = useCallback((ev) => {
    setHiddenVolumeArea(true)
  }, [setHiddenVolumeArea])

  const VolumeIcon =
    isMuted ? VolumeX
    : (volume ?? 0) > 0.66 ? Volume2
    : (volume ?? 0) > 0.33 ? Volume1
    : (volume ?? 0) > 0 ? Volume
    : VolumeX

  const volumeIcon = (
    <>
      <VolumeIcon className="icon-outline" size={30} strokeWidth={3} stroke="black"/>
      <VolumeIcon className="icon-body" size={30}/>
    </>
  )

  return (
    <div css={style} onMouseLeave={mouseOutBottom}>
      <button className="volume-icon" onClick={toggleMuteButton} onMouseOver={hoverVolumeArea}>
        {volumeIcon}
      </button>
      <div className="volume-area" onMouseOver={hoverVolumeArea}>
        <div
          ref={ref => setVolumeBarElement(ref)}
          className={`volume-panel${hiddenVolumeArea ? '' : ' volume-control-hover'}`}
          onMouseDown={scrubHandler}
        >
          <div className="slider">
            <div className="slider-handle" style={{ left: `${(volume ?? 0) * 100}%` }}></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default VolumeControl
