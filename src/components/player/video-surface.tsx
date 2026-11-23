import type { RemoteVideoElement } from '@fkn/lib'
import type { ExternalSubtitleTrack } from '@banou/media-player'
import type { ComponentChildren, FunctionComponent } from 'preact'
import type { PlayerCapabilities, PlayerChoice, PlayerSelection } from './types'

import { activeSubtitleCues, parseSubtitleCues, type SubtitleCue } from '@banou/media-player/engine'
import { css } from '@emotion/react'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { useIntl } from 'react-intl'

import { useHostEpisodeNavigation } from '../../embed-episode'
import { useHostExternalSubtitles } from '../../embed-subtitles'
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
  NextIcon,
  PauseIcon,
  PipEnterIcon,
  PipExitIcon,
  PlayIcon,
  PreviousIcon,
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
const EXT_SUBTITLE_PREFIX = 'ext:'
const EMPTY_SUBTITLE_CUES: readonly SubtitleCue[] = []

const cueContainerStyle = css`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  gap: 4px;
  padding: 0 6% 8%;
`

const cueLineStyle = css`
  max-width: 90%;
  padding: 2px 10px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.78);
  color: #fff;
  font-size: clamp(14px, 2.4cqw, 28px);
  line-height: 1.35;
  text-align: center;
  white-space: pre-line;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
`

const SubtitleCueOverlay = ({ cues, media }: {
  cues: readonly SubtitleCue[]
  media: RemoteVideoElement | null
}) => {
  const [active, setActive] = useState<SubtitleCue[]>([])

  useEffect(() => {
    if (!media || !cues.length) {
      setActive([])
      return
    }
    let anchorTime = media.currentTime || 0
    let anchorAt = performance.now()
    let rate = media.playbackRate || 1
    let paused = media.paused ?? true
    let lastKey = ''
    let frame = 0

    const paintAt = (time: number) => {
      const visible = activeSubtitleCues(cues, time)
      const key = visible.map(cue => cue.text).join('\u0000')
      if (key === lastKey) return
      lastKey = key
      setActive(visible)
    }

    const sync = () => {
      anchorTime = media.currentTime || 0
      anchorAt = performance.now()
      rate = media.playbackRate || 1
      paused = media.paused ?? true
      paintAt(anchorTime)
    }

    const tick = () => {
      frame = 0
      if (!paused) {
        const elapsed = (performance.now() - anchorAt) / 1000
        paintAt(anchorTime + elapsed * rate)
        frame = requestAnimationFrame(tick)
      }
    }

    const onPlayState = () => {
      sync()
      if (!paused && !frame) frame = requestAnimationFrame(tick)
      else if (paused && frame) {
        cancelAnimationFrame(frame)
        frame = 0
      }
    }

    const events = ['timeupdate', 'seeked', 'ratechange', 'loadedmetadata'] as const
    for (const event of events) media.addEventListener(event, sync)
    media.addEventListener('play', onPlayState)
    media.addEventListener('pause', onPlayState)

    onPlayState()

    return () => {
      if (frame) cancelAnimationFrame(frame)
      for (const event of events) media.removeEventListener(event, sync)
      media.removeEventListener('play', onPlayState)
      media.removeEventListener('pause', onPlayState)
    }
  }, [cues, media])

  if (!active.length) return null

  return (
    <div className="subtitle-cues" css={cueContainerStyle} dir="auto">
      {active.map((cue, index) => (
        <div key={`${cue.start}:${index}`} css={cueLineStyle}>{cue.text}</div>
      ))}
    </div>
  )
}

type IntrinsicButton = {
  type?: 'button' | 'submit' | 'reset'
  className?: string
  'aria-label'?: string
  onClick?: () => void
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
  const intl = useIntl()
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
                {'kind' in choice && choice.kind ? (
                  <span className={`stub-menu__tag${choice.kind === 'external' ? ' stub-menu__tag--external' : ''}`}>
                    {choice.kind === 'external'
                      ? intl.formatMessage({ id: 'External', defaultMessage: 'External' })
                      : intl.formatMessage({ id: 'Native', defaultMessage: 'Native' })}
                  </span>
                ) : null}
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
  remote?: RemoteVideoElement | null
  children?: ComponentChildren
  className?: string
} & Record<string, unknown>

const VideoSurface = ({ capabilities, remote, children, className, ...rest }: VideoSurfaceProps) => {
  const intl = useIntl()
  const episodeNavigation = useHostEpisodeNavigation()
  const hostExternalSubtitles = useHostExternalSubtitles()
  const nativeSubtitles = capabilities?.subtitles
  const [activeExternalId, setActiveExternalId] = useState<string | null>(null)
  const [externalCues, setExternalCues] = useState<readonly SubtitleCue[]>(EMPTY_SUBTITLE_CUES)
  const cueCacheRef = useRef(new Map<string, readonly SubtitleCue[]>())
  const loadSeqRef = useRef(0)
  const prevNativeSelectedRef = useRef<string | null>(nativeSubtitles?.selectedId ?? null)

  useEffect(() => {
    cueCacheRef.current.clear()
  }, [hostExternalSubtitles])

  useEffect(() => {
    if (!activeExternalId) return
    if (!hostExternalSubtitles?.some(track => track.id === activeExternalId)) {
      loadSeqRef.current++
      setActiveExternalId(null)
      setExternalCues(EMPTY_SUBTITLE_CUES)
    }
  }, [hostExternalSubtitles, activeExternalId])

  useEffect(() => {
    const nextNative = nativeSubtitles?.selectedId ?? null
    const prevNative = prevNativeSelectedRef.current
    prevNativeSelectedRef.current = nextNative
    if (nextNative !== null && nextNative !== prevNative) {
      loadSeqRef.current++
      setActiveExternalId(null)
      setExternalCues(EMPTY_SUBTITLE_CUES)
    }
  }, [nativeSubtitles?.selectedId])

  const subtitleSelection = useMemo<PlayerSelection | undefined>(() => {
    const external = hostExternalSubtitles ?? []
    if (!nativeSubtitles && !external.length) return undefined

    const options: PlayerChoice[] = [
      ...(nativeSubtitles?.options.map(option => ({ ...option, kind: option.kind ?? ('native' as const) })) ?? []),
      ...external.map(track => ({
        id: `${EXT_SUBTITLE_PREFIX}${track.id}`,
        label: track.label,
        kind: 'external' as const,
      })),
    ]
    const activeExternal = activeExternalId && external.some(track => track.id === activeExternalId)
      ? `${EXT_SUBTITLE_PREFIX}${activeExternalId}`
      : null

    return {
      label: nativeSubtitles?.label ?? intl.formatMessage({ id: 'Subtitles', defaultMessage: 'Subtitles' }),
      offLabel: nativeSubtitles?.offLabel ?? intl.formatMessage({ id: 'Off#subtitles turned off', defaultMessage: 'Off', description: 'subtitles turned off' }),
      selectedId: activeExternal ?? nativeSubtitles?.selectedId ?? null,
      options,
      onSelect: async (id) => {
        if (id !== null && id.startsWith(EXT_SUBTITLE_PREFIX)) {
          const trackId = id.slice(EXT_SUBTITLE_PREFIX.length)
          const track = external.find((entry: ExternalSubtitleTrack) => entry.id === trackId)
          if (!track) throw new Error('External subtitle track unavailable')
          const seq = ++loadSeqRef.current
          let cues = cueCacheRef.current.get(track.id)
          if (!cues) {
            const url = 'url' in track && typeof track.url === 'string' ? track.url : undefined
            const load = 'load' in track && typeof track.load === 'function' ? track.load : undefined
            const text = load
              ? await load()
              : url
                ? await fetch(url).then(res => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`)
                    return res.text()
                  })
                : await Promise.reject(new Error('External subtitle source unavailable'))
            cues = parseSubtitleCues(text, track.format)
            cueCacheRef.current.set(track.id, cues)
          }
          if (seq !== loadSeqRef.current) return
          if (nativeSubtitles && nativeSubtitles.selectedId !== null) {
            await nativeSubtitles.onSelect(null)
          }
          if (seq !== loadSeqRef.current) return
          setActiveExternalId(track.id)
          setExternalCues(cues)
          return
        }

        loadSeqRef.current++
        if (nativeSubtitles && (id !== null || nativeSubtitles.selectedId !== null)) {
          await nativeSubtitles.onSelect(id)
        }
        setActiveExternalId(null)
        setExternalCues(EMPTY_SUBTITLE_CUES)
      },
    }
  }, [nativeSubtitles, hostExternalSubtitles, activeExternalId, intl])

  const previousLabel = episodeNavigation?.previous
    ? episodeNavigation.previous.title?.trim() || intl.formatMessage({ id: 'Previous episode', defaultMessage: 'Previous episode' })
    : undefined
  const nextLabel = episodeNavigation?.next
    ? episodeNavigation.next.title?.trim() || intl.formatMessage({ id: 'Next episode', defaultMessage: 'Next episode' })
    : undefined
  return (
    <ContainerC className={`media-default-skin media-default-skin--video${className ? ` ${className}` : ''}`} {...rest}>
      {children}
      {externalCues.length ? <SubtitleCueOverlay cues={externalCues} media={remote ?? null} /> : null}
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
            {episodeNavigation?.previous && previousLabel ? (
              <TooltipRoot side="top">
                <TooltipTrigger
                  render={
                    <IconButton
                      className="media-button--previous"
                      aria-label={previousLabel}
                      onClick={() => episodeNavigation.previous?.request()}
                    >
                      <PreviousIcon className="media-icon" />
                    </IconButton>
                  }
                />
                <TooltipPopup className="media-surface media-tooltip">{previousLabel}</TooltipPopup>
              </TooltipRoot>
            ) : null}
            {episodeNavigation?.next && nextLabel ? (
              <TooltipRoot side="top">
                <TooltipTrigger
                  render={
                    <IconButton
                      className="media-button--next"
                      aria-label={nextLabel}
                      onClick={() => episodeNavigation.next?.request()}
                    >
                      <NextIcon className="media-icon" />
                    </IconButton>
                  }
                />
                <TooltipPopup className="media-surface media-tooltip">{nextLabel}</TooltipPopup>
              </TooltipRoot>
            ) : null}
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
            {subtitleSelection && (
              <SelectionMenu
                key="subtitles"
                selection={subtitleSelection}
                icon={subtitleSelection.selectedId
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
