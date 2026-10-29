import type { ComponentChildren, FunctionComponent } from 'preact'
import type { PlayerCapabilities, PlayerSelection } from './types'

import { useEffect, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'
import {
  AlertDialog,
  BufferingIndicator,
  Container,
  Controls,
  ErrorDialog,
  FullscreenButton,
  MediaGesture,
  MediaHotkey,
  MuteButton,
  PiPButton,
  PlayButton,
  PlaybackRateButton,
  Popover,
  SeekButton,
  Slider,
  Time,
  TimeSlider,
  Tooltip,
  VolumeSlider,
} from '@videojs/react'
import {
  AudioTracksIcon,
  CaptionsOffIcon,
  CaptionsOnIcon,
  CheckIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayIcon,
  QualityIcon,
  RestartIcon,
  SeekIcon,
  SpinnerIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
} from './icons'

const SEEK_TIME = 10

const asFC = <P,>(component: unknown): FunctionComponent<P> => component as FunctionComponent<P>

const ControlsRoot = asFC<{ className?: string, children?: ComponentChildren }>(Controls.Root)
const BufferingIndicatorC = asFC<{ render?: unknown }>(BufferingIndicator)
const ErrorDialogRoot = asFC<{ children?: ComponentChildren }>(ErrorDialog.Root)
const AlertDialogPopup = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Popup)
const AlertDialogTitle = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Title)
const AlertDialogClose = asFC<{ className?: string, children?: ComponentChildren }>(AlertDialog.Close)
const ErrorDialogDescription = asFC<{ className?: string }>(ErrorDialog.Description)
const TooltipProvider = asFC<{ children?: ComponentChildren }>(Tooltip.Provider)
const TooltipRoot = asFC<{ side?: string, children?: ComponentChildren }>(Tooltip.Root)
const TooltipTrigger = asFC<{ render?: ComponentChildren }>(Tooltip.Trigger)
const TooltipPopup = asFC<{ className?: string, children?: ComponentChildren }>(Tooltip.Popup)
const PopoverRoot = asFC<{
  open?: boolean
  onOpenChange?: (open: boolean) => void
  openOnHover?: boolean
  delay?: number
  closeDelay?: number
  side?: string
  children?: ComponentChildren
}>(Popover.Root)
const PopoverTrigger = asFC<{ render?: ComponentChildren, children?: ComponentChildren }>(Popover.Trigger)
const PopoverPopup = asFC<{ className?: string, children?: ComponentChildren }>(Popover.Popup)
const PlayButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(PlayButton)
const SeekButtonC = asFC<{ seconds?: number, className?: string, render?: ComponentChildren, children?: ComponentChildren }>(SeekButton)
const MuteButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(MuteButton)
const PiPButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(PiPButton)
const FullscreenButtonC = asFC<{ className?: string, render?: ComponentChildren, children?: ComponentChildren }>(FullscreenButton)
const PlaybackRateButtonC = asFC<{ className?: string, render?: ComponentChildren }>(PlaybackRateButton)
const TimeValue = asFC<{ type?: string, className?: string }>(Time.Value)
const TimeSliderRoot = asFC<{ className?: string, children?: ComponentChildren }>(TimeSlider.Root)
const SliderTrack = asFC<{ className?: string, children?: ComponentChildren }>(Slider.Track)
const SliderFill = asFC<{ className?: string }>(Slider.Fill)
const SliderBuffer = asFC<{ className?: string }>(Slider.Buffer)
const SliderThumb = asFC<{ className?: string }>(Slider.Thumb)
const SliderValue = asFC<{ type?: string, className?: string }>(Slider.Value)
const VolumeSliderRoot = asFC<{ className?: string, orientation?: string, thumbAlignment?: string, children?: ComponentChildren }>(VolumeSlider.Root)
const MediaHotkeyC = asFC<{ keys: string, action: string, value?: number }>(MediaHotkey)
const MediaGestureC = asFC<{ type: string, action: string, value?: number, pointer?: string, region?: string }>(MediaGesture)
const ContainerC = asFC<{ className?: string, children?: ComponentChildren } & Record<string, unknown>>(Container)

type IntrinsicButton = {
  type?: 'button' | 'submit' | 'reset'
  className?: string
  'aria-label'?: string
  children?: ComponentChildren
}

const IconButton = ({ className, ...props }: IntrinsicButton) => (
  <button
    type="button"
    className={`media-button media-button--subtle media-button--icon${className ? ` ${className}` : ''}`}
    {...props}
  />
)

const SelectionMenu = ({ selection, icon }: { selection: PlayerSelection, icon: ComponentChildren }) => {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => setFailed(false), [selection.selectedId])

  const choices = [
    ...(selection.offLabel ? [{ id: null as string | null, label: selection.offLabel }] : []),
    ...selection.options,
  ]

  const select = (id: string | null) => {
    if (id === selection.selectedId) {
      setOpen(false)
      return
    }
    setFailed(false)
    setPending(true)
    Promise.resolve()
      .then(() => selection.onSelect(id))
      .then(() => setOpen(false))
      .catch(err => {
        console.warn(`[player] ${selection.label} selection failed:`, err)
        setFailed(true)
      })
      .finally(() => setPending(false))
  }

  return (
    <PopoverRoot open={open} onOpenChange={next => setOpen(next)}>
      <PopoverTrigger
        render={
          <IconButton
            className={`media-button--menu${failed ? ' media-button--error' : ''}`}
            aria-label={selection.label}
          />
        }
      >
        {icon}
      </PopoverTrigger>
      <PopoverPopup className="media-surface media-popover media-popover--menu">
        <div className="stub-menu" role="menu" aria-label={selection.label}>
          <div className="stub-menu__heading">{selection.label}</div>
          {choices.map(choice => {
            const selected = choice.id === selection.selectedId
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                key={choice.id ?? '__off__'}
                className={`stub-menu__item${selected ? ' stub-menu__item--active' : ''}`}
                disabled={pending || ('disabled' in choice && choice.disabled)}
                onClick={() => select(choice.id)}
              >
                <span className="stub-menu__check">{selected ? <CheckIcon className="media-icon" /> : null}</span>
                <span className="stub-menu__label">{choice.label}</span>
                {'description' in choice && choice.description
                  ? <span className="stub-menu__description">{choice.description}</span>
                  : null}
              </button>
            )
          })}
        </div>
      </PopoverPopup>
    </PopoverRoot>
  )
}

const VolumePopover = () => (
  <PopoverRoot openOnHover delay={200} closeDelay={100} side="top">
    <PopoverTrigger
      render={
        <MuteButtonC
          className="media-button--mute"
          render={<IconButton />}
        >
          <VolumeOffIcon className="media-icon media-icon--volume-off" />
          <VolumeLowIcon className="media-icon media-icon--volume-low" />
          <VolumeHighIcon className="media-icon media-icon--volume-high" />
        </MuteButtonC>
      }
    />
    <PopoverPopup className="media-surface media-popover media-popover--volume">
      <VolumeSliderRoot className="media-slider" orientation="vertical" thumbAlignment="edge">
        <SliderTrack className="media-slider__track">
          <SliderFill className="media-slider__fill" />
        </SliderTrack>
        <SliderThumb className="media-slider__thumb media-slider__thumb--persistent" />
      </VolumeSliderRoot>
    </PopoverPopup>
  </PopoverRoot>
)

export type VideoSurfaceProps = {
  capabilities?: PlayerCapabilities
  children?: ComponentChildren
  className?: string
} & Record<string, unknown>

const VideoSurface = ({ capabilities, children, className, ...rest }: VideoSurfaceProps) => {
  const intl = useIntl()
  return (
    <ContainerC className={`media-default-skin media-default-skin--video${className ? ` ${className}` : ''}`} {...rest}>
      {children}
      <BufferingIndicatorC
        render={(props: Record<string, unknown>) => (
          <div {...props} className="media-buffering-indicator">
            <div className="media-surface">
              <SpinnerIcon className="media-icon" />
            </div>
          </div>
        )}
      />
      <ErrorDialogRoot>
        <AlertDialogPopup className="media-error">
          <div className="media-error__dialog media-surface">
            <div className="media-error__content">
              <AlertDialogTitle className="media-error__title">{intl.formatMessage({ id: 'Something went wrong.', defaultMessage: 'Something went wrong.' })}</AlertDialogTitle>
              <ErrorDialogDescription className="media-error__description" />
            </div>
            <div className="media-error__actions">
              <AlertDialogClose className="media-button media-button--primary">{intl.formatMessage({ id: 'OK', defaultMessage: 'OK' })}</AlertDialogClose>
            </div>
          </div>
        </AlertDialogPopup>
      </ErrorDialogRoot>
      <ControlsRoot className="media-surface media-controls">
        <TooltipProvider>
          <div className="media-button-group">
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PlayButtonC className="media-button--play" render={<IconButton />}>
                    <RestartIcon className="media-icon media-icon--restart" />
                    <PlayIcon className="media-icon media-icon--play" />
                    <PauseIcon className="media-icon media-icon--pause" />
                  </PlayButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <SeekButtonC seconds={-SEEK_TIME} className="media-button--seek" render={<IconButton />}>
                    <span className="media-icon__container">
                      <SeekIcon className="media-icon media-icon--seek media-icon--flipped" />
                      <span className="media-icon__label">{SEEK_TIME}</span>
                    </span>
                  </SeekButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: '{seconds, plural, one {Seek backward {seconds} second} other {Seek backward {seconds} seconds}}', defaultMessage: '{seconds, plural, one {Seek backward {seconds} second} other {Seek backward {seconds} seconds}}' }, { seconds: SEEK_TIME })}</TooltipPopup>
            </TooltipRoot>
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <SeekButtonC seconds={SEEK_TIME} className="media-button--seek" render={<IconButton />}>
                    <span className="media-icon__container">
                      <SeekIcon className="media-icon media-icon--seek" />
                      <span className="media-icon__label">{SEEK_TIME}</span>
                    </span>
                  </SeekButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: '{seconds, plural, one {Seek forward {seconds} second} other {Seek forward {seconds} seconds}}', defaultMessage: '{seconds, plural, one {Seek forward {seconds} second} other {Seek forward {seconds} seconds}}' }, { seconds: SEEK_TIME })}</TooltipPopup>
            </TooltipRoot>
          </div>
          <div className="media-time-controls">
            <TimeValue type="current" className="media-time" />
            <TimeSliderRoot className="media-slider">
              <SliderTrack className="media-slider__track">
                <SliderFill className="media-slider__fill" />
                <SliderBuffer className="media-slider__buffer" />
              </SliderTrack>
              <SliderThumb className="media-slider__thumb" />
              {/* media-thumbnail, not media-preview: videojs beta.26 renamed the block, and the old
                  name matches nothing, which costs the readout its positioning and its backdrop */}
              <div className="media-surface media-thumbnail media-slider__preview">
                <SliderValue type="pointer" className="media-time media-thumbnail__time" />
              </div>
            </TimeSliderRoot>
            <TimeValue type="duration" className="media-time" />
          </div>
          <div className="media-button-group">
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PlaybackRateButtonC className="media-button--playback-rate" render={<IconButton />} />
                }
              />
              <TooltipPopup className="media-surface media-tooltip">{intl.formatMessage({ id: 'Toggle playback rate', defaultMessage: 'Toggle playback rate' })}</TooltipPopup>
            </TooltipRoot>
            <VolumePopover />
            {capabilities?.subtitles && (
              <SelectionMenu
                key="subtitles"
                selection={capabilities.subtitles}
                icon={capabilities.subtitles.selectedId
                  ? <CaptionsOnIcon className="media-icon" />
                  : <CaptionsOffIcon className="media-icon" />}
              />
            )}
            {capabilities?.audioTracks && (
              <SelectionMenu key="audio" selection={capabilities.audioTracks} icon={<AudioTracksIcon className="media-icon" />} />
            )}
            {capabilities?.qualityLevels && (
              <SelectionMenu key="quality" selection={capabilities.qualityLevels} icon={<QualityIcon className="media-icon" />} />
            )}
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <PiPButtonC className="media-button--pip" render={<IconButton />}>
                    <PipEnterIcon className="media-icon media-icon--pip-enter" />
                    <PipExitIcon className="media-icon media-icon--pip-exit" />
                  </PiPButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
            <TooltipRoot side="top">
              <TooltipTrigger
                render={
                  <FullscreenButtonC className="media-button--fullscreen" render={<IconButton />}>
                    <FullscreenEnterIcon className="media-icon media-icon--fullscreen-enter" />
                    <FullscreenExitIcon className="media-icon media-icon--fullscreen-exit" />
                  </FullscreenButtonC>
                }
              />
              <TooltipPopup className="media-surface media-tooltip" />
            </TooltipRoot>
          </div>
        </TooltipProvider>
      </ControlsRoot>
      <div className="media-overlay" />
      <MediaHotkeyC keys="Space" action="togglePaused" />
      <MediaHotkeyC keys="k" action="togglePaused" />
      <MediaHotkeyC keys="m" action="toggleMuted" />
      <MediaHotkeyC keys="f" action="toggleFullscreen" />
      <MediaHotkeyC keys="i" action="togglePictureInPicture" />
      <MediaHotkeyC keys="ArrowRight" action="seekStep" value={5} />
      <MediaHotkeyC keys="ArrowLeft" action="seekStep" value={-5} />
      <MediaHotkeyC keys="l" action="seekStep" value={10} />
      <MediaHotkeyC keys="j" action="seekStep" value={-10} />
      <MediaHotkeyC keys="ArrowUp" action="volumeStep" value={0.05} />
      <MediaHotkeyC keys="ArrowDown" action="volumeStep" value={-0.05} />
      <MediaHotkeyC keys="0-9" action="seekToPercent" />
      <MediaHotkeyC keys="Home" action="seekToPercent" value={0} />
      <MediaHotkeyC keys="End" action="seekToPercent" value={100} />
      <MediaGestureC type="tap" action="togglePaused" pointer="mouse" region="center" />
      <MediaGestureC type="tap" action="toggleControls" pointer="touch" />
      <MediaGestureC type="doubletap" action="seekStep" value={-10} region="left" />
      <MediaGestureC type="doubletap" action="toggleFullscreen" region="center" />
      <MediaGestureC type="doubletap" action="seekStep" value={10} region="right" />
    </ContainerC>
  )
}

export default VideoSurface as FunctionComponent<VideoSurfaceProps>
